#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import pyarrow.parquet as pq


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WEB_OUTPUT_DIR = "apps/web/public/data"
DEFAULT_NEXT_OUTPUT_DIR = "apps/next/public/data"
KEYWORD_INDEX_REQUIRED_COLUMNS = {
    "week_start", "cluster_id", "cluster_name", "term_norm", "term_display", "entity_type",
    "post_key", "post_id", "url", "subreddit", "published_at", "title", "text_snippet",
    "context_window", "mention_count_in_post", "sentiment_compound", "sentiment_label",
    "assignment_confidence", "cluster_usage_tier", "assignment_status",
    "entity_matched_cluster_id", "entity_matched_cluster_name",
}


def run_command(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def validate_keyword_post_index(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing required pipeline artifact: {path}. Run scripts/11_build_cluster_entity_metrics.py first."
        )
    parquet = pq.ParquetFile(path)
    if parquet.metadata.num_rows <= 0:
        raise RuntimeError(f"Required pipeline artifact is empty: {path}")
    columns = set(parquet.schema.names)
    missing = sorted(KEYWORD_INDEX_REQUIRED_COLUMNS - columns)
    if missing:
        raise RuntimeError(f"keyword_post_index.parquet is missing required columns: {', '.join(missing)}")


def validate_ops_mapping(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing operations mapping: {path}. Run scripts/build_ops_team_category_mapping.py first."
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload.get("version"), int) or not payload.get("ops_teams") or not payload.get("pairs"):
        raise RuntimeError(f"Invalid operations mapping contract: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build and sync the dashboard JSON bundle for both the static prototype and the Next.js app."
    )
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--web-output-dir", default=DEFAULT_WEB_OUTPUT_DIR)
    parser.add_argument("--next-output-dir", default=DEFAULT_NEXT_OUTPUT_DIR)
    args = parser.parse_args()
    processed_dir = (REPO_ROOT / args.processed_dir).resolve()
    validate_keyword_post_index(processed_dir / "keyword_post_index.parquet")
    validate_ops_mapping(REPO_ROOT / "apps/next/public/data/ops-team-category-mapping.json")

    command = [
        sys.executable,
        "scripts/build_web_dashboard_bundle.py",
        "--processed-dir",
        args.processed_dir,
        "--output-dir",
        args.web_output_dir,
        "--next-output-dir",
        args.next_output_dir,
    ]
    run_command(command)
    run_command([sys.executable, "scripts/build_bot_signal_export.py"])


if __name__ == "__main__":
    main()
