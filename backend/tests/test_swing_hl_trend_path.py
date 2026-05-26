"""Smoke test for Swing_HL.get_line on longer series (trend path)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_MOD_PATH = (
    Path(__file__).resolve().parents[2]
    / "strategies"
    / "modules"
    / "Swing_HL.py"
)


@pytest.fixture(scope="module")
def sh():
    spec = importlib.util.spec_from_file_location("swing_hl_trend_test", _MOD_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _demo_ohlc_4h_like(n: int = 22000) -> pd.DataFrame:
    """
    ~10 years of 4h bars (22000 ≈ 10y trading-ish), enough to trigger previous O(n^2) behavior.
    """
    rng = np.random.default_rng(123)
    t0 = pd.Timestamp("2015-01-05 00:00", tz="UTC")
    idx = pd.date_range(t0, periods=n, freq="4h")
    steps = rng.normal(0, 0.55, size=n)
    close = 20000 + np.cumsum(steps)
    high = close + rng.uniform(1.0, 25.0, size=n)
    low = close - rng.uniform(1.0, 25.0, size=n)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


def test_get_line_returns_trend_data_for_long_series(sh):
    ohlc = _demo_ohlc_4h_like()
    out = sh.get_line(ohlc, {"timeframe": "4h", "data_timeframe": "4h"})
    assert out is not None
    assert "Trend" in out
    trend = out["Trend"]
    assert isinstance(trend, dict)
    data = trend.get("data")
    assert isinstance(data, list)
    assert len(data) == len(ohlc)
    # spot-check a few rows
    for i in (0, len(data) // 2, len(data) - 1):
        row = data[i]
        assert isinstance(row, dict)
        assert "date" in row
        assert "value" in row
        assert "state" in row
        assert "score" in row

