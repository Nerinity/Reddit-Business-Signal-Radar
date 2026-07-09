#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import random
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.reranker_features import build_cluster_feature_cache, build_pair_features
from signal_radar.nlp.text_utils import ensure_parent, word_tokens, write_json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("build_reranker_pairs")


def sentence_transformer_similarity(
    query_texts: list[str],
    cluster_texts: list[str],
    model_name: str,
    offline: bool,
) -> tuple[np.ndarray | None, dict]:
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        if offline:
            os.environ["HF_HUB_OFFLINE"] = "1"
        try:
            model = SentenceTransformer(model_name, local_files_only=offline)
        except TypeError:
            model = SentenceTransformer(model_name)
        cluster_emb = model.encode(cluster_texts, normalize_embeddings=True, show_progress_bar=False)
        query_emb = model.encode(query_texts, normalize_embeddings=True, show_progress_bar=True)
        sim = np.asarray(query_emb, dtype="float32") @ np.asarray(cluster_emb, dtype="float32").T
        return sim, {"similarity_method": "sentence_transformer", "embedding_model": model_name, "fallback_reason": ""}
    except Exception as exc:
        reason = f"SentenceTransformer unavailable: {exc}"
        log.info("%s; falling back to TF-IDF", reason)
        return None, {"fallback_reason": reason}


def tfidf_similarity(query_texts: list[str], cluster_texts: list[str], fallback_reason: str) -> tuple[np.ndarray | None, dict]:
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
        from sklearn.metrics.pairwise import cosine_similarity  # type: ignore

        vectorizer = TfidfVectorizer(min_df=1, ngram_range=(1, 2), max_features=100000)
        matrix = vectorizer.fit_transform(cluster_texts + query_texts)
        sim = cosine_similarity(matrix[len(cluster_texts) :], matrix[: len(cluster_texts)])
        return np.asarray(sim, dtype="float32"), {
            "similarity_method": "tfidf",
            "embedding_model": None,
            "fallback_reason": fallback_reason,
        }
    except Exception as exc:
        reason = "; ".join(v for v in [fallback_reason, f"sklearn unavailable: {exc}"] if v)
        log.info("%s; falling back to bag-of-words", reason)
        return None, {"fallback_reason": reason}


def bow_similarity(query_texts: list[str], cluster_texts: list[str], fallback_reason: str) -> tuple[np.ndarray, dict]:
    cluster_counts = [Counter(word_tokens(t)) for t in cluster_texts]
    query_counts = [Counter(word_tokens(t)) for t in query_texts]
    vocab = sorted(set().union(*(c.keys() for c in cluster_counts + query_counts)))
    index = {term: i for i, term in enumerate(vocab)}

    def to_vec(counter: Counter[str]) -> np.ndarray:
        vec = np.zeros(len(index), dtype="float32")
        for term, value in counter.items():
            vec[index[term]] = float(value)
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec

    cluster_matrix = np.vstack([to_vec(c) for c in cluster_counts])
    query_matrix = np.vstack([to_vec(c) for c in query_counts])
    return query_matrix @ cluster_matrix.T, {
        "similarity_method": "bow",
        "embedding_model": None,
        "fallback_reason": fallback_reason,
    }


def build_similarity(query_texts: list[str], cluster_texts: list[str], model_name: str, offline: bool) -> tuple[np.ndarray, dict]:
    sim, report = sentence_transformer_similarity(query_texts, cluster_texts, model_name, offline)
    if sim is not None:
        return sim, report
    sim, report = tfidf_similarity(query_texts, cluster_texts, str(report.get("fallback_reason", "")))
    if sim is not None:
        return sim, report
    return bow_similarity(query_texts, cluster_texts, str(report.get("fallback_reason", "")))


