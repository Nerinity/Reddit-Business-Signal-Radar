# Open-source and usage boundaries

## 1. Data provenance and external dependencies

The original product may analyze publicly available Reddit discussions collected through sources such as Reddit RSS and permitted archival or API services. Reddit content is third-party user-generated content. Availability, coverage, structure, and access conditions may change without notice.

Reddit communities are not representative of the whole market. User-generated content may include subjective statements, sarcasm, advertising, automation, errors, or incomplete context. Signals should be treated as research leads rather than official brand statements, market share, sales results, or causal findings.

No production Reddit data, proprietary brand registry, internal product taxonomy, or processed signal dataset is distributed in this branch. The included dashboard file is synthetic.

Users of derivative deployments are responsible for their own data rights, platform terms, privacy compliance, security, retention policy, and legal review.

## 2. Proprietary model boundary

The following are not open sourced:

- Model files, weights, prompts, training data, calibration data, and evaluation sets
- Classification, entity-recognition, ranking, reranking, scoring, thresholding, and forecasting implementations
- Proprietary brand registries, aliases, taxonomies, cluster profiles, and quality rules
- Production pipelines and model-generated datasets

Ownership and final interpretive authority for the model, its methodology, and its outputs remain with **Nerin**. Nothing in this branch grants a right to copy, redistribute, reverse engineer, commercialize, or represent the excluded model as open source.

## 3. Repository permission boundary

This branch is published as a read-only reference for external users. Publication does not grant direct write access to the original repository.

External users must work from their own fork or repository. They may not directly push commits, create branches, merge changes, publish releases, or alter repository settings in `Nerinity/Reddit-Business-Signal-Radar` unless Nerin grants separate written authorization.

## 4. Deployment boundary

Every derivative deployment must use a separate hosting project and a separate deployment address. External users may not reuse Nerin's deployment URL, domain, hosting account, cloud resources, database, object storage, environment variables, tokens, or credentials.

Derivative deployments must clearly state that they are independent and are not operated, maintained, or endorsed by Nerin unless a separate written agreement says otherwise.

## 5. Warranty and maintenance

The application-layer example is provided without a service-level commitment. External users are responsible for deployment, operations, security, compliance, costs, support, and maintenance of their derivative versions.
