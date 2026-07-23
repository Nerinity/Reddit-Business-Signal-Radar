#!/usr/bin/env python3
"""Build compact, team-scoped, read-only signal exports for briefing agents.

The exporter consumes the same versioned JSON bundles as the product app.  It
does not expose raw parquet files and keeps evidence in the existing per-week,
per-category files so consumers only fetch supporting posts when needed.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = "1.0"
OVERALL_LIMIT = 5
SIGNAL_LIMIT = 50
DIMENSIONS = (
    "momentum_score",
    "cross_community_score",
    "sentiment_score",
    "engagement_score",
)
INFORMATIVE_KEYWORD_TYPES = {
    "category_keyword",
    "need_state",
    "ingredient_material",
    "retailer_channel",
}
KEYWORD_QUALITY_ALLOWED_TYPES = {
    "product_phrase",
    "category_keyword",
    "need_state",
    "ingredient_material",
    "retailer_channel",
}
KEYWORD_NOISE_STOPLIST = {
    "link comments",
    "read more",
    "see more",
    "click here",
    "view all",
    "this post",
    "this comment",
}
CATALOG_BRAND_NOISE = {"seller", "the gym", "dupe", "upgrade", "shade", "slip"}


def normalize_name(value: object) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().split()).casefold()


def finite(value: object) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number and number not in (float("inf"), float("-inf")) else 0.0


def is_high_quality_keyword(term: dict[str, Any]) -> bool:
    text = str(term.get("term_norm") or "").strip().casefold()
    entity_type = str(term.get("entity_type") or "")
    if entity_type not in KEYWORD_QUALITY_ALLOWED_TYPES or int(term.get("unique_posts") or 0) < 3:
        return False
    if len(text) < 3 or text.isdigit() or re.fullmatch(r"[^\w\s]+", text):
        return False
    if re.match(r"^(u|r)/", text) or re.search(r"http|www\.|\.com\b", text):
        return False
    return text not in KEYWORD_NOISE_STOPLIST


def is_catalog_shopping_brand(brand: dict[str, Any]) -> bool:
    norm = str(brand.get("brand_norm") or "").strip().casefold()
    return (
        brand.get("brand_signal_type") == "catalog_known_brand"
        and (brand.get("brand_domain") or "shopping") == "shopping"
        and int(brand.get("unique_posts") or 0) >= 2
        and bool(norm)
        and not norm.isdigit()
        and norm not in CATALOG_BRAND_NOISE
    )


def is_verified_shopping_brand(brand: dict[str, Any]) -> bool:
    return (
        brand.get("brand_signal_type") == "confirmed_whitelist_brand"
        and (brand.get("brand_domain") or "shopping") == "shopping"
    )


def mixed_signals(cluster: dict[str, Any], limit: int = SIGNAL_LIMIT) -> list[dict[str, Any]]:
    """Mirror the app's mixed Brands/Keywords default ranking for one category."""
    brands = [
        brand for brand in cluster.get("brands", [])
        if is_catalog_shopping_brand(brand) or is_verified_shopping_brand(brand)
    ]
    kept_brand_norms = {str(brand.get("brand_norm") or "") for brand in brands}
    terms = [
        term for term in cluster.get("terms", [])
        if is_high_quality_keyword(term)
        and str(term.get("entity_type") or "") in INFORMATIVE_KEYWORD_TYPES
        and str(term.get("term_norm") or "") not in kept_brand_norms
    ]

    rows: list[dict[str, Any]] = []
    for brand in brands:
        rows.append({
            "signal_key": f"brand:{brand.get('brand_norm', '')}",
            "kind": "brand",
            "display": str(brand.get("brand_display") or brand.get("brand_norm") or ""),
            "entity_type": str(brand.get("brand_signal_type") or "brand"),
            "unique_posts": int(brand.get("unique_posts") or 0),
            "mentions": int(brand.get("mentions") or 0),
            "sentiment": finite(brand.get("sentiment")),
            "is_tiktok_shop_listed": bool(brand.get("is_tiktok_shop_listed")),
            "brand_confidence_tier": str(brand.get("brand_confidence_tier") or ""),
            "brand_domain": str(brand.get("brand_domain") or "shopping"),
            "search_url": str(brand.get("google_search_url") or ""),
            "logo_url": str(brand.get("logo_url") or ""),
            "_priority": 0 if brand.get("brand_signal_type") == "catalog_known_brand" else 2,
        })
    for term in terms:
        norm = str(term.get("term_norm") or term.get("term") or "")
        rows.append({
            "signal_key": f"keyword:{norm}",
            "kind": "keyword",
            "display": str(term.get("term") or norm),
            "entity_type": str(term.get("entity_type") or "keyword"),
            "unique_posts": int(term.get("unique_posts") or 0),
            "mentions": int(term.get("mentions") or 0),
            "sentiment": finite(term.get("sentiment")),
            "_priority": 1,
        })

    rows.sort(key=lambda row: (
        row["_priority"],
        -row["unique_posts"],
        -row["mentions"],
        -row["sentiment"],
        row["display"].casefold(),
    ))
    output = []
    for rank, row in enumerate(rows[:limit], start=1):
        output.append({"rank": rank, **{key: value for key, value in row.items() if key != "_priority"}})
    return output


