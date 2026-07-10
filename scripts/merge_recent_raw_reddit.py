#!/usr/bin/env python3
"""Merge raw Reddit parquet batches into the unified NLP input file.

Reads append-only raw batches from data/raw/backfill/ and data/raw/daily/,
filters to the most recent N weeks of Reddit event time (published_at,
falling back to created_at), deduplicates, and writes a single parquet at
data/raw/reddit_posts.parquet for the NLP cleaning script. Source raw batch
files are read-only inputs and are never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, top_counts, write_json  # noqa: E402

RAW_DIR = ROOT / "data" / "raw"
BACKFILL_DIR = RAW_DIR / "backfill"
DAILY_DIR = RAW_DIR / "daily"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("merge_recent_raw_reddit")


def col(df: pd.DataFrame, name: str, default: object = "") -> pd.Series:
    if name in df.columns:
        return df[name]
    if isinstance(default, pd.Series):
        return default
    return pd.Series([default] * len(df), index=df.index)


def _stable_hash(*parts: object) -> str:
    joined = "||".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def _normalize(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def discover_raw_files() -> list[Path]:
    files: list[Path] = []
    for root in (BACKFILL_DIR, DAILY_DIR):
        if root.exists():
            files.extend(sorted(root.rglob("*.parquet")))
    return files


def load_raw_frames(files: list[Path]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for f in files:
        try:
            df = pd.read_parquet(f)
        except Exception as exc:
            log.warning("Skipping unreadable parquet %s: %s", f, exc)
            continue
        if df.empty:
            continue
        df["raw_source_file"] = str(f.relative_to(ROOT))
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True, sort=False)


def resolve_event_time(df: pd.DataFrame) -> pd.Series:
    """Prefer published_at; fall back to created_at only where published_at is missing."""
    published = pd.to_datetime(col(df, "published_at", pd.NaT), utc=True, errors="coerce")
    created = pd.to_datetime(col(df, "created_at", pd.NaT), utc=True, errors="coerce")
    return published.where(published.notna(), created)


def build_dedupe_key(df: pd.DataFrame) -> pd.Series:
    mention_id = col(df, "mention_id", "").fillna("").astype(str).str.strip()
    has_mention = mention_id.ne("") & ~mention_id.isin(["nan", "None"])

    title = col(df, "title", "").fillna("").astype(str)
    text = col(df, "text", col(df, "selftext", "")).fillna("").astype(str)
    subreddit = col(df, "subreddit", col(df, "community", "")).fillna("").astype(str)
    published = df["published_at"].astype(str)

    fallback = [
        "hash_" + _stable_hash(_normalize(t), _normalize(x), _normalize(s), _normalize(p))
        for t, x, s, p in zip(title, text, subreddit, published)
    ]
    return mention_id.where(has_mention, pd.Series(fallback, index=df.index))


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge raw Reddit parquet batches into unified NLP input.")
    parser.add_argument("--weeks", type=int, default=6, help="Number of most recent event-time weeks to include.")
    parser.add_argument("--output", default=str(RAW_DIR / "reddit_posts.parquet"))
    parser.add_argument("--report", default=str(RAW_DIR / "reddit_posts_merge_report.json"))
    parser.add_argument("--as-of", default="", help="Override 'now' for the window end (YYYY-MM-DD). Defaults to today UTC.")
    args = parser.parse_args()

    files = discover_raw_files()
    if not files:
        raise SystemExit(f"No raw parquet files found under {BACKFILL_DIR} or {DAILY_DIR}")
    log.info("Discovered %d raw parquet files", len(files))

    raw = load_raw_frames(files)
    raw_row_count = len(raw)
    log.info("Loaded %d raw rows", raw_row_count)
    if raw_row_count == 0:
        raise SystemExit("Raw parquet files were found but contained no rows.")

    raw["published_at"] = resolve_event_time(raw)
    raw["event_date"] = raw["published_at"].dt.date.astype("string")
    raw["subreddit"] = col(raw, "subreddit", col(raw, "community", "")).fillna("").astype(str)

    as_of = pd.Timestamp(args.as_of, tz="UTC") if args.as_of else pd.Timestamp.now(tz="UTC")
    window_start = as_of - pd.Timedelta(weeks=args.weeks)

    dated = raw[raw["published_at"].notna()]
    dropped_undated = raw_row_count - len(dated)
    windowed = dated[dated["published_at"] >= window_start].copy()
    dropped_out_of_window = len(dated) - len(windowed)
    log.info(
        "Window: last %d weeks (>= %s, as of %s) -> %d rows (dropped %d undated, %d out-of-window)",
        args.weeks, window_start.isoformat(), as_of.isoformat(), len(windowed), dropped_undated, dropped_out_of_window,
    )
    if windowed.empty:
        raise SystemExit("No rows fall within the requested event-time window.")

    windowed["_dedupe_key"] = build_dedupe_key(windowed)
    sort_col = "collected_at" if "collected_at" in windowed.columns else "published_at"
    windowed = windowed.sort_values(sort_col, ascending=False)
    deduped = windowed.drop_duplicates(subset="_dedupe_key", keep="first").drop(columns=["_dedupe_key"])
    deduped = deduped.sort_values("published_at").reset_index(drop=True)
    deduped_row_count = len(deduped)
    log.info("Deduplicated %d -> %d rows", len(windowed), deduped_row_count)

    ensure_parent(Path(args.output))
    deduped.to_parquet(args.output, index=False)
    log.info("Wrote %d rows -> %s", deduped_row_count, args.output)

    output_resolved = Path(args.output).resolve()
    try:
        output_path_str = str(output_resolved.relative_to(ROOT))
    except ValueError:
        output_path_str = str(output_resolved)

    subreddit_counts = deduped["subreddit"].value_counts()
    report = {
        "input_file_count": len(files),
        "raw_row_count": int(raw_row_count),
        "deduped_row_count": int(deduped_row_count),
        "dropped_undated_count": int(dropped_undated),
        "dropped_out_of_window_count": int(dropped_out_of_window),
        "dropped_duplicate_count": int(len(windowed) - deduped_row_count),
        "weeks": args.weeks,
        "window_start": window_start.isoformat(),
        "window_end": as_of.isoformat(),
        "min_published_at": deduped["published_at"].min().isoformat() if deduped_row_count else None,
        "max_published_at": deduped["published_at"].max().isoformat() if deduped_row_count else None,
        "subreddit_count": int(subreddit_counts.shape[0]),
        "top_subreddits": top_counts(deduped["subreddit"], 20),
        "output_path": output_path_str,
    }
    write_json(Path(args.report), report)
    log.info("Wrote merge report -> %s", args.report)


if __name__ == "__main__":
    main()
