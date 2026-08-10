# Independent deployment guide

This application must be deployed to infrastructure controlled by the external user. Do not connect it to Nerin's original deployment project or URL.

## Required steps

1. Fork or copy this branch to a repository you control.
2. Create a new hosting project under your own account.
3. Configure a new domain or use the new host-generated URL.
4. Supply your own environment variables and credentials if you add a backend.
5. Replace the synthetic dashboard file with an independently authorized data source.
6. Add an “independent derivative” notice to the deployed application.

## Static demo

The included application can run as a front-end demo using:

```bash
cd apps/next
pnpm install
pnpm build
pnpm start
```

The default data file is:

```text
apps/next/public/data/dashboard.json
```

It contains synthetic data and must not be presented as real Reddit analysis.

## Prohibited configuration

- Do not use Nerin's original deployment URL or domain.
- Do not request or reuse Nerin's hosting, GitHub, cloud, database, or API credentials.
- Do not connect the demo to proprietary models or datasets without separate written authorization.
- Do not represent a derivative deployment as the official Nerin-operated service.
