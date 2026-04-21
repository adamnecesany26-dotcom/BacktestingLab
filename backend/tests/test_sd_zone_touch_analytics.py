"""Unit tests for sd_zone_touch_analytics (synthetic OHLC + touch_events)."""

from __future__ import annotations

import pandas as pd

from app.services.sd_zone_touch_analytics import (
    SdTouchAnalyticsParams,
    analyze_touch_events_on_ohlc,
    stop_loss_from_zone_height,
    touch_events_chart_bars,
)


def test_touch_bar_mae_when_extreme_past_zone_or_touch():
    """MAE on touch candle counts when low/high proves path past zone edge or touch (MFE still excluded)."""
    idx = pd.date_range("2024-11-01", periods=4, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": [100.0, 100.0, 100.0, 100.0],
            "high": [101.0, 100.5, 100.5, 100.5],
            "low": [99.0, 99.5, 99.5, 99.5],
            "close": [100.0, 100.0, 100.0, 100.0],
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_touch_mae",
            "name": "Demand",
            "value_low": 95.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    t0 = trades[0]
    assert t0.get("skip") is None
    assert int(t0["mae_bar"]) == 0
    assert float(t0["mae_R"]) > 0.05
    assert float(t0["mfe_R"]) < float(t0["mae_R"])


def test_supply_sl_hit_price_tolerance_touch_bar():
    """High can sit infinitesimally below SL in floats; still count as stop (not a false winner)."""
    idx = pd.date_range("2024-10-01", periods=3, freq="1D", tz="UTC")
    hi0 = 105.0 - 5e-8  # Supply zone sl = 105 at mult 1.25, entry 102, r_unit 3
    ohlc = pd.DataFrame(
        {
            "open": [102.0, 102.0, 102.0],
            "high": [hi0, 102.0, 102.0],
            "low": [101.0, 101.0, 101.0],
            "close": [102.0, 102.0, 102.0],
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_eps_sl",
            "name": "Supply",
            "value_low": 100.0,
            "value_high": 104.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 102.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0["sl_hit_bar"] == 0


def test_stop_loss_demand_supply_formula():
    assert stop_loss_from_zone_height("Demand", 110.0, 100.0, 1.25) == 110.0 - 12.5
    assert stop_loss_from_zone_height("Supply", 110.0, 100.0, 1.25) == 100.0 + 12.5


def test_mfe_mae_exclude_touch_bar_intrabar_unknown():
    """High/low on the touch candle are not used for MFE/MAE (path order vs touch is unknown)."""
    idx = pd.date_range("2024-09-01", periods=8, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0],
            "high": [130.0, 101.0, 101.0, 101.0, 101.0, 101.0, 101.0, 101.0],
            "low": [99.0, 99.0, 99.0, 99.0, 99.0, 99.0, 99.0, 99.0],
            "close": [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0],
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_touch_only_wick",
            "name": "Demand",
            "value_low": 95.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    t0 = trades[0]
    assert t0.get("skip") is None
    # If bar 0 high were used, MFE would be (130-100)/7.5 >> 1.5; only bar 1+ counts.
    assert float(t0["mfe_R"]) < 0.5


def test_touch_events_map_to_chart_bars():
    idx = pd.date_range("2024-01-01", periods=5, freq="1h", tz="UTC")
    ev = [{"touch_date": str(idx[2].isoformat()), "price": 101.0}]
    mapped = touch_events_chart_bars(idx, ev)
    assert len(mapped) == 1
    assert mapped[0][0] == 2
    assert mapped[0][1] == 101.0


def test_demand_touch_then_rally_mfe():
    idx = pd.date_range("2024-06-01", periods=30, freq="1D", tz="UTC")
    # flat then pump
    close = [100.0] * 10 + list(range(100, 120))
    ohlc = pd.DataFrame(
        {
            "open": close,
            "high": [c + 0.5 for c in close],
            "low": [c - 0.5 for c in close],
            "close": close,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z1",
            "name": "Demand",
            "value_low": 99.0,
            "value_high": 101.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[5].isoformat()), "price": 99.5}],
            "tradable": True,
        }
    ]
    trades, agg = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    assert agg["touch_count"] == 1
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0["sl_hit_bar"] is None
    assert float(t0["mfe_R"]) > 1.0
    assert float(t0["zone_value_low"]) == 99.0
    assert float(t0["zone_value_high"]) == 101.0


