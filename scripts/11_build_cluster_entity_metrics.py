#!/usr/bin/env python3
"""Canonical by-cluster discussion-term and brand-mention tables.

Table roles (see also README.md "NLP Signal Pipeline"):

  cluster_assignments_226.parquet          post-to-cluster assignment, confidence, usage tier
  entity_mentions.parquet                  post-level extracted brands/phrases/need-states/candidates
  weekly_cluster_discussion_terms.parquet  canonical source for by-cluster keyword/topic frequency
  weekly_cluster_brand_mentions.parquet    canonical source for by-cluster brand mention frequency
  high_precision_cluster_posts.parquet     confident-only evidence; NOT the source for cluster mining
  weekly_cluster_metrics.parquet           cluster-level post volume and sentiment overview
  weekly_brand_metrics.parquet             global brand overview (not cluster-filtered)
  weekly_trend_terms.parquet               global trend term view only, not for cluster filtering

A post's cluster is decided once, by cluster_assignments_226.final_cluster_id. Every entity
pulled out of that post is credited to that same cluster. entity_mentions.matched_cluster_id
(a brand's static whitelist home cluster, independent of what the post is actually about) is
kept only as a debug hint (entity_matched_cluster_id/name), never as the aggregation key.

A strict confident-only gate starves cluster-level discussion intelligence almost entirely --
Reddit post text vs. commerce-taxonomy profile text rarely scores much above 0.5-0.6 on
semantic similarity alone. Discussion-term and brand-mention mining therefore use their own,
more permissive gates (see --min-discussion-confidence / --include-weak-matches below), while
high_precision_cluster_posts.parquet keeps the strict confident-only slice available separately.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, google_brand_url, top_counts

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("cluster_discussion_intelligence")

TERM_OUTPUT_COLUMNS = [
    "week_start", "cluster_id", "cluster_name", "entity_type", "term", "term_norm",
    "mentions", "unique_posts", "avg_sentiment", "positive_share", "negative_share",
    "sample_post_ids", "sample_titles", "sample_urls", "top_subreddits",
    "avg_assignment_confidence", "assignment_status_distribution",
    "entity_matched_cluster_id", "entity_matched_cluster_name",
]
BRAND_OUTPUT_COLUMNS = [
    "week_start", "cluster_id", "cluster_name", "brand_signal_type", "brand_display", "brand_norm",
    "candidate_text", "in_platform_brand", "mentions", "unique_posts", "avg_sentiment",
    "positive_share", "negative_share", "sample_post_ids", "sample_titles", "sample_urls",
    "top_subreddits", "google_search_url", "avg_assignment_confidence", "assignment_status_distribution",
]
HIGH_PRECISION_COLUMNS = [
    "mention_id", "cluster_id", "cluster_name", "assignment_confidence", "score_gap",
    "semantic_score", "keyword_overlap_score", "brand_prior_score",
    "title", "subreddit", "published_at", "url",
]
DISCUSSION_ENTITY_TYPES = {
    "product_phrase", "category_keyword", "need_state", "ingredient_material", "retailer_channel",
    "brand", "unknown_candidate",
}
BRAND_MENTION_ENTITY_TYPES = {"brand", "unknown_candidate"}
BRAND_MENTION_MIN_CONFIDENCE = 0.30


def add_week(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dt = pd.to_datetime(df.get("published_at"), errors="coerce", utc=True)
    df["week_start"] = dt.dt.to_period("W-MON").dt.start_time.astype(str)
    return df


def json_sample(values, n: int = 10) -> str:
    return json.dumps([str(v) for v in values if str(v).strip()][:n], ensure_ascii=False)


def top_counts_json(values, n: int = 5) -> str:
    return json.dumps(top_counts(values, n), ensure_ascii=False)


def status_distribution_json(values) -> str:
    counts = pd.Series(list(values)).astype(str).value_counts().to_dict()
    return json.dumps({k: int(v) for k, v in counts.items()}, ensure_ascii=False)


def mode_or_blank(series: pd.Series) -> str:
    m = series.dropna().astype(str)
    m = m[m.str.strip() != ""]
    return m.mode().iat[0] if not m.empty else ""


def write_empty(path: str, columns: list[str]) -> None:
    out = pd.DataFrame(columns=columns)
    ensure_parent(Path(path))
    out.to_parquet(path, index=False)
    log.warning("Wrote empty table -> %s", path)


def build_post_cluster_base(posts: pd.DataFrame, clusters: pd.DataFrame, sentiment: pd.DataFrame) -> pd.DataFrame:
    cluster_cols = [
        "mention_id", "final_cluster_id", "final_cluster_name", "assignment_status",
        "assignment_confidence", "score_gap", "semantic_score", "keyword_overlap_score", "brand_prior_score",
    ]
    cluster_cols = [c for c in cluster_cols if c in clusters.columns]
    base = posts.merge(clusters[cluster_cols], on="mention_id", how="left")
    if len(sentiment):
        base = base.merge(sentiment[["mention_id", "sentiment_compound", "sentiment_label"]], on="mention_id", how="left")
    else:
        base["sentiment_compound"] = 0.0
        base["sentiment_label"] = ""
    base = add_week(base)
    for col in ["final_cluster_id", "final_cluster_name", "assignment_status"]:
        if col not in base.columns:
            base[col] = ""
        base[col] = base[col].fillna("").astype(str)
    base["assignment_confidence"] = pd.to_numeric(base.get("assignment_confidence"), errors="coerce").fillna(0.0)
    base["score_gap"] = pd.to_numeric(base.get("score_gap"), errors="coerce").fillna(0.0)
    return base.rename(columns={"final_cluster_id": "cluster_id", "final_cluster_name": "cluster_name"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Build canonical by-cluster discussion-term and brand-mention tables.")
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--sentiment", default="data/processed/post_sentiment.parquet")
    parser.add_argument("--entities", default="data/processed/entity_mentions.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_assignments_226.parquet")
    parser.add_argument("--terms-output", default="data/processed/weekly_cluster_discussion_terms.parquet")
    parser.add_argument("--brands-output", default="data/processed/weekly_cluster_brand_mentions.parquet")
    parser.add_argument("--high-precision-output", default="data/processed/high_precision_cluster_posts.parquet")
    parser.add_argument("--min-discussion-confidence", type=float, default=0.35)
    parser.add_argument(
        "--include-weak-matches", action="store_true",
        help="Lower the discussion-term confidence floor to 0.25 and also allow posts whose legacy "
             "assignment_status is 'unassigned' but still cleared the weak_match usage tier.",
    )
    args = parser.parse_args()

    if any(not Path(p).exists() for p in (args.posts, args.entities, args.clusters)):
        write_empty(args.terms_output, TERM_OUTPUT_COLUMNS)
        write_empty(args.brands_output, BRAND_OUTPUT_COLUMNS)
        write_empty(args.high_precision_output, HIGH_PRECISION_COLUMNS)
        return

    posts = pd.read_parquet(args.posts)
    entities = pd.read_parquet(args.entities)
    clusters = pd.read_parquet(args.clusters)
    sentiment = pd.read_parquet(args.sentiment) if Path(args.sentiment).exists() else pd.DataFrame()

    if posts.empty or entities.empty or clusters.empty:
        write_empty(args.terms_output, TERM_OUTPUT_COLUMNS)
        write_empty(args.brands_output, BRAND_OUTPUT_COLUMNS)
        write_empty(args.high_precision_output, HIGH_PRECISION_COLUMNS)
        return

    base = build_post_cluster_base(posts, clusters, sentiment)
    has_cluster = base["cluster_id"].str.strip().ne("")

    # -- High-precision evidence: confident posts only. Kept separate; never the discussion-mining source.
    high_precision = base[base["assignment_status"].eq("confident") & has_cluster]
    hp_src_to_dst = {
        "mention_id": "mention_id", "cluster_id": "cluster_id", "cluster_name": "cluster_name",
        "assignment_confidence": "assignment_confidence", "score_gap": "score_gap",
        "semantic_score": "semantic_score", "keyword_overlap_score": "keyword_overlap_score",
        "brand_prior_score": "brand_prior_score", "title_clean": "title", "subreddit": "subreddit",
        "published_at": "published_at", "url": "url",
    }
    hp_out = pd.DataFrame({dst: high_precision.get(src, "") for src, dst in hp_src_to_dst.items()})
    ensure_parent(Path(args.high_precision_output))
    hp_out.to_parquet(args.high_precision_output, index=False)
    log.info("Wrote %d high-precision cluster posts -> %s", len(hp_out), args.high_precision_output)

    # -- Discussion-term gate.
    if args.include_weak_matches:
        min_conf = 0.25
        allowed_status = {"confident", "uncertain", "unassigned"}
    else:
        min_conf = args.min_discussion_confidence
        allowed_status = {"confident", "uncertain"}
    discussion_gate = (
        has_cluster
        & base["assignment_status"].isin(allowed_status)
        & (base["assignment_confidence"] >= min_conf)
    )
    discussion_posts = base[discussion_gate]
    log.info(
        "Discussion-term gate: %d / %d posts included (min_confidence=%.2f, include_weak_matches=%s)",
        len(discussion_posts), len(base), min_conf, args.include_weak_matches,
    )

    # -- Brand-mention gate: independent, fixed floor, no assignment_status restriction.
    brand_gate = has_cluster & (base["assignment_confidence"] >= BRAND_MENTION_MIN_CONFIDENCE)
    brand_posts = base[brand_gate]
    log.info("Brand-mention gate: %d / %d posts included (min_confidence=%.2f)", len(brand_posts), len(base), BRAND_MENTION_MIN_CONFIDENCE)

    entity_cols = [
        "mention_id", "entity_text", "entity_norm", "entity_type", "in_platform_brand", "brand_signal_type",
        "brand_norm", "brand_display", "google_search_url", "matched_cluster_id", "matched_cluster_name",
    ]
    entity_cols = [c for c in entity_cols if c in entities.columns]
    entities_small = entities[entity_cols].rename(columns={
        "matched_cluster_id": "entity_matched_cluster_id",
        "matched_cluster_name": "entity_matched_cluster_name",
    })
    post_side_cols = [
        "mention_id", "cluster_id", "cluster_name", "week_start", "subreddit", "title_clean", "url",
        "sentiment_compound", "sentiment_label", "assignment_confidence", "assignment_status",
    ]

    # === A. Cluster discussion terms ===
    term_join = entities_small[entities_small["entity_type"].isin(DISCUSSION_ENTITY_TYPES)].merge(
        discussion_posts[[c for c in post_side_cols if c in discussion_posts.columns]], on="mention_id", how="inner"
    )
    if term_join.empty:
        write_empty(args.terms_output, TERM_OUTPUT_COLUMNS)
    else:
        term_join["is_positive"] = term_join["sentiment_label"].eq("positive")
        term_join["is_negative"] = term_join["sentiment_label"].eq("negative")
        term_metrics = term_join.groupby(
            ["week_start", "cluster_id", "cluster_name", "entity_type", "entity_norm"], dropna=False
        ).agg(
            term=("entity_text", mode_or_blank),
            mentions=("mention_id", "count"),
            unique_posts=("mention_id", "nunique"),
            avg_sentiment=("sentiment_compound", "mean"),
            positive_share=("is_positive", "mean"),
            negative_share=("is_negative", "mean"),
            sample_post_ids=("mention_id", json_sample),
            sample_titles=("title_clean", json_sample),
            sample_urls=("url", json_sample),
            top_subreddits=("subreddit", top_counts_json),
            avg_assignment_confidence=("assignment_confidence", "mean"),
            assignment_status_distribution=("assignment_status", status_distribution_json),
            entity_matched_cluster_id=("entity_matched_cluster_id", mode_or_blank),
            entity_matched_cluster_name=("entity_matched_cluster_name", mode_or_blank),
        ).reset_index().rename(columns={"entity_norm": "term_norm"})
        term_out = term_metrics[TERM_OUTPUT_COLUMNS]
        ensure_parent(Path(args.terms_output))
        term_out.to_parquet(args.terms_output, index=False)
        log.info("Wrote %d cluster discussion-term rows -> %s", len(term_out), args.terms_output)

    # === B. Cluster brand mentions (confirmed whitelist brands + non-whitelist candidates, kept separate) ===
    brand_join = entities_small[entities_small["entity_type"].isin(BRAND_MENTION_ENTITY_TYPES)].merge(
        brand_posts[[c for c in post_side_cols if c in brand_posts.columns]], on="mention_id", how="inner"
    )
    if brand_join.empty:
        write_empty(args.brands_output, BRAND_OUTPUT_COLUMNS)
    else:
        brand_join["is_positive"] = brand_join["sentiment_label"].eq("positive")
        brand_join["is_negative"] = brand_join["sentiment_label"].eq("negative")
        # brand_signal_type already comes from entity_mentions (set in 07_extract_entities.py):
        # confirmed_whitelist_brand / catalog_known_brand / candidate_non_whitelist_brand. The
        # first two have a real brand_norm from brand_registry.parquet; only candidates fall
        # back to identifying themselves by their raw (unverified) text.
        is_known_brand = brand_join["brand_signal_type"].isin(["confirmed_whitelist_brand", "catalog_known_brand"])
        brand_join["identity_key"] = brand_join["brand_norm"].where(is_known_brand, brand_join["entity_norm"])
        brand_join["google_search_url"] = brand_join["google_search_url"].where(
            brand_join["google_search_url"].astype(str).str.len() > 0,
            brand_join["entity_text"].map(google_brand_url),
        )

        brand_metrics = brand_join.groupby(
            ["week_start", "cluster_id", "cluster_name", "brand_signal_type", "identity_key"], dropna=False
        ).agg(
            brand_display=("brand_display", mode_or_blank),
            brand_norm=("brand_norm", mode_or_blank),
            candidate_text=("entity_text", mode_or_blank),
            in_platform_brand=("in_platform_brand", "any"),
            mentions=("mention_id", "count"),
            unique_posts=("mention_id", "nunique"),
            avg_sentiment=("sentiment_compound", "mean"),
            positive_share=("is_positive", "mean"),
            negative_share=("is_negative", "mean"),
            sample_post_ids=("mention_id", json_sample),
            sample_titles=("title_clean", json_sample),
            sample_urls=("url", json_sample),
            top_subreddits=("subreddit", top_counts_json),
            google_search_url=("google_search_url", mode_or_blank),
            avg_assignment_confidence=("assignment_confidence", "mean"),
            assignment_status_distribution=("assignment_status", status_distribution_json),
        ).reset_index()
        is_known_brand_row = brand_metrics["brand_signal_type"].isin(["confirmed_whitelist_brand", "catalog_known_brand"])
        brand_metrics.loc[is_known_brand_row, "candidate_text"] = ""
        brand_metrics.loc[~is_known_brand_row, ["brand_norm", "brand_display"]] = ""
        brand_out = brand_metrics.drop(columns=["identity_key"])[BRAND_OUTPUT_COLUMNS]
        ensure_parent(Path(args.brands_output))
        brand_out.to_parquet(args.brands_output, index=False)
        log.info("Wrote %d cluster brand-mention rows -> %s", len(brand_out), args.brands_output)


if __name__ == "__main__":
    main()
