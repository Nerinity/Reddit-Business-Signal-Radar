import importlib.util
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ops_mapping", ROOT / "scripts" / "build_ops_team_category_mapping.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_mapping_cleanup_many_to_many_and_stable_identity():
    frame = pd.DataFrame({
        module.TEAM_1_COLUMN: [" Team A ", "Team A", "Team B", ""],
        module.TEAM_2_COLUMN: ["Team 2", "Team 2", "Team 2", "invalid"],
        module.CATEGORY_COLUMN: [" Skin  Care ", "Skin Care", "Skin Care", "Category"],
    })
    payload, quality = module.build_mapping(frame, generated_at="2026-07-16T00:00:00Z")
    assert quality == {
        "source_rows": 4,
        "ops_team_1_count": 2,
        "identity_pair_count": 2,
        "unique_category_count": 1,
        "mapping_relationship_count": 2,
        "invalid_row_count": 1,
        "duplicate_row_count": 1,
    }
    assert [pair["identity_key"] for pair in payload["pairs"]] == ["Team A::Team 2", "Team B::Team 2"]
    assert all(pair["categories"] == ["Skin Care"] for pair in payload["pairs"])
    assert payload["version"] == 4


def test_normalization_matches_nfkc_case_and_whitespace():
    assert module.normalize_category_name(" Ｓｋｉｎ   Care ") == "skin care"


def test_csv_source_restores_local_merchants_team(tmp_path):
    source = tmp_path / "mapping.csv"
    source.write_text(
        ",,,\n"
        "ops_team_2,second_category_name,,\n"
        "L2L - Fashion,Women's Tops,,\n"
        "L2L - Fashion,Women's Tops,,\n"
        "MAI / Unmanaged,Fragrance,,\n",
        encoding="utf-8-sig",
    )
    frame = module.read_mapping_source(source)
    payload, quality = module.build_mapping(frame, generated_at="2026-07-17T00:00:00Z")
    assert quality["source_rows"] == 3
    assert quality["duplicate_row_count"] == 1
    assert {pair["identity_key"] for pair in payload["pairs"]} == {
        "Local Merchants::L2L - Fashion",
        "Local Merchants::MAI / Unmanaged",
    }


def test_top_level_csv_uses_team_as_its_single_identity_option(tmp_path):
    source = tmp_path / "mapping.csv"
    source.write_text(
        ",,,\n"
        "ops_team_1,second_category_name,,\n"
        "POP,DIY,,\n"
        "Local Merchants,Fragrance,,\n"
        "Full-Service,Makeup,,\n",
        encoding="utf-8-sig",
    )
    payload, quality = module.build_mapping(
        module.read_mapping_source(source), generated_at="2026-07-17T00:00:00Z"
    )
    assert quality["ops_team_1_count"] == 3
    assert {pair["identity_key"] for pair in payload["pairs"]} == {
        "Full-Service::Full-Service",
        "Local Merchants::Local Merchants",
        "POP::POP",
    }


def test_combined_sources_keep_local_merchants_level_two_teams(tmp_path):
    team_1 = tmp_path / "team_1.csv"
    team_1.write_text(
        ",,,\nops_team_1,second_category_name,,\n"
        "POP,DIY,,\nLocal Merchants,Fragrance,,\nFull-Service,Makeup,,\n",
        encoding="utf-8-sig",
    )
    team_2 = tmp_path / "team_2.csv"
    team_2.write_text(
        ",,,\nops_team_2,second_category_name,,\n"
        "L2L - Fashion,Fragrance,,\nMAI / Unmanaged,Fragrance,,\n",
        encoding="utf-8-sig",
    )
    payload, _ = module.build_mapping(
        module.combine_identity_sources(team_1, team_2), generated_at="2026-07-17T00:00:00Z"
    )
    assert {pair["identity_key"] for pair in payload["pairs"]} == {
        "Full-Service::Full-Service",
        "Local Merchants::L2L - Fashion",
        "Local Merchants::MAI / Unmanaged",
        "POP::POP",
    }