def cluster_sort_key(cluster: dict[str, Any], dimension: str) -> tuple[Any, ...]:
    name = str(cluster.get("cluster_name") or "").casefold()
    if dimension == "momentum_score":
        return (-finite(cluster.get(dimension)), -finite(cluster.get("growth_rate")), -int(cluster.get("current_week_posts") or 0), name)
    if dimension == "cross_community_score":
        return (-finite(cluster.get(dimension)), -int(cluster.get("unique_subreddits") or 0), -int(cluster.get("current_week_posts") or 0), name)
    if dimension == "sentiment_score":
        return (-finite(cluster.get(dimension)), -finite(cluster.get("positive_share")), -int(cluster.get("current_week_posts") or 0), name)
    if dimension == "engagement_score":
        return (-finite(cluster.get(dimension)), -finite(cluster.get("avg_log_engagement")), -int(cluster.get("current_week_posts") or 0), name)
    return (-finite(cluster.get("trend_score")), -int(cluster.get("current_week_posts") or 0), name)


def category_payload(cluster: dict[str, Any], *, selection: str, rank: int) -> dict[str, Any]:
    week = str(cluster.get("week_start") or "")
    cluster_id = str(cluster.get("cluster_id") or "")
    return {
        "selection": selection,
        "rank": rank,
        "category_id": cluster_id,
        "category_name": str(cluster.get("cluster_name") or ""),
        "scores": {
            "overall": finite(cluster.get("trend_score")),
            "overall_100": finite(cluster.get("trend_score_100")),
            "momentum": finite(cluster.get("momentum_score")),
            "cross_community": finite(cluster.get("cross_community_score")),
            "sentiment": finite(cluster.get("sentiment_score")),
            "engagement": finite(cluster.get("engagement_score")),
        },
        "metrics": {
            "current_week_posts": int(cluster.get("current_week_posts") or 0),
            "previous_week_posts": int(cluster.get("previous_week_posts") or 0),
            "growth_rate": finite(cluster.get("growth_rate")),
            "unique_subreddits": int(cluster.get("unique_subreddits") or 0),
            "avg_sentiment": finite(cluster.get("avg_sentiment")),
            "positive_share": finite(cluster.get("positive_share")),
            "negative_share": finite(cluster.get("negative_share")),
            "avg_log_engagement": finite(cluster.get("avg_log_engagement")),
        },
        "communities_top5": list(cluster.get("communities") or [])[:5],
        "signals_top50": mixed_signals(cluster),
        "evidence_url": f"/data/evidence/{week}/{cluster_id}.json",
    }


