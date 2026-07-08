# Architecture

The product is split into four layers:

1. **Source collection**
   Reddit JSON/RSS handle recent live data. Arctic Shift handles finalized weekly backfill after archive lag.

2. **Raw storage**
   Raw records are append-only parquet batches. They are deduped by `mention_id` at write/read boundaries, but source batches are not mutated.

3. **Signal processing**
   NLP, taxonomy assignment, entity extraction, trend scoring, and forecasting create processed artifacts.

4. **Product surfaces**
   Dashboards and reports read processed bundles. They should not call crawler code or scan raw partitions directly.

## Time Model

Business metrics use event time:

- `published_at`
- `event_date`

Pipeline monitoring uses ingestion time:

- `collected_at`
- `ingestion_date`

This separation matters because Arctic Shift can lag by 1-3 days.
