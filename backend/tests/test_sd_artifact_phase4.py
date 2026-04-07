"""Fáze 4 — merge zóny z Parquet artefaktu."""

from __future__ import annotations

import pandas as pd

from app.services.sd_zone_merge import build_merged_sd_zones_from_artifact


def test_build_merged_sd_zones_from_artifact_in_window():
    idx = pd.date_range("2020-01-01", periods=80, freq="1D", tz="UTC")
    exec_df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=idx,
    )
    rows = [
        {
            "kind": "demand",
            "source_tf": "1d",
            "born_at": idx[15].isoformat(),
            "range_start_at": idx[10].isoformat(),
            "range_end_at": idx[-1].isoformat(),
            "price_low": 98.5,
            "price_high": 99.5,
            "has_inducement": False,
            "impulse_score": 3.0,
            "base_length": 2,
        }
    ]
    zdf = pd.DataFrame(rows)
    merged, flat = build_merged_sd_zones_from_artifact(
        exec_df,
        ["1d"],
        zdf,
        prefer_higher_tf=True,
        overlap_threshold=0.25,
    )
    assert len(flat) == 1
    assert flat[0]["name"] == "Demand"
    assert merged  # aktivní v posledním baru (end_idx >= d_idx)


def test_build_merged_sd_zones_from_artifact_empty_df():
    idx = pd.date_range("2020-01-01", periods=10, freq="1D", tz="UTC")
    exec_df = pd.DataFrame(
        {"open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 1.0},
        index=idx,
    )
    empty = pd.DataFrame()
    m, f = build_merged_sd_zones_from_artifact(exec_df, ["1d"], empty, True, 0.25)
    assert m == [] and f == []
