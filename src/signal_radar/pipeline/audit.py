"""Append-only scrape audit table helpers."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


AUDIT_COLUMNS = [
    "run_id",
    "source",
    "subreddit",
    "sort",
    "window_start",
    "window_end",
    "pages_attempted",
    "records_seen",
    "records_new",
    "records_duplicate",
    "records_written",
    "http_200_count",
    "http_429_count",
    "http_403_count",
    "http_404_count",
    "timeout_count",
    "error_count",
    "last_error_type",
    "last_error_message",
    "started_at",
    "finished_at",
    "duration_sec",
    "status",
]


def append_audit_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(rows)
    for col in AUDIT_COLUMNS:
        if col not in frame.columns:
            frame[col] = None
    frame = frame[AUDIT_COLUMNS]
    if path.exists():
        old = pd.read_parquet(path)
        frame = pd.concat([old, frame], ignore_index=True)
    frame.to_parquet(path, index=False)
