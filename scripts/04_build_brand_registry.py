#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import brand_display, ensure_parent, google_brand_url, normalize_brand, safe_read_table

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("build_brand_registry")


def col(df: pd.DataFrame, *names: str) -> pd.Series:
    lower = {c.lower().strip(): c for c in df.columns}
    for name in names:
        if name.lower() in lower:
            return df[lower[name.lower()]]
    return pd.Series([""] * len(df), index=df.index)


def split_aliases(value: object) -> list[str]:
    text = "" if pd.isna(value) else str(value)
    return [v.strip() for v in text.replace("|", ",").replace(";", ",").split(",") if v.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/raw/brand_whitelist.csv")
    parser.add_argument("--output", default="data/processed/brand_registry.parquet")
    parser.add_argument("--alias-output", default="data/processed/brand_alias_lookup.parquet")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    df = safe_read_table(Path(args.input))
    if args.sample:
        df = df.head(args.sample).copy()
    name = col(df, "standard_brand_name", "brand_name")
    fallback = col(df, "brand_name")
    display = [brand_display(n) or brand_display(f) for n, f in zip(name, fallback)]
    out = pd.DataFrame()
    out["brand_display"] = display
    out["brand_norm"] = out["brand_display"].map(normalize_brand)
    out = out[out["brand_norm"].ne("")].drop_duplicates("brand_norm").copy()
    raw_by_norm = pd.DataFrame({
        "brand_norm": [normalize_brand(v) for v in display],
        "brand_id": col(df, "brand_id").astype(str),
        "primary_cluster_id": col(df, "primary_cluster_id", "second_category_id").astype(str),
        "primary_cluster_name": col(df, "primary_cluster_name", "second_category_name").astype(str),
        "brand_aliases": col(df, "brand_aliases"),
    }).drop_duplicates("brand_norm")
    out = out.merge(raw_by_norm, on="brand_norm", how="left")
    out["aliases"] = out["brand_aliases"].map(lambda v: split_aliases(v))
    out["in_platform_brand"] = True
    out["brand_description"] = ""
    out["google_search_url"] = out["brand_display"].map(google_brand_url)
    out["review_status"] = "approved"
    out["source"] = "whitelist"
    out["updated_at"] = datetime.now(timezone.utc).isoformat()
    out = out[[
        "brand_norm", "brand_display", "brand_id", "aliases", "in_platform_brand",
        "primary_cluster_id", "primary_cluster_name", "brand_description",
        "google_search_url", "review_status", "source", "updated_at",
    ]]
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)

    alias_rows = []
    for row in out.itertuples(index=False):
        variants = set(row.aliases or [])
        variants.add(row.brand_display)
        for alias in variants:
            an = normalize_brand(alias)
            if an:
                alias_rows.append({
                    "alias_norm": an,
                    "brand_norm": row.brand_norm,
                    "brand_display": row.brand_display,
                    "source": "whitelist",
                })
    alias_df = pd.DataFrame(alias_rows).drop_duplicates(["alias_norm", "brand_norm"])
    alias_df.to_parquet(args.alias_output, index=False)
    log.info("Wrote %d brands and %d aliases", len(out), len(alias_df))


if __name__ == "__main__":
    main()
