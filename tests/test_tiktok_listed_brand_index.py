import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "listed_brand_index", ROOT / "scripts" / "build_tiktok_listed_brand_index.py"
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_ambiguous_registered_names_are_rejected():
    for name in ("the gym", "dupe", "seller", "hair mask", "dining room", "charger"):
        assert module.is_unambiguous_brand_name(name, 1) is False


def test_repeated_distinctive_brand_names_are_accepted():
    assert module.is_unambiguous_brand_name("nivea", 65) is True
    assert module.is_unambiguous_brand_name("glitch", 12) is True
    assert module.is_unambiguous_brand_name("canon", 30) is True
