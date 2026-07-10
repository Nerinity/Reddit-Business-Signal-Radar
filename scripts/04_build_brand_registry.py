#!/usr/bin/env python3
"""Build the unified brand registry from two sources of different confidence.

  data/raw/brand_whitelist.csv              high-confidence, manually approved brands
  data/raw/Brand List Available全域.xlsx     broader full-domain known brand catalog

A brand's tier is preserved, not collapsed:

  is_whitelist_brand=True                    approved platform brand (brand_source includes "whitelist")
  is_catalog_brand=True, is_whitelist=False   observed in the full-domain catalog only (brand_source="catalog_only")

Both are "in_platform_brand" (known to the platform), which is a different, wider set than
"is_whitelist_brand" (manually approved). Reddit regex candidates that match neither source stay
out of this registry entirely -- see entity_type="unknown_candidate" in 07_extract_entities.py.
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import (
    brand_display,
    ensure_parent,
    google_brand_url,
    json_list,
    normalize_brand,
    safe_read_table,
    top_counts,
    write_json,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("build_brand_registry")

REGISTRY_COLUMNS = [
    "brand_norm", "brand_display", "brand_id", "aliases", "is_whitelist_brand", "is_catalog_brand",
    "in_platform_brand", "brand_source", "review_status", "primary_cluster_id", "primary_cluster_name",
    "related_cluster_ids", "google_search_url", "updated_at",
]

# The full-domain catalog is a raw, unvetted scrape (100k rows) -- far too large to hand-curate
# a denylist for the way configs/taxonomy/brand_denylist.csv does for the 500-row whitelist. In
# practice it contains large amounts of ordinary English phrase fragments filed as "brand_name"
# ("with me", "say yes", "in one", "The good"). Real brand names essentially never consist
# entirely of function words, so any catalog entry made up only of these is dropped structurally
# rather than guessed at brand-by-brand.
ENGLISH_STOPWORDS = {
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours",
    "yourself", "yourselves", "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves", "what", "which",
    "who", "whom", "this", "that", "these", "those", "am", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an",
    "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", "at", "by", "for",
    "with", "about", "against", "between", "into", "through", "during", "before", "after",
    "above", "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under",
    "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don",
    "should", "now", "d", "ll", "m", "o", "re", "ve", "y", "yes", "one",
}

# Corpus word-frequency check (catches ordinary words the stopword list above doesn't cover --
# "Monday", "Keep", "Feel", "Social Media", "Give Me" are all literal rows in the 100k-row
# catalog). Calibrated against sampled real brand names (Sony=4.19, Supreme=4.69, Nike=3.88 all
# survive) vs. confirmed catalog junk (Monitor=4.37, Monday=4.80, Make=6.08 all get rejected).
# Multi-word phrases use a slightly higher bar since a phrase needs every word to be common
# before it reads as a generic sentence fragment rather than an unusual brand name.
SINGLE_WORD_ZIPF_LIMIT = 4.3
MULTI_WORD_ZIPF_LIMIT = 4.5

try:
    from wordfreq import zipf_frequency

    def is_common_english_phrase(brand_norm: str) -> bool:
        tokens = brand_norm.split()
        if not tokens:
            return False
        limit = SINGLE_WORD_ZIPF_LIMIT if len(tokens) == 1 else MULTI_WORD_ZIPF_LIMIT
        return min(zipf_frequency(tok, "en") for tok in tokens) >= limit
except ImportError:
    log.warning("wordfreq not installed; falling back to the stopword-only phrase filter for catalog brands.")

    def is_common_english_phrase(brand_norm: str) -> bool:
        return False


def is_stopword_only_phrase(brand_norm: str) -> bool:
    tokens = brand_norm.split()
    return bool(tokens) and all(tok in ENGLISH_STOPWORDS for tok in tokens)


def col(df: pd.DataFrame, *names: str) -> pd.Series:
    lower = {c.lower().strip(): c for c in df.columns}
    for name in names:
        if name.lower() in lower:
            return df[lower[name.lower()]]
    return pd.Series([""] * len(df), index=df.index)


def split_aliases(value: object) -> list[str]:
    text = "" if pd.isna(value) else str(value)
    return [v.strip() for v in text.replace("|", ",").replace(";", ",").split(",") if v.strip()]


def is_missing(value: object) -> bool:
    text = "" if pd.isna(value) else str(value).strip()
    return text == "" or text.lower() in {"nan", "none", "null"}


def is_blank_name(value: object) -> bool:
    return pd.isna(value) or str(value).strip() == ""


def load_denylist_norms(path: Path) -> set[str]:
    """Normalized brand_norm values to drop: generic dictionary words, colors, materials,
    placeholder text, etc. that end up looking like "brand" entries in either source file.
    See configs/taxonomy/brand_denylist.csv for the curated list and why each was excluded.
    """
    if not path.exists():
        return set()
    df = pd.read_csv(path)
    return {normalize_brand(v) for v in df["term"] if normalize_brand(v)}


def extract_brand_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize a raw brand source (whitelist CSV or full-domain catalog XLSX) into a common
    shape. Columns the source doesn't have (brand_id, category, aliases) come back blank via
    col()'s fallback -- callers must tolerate that, not require it.
    """
    name = col(df, "standard_brand_name", "brand_name")
    fallback = col(df, "brand_name")
    display = [brand_display(n) or brand_display(f) for n, f in zip(name, fallback)]
    frame = pd.DataFrame({
        "brand_display": display,
        "brand_id": col(df, "brand_id").astype(str),
        "primary_cluster_id": col(df, "primary_cluster_id", "second_category_id", "cluster_id").astype(str),
        "primary_cluster_name": col(df, "primary_cluster_name", "second_category_name", "cluster_name", "first_category_name").astype(str),
        "brand_aliases_raw": col(df, "brand_aliases", "aliases"),
    })
    frame["brand_norm"] = frame["brand_display"].map(normalize_brand)
    frame = frame[frame["brand_norm"].ne("")]
    frame = frame[~frame["brand_norm"].map(is_stopword_only_phrase)]
    frame = frame[~frame["brand_norm"].map(is_common_english_phrase)]
    return frame.copy()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the unified whitelist + full-domain-catalog brand registry.")
    parser.add_argument("--whitelist", default="data/raw/brand_whitelist.csv")
    parser.add_argument("--catalog", default="data/raw/Brand List Available全域.xlsx")
    parser.add_argument("--output", default="data/processed/brand_registry.parquet")
    parser.add_argument("--alias-output", default="data/processed/brand_alias_lookup.parquet")
    parser.add_argument("--brand-prior", default="data/processed/brand_cluster_prior.parquet")
    parser.add_argument("--denylist", default="configs/taxonomy/brand_denylist.csv")
    parser.add_argument("--quality-report", default="data/processed/brand_source_quality_report.json")
    parser.add_argument("--sample", type=int, default=0, help="Debug/smoke cap applied independently to each source file (0 = full).")
    args = parser.parse_args()

    whitelist_path = Path(args.whitelist)
    catalog_path = Path(args.catalog)
    whitelist_df = safe_read_table(whitelist_path) if whitelist_path.exists() else pd.DataFrame()
    catalog_df = safe_read_table(catalog_path) if catalog_path.exists() else pd.DataFrame()
    if not catalog_path.exists():
        log.warning("Full-domain catalog file not found at %s -- registry will be whitelist-only.", catalog_path)
    if args.sample:
        whitelist_df = whitelist_df.head(args.sample).copy()
        catalog_df = catalog_df.head(args.sample).copy()

    def count_missing_names(df: pd.DataFrame) -> int:
        # A row only truly lacks a brand name if BOTH standard_brand_name and brand_name are
        # blank -- brand_display() already falls back from the former to the latter, so a blank
        # standard_brand_name alone (common and expected) is not a data-loss signal.
        if not len(df):
            return 0
        primary = col(df, "standard_brand_name", "brand_name")
        fallback = col(df, "brand_name")
        return int(sum(is_blank_name(p) and is_blank_name(f) for p, f in zip(primary, fallback)))

    missing_whitelist = count_missing_names(whitelist_df)
    missing_catalog = count_missing_names(catalog_df)

    wl = extract_brand_frame(whitelist_df) if len(whitelist_df) else pd.DataFrame(columns=["brand_display", "brand_id", "primary_cluster_id", "primary_cluster_name", "brand_aliases_raw", "brand_norm"])
    cat = extract_brand_frame(catalog_df) if len(catalog_df) else pd.DataFrame(columns=["brand_display", "brand_id", "primary_cluster_id", "primary_cluster_name", "brand_aliases_raw", "brand_norm"])

    whitelist_unique_norms = wl["brand_norm"].nunique()
    catalog_unique_norms = cat["brand_norm"].nunique()
    raw_norm_series = pd.concat([wl["brand_norm"], cat["brand_norm"]], ignore_index=True)
    top_duplicates = top_counts(raw_norm_series, 20)

    wl = wl.drop_duplicates("brand_norm")
    cat = cat.drop_duplicates("brand_norm")

    denylist_norms = load_denylist_norms(Path(args.denylist))
    if denylist_norms:
        wl_dropped = wl[wl["brand_norm"].isin(denylist_norms)]
        cat_dropped = cat[cat["brand_norm"].isin(denylist_norms)]
        if len(wl_dropped) or len(cat_dropped):
            log.info(
                "Dropping %d denylisted junk brand entries (%d whitelist, %d catalog)",
                len(wl_dropped) + len(cat_dropped), len(wl_dropped), len(cat_dropped),
            )
        wl = wl[~wl["brand_norm"].isin(denylist_norms)].copy()
        cat = cat[~cat["brand_norm"].isin(denylist_norms)].copy()

    wl_norms = set(wl["brand_norm"])
    cat_norms = set(cat["brand_norm"])
    overlap_norms = wl_norms & cat_norms
    whitelist_only_norms = wl_norms - cat_norms
    catalog_only_norms = cat_norms - wl_norms

    registry = wl.copy()
    registry["is_whitelist_brand"] = True
    registry["is_catalog_brand"] = registry["brand_norm"].isin(cat_norms)
    registry["brand_source"] = registry["is_catalog_brand"].map({True: "whitelist_and_catalog", False: "whitelist_only"})
    registry["review_status"] = "approved"

    catalog_only = cat[cat["brand_norm"].isin(catalog_only_norms)].copy()
    catalog_only["is_whitelist_brand"] = False
    catalog_only["is_catalog_brand"] = True
    catalog_only["brand_source"] = "catalog_only"
    catalog_only["review_status"] = "catalog_observed"

    registry = pd.concat([registry, catalog_only], ignore_index=True)
    registry["in_platform_brand"] = registry["is_whitelist_brand"] | registry["is_catalog_brand"]

    if Path(args.brand_prior).exists():
        prior = pd.read_parquet(args.brand_prior)
        if len(prior):
            primary = prior[prior["is_primary_cluster"]].copy()
            primary = primary[["brand_norm", "cluster_id", "cluster_name"]].rename(columns={
                "cluster_id": "derived_primary_cluster_id",
                "cluster_name": "derived_primary_cluster_name",
            })
            related = (
                prior.groupby("brand_norm")["cluster_id"]
                .apply(lambda s: json_list([v for v in s.astype(str).tolist() if v.strip()]))
                .reset_index(name="related_cluster_ids")
            )
            registry = registry.merge(primary, on="brand_norm", how="left").merge(related, on="brand_norm", how="left")
            missing_id = registry["primary_cluster_id"].map(is_missing)
            registry.loc[missing_id, "primary_cluster_id"] = registry.loc[missing_id, "derived_primary_cluster_id"]
            missing_name = registry["primary_cluster_name"].map(is_missing)
            registry.loc[missing_name, "primary_cluster_name"] = registry.loc[missing_name, "derived_primary_cluster_name"]
            registry = registry.drop(columns=["derived_primary_cluster_id", "derived_primary_cluster_name"])
    if "related_cluster_ids" not in registry.columns:
        registry["related_cluster_ids"] = "[]"
    registry["related_cluster_ids"] = registry["related_cluster_ids"].fillna("[]")

    registry["aliases"] = registry["brand_aliases_raw"].map(lambda v: split_aliases(v))
    registry["google_search_url"] = registry["brand_display"].map(google_brand_url)
    registry["updated_at"] = datetime.now(timezone.utc).isoformat()
    registry = registry[REGISTRY_COLUMNS]
    ensure_parent(Path(args.output))
    registry.to_parquet(args.output, index=False)

    alias_rows = []
    for row in registry.itertuples(index=False):
        variants = set(row.aliases or [])
        variants.add(row.brand_display)
        source = "whitelist" if row.is_whitelist_brand else "catalog"
        for alias in variants:
            an = normalize_brand(alias)
            if an:
                alias_rows.append({
                    "alias_norm": an,
                    "alias_text": alias,
                    "brand_norm": row.brand_norm,
                    "brand_display": row.brand_display,
                    "source": source,
                })
    alias_df = pd.DataFrame(alias_rows).drop_duplicates(["alias_norm", "brand_norm"])
    ensure_parent(Path(args.alias_output))
    alias_df.to_parquet(args.alias_output, index=False)
    log.info("Wrote %d brands and %d aliases", len(registry), len(alias_df))

    def sample_names(norm_set: set[str], frame: pd.DataFrame, n: int = 20) -> list[str]:
        return sorted(frame[frame["brand_norm"].isin(norm_set)]["brand_display"].head(n).tolist())

    report = {
        "brand_whitelist_raw_rows": int(len(whitelist_df)),
        "brand_whitelist_unique_brand_norms": int(whitelist_unique_norms),
        "catalog_brand_raw_rows": int(len(catalog_df)),
        "catalog_brand_unique_brand_norms": int(catalog_unique_norms),
        "overlap_brand_count": len(overlap_norms),
        "whitelist_only_brand_count": len(whitelist_only_norms),
        "catalog_only_brand_count": len(catalog_only_norms),
        "final_brand_registry_count": int(len(registry)),
        "final_alias_count": int(len(alias_df)),
        "missing_brand_name_rows_by_source": {
            "brand_whitelist.csv": missing_whitelist,
            "catalog_xlsx": missing_catalog,
        },
        "top_duplicate_brand_norms": top_duplicates,
        "sample_whitelist_only_brands": sample_names(whitelist_only_norms, wl),
        "sample_catalog_only_brands": sample_names(catalog_only_norms, cat),
        "sample_overlap_brands": sample_names(overlap_norms, wl),
        "catalog_file_found": catalog_path.exists(),
        "catalog_file_path": str(catalog_path),
    }
    write_json(Path(args.quality_report), report)
    log.info(
        "Brand sources: whitelist=%d catalog=%d overlap=%d whitelist_only=%d catalog_only=%d -> registry=%d",
        whitelist_unique_norms, catalog_unique_norms, len(overlap_norms),
        len(whitelist_only_norms), len(catalog_only_norms), len(registry),
    )


if __name__ == "__main__":
    main()
