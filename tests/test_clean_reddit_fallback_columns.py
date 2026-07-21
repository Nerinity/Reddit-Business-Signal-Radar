import importlib.util
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "clean_reddit_posts", ROOT / "scripts" / "01_clean_reddit_posts.py"
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_first_available_col_preserves_numeric_fallback_values():
    frame = pd.DataFrame({"engagement_score": [3.0, 209.0, 0.0]})
    result = module.first_available_col(frame, ("score", "engagement_score"), 0)
    assert result.tolist() == [3.0, 209.0, 0.0]


def test_first_available_col_prefers_primary_column():
    frame = pd.DataFrame({"score": [2], "engagement_score": [99]})
    result = module.first_available_col(frame, ("score", "engagement_score"), 0)
    assert result.tolist() == [2]
