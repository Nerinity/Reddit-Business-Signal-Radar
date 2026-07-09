#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
import os
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, parse_json_list, word_tokens, write_json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("match_clusters")


def sentence_transformer_similarity(
    post_texts: list[str],
    cluster_texts: list[str],
    model_name: str,
    offline: bool,
) -> tuple[np.ndarray | None, str | None]:
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        if offline:
            os.environ["HF_HUB_OFFLINE"] = "1"
        try:
            model = SentenceTransformer(model_name, local_files_only=offline)
        except TypeError:
            model = SentenceTransformer(model_name)
        cemb = model.encode(cluster_texts, normalize_embeddings=True, show_progress_bar=False)
        pemb = model.encode(post_texts, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(pemb, dtype="float32") @ np.asarray(cemb, dtype="float32").T, None
    except Exception as exc:
        reason = f"SentenceTransformer unavailable: {exc}"
        log.info("%s; using lexical fallback", reason)
        return None, reason


def tfidf_similarity(post_texts: list[str], cluster_texts: list[str]) -> tuple[np.ndarray | None, str | None]:
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
        from sklearn.metrics.pairwise import cosine_similarity  # type: ignore

        vectorizer = TfidfVectorizer(min_df=1, ngram_range=(1, 2), max_features=50000)
        matrix = vectorizer.fit_transform(cluster_texts + post_texts)
        return cosine_similarity(matrix[len(cluster_texts) :], matrix[: len(cluster_texts)]), None
    except Exception as exc:
        reason = f"sklearn unavailable: {exc}"
        log.info("%s; using bag-of-words fallback", reason)
        return None, reason


def bow_similarity(post_texts: list[str], cluster_texts: list[str]) -> np.ndarray:
    cluster_counts = [Counter(word_tokens(t)) for t in cluster_texts]
    post_counts = [Counter(word_tokens(t)) for t in post_texts]
    vocab = sorted(set().union(*(c.keys() for c in cluster_counts + post_counts)))
    index = {term: i for i, term in enumerate(vocab)}

    def to_vec(counter: Counter[str]) -> np.ndarray:
        vec = np.zeros(len(index), dtype="float32")
        for term, value in counter.items():
            vec[index[term]] = float(value)
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec

    cmat = np.vstack([to_vec(c) for c in cluster_counts])
    pmat = np.vstack([to_vec(c) for c in post_counts])
    return pmat @ cmat.T


def build_similarity(post_texts: list[str], cluster_texts: list[str], model_name: str, offline: bool) -> tuple[np.ndarray, dict]:
    semantic, st_reason = sentence_transformer_similarity(post_texts, cluster_texts, model_name, offline)
    if semantic is not None:
        return semantic, {
            "similarity_method": "sentence_transformer",
            "embedding_model": model_name,
            "fallback_reason": "",
        }
    sim, tfidf_reason = tfidf_similarity(post_texts, cluster_texts)
    if sim is not None:
        return np.asarray(sim), {
            "similarity_method": "tfidf",
            "embedding_model": None,
            "fallback_reason": st_reason or "",
        }
    return bow_similarity(post_texts, cluster_texts), {
        "similarity_method": "bow",
        "embedding_model": None,
        "fallback_reason": "; ".join(v for v in [st_reason, tfidf_reason] if v),
    }


def cluster_terms(row) -> set[str]:
    terms = set(word_tokens(str(getattr(row, "cluster_name", ""))))
    for field in ["leaf_keywords_top", "top_product_terms", "top_product_phrases", "sample_product_titles"]:
        for item in parse_json_list(getattr(row, field, "")):
            terms.update(word_tokens(item))
    return {t for t in terms if len(t) > 2}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_profiles_226.parquet")
    parser.add_argument("--entities", default="data/processed/entity_mentions.parquet")
    parser.add_argument("--output", default="data/processed/cluster_assignments.parquet")
    parser.add_argument("--embedding-model", default="all-MiniLM-L6-v2")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--similarity-report", default="data/processed/cluster_matching_similarity_report.json")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    posts = pd.read_parquet(args.posts)
    if args.sample:
        posts = posts.head(args.sample).copy()
    clusters = pd.read_parquet(args.clusters)
    entities = pd.read_parquet(args.entities) if Path(args.entities).exists() else pd.DataFrame()

    post_texts = posts["text_for_embedding"].fillna("").astype(str).tolist()
    cluster_texts = clusters["cluster_profile_text"].fillna("").astype(str).tolist()
    sim, similarity_report = build_similarity(post_texts, cluster_texts, args.embedding_model, args.offline)

    cluster_term_sets = [cluster_terms(r) for r in clusters.itertuples(index=False)]
    entity_by_post: dict[str, pd.DataFrame] = {}
    if len(entities):
        for mention_id, group in entities.groupby("mention_id"):
            entity_by_post[str(mention_id)] = group

    rows = []
    k = max(1, min(args.top_k, len(clusters)))
    for i, post in enumerate(posts.itertuples(index=False)):
        mention_id = str(post.mention_id)
        order = np.argsort(-sim[i])[:k]
        post_terms = set(word_tokens(str(getattr(post, "text_for_tokenization", ""))))
        post_entities = entity_by_post.get(mention_id, pd.DataFrame())
        primary_brand_cluster_ids = set()
        related_brand_cluster_ids = set()
        if len(post_entities):
            brand_rows = post_entities[post_entities.get("entity_type", "") == "brand"]
            primary_brand_cluster_ids = {str(v) for v in brand_rows.get("matched_cluster_id", []) if str(v).strip()}
            for value in brand_rows.get("related_cluster_ids", []):
                related_brand_cluster_ids.update(v for v in parse_json_list(value) if str(v).strip())

        candidates = []
        for idx in order:
            c = clusters.iloc[int(idx)]
            semantic = float(sim[i, idx])
            overlap_terms = post_terms.intersection(cluster_term_sets[int(idx)])
            keyword_score = min(len(overlap_terms) / 8.0, 0.2)
            cid = str(c.cluster_id)
            if cid in primary_brand_cluster_ids:
                brand_prior = 0.20
            elif cid in related_brand_cluster_ids:
                brand_prior = 0.10
            else:
                brand_prior = 0.0
            confidence = min(max(semantic, 0.0) * 0.78 + keyword_score + brand_prior, 1.0)
            candidates.append({
                "cluster_id": str(c.cluster_id),
                "cluster_name": str(c.cluster_name),
                "semantic_score": semantic,
                "keyword_overlap_score": keyword_score,
                "brand_prior_score": brand_prior,
                "confidence": confidence,
                "overlap_terms": sorted(overlap_terms)[:20],
            })

        candidates.sort(key=lambda x: x["confidence"], reverse=True)
        top = candidates[0]
        second = candidates[1] if len(candidates) > 1 else {"cluster_id": "", "confidence": 0.0, "semantic_score": 0.0}
        gap = float(top["confidence"] - second["confidence"])
        confidence = float(top["confidence"])
        if confidence >= 0.70 and gap >= 0.10:
            status = "confident"
        elif confidence >= 0.50:
            status = "uncertain"
        else:
            status = "unassigned"
        rows.append({
            "mention_id": mention_id,
            "final_cluster_id": top["cluster_id"] if status != "unassigned" else "",
            "final_cluster_name": top["cluster_name"] if status != "unassigned" else "",
            "assignment_confidence": confidence,
            "assignment_status": status,
            "semantic_score": float(top["semantic_score"]),
            "brand_prior_score": float(top["brand_prior_score"]),
            "keyword_overlap_score": float(top["keyword_overlap_score"]),
            "top2_cluster_id": second.get("cluster_id", ""),
            "top2_score": float(second.get("confidence", 0.0)),
            "score_gap": gap,
            "assignment_reason": f"semantic={top['semantic_score']:.3f}; keyword={top['keyword_overlap_score']:.3f}; brand_prior={top['brand_prior_score']:.3f}",
            "top_candidates_json": json.dumps(candidates, ensure_ascii=False),
        })

    out = pd.DataFrame(rows)
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    alias = Path("data/processed/cluster_assignments_226.parquet")
    ensure_parent(alias)
    out.to_parquet(alias, index=False)
    similarity_report.update({
        "post_count": int(len(posts)),
        "cluster_count": int(len(clusters)),
        "top_k": int(k),
        "output_path": args.output,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    write_json(Path(args.similarity_report), similarity_report)
    log.info("Wrote %d cluster assignments", len(out))


if __name__ == "__main__":
    main()
