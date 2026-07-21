import importlib.util
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dashboard_builder", ROOT / "scripts" / "build_web_dashboard_bundle.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

WEEKS = ["2026-06-30", "2026-06-23", "2026-06-16"]


def score(week, cluster_id, posts, communities=2):
    return {
        "week_start": week, "cluster_id": cluster_id, "cluster_name": f"Cluster {cluster_id}",
        "current_week_posts": posts, "unique_subreddits_current_week": communities,
    }


def signal(week, cluster_id, norm, unique_posts=3):
    return {
        "week_start": week, "cluster_id": cluster_id, "cluster_name": f"Cluster {cluster_id}",
        "term_norm": norm, "term": norm.title(), "entity_type": "need_state",
        "unique_posts": unique_posts, "mentions": unique_posts + 1, "avg_sentiment": 0.2,
    }


def brand(week, cluster_id, norm, unique_posts=2):
    return {
        "week_start": week, "cluster_id": cluster_id, "cluster_name": f"Cluster {cluster_id}",
        "brand_norm": norm, "brand_display": norm.title(), "brand_signal_type": "catalog_known_brand",
        "unique_posts": unique_posts, "mentions": unique_posts + 1, "avg_sentiment": 0.1, "logo_url": "",
    }


def test_sparkle_requires_absence_in_both_prior_complete_weeks():
    scores = pd.DataFrame([
        score(WEEKS[0], "new", 8), score(WEEKS[0], "seen1", 8), score(WEEKS[0], "seen2", 8), score(WEEKS[0], "low", 4),
        score(WEEKS[1], "seen1", 1), score(WEEKS[2], "seen2", 1),
    ])
    terms = pd.DataFrame([
        signal(WEEKS[0], "new", "fresh"), signal(WEEKS[0], "seen1", "old-one"), signal(WEEKS[0], "seen2", "old-two"),
        signal(WEEKS[1], "seen1", "old-one"), signal(WEEKS[2], "seen2", "old-two"),
    ])
    brands = pd.DataFrame([
        brand(WEEKS[0], "new", "fresh-brand"), brand(WEEKS[0], "seen1", "old-brand-one"), brand(WEEKS[0], "seen2", "old-brand-two"),
        brand(WEEKS[1], "seen1", "old-brand-one"), brand(WEEKS[2], "seen2", "old-brand-two"),
    ])
    result = module.build_sparkle_data(WEEKS[0], WEEKS, scores, terms, brands)
    assert result["status"] == "ready"
    assert result["comparison_weeks"] == WEEKS[1:]
    assert [row["cluster_id"] for row in result["newly_active_clusters"]] == ["new"]
    assert {(row["kind"], row["cluster_id"], row["signal_norm"]) for row in result["new_signals"]} == {
        ("brand", "new", "fresh-brand"), ("keyword", "new", "fresh")
    }


def test_sparkle_reports_insufficient_comparison_weeks():
    result = module.build_sparkle_data(WEEKS[1], WEEKS[:2], pd.DataFrame(), pd.DataFrame(), pd.DataFrame())
    assert result == {
        "status": "insufficient_comparison_weeks",
        "current_week": WEEKS[1],
        "comparison_weeks": [],
        "newly_active_clusters": [],
        "new_signals": [],
    }


def test_sparkle_badge_uses_audited_brand_index_not_catalog_type():
    scores = pd.DataFrame([score(WEEKS[0], "new", 8)])
    terms = pd.DataFrame(columns=[
        "week_start", "cluster_id", "term_norm", "term", "entity_type",
        "unique_posts", "mentions", "avg_sentiment",
    ])
    brands = pd.DataFrame([
        brand(WEEKS[0], "new", "trusted-brand"),
        brand(WEEKS[0], "new", "ambiguous-catalog-name"),
    ])
    result = module.build_sparkle_data(
        WEEKS[0], WEEKS, scores, terms, brands, {"trusted-brand"}
    )
    rows = {row["signal_norm"]: row for row in result["new_signals"]}
    assert rows["trusted-brand"]["is_tiktok_shop_listed"] is True
    assert rows["trusted-brand"]["ui_tag"] == "verified_brand"
    assert rows["ambiguous-catalog-name"]["is_tiktok_shop_listed"] is False
    assert rows["ambiguous-catalog-name"]["ui_tag"] == "brand_keyword"
