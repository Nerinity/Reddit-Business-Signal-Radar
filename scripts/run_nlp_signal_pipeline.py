#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("nlp_signal_pipeline")


def run(script: str, extra: list[str] | None = None) -> None:
    cmd = [sys.executable, str(ROOT / "scripts" / script)]
    if extra:
        cmd.extend(extra)
    log.info("Running %s", script)
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Reddit NLP signal pipeline.")
    parser.add_argument("--skip-cleaning", action="store_true")
    parser.add_argument("--skip-internal", action="store_true")
    parser.add_argument("--skip-tokenization", action="store_true")
    parser.add_argument("--skip-sentiment", action="store_true")
    parser.add_argument("--skip-entities", action="store_true")
    parser.add_argument("--skip-cluster-matching", action="store_true")
    parser.add_argument("--skip-weekly-metrics", action="store_true")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    sample_args = ["--sample", str(args.sample)] if args.sample else []

    if not args.skip_cleaning:
        run("01_clean_reddit_posts.py", sample_args)
    if not args.skip_internal:
        run("02_clean_internal_reference.py", sample_args)
        run("03_build_cluster_profiles.py")
        run("04_build_brand_registry.py", sample_args)
    if not args.skip_tokenization:
        run("05_tokenize_and_extract_phrases.py", sample_args)
    if not args.skip_sentiment:
        run("06_run_sentiment.py", sample_args)
    if not args.skip_entities:
        run("07_extract_entities.py", sample_args)
    if not args.skip_cluster_matching:
        run("08_match_226_clusters.py", sample_args)
    run("09_build_brand_post_index.py", sample_args)
    if not args.skip_weekly_metrics:
        run("10_build_weekly_metrics.py")


if __name__ == "__main__":
    main()
