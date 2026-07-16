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


def exists(path: str) -> bool:
    return (ROOT / path).exists()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Reddit NLP signal pipeline.")
    parser.add_argument("--skip-cleaning", action="store_true")
    parser.add_argument("--skip-internal", action="store_true")
    parser.add_argument("--skip-tokenization", action="store_true")
    parser.add_argument("--skip-sentiment", action="store_true")
    parser.add_argument("--skip-entities", action="store_true")
    parser.add_argument("--skip-cluster-matching", action="store_true")
    parser.add_argument("--skip-brand-index", action="store_true")
    parser.add_argument("--skip-weekly-metrics", action="store_true")
    parser.add_argument("--skip-cluster-entity-metrics", action="store_true")
    parser.add_argument("--skip-cluster-scores", action="store_true")
    parser.add_argument("--include-weak-matches", action="store_true")
    parser.add_argument(
        "--reddit-sample", type=int, default=0,
        help="Smoke-test cap on Reddit posts only. Does not affect brand/product reference data.",
    )
    parser.add_argument(
        "--brand-sample", type=int, default=0,
        help="Debug cap on brand source rows (whitelist CSV + full-domain catalog XLSX). "
             "0 = build the full registry, which is the default for a reason: these are reference "
             "catalogs, not something a Reddit smoke test should be truncating.",
    )
    parser.add_argument(
        "--product-sample", type=int, default=0,
        help="Debug cap on internal product/category reference rows. 0 = full (default).",
    )
    args = parser.parse_args()

    reddit_sample_args = ["--sample", str(args.reddit_sample)] if args.reddit_sample else []
    brand_sample_args = ["--sample", str(args.brand_sample)] if args.brand_sample else []
    product_sample_args = ["--sample", str(args.product_sample)] if args.product_sample else []

    if not args.skip_cleaning:
        run("01_clean_reddit_posts.py", reddit_sample_args)
    if not args.skip_internal:
        run("02_clean_internal_reference.py", product_sample_args)
        run("03_build_cluster_profiles.py")
        run("04_build_brand_registry.py", brand_sample_args)
    if not args.skip_tokenization:
        run("05_tokenize_and_extract_phrases.py", reddit_sample_args)
    if not args.skip_sentiment:
        run("06_run_sentiment.py", reddit_sample_args)
    if not args.skip_entities:
        run("07_extract_entities.py", reddit_sample_args)
    if not args.skip_cluster_matching:
        run("08_match_226_clusters.py", reddit_sample_args)
    if not args.skip_brand_index:
        if args.skip_entities and not exists("data/processed/entity_mentions.parquet"):
            log.warning("Skipping brand index because entity extraction was skipped and entity_mentions.parquet is missing")
        else:
            run("09_build_brand_post_index.py", reddit_sample_args)
    if not args.skip_weekly_metrics:
        run("10_build_weekly_metrics.py")
    if not args.skip_cluster_entity_metrics:
        weak_args = ["--include-weak-matches"] if args.include_weak_matches else []
        run("11_build_cluster_entity_metrics.py", weak_args)
        if not exists("data/processed/keyword_post_index.parquet"):
            raise RuntimeError("Cluster entity metrics stage did not produce keyword_post_index.parquet")
    if not args.skip_cluster_scores:
        weak_args = ["--include-weak-matches"] if args.include_weak_matches else []
        run("12_build_cluster_scores.py", weak_args)


if __name__ == "__main__":
    main()
