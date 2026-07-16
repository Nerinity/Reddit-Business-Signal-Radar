#!/usr/bin/env python3
"""Convert the operations-team Excel mapping into product JSON configuration."""
from __future__ import annotations

import argparse
import json
import logging
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
TEAM_1_COLUMN = "1级运营团队｜ops team 1"
TEAM_2_COLUMN = "2级运营团队｜ops team 2"
CATEGORY_COLUMN = "2级类目名称｜lvl2 category name"
log = logging.getLogger("ops_team_category_mapping")


def normalize_category_name(value: object) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).strip().split()).casefold()


def clean_value(value: object) -> str:
    if pd.isna(value):
        return ""
    return " ".join(unicodedata.normalize("NFKC", str(value)).strip().split())


def build_mapping(frame: pd.DataFrame, *, generated_at: str | None = None) -> tuple[dict, dict]:
    missing_columns = [column for column in (TEAM_1_COLUMN, TEAM_2_COLUMN, CATEGORY_COLUMN) if column not in frame]
    if missing_columns:
        raise ValueError(f"Mapping workbook is missing columns: {', '.join(missing_columns)}")

    source_rows = len(frame)
    valid_rows: list[tuple[str, str, str]] = []
    invalid_rows = 0
    for row in frame[[TEAM_1_COLUMN, TEAM_2_COLUMN, CATEGORY_COLUMN]].itertuples(index=False, name=None):
        team_1, team_2, category = (clean_value(value) for value in row)
        if not team_1 or not team_2 or not category:
            invalid_rows += 1
            log.warning("Skipping invalid mapping row: %r", row)
            continue
        valid_rows.append((team_1, team_2, category))

    deduped: dict[tuple[str, str, str], tuple[str, str, str]] = {}
    for team_1, team_2, category in valid_rows:
        key = (normalize_category_name(team_1), normalize_category_name(team_2), normalize_category_name(category))
        deduped.setdefault(key, (team_1, team_2, category))
    duplicate_rows = len(valid_rows) - len(deduped)

    pair_categories: dict[tuple[str, str], dict[str, str]] = {}
    for team_1, team_2, category in deduped.values():
        pair_categories.setdefault((team_1, team_2), {})[normalize_category_name(category)] = category

    pairs = []
    for (team_1, team_2), categories in sorted(pair_categories.items(), key=lambda item: (item[0][0].casefold(), item[0][1].casefold())):
        pairs.append({
            "identity_key": f"{team_1}::{team_2}",
            "ops_team_1": team_1,
            "ops_team_2": team_2,
            "categories": sorted(categories.values(), key=str.casefold),
        })

    ops_teams = []
    for team_1 in sorted({pair["ops_team_1"] for pair in pairs}, key=str.casefold):
        options = [
            {"ops_team_2": pair["ops_team_2"], "identity_key": pair["identity_key"], "categories": pair["categories"]}
            for pair in pairs if pair["ops_team_1"] == team_1
        ]
        ops_teams.append({"ops_team_1": team_1, "ops_team_2_options": options})

    unique_categories = {normalize_category_name(category) for pair in pairs for category in pair["categories"]}
    quality = {
        "source_rows": source_rows,
        "ops_team_1_count": len(ops_teams),
        "identity_pair_count": len(pairs),
        "unique_category_count": len(unique_categories),
        "mapping_relationship_count": len(deduped),
        "invalid_row_count": invalid_rows,
        "duplicate_row_count": duplicate_rows,
    }
    payload = {
        "version": 1,
        "generated_at": generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "ops_teams": ops_teams,
        "pairs": pairs,
        "quality": quality,
    }
    return payload, quality


def validate_against_dashboard(payload: dict, dashboard_path: Path) -> dict:
    dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
    clusters = dashboard.get("clusters", [])
    cluster_names = {normalize_category_name(item.get("cluster_name", "")): item.get("cluster_name", "") for item in clusters}
    mapping_names = {
        normalize_category_name(category): category
        for pair in payload["pairs"] for category in pair["categories"]
    }
    matched = sorted(set(mapping_names) & set(cluster_names))
    unmatched_mapping = sorted((mapping_names[key] for key in set(mapping_names) - set(cluster_names)), key=str.casefold)
    unmapped_dashboard = sorted((cluster_names[key] for key in set(cluster_names) - set(mapping_names)), key=str.casefold)
    identities = []
    for pair in payload["pairs"]:
        matched_categories = [category for category in pair["categories"] if normalize_category_name(category) in cluster_names]
        identities.append({
            "identity_key": pair["identity_key"],
            "mapped_category_count": len(pair["categories"]),
            "matched_cluster_count": len(matched_categories),
            "matched_categories": matched_categories,
        })
    return {
        "mapping_categories": len(mapping_names),
        "dashboard_clusters": len(cluster_names),
        "matched_categories": len(matched),
        "unmatched_mapping_categories": unmatched_mapping,
        "unmapped_dashboard_clusters": unmapped_dashboard,
        "identities": identities,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="行业vs类目 - 映射关系.xlsx")
    parser.add_argument("--next-output", default="apps/next/public/data/ops-team-category-mapping.json")
    parser.add_argument("--web-output", default="apps/web/public/data/ops-team-category-mapping.json")
    parser.add_argument("--dashboard", default="apps/next/public/data/dashboard.json")
    parser.add_argument("--validation-output", default="data/processed/ops_category_mapping_validation.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    input_path = Path(args.input)
    if not input_path.exists() and args.input == "行业vs类目 - 映射关系.xlsx":
        workspace_copy = ROOT.parent / "outputs" / "category-illustrations" / "行业vs类目-含插画URL.xlsx"
        if workspace_copy.exists():
            input_path = workspace_copy
    if not input_path.exists():
        raise FileNotFoundError(f"Operations mapping workbook not found: {input_path}")
    payload, quality = build_mapping(pd.read_excel(input_path))
    for output in (Path(args.next_output), Path(args.web_output)):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    validation = validate_against_dashboard(payload, Path(args.dashboard))
    validation_path = Path(args.validation_output)
    validation_path.parent.mkdir(parents=True, exist_ok=True)
    validation_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**quality, **{k: validation[k] for k in ("dashboard_clusters", "matched_categories")}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
