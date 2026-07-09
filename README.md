# Reddit Business Signal Radar

Long-running Reddit data product for detecting business, product, brand, and consumer-demand signals.

This repository is structured as production infrastructure, not a one-off dashboard demo:

- **Live collection**: Reddit RSS scans recent event-time windows every day as a provisional signal layer.
- **Weekly backfill**: Arctic Shift re-scans the finalized prior week after archive lag settles.
- **Append-only raw data**: raw batches are written as parquet and never mutated in place.
- **Observable runs**: every source/subreddit/window writes audit rows and JSON state.
- **Dashboard artifacts**: product apps should read prebuilt bundles, not raw crawler output.
- **Product taxonomy**: `configs/taxonomy/product_taxonomy.csv` contains active category labels; `NULL` labels are excluded.

## Repository Layout

```text
configs/                 Source, pipeline, taxonomy, and scoring config
src/signal_radar/         Importable product package
scripts/                 Operator-friendly command entrypoints
apps/dashboard/           Streamlit dashboard app shell
data/                    Local-only raw/processed/audit/state/exports
docs/                    Architecture, data contracts, and operations notes
tests/                   Unit and integration tests
```

## Core Commands

```bash
python3 scripts/pipeline.py daily-live --days-back 2 --sources rss
python3 scripts/pipeline.py weekly-backfill --week 2026-W28 --sources arctic
python3 scripts/pipeline.py weekly-publish --skip-scrape
```

Direct crawler entrypoint:

```bash
python3 scripts/scrape_reddit.py \
  --mode daily-live \
  --start 2026-07-07 \
  --end 2026-07-08 \
  --sources rss \
  --per-sub 80 \
  --max-pages-per-sort 1
```

Daily example with explicit optional JSON fallback:

```bash
python3 scripts/pipeline.py daily-live \
  --days-back 2 \
  --sources reddit_json,rss \
  --sorts new,hot \
  --per-sub 80 \
  --max-pages-per-sort 1 \
  --refresh-legacy-csv
```

## Data Time Semantics

Trend windows use Reddit event time:

- `published_at`
- `event_date`

Operations and monitoring use ingestion time:

- `collected_at`
- `ingestion_date`

Do not compute business trend windows from `collected_at`.

## Local Data Outputs

Raw parquet:

```text
data/raw/daily/YYYY-MM-DD/{source}_{run_id}.parquet
data/raw/backfill/YYYY-WW/{source}_{run_id}.parquet
```

Audit table:

```text
data/audit/scrape_source_status.parquet
```

State:

```text
data/state/scrape_source_state.json
```

## Source Defaults

- Daily: `rss`
- Weekly backfill: `arctic`
- Optional but disabled by default due to frequent HTTP 403: `reddit_json`
- Deprecated / not default: Hacker News, Google News

## Data Source Semantics

Daily live collection currently uses Reddit RSS by default because Reddit JSON endpoints frequently return HTTP 403. RSS provides lightweight, low-cost incremental coverage for recent posts and early trend detection.

Weekly Arctic Shift backfill is used to recover missed posts and produce finalized weekly trend metrics.

Reddit JSON collection remains implemented and available as an optional explicit source, but it is not enabled by default.

## NLP Signal Pipeline

The NLP layer turns collected Reddit posts into product-facing signal tables:

```bash
python3 scripts/run_nlp_signal_pipeline.py
```

The pipeline cleans Reddit post text, cleans internal product/category reference data, builds second-category cluster profiles, creates a whitelist brand registry, extracts tokens and phrases, runs sentiment, separates brands from product/category/need-state entities, matches posts to internal clusters, and builds a brand-to-post lookup index.

Core outputs are written under `data/processed/`, including:

```text
clean_reddit_posts.parquet
clean_internal_products.parquet
cluster_profiles_226.parquet
brand_registry.parquet
entity_mentions.parquet
cluster_assignments.parquet
brand_post_index.parquet
weekly_brand_metrics.parquet
weekly_cluster_metrics.parquet
weekly_trend_terms.parquet
```

The main product contract is that a dashboard can show whether a detected brand is an in-platform whitelist brand, attach sentiment and cluster context, and query back to the original Reddit posts mentioning that brand.

Optional NLP dependencies are handled defensively:

- If `sentence-transformers` or the configured embedding model is unavailable, cluster matching falls back to TF-IDF, then bag-of-words, and records the selected method in `data/processed/cluster_matching_similarity_report.json`.
- If VADER is unavailable, sentiment falls back to phrase-count scoring.
- If spaCy or `en_core_web_sm` is unavailable, tokenization and phrase extraction fall back to regex tokenization and n-grams.

## Git Policy

The repository should keep code, configs, docs, and lightweight dashboard artifacts only. Large raw data, processed parquet files, embeddings, and model outputs should stay out of git unless explicitly promoted as small shareable artifacts.
