#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import (
    brand_display,
    clean_readable_text,
    clean_token_text,
    ensure_parent,
    json_list,
    normalize_brand,
    safe_read_table,
    split_keywords,
    write_json,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("clean_internal_reference")

MARKETING_NOISE = [
    "2026 new", "hot sale", "best seller", "free shipping", "limited time",
    "high quality", "wholesale", "dropshipping",
]


def get_col(df: pd.DataFrame, *names: str) -> pd.Series:
    lower = {c.lower().strip(): c for c in df.columns}
    for name in names:
        if name.lower() in lower:
            return df[lower[name.lower()]]
    return pd.Series([""] * len(df), index=df.index)


def clean_product_name(value: object) -> str:
    text = clean_readable_text(value)
    for phrase in MARKETING_NOISE:
        text = re.sub(re.escape(phrase), " ", text, flags=re.I)
    return clean_readable_text(text)


def write_brand_cluster_prior(products: pd.DataFrame, path: Path, top_n: int = 5) -> None:
    columns = [
        "brand_norm", "brand_display", "cluster_id", "cluster_name",
        "product_count", "cluster_share", "is_primary_cluster", "source",
    ]
    valid = products[
        products["is_valid_product"]
        & products["brand_norm"].str.strip().ne("")
        & products["cluster_id"].str.strip().ne("")
    ].copy()
    if valid.empty:
        out = pd.DataFrame(columns=columns)
    else:
        counts = (
            valid.groupby(["brand_norm", "cluster_id", "cluster_name"], dropna=False)
            .agg(
                brand_display=("brand_display", lambda s: next((v for v in s.astype(str) if v.strip()), "")),
                product_count=("row_id", "count"),
            )
            .reset_index()
            .sort_values(["brand_norm", "product_count"], ascending=[True, False])
        )
        totals = counts.groupby("brand_norm")["product_count"].transform("sum")
        counts["cluster_share"] = counts["product_count"] / totals
        counts["rank"] = counts.groupby("brand_norm")["product_count"].rank(method="first", ascending=False)
        counts["is_primary_cluster"] = counts["rank"].eq(1)
        # Derived from clean_internal_products.parquet -- the brand source files carry no
        # category/cluster columns of their own (see 04_build_brand_registry.py).
        counts["source"] = "internal_products"
        out = counts[counts["rank"].le(top_n)].drop(columns=["rank"])
        out = out[columns]
    ensure_parent(path)
    out.to_parquet(path, index=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/raw/internal_product_category_examples.csv")
    parser.add_argument("--output", default="data/processed/clean_internal_products.parquet")
    parser.add_argument("--report", default="data/processed/clean_internal_products_quality_report.json")
    parser.add_argument("--brand-prior-output", default="data/processed/brand_cluster_prior.parquet")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    df = safe_read_table(Path(args.input))
    if args.sample:
        df = df.head(args.sample).copy()
    raw_count = len(df)
    log.info("Loaded %d product rows", raw_count)

    first_raw = get_col(df, "first_category_name")
    second_raw = get_col(df, "second_category_name")
    second_id = get_col(df, "second_category_id")
    leaf_raw = get_col(df, "leaf_category_name", "v2_leaf_category_name")
    product_raw = get_col(df, "product_name")
    brand_raw = get_col(df, "brand_name", "standard_brand_name")

    out = pd.DataFrame()
    out["row_id"] = range(1, raw_count + 1)
    out["first_category_name_raw"] = first_raw.fillna("").astype(str)
    out["first_category_name_clean"] = out["first_category_name_raw"].map(clean_readable_text)
    out["second_category_id"] = second_id
    out["second_category_name_raw"] = second_raw.fillna("").astype(str)
    out["second_category_name_clean"] = out["second_category_name_raw"].map(clean_readable_text)
    out["cluster_id"] = out["second_category_id"].astype(str)
    out["cluster_name"] = out["second_category_name_clean"]
    out["leaf_category_name_raw"] = leaf_raw.fillna("").astype(str)
    out["leaf_keywords_clean"] = [json_list(split_keywords(v)) for v in out["leaf_category_name_raw"]]
    out["product_name_raw"] = product_raw.fillna("").astype(str)
    out["product_name_clean"] = out["product_name_raw"].map(clean_product_name)
    out["product_name_norm"] = out["product_name_clean"].map(clean_token_text)
    out["brand_name_raw"] = brand_raw.fillna("").astype(str)
    out["brand_display"] = out["brand_name_raw"].map(brand_display)
    out["brand_norm"] = out["brand_name_raw"].map(normalize_brand)
    out["is_valid_product"] = (
        out["cluster_id"].str.strip().ne("")
        & out["cluster_name"].str.strip().ne("")
        & out["product_name_clean"].str.strip().ne("")
    )
    out["product_text_for_embedding"] = [
        f"Brand: {bd}. Product: {pn}. Category: {sc}. Parent category: {fc}. Leaf keywords: {lk}."
        for bd, pn, sc, fc, lk in zip(
            out["brand_display"], out["product_name_clean"], out["second_category_name_clean"],
            out["first_category_name_clean"], out["leaf_keywords_clean"]
        )
    ]
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    write_brand_cluster_prior(out, Path(args.brand_prior_output))

    valid = out[out["is_valid_product"]]
    counts = valid.groupby(["cluster_id", "cluster_name"]).size().reset_index(name="product_count")
    report = {
        "raw_product_count": int(raw_count),
        "valid_product_count": int(len(valid)),
        "cluster_count": int(valid["cluster_id"].nunique()),
        "products_per_cluster_summary": counts["product_count"].describe().to_dict() if len(counts) else {},
        "missing_brand_rate": float(valid["brand_norm"].eq("").mean()) if len(valid) else 0.0,
        "missing_product_name_rate": float(valid["product_name_clean"].eq("").mean()) if len(valid) else 0.0,
        "missing_cluster_id_rate": float(out["cluster_id"].eq("").mean()) if len(out) else 0.0,
        "top_clusters_by_product_count": counts.sort_values("product_count", ascending=False).head(20).to_dict("records"),
        "low_sample_clusters": counts[counts["product_count"] < 30].to_dict("records"),
    }
    write_json(Path(args.report), report)
    log.info("Wrote clean products -> %s", args.output)


if __name__ == "__main__":
    main()
