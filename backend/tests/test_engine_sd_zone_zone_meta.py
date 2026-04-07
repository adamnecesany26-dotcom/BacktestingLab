"""Golden-style integrace: subprocess engine + sd_zone_strategy — trades mají zoneMeta (stop/target).

Regrese: chybějící zoneMeta při jiné instanci Order v notify_order (párování přes Order.ref v strategii).
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
ENGINE_PY = BACKEND / "docker" / "engine.py"
STRATEGY_MAIN = ROOT / "strategies" / "sd_zone_strategy" / "main.py"
NQ_DATA = ROOT / "data" / "futures_30m" / "NQ.txt"
SD_STRATEGY_DIR = ROOT / "strategies" / "sd_zone_strategy"


def _load_strategy_class():
    """Načte Strategy ze sd_zone_strategy/main.py (stejné importy jako engine: app + modules)."""
    spec = importlib.util.spec_from_file_location("sd_zone_strategy_main_test", STRATEGY_MAIN)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    # Pořadí jako smoke: proj root + backend + strategy dir (modules.*)
    prepend = [str(SD_STRATEGY_DIR), str(ROOT), str(BACKEND)]
    old = sys.path[:]
    try:
        for p in reversed(prepend):
            if p not in sys.path:
                sys.path.insert(0, p)
        spec.loader.exec_module(mod)
    finally:
        sys.path[:] = old
    return mod.Strategy


@pytest.mark.skipif(not NQ_DATA.is_file(), reason="NQ fixture data missing")
def test_subprocess_engine_sd_zone_trades_have_zone_meta_stop_target():
    cache_path = str((ROOT / ".backtest_cache").resolve())
    Path(cache_path).mkdir(parents=True, exist_ok=True)

    params = {
        "zone_timeframes": "1d",
        "prefer_higher_tf": True,
        "exec_timeframe": "30m",
        "entry_model": "limit",
        "entry_mode": "edge",
        "entry_pct": 0.5,
        "target_rr": 1.5,
        "zone_max_bars": 6000,
        "require_inducement": False,
        "stop_offset_pct": 0.10,
        "trend_filter_enabled": False,
        "max_base_length": 0,
    }
    roots = f"{ROOT}{os.pathsep}{BACKEND}"
    pp = os.environ.get("PYTHONPATH", "").strip()
    py_path = f"{roots}{os.pathsep}{pp}" if pp else roots

    env = os.environ.copy()
    env.update(
        {
            "STRATEGY_PATH": str(STRATEGY_MAIN.resolve()),
            "DATA_PATH": str((ROOT / "data").resolve()),
            "DATA_CACHE_PATH": cache_path,
            "INSTRUMENT": "NQ",
            "TIMEFRAME": "30m",
            "YEARS": os.environ.get("TEST_SD_ZONE_YEARS", "0.25"),
            "DATA_FILE": "futures_30m/NQ.txt",
            "INITIAL_CAPITAL": "100000",
            "SLIPPAGE_PERC": "0.001",
            "COMMISSION_PERC": "0.0002",
            "INSTRUMENT_TYPE": "futures",
            "TICK_SIZE": "0.25",
            "VALUE_PER_TICK": "5",
            "STRATEGY_PARAMS": json.dumps(params),
            "APPLIED_MODULES": "[]",
            "ANALYSIS_CONFIG": "{}",
            "EXECUTION_MODEL_JSON": json.dumps({"commission_mode": "percentage"}),
            "RUN_ID": "pytest_sd_zone_zone_meta",
            "RUN_SEED": "42",
            "CODE_DIGEST": "",
            "ACTOR_ID": "pytest",
            "PYTHONPATH": py_path,
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )

    proc = subprocess.run(
        [sys.executable, str(ENGINE_PY)],
        env=env,
        cwd=str(BACKEND),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert proc.returncode == 0, proc.stderr[-4000:]

    out = None
    for line in reversed((proc.stdout or "").splitlines()):
        s = line.strip()
        if len(s) > 50 and s.startswith("{") and s.endswith("}"):
            try:
                cand = json.loads(s)
            except json.JSONDecodeError:
                continue
            if isinstance(cand, dict) and ("metrics" in cand or "manifest" in cand):
                out = cand
                break
    assert out is not None and not out.get("error")
    trades: list = out.get("trades") or []
    tc = int((out.get("metrics") or {}).get("tradeCount") or 0)
    assert tc > 0, "očekává se alespoň jeden obchod pro NQ + 0.25y; zviň TEST_SD_ZONE_YEARS nebo zkontroluj data"

    missing = []
    for i, t in enumerate(trades):
        zm = t.get("zoneMeta") if isinstance(t.get("zoneMeta"), dict) else None
        if zm is None:
            missing.append(f"trade[{i}] no zoneMeta")
            continue
        if zm.get("stopPrice") is None or zm.get("targetPrice") is None:
            missing.append(f"trade[{i}] zoneMeta missing stop/target")
    assert not missing, "; ".join(missing)


def test_same_bt_order_matches_by_ref_not_identity():
    Strategy = _load_strategy_class()

    class _Ord:
        __slots__ = ("ref",)

        def __init__(self, ref):
            self.ref = ref

    a = _Ord(42)
    b = _Ord(42)
    assert a is not b
    assert Strategy._same_bt_order(a, b) is True
    assert Strategy._same_bt_order(a, _Ord(43)) is False
    assert Strategy._same_bt_order(a, a) is True
    assert Strategy._same_bt_order(None, a) is False
    assert Strategy._same_bt_order(a, None) is False
