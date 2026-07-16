#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd


def parse_json_list(value):
    if isinstance(value, list):
        return value
    text = "" if pd.isna(value) else str(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def safe_float(value, default=0.0):
    try:
        if pd.isna(value):
            return default
        return float(value)
    except Exception:
        return default


def safe_int(value, default=0):
    try:
        if pd.isna(value):
            return default
        return int(value)
    except Exception:
        return default


BRAND_TYPE_PRIORITY = {
    "confirmed_whitelist_brand": 0,
    "catalog_known_brand": 1,
    "candidate_non_whitelist_brand": 2,
}


def normalize_brand(value) -> str:
    """Create a stable fallback ID when legacy candidate rows have no brand_norm."""
    text = "" if pd.isna(value) else unicodedata.normalize("NFKC", str(value))
    text = re.sub(r"[^\w\s-]+", " ", text.casefold())
    return re.sub(r"[\s_-]+", " ", text).strip()


def canonical_brand_display(value) -> str:
    text = "" if pd.isna(value) else unicodedata.normalize("NFKC", str(value)).strip()
    return re.sub(r"[^\w)&+'®™]+$", "", text).strip() or text


def prepare_brand_rows(brands: pd.DataFrame) -> pd.DataFrame:
    prepared = brands.copy()
    prepared["brand_norm"] = prepared.apply(
        lambda row: normalize_brand(row.get("brand_norm") or row.get("brand_display") or row.get("candidate_text")),
        axis=1,
    )
    prepared["brand_display"] = prepared.apply(
        lambda row: str(row.get("brand_display") or row.get("candidate_text") or row["brand_norm"]).strip(),
        axis=1,
    )
    prepared = prepared[prepared["brand_norm"].ne("")].copy()
    prepared["brand_type_priority"] = prepared["brand_signal_type"].map(BRAND_TYPE_PRIORITY).fillna(3)
    return prepared


def prepare_week_posts(posts: pd.DataFrame, week: str) -> pd.DataFrame:
    start = pd.Timestamp(week, tz="UTC")
    end = start + pd.Timedelta(days=7)
    published = pd.to_datetime(posts["published_at"], errors="coerce", utc=True)
    result = posts[(published >= start) & (published < end)].copy()
    result["brand_norm"] = result["brand_norm"].map(normalize_brand)
    result["cluster_id"] = result["final_cluster_id"].astype(str)
    result["post_key"] = result.get("mention_id", pd.Series(index=result.index, dtype=object)).fillna("")
    missing = result["post_key"].astype(str).str.strip().eq("")
    result.loc[missing, "post_key"] = result.loc[missing, "url"].fillna("").astype(str)
    return result[result["brand_norm"].ne("") & result["post_key"].astype(str).str.strip().ne("")]


def build_week_bundle(week: str, all_weeks: list[str], scores: pd.DataFrame, terms: pd.DataFrame,
                       brands: pd.DataFrame, posts: pd.DataFrame, discussion_posts: pd.DataFrame) -> dict:
    latest = scores[scores["week_start"].astype(str).eq(week)].copy()
    top_scores = latest.sort_values(["trend_score", "current_week_posts"], ascending=[False, False]).head(40)

    week_brands = brands[brands["week_start"].astype(str).eq(week)].copy()
    week_posts = prepare_week_posts(posts, week)

    # Canonical metadata is selected once per brand_norm. Trusted catalog names win;
    # within a type, the most-discussed spelling becomes the display name.
    canonical = (
        week_brands.sort_values(
            ["brand_norm", "brand_type_priority", "unique_posts", "mentions"],
            ascending=[True, True, False, False],
        )
        .drop_duplicates("brand_norm")
        .set_index("brand_norm")
    )
    valid_brand_norms = set(canonical.index)
    indexed_posts = week_posts[week_posts["brand_norm"].isin(valid_brand_norms)].copy()
    post_counts = indexed_posts.groupby("brand_norm")["post_key"].nunique().to_dict()
    cluster_post_counts = (
        indexed_posts.groupby(["cluster_id", "brand_norm"])["post_key"].nunique().to_dict()
    )

    cluster_signal_rows = []
    for (cid, norm), rows in week_brands.groupby([week_brands["cluster_id"].astype(str), "brand_norm"], sort=False):
        meta_row = canonical.loc[norm]
        weights = rows["mentions"].clip(lower=1)
        cluster_signal_rows.append({
            "week_start": week,
            "cluster_id": cid,
            "cluster_name": str(rows.iloc[0]["cluster_name"]),
            "brand_norm": norm,
        "brand_display": canonical_brand_display(meta_row.brand_display),
            "brand_signal_type": str(meta_row.brand_signal_type),
            "unique_posts": safe_int(cluster_post_counts.get((cid, norm), rows["unique_posts"].max())),
            "mentions": safe_int(rows["mentions"].sum()),
            "avg_sentiment": safe_float((rows["avg_sentiment"] * weights).sum() / weights.sum()),
            "positive_share": safe_float((rows["positive_share"] * weights).sum() / weights.sum()),
        })
    cluster_signal_rows.sort(key=lambda r: (-r["unique_posts"], -r["mentions"], r["brand_norm"]))

    signals_by_cluster: dict[str, list[dict]] = {}
    for signal in cluster_signal_rows:
        signals_by_cluster.setdefault(signal["cluster_id"], []).append(signal)

    cluster_cards = []
    for row in top_scores.itertuples(index=False):
        cid = str(row.cluster_id)
        cluster_terms = terms[
            (terms["week_start"].astype(str) == week)
            & (terms["cluster_id"].astype(str) == cid)
        ].sort_values("mentions", ascending=False).head(8)
        cluster_brands = signals_by_cluster.get(cid, [])
        cluster_cards.append({
            "week_start": week,
            "cluster_id": cid,
            "cluster_name": str(row.cluster_name),
            "trend_score": safe_float(row.trend_score),
            "trend_score_100": safe_float(row.trend_score_100),
            "momentum_score": safe_float(row.momentum_score),
            "sentiment_score": safe_float(row.sentiment_score),
            "cross_community_score": safe_float(row.cross_community_score),
            "engagement_score": safe_float(row.engagement_score),
            # Continuous 0-1 values behind the 1-5 star scores above. momentum_score
            # itself is 0.60*volume_bucket + 0.40*spike_bucket -- only ~25 distinct
            # values across the whole cluster set -- so a scatter plot positioned by
            # the *_score fields piles dozens of clusters on the same handful of
            # coordinates. These give the opportunity scatter a genuinely continuous,
            # visually spread-out placement instead.
            "momentum_percentile": safe_float(0.60 * row.volume_percentile + 0.40 * row.spike_percentile),
            "cross_community_percentile": safe_float(row.cross_community_percentile),
            "current_week_posts": safe_int(row.current_week_posts),
            "previous_week_posts": safe_int(row.previous_week_posts),
            "growth_rate": safe_float(row.growth_rate),
            "unique_subreddits": safe_int(row.unique_subreddits_current_week),
            "avg_sentiment": safe_float(row.avg_sentiment_current_week),
            "positive_share": safe_float(row.positive_share_current_week),
            "negative_share": safe_float(row.negative_share_current_week),
            "avg_log_engagement": safe_float(row.avg_log_engagement_current_week),
            "terms": [
                {
                    "term": str(t.term),
                    "entity_type": str(t.entity_type),
                    "mentions": safe_int(t.mentions),
                    "sentiment": safe_float(t.avg_sentiment),
                }
                for t in cluster_terms.itertuples(index=False)
            ],
            "brands": [
                {
                    "brand_norm": b["brand_norm"],
                    "brand_display": b["brand_display"],
                    "brand_signal_type": b["brand_signal_type"],
                    "unique_posts": b["unique_posts"],
                    "mentions": b["mentions"],
                    "sentiment": b["avg_sentiment"],
                    "google_search_url": str(canonical.loc[b["brand_norm"]].get("google_search_url", "")),
                    "logo_url": str(canonical.loc[b["brand_norm"]].get("logo_url", "") or ""),
                }
                for b in cluster_brands
            ],
        })

    top_terms = (
        terms[terms["week_start"].astype(str).eq(week)]
        .sort_values("mentions", ascending=False)
        .head(120)
    )
    keyword_map = [
        {
            "term": str(r.term),
            "term_norm": str(r.term_norm),
            "entity_type": str(r.entity_type),
            "cluster_id": str(r.cluster_id),
            "cluster_name": str(r.cluster_name),
            "mentions": safe_int(r.mentions),
            "sentiment": safe_float(r.avg_sentiment),
        }
        for r in top_terms.itertuples(index=False)
    ]

    brand_signals = []
    for norm, rows in week_brands.groupby("brand_norm", sort=False):
        meta_row = canonical.loc[norm]
        mentions = safe_int(rows["mentions"].sum())
        weights = rows["mentions"].clip(lower=1)
        avg_sentiment = safe_float((rows["avg_sentiment"] * weights).sum() / weights.sum())
        aliases = sorted({str(value).strip() for value in rows["brand_display"] if str(value).strip()})
        brand_signals.append({
            "brand_norm": str(norm),
            "brand_display": canonical_brand_display(meta_row.brand_display),
            "aliases": aliases,
            "brand_signal_type": str(meta_row.brand_signal_type),
            "unique_posts": safe_int(post_counts.get(norm, rows["unique_posts"].max())),
            "mentions": mentions,
            "cluster_count": int(rows["cluster_id"].astype(str).nunique()),
            "avg_sentiment": avg_sentiment,
            "positive_share": safe_float((rows["positive_share"] * weights).sum() / weights.sum()),
            "google_search_url": str(meta_row.get("google_search_url", "") or f"https://www.google.com/search?q={quote_plus(str(meta_row.brand_display) + ' brand')}"),
            "logo_url": str(meta_row.get("logo_url", "") or ""),
        })
    brand_signals.sort(key=lambda r: (-r["unique_posts"], -r["mentions"], r["brand_norm"]))

    # Evidence stream is scoped to this week's own date range (week_start inclusive,
    # +7 days exclusive) so switching weeks actually shows different source posts
    # instead of the same always-most-recent 120 rows regardless of which week is selected.
    post_rows = week_posts.sort_values("published_at", ascending=False).head(120)
    post_index = [
        {
            "brand_display": str(r.brand_display),
            "brand_norm": str(r.brand_norm),
            "cluster_id": str(r.cluster_id),
            "cluster_name": str(r.final_cluster_name),
            "title": str(r.title),
            "text_snippet": str(r.text_snippet),
            "subreddit": str(r.subreddit),
            "published_at": str(r.published_at),
            "url": str(r.url),
            "sentiment_label": str(r.sentiment_label),
            "sentiment_compound": safe_float(r.sentiment_compound),
            "context_window": str(r.context_window),
        }
        for r in post_rows.itertuples(index=False)
    ]

    discussion_start = pd.Timestamp(week, tz="UTC")
    discussion_end = discussion_start + pd.Timedelta(days=7)
    discussion_published = pd.to_datetime(discussion_posts["published_at"], errors="coerce", utc=True)
    current_discussions = discussion_posts[(discussion_published >= discussion_start) & (discussion_published < discussion_end)].copy()
    discussion_key = current_discussions["mention_id"].fillna("").astype(str)
    missing_discussion_key = discussion_key.str.strip().eq("")
    discussion_key.loc[missing_discussion_key] = current_discussions.loc[missing_discussion_key, "url"].fillna("").astype(str)
    weekly_post_count = int(discussion_key[discussion_key.str.strip().ne("")].nunique())

    meta = {
        "latest_week": week,
        "cluster_count": int(latest["cluster_id"].nunique()) if len(latest) else 0,
        "weekly_post_count": weekly_post_count,
        "weekly_brand_signal_count": int(week_brands[["cluster_id", "brand_norm"]].drop_duplicates().shape[0]),
        "weekly_unique_brand_count": int(week_brands["brand_norm"].nunique()),
        "verified_brand_count": int((pd.Series([b["brand_signal_type"] for b in brand_signals]) == "confirmed_whitelist_brand").sum()),
        "known_brand_count": int((pd.Series([b["brand_signal_type"] for b in brand_signals]) == "catalog_known_brand").sum()),
        "candidate_brand_count": int((pd.Series([b["brand_signal_type"] for b in brand_signals]) == "candidate_non_whitelist_brand").sum()),
        # Legacy aliases retained for the static web client during migration.
        "post_count": weekly_post_count,
        "brand_signal_count": int(week_brands[["cluster_id", "brand_norm"]].drop_duplicates().shape[0]),
        "term_signal_count": int(len(terms[terms["week_start"].astype(str).eq(week)])),
        "avg_trend_score": round(float(latest["trend_score"].mean()), 2) if len(latest) else 0,
        "max_trend_score": round(float(latest["trend_score"].max()), 2) if len(latest) else 0,
    }
    trend_distribution = (
        latest.assign(
            band=pd.cut(
                latest["trend_score"],
                [0, 2, 2.5, 3, 3.5, 4, 4.5, 5.01],
                labels=["1-2", "2-2.5", "2.5-3", "3-3.5", "3.5-4", "4-4.5", "4.5-5"],
                include_lowest=True,
            )
        )["band"].value_counts(sort=False)
        if len(latest) else pd.Series(dtype=int)
    )

    return {
        "meta": meta,
        "clusters": cluster_cards,
        "keywords": keyword_map,
        "brands": brand_signals,
        "cluster_brand_signals": cluster_signal_rows,
        "posts": post_index,
        "trend_distribution": [
            {"band": str(k), "count": int(v)}
            for k, v in trend_distribution.items()
        ],
        "weeks": all_weeks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build per-week JSON bundles for the web app(s).")
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--output-dir", default="apps/web/public/data")
    parser.add_argument("--next-output-dir", default="apps/next/public/data")
    args = parser.parse_args()

    base = Path(args.processed_dir)
    scores = pd.read_parquet(base / "weekly_cluster_scores.parquet")
    terms = pd.read_parquet(base / "weekly_cluster_discussion_terms.parquet")
    brands = prepare_brand_rows(pd.read_parquet(base / "weekly_cluster_brand_mentions.parquet"))
    posts = pd.read_parquet(base / "brand_post_index.parquet")
    discussion_posts = pd.read_parquet(base / "clean_reddit_posts.parquet")

    # A week whose Mon-Sun span isn't fully covered by the raw collection yet (the
    # trailing edge of whatever the crawler has ingested so far) shows up here with a
    # handful of clusters instead of the usual ~100+ -- exclude it entirely rather than
    # ever loading it as the default view or offering it in the switcher, since it reads
    # as "the data broke" rather than "this week is still in progress."
    MIN_WEEK_CLUSTER_COUNT = 20
    cluster_counts = scores.groupby(scores["week_start"].astype(str))["cluster_id"].nunique()
    all_weeks = sorted(
        (week for week, count in cluster_counts.items() if count >= MIN_WEEK_CLUSTER_COUNT),
        reverse=True,
    )
    if not all_weeks:
        print("No weeks with enough clusters in weekly_cluster_scores.parquet; nothing to write.")
        return
    latest_week = all_weeks[0]

    out_dirs = [Path(args.output_dir), Path(args.next_output_dir)]
    for out_dir in out_dirs:
        out_dir.mkdir(parents=True, exist_ok=True)

    for week in all_weeks:
        bundle = build_week_bundle(week, all_weeks, scores, terms, brands, posts, discussion_posts)
        payload = json.dumps(bundle, ensure_ascii=False, indent=2)
        for out_dir in out_dirs:
            (out_dir / f"dashboard-{week}.json").write_text(payload, encoding="utf-8")
        if week == latest_week:
            # dashboard.json (no date suffix) is the default the app loads on first paint,
            # before the user has picked a week from the topbar switcher.
            for out_dir in out_dirs:
                (out_dir / "dashboard.json").write_text(payload, encoding="utf-8")

    print(f"Wrote {len(all_weeks)} weekly bundles ({', '.join(all_weeks)}) to {args.output_dir} and {args.next_output_dir}")


if __name__ == "__main__":
    main()
