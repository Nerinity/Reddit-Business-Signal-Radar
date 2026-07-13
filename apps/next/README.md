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
