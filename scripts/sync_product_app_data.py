#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WEB_OUTPUT = "apps/web/public/data/dashboard.json"
DEFAULT_NEXT_OUTPUT = "apps/next/public/data/dashboard.json"


def run_command(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build and sync the dashboard JSON bundle for both the static prototype and the Next.js app."
    )
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--web-output", default=DEFAULT_WEB_OUTPUT)
    parser.add_argument("--next-output", default=DEFAULT_NEXT_OUTPUT)
    args = parser.parse_args()

    command = [
        sys.executable,
        "scripts/build_web_dashboard_bundle.py",
        "--processed-dir",
        args.processed_dir,
        "--output",
        args.web_output,
        "--next-output",
        args.next_output,
    ]
    run_command(command)


if __name__ == "__main__":
    main()
