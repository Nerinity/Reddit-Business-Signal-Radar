#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd


def normalize_brand(value) -> str:
    text = "" if pd.isna(value) else unicodedata.normalize("NFKC", str(value)).casefold()
    text = re.sub(r"[^\w\s-]+", " ", text)
    return re.sub(r"[\s_-]+", " ", text).strip()


def url_priority(url: str) -> tuple[int, str]:
    host = urlparse(url).netloc.casefold()
    if host == "icons.duckduckgo.com":
        return 0, url
    if host.endswith("wikimedia.org"):
        return 1, url
    if "tiktokcdn.com" not in host:
        return 2, url
    return 3, url


def choose_url(urls: list[str]) -> str:
    counts = Counter(urls)
    return min(counts, key=lambda url: (url_priority(url), -counts[url]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the compact UI logo map for all recognized dashboard brands.")
    parser.add_argument("--logo-source", required=True)
    parser.add_argument("--registry", default="data/processed/brand_registry.parquet")
    parser.add_argument("--output", default="apps/next/public/data/brand-logos.json")
    args = parser.parse_args()

    source = pd.read_parquet(
        args.logo_source,
        columns=["brand_id", "brand_name", "standard_brand_name", "logo_url"],
    )
    source["logo_url"] = source["logo_url"].fillna("").astype(str).str.strip()
    source = source[source["logo_url"].ne("")].copy()
    source["brand_id_key"] = source["brand_id"].fillna("").astype(str).str.strip()

    urls_by_id: dict[str, list[str]] = defaultdict(list)
    urls_by_name: dict[str, list[str]] = defaultdict(list)
    for row in source.itertuples(index=False):
        if row.brand_id_key:
            urls_by_id[row.brand_id_key].append(row.logo_url)
        for value in (row.brand_name, row.standard_brand_name):
            key = normalize_brand(value)
            if key and key not in {"null", "nan", "none"}:
                urls_by_name[key].append(row.logo_url)

    registry = pd.read_parquet(
        args.registry,
        columns=["brand_norm", "brand_display", "brand_id", "is_whitelist_brand"],
    )
    recognized = registry.copy()
    logo_map: dict[str, str] = {}
    id_matches = 0
    name_matches = 0
    for row in recognized.itertuples(index=False):
        brand_id = "" if pd.isna(row.brand_id) else str(row.brand_id).strip()
        urls = urls_by_id.get(brand_id, []) if brand_id else []
        if urls:
            id_matches += 1
        else:
            for value in (row.brand_norm, row.brand_display):
                urls = urls_by_name.get(normalize_brand(value), [])
                if urls:
                    name_matches += 1
                    break
        if urls:
            logo_map[str(row.brand_norm)] = choose_url(urls)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "recognized_brand_count": int(len(recognized)),
                "logo_count": len(logo_map),
                "logos": dict(sorted(logo_map.items())),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(
        f"Wrote {len(logo_map)} recognized-brand logos ({id_matches} ID matches, "
        f"{name_matches} name matches) to {output}"
    )


if __name__ == "__main__":
    main()
