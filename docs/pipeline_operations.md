# Pipeline Operations

## Daily Live

```bash
python3 scripts/pipeline.py daily-live --days-back 2 --sources rss
```

Daily live scans recent event-time windows. It should rescan the same subreddit every day; it must not use permanent `done_subreddits` flags. Daily live currently uses RSS by default because public Reddit JSON frequently returns HTTP 403.

Optional JSON fallback can still be requested explicitly:

```bash
python3 scripts/pipeline.py daily-live \
  --days-back 2 \
  --sources reddit_json,rss \
  --sorts new,hot \
  --per-sub 80 \
  --max-pages-per-sort 1 \
  --refresh-legacy-csv
```

## Weekly Backfill

```bash
python3 scripts/pipeline.py weekly-backfill --week 2026-W28 --sources arctic
```

Weekly backfill uses Arctic Shift to rebuild the finalized previous week after archive lag settles.

Recommended backfill example:

```bash
python3 scripts/pipeline.py weekly-backfill \
  --sources arctic \
  --per-sub 300 \
  --max-pages-per-sort 10 \
  --refresh-legacy-csv
```

## Weekly Publish

```bash
python3 scripts/pipeline.py weekly-publish
```

Weekly publish can run backfill first, then rebuild processed artifacts and publish lightweight dashboard snapshots.

## Local Cron

```bash
bash scripts/install_local_cron.sh
```
