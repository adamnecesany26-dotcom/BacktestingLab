from __future__ import annotations

import pandas as pd

from app.api.sd_zone_test import sd_zone_trade_is_winner
from app.services.sd_zone_touch_analytics import SdTouchAnalyticsParams, analyze_touch_events_on_ohlc


def _winner_by_rr(trade_row: dict, rr: float) -> bool:
    """Same as ``POST /api/sd-zone-test/run`` when breakeven_move_r is off."""
    return sd_zone_trade_is_winner(trade_row, rr, None)


def test_winner_rr_true_if_reached_before_sl_then_sl_later():
    idx = pd.date_range("2024-06-01", periods=8, freq="1D", tz="UTC")
    # Demand, touch at day 1 around entry ~100; r_unit ≈ 3 (SL=97).
    # Day 2: rally to >= 1.5R (high >= 104.5). Day 5: then drop to SL (low <= 97).
    ohlc = pd.DataFrame(
        {
            "open": [100.0] * 8,
            "high": [100.2, 100.2, 105.0, 100.2, 100.2, 100.2, 100.2, 100.2],
            "low": [99.8, 99.8, 99.8, 99.8, 99.8, 96.9, 99.8, 99.8],
            "close": [100.0] * 8,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_win_rr",
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
        SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.5),
    )
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0.get("sl_hit_bar") is not None  # SL happened later in the scan
    assert float(t0["mfe_R"]) >= 1.5
    assert _winner_by_rr(t0, 1.5) is True


def test_winner_rr_false_if_sl_before_reaching_threshold():
    idx = pd.date_range("2024-07-01", periods=6, freq="1D", tz="UTC")
    # Supply short: entry ~102, SL ~105, r_unit ~3. Price hits SL early; never reaches 1.5R.
    ohlc = pd.DataFrame(
        {
            "open": [102.0] * 6,
            "high": [102.2, 105.1, 102.2, 102.2, 102.2, 102.2],
            "low": [101.8, 101.8, 101.8, 101.8, 101.8, 101.8],
            "close": [102.0] * 6,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_lose_rr",
            "name": "Supply",
            "value_low": 100.0,
            "value_high": 104.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 102.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(
        ohlc,
        zones,
        [],
        SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.5),
    )
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0.get("sl_hit_bar") is not None
    assert _winner_by_rr(t0, 1.5) is False

