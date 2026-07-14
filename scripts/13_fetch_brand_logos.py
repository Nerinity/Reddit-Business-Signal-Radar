#!/usr/bin/env python3
"""Enrich brand_registry.parquet with a best-effort logo_url for whitelist brands.

Scope: whitelist brands only (is_whitelist_brand=True). These are the ~400-500 manually
approved, genuinely real brand names -- guessing "brandname.com" as their domain and
checking a public favicon service is reasonably reliable here. Catalog brands
(is_catalog_brand=True) are deliberately NOT attempted: the 100k-row catalog contains
large amounts of plain-English noise ("Reliable", "Handheld", "Seller"...), and a
wrong-but-valid domain guess for one of those would silently show some real company's
icon mislabeled as that "brand" -- worse than the current initials placeholder, which
is at least honestly blank rather than misleadingly specific.

Uses icons.duckduckgo.com's public favicon-by-domain endpoint -- no API key, and not a
scrape of Google Image search results (which would be a ToS problem); this is a
documented favicon lookup service. Every candidate URL is verified with a live request
before being written, so a wrong domain guess (404, or a suspiciously tiny/placeholder
response) is simply left blank rather than persisted as a bad logo_url -- the frontend
BrandAvatar's onError fallback would catch it anyway, but there is no reason to ship a
URL already known to be dead.
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("fetch_brand_logos")

FAVICON_URL = "https://icons.duckduckgo.com/ip3/{domain}.ico"
MIN_RESPONSE_BYTES = 200  # DuckDuckGo's "no favicon found" response is a tiny stub image.

# Multi-word whitelist brands whose real domain isn't just the name with spaces
# stripped -- hand-mapped rather than guessed.
DOMAIN_OVERRIDES = {
    "saint laurent": "ysl.com",
}


def guess_domain(brand_display: str) -> str:
    norm = brand_display.strip().lower()
    if norm in DOMAIN_OVERRIDES:
        return DOMAIN_OVERRIDES[norm]
    slug = re.sub(r"[^a-z0-9]", "", norm)
    return f"{slug}.com" if slug else ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Best-effort logo_url enrichment for whitelist brands.")
    parser.add_argument("--registry", default="data/processed/brand_registry.parquet")
    parser.add_argument("--output", default="data/processed/brand_registry.parquet")
    parser.add_argument("--report-output", default="data/processed/brand_logo_fetch_report.json")
    parser.add_argument("--timeout", type=float, default=4.0)
    parser.add_argument("--sample", type=int, default=0, help="Debug cap on whitelist brands to attempt.")
    args = parser.parse_args()

    registry = pd.read_parquet(args.registry)
    if "logo_url" not in registry.columns:
        registry["logo_url"] = ""
    registry["logo_url"] = registry["logo_url"].fillna("").astype(str)

    whitelist_idx = list(registry.index[registry["is_whitelist_brand"].fillna(False)])
    if args.sample:
        whitelist_idx = whitelist_idx[: args.sample]

    session = requests.Session()
    session.headers.update({"User-Agent": "reddit-business-signal-radar/logo-fetch (+internal tool)"})

    checked = 0
    found = 0
    misses: list[str] = []
    for idx in whitelist_idx:
        brand_display = str(registry.at[idx, "brand_display"])
        if registry.at[idx, "logo_url"]:
            continue
        domain = guess_domain(brand_display)
        if not domain:
            continue
        url = FAVICON_URL.format(domain=domain)
        checked += 1
        try:
            resp = session.get(url, timeout=args.timeout)
            ok = resp.status_code == 200 and len(resp.content) > MIN_RESPONSE_BYTES
        except requests.RequestException:
            ok = False
        if ok:
            registry.at[idx, "logo_url"] = url
            found += 1
        else:
            misses.append(brand_display)
        if checked % 50 == 0:
            log.info("Checked %d/%d, found %d so far", checked, len(whitelist_idx), found)

    ensure_parent(Path(args.output))
    registry.to_parquet(args.output, index=False)

    import json

    report = {
        "whitelist_brand_count": len(whitelist_idx),
        "checked": checked,
        "logo_found": found,
        "hit_rate": round(found / checked, 3) if checked else 0.0,
        "sample_misses": misses[:40],
    }
    ensure_parent(Path(args.report_output))
    Path(args.report_output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Logo enrichment: %d/%d whitelist brands got a verified logo_url -> %s", found, checked, args.output)


if __name__ == "__main__":
    main()
