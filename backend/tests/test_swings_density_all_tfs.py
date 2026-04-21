from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.hl_precompute import get_swing_hl_module


def _make_ohlc(idx: pd.DatetimeIndex, seed: int, drift: float, noise: float) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100.0 + np.cumsum(drift + rng.normal(0, noise, size=len(idx)))
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    # Přidej malý „shape“ šum do high/low, aby vznikaly lokální pivoty i na jemných TF.
    rng = np.random.default_rng(seed + 999)
    wig = rng.normal(0, 0.18, size=len(idx))
    high = np.maximum(open_, close) + 0.7 + np.maximum(0.0, wig)
    low = np.minimum(open_, close) - 0.7 + np.minimum(0.0, wig)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1.0},
        index=idx,
    )


def test_swings_not_degenerate_and_not_explosive_across_tfs():
    """
    Lehký sanity test napříč TF: swingy nesmí být degenerované (0/1) ani extrémně přestřelené
    na středně dlouhé řadě.
    """
    sh = get_swing_hl_module()

    cases = [
        ("1h", pd.date_range("2023-01-01", periods=1200, freq="1h", tz="UTC"), 1, 0.02, 0.35, 40, 520),
        ("4h", pd.date_range("2019-01-01", periods=900, freq="4h", tz="UTC"), 2, 0.03, 0.22, 25, 320),
        ("1d", pd.date_range("2010-01-01", periods=1200, freq="1D", tz="UTC"), 3, 0.05, 0.35, 18, 260),
        ("1w", pd.date_range("2009-01-02", periods=860, freq="W-FRI", tz="UTC"), 4, 0.25, 0.30, 12, 180),
        ("1M", pd.date_range("2009-01-31", periods=220, freq="ME", tz="UTC"), 5, 0.9, 0.6, 6, 90),
    ]

    for tf, idx, seed, drift, noise, lo, hi in cases:
        df = _make_ohlc(idx, seed=seed, drift=drift, noise=noise)
        sw = sh.get_swings(df, {"timeframe": tf, "data_timeframe": tf, "max_bars": 0})
        assert isinstance(sw, list)
        assert lo <= len(sw) <= hi, (tf, len(sw))

