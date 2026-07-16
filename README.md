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
python3 scripts/run_nlp_signal_pipeline.py --reddit-sample 5000
```

`--reddit-sample` caps Reddit posts only, for smoke tests. It never truncates brand or product
reference data — those default to building in full, and have their own `--brand-sample` /
`--product-sample` debug caps if you explicitly want a smaller reference build.

The pipeline cleans Reddit post text, cleans internal product/category reference data, builds second-category cluster profiles, creates a brand registry, extracts tokens and phrases, runs sentiment, separates brands from product/category/need-state entities, matches posts to internal clusters, builds a brand-to-post lookup index, and rolls everything up into weekly cluster-level discussion and brand tables.

### Brand sources

Two files feed the brand registry, at different confidence levels:

```text
data/raw/brand_whitelist.csv                high-confidence, manually approved brand list
data/raw/Brand List Available全域.xlsx      broader full-domain known brand catalog (unvetted, ~100k rows)
```

`brand_registry.parquet` unifies both without collapsing the distinction:

- `is_whitelist_brand=True` — approved platform brand (`review_status="approved"`, matched at confidence 1.0)
- `is_catalog_brand=True, is_whitelist_brand=False` — catalog-only (`review_status="catalog_observed"`, matched at confidence 0.85)
- both flags `False` — not in either source; Reddit regex/context candidates that match neither stay out of the registry entirely as `entity_type="unknown_candidate"` (confidence 0.45)

The catalog is too large (100k rows) to hand-curate a denylist for the way `configs/taxonomy/brand_denylist.csv` does for the 500-row whitelist, and it turns out to contain large amounts of ordinary English words/phrases filed as `brand_name` ("Monday", "Keep", "Social Media" are literal rows). `04_build_brand_registry.py` filters stopword-only phrases and, where `wordfreq` is installed, corpus-frequency-common phrases before they ever reach the registry; matching in `07_extract_entities.py` additionally requires purchase/brand context for single-word catalog hits. Expect some residual noise in `catalog_known_brand` — it is a lower-confidence tier by design, not a bug when it shows up.

Core outputs are written under `data/processed/`, including:

```text
clean_reddit_posts.parquet
clean_internal_products.parquet
cluster_profiles_226.parquet
brand_registry.parquet
brand_alias_lookup.parquet
brand_source_quality_report.json
entity_mentions.parquet
keyword_post_index.parquet
cluster_assignments_226.parquet
brand_post_index.parquet
weekly_brand_metrics.parquet
weekly_cluster_metrics.parquet
weekly_trend_terms.parquet
weekly_cluster_discussion_terms.parquet
weekly_cluster_brand_mentions.parquet
high_precision_cluster_posts.parquet
cluster_entity_quality_report.json
```

Table roles:

- `cluster_assignments_226.parquet` — post-to-cluster assignment, with `assignment_confidence`, the legacy `assignment_status` (confident/uncertain/unassigned, used for high-precision evidence), and `cluster_usage_tier` (strong_match/usable_match/weak_match/unassigned, the more permissive dimension downstream cluster intelligence should gate on).
- `brand_registry.parquet` — unified brand registry across both source files; see "Brand sources" above.
- `brand_alias_lookup.parquet` — canonical alias-matching table (`alias_norm` → `brand_norm`), `source` ∈ {whitelist, catalog, manual_alias}.
- `entity_mentions.parquet` — post-level extracted brands, product phrases, need states, and non-whitelist candidates. Its `matched_cluster_id`/`matched_cluster_name` is a brand's static registry home cluster, unrelated to what the post is actually about — do not use it as a dashboard cluster filter. `brand_signal_type` (confirmed_whitelist_brand / catalog_known_brand / candidate_non_whitelist_brand) carries the confidence tier per mention.
- `keyword_post_index.parquet` — canonical `week_start × cluster_id × term_norm × post_key` keyword-to-source-post index produced by `11_build_cluster_entity_metrics.py`. It is the shared source for weekly keyword metrics, cluster word clouds, and exact keyword Evidence; `mention_count_in_post` preserves repeated hits within one post while each post-term pair remains one row.
- `weekly_cluster_discussion_terms.parquet` — canonical source for "what is this cluster discussing": by-cluster keyword/topic/need-state frequency, always keyed off a post's own `final_cluster_id`. Gated on `cluster_usage_tier` in {strong_match, usable_match} by default (add weak_match with `--include-weak-matches`), not the legacy `assignment_status`. Carries both `cluster_usage_tier_distribution` and the legacy `assignment_status_distribution` per row.
- `weekly_cluster_brand_mentions.parquet` — canonical source for "which brands show up in this cluster": approved platform brands, known catalog brands, and non-whitelist Reddit candidates, kept as separate `brand_signal_type` values, never merged. Same `cluster_usage_tier` gate as discussion terms, plus its own confidence floor (0.30 default, 0.25 with `--include-weak-matches`). Also carries `cluster_usage_tier_distribution` and `assignment_status_distribution`.
- `high_precision_cluster_posts.parquet` — `assignment_status = confident` posts only. Useful as spot-check evidence; not the source for cluster-level discussion intelligence, which would starve almost empty under a confident-only gate.
- `cluster_entity_quality_report.json` — per-cluster QA rollup from `11_build_cluster_entity_metrics.py`: one entry per cluster with `post_count_included`, `top_discussion_terms`, `top_brands`, `top_candidate_brands`, `top_subreddits`, `avg_assignment_confidence`, `cluster_usage_tier_distribution`, `assignment_status_distribution`, `sample_titles`, `sample_post_ids`. Use it to spot-check a cluster without querying the parquet tables directly.
- `weekly_cluster_metrics.parquet` — cluster-level post volume and sentiment overview (not keyword/brand-level).
- `weekly_brand_metrics.parquet` — global brand overview, not filtered by cluster.
- `weekly_trend_terms.parquet` — global trend term view only; not the source for cluster filtering.

The main product contract is that a dashboard can show whether a detected brand is an approved platform brand, a known catalog brand, or an emerging Reddit-only candidate, attach sentiment and cluster context, query back to the original Reddit posts mentioning it, and for any given cluster surface what people are discussing and what they like/dislike.

## Operations team scope

The product requires an operations identity before Home, Explore, or Analytics is shown.
Build the versioned Team 1 × Team 2 category configuration and Dashboard taxonomy validation
report with:

```bash
python3 scripts/build_ops_team_category_mapping.py
```

The app reads `apps/next/public/data/ops-team-category-mapping.json`. Saved identities are
validated against the current mapping version on every load, and the resulting category scope
is applied to clusters, signals, evidence links, rankings, filters, and Home metrics.

## Product App

The formal product frontend lives in `apps/next/` as a React / Next.js app. The older `apps/web/` folder is kept as a static prototype snapshot.

Build or refresh the dashboard bundle:

```bash
python3 scripts/sync_product_app_data.py
```

This writes the same dashboard JSON to:

```text
apps/web/public/data/dashboard.json
apps/next/public/data/dashboard.json
```

Run the Next.js app:

```bash
python3 scripts/run_product_app.py --install
```

The app runs on `http://127.0.0.1:4175` by default.

Optional NLP dependencies are handled defensively:

- If `sentence-transformers` or the configured embedding model is unavailable, cluster matching falls back to TF-IDF, then bag-of-words, and records the selected method in `data/processed/cluster_matching_similarity_report.json`.
- If VADER is unavailable, sentiment falls back to phrase-count scoring.
- If spaCy or `en_core_web_sm` is unavailable, tokenization and phrase extraction fall back to regex tokenization and n-grams.

Strongly recommend installing `en_core_web_sm` and `langdetect` rather than relying on the fallbacks:

```bash
python3 -m pip install langdetect
python3 -m pip install "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
```

Without `en_core_web_sm`, `noun_phrases` degrades to raw adjacent-token bigrams, and
`product_phrase`/`category_keyword` entities end up dominated by stopword fragments
("i just", "how to", "in my") instead of real product/topic signal — this was bad enough
to have previously made `weekly_cluster_discussion_terms.parquet` nearly unusable. Without
`langdetect`, language detection falls back to a much cruder heuristic.

## Git Policy

The repository should keep code, configs, docs, and lightweight dashboard artifacts only. Large raw data, processed parquet files, embeddings, and model outputs should stay out of git unless explicitly promoted as small shareable artifacts.
