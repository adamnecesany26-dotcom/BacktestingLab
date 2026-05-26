"""
Unit-style backtests on MNQ timestamps: market/limit entries, bracket SL/TP, partials, short round-trip.

OHLC paths are synthetic (anchored to a real MNQ close) so fills are deterministic; the datetime index
comes from ``data/futures_mnq/MNQ_1m.parquet``.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
MNQ_PARQUET = ROOT / "data" / "futures_mnq" / "MNQ_1m.parquet"
STRAT = ROOT / "strategies" / "unit_order_probe" / "main.py"


@pytest.fixture(scope="module", autouse=True)
def _repo_root_path():
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    yield


def _load_engine_mod():
    import sys

    name = "docker_engine_mnq_audit"
    path = ROOT / "backend" / "docker" / "engine.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _norm_idx(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if idx.tz is not None:
        return idx.tz_convert("UTC").tz_localize(None)
    return idx


def _row(o: float, h: float, l: float, c: float, v: float = 100.0) -> dict:
    return {"open": o, "high": h, "low": l, "close": c, "volume": v}


def _mnq_synthetic_df(scenario: str, *, offset: int = 8_200, total_bars: int = 28) -> tuple[pd.DataFrame, float]:
    assert MNQ_PARQUET.is_file(), MNQ_PARQUET
    pq = pd.read_parquet(MNQ_PARQUET)
    chunk = pq.iloc[offset : offset + total_bars]
    idx = _norm_idx(chunk.index)
    base = float(chunk.iloc[5]["close"])

    rows: list[dict] = []
    for _ in range(5):
        rows.append(_row(base, base, base, base))

    if scenario in ("bracket_sl", "bracket_tp", "bracket_same_bar"):
        rows.append(_row(base, base, base, base))
        rows.append(_row(base, base + 0.5, base - 0.5, base))
        if scenario == "bracket_sl":
            rows.append(_row(base, base + 2.0, base - 15.0, base - 5.0))
        elif scenario == "bracket_tp":
            rows.append(_row(base, base + 20.0, base - 1.0, base + 15.0))
        else:
            rows.append(_row(base, base + 12.0, base - 8.0, base - 3.0))
    elif scenario == "limit_entry":
        rows.append(_row(base, base, base, base))
        rows.append(_row(base, base + 1.0, base - 7.0, base - 1.0))
    elif scenario == "market_next_open":
        rows.append(_row(base, base, base, base))
        o2 = base + 8.25
        rows.append(_row(o2, o2 + 1.0, o2 - 1.0, o2))
    elif scenario == "roundtrip_short":
        rows.append(_row(base, base, base, base))
        rows.append(_row(base, base + 2.0, base - 2.0, base))
        rows.append(_row(base, base + 1.0, base - 1.0, base))
        # Bar 9 (1-based): submit cover; fill is next bar's open — must be cover, not padded base.
        rows.append(_row(base, base + 1.0, base - 1.0, base))
        cover = base - 15.0
        rows.append(_row(cover, cover + 1.0, cover - 1.0, cover))
    elif scenario == "partial_scale":
        rows.append(_row(base, base, base, base))
        rows.append(_row(base, base + 10.0, base - 1.0, base + 8.0))
        rows.append(_row(base + 8.0, base + 9.0, base - 8.0, base - 6.0))
        rows.append(_row(base - 6.0, base - 5.0, base - 10.0, base - 9.0))
        rows.append(_row(base - 9.0, base, base - 12.0, base - 11.0))
    else:
        raise ValueError(scenario)

    while len(rows) < total_bars:
        rows.append(_row(base, base, base, base))

    rows = rows[:total_bars]
    df = pd.DataFrame(rows, index=idx[:total_bars])
    return df, base


def _run(scenario: str, **params):
    eng = _load_engine_mod()
    cls = eng.load_strategy(str(STRAT))
    df, base = _mnq_synthetic_df(scenario)
    strat_params = {"scenario": scenario, "trigger_bar": 6, "stake": 2, **params}
    env = {
        "SLIPPAGE_PERC": "0",
        "COMMISSION_PERC": "0",
        "INITIAL_CAPITAL": "5000000",
    }
    eng.set_engine_run_environ(env)
    try:
        out = eng.run_backtest(
            cls,
            df,
            data_path=str(ROOT / "data"),
            instrument="MNQ",
            strategy_params=strat_params,
            lightweight=True,
        )
    finally:
        eng.clear_engine_run_environ()
    return out, base


def test_mnq_probe_bracket_stop_loss():
    out, base = _run("bracket_sl")
    trades = out.get("trades") or []
    assert len(trades) >= 1
    t0 = trades[0]
    assert t0["type"] == "buy"
    assert abs(float(t0["entryPrice"]) - base) < 1e-6
    assert float(t0["exitPrice"]) < float(base) - 5.0
    assert float(t0["pnl"]) < 0


def test_mnq_probe_bracket_take_profit():
    out, base = _run("bracket_tp")
    trades = out.get("trades") or []
    assert len(trades) == 1
    t0 = trades[0]
    assert abs(float(t0["entryPrice"]) - base) < 1e-6
    assert float(t0["exitPrice"]) >= float(base) + 10.5
    assert float(t0["pnl"]) > 0


def test_mnq_probe_bracket_same_bar_favors_stop():
    """When both bracket legs trade through same bar, stop should execute (limit canceled)."""
    out, base = _run("bracket_same_bar")
    trades = out.get("trades") or []
    assert len(trades) == 1
    t0 = trades[0]
    assert abs(float(t0["entryPrice"]) - base) < 1e-6
    assert float(t0["exitPrice"]) <= float(base) - 4.0
    assert float(t0["pnl"]) < 0


def test_mnq_probe_limit_entry():
    out, base = _run("limit_entry")
    trades = out.get("trades") or []
    assert len(trades) == 1
    t0 = trades[0]
    exp_entry = base - 4.0
    assert abs(float(t0["entryPrice"]) - exp_entry) < 0.5


def test_mnq_probe_market_entry_next_bar_open():
    out, base = _run("market_next_open")
    trades = out.get("trades") or []
    assert len(trades) == 1
    t0 = trades[0]
    exp = base + 8.25
    assert abs(float(t0["entryPrice"]) - exp) < 1e-3


def test_mnq_probe_short_roundtrip_market():
    out, base = _run("roundtrip_short")
    trades = out.get("trades") or []
    assert len(trades) >= 1
    t0 = trades[0]
    assert t0["type"] == "sell"
    exp_cover = float(base) - 15.0
    assert abs(float(t0["exitPrice"]) - exp_cover) < 0.25
    assert float(t0["pnl"]) > 0


def test_mnq_probe_partial_scale_out():
    out, _base = _run("partial_scale", stake=4)
    trades = out.get("trades") or []
    # Backtrader aggregates partials into one closed trade record for the whole position.
    assert len(trades) == 1
    # Net position flat via broker — trade record reflects combined exit economics.
    assert float(trades[0]["size"]) == 4


@pytest.mark.skipif(not MNQ_PARQUET.is_file(), reason="MNQ parquet not present")
def test_mnq_parquet_present():
    assert MNQ_PARQUET.is_file()