def team_payload(pair: dict[str, Any], clusters: list[dict[str, Any]]) -> dict[str, Any]:
    allowed = {normalize_name(name) for name in pair.get("categories", [])}
    scoped = [cluster for cluster in clusters if normalize_name(cluster.get("cluster_name")) in allowed]
    overall = sorted(scoped, key=lambda cluster: cluster_sort_key(cluster, "trend_score"))[:OVERALL_LIMIT]
    excluded = {str(cluster.get("cluster_id")) for cluster in overall}
    highlights = []
    for dimension in DIMENSIONS:
        candidates = [cluster for cluster in scoped if str(cluster.get("cluster_id")) not in excluded]
        if not candidates:
            continue
        winner = sorted(candidates, key=lambda cluster: cluster_sort_key(cluster, dimension))[0]
        excluded.add(str(winner.get("cluster_id")))
        highlights.append(category_payload(winner, selection=dimension, rank=1))

    return {
        "identity_key": str(pair.get("identity_key") or ""),
        "ops_team_1": str(pair.get("ops_team_1") or ""),
        "ops_team_2": str(pair.get("ops_team_2") or ""),
        "mapped_category_count": len(allowed),
        "matched_category_count": len(scoped),
        "overall_top5": [
            category_payload(cluster, selection="overall_trend_score", rank=rank)
            for rank, cluster in enumerate(overall, start=1)
        ],
        "dimension_highlights": highlights,
    }


def build_week_export(dashboard: dict[str, Any], mapping: dict[str, Any], *, generated_at: str) -> dict[str, Any]:
    week = str(dashboard["meta"]["latest_week"])
    return {
        "schema_version": SCHEMA_VERSION,
        "week_start": week,
        "generated_at": generated_at,
        "mapping_version": mapping.get("version"),
        "selection_contract": {
            "overall": "top 5 by trend_score within each team scope",
            "dimension_highlights": list(DIMENSIONS),
            "highlight_exclusions": "exclude overall top 5 and previously selected highlights",
            "mixed_signal_limit_per_category": SIGNAL_LIMIT,
            "mixed_signal_order": "same default brand/keyword ordering as the product app",
        },
        "teams": [team_payload(pair, dashboard.get("clusters", [])) for pair in mapping.get("pairs", [])],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build team-scoped read-only JSON exports for briefing agents.")
    parser.add_argument("--data-dir", default="apps/next/public/data")
    parser.add_argument("--mapping", default="apps/next/public/data/ops-team-category-mapping.json")
    parser.add_argument("--output-dir", action="append", dest="output_dirs")
    args = parser.parse_args()

    data_dir = ROOT / args.data_dir
    mapping = json.loads((ROOT / args.mapping).read_text(encoding="utf-8"))
    dashboard_files = sorted(data_dir.glob("dashboard-????-??-??.json"))
    if not dashboard_files:
        raise FileNotFoundError(f"No versioned dashboard bundles found in {data_dir}")

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    exports = []
    for dashboard_file in dashboard_files:
        dashboard = json.loads(dashboard_file.read_text(encoding="utf-8"))
        exports.append(build_week_export(dashboard, mapping, generated_at=generated_at))
    exports.sort(key=lambda payload: payload["week_start"])

    output_dirs = args.output_dirs or ["apps/next/public/data/bot/v1", "apps/web/public/data/bot/v1"]
    for raw_output_dir in output_dirs:
        output_dir = ROOT / raw_output_dir
        weeks_dir = output_dir / "weeks"
        weeks_dir.mkdir(parents=True, exist_ok=True)
        for payload in exports:
            (weeks_dir / f"{payload['week_start']}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        latest = exports[-1]
        (output_dir / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "latest_complete_week": latest["week_start"],
            "generated_at": generated_at,
            "available_weeks": [payload["week_start"] for payload in reversed(exports)],
            "latest_url": "/data/bot/v1/latest.json",
            "week_url_template": "/data/bot/v1/weeks/{week_start}.json",
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    print(f"Wrote {len(exports)} bot export weeks; latest={exports[-1]['week_start']}")


if __name__ == "__main__":
    main()
