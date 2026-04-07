"""View df_chart must match H/L precompute (Swing_HL._resample_ohlc) for artifact marker mapping."""

from __future__ import annotations

import pandas as pd

from app.services.view_chart_timeframe import apply_view_chart_timeframe_hl_parity


def test_daily_native_1d_chart_skips_resample_like_precompute() -> None:
    """Denní řada + 1D graf: precompute nevolá resample (target == src) — View musí totéž."""
    idx = pd.date_range("2020-01-06", periods=50, freq="1D")
    df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=idx,
    )
    out = apply_view_chart_timeframe_hl_parity(df, "1D")
    assert len(out) == len(df)
    assert out.index.equals(df.index)


def test_intraday_resampled_to_1d_shorter_than_force_resample() -> None:
    """Jemnější než 1D → agregace; nesmí být stejná délka jako vstup."""
    idx = pd.date_range("2024-06-01", periods=240, freq="4h")
    df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=idx,
    )
    out = apply_view_chart_timeframe_hl_parity(df, "1D")
    assert len(out) < len(df)
    assert len(out) >= 1
