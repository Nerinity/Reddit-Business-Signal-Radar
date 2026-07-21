#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("weekly_metrics")


def json_sample(values, n: int = 10) -> str:
    return json.dumps([str(v) for v in values if str(v).strip()][:n], ensure_ascii=False)


def add_week(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dt = pd.to_datetime(df.get("published_at"), errors="coerce", utc=True)
    df["week_start"] = dt.dt.to_period("W-SUN").dt.start_time.astype(str)
    return df


def wow_growth(frame: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    frame = frame.sort_values(keys + ["week_start"]).copy()
    frame["prev_mentions"] = frame.groupby(keys)["mentions"].shift(1)
    frame["week_over_week_growth"] = (frame["mentions"] - frame["prev_mentions"]) / frame["prev_mentions"].replace(0, pd.NA)
    frame["week_over_week_growth"] = frame["week_over_week_growth"].fillna(0.0)
    return frame.drop(columns=["prev_mentions"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--sentiment", default="data/processed/post_sentiment.parquet")
    parser.add_argument("--entities", default="data/processed/entity_mentions.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_assignments_226.parquet")
    parser.add_argument("--brand-index", default="data/processed/brand_post_index.parquet")
    parser.add_argument("--brand-output", default="data/processed/weekly_brand_metrics.parquet")
    parser.add_argument("--cluster-output", default="data/processed/weekly_cluster_metrics.parquet")
    parser.add_argument("--terms-output", default="data/processed/weekly_trend_terms.parquet")
    parser.add_argument("--include-unassigned", action="store_true")
    args = parser.parse_args()

    posts = pd.read_parquet(args.posts)
    sentiment = pd.read_parquet(args.sentiment) if Path(args.sentiment).exists() else pd.DataFrame()
    entities = pd.read_parquet(args.entities) if Path(args.entities).exists() else pd.DataFrame()
    cluster_path = Path(args.clusters)
    if not cluster_path.exists():
        cluster_path = Path("data/processed/cluster_assignments.parquet")
    clusters = pd.read_parquet(cluster_path) if cluster_path.exists() else pd.DataFrame()
    brand_index = pd.read_parquet(args.brand_index) if Path(args.brand_index).exists() else pd.DataFrame()

    base = posts.copy()
    if len(sentiment):
        base = base.merge(sentiment[["mention_id", "sentiment_label", "sentiment_compound"]], on="mention_id", how="left")
    if len(clusters):
        cluster_cols = ["mention_id", "final_cluster_id", "final_cluster_name"]
        if "assignment_status" in clusters.columns:
            cluster_cols.append("assignment_status")
        base = base.merge(clusters[cluster_cols], on="mention_id", how="left")
    base = add_week(base)
    score = pd.to_numeric(base.get("score", 0), errors="coerce").fillna(0)
    comments = pd.to_numeric(base.get("num_comments", 0), errors="coerce").fillna(0)
    base["engagement_score"] = score + comments
    base["sentiment_compound"] = pd.to_numeric(base.get("sentiment_compound", 0), errors="coerce").fillna(0)
    base["is_positive"] = base.get("sentiment_label", "").eq("positive")
    base["is_negative"] = base.get("sentiment_label", "").eq("negative")

    if len(brand_index):
        bi = add_week(brand_index)
        brand_metrics = bi.groupby(["week_start", "brand_norm", "brand_display", "in_platform_brand"], dropna=False).agg(
            mentions=("mention_id", "count"),
            unique_posts=("mention_id", "nunique"),
            unique_subreddits=("subreddit", "nunique"),
            avg_sentiment=("sentiment_compound", "mean"),
            positive_share=("sentiment_label", lambda s: float((s == "positive").mean())),
            negative_share=("sentiment_label", lambda s: float((s == "negative").mean())),
            engagement_score_sum=("engagement_score", "sum"),
            engagement_score_avg=("engagement_score", "mean"),
            sample_post_ids=("mention_id", json_sample),
            sample_urls=("url", json_sample),
            top_cluster_id=("final_cluster_id", lambda s: s.mode().iat[0] if not s.mode().empty else ""),
            top_cluster_name=("final_cluster_name", lambda s: s.mode().iat[0] if not s.mode().empty else ""),
            google_search_url=("google_search_url", "first"),
        ).reset_index()
        brand_metrics = wow_growth(brand_metrics, ["brand_norm"])
    else:
        brand_metrics = pd.DataFrame()

    cluster_base = base.copy()
    for col in ["final_cluster_id", "final_cluster_name", "assignment_status"]:
        if col not in cluster_base.columns:
            cluster_base[col] = ""
    cluster_base["final_cluster_id"] = cluster_base["final_cluster_id"].fillna("").astype(str)
    cluster_base["final_cluster_name"] = cluster_base["final_cluster_name"].fillna("").astype(str)
    if args.include_unassigned:
        is_empty = cluster_base["final_cluster_id"].str.strip().eq("")
        is_unassigned = cluster_base["assignment_status"].fillna("").astype(str).eq("unassigned")
        mask = is_empty | is_unassigned
        cluster_base.loc[mask, "final_cluster_id"] = "UNASSIGNED"
        cluster_base.loc[mask, "final_cluster_name"] = "Unassigned / Low Confidence"
    else:
        cluster_base = cluster_base[cluster_base["final_cluster_id"].str.strip().ne("")]
        if "assignment_status" in cluster_base.columns:
            cluster_base = cluster_base[cluster_base["assignment_status"].fillna("").astype(str).ne("unassigned")]

    cluster_metrics = cluster_base.groupby(["week_start", "final_cluster_id", "final_cluster_name"], dropna=False).agg(
        mentions=("mention_id", "count"),
        unique_posts=("mention_id", "nunique"),
        unique_subreddits=("subreddit", "nunique"),
        avg_sentiment=("sentiment_compound", "mean"),
        positive_share=("is_positive", "mean"),
        negative_share=("is_negative", "mean"),
        engagement_score_sum=("engagement_score", "sum"),
        engagement_score_avg=("engagement_score", "mean"),
        sample_post_ids=("mention_id", json_sample),
        sample_urls=("url", json_sample),
    ).reset_index().rename(columns={"final_cluster_id": "cluster_id", "final_cluster_name": "cluster_name"})
    cluster_metrics = wow_growth(cluster_metrics, ["cluster_id"])

    if len(entities):
        term_df = entities.merge(base[["mention_id", "week_start", "sentiment_compound"]], on="mention_id", how="left")
        term_metrics = term_df.groupby(
            ["week_start", "entity_text", "entity_norm", "entity_type", "matched_cluster_id", "matched_cluster_name"],
            dropna=False,
        ).agg(
            mentions=("mention_id", "count"),
            unique_posts=("mention_id", "nunique"),
            avg_sentiment=("sentiment_compound", "mean"),
            sample_posts=("mention_id", json_sample),
        ).reset_index().rename(columns={
            "entity_text": "term",
            "entity_norm": "term_norm",
        })
        term_metrics = wow_growth(term_metrics, ["term_norm", "entity_type"])
    else:
        term_metrics = pd.DataFrame()

    for path, frame in [
        (args.brand_output, brand_metrics),
        (args.cluster_output, cluster_metrics),
        (args.terms_output, term_metrics),
    ]:
        ensure_parent(Path(path))
        frame.to_parquet(path, index=False)
        log.info("Wrote %s rows to %s", len(frame), path)


if __name__ == "__main__":
    main()
