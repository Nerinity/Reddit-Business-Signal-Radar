# Data Contracts

## Raw Reddit Record

Required fields:

```text
ingestion_run_id
source
platform
sub_source
source_type
reddit_id
source_record_id
mention_id
canonical_url
url
keyword
query
category
title
text
full_text
author
community
published_at
collected_at
event_date
ingestion_date
engagement_score
metrics_json
```

## Stable ID Rule

`mention_id` is generated in this order:

1. Reddit native submission ID: `reddit_submission_{id}`
2. Canonical Reddit URL hash
3. Fallback hash of source, title, and normalized text

This prevents the same post from being duplicated when it appears in JSON, RSS, and Arctic Shift.

## Audit Table

Append-only path:

```text
data/audit/scrape_source_status.parquet
```

Each row summarizes one source/subreddit/sort/window attempt.
