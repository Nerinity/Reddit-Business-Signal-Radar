#!/usr/bin/env python3
"""Scheduled orchestration for the Reddit Business Signal Radar pipeline.

Modes:
  daily-live       Scan recent event-time posts via live Reddit JSON/RSS.
  weekly-backfill  Re-scan the finalized prior week via Arctic Shift.
  weekly-publish   Optionally backfill, then rebuild NLP/dashboard artifacts.

Trend windows should be based on published_at/event_date. collected_at and
ingestion_date are for ingestion monitoring only.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / "data" / "state"
LOG_DIR = ROOT / "data" / "logs"
LOCK_FILE = STATE_DIR / "pipeline.lock"
STATE_FILE = STATE_DIR / "pipeline_state.json"
PUBLISH_SCRIPT = ROOT / "scripts" / "publish_streamlit_snapshot.py"

DEFAULT_DAILY_SOURCES = "reddit_json,rss"
DEFAULT_BACKFILL_SOURCES = "arctic"
DEFAULT_DATA_WORKSPACE = Path(os.environ.get("TREND_DATA_WORKSPACE", ROOT)).expanduser()
STREAMLIT_ARTIFACTS = [
    "dashboard_data_500k.pkl",
    "brand_posts_index.pkl",
    "forecast_data.pkl",
    "cluster_brand_labels.csv",
    "target_cluster_ids.txt",
]

log = logging.getLogger("signal_radar_pipeline")


def setup_logging(command: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{command}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_path)],
    )
    return log_path


@contextmanager
def pipeline_lock():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        fd = LOCK_FILE.open("x")
    except FileExistsError as exc:
        raise SystemExit(f"Pipeline is already running: {LOCK_FILE}") from exc
    try:
        fd.write(json.dumps({"pid": "local", "started_at_utc": datetime.now(timezone.utc).isoformat()}))
        fd.close()
        yield
    finally:
        LOCK_FILE.unlink(missing_ok=True)


def run(cmd: list[str], label: str, cwd: Path = ROOT) -> None:
    log.info("▶ %s", label)
    log.info("  %s", " ".join(cmd))
    t0 = time.time()
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(f"{label} failed with exit code {result.returncode}")
    log.info("✓ %s done in %.1f min", label, (time.time() - t0) / 60)


def workspace_path(args: argparse.Namespace) -> Path:
    return Path(args.data_workspace).expanduser().resolve()


def script_path(workspace: Path, script_name: str) -> Path:
    path = workspace / "scripts" / script_name
    if not path.exists():
        raise FileNotFoundError(f"Missing script in data workspace: {path}")
    return path


def write_state(command: str, status: str, extra: dict | None = None) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state = {
        "command": command,
        "status": status,
        "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def live_window(days_back: int) -> tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=days_back)).isoformat(), today.isoformat()


def previous_week_window() -> tuple[str, str, str]:
    today = datetime.now(timezone.utc).date()
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)
    end = this_monday - timedelta(days=1)
    week = start.strftime("%G-W%V")
    return start.isoformat(), end.isoformat(), week


def parse_week(week: str) -> tuple[str, str, str]:
    monday = datetime.strptime(week + "-1", "%G-W%V-%u").date()
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat(), week


def scraper_cmd(
    *,
    workspace: Path,
    mode: str,
    start: str,
    end: str,
    sources: str,
    per_sub: int,
    delay: float,
    max_pages_per_sort: int,
    sorts: str,
    safety_cap: int,
    max_subreddits: int,
    refresh_legacy_csv: bool,
) -> list[str]:
    cmd = [
        sys.executable,
        str(script_path(workspace, "scrape_reddit.py")),
        "--mode",
        mode,
        "--start",
        start,
        "--end",
        end,
        "--sources",
        sources,
        "--per-sub",
        str(per_sub),
        "--delay",
        str(delay),
        "--max-pages-per-sort",
        str(max_pages_per_sort),
        "--sorts",
        sorts,
        "--safety-cap",
        str(safety_cap),
        "--max-subreddits",
        str(max_subreddits),
    ]
    if refresh_legacy_csv:
        cmd.append("--refresh-legacy-csv")
    return cmd


def daily_live(args: argparse.Namespace) -> None:
    workspace = workspace_path(args)
    start, end = live_window(args.days_back)
    run(
        scraper_cmd(
            workspace=workspace,
            mode="daily-live",
            start=start,
            end=end,
            sources=args.sources,
            per_sub=args.per_sub,
            delay=args.delay,
            max_pages_per_sort=args.max_pages_per_sort,
            sorts=args.sorts,
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
            refresh_legacy_csv=args.refresh_legacy_csv,
        ),
        f"daily live scrape ({start} → {end})",
        cwd=workspace,
    )
    write_state(
        "daily-live",
        "success",
        {"start": start, "end": end, "sources": args.sources, "data_workspace": str(workspace)},
    )


def weekly_backfill(args: argparse.Namespace) -> tuple[str, str, str]:
    workspace = workspace_path(args)
    if getattr(args, "week", ""):
        start, end, week = parse_week(args.week)
    else:
        start, end, week = previous_week_window()
    run(
        scraper_cmd(
            workspace=workspace,
            mode="weekly-backfill",
            start=start,
            end=end,
            sources=args.sources,
            per_sub=args.per_sub,
            delay=args.delay,
            max_pages_per_sort=args.max_pages_per_sort,
            sorts="new",
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
            refresh_legacy_csv=args.refresh_legacy_csv,
        ),
        f"weekly Arctic backfill {week} ({start} → {end})",
        cwd=workspace,
    )
    write_state(
        "weekly-backfill",
        "success",
        {"week": week, "start": start, "end": end, "sources": args.sources, "data_workspace": str(workspace)},
    )
    return start, end, week


def sync_streamlit_artifacts(workspace: Path) -> None:
    src_dir = workspace / "data" / "processed"
    dst_dir = ROOT / "data" / "processed"
    dst_dir.mkdir(parents=True, exist_ok=True)

    missing = []
    for name in STREAMLIT_ARTIFACTS:
        src = src_dir / name
        if not src.exists():
            if name in {"dashboard_data_500k.pkl", "brand_posts_index.pkl"}:
                missing.append(str(src))
            continue
        shutil.copy2(src, dst_dir / name)

    archive_src = src_dir / "archive"
    archive_dst = dst_dir / "archive"
    if archive_src.exists():
        archive_dst.mkdir(parents=True, exist_ok=True)
        for name in ["dashboard_weekly_archive.pkl", "dashboard_weekly_archive.csv"]:
            src = archive_src / name
            if src.exists():
                shutil.copy2(src, archive_dst / name)

    if missing:
        raise FileNotFoundError("Missing required Streamlit artifacts: " + ", ".join(missing))
    log.info("Synced Streamlit artifacts from %s → %s", src_dir, dst_dir)


def weekly_publish(args: argparse.Namespace) -> None:
    workspace = workspace_path(args)
    backfill_week = None
    if not args.skip_scrape:
        backfill_args = argparse.Namespace(
            data_workspace=args.data_workspace,
            week=args.week,
            sources=args.backfill_sources,
            per_sub=args.backfill_per_sub,
            delay=args.delay,
            max_pages_per_sort=args.backfill_max_pages_per_sort,
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
            refresh_legacy_csv=True,
        )
        _, _, backfill_week = weekly_backfill(backfill_args)

    if args.refresh_legacy_csv and args.skip_scrape:
        run(
            [
                sys.executable,
                str(script_path(workspace, "scrape_reddit.py")),
                "--mode",
                "manual",
                "--start",
                datetime.now(timezone.utc).date().isoformat(),
                "--end",
                datetime.now(timezone.utc).date().isoformat(),
                "--sources",
                "",
                "--refresh-legacy-csv",
            ],
            "refresh raw CSV compatibility view",
            cwd=workspace,
        )

    run([sys.executable, str(script_path(workspace, "run_nlp_update.py")), "--mode", "incremental"], "incremental NLP update", cwd=workspace)
    run([sys.executable, str(script_path(workspace, "build_dashboard_bundle.py"))], "dashboard bundle build", cwd=workspace)

    if not args.skip_forecast:
        log.info("Forecast build is not wired yet in this product scaffold; skipping.")

    sync_streamlit_artifacts(workspace)

    publish_cmd = [sys.executable, str(PUBLISH_SCRIPT), "--commit"]
    if args.push:
        publish_cmd.append("--push")
    run(publish_cmd, "publish Streamlit snapshot")

    write_state(
        "weekly-publish",
        "success",
        {
            "data_workspace": str(workspace),
            "backfilled_week": backfill_week,
            "pushed_to_github": bool(args.push),
            "forecast_updated": not args.skip_forecast,
        },
    )


def add_common_scrape_args(parser: argparse.ArgumentParser, *, daily: bool) -> None:
    parser.add_argument("--data-workspace", default=str(DEFAULT_DATA_WORKSPACE), help="Workspace containing raw/parquet/embedding files.")
    parser.add_argument("--sources", default=DEFAULT_DAILY_SOURCES if daily else DEFAULT_BACKFILL_SOURCES)
    parser.add_argument("--per-sub", type=int, default=80 if daily else 500)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--max-pages-per-sort", type=int, default=3 if daily else 20)
    parser.add_argument("--safety-cap", type=int, default=75_000 if daily else 250_000)
    parser.add_argument("--max-subreddits", type=int, default=0, help="Debug/smoke cap on subreddit count (0 = all).")
    parser.add_argument("--refresh-legacy-csv", action="store_true", help="Refresh data/raw/scraped_2026_large.csv compatibility view.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run scheduled Reddit Business Signal Radar pipeline tasks.")
    sub = parser.add_subparsers(dest="command", required=True)

    daily = sub.add_parser("daily-live", help="Collect live Reddit JSON/RSS for recent event dates.")
    add_common_scrape_args(daily, daily=True)
    daily.add_argument("--days-back", type=int, default=2)
    daily.add_argument("--sorts", default="new,hot", help="Daily default avoids top because top can pull older posts.")

    legacy_daily = sub.add_parser("daily-scrape", help="Backward-compatible alias for daily-live.")
    add_common_scrape_args(legacy_daily, daily=True)
    legacy_daily.add_argument("--days-back", type=int, default=2)
    legacy_daily.add_argument("--sorts", default="new,hot")

    backfill = sub.add_parser("weekly-backfill", help="Backfill finalized prior week with Arctic Shift.")
    add_common_scrape_args(backfill, daily=False)
    backfill.add_argument("--week", default="", help="ISO week like 2026-W28. Defaults to previous complete week.")

    weekly = sub.add_parser("weekly-publish", help="Backfill, update NLP/dashboard, publish Streamlit artifacts.")
    weekly.add_argument("--data-workspace", default=str(DEFAULT_DATA_WORKSPACE))
    weekly.add_argument("--week", default="", help="ISO week to backfill before publish. Defaults to previous complete week.")
    weekly.add_argument("--backfill-sources", default=DEFAULT_BACKFILL_SOURCES)
    weekly.add_argument("--backfill-per-sub", type=int, default=500)
    weekly.add_argument("--backfill-max-pages-per-sort", type=int, default=20)
    weekly.add_argument("--delay", type=float, default=1.5)
    weekly.add_argument("--safety-cap", type=int, default=250_000)
    weekly.add_argument("--max-subreddits", type=int, default=0, help="Debug/smoke cap on subreddit count (0 = all).")
    weekly.add_argument("--skip-scrape", action="store_true", help="Skip weekly Arctic backfill and process existing raw data.")
    weekly.add_argument("--refresh-legacy-csv", action="store_true", help="Refresh compatibility CSV even when --skip-scrape is used.")
    weekly.add_argument("--skip-forecast", action="store_true")
    weekly.add_argument("--push", action="store_true")

    args = parser.parse_args()
    if args.command == "daily-scrape":
        args.command = "daily-live"
    log_path = setup_logging(args.command)
    log.info("Log file: %s", log_path)

    with pipeline_lock():
        try:
            if args.command == "daily-live":
                daily_live(args)
            elif args.command == "weekly-backfill":
                weekly_backfill(args)
            elif args.command == "weekly-publish":
                weekly_publish(args)
        except Exception:
            write_state(args.command, "failed")
            raise


if __name__ == "__main__":
    main()
