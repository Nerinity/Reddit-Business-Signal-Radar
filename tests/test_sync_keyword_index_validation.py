import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.sync_product_app_data import validate_keyword_post_index, validate_ops_mapping


def test_sync_rejects_missing_keyword_index(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="Missing required pipeline artifact"):
        validate_keyword_post_index(tmp_path / "keyword_post_index.parquet")


def test_sync_rejects_bad_keyword_index_schema(tmp_path: Path):
    path = tmp_path / "keyword_post_index.parquet"
    pd.DataFrame({"week_start": ["2026-06-30"]}).to_parquet(path, index=False)
    with pytest.raises(RuntimeError, match="missing required columns"):
        validate_keyword_post_index(path)


def test_sync_rejects_invalid_ops_mapping(tmp_path: Path):
    path = tmp_path / "ops-team-category-mapping.json"
    path.write_text('{"version": 1, "ops_teams": [], "pairs": []}', encoding="utf-8")
    with pytest.raises(RuntimeError, match="Invalid operations mapping contract"):
        validate_ops_mapping(path)
