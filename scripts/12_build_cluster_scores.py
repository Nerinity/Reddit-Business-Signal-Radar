#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("cluster_scores")

SCORE_VERSION = "cluster_trend_v0.2"
OUTPUT_COLUMNS = [
    "week_start", "cluster_id", "cluster_name",
    "current_week_posts", "previous_week_posts", "absolute_delta", "growth_rate",
    "unique_subreddits_current_week", "avg_sentiment_current_week",
    "positive_share_current_week", "negative_share_current_week",
    "avg_log_engagement_current_week",
    "volume_percentile", "volume_bucket", "spike_percentile", "spike_bucket",
    "momentum_score", "sentiment_score", "cross_community_percentile",
    "cross_community_score", "engagement_percentile", "engagement_score",
    "trend_score", "trend_score_100", "score_version", "created_at",
]
BASE_TIERS = {"strong_match", "usable_match"}
WEAK_TIERS = {"strong_match", "usable_match", "weak_match"}


def write_empty(path: str) -> None:
    out = pd.DataFrame(columns=OUTPUT_COLUMNS)
    ensure_parent(Path(path))
    out.to_parquet(path, index=False)
    log.warning("Wrote empty cluster scores -> %s", path)


def add_week(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dt = pd.to_datetime(df.get("published_at"), errors="coerce", utc=True)
    df["week_start_dt"] = dt.dt.to_period("W-MON").dt.start_time
    df["week_start"] = df["week_start_dt"].astype(str)
    return df


def fallback_usage_tier(row) -> str:
    status = str(row.get("assignment_status", "") or "")
    conf = row.get("assignment_confidence", 0.0)
    try:
        conf = float(conf)
    except Exception:
        conf = 0.0
    if status == "confident":
        return "strong_match"
    if status == "uncertain" and conf >= 0.35:
        return "usable_match"
    if conf >= 0.25:
        return "weak_match"
    return "unassigned"


def bucket_from_percentile(value: float) -> int:
    if pd.isna(value):
        return 1
    if value >= 0.80:
        return 5
    if value >= 0.60:
        return 4
    if value >= 0.40:
        return 3
    if value >= 0.20:
        return 2
    return 1


def sentiment_continuous_score(value: float) -> float:
    if pd.isna(value):
        return 3.0
    value = float(value)
    if value >= 0:
        return round(3.0 + 2.0 * (min(value, 0.70) / 0.70), 2)
    return round(3.0 - 2.0 * (min(abs(value), 0.35) / 0.35), 2)


def percentile_by_week(df: pd.DataFrame, value_col: str, out_col: str) -> None:
    df[out_col] = (
        df.groupby("week_start")[value_col]
        .rank(method="average", pct=True)
        .astype(float)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build weekly cluster-level trend scores.")
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--sentiment", default="data/processed/post_sentiment.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_assignments_226.parquet")
    parser.add_argument("--output", default="data/processed/weekly_cluster_scores.parquet")
    parser.add_argument("--include-weak-matches", action="store_true")
    args = parser.parse_args()

    if not Path(args.posts).exists() or not Path(args.clusters).exists():
        write_empty(args.output)
        return

    posts = pd.read_parquet(args.posts)
    clusters = pd.read_parquet(args.clusters)
    sentiment = pd.read_parquet(args.sentiment) if Path(args.sentiment).exists() else pd.DataFrame()
    if posts.empty or clusters.empty:
        write_empty(args.output)
        return

    cluster_cols = [
        "mention_id", "final_cluster_id", "final_cluster_name", "assignment_status",
        "assignment_confidence", "cluster_usage_tier",
    ]
    cluster_cols = [col for col in cluster_cols if col in clusters.columns]
    base = posts.merge(clusters[cluster_cols], on="mention_id", how="left")
    if len(sentiment):
        base = base.merge(sentiment[["mention_id", "sentiment_compound", "sentiment_label"]], on="mention_id", how="left")
    else:
        base["sentiment_compound"] = np.nan
        base["sentiment_label"] = ""

    for col in ["final_cluster_id", "final_cluster_name", "assignment_status"]:
        if col not in base.columns:
            base[col] = ""
        base[col] = base[col].fillna("").astype(str)
    if "assignment_confidence" not in base.columns:
        base["assignment_confidence"] = 0.0
    base["assignment_confidence"] = pd.to_numeric(base["assignment_confidence"], errors="coerce").fillna(0.0)

    if "cluster_usage_tier" not in base.columns:
        base["cluster_usage_tier"] = base.apply(fallback_usage_tier, axis=1)
    else:
        base["cluster_usage_tier"] = base["cluster_usage_tier"].astype("string")
        missing = base["cluster_usage_tier"].isna() | base["cluster_usage_tier"].str.strip().eq("")
        if missing.any():
            base.loc[missing, "cluster_usage_tier"] = base.loc[missing].apply(fallback_usage_tier, axis=1)
        base["cluster_usage_tier"] = base["cluster_usage_tier"].fillna("unassigned").astype(str)

    valid_tiers = WEAK_TIERS if args.include_weak_matches else BASE_TIERS
    base = base[
        base["final_cluster_id"].str.strip().ne("")
        & base["cluster_usage_tier"].isin(valid_tiers)
        & base["cluster_usage_tier"].ne("unassigned")
    ].copy()
    if base.empty:
        write_empty(args.output)
        return

    base = add_week(base)
    base["score"] = pd.to_numeric(base.get("score", 0), errors="coerce").fillna(0.0)
    base["num_comments"] = pd.to_numeric(base.get("num_comments", 0), errors="coerce").fillna(0.0)
    base["post_engagement"] = base["score"] + base["num_comments"]
    base["log_engagement"] = np.log1p(base["post_engagement"].clip(lower=0))
    base["sentiment_compound"] = pd.to_numeric(base.get("sentiment_compound"), errors="coerce")
    base["is_positive"] = base["sentiment_label"].fillna("").astype(str).eq("positive")
    base["is_negative"] = base["sentiment_label"].fillna("").astype(str).eq("negative")

    weekly = base.groupby(["week_start", "week_start_dt", "final_cluster_id", "final_cluster_name"], dropna=False).agg(
        current_week_posts=("mention_id", "nunique"),
        unique_subreddits_current_week=("subreddit", "nunique"),
        avg_sentiment_current_week=("sentiment_compound", "mean"),
        positive_share_current_week=("is_positive", "mean"),
        negative_share_current_week=("is_negative", "mean"),
        avg_log_engagement_current_week=("log_engagement", "mean"),
    ).reset_index().rename(columns={
        "final_cluster_id": "cluster_id",
        "final_cluster_name": "cluster_name",
    })

    previous = weekly[["week_start_dt", "cluster_id", "current_week_posts"]].copy()
    previous["week_start_dt"] = previous["week_start_dt"] + pd.Timedelta(days=7)
    previous = previous.rename(columns={"current_week_posts": "previous_week_posts"})
    weekly = weekly.merge(previous, on=["week_start_dt", "cluster_id"], how="left")
    weekly["previous_week_posts"] = weekly["previous_week_posts"].fillna(0).astype(int)
    weekly["absolute_delta"] = weekly["current_week_posts"] - weekly["previous_week_posts"]
    weekly["growth_rate"] = weekly["absolute_delta"] / weekly["previous_week_posts"].clip(lower=1)

    percentile_by_week(weekly, "current_week_posts", "volume_percentile")
    percentile_by_week(weekly, "growth_rate", "spike_percentile")
    percentile_by_week(weekly, "unique_subreddits_current_week", "cross_community_percentile")
    percentile_by_week(weekly, "avg_log_engagement_current_week", "engagement_percentile")

    weekly["volume_bucket"] = weekly["volume_percentile"].map(bucket_from_percentile).astype(int)
    weekly["spike_bucket"] = weekly["spike_percentile"].map(bucket_from_percentile).astype(int)
    low_sample = weekly["current_week_posts"] < 3
    weekly.loc[low_sample, "spike_bucket"] = weekly.loc[low_sample, "spike_bucket"].clip(upper=2)
    new_small = weekly["previous_week_posts"].eq(0) & (weekly["current_week_posts"] < 5)
    weekly.loc[new_small, "spike_bucket"] = weekly.loc[new_small, "spike_bucket"].clip(upper=3)
    weekly["momentum_score"] = (0.60 * weekly["volume_bucket"] + 0.40 * weekly["spike_bucket"]).round(2)

    weekly["sentiment_score"] = weekly["avg_sentiment_current_week"].map(sentiment_continuous_score).astype(float)
    weekly["cross_community_score"] = weekly["cross_community_percentile"].map(bucket_from_percentile).astype(int)
    weekly.loc[weekly["current_week_posts"] < 3, "cross_community_score"] = weekly.loc[
        weekly["current_week_posts"] < 3, "cross_community_score"
    ].clip(upper=2)
    weekly.loc[weekly["unique_subreddits_current_week"].eq(1), "cross_community_score"] = weekly.loc[
        weekly["unique_subreddits_current_week"].eq(1), "cross_community_score"
    ].clip(upper=2)
    weekly.loc[weekly["unique_subreddits_current_week"].eq(2), "cross_community_score"] = weekly.loc[
        weekly["unique_subreddits_current_week"].eq(2), "cross_community_score"
    ].clip(upper=3)

    weekly["engagement_score"] = weekly["engagement_percentile"].map(bucket_from_percentile).astype(int)
    weekly.loc[weekly["current_week_posts"] < 3, "engagement_score"] = weekly.loc[
        weekly["current_week_posts"] < 3, "engagement_score"
    ].clip(upper=2)

    for col in ["sentiment_score", "cross_community_score", "engagement_score"]:
        weekly[col] = weekly[col].astype(float).round(2)
    weekly["trend_score"] = (
        0.40 * weekly["momentum_score"]
        + 0.20 * weekly["sentiment_score"]
        + 0.20 * weekly["cross_community_score"]
        + 0.20 * weekly["engagement_score"]
    ).round(2)
    weekly["trend_score_100"] = (weekly["trend_score"] * 20).round(1)
    weekly["score_version"] = SCORE_VERSION
    weekly["created_at"] = datetime.now(timezone.utc).isoformat()

    out = weekly[OUTPUT_COLUMNS].copy()
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    log.info("Wrote %d weekly cluster score rows -> %s", len(out), args.output)


if __name__ == "__main__":
    main()
