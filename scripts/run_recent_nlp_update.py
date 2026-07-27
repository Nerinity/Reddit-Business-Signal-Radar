#!/usr/bin/env python3
"""Reprocess only the latest N ISO weeks while preserving older artifacts."""
from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import merge_recent_raw_reddit as raw_merge  # noqa: E402

PROCESSED = ROOT / "data" / "processed"
STAGING = ROOT / "data" / "state" / "recent_nlp_staging"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("recent_nlp_update")


def run(script: str, *args: object) -> None:
    cmd = [sys.executable, str(ROOT / "scripts" / script), *(str(arg) for arg in args)]
    log.info("Running %s", script)
    subprocess.run(cmd, cwd=ROOT, check=True)


def merge_by_ids(canonical: Path, recent: Path, replaced_ids: set[str]) -> None:
    new = pd.read_parquet(recent)
    if canonical.exists():
        old = pd.read_parquet(canonical)
        if "mention_id" not in old.columns or "mention_id" not in new.columns:
            raise RuntimeError(f"mention_id is required for incremental merge: {canonical}")
        old = old[~old["mention_id"].astype(str).isin(replaced_ids)]
        new = pd.concat([old, new], ignore_index=True, sort=False)
    canonical.parent.mkdir(parents=True, exist_ok=True)
    new.to_parquet(canonical, index=False)
    log.info("Merged %s (%d rows)", canonical.name, len(new))


def merge_by_week(canonical: Path, recent: Path, cutoff: pd.Timestamp) -> None:
    new = pd.read_parquet(recent)
    new_week = pd.to_datetime(new["week_start"], errors="coerce")
    new = new[new_week >= cutoff.tz_localize(None)]
    if canonical.exists():
        old = pd.read_parquet(canonical)
        old_week = pd.to_datetime(old["week_start"], errors="coerce")
        old = old[old_week < cutoff.tz_localize(None)]
        new = pd.concat([old, new], ignore_index=True, sort=False)
    canonical.parent.mkdir(parents=True, exist_ok=True)
    new.to_parquet(canonical, index=False)
    log.info("Replaced recent partitions in %s (%d rows)", canonical.name, len(new))


