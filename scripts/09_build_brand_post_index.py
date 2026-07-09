#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import clean_readable_text, ensure_parent, google_brand_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("brand_post_index")
OUTPUT_COLUMNS = [
    "brand_norm", "brand_display", "in_platform_brand", "mention_id", "title", "text_snippet",
    "subreddit", "published_at", "url", "sentiment_label", "sentiment_compound",
    "final_cluster_id", "final_cluster_name", "engagement_score", "context_window", "google_search_url",
]


def snippet(text: str, n: int = 320) -> str:
    text = clean_readable_text(text)
    return text[: n - 3].rstrip() + "..." if len(text) > n else text


def write_empty(path: str) -> None:
    out = pd.DataFrame(columns=OUTPUT_COLUMNS)
    ensure_parent(Path(path))
    out.to_parquet(path, index=False)
    log.warning("Wrote empty brand-post index -> %s", path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--entities", default="data/processed/entity_mentions.parquet")
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--sentiment", default="data/processed/post_sentiment.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_assignments.parquet")
    parser.add_argument("--output", default="data/processed/brand_post_index.parquet")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    if not Path(args.entities).exists():
        write_empty(args.output)
        return
    entities = pd.read_parquet(args.entities)
    posts = pd.read_parquet(args.posts)
    if args.sample:
        posts = posts.head(args.sample).copy()
    sentiment = pd.read_parquet(args.sentiment) if Path(args.sentiment).exists() else pd.DataFrame()
    clusters = pd.read_parquet(args.clusters) if Path(args.clusters).exists() else pd.DataFrame()

    allowed = (
        (entities["entity_type"].eq("brand"))
        | ((entities["review_status"].eq("candidate")) & (entities["entity_type"].isin(["unknown_candidate", "product_line"])))
    )
    brands = entities[allowed].copy()
    if brands.empty:
        write_empty(args.output)
        return

    post_cols = ["mention_id", "title_clean", "text_for_display", "subreddit", "published_at", "url", "score", "num_comments"]
    posts_small = posts[[c for c in post_cols if c in posts.columns]].copy()
    merged = brands.merge(posts_small, on="mention_id", how="left")
    if len(sentiment):
        merged = merged.merge(sentiment[["mention_id", "sentiment_label", "sentiment_compound"]], on="mention_id", how="left")
    else:
        merged["sentiment_label"] = pd.NA
        merged["sentiment_compound"] = pd.NA
    if len(clusters):
        merged = merged.merge(clusters[["mention_id", "final_cluster_id", "final_cluster_name"]], on="mention_id", how="left")
    else:
        merged["final_cluster_id"] = pd.NA
        merged["final_cluster_name"] = pd.NA

    merged["brand_norm"] = merged["brand_norm"].where(merged["brand_norm"].astype(str).str.len() > 0, merged["entity_norm"])
    merged["brand_display"] = merged["brand_display"].where(merged["brand_display"].astype(str).str.len() > 0, merged["entity_text"])
    merged["title"] = merged.get("title_clean", "")
    merged["text_snippet"] = merged.get("text_for_display", "").fillna("").map(snippet)
    score = pd.to_numeric(merged.get("score", 0), errors="coerce").fillna(0)
    comments = pd.to_numeric(merged.get("num_comments", 0), errors="coerce").fillna(0)
    merged["engagement_score"] = score + comments
    merged["google_search_url"] = merged["google_search_url"].where(
        merged["google_search_url"].astype(str).str.len() > 0,
        merged["brand_display"].map(google_brand_url),
    )

    for col in OUTPUT_COLUMNS:
        if col not in merged.columns:
            merged[col] = ""
    out = merged[OUTPUT_COLUMNS].drop_duplicates(["brand_norm", "mention_id"])
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    log.info("Wrote %d brand-post index rows", len(out))


if __name__ == "__main__":
    main()
