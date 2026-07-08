# Source Strategy

## Default Sources

Daily:

- Reddit JSON
- Reddit RSS

Weekly:

- Arctic Shift

## Deprecated / Optional

- Hacker News
- Google News

They are not part of the default Reddit business signal pipeline.

## Future Full-Site Crawling

The repo reserves `configs/sources/reddit_fullsite_seed.json` and `data/raw/reddit/fullsite/` style partitioning for broader Reddit collection. Full-site crawling should reuse the same raw record contract, audit table, state model, and stable ID rules.
