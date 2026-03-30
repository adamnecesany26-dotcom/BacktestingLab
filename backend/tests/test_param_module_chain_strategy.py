"""Repo hygiene: S/D strategie deklaruje PARAM_MODULE_CHAIN pro UI (transitivní VIEW_PARAMS moduly)."""

from pathlib import Path


def test_sd_zone_strategy_has_param_module_chain():
    root = Path(__file__).resolve().parents[2]
    main_py = root / "strategies" / "sd_zone_strategy" / "main.py"
    text = main_py.read_text(encoding="utf-8")
    assert "PARAM_MODULE_CHAIN" in text
    assert "HL_identificator" in text
