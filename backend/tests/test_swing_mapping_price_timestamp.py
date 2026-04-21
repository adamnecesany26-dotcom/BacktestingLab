from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.hl_precompute import get_swing_hl_module


def test_get_swings_resample_mapping_updates_price_and_timestamp():
    """
    Regrese: když get_swings resampluje na hrubší TF a mapuje swing index zpět do original_ohlc,
    nesmí zůstat stará (resampled) cena/timestamp – jinak jsou markery „na divných místech“.
    """
    sh = get_swing_hl_module()
    rng = np.random.default_rng(55)

    idx = pd.date_range("2015-01-01", periods=500, freq="1D", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 1.0, size=len(idx)))
    df = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1.0,
        },
        index=idx,
    )
    df.iloc[0, df.columns.get_loc("open")] = close[0]

    # Resample daily -> monthly inside get_swings, then map swings back to original daily index.
    sw = sh.get_swings(df, {"timeframe": "1M", "data_timeframe": "1d", "max_bars": 0})
    assert isinstance(sw, list)

    # Pro každý swing ověř, že timestamp/index/price sedí na original ohlc.
    for s in sw:
        i = int(s["index"])
        assert 0 <= i < len(df)
        assert pd.Timestamp(s["timestamp"]) == df.index[i]
        if s["type"] == "high":
            assert float(s["price"]) == float(df["high"].iloc[i])
        else:
            assert float(s["price"]) == float(df["low"].iloc[i])

