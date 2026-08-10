# Reddit Business Signal Radar — Open Application Layer

This branch contains a standalone, source-available application-layer example for exploring precomputed Reddit business signals. It is intentionally isolated from the main branch history and does **not** include the proprietary model, model artifacts, training or calibration data, production data, scoring implementation, collection pipeline, credentials, or original deployment configuration.

## Included

- Next.js dashboard interface
- Internationalized UI components
- Public dashboard data contract
- Synthetic demo data
- Independent deployment instructions

## Not included

- NLP models or model weights
- Model training, calibration, evaluation, or reranking assets
- Brand and product reference datasets
- Collection, enrichment, scoring, or forecasting pipelines
- Production Reddit data or processed outputs
- Original hosting project, domain, environment variables, tokens, or credentials

## Rights and interpretation

The model design, model behavior, classification system, scoring methodology, thresholds, derived model assets, and final interpretation of model outputs remain the intellectual property of **Nerin**. The model is not open sourced or licensed through this branch.

The application code in this branch is licensed under the MIT License. That license applies only to files present in this isolated branch and does not grant rights to any excluded model, dataset, method, trademark, account, credential, or deployment environment.

## Repository and deployment boundary

External users must:

1. Fork or copy this branch into a repository they control.
2. Use their own deployment project, URL, domain, environment variables, storage, credentials, and third-party accounts.
3. Replace the synthetic `dashboard.json` with data produced by an independently authorized backend.
4. Clearly identify their deployment as an independent or unofficial derivative.

External users are **not** granted direct push, branch creation, merge, release, or deployment permissions for `Nerinity/Reddit-Business-Signal-Radar`. Do not deploy against Nerin's original hosting address or infrastructure.

## Local use

```bash
cd apps/next
pnpm install
pnpm dev
```

The demo reads `apps/next/public/data/dashboard.json`, which contains synthetic records only.

See [OPEN_SOURCE_BOUNDARIES.md](OPEN_SOURCE_BOUNDARIES.md) and [DEPLOYMENT.md](DEPLOYMENT.md) before redistribution or deployment.
