"""Feature builders shared by cluster reranker training and inference."""
from __future__ import annotations

from typing import Any

import pandas as pd

from signal_radar.nlp.text_utils import clean_token_text, parse_json_list, word_tokens


def _cluster_terms(row: Any, fields: list[str]) -> set[str]:
    terms: set[str] = set()
    for field in fields:
        for value in parse_json_list(getattr(row, field, "")):
            terms.update(t for t in word_tokens(value) if len(t) > 2)
    return terms


def build_cluster_feature_cache(clusters: pd.DataFrame) -> dict:
    """Build reusable cluster text/metadata features keyed by cluster_id."""
    by_cluster: dict[str, dict] = {}
    for row in clusters.itertuples(index=False):
        cid = str(row.cluster_id)
        leaf_terms = _cluster_terms(row, ["leaf_keywords_top"])
        product_terms = _cluster_terms(row, ["top_product_terms"])
        phrase_terms = _cluster_terms(row, ["top_product_phrases", "sample_product_titles"])
        name_terms = set(word_tokens(str(getattr(row, "cluster_name", ""))))
        all_terms = {t for t in leaf_terms | product_terms | phrase_terms | name_terms if len(t) > 2}
        by_cluster[cid] = {
            "cluster_id": cid,
            "cluster_name": str(getattr(row, "cluster_name", "")),
            "first_category_name": str(getattr(row, "first_category_name", "")),
            "product_count": float(getattr(row, "product_count", 0) or 0),
            "leaf_terms": leaf_terms,
            "product_terms": product_terms,
            "phrase_terms": phrase_terms,
            "all_terms": all_terms,
        }
    return {"by_cluster": by_cluster}


def compute_keyword_overlap_score(query_text: str, candidate_cluster_id: str, cluster_cache: dict) -> float:
    cluster = cluster_cache.get("by_cluster", {}).get(str(candidate_cluster_id), {})
    cluster_terms = cluster.get("all_terms", set())
    if not cluster_terms:
        return 0.0
    query_terms = {t for t in word_tokens(clean_token_text(query_text)) if len(t) > 2}
    if not query_terms:
        return 0.0
    overlap = query_terms.intersection(cluster_terms)
    return min(len(overlap) / 8.0, 1.0)


def compute_brand_prior_score(brand_norm: str, candidate_cluster_id: str, brand_prior: pd.DataFrame | None) -> float:
    if brand_prior is None or brand_prior.empty or not str(brand_norm).strip():
        return 0.0
    required = {"brand_norm", "cluster_id"}
    if not required.issubset(set(brand_prior.columns)):
        return 0.0
    matches = brand_prior[
        (brand_prior["brand_norm"].astype(str) == str(brand_norm))
        & (brand_prior["cluster_id"].astype(str) == str(candidate_cluster_id))
    ]
    if matches.empty:
        return 0.0
    row = matches.iloc[0]
    if bool(row.get("is_primary_cluster", False)):
        return 0.20
    return 0.10


def build_pair_features(
    query_text: str,
    query_brand_norm: str,
    query_first_category: str,
    candidate_cluster_id: str,
    candidate_rank: int,
    semantic_score: float,
    cluster_cache: dict,
    brand_prior: pd.DataFrame | None = None,
) -> dict:
    cluster = cluster_cache.get("by_cluster", {}).get(str(candidate_cluster_id), {})
    query_terms = {t for t in word_tokens(clean_token_text(query_text)) if len(t) > 2}
    leaf_overlap = len(query_terms.intersection(cluster.get("leaf_terms", set())))
    phrase_overlap = len(query_terms.intersection(cluster.get("phrase_terms", set())))
    brand_prior_score = compute_brand_prior_score(query_brand_norm, candidate_cluster_id, brand_prior)
    return {
        "semantic_score": float(semantic_score),
        "keyword_overlap_score": compute_keyword_overlap_score(query_text, candidate_cluster_id, cluster_cache),
        "brand_prior_score": float(brand_prior_score),
        "same_parent_category": int(
            bool(str(query_first_category).strip())
            and str(query_first_category).strip().lower() == str(cluster.get("first_category_name", "")).strip().lower()
        ),
        "candidate_rank": int(candidate_rank),
        "inverse_candidate_rank": 1.0 / max(int(candidate_rank), 1),
        "cluster_product_count": float(cluster.get("product_count", 0.0) or 0.0),
        "leaf_keyword_overlap_count": int(leaf_overlap),
        "product_phrase_overlap_count": int(phrase_overlap),
        "brand_primary_cluster_match": int(brand_prior_score >= 0.20),
        "brand_related_cluster_match": int(0.0 < brand_prior_score < 0.20),
    }
