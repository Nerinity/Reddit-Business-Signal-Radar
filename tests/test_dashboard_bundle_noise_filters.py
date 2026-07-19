import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dashboard_builder", ROOT / "scripts" / "build_web_dashboard_bundle.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_brand_confidence_tier_matches_real_pipeline_confidence_floats():
    # 07_extract_entities.py assigns confidence 1.0 to whitelist alias matches and 0.85 to
    # catalog n-gram matches -- both count as "high". Regex candidates score a flat 0.45,
    # the only tier that reads as "low". There is no real "medium" signal in the data.
    assert module.brand_confidence_tier("confirmed_whitelist_brand") == "high"
    assert module.brand_confidence_tier("catalog_known_brand") == "high"
    assert module.brand_confidence_tier("candidate_non_whitelist_brand") == "low"
    assert module.brand_confidence_tier("") == "low"
    assert module.brand_confidence_tier(None) == "low"


def test_brand_domain_for_uses_overrides_and_defaults_to_shopping():
    overrides = {"paypal": "payment", "amazon": "marketplace"}
    assert module.brand_domain_for("paypal", overrides) == "payment"
    assert module.brand_domain_for("amazon", overrides) == "marketplace"
    assert module.brand_domain_for("nike", overrides) == "shopping"
    assert module.brand_domain_for("", overrides) == "shopping"


def test_load_brand_domain_overrides_skips_comment_keys(tmp_path):
    path = tmp_path / "brand_domain_overrides.json"
    path.write_text('{"_comment": "ignore me", "paypal": "payment"}', encoding="utf-8")
    overrides = module.load_brand_domain_overrides(path)
    assert overrides == {"paypal": "payment"}


def test_load_brand_domain_overrides_missing_file_returns_empty():
    assert module.load_brand_domain_overrides(Path("/nonexistent/path.json")) == {}


def test_keyword_quality_ok_accepts_real_product_entity_types_above_threshold():
    assert module.keyword_quality_ok("sensitive skin", "need_state", 3) is True
    assert module.keyword_quality_ok("dupe alert", "product_phrase", 5) is True


def test_keyword_quality_ok_rejects_low_unique_posts():
    assert module.keyword_quality_ok("sensitive skin", "need_state", 2) is False


def test_keyword_quality_ok_rejects_brand_and_unknown_candidate_types():
    # Brands are already surfaced separately; unknown_candidate is pipeline slang for
    # "not yet classified" -- neither belongs in the curated keyword list.
    assert module.keyword_quality_ok("nike", "brand", 10) is False
    assert module.keyword_quality_ok("some phrase", "unknown_candidate", 10) is False


def test_keyword_quality_ok_rejects_short_digit_punct_url_and_stoplist_terms():
    assert module.keyword_quality_ok("ok", "need_state", 10) is False
    assert module.keyword_quality_ok("123", "need_state", 10) is False
    assert module.keyword_quality_ok("!!!", "need_state", 10) is False
    assert module.keyword_quality_ok("link comments", "need_state", 10) is False
    assert module.keyword_quality_ok("u/someuser", "need_state", 10) is False
    assert module.keyword_quality_ok("check www.example.com", "need_state", 10) is False
