"""Swing_HL po refaktoru: jeden swing stream, jeden BOS stream, HTF trend z 1M/1d."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_MOD_PATH = (
    Path(__file__).resolve().parents[2]
    / "strategies"
    / "sd_zone_strategy"
    / "modules"
    / "Swing_HL.py"
)


@pytest.fixture(scope="module")
def sh():
    spec = importlib.util.spec_from_file_location("swing_hl_test", _MOD_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_htf_trend_source_tf(sh):
    assert sh._htf_trend_source_tf("1M") == "1M"
    assert sh._htf_trend_source_tf("1w") == "1M"
    assert sh._htf_trend_source_tf("1d") == "1d"
    assert sh._htf_trend_source_tf("4h") == "1d"
    assert sh._htf_trend_source_tf("1m") == "1d"


def test_get_major_swings_deprecated_empty(sh):
    idx = pd.date_range("2020-01-01", periods=50, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )
    assert sh.get_major_swings(ohlc, {"timeframe": "1d"}) == []


def test_get_swings_always_list(sh):
    rng = np.random.default_rng(42)
    idx = pd.date_range("2024-01-02", periods=120, freq="4h", tz="UTC")
    close = 100 + np.cumsum(rng.normal(0, 0.2, size=len(idx)))
    ohlc = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + 0.3,
            "low": close - 0.3,
            "close": close,
        },
        index=idx,
    )
    ohlc.iloc[0, ohlc.columns.get_loc("open")] = close[0]
    out = sh.get_swings(
        ohlc,
        {"timeframe": "4h", "data_timeframe": "4h", "max_bars": 0},
    )
    assert isinstance(out, list)
    assert all(s.get("type") in ("high", "low") for s in out)


def test_get_bos_single_pivot_stream_no_major_events(sh):
    """Jeden zdroj pivotů — BOS jen z běžných high/low (žádná paralelní major větev)."""
    rng = np.random.default_rng(7)
    idx = pd.date_range("2023-06-01", periods=400, freq="1D", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 0.45, size=len(idx)))
    ohlc = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
        },
        index=idx,
    )
    ohlc.iloc[0, ohlc.columns.get_loc("open")] = close[0]
    bos = sh.get_bos(
        ohlc,
        {"timeframe": "1d", "data_timeframe": "1d", "max_bars": 0},
    )
    assert isinstance(bos, list)
    for ev in bos:
        assert ev.get("bos_swing_kind") == "swing"
        assert ev.get("is_major") is False


def test_merge_bos_cascade_same_direction_keeps_last_in_run(sh):
    ev = [
        {"type": "bos_bearish", "bos_index": 10, "swing_index": 5, "level": 100.0},
        {"type": "bos_bearish", "bos_index": 11, "swing_index": 6, "level": 99.0},
        {"type": "bos_bearish", "bos_index": 12, "swing_index": 7, "level": 98.0},
    ]
    out = sh._merge_bos_cascade_same_direction(ev, 6)
    assert len(out) == 1
    assert int(out[0]["bos_index"]) == 12


def test_get_line_aligns_daily_trend_to_4h_chart(sh):
    """Na 4h grafu má get_line stejný počet bodů jako vstupní řada (HTF trend nalepený)."""
    rng = np.random.default_rng(3)
    idx = pd.date_range("2024-01-02", periods=180, freq="4h", tz="UTC")
    close = 200.0 + np.cumsum(rng.normal(0, 0.15, size=len(idx)))
    ohlc = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + 0.25,
            "low": close - 0.25,
            "close": close,
        },
        index=idx,
    )
    ohlc.iloc[0, ohlc.columns.get_loc("open")] = close[0]
    line = sh.get_line(ohlc, {"timeframe": "4h", "data_timeframe": "4h", "max_bars": 0})
    assert line is not None
    data = (line.get("Trend") or {}).get("data") or []
    assert len(data) == len(ohlc)
    assert all("value" in d and "score" in d and "state" in d for d in data)
