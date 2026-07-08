# Reddit Business Signal Radar

Long-running Reddit data product for detecting business, product, brand, and consumer-demand signals.

This repository is structured as production infrastructure, not a one-off dashboard demo:

- **Live collection**: Reddit JSON/RSS scans recent event-time windows every day.
- **Weekly backfill**: Arctic Shift re-scans the finalized prior week after archive lag settles.
- **Append-only raw data**: raw batches are written as parquet and never mutated in place.
- **Observable runs**: every source/subreddit/window writes audit rows and JSON state.
- **Dashboard artifacts**: product apps should read prebuilt bundles, not raw crawler output.
- **Product taxonomy**: `configs/taxonomy/product_taxonomy.csv` contains 225 active category labels; `NULL` labels are excluded.

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
python3 scripts/pipeline.py daily-live --days-back 2 --sources reddit_json,rss
python3 scripts/pipeline.py weekly-backfill --week 2026-W28 --sources arctic
python3 scripts/pipeline.py weekly-publish --skip-scrape
```

Direct crawler entrypoint:

```bash
python3 scripts/scrape_reddit.py \
  --mode daily-live \
  --start 2026-07-07 \
  --end 2026-07-08 \
  --sources reddit_json,rss \
  --per-sub 80 \
  --max-pages-per-sort 3
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

- Daily: `reddit_json,rss`
- Weekly backfill: `arctic`
- Deprecated / not default: Hacker News, Google News

## Git Policy

The repository should keep code, configs, docs, and lightweight dashboard artifacts only. Large raw data, processed parquet files, embeddings, and model outputs should stay out of git unless explicitly promoted as small shareable artifacts.
