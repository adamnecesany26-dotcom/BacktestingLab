"""Filtr dlouhé konsolidace uvnitř S/D boxu (_count_bars_heavy_zone_overlap + skip)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from examples.sd_zones import (  # noqa: E402
    _compute_zone_width_right,
    _count_bars_heavy_zone_overlap,
    _sd_skip_zone_after_metrics,
    _sd_zone_chop_overlap_min,
    _sd_zone_max_chop_overlap_cap,
)


def test_count_bars_heavy_zone_overlap_all_inside():
    idx = pd.RangeIndex(0, 15)
    # Každý bar zcela v [100, 102] → overlap ratio 1.0
    df = pd.DataFrame(
        {
            "open": [100.5] * 15,
            "high": [101.5] * 15,
            "low": [100.5] * 15,
            "close": [101.0] * 15,
        },
        index=idx,
    )
    n = _count_bars_heavy_zone_overlap(df, 0, 14, 100.0, 102.0, 0.30)
    assert n == 15


def test_count_bars_heavy_zone_overlap_partial():
    idx = pd.RangeIndex(0, 5)
    df = pd.DataFrame(
        {
            "open": [100.0, 100.0, 100.0, 100.0, 100.0],
            "high": [101.0, 101.0, 101.0, 101.0, 120.0],
            "low": [99.0, 99.0, 99.0, 99.0, 99.0],
            "close": [100.5, 100.5, 100.5, 100.5, 110.0],
        },
        index=idx,
    )
    # Bars 0–3: range 2, overlap with [100,102] is [100,101] len 1 → ratio 0.5
    # Bar 4: huge range, tiny overlap → ratio small
    n = _count_bars_heavy_zone_overlap(df, 0, 4, 100.0, 102.0, 0.30)
    assert n == 4


def test_skip_zone_chop_overlap_triggers():
    p = {"sd_zone_max_chop_overlap_bars": 5, "sd_zone_chop_overlap_min": 0.30}
    assert _sd_zone_max_chop_overlap_cap(p) == 5
    assert _sd_zone_chop_overlap_min(p) == pytest.approx(0.30)
    assert _sd_skip_zone_after_metrics(
        "swing",
        3,
        99,
        0,
        0,
        0,
        p,
        chop_overlap_count=6,
        chop_overlap_cap=5,
    )
    assert not _sd_skip_zone_after_metrics(
        "swing",
        3,
        99,
        0,
        0,
        0,
        p,
        chop_overlap_count=5,
        chop_overlap_cap=5,
    )


def test_chop_cap_zero_disables():
    p = {"sd_zone_max_chop_overlap_bars": 0}
    assert _sd_zone_max_chop_overlap_cap(p) == 0
    assert not _sd_skip_zone_after_metrics(
        "swing",
        999,
        0,
        0,
        0,
        0,
        p,
        chop_overlap_count=10_000,
        chop_overlap_cap=0,
    )


def test_sd_unified_touch_on_invalid_close_demand():
    """Close pod zónou → touch na hraně invalidace (zone_low), ne knot svíčky.

    V tomto scénáři nedojde k „departure“ podle full-candle outside, takže after_departure zůstane False.
    """
    idx = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame(
        {
            "open": [100.5, 100.9, 100.95, 101.0],
            "high": [101.2, 100.95, 100.99, 101.5],
            "low": [99.5, 100.85, 100.9, 99.0],
            "close": [100.5, 101.0, 101.05, 98.5],
        },
        index=idx,
    )
    atr = pd.Series(np.ones(len(df), dtype=np.float64), index=idx)
    p = {"zone_departure_min_atr": 0.25, "sd_departure_use_close": 1, "sd_departure_min_bars_after_pivot": 1}
    z_lo, z_hi = 100.0, 101.0
    rm, events = _compute_zone_width_right(
        df, 0, z_lo, z_hi, "Demand", atr, 0.5, [], 15, 5.0, 2.5, p,
    )
    assert len(events) == 1
    assert events[0]["bar_index"] == 3
    assert float(events[0]["price"]) == pytest.approx(100.0, abs=1e-9)
    assert events[0]["after_departure"] is False
    assert rm == 2


def test_sd_unified_retest_touch_after_close_outside_demand():
    """Alespoň 1 svíčka celá nad zónou (low > zone_high), pak překryv → touch na hraně retestu (zone_high)."""
    idx = pd.date_range("2024-01-01", periods=5, freq="D")
    df = pd.DataFrame(
        {
            "open": [100.0, 101.4, 101.5, 102.0, 101.0],
            "high": [101.2, 102.0, 103.0, 103.0, 101.5],
            "low": [99.5, 101.4, 101.2, 101.5, 100.2],
            "close": [100.5, 101.5, 102.0, 102.0, 100.4],
        },
        index=idx,
    )
    atr = pd.Series(np.ones(len(df), dtype=np.float64), index=idx)
    p = {"zone_departure_min_atr": 0.25, "sd_departure_use_close": 1, "sd_departure_min_bars_after_pivot": 1}
    z_lo, z_hi = 100.0, 101.0
    rm, events = _compute_zone_width_right(
        df, 0, z_lo, z_hi, "Demand", atr, 0.5, [], 15, 5.0, 2.5, p,
    )
    assert len(events) >= 1
    last = events[-1]
    assert last["bar_index"] == 4
    assert float(last["price"]) == pytest.approx(101.0, abs=1e-9)
    assert last["after_departure"] is True
    assert rm == min(4 + 3, len(df) - 1)


def test_sd_touch_no_first_touch_while_grinding_on_edge():
    """Konsolidace na hraně: předchozí bary překrývají zónu; bez departure (žádná svíčka celá nad zónou) se touch nesmí logovat."""
    idx = pd.date_range("2024-01-01", periods=8, freq="D")
    df = pd.DataFrame(
        {
            "open": [100.0, 100.3, 100.4, 100.35, 100.2, 99.2, 99.3, 100.4],
            "high": [100.5, 100.95, 101.0, 100.9, 100.95, 98.95, 98.9, 101.05],
            "low": [99.5, 100.1, 100.15, 100.1, 100.1, 98.3, 98.4, 99.7],
            "close": [100.0, 100.4, 100.5, 100.2, 100.3, 99.0, 99.05, 100.5],
        },
        index=idx,
    )
    atr = pd.Series(np.ones(len(df), dtype=np.float64), index=idx)
    p = {"zone_departure_min_atr": 0.25, "sd_departure_use_close": 1, "sd_departure_min_bars_after_pivot": 1}
    z_lo, z_hi = 99.0, 101.0
    rm, events = _compute_zone_width_right(
        df, 0, z_lo, z_hi, "Demand", atr, 0.5, [], 15, 5.0, 2.5, p,
    )
    assert events == []
    assert rm == len(df) - 1


def test_sd_pre_departure_second_visit_no_extra_touch():
    """Bez departure se touchy vůbec nelogují (pre-departure touch je zakázaný)."""
    idx = pd.date_range("2024-01-01", periods=6, freq="D")
    df = pd.DataFrame(
        {
            # 0 pivot: mimo zónu; 1 vstup přes hranu zone_high; 2 mimo; 3 druhý vstup přes hranu; dál v zóně
            "open": [99.6, 100.3, 101.1, 100.2, 100.4, 100.5],
            "high": [99.8, 101.05, 101.4, 101.02, 100.8, 100.85],
            "low": [99.4, 100.1, 100.98, 100.05, 100.2, 100.3],
            "close": [99.6, 100.3, 101.08, 100.2, 100.5, 100.55],
        },
        index=idx,
    )
    atr = pd.Series(np.ones(len(df), dtype=np.float64), index=idx)
    p = {"zone_departure_min_atr": 0.25, "sd_departure_use_close": 1, "sd_departure_min_bars_after_pivot": 1}
    z_lo, z_hi = 100.0, 101.0
    rm, events = _compute_zone_width_right(
        df, 0, z_lo, z_hi, "Demand", atr, 0.5, [], 15, 5.0, 2.5, p,
    )
    assert events == []
    assert rm == len(df) - 1


def test_sd_unified_retest_touch_after_full_outside_supply():
    """Supply: 1 svíčka celá pod zónou (high < zone_low), pak překryv → touch na hraně retestu (zone_low)."""
    idx = pd.date_range("2024-01-01", periods=3, freq="D")
    df = pd.DataFrame(
        {
            "open": [100.5, 99.2, 99.4],
            "high": [101.2, 99.6, 100.2],
            "low": [99.8, 98.7, 99.0],
            "close": [100.9, 99.1, 100.0],
        },
        index=idx,
    )
    atr = pd.Series(np.ones(len(df), dtype=np.float64), index=idx)
    p = {"sd_departure_min_bars_after_pivot": 1}
    z_lo, z_hi = 100.0, 101.0
    rm, events = _compute_zone_width_right(
        df, 0, z_lo, z_hi, "Supply", atr, 0.5, [], 15, 5.0, 2.5, p,
    )
    assert len(events) == 1
    assert events[0]["bar_index"] == 2
    assert float(events[0]["price"]) == pytest.approx(100.0, abs=1e-9)
    assert events[0]["after_departure"] is True
    assert rm == min(2 + 3, len(df) - 1)
