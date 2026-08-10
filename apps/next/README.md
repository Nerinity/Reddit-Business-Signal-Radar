# Reddit Business Signal Radar — application layer

This directory contains the standalone Next.js dashboard included in the isolated open-source application branch.

It renders precomputed signal records from:

```text
public/data/dashboard.json
```

The bundled file contains synthetic demonstration data only. It is provided to document the application contract and user experience; it is not a production Reddit dataset and is not model output.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the local address printed by Next.js.

## Build

```bash
pnpm build
pnpm start
```

## Connect your own data

Replace `public/data/dashboard.json` with a file that follows the same JSON structure. The collection, classification, scoring, calibration, and trend-identification systems that produce production signals are not part of this branch.

Before publishing a derivative, read the repository-level `OPEN_SOURCE_BOUNDARIES.md` and `DEPLOYMENT.md`. Use your own repository, deployment project, URL, credentials, storage, and data sources.
