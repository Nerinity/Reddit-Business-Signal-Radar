# Reddit Product Trend Radar Next App

This is the formal React / Next.js product frontend for Reddit Business Signal Radar.

The older `apps/web/` folder is a static prototype snapshot. Keep it for quick visual iteration, but use this app for the long-term product frontend.

## Data

The app reads:

```text
apps/next/public/data/dashboard.json
```

Refresh the bundle from processed parquet outputs:

```bash
python3 scripts/sync_product_app_data.py
```

That command also refreshes the static prototype bundle:

```text
apps/web/public/data/dashboard.json
```

It also builds compact, team-scoped, read-only exports for briefing agents:

```text
apps/next/public/data/bot/v1/manifest.json
apps/next/public/data/bot/v1/latest.json
apps/next/public/data/bot/v1/weeks/YYYY-MM-DD.json
```

Each team export contains its overall trend-score Top 5 plus one unique category
highlight for momentum, cross-community spread, sentiment, and engagement. Every
selected category includes the app's mixed brand/keyword Top 50 and a link to its
existing evidence bundle.

## Run

From the repository root:

```bash
python3 scripts/run_product_app.py --install
```

The app runs on:

```text
http://127.0.0.1:4175
```

You can also run directly inside this folder:

```bash
npm install
npm run dev
```

## Build

From the repository root:

```bash
python3 scripts/run_product_app.py build
```

Start the production build:

```bash
python3 scripts/run_product_app.py start --skip-data-sync
```
