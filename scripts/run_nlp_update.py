#!/usr/bin/env python3
"""Run the canonical NLP signal pipeline used by scheduled publishing."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["incremental", "full"], default="incremental")
    args = parser.parse_args()
    if args.mode == "incremental":
        print("Running canonical signal pipeline; stages reuse existing raw inputs.")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "run_nlp_signal_pipeline.py")],
        cwd=ROOT,
        check=True,
    )


if __name__ == "__main__":
    main()
