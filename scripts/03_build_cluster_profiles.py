#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, json_list, parse_json_list, word_tokens

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("build_cluster_profiles")


def top_terms(texts: list[str], n: int = 30) -> list[str]:
    stop = {"the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "product"}
    c = Counter()
    for text in texts:
        c.update(t for t in word_tokens(text) if len(t) > 2 and t not in stop)
    return [k for k, _ in c.most_common(n)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed/clean_internal_products.parquet")
    parser.add_argument("--output", default="data/processed/cluster_profiles_226.parquet")
    parser.add_argument("--sample-products", type=int, default=12)
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    df = df[df.get("is_valid_product", True)].copy()
    rows = []
    for cid, grp in df.groupby("cluster_id", dropna=False):
        grp = grp.copy()
        cname = grp["cluster_name"].dropna().astype(str).mode()
        first = grp["first_category_name_clean"].dropna().astype(str).mode()
        leaf_counter = Counter()
        for v in grp["leaf_keywords_clean"]:
            leaf_counter.update(parse_json_list(v))
        brands = [b for b, _ in Counter(grp["brand_display"][grp["brand_display"].astype(str).str.len() > 0]).most_common(20)]
        samples = grp["product_name_clean"].dropna().astype(str).drop_duplicates().head(args.sample_products).tolist()
        terms = top_terms(samples + grp["second_category_name_clean"].astype(str).head(100).tolist())
        leaf_top = [k for k, _ in leaf_counter.most_common(30)]
        cluster_name = cname.iloc[0] if len(cname) else str(cid)
        first_name = first.iloc[0] if len(first) else ""
        rows.append({
            "cluster_id": str(cid),
            "cluster_name": cluster_name,
            "first_category_name": first_name,
            "leaf_keywords_top": json_list(leaf_top),
            "top_brands": json_list(brands),
            "sample_product_titles": json_list(samples),
            "top_product_terms": json_list(terms),
            "product_count": int(len(grp)),
            "cluster_profile_text": (
                f"Cluster: {cluster_name}.\n"
                f"Parent category: {first_name}.\n"
                f"Leaf keywords: {', '.join(leaf_top[:20])}.\n"
                f"Representative brands: {', '.join(brands[:15])}.\n"
                f"Representative products: {', '.join(samples[:8])}.\n"
                f"Common product terms: {', '.join(terms[:20])}."
            ),
            "low_sample_cluster": bool(len(grp) < 30),
        })
    out = pd.DataFrame(rows).sort_values("cluster_id")
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    # Compatibility aliases used by downstream scripts and docs.
    out.to_parquet("data/processed/cluster_profiles.parquet", index=False)
    out.to_parquet("data/processed/cluster_profiles_2nd.parquet", index=False)
    log.info("Wrote %d cluster profiles -> %s", len(out), args.output)


if __name__ == "__main__":
    main()
