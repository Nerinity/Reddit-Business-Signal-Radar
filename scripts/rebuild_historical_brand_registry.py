#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps" / "next" / "public" / "data"
OUT = ROOT / "data" / "processed"


def main() -> None:
    rows: dict[str, dict] = {}
    source_files = sorted(DATA.glob("dashboard-*.json")) + [DATA / "dashboard.json"]
    for path in source_files:
        if not path.exists():
            continue
        payload = json.loads(path.read_text())
        for brand in payload.get("brands", []):
            signal_type = str(brand.get("brand_signal_type", ""))
            if signal_type not in {"confirmed_whitelist_brand", "catalog_known_brand"}:
                continue
            norm = str(brand.get("brand_norm", "")).strip()
            display = str(brand.get("brand_display", "")).strip()
            if not norm or not display:
                continue
            aliases = [str(v).strip() for v in brand.get("aliases", []) if str(v).strip()]
            aliases.append(display)
            prior = rows.get(norm)
            is_whitelist = signal_type == "confirmed_whitelist_brand"
            if prior is None:
                rows[norm] = {
                    "brand_norm": norm,
                    "brand_display": display,
                    "brand_id": "",
                    "aliases": sorted(set(aliases), key=str.casefold),
                    "is_whitelist_brand": is_whitelist,
                    "is_catalog_brand": not is_whitelist,
                    "in_platform_brand": bool(brand.get("is_tiktok_shop_listed", False)),
                    "brand_source": "historical_dashboard_whitelist" if is_whitelist else "historical_dashboard_catalog",
                    "review_status": "approved" if is_whitelist else "catalog_observed",
                    "primary_cluster_id": "",
                    "primary_cluster_name": "",
                    "related_cluster_ids": "[]",
                    "google_search_url": brand.get("google_search_url") or f"https://www.google.com/search?q={quote_plus(display + ' brand')}",
                    "logo_url": brand.get("logo_url", ""),
                    "brand_domain": brand.get("brand_domain", "shopping"),
                    "updated_at": pd.Timestamp.utcnow(),
                }
            else:
                prior["aliases"] = sorted(set(prior["aliases"] + aliases), key=str.casefold)
                if is_whitelist:
                    prior["is_whitelist_brand"] = True
                    prior["review_status"] = "approved"
                    prior["brand_source"] = "historical_dashboard_whitelist"

    registry = pd.DataFrame(rows.values()).sort_values(["is_whitelist_brand", "brand_norm"], ascending=[False, True])
    alias_rows = []
    for row in registry.itertuples(index=False):
        for alias in row.aliases:
            alias_norm = " ".join(str(alias).casefold().split())
            if alias_norm:
                alias_rows.append({
                    "alias_norm": alias_norm,
                    "alias_text": alias,
                    "brand_norm": row.brand_norm,
                    "brand_display": row.brand_display,
                    "source": "whitelist" if row.is_whitelist_brand else "catalog",
                })
    aliases = pd.DataFrame(alias_rows).drop_duplicates(["alias_norm", "brand_norm"])
    OUT.mkdir(parents=True, exist_ok=True)
    registry.to_parquet(OUT / "brand_registry.parquet", index=False)
    aliases.to_parquet(OUT / "brand_alias_lookup.parquet", index=False)
    report = {
        "source": "historical GitHub dashboard bundles",
        "source_files": [p.name for p in source_files if p.exists()],
        "registry_count": int(len(registry)),
        "whitelist_count": int(registry["is_whitelist_brand"].sum()),
        "catalog_count": int((~registry["is_whitelist_brand"]).sum()),
        "alias_count": int(len(aliases)),
        "limitation": "Only brands previously published in dashboard bundles are recoverable.",
    }
    (OUT / "brand_source_quality_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
