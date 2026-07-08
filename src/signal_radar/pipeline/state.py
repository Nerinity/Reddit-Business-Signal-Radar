"""Small JSON state helpers for scheduled scraping.

The state is intentionally human-readable and scoped by source/subreddit/window.
Daily live sources should never use a permanent "done subreddit" flag, because
each daily run must rescan the current event-time window.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_json_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def update_source_state(
    state: dict[str, Any],
    *,
    source: str,
    subreddit: str,
    window_start: str,
    window_end: str,
    new_records: int,
    status: str,
    error: str = "",
) -> None:
    source_state = state.setdefault(source, {})
    source_state[subreddit] = {
        "last_success_at": utc_now_iso() if status == "success" else source_state.get(subreddit, {}).get("last_success_at"),
        "last_window_start": window_start,
        "last_window_end": window_end,
        "last_new_records": int(new_records),
        "last_status": status,
        "last_error": error,
        "updated_at": utc_now_iso(),
    }