def choose(items: list[str], n: int, rng: random.Random) -> list[str]:
    items = list(dict.fromkeys([str(v) for v in items if str(v).strip()]))
    rng.shuffle(items)
    return items[: max(n, 0)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build product-derived training pairs for the cluster reranker.")
    parser.add_argument("--products", default="data/processed/clean_internal_products.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_profiles_226.parquet")
    parser.add_argument("--brand-prior", default="data/processed/brand_cluster_prior.parquet")
    parser.add_argument("--output", default="data/processed/reranker_training_pairs.parquet")
    parser.add_argument("--report", default="data/processed/reranker_pair_build_report.json")
    parser.add_argument("--embedding-model", default="all-MiniLM-L6-v2")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--semantic-negatives", type=int, default=5)
    parser.add_argument("--same-parent-negatives", type=int, default=3)
    parser.add_argument("--random-negatives", type=int, default=2)
    parser.add_argument("--sample-products", type=int, default=0)
    parser.add_argument("--random-seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.random_seed)
    products = pd.read_parquet(args.products)
    products = products[products.get("is_valid_product", True)].copy()
    if args.sample_products:
        products = products.sample(n=min(args.sample_products, len(products)), random_state=args.random_seed).copy()
    clusters = pd.read_parquet(args.clusters)
    brand_prior = pd.read_parquet(args.brand_prior) if Path(args.brand_prior).exists() else pd.DataFrame()

    query_texts = products["product_text_for_embedding"].fillna("").astype(str).tolist()
    cluster_texts = clusters["cluster_profile_text"].fillna("").astype(str).tolist()
    sim, similarity_report = build_similarity(query_texts, cluster_texts, args.embedding_model, args.offline)

    cluster_ids = clusters["cluster_id"].astype(str).tolist()
    cluster_names = dict(zip(clusters["cluster_id"].astype(str), clusters["cluster_name"].astype(str)))
    cluster_first = dict(zip(clusters["cluster_id"].astype(str), clusters["first_category_name"].fillna("").astype(str)))
    cluster_index = {cid: i for i, cid in enumerate(cluster_ids)}
    cache = build_cluster_feature_cache(clusters)

    by_parent: dict[str, list[str]] = {}
    for cid, parent in cluster_first.items():
        by_parent.setdefault(str(parent).strip().lower(), []).append(cid)

    rows: list[dict] = []
    negative_type_counts: Counter[str] = Counter()
    for row_pos, product in enumerate(products.itertuples(index=False)):
        query_id = str(getattr(product, "row_id"))
        true_cluster_id = str(getattr(product, "cluster_id"))
        true_cluster_name = str(getattr(product, "cluster_name", cluster_names.get(true_cluster_id, "")))
        query_text = str(getattr(product, "product_text_for_embedding", ""))
        query_brand_norm = str(getattr(product, "brand_norm", ""))
        query_first_category = str(getattr(product, "first_category_name_clean", ""))
        order = np.argsort(-sim[row_pos])
        rank_by_cluster = {cluster_ids[int(idx)]: rank + 1 for rank, idx in enumerate(order)}

        candidates: dict[str, str] = {true_cluster_id: "positive"}
        for idx in order:
            cid = cluster_ids[int(idx)]
            if cid != true_cluster_id:
                candidates.setdefault(cid, "semantic_hard_negative")
            if sum(1 for t in candidates.values() if t == "semantic_hard_negative") >= args.semantic_negatives:
                break
        parent_key = query_first_category.strip().lower()
        same_parent = [cid for cid in by_parent.get(parent_key, []) if cid != true_cluster_id]
        for cid in choose(same_parent, args.same_parent_negatives, rng):
            candidates.setdefault(cid, "same_parent_negative")
        random_pool = [cid for cid in cluster_ids if cid != true_cluster_id]
        for cid in choose(random_pool, args.random_negatives, rng):
            candidates.setdefault(cid, "random_negative")

        for cid, negative_type in candidates.items():
            cidx = cluster_index.get(cid)
            if cidx is None:
                continue
            candidate_rank = rank_by_cluster.get(cid, len(cluster_ids))
            semantic_score = float(sim[row_pos, cidx])
            label = int(cid == true_cluster_id)
            features = build_pair_features(
                query_text=query_text,
                query_brand_norm=query_brand_norm,
                query_first_category=query_first_category,
                candidate_cluster_id=cid,
                candidate_rank=candidate_rank,
                semantic_score=semantic_score,
                cluster_cache=cache,
                brand_prior=brand_prior,
            )
            rows.append({
                "query_id": query_id,
                "query_type": "internal_product",
                "query_text": query_text,
                "query_brand_norm": query_brand_norm,
                "query_first_category": query_first_category,
                "true_cluster_id": true_cluster_id,
                "true_cluster_name": true_cluster_name,
                "candidate_cluster_id": cid,
                "candidate_cluster_name": cluster_names.get(cid, ""),
                "label": label,
                "negative_type": negative_type,
                **features,
            })
            if not label:
                negative_type_counts[negative_type] += 1

    out = pd.DataFrame(rows)
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    report = {
        "number_of_products": int(len(products)),
        "number_of_clusters": int(len(clusters)),
        "products": int(len(products)),
        "clusters": int(len(clusters)),
        "total_pairs": int(len(out)),
        "positive_pairs": int(out["label"].sum()) if len(out) else 0,
        "negative_pairs": int((out["label"] == 0).sum()) if len(out) else 0,
        "average_pairs_per_query": float(len(out) / max(products["row_id"].nunique(), 1)),
        "negative_type_counts": {k: int(v) for k, v in negative_type_counts.items()},
        "similarity_method": similarity_report,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json(Path(args.report), report)
    log.info("Wrote %d reranker training pairs -> %s", len(out), args.output)


if __name__ == "__main__":
    main()
