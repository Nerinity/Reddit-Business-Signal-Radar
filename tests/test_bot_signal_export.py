import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bot_export", ROOT / "scripts" / "build_bot_signal_export.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_bot_export_contract_and_team_selection():
    dashboard = json.loads((ROOT / "apps/next/public/data/dashboard-2026-07-13.json").read_text(encoding="utf-8"))
    mapping = json.loads((ROOT / "apps/next/public/data/ops-team-category-mapping.json").read_text(encoding="utf-8"))
    payload = module.build_week_export(dashboard, mapping, generated_at="2026-07-20T00:00:00Z")

    assert payload["schema_version"] == "1.0"
    assert payload["week_start"] == "2026-07-13"
    assert len(payload["teams"]) == len(mapping["pairs"])
    for team in payload["teams"]:
        assert len(team["overall_top5"]) <= 5
        selected_ids = [row["category_id"] for row in team["overall_top5"] + team["dimension_highlights"]]
        assert len(selected_ids) == len(set(selected_ids))
        assert all(len(row["signals_top50"]) <= 50 for row in team["overall_top5"] + team["dimension_highlights"])
        assert all(row["evidence_url"].startswith("/data/evidence/") for row in team["overall_top5"])


def test_mixed_signals_contains_brands_and_keywords_with_one_ranking():
    dashboard = json.loads((ROOT / "apps/next/public/data/dashboard-2026-07-13.json").read_text(encoding="utf-8"))
    cluster = next(cluster for cluster in dashboard["clusters"] if cluster["brands"] and cluster["terms"])
    signals = module.mixed_signals(cluster)

    assert len(signals) <= 50
    assert [row["rank"] for row in signals] == list(range(1, len(signals) + 1))
    assert {row["kind"] for row in signals} == {"brand", "keyword"}
    assert len({row["signal_key"] for row in signals}) == len(signals)
