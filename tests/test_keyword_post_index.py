import importlib.util
import sys
from pathlib import Path

import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

spec = importlib.util.spec_from_file_location("cluster_entity_metrics", ROOT / "scripts" / "11_build_cluster_entity_metrics.py")
metrics_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(metrics_module)


def source_rows():
    base = {
        "week_start": "2026-06-30",
        "cluster_name": "Cluster One",
        "term_display": "Sensitive Skin",
        "entity_text": "Sensitive Skin",
        "entity_norm": "sensitive skin",
        "entity_type": "need_state",
        "post_id": "",
        "subreddit": "SkincareAddiction",
        "published_at": pd.Timestamp("2026-07-01", tz="UTC"),
        "title_clean": "A source post",
        "text_for_display": "Sensitive skin context",
        "context_window": "Sensitive skin context",
        "sentiment_compound": 0.4,
        "sentiment_label": "positive",
        "assignment_confidence": 0.8,
        "cluster_usage_tier": "strong_match",
        "assignment_status": "confident",
        "entity_matched_cluster_id": "",
        "entity_matched_cluster_name": "",
    }
    return pd.DataFrame([
        {**base, "cluster_id": "1", "url": "https://reddit.com/r/x/comments/a/post?x=1", "mention_count_in_post": 2},
        {**base, "cluster_id": "1", "url": "https://www.reddit.com/r/x/comments/a/post/", "mention_count_in_post": 2},
        {**base, "cluster_id": "1", "url": "https://reddit.com/r/x/comments/b/post", "mention_count_in_post": 1},
        {**base, "cluster_id": "2", "cluster_name": "Cluster Two", "url": "https://reddit.com/r/x/comments/a/post", "mention_count_in_post": 1},
        {**base, "cluster_id": "1", "entity_text": "Retinol", "entity_norm": "retinol", "url": "https://reddit.com/r/x/comments/a/post", "mention_count_in_post": 1},
    ])


def test_keyword_index_business_key_and_weekly_aggregation():
    index = metrics_module.build_keyword_post_index(source_rows(), {"2026-06-30"})
    assert len(index) == 4
    assert not index.duplicated(["week_start", "cluster_id", "term_norm", "post_key"]).any()
    sensitive_cluster_one = index[(index["cluster_id"] == "1") & (index["term_norm"] == "sensitive skin")]
    assert len(sensitive_cluster_one) == 2
    assert sorted(sensitive_cluster_one["mention_count_in_post"].tolist()) == [1, 2]

    weekly = metrics_module.aggregate_weekly_terms(index)
    row = weekly[(weekly["cluster_id"] == "1") & (weekly["term_norm"] == "sensitive skin")].iloc[0]
    assert row["unique_posts"] == 2
    assert row["mentions"] == 3
    assert row["avg_sentiment"] == pytest.approx(0.4)


def test_keyword_index_keeps_week_cluster_and_term_separate():
    index = metrics_module.build_keyword_post_index(source_rows(), {"2026-06-30"})
    keys = set(zip(index["cluster_id"], index["term_norm"]))
    assert ("1", "sensitive skin") in keys
    assert ("2", "sensitive skin") in keys
    assert ("1", "retinol") in keys
