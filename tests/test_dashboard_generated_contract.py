import json
from pathlib import Path

import pandas as pd
import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "apps" / "next" / "public" / "data"


@pytest.fixture(scope="module")
def dashboard():
    return json.loads((DATA_DIR / "dashboard.json").read_text(encoding="utf-8"))


def test_home_signal_counts_are_deduplicated(dashboard):
    meta = dashboard["meta"]
    brand_pairs = {(row["cluster_id"], row["brand_norm"]) for row in dashboard["cluster_brand_signals"]}
    assert meta["weekly_post_count"] > 0
    assert meta["weekly_keyword_signal_count"] > 0
    assert meta["weekly_brand_signal_count"] == len(brand_pairs)
    assert meta["covered_cluster_count"] == len(dashboard["clusters"])


def test_all_cluster_brand_targets_exist(dashboard):
    cluster_ids = {cluster["cluster_id"] for cluster in dashboard["clusters"]}
    signal_cluster_ids = {signal["cluster_id"] for signal in dashboard["cluster_brand_signals"]}
    assert signal_cluster_ids <= cluster_ids
    assert len(dashboard["clusters"]) == dashboard["meta"]["cluster_count"]


def test_cluster_terms_and_communities_use_complete_contract(dashboard):
    assert max(len(cluster["terms"]) for cluster in dashboard["clusters"]) == 8
    assert all(len(cluster["terms"]) <= 8 for cluster in dashboard["clusters"])
    for cluster in dashboard["clusters"]:
        for term in cluster["terms"]:
            assert term["term_norm"]
            assert term["unique_posts"] >= 2
            assert term["mentions"] >= term["unique_posts"]
        communities = cluster["communities"]
        assert len(communities) <= 5
        assert communities == sorted(communities, key=lambda row: (-row["unique_posts"], row["subreddit"]))
        assert all(0 < row["discussion_share"] <= 1 for row in communities)


def test_brand_counts_and_evidence_are_post_deduplicated(dashboard):
    week = dashboard["meta"]["latest_week"]
    signals_by_cluster = {}
    for signal in dashboard["cluster_brand_signals"]:
        signals_by_cluster.setdefault(signal["cluster_id"], {})[signal["brand_norm"]] = signal

    checked = 0
    for evidence_file in sorted((DATA_DIR / "evidence" / week).glob("*.json"))[:10]:
        cluster_id = evidence_file.stem
        evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
        for brand_norm, posts in evidence.get("brands", {}).items():
            keys = [post["post_key"] for post in posts]
            assert len(keys) == len(set(keys))
            assert brand_norm in signals_by_cluster[cluster_id]
            assert len(posts) <= signals_by_cluster[cluster_id][brand_norm]["unique_posts"]
            checked += 1
        for posts in evidence.get("keywords", {}).values():
            keys = [post["post_key"] for post in posts]
            assert len(keys) == len(set(keys))
    assert checked > 0


def test_keyword_evidence_is_the_full_index_slice(dashboard):
    week = dashboard["meta"]["latest_week"]
    evidence_file = min((DATA_DIR / "evidence" / week).glob("*.json"), key=lambda path: path.stat().st_size)
    cluster_id = evidence_file.stem
    evidence = json.loads(evidence_file.read_text(encoding="utf-8"))["keywords"]
    index = pd.read_parquet(
        REPO_ROOT / "data" / "processed" / "keyword_post_index.parquet",
        columns=["week_start", "cluster_id", "term_norm", "post_key"],
        filters=[("week_start", "=", week), ("cluster_id", "=", cluster_id)],
    )
    expected = index.groupby("term_norm")["post_key"].nunique().to_dict()
    assert {term: len(posts) for term, posts in evidence.items()} == expected
