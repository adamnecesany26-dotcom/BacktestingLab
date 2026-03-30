"""Tests for MTF S/D zone merge (strategy ↔ moduleOutputs parity helper)."""

from __future__ import annotations

import pandas as pd

from app.services.sd_zone_merge import (
    build_merged_sd_zones,
    min_zone_ohlc_bars,
    parse_zone_timeframes_dict,
    resample_to_zone_tf,
)


def test_min_zone_ohlc_bars_weekly_lower_than_daily() -> None:
    assert min_zone_ohlc_bars("1w") < min_zone_ohlc_bars("1d")
    assert min_zone_ohlc_bars("1W") == min_zone_ohlc_bars("1w")
    assert min_zone_ohlc_bars("1d") == 24
    assert min_zone_ohlc_bars("4h") == 30


def test_build_merged_sd_zones_weekly_does_not_require_30_rows() -> None:
    """Regression: 30 weekly bars je ~7 měsíců; s 20 týdny dřív merge vůbec neběžel."""
    idx = pd.date_range("2024-01-01", periods=140, freq="1d", tz="UTC")
    exec_df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5},
        index=idx,
    )

    def get_zones_fn(ohlc, params):
        return [
            {
                "name": "Demand",
                "value_low": 99.0,
                "value_high": 100.5,
                "start_idx": 2,
                "end_idx": len(ohlc) - 1,
                "pivot_idx": 2,
            }
        ]

    merged, _flat = build_merged_sd_zones(
        exec_df,
        ["1w"],
        get_zones_fn,
        lambda tf: {"timeframe": tf},
        True,
        0.25,
    )
    assert len(merged) == 1


def test_parse_zone_timeframes_dict_empty() -> None:
    assert parse_zone_timeframes_dict({}) == []
    assert parse_zone_timeframes_dict(None) == []


def test_parse_zone_timeframes_dict_csv_and_list() -> None:
    assert parse_zone_timeframes_dict({"zone_timeframes": "1w, 4h"}) == ["1w", "4h"]
    assert parse_zone_timeframes_dict({"zone_timeframes": ["1d", "4h"]}) == ["1d", "4h"]
    assert parse_zone_timeframes_dict({"zone_timeframe": "30m"}) == ["30m"]


def test_build_merged_sd_zones_two_tf_merges_overlap() -> None:
    # Need enough 4h bars so daily resample has ≥30 rows (merge skips thin series).
    idx = pd.date_range("2024-01-01", periods=800, freq="4h", tz="UTC")
    exec_df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5},
        index=idx,
    )

    def get_zones_fn(ohlc, params):
        tf = str(params.get("timeframe") or "")
        if tf == "1d":
            return [
                {
                    "name": "Demand",
                    "value_low": 99.0,
                    "value_high": 100.5,
                    "start_idx": 5,
                    "end_idx": len(ohlc) - 1,
                    "pivot_idx": 5,
                    "date_start": ohlc.index[5],
                    "date_end": ohlc.index[-1],
                    "fillcolor": "#0f0",
                }
            ]
        if tf == "4h":
            return [
                {
                    "name": "Demand",
                    "value_low": 99.2,
                    "value_high": 100.4,
                    "start_idx": 10,
                    "end_idx": len(ohlc) - 1,
                    "pivot_idx": 10,
                    "date_start": ohlc.index[10],
                    "date_end": ohlc.index[-1],
                    "fillcolor": "#0f0",
                }
            ]
        return []

    def module_params_fn(tf: str) -> dict:
        return {"timeframe": tf, "data_timeframe": tf}

    merged, flat = build_merged_sd_zones(
        exec_df,
        ["1d", "4h"],
        get_zones_fn,
        module_params_fn,
        prefer_higher_tf=True,
        overlap_threshold=0.25,
    )
    assert len(flat) == 2
    assert len(merged) == 1
    assert merged[0].get("_merged_tfs") == ["1d", "4h"]
    assert merged[0].get("_primary_tf") == "1d"


def test_single_timeframe_no_cross_merge() -> None:
    idx = pd.date_range("2024-01-01", periods=800, freq="1h", tz="UTC")
    exec_df = pd.DataFrame(
        {"open": 50.0, "high": 51.0, "low": 49.0, "close": 50.5},
        index=idx,
    )

    def get_zones_fn(ohlc, params):
        return [
            {
                "name": "Supply",
                "value_low": 50.2,
                "value_high": 51.0,
                "start_idx": 3,
                "end_idx": len(ohlc) - 1,
                "pivot_idx": 3,
                "date_start": ohlc.index[3],
                "date_end": ohlc.index[-1],
            }
        ]

    merged, _flat = build_merged_sd_zones(
        exec_df,
        ["4h"],
        get_zones_fn,
        lambda tf: {"timeframe": tf},
        True,
        0.25,
    )
    assert len(merged) == 1
    assert merged[0]["_merged_tfs"] == ["4h"]


def test_resample_to_zone_tf_preserves_ohlc_shape() -> None:
    idx = pd.date_range("2024-01-01", periods=100, freq="30min", tz="UTC")
    df = pd.DataFrame(
        {"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5},
        index=idx,
    )
    out = resample_to_zone_tf(df, "1h")
    assert len(out) < len(df)
    assert list(out.columns) == ["open", "high", "low", "close"]