def test_sl_hit_supply_short_mae_at_least_1r_when_mfe_below_1():
    """SL exit uses ``break`` before that bar's adverse updates MAE — losers must show ≥1R MAE."""
    idx = pd.date_range("2024-08-01", periods=12, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": [100.0] * 12,
            "high": [100.0] * 5 + [102.2, 103.0, 105.5, 106.0, 106.0, 106.0, 106.0],
            "low": [100.0] * 5 + [101.8, 101.0, 101.0, 101.0, 101.0, 101.0, 101.0],
            "close": [100.0] * 12,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_supply_mae",
            "name": "Supply",
            "value_low": 100.0,
            "value_high": 104.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[5].isoformat()), "price": 102.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    t0 = trades[0]
    assert t0.get("skip") is None
    assert t0["sl_hit_bar"] is not None
    assert float(t0["mfe_R"]) < 1.0
    assert float(t0["mae_R"]) >= 1.0 - 1e-9


def test_sl_hit_demand_long():
    idx = pd.date_range("2024-01-01", periods=20, freq="1h", tz="UTC")
    close = [100.0] * 20
    high = [c + 0.2 for c in close]
    low = [c - 5.0 for c in close]  # drives into SL (SL = 102 - 5 = 97)
    ohlc = pd.DataFrame({"open": close, "high": high, "low": low, "close": close}, index=idx)
    zones = [
        {
            "zone_id": "z2",
            "name": "Demand",
            "value_low": 98.0,
            "value_high": 102.0,
            "source_tf": "1h",
            "touch_events": [{"touch_date": str(idx[3].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    # SL = 102 - 1.25*4 = 97
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=1.25, max_mfe_R=50.0, winner_rr=1.0))
    assert trades[0]["sl_hit_bar"] is not None


def test_touch_outside_zone_range_is_skipped():
    idx = pd.date_range("2024-01-01", periods=10, freq="1h", tz="UTC")
    close = [100.0] * 10
    ohlc = pd.DataFrame(
        {"open": close, "high": [c + 1 for c in close], "low": [c - 1 for c in close], "close": close},
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_bad",
            "name": "Supply",
            "value_low": 120.0,
            "value_high": 125.0,
            "source_tf": "1h",
            "touch_events": [{"touch_date": str(idx[3].isoformat()), "price": 122.0}],
            "tradable": True,
        }
    ]
    trades, agg = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(winner_rr=1.0))
    assert agg["touch_count"] == 0
    assert trades[0]["skip"] is True
    assert trades[0]["skip_reason"] == "touch_bar_not_in_zone_range"


def test_mfe_cap_stops_scan():
    idx = pd.date_range("2024-03-01", periods=15, freq="1D", tz="UTC")
    close = [100.0] * 3 + [200.0] * 12
    ohlc = pd.DataFrame(
        {
            "open": close,
            "high": [c + 1 for c in close],
            "low": [c - 1 for c in close],
            "close": close,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z3",
            "name": "Demand",
            "value_low": 95.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], SdTouchAnalyticsParams(sl_zone_height_mult=2.0, max_mfe_R=2.0, winner_rr=1.0))
    assert trades[0]["cap_hit_bar"] is not None
    assert float(trades[0]["mfe_R"]) >= 2.0


def test_opposite_bos_does_not_end_trade_scan():
    """MFE/MAE/SL scan continues past opposite BOS; BOS only caps ``mfe_before_opposite_bos_R``."""
    idx = pd.date_range("2024-04-01", periods=22, freq="1D", tz="UTC")
    close = [100.0] * 22
    highs = [102.0] * 22
    lows = [98.0] * 22
    for i in range(10, 22):
        highs[i] = 100.0 + float(i - 9) * 15.0
    ohlc = pd.DataFrame({"open": close, "high": highs, "low": lows, "close": close}, index=idx)
    zones = [
        {
            "zone_id": "z4",
            "name": "Demand",
            "value_low": 90.0,
            "value_high": 110.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[1].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    bos = [
        {"type": "bos_bullish", "bar_index": 2, "value": 101.0},
        {"type": "bos_bearish", "bar_index": 6, "value": 99.0},
    ]
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, bos, SdTouchAnalyticsParams(sl_zone_height_mult=5.0, max_mfe_R=500.0, winner_rr=1.0))
    t0 = trades[0]
    assert t0["opposite_bos_bar"] == 6
    assert t0["mfe_before_opposite_bos_R"] is not None
    assert float(t0["mfe_R"]) > float(t0["mfe_before_opposite_bos_R"]) + 0.05
    assert int(t0["mfe_bar"]) > 6


def test_breakeven_move_r_same_bar_scratch_at_entry():
    """At 1R favour SL moves to entry; same candle wick through entry → BE stop same bar."""
    idx = pd.date_range("2024-12-01", periods=4, freq="1D", tz="UTC")
    # Demand vl 90 vh 105, entry 100, SL = 105 - 1.25*15 = 86.25, r_unit = 13.75; 1R ≈ high 113.75
    ohlc = pd.DataFrame(
        {
            "open": [100.0, 100.0, 100.0, 100.0],
            "high": [100.0, 114.0, 100.0, 100.0],
            "low": [100.0, 99.0, 100.0, 100.0],
            "close": [100.0, 100.0, 100.0, 100.0],
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_be_scratch",
            "name": "Demand",
            "value_low": 90.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    p = SdTouchAnalyticsParams(
        sl_zone_height_mult=1.25,
        max_mfe_R=50.0,
        winner_rr=2.0,
        breakeven_move_r=1.0,
    )
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], p)
    t0 = trades[0]
    assert t0.get("skip") is None
    assert int(t0["be_bar"]) == 1
    assert int(t0["sl_hit_bar"]) == 1
    assert float(t0["breakeven_move_r"]) == 1.0


def test_breakeven_move_r_sl_before_arm_uses_original_stop():
    idx = pd.date_range("2025-01-01", periods=4, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": [100.0, 100.0, 100.0, 100.0],
            "high": [100.0, 100.0, 100.0, 100.0],
            "low": [100.0, 85.0, 100.0, 100.0],
            "close": [100.0, 100.0, 100.0, 100.0],
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_be_sl_first",
            "name": "Demand",
            "value_low": 90.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    p = SdTouchAnalyticsParams(
        sl_zone_height_mult=1.25,
        max_mfe_R=50.0,
        winner_rr=2.0,
        breakeven_move_r=2.0,
    )
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], p)
    t0 = trades[0]
    assert t0.get("skip") is None
    assert int(t0["sl_hit_bar"]) == 1
    assert t0.get("be_bar") is None


def test_breakeven_move_r_then_be_stop_after_winner_threshold():
    """BE at 1R bar 2; winner 2R hit bar 2; BE exit bar 3 — API winner uses thr before sl."""
    from app.api.sd_zone_test import sd_zone_trade_is_winner

    idx = pd.date_range("2025-02-01", periods=6, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": [100.0] * 6,
            "high": [100.0, 110.0, 130.0, 100.0, 100.0, 100.0],
            "low": [100.0, 99.5, 100.5, 99.0, 100.0, 100.0],
            "close": [100.0] * 6,
        },
        index=idx,
    )
    zones = [
        {
            "zone_id": "z_be_then_win_be_out",
            "name": "Demand",
            "value_low": 90.0,
            "value_high": 105.0,
            "source_tf": "1d",
            "touch_events": [{"touch_date": str(idx[0].isoformat()), "price": 100.0}],
            "tradable": True,
        }
    ]
    p = SdTouchAnalyticsParams(
        sl_zone_height_mult=1.25,
        max_mfe_R=50.0,
        winner_rr=2.0,
        breakeven_move_r=1.0,
    )
    trades, _ = analyze_touch_events_on_ohlc(ohlc, zones, [], p)
    t0 = trades[0]
    assert t0.get("skip") is None
    assert int(t0["be_bar"]) == 2
    assert int(t0["thr_hit_bar"]) == 2
    assert int(t0["sl_hit_bar"]) == 3
    assert sd_zone_trade_is_winner(t0, 2.0, 1.0) is True
