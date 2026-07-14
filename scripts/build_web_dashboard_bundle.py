#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

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


def build_week_bundle(week: str, all_weeks: list[str], scores: pd.DataFrame, terms: pd.DataFrame,
                       brands: pd.DataFrame, posts: pd.DataFrame) -> dict:
    latest = scores[scores["week_start"].astype(str).eq(week)].copy()
    top_scores = latest.sort_values(["trend_score", "current_week_posts"], ascending=[False, False]).head(40)

    cluster_cards = []
    for row in top_scores.itertuples(index=False):
        cid = str(row.cluster_id)
        cluster_terms = terms[
            (terms["week_start"].astype(str) == week)
            & (terms["cluster_id"].astype(str) == cid)
        ].sort_values("mentions", ascending=False).head(8)
        cluster_brands = brands[
            (brands["week_start"].astype(str) == week)
            & (brands["cluster_id"].astype(str) == cid)
        ].sort_values("mentions", ascending=False).head(6)
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
                    "brand_display": str(b.brand_display or b.candidate_text),
                    "brand_signal_type": str(b.brand_signal_type),
                    "mentions": safe_int(b.mentions),
                    "sentiment": safe_float(b.avg_sentiment),
                    "google_search_url": str(getattr(b, "google_search_url", "")),
                    # No real logo source is wired up yet -- brand cards fall back to an
                    # initials placeholder. getattr keeps this forward-compatible: once a
                    # logo_url column exists upstream, it starts flowing through with no
                    # further bundle-builder changes needed.
                    "logo_url": str(getattr(b, "logo_url", "") or ""),
                }
                for b in cluster_brands.itertuples(index=False)
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

    brand_rows = (
        brands[brands["week_start"].astype(str).eq(week)]
        .sort_values(["mentions", "unique_posts"], ascending=[False, False])
        .head(80)
    )
    brand_signals = [
        {
            "brand_display": str(r.brand_display or r.candidate_text),
            "brand_norm": str(r.brand_norm),
            "brand_signal_type": str(r.brand_signal_type),
            "cluster_id": str(r.cluster_id),
            "cluster_name": str(r.cluster_name),
            "mentions": safe_int(r.mentions),
            "unique_posts": safe_int(r.unique_posts),
            "avg_sentiment": safe_float(r.avg_sentiment),
            "positive_share": safe_float(r.positive_share),
            "google_search_url": str(r.google_search_url),
            "logo_url": str(getattr(r, "logo_url", "") or ""),
        }
        for r in brand_rows.itertuples(index=False)
    ]

    # Evidence stream is scoped to this week's own date range (week_start inclusive,
    # +7 days exclusive) so switching weeks actually shows different source posts
    # instead of the same always-most-recent 120 rows regardless of which week is selected.
    week_start_dt = pd.Timestamp(week, tz="UTC")
    week_end_dt = week_start_dt + pd.Timedelta(days=7)
    published = pd.to_datetime(posts["published_at"], errors="coerce", utc=True)
    week_posts = posts[(published >= week_start_dt) & (published < week_end_dt)]
    post_rows = week_posts.sort_values("published_at", ascending=False).head(120)
    post_index = [
        {
            "brand_display": str(r.brand_display),
            "brand_norm": str(r.brand_norm),
            "cluster_id": str(r.final_cluster_id),
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

    meta = {
        "latest_week": week,
        "cluster_count": int(latest["cluster_id"].nunique()) if len(latest) else 0,
        "post_count": int(latest["current_week_posts"].sum()) if len(latest) else 0,
        "brand_signal_count": int(len(brands[brands["week_start"].astype(str).eq(week)])),
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
    brands = pd.read_parquet(base / "weekly_cluster_brand_mentions.parquet")
    posts = pd.read_parquet(base / "brand_post_index.parquet")

    all_weeks = sorted(scores["week_start"].astype(str).unique().tolist(), reverse=True)
    if not all_weeks:
        print("No weeks found in weekly_cluster_scores.parquet; nothing to write.")
        return
    latest_week = all_weeks[0]

    out_dirs = [Path(args.output_dir), Path(args.next_output_dir)]
    for out_dir in out_dirs:
        out_dir.mkdir(parents=True, exist_ok=True)

    for week in all_weeks:
        bundle = build_week_bundle(week, all_weeks, scores, terms, brands, posts)
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
