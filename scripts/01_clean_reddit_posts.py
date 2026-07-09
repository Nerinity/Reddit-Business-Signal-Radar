#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import (
    BOT_AUTHOR_RE,
    DELETED_VALUES,
    MEGATHREAD_RE,
    SPAM_TEMPLATE_RE,
    clean_readable_text,
    clean_token_text,
    content_hash,
    detect_language,
    ensure_parent,
    safe_read_table,
    top_counts,
    write_json,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("clean_reddit_posts")


def col(df: pd.DataFrame, name: str, default: object = "") -> pd.Series:
    return df[name] if name in df.columns else pd.Series([default] * len(df), index=df.index)


def choose_text(df: pd.DataFrame) -> pd.Series:
    text = col(df, "text", "").fillna("").astype(str)
    selftext = col(df, "selftext", "").fillna("").astype(str)
    return text.where(text.str.strip().ne(""), selftext)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/raw/reddit_posts.parquet")
    parser.add_argument("--output", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--report", default="data/processed/clean_reddit_posts_quality_report.json")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    df = safe_read_table(Path(args.input))
    if args.sample:
        df = df.head(args.sample).copy()
    raw_count = len(df)
    log.info("Loaded %d raw posts", raw_count)

    out = pd.DataFrame(index=df.index)
    out["mention_id"] = col(df, "mention_id", "").astype(str)
    missing_id = out["mention_id"].str.strip().eq("") | out["mention_id"].isin(["nan", "None"])
    out.loc[missing_id, "mention_id"] = [
        f"generated_{content_hash(t, x, i)}"
        for i, (t, x) in enumerate(zip(col(df, "title", ""), choose_text(df)))
    ]

    out["title_raw"] = col(df, "title", "").fillna("").astype(str)
    out["text_raw"] = choose_text(df)
    out["subreddit"] = col(df, "subreddit", col(df, "community", "")).fillna("").astype(str)
    out["published_at"] = pd.to_datetime(
        col(df, "published_at", col(df, "created_at", "")), utc=True, errors="coerce"
    )
    out["score"] = pd.to_numeric(col(df, "score", col(df, "engagement_score", 0)), errors="coerce").fillna(0)
    out["num_comments"] = pd.to_numeric(col(df, "num_comments", 0), errors="coerce").fillna(0)
    out["url"] = col(df, "url", "").fillna("").astype(str)
    out["author"] = col(df, "author", "").fillna("").astype(str)

    out["title_clean"] = out["title_raw"].map(clean_readable_text)
    out["text_clean"] = out["text_raw"].map(clean_readable_text)
    combined = (out["title_clean"] + ". " + out["text_clean"]).str.strip()
    out["content_hash"] = [content_hash(t, x) for t, x in zip(out["title_clean"], out["text_clean"])]
    out["text_length"] = combined.str.len()
    out["language"] = combined.map(detect_language)
    out["is_english"] = out["language"].eq("en")
    deleted = out["text_raw"].fillna("").astype(str).str.strip().str.lower().isin(DELETED_VALUES)
    deleted |= out["title_raw"].fillna("").astype(str).str.strip().str.lower().isin(DELETED_VALUES)
    out["is_bot"] = out["author"].fillna("").str.contains(BOT_AUTHOR_RE)
    out["is_spam_like"] = combined.str.contains(SPAM_TEMPLATE_RE, na=False)
    out["is_megathread"] = out["title_clean"].str.contains(MEGATHREAD_RE, na=False)
    out["is_valid_text"] = (
        out["is_english"]
        & ~deleted
        & ~out["is_bot"]
        & ~out["is_spam_like"]
        & (out["text_length"] >= 20)
    )

    out["text_for_display"] = combined
    out["text_for_embedding"] = [
        f"Reddit post: {title}. {text[:800]}. Subreddit: {sub}."
        for title, text, sub in zip(out["title_clean"], out["text_clean"], out["subreddit"])
    ]
    out["text_for_sentiment"] = combined
    out["text_for_tokenization"] = combined.map(clean_token_text)
    out["text_for_brand_matching"] = combined

    duplicate_mask = out.duplicated("mention_id", keep="first") | out.duplicated("content_hash", keep="first")
    valid = out[out["is_valid_text"] & ~duplicate_mask].copy()

    ordered = [
        "mention_id", "title_raw", "text_raw", "title_clean", "text_clean", "text_for_display",
        "text_for_embedding", "text_for_sentiment", "text_for_tokenization", "text_for_brand_matching",
        "subreddit", "published_at", "score", "num_comments", "url", "author", "language",
        "is_english", "is_valid_text", "is_bot", "is_spam_like", "is_megathread", "content_hash", "text_length",
    ]
    ensure_parent(Path(args.output))
    valid[ordered].to_parquet(args.output, index=False)
    report = {
        "raw_post_count": int(raw_count),
        "valid_post_count": int(len(valid)),
        "dropped_non_english_count": int((~out["is_english"]).sum()),
        "dropped_deleted_removed_count": int(deleted.sum()),
        "dropped_empty_count": int((out["text_length"] < 20).sum()),
        "dropped_duplicate_count": int(duplicate_mask.sum()),
        "language_distribution": out["language"].value_counts(dropna=False).to_dict(),
        "top_subreddits": top_counts(valid["subreddit"], 20),
        "average_text_length": float(valid["text_length"].mean()) if len(valid) else 0.0,
        "median_text_length": float(valid["text_length"].median()) if len(valid) else 0.0,
    }
    write_json(Path(args.report), report)
    log.info("Wrote %d clean posts -> %s", len(valid), args.output)


if __name__ == "__main__":
    main()
