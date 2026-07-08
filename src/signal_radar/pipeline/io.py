"""Raw data IO helpers for the lightweight incremental pipeline."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd


RAW_COLUMNS = [
    "ingestion_run_id",
    "source",
    "platform",
    "sub_source",
    "source_type",
    "reddit_id",
    "source_record_id",
    "mention_id",
    "canonical_url",
    "url",
    "keyword",
    "query",
    "category",
    "title",
    "text",
    "full_text",
    "author",
    "community",
    "published_at",
    "collected_at",
    "event_date",
    "ingestion_date",
    "engagement_score",
    "semantic_relevance_score",
    "tiktok_relevance_score",
    "business_context_label",
    "collector_priority_score",
    "metrics_json",
]


def _raw_parquet_files(raw_dir: Path) -> list[Path]:
    roots = [raw_dir / "daily", raw_dir / "backfill", raw_dir / "reddit"]
    files: list[Path] = []
    for root in roots:
        if root.exists():
            files.extend(sorted(root.rglob("*.parquet")))
    return files


def load_existing_mention_ids(raw_dir: Path, legacy_csv: Path | None = None) -> set[str]:
    ids: set[str] = set()
    if legacy_csv and legacy_csv.exists():
        try:
            ids.update(pd.read_csv(legacy_csv, usecols=["mention_id"], low_memory=False)["mention_id"].dropna().astype(str))
        except Exception:
            pass
    for path in _raw_parquet_files(raw_dir):
        try:
            ids.update(pd.read_parquet(path, columns=["mention_id"])["mention_id"].dropna().astype(str))
        except Exception:
            continue
    return ids


def load_raw_records(raw_dir: Path, legacy_csv: Path | None = None) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    if legacy_csv and legacy_csv.exists():
        frames.append(pd.read_csv(legacy_csv, low_memory=False))
    for path in _raw_parquet_files(raw_dir):
        try:
            frames.append(pd.read_parquet(path))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame(columns=RAW_COLUMNS)
    out = pd.concat(frames, ignore_index=True, sort=False)
    if "mention_id" in out.columns:
        out["mention_id"] = out["mention_id"].astype(str)
        out = out.drop_duplicates(subset=["mention_id"], keep="last")
    return out


def write_raw_parquet(
    *,
    records: Iterable[dict],
    raw_dir: Path,
    run_id: str,
    source: str,
    mode: str,
    window_start: str,
) -> Path | None:
    frame = pd.DataFrame(list(records))
    if frame.empty:
        return None
    for col in RAW_COLUMNS:
        if col not in frame.columns:
            frame[col] = None
    frame = frame[RAW_COLUMNS]
    frame["mention_id"] = frame["mention_id"].astype(str)
    frame = frame.drop_duplicates(subset=["mention_id"], keep="last")

    if "backfill" in mode:
        week = pd.Timestamp(window_start).strftime("%G-W%V")
        out_dir = raw_dir / "backfill" / week
        filename = f"{source}_{run_id}.parquet"
    else:
        out_dir = raw_dir / "daily" / window_start
        filename = f"{source}_{run_id}.parquet"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename
    frame.to_parquet(out_path, index=False)
    return out_path


def refresh_legacy_raw_csv(raw_dir: Path, legacy_csv: Path) -> int:
    """Build a deduped CSV view for older downstream scripts.

    New writes are parquet-first. This compatibility view lets older processing
    jobs keep working while the processing layer is migrated at its own pace.
    """
    frame = load_raw_records(raw_dir, legacy_csv if legacy_csv.exists() else None)
    if frame.empty:
        return 0
    legacy_csv.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(legacy_csv, index=False)
    return len(frame)


def iso_to_date(value: str) -> str:
    try:
        return pd.to_datetime(value, utc=True).date().isoformat()
    except Exception:
        return ""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
