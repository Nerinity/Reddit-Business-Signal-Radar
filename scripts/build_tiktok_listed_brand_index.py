#!/usr/bin/env python3
"""Build the audited TikTok-listed brand index used by the dashboard bundle.

The index is the normalized-name union of the full-domain brand_name column and the
million-row TikTok Shop whitelist brand_name column, followed by name-quality filtering.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import normalize_brand


def normalized_brand_names(frame: pd.DataFrame) -> set[str]:
    if "brand_name" not in frame.columns:
        raise ValueError("Input is missing required brand_name column")
    values = frame["brand_name"].fillna("").astype(str).map(normalize_brand)
    return {value for value in values if value}


AUDIT_DENYLIST = {
    "100%", "beginner", "charger", "clothing online", "clothing shop", "dining room",
    "dupe", "hair mask", "other brands", "seller", "the gym", "the ingredients",
}
GENERIC_PRODUCT_WORDS = {
    "accessories", "acid", "backpack", "beauty", "brand", "brands", "care", "charger",
    "clothing", "coffee", "dining", "food", "gift", "gifts", "hair", "ingredients",
    "mask", "market", "product", "products", "room", "seller", "shop", "skincare",
    "store", "style",
}


def is_unambiguous_brand_name(brand_norm: str, whitelist_frequency: int) -> bool:
    """Reject names likely to be ordinary Reddit prose rather than a brand mention.

    Repeated occurrences in the authoritative whitelist protect established brands whose
    names are also dictionary words (for example Apple). Rare common-word registrations
    remain valid catalog rows, but are too ambiguous for automatic Reddit labeling.
    """
    if brand_norm in AUDIT_DENYLIST:
        return False
    compact = brand_norm.replace(" ", "")
    if len(compact) <= 2 or compact.isdigit():
        return False
    tokens = brand_norm.split()
    if tokens and all(token in GENERIC_PRODUCT_WORDS for token in tokens):
        return False
    frequencies = [zipf_frequency(token, "en") for token in tokens]
    if len(tokens) == 1 and frequencies[0] >= 3.5 and whitelist_frequency < 5:
        return False
    if len(tokens) > 1 and min(frequencies) >= 4.0 and whitelist_frequency < 5:
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Build audited TikTok-listed brand norms.")
    parser.add_argument("--full-domain", default="data/raw/Brand List Available全域.xlsx")
    parser.add_argument("--whitelist", required=True)
    parser.add_argument("--registry", default="data/processed/brand_registry.parquet")
    parser.add_argument("--output", default="configs/taxonomy/tiktok_listed_brand_norms.json")
    args = parser.parse_args()

    full_domain = pd.read_excel(args.full_domain, usecols=["brand_name"])
    whitelist = pd.read_parquet(args.whitelist, columns=["brand_name"])
    registry = pd.read_parquet(args.registry, columns=["brand_norm"])

    full_norms = normalized_brand_names(full_domain)
    whitelist_values = whitelist["brand_name"].fillna("").astype(str).map(normalize_brand)
    whitelist_counts = whitelist_values[whitelist_values.ne("")].value_counts().to_dict()
    whitelist_norms = set(whitelist_counts)
    quality_norms = {str(value).strip() for value in registry["brand_norm"] if str(value).strip()}
    source_union = full_norms | whitelist_norms
    listed_norms = sorted(
        norm for norm in source_union
        if norm in quality_norms or norm in whitelist_norms
        if is_unambiguous_brand_name(norm, int(whitelist_counts.get(norm, 0)))
    )

    payload = {
        "version": 1,
        "definition": "(full_domain.brand_name ∪ whitelist.brand_name) ∩ unambiguous_name_gate",
        "brand_count": len(listed_norms),
        "brand_norms": listed_norms,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(listed_norms):,} audited brand norms to {output}")


if __name__ == "__main__":
    main()
