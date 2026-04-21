from __future__ import annotations

import pandas as pd

from app.services.sd_zone_touch_analytics import SdTouchAnalyticsParams, analyze_touch_events_on_ohlc


def test_mae_measured_only_before_winner_threshold_when_hit():
    """
    If price reaches the winner threshold (e.g. 1R) and later does a deep retrace,
    MAE must be measured only BEFORE the first threshold-hit bar.
    """
    idx = pd.date_range("2024-05-01", periods=10, freq="1D", tz="UTC")
    # Demand: zone [98,102], touch at day 1, entry=100, SL=97 (r_unit=3).
    # Day 2 reaches 1R: high=103.2 (fav_r≈1.066). That same candle can have a deep lower wick;
    # it must NOT inflate MAE (intrabar order unknown), so MAE is measured only on bars < thr_bar.
    # Later, after being a "winner", price dumps near SL (but NOT through it) which would inflate MAE if measured naively.
    ohlc = pd.DataFrame(
        {
            "open": [100.0] * 10,
            "high": [100.2, 100.2, 103.2, 100.2, 100.2, 100.2, 100.2, 100.2, 100.2, 100.2],
            # Threshold candle (idx 2) has a large adverse wick but must stay ABOVE SL (~97.0).
            "low":  [99.8,  99.6,  98.0,  99.8,  99.8,  97.1,  99.8,  99.8,  99.8,  99.8],
            "close":[100.0] * 10,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_mae_thr",
            "name": "Demand",
            "value_low": 98.0,
            "value_high": 102.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[1].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(
        ohlc,
        zones,
        [],
        SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0),
    )
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0.get("sl_hit_bar") is None
    assert float(t0["mfe_R"]) >= 1.0
    # MAE must ignore the threshold candle wick and later dips; pre-threshold adverse was ~0.13R.
    assert float(t0["mae_R"]) < 0.6

