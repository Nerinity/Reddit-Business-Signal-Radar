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


def test_normalization_matches_nfkc_case_and_whitespace():
    assert module.normalize_category_name(" Ｓｋｉｎ   Care ") == "skin care"
