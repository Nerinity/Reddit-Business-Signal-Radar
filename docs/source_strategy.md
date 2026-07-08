# Source Strategy

## Default Sources

Daily:

- Reddit RSS

Weekly:

- Arctic Shift

## Optional Source Disabled By Default

- Reddit public JSON

The unauthenticated `www.reddit.com/r/{subreddit}/*.json` endpoints return broad HTTP 403 responses in the current runtime. Keep this source out of default daily collection, but preserve it as an explicit optional source so audit rows can capture access conditions and future OAuth work can reuse the connector.

## Deprecated / Optional

- Hacker News
- Google News

They are not part of the default Reddit business signal pipeline.

## Future Full-Site Crawling

The repo reserves `configs/sources/reddit_fullsite_seed.json` and `data/raw/reddit/fullsite/` style partitioning for broader Reddit collection. Full-site crawling should reuse the same raw record contract, audit table, state model, and stable ID rules.
