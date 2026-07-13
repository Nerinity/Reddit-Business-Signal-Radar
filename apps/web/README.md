# Reddit Product Trend Radar Web App

Formal product UI prototype for the Reddit Business Signal Radar.

## Run Locally

Build the static dashboard data bundle from processed parquet outputs:

```bash
python3 scripts/build_web_dashboard_bundle.py
```

Start a local static server:

```bash
python3 -m http.server 4174 --directory apps/web
```

Open:

```text
http://127.0.0.1:4174/
```

## Current Data Contract

The app reads:

```text
apps/web/public/data/dashboard.json
```

The bundle is generated from:

```text
data/processed/weekly_cluster_scores.parquet
data/processed/weekly_cluster_discussion_terms.parquet
data/processed/weekly_cluster_brand_mentions.parquet
data/processed/brand_post_index.parquet
```

This keeps the first formal UI version backend-free while preserving a clean path to a future API.