def build_recent_raw(weeks: int) -> tuple[pd.Timestamp, Path]:
    files = raw_merge.discover_raw_files()
    raw = raw_merge.load_raw_frames(files)
    raw["published_at"] = raw_merge.resolve_event_time(raw)
    latest = raw["published_at"].max()
    if pd.isna(latest):
        raise RuntimeError("Raw Reddit data contains no valid event timestamps")
    latest_monday = latest.normalize() - pd.Timedelta(days=latest.weekday())
    cutoff = latest_monday - pd.Timedelta(weeks=weeks - 1)
    recent = raw[raw["published_at"].ge(cutoff)].copy()
    recent["event_date"] = recent["published_at"].dt.date.astype("string")
    recent["subreddit"] = raw_merge.col(
        recent, "subreddit", raw_merge.col(recent, "community", "")
    ).fillna("").astype(str)
    recent["_dedupe_key"] = raw_merge.build_dedupe_key(recent)
    sort_col = "collected_at" if "collected_at" in recent.columns else "published_at"
    recent = (
        recent.sort_values(sort_col, ascending=False)
        .drop_duplicates("_dedupe_key", keep="first")
        .drop(columns="_dedupe_key")
        .sort_values("published_at")
        .reset_index(drop=True)
    )
    out = STAGING / "reddit_posts.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    recent.to_parquet(out, index=False)
    # Keep the standard input aligned with the documented two-week incremental scope.
    recent.to_parquet(ROOT / "data" / "raw" / "reddit_posts.parquet", index=False)
    log.info("Recent window %s..%s: %d raw posts", cutoff.date(), latest.date(), len(recent))
    return cutoff, out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=int, default=2)
    parser.add_argument("--skip-dashboard", action="store_true")
    args = parser.parse_args()
    if args.weeks < 1:
        raise SystemExit("--weeks must be at least 1")

    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)
    cutoff, raw_input = build_recent_raw(args.weeks)

    old_recent_ids: set[str] = set()
    canonical_posts = PROCESSED / "clean_reddit_posts.parquet"
    if canonical_posts.exists():
        old_posts = pd.read_parquet(canonical_posts, columns=["mention_id", "published_at"])
        old_recent_ids = set(
            old_posts.loc[pd.to_datetime(old_posts["published_at"], utc=True).ge(cutoff), "mention_id"].astype(str)
        )

    clean = STAGING / "clean_reddit_posts.parquet"
    tokens = STAGING / "reddit_tokens.parquet"
    sentiment = STAGING / "post_sentiment.parquet"
    entities = STAGING / "entity_mentions.parquet"
    review = STAGING / "entity_review_queue.csv"
    assignments = STAGING / "cluster_assignments.parquet"
    brand_index = STAGING / "brand_post_index.parquet"

    run("01_clean_reddit_posts.py", "--input", raw_input, "--output", clean, "--report", STAGING / "clean_report.json")
    run("05_tokenize_and_extract_phrases.py", "--input", clean, "--output", tokens)
    run("06_run_sentiment.py", "--input", clean, "--output", sentiment)
    run(
        "07_extract_entities.py", "--posts", clean, "--tokens", tokens,
        "--output", entities, "--review-output", review,
    )
    run(
        "08_match_226_clusters.py", "--posts", clean, "--entities", entities,
        "--output", assignments, "--offline",
        "--similarity-report", STAGING / "cluster_similarity_report.json",
    )
    run(
        "09_build_brand_post_index.py", "--entities", entities, "--posts", clean,
        "--sentiment", sentiment, "--clusters", assignments, "--output", brand_index,
    )

    recent_ids = set(pd.read_parquet(clean, columns=["mention_id"])["mention_id"].astype(str))
    replaced_ids = old_recent_ids | recent_ids
    for name, staged in [
        ("clean_reddit_posts.parquet", clean),
        ("reddit_tokens.parquet", tokens),
        ("post_sentiment.parquet", sentiment),
        ("entity_mentions.parquet", entities),
        ("cluster_assignments.parquet", assignments),
        ("brand_post_index.parquet", brand_index),
    ]:
        merge_by_ids(PROCESSED / name, staged, replaced_ids)
    shutil.copy2(PROCESSED / "cluster_assignments.parquet", PROCESSED / "cluster_assignments_226.parquet")

    weekly_brand = STAGING / "weekly_brand_metrics.parquet"
    weekly_cluster = STAGING / "weekly_cluster_metrics.parquet"
    weekly_terms = STAGING / "weekly_trend_terms.parquet"
    run(
        "10_build_weekly_metrics.py", "--posts", clean, "--sentiment", sentiment,
        "--entities", entities, "--clusters", assignments, "--brand-index", brand_index,
        "--brand-output", weekly_brand,
        "--cluster-output", weekly_cluster, "--terms-output", weekly_terms,
    )

    discussion = STAGING / "weekly_cluster_discussion_terms.parquet"
    keyword_index = STAGING / "keyword_post_index.parquet"
    brands = STAGING / "weekly_cluster_brand_mentions.parquet"
    high_precision = STAGING / "high_precision_cluster_posts.parquet"
    run(
        "11_build_cluster_entity_metrics.py", "--posts", clean, "--sentiment", sentiment,
        "--entities", entities, "--clusters", assignments, "--terms-output", discussion,
        "--keyword-index-output", keyword_index, "--brands-output", brands,
        "--high-precision-output", high_precision,
        "--quality-report-output", STAGING / "cluster_entity_quality_report.json",
    )
    scores = STAGING / "weekly_cluster_scores.parquet"
    run(
        "12_build_cluster_scores.py", "--posts", clean, "--sentiment", sentiment,
        "--clusters", assignments, "--output", scores,
    )

    for name, staged in [
        ("weekly_brand_metrics.parquet", weekly_brand),
        ("weekly_cluster_metrics.parquet", weekly_cluster),
        ("weekly_trend_terms.parquet", weekly_terms),
        ("weekly_cluster_discussion_terms.parquet", discussion),
        ("keyword_post_index.parquet", keyword_index),
        ("weekly_cluster_brand_mentions.parquet", brands),
        ("weekly_cluster_scores.parquet", scores),
    ]:
        merge_by_week(PROCESSED / name, staged, cutoff)
    merge_by_ids(PROCESSED / "high_precision_cluster_posts.parquet", high_precision, replaced_ids)
    shutil.copy2(STAGING / "cluster_entity_quality_report.json", PROCESSED / "cluster_entity_quality_report.json")

    if not args.skip_dashboard:
        run("sync_product_app_data.py")
    log.info("Recent %d-week update complete; history before %s was preserved", args.weeks, cutoff.date())


if __name__ == "__main__":
    main()
