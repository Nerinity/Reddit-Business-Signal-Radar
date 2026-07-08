# Pipeline Operations

## Daily Live

```bash
python3 scripts/pipeline.py daily-live --days-back 2 --sources reddit_json,rss
```

Daily live scans recent event-time windows. It should rescan the same subreddit every day; it must not use permanent `done_subreddits` flags.

## Weekly Backfill

```bash
python3 scripts/pipeline.py weekly-backfill --week 2026-W28 --sources arctic
```

Weekly backfill uses Arctic Shift to rebuild the finalized previous week after archive lag settles.

## Weekly Publish

```bash
python3 scripts/pipeline.py weekly-publish
```

Weekly publish can run backfill first, then rebuild processed artifacts and publish lightweight dashboard snapshots.

## Local Cron

```bash
bash scripts/install_local_cron.sh
```
