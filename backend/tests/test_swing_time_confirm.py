from __future__ import annotations

import numpy as np
import pandas as pd

from app.services.hl_precompute import get_swing_hl_module


def test_weekly_time_confirm_prevents_degenerate_trend_sparsity():
    """
    Regrese: na dlouhém weekly trendu s mělkými retracy nesmí swingy „umřít“ jen proto,
    že se ATR-pullback potvrzení téměř nikdy nespustí.
    """
    sh = get_swing_hl_module()
    rng = np.random.default_rng(8123)

    # ~16.5 let weekly barů ≈ 860
    idx = pd.date_range("2009-01-02", periods=860, freq="W-FRI", tz="UTC")

    # Long-only drift + malé pullbacky: typické prostředí, kde čistě pullback-confirm často nezamyká highs.
    drift = 0.35
    noise = rng.normal(0, 0.25, size=len(idx))
    close = 100.0 + np.cumsum(drift + noise)

    # Shallow wicks
    high = close + 0.8 + rng.normal(0, 0.05, size=len(idx))
    low = close - 0.8 + rng.normal(0, 0.05, size=len(idx))
    open_ = np.roll(close, 1)
    open_[0] = close[0]

    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1.0},
        index=idx,
    )

    p = {"timeframe": "1w", "data_timeframe": "1w", "max_bars": 0}
    sw = sh.get_swings(df, p)

    # Očekáváme průběžné swingy přes celou periodu, ne jen pár na začátku.
    assert isinstance(sw, list)
    assert len(sw) >= 18

