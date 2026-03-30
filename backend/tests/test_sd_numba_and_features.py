"""Light tests for SD feature bundle + Numba helpers."""

import numpy as np
import pandas as pd

from app.services.sd_feature_pipeline import get_sd_zones_cached, zones_to_interval_arrays
from app.services.sd_numba_exec import (
    STATUS_CLOSED,
    STATUS_NO_TRADE,
    count_bars_inside_any_zone,
    simulate_sd_demand_limit_edge_numba,
    simulate_sd_demand_limit_edge_py,
)


def test_zones_to_interval_arrays_empty():
    b = zones_to_interval_arrays([], 100)
    assert b["low"].shape == (0,)


def test_zones_to_interval_arrays_filters_sd():
    zones = [
        {"name": "Demand", "start_idx": 0, "end_idx": 5, "pivot_idx": 1, "value_low": 1.0, "value_high": 2.0},
        {"name": "Other", "start_idx": 0, "end_idx": 1, "value_low": 0.0, "value_high": 1.0},
    ]
    b = zones_to_interval_arrays(zones, 10)
    assert len(b["low"]) == 1
    assert b["is_demand"][0] == 1


def test_get_sd_zones_cached_memory_hits():
    calls = {"n": 0}

    def gz(zoh, mp):
        calls["n"] += 1
        return [
            {
                "name": "Demand",
                "start_idx": 0,
                "end_idx": 1,
                "value_low": 1.0,
                "value_high": 2.0,
            }
        ]

    zoh = pd.DataFrame(
        {"open": [1.0], "high": [2.0], "low": [0.5], "close": [1.5]},
        index=pd.DatetimeIndex([pd.Timestamp("2020-01-01", tz="UTC")]),
    )
    mem: dict = {}
    get_sd_zones_cached(
        gz,
        zoh,
        {},
        zone_tf="1d",
        mem_cache=mem,
        cache_dir=None,
        data_fingerprint=None,
        disk_enabled=False,
    )
    get_sd_zones_cached(
        gz,
        zoh,
        {},
        zone_tf="1d",
        mem_cache=mem,
        cache_dir=None,
        data_fingerprint=None,
        disk_enabled=False,
    )
    assert calls["n"] == 1


def test_get_sd_zones_cached_disk_roundtrip(tmp_path):
    calls = {"n": 0}

    def gz(zoh, mp):
        calls["n"] += 1
        return [
            {
                "name": "Demand",
                "start_idx": 0,
                "end_idx": 1,
                "value_low": 1.0,
                "value_high": 2.0,
            }
        ]

    zoh = pd.DataFrame(
        {"open": [1.0], "high": [2.0], "low": [0.5], "close": [1.5]},
        index=pd.DatetimeIndex([pd.Timestamp("2020-01-01")]),
    )
    get_sd_zones_cached(
        gz,
        zoh,
        {},
        zone_tf="1d",
        mem_cache={},
        cache_dir=tmp_path,
        data_fingerprint="testfp",
        disk_enabled=True,
    )
    assert calls["n"] == 1
    calls["n"] = 0
    r2 = get_sd_zones_cached(
        gz,
        zoh,
        {},
        zone_tf="1d",
        mem_cache={},
        cache_dir=tmp_path,
        data_fingerprint="testfp",
        disk_enabled=True,
    )
    assert calls["n"] == 0
    assert len(r2) == 1 and r2[0].get("name") == "Demand"


def _assert_py_numba_sd_match(high, low, close, **kw):
    py = simulate_sd_demand_limit_edge_py(high, low, close, **kw)
    nb = simulate_sd_demand_limit_edge_numba(
        np.asarray(high, dtype=np.float64),
        np.asarray(low, dtype=np.float64),
        np.asarray(close, dtype=np.float64),
        float(kw["zl"]),
        float(kw["zh"]),
        int(kw["zone_start"]),
        int(kw["zone_end"]),
        float(kw["stop_offset_pct"]),
        float(kw["target_rr"]),
        int(kw["max_hold_bars"]),
        int(kw["max_limit_bars_exec"]),
        int(kw["lim_mode"]),
        float(kw["entry_pct"]),
    )
    assert py == nb, (py, nb)


def test_sd_demand_limit_edge_py_numba_departure_fill_target():
    n = 30
    high = np.ones(n, dtype=np.float64) * 99.8
    low = np.ones(n, dtype=np.float64) * 99.0
    close = np.ones(n, dtype=np.float64) * 99.5
    # bar 6: depart (low > zh=99.5)
    low[6] = 99.6
    high[6] = 100.2
    # bar 7: touch limit at zh
    low[7] = 99.0
    high[7] = 100.5
    # bar 8: hit target (high enough)
    high[8] = 102.0
    kw = dict(
        zl=98.5,
        zh=99.5,
        zone_start=0,
        zone_end=20,
        stop_offset_pct=0.1,
        target_rr=1.5,
        max_hold_bars=50,
        max_limit_bars_exec=20,
        lim_mode=0,
        entry_pct=0.5,
    )
    _assert_py_numba_sd_match(high, low, close, **kw)
    ei, exi, ep, xp, st = simulate_sd_demand_limit_edge_py(high, low, close, **kw)
    assert st == STATUS_CLOSED
    assert ei == 7 and exi == 8
    assert ep == 99.5  # edge long = zh
    assert abs(xp - (ep + (ep - (98.5 - 0.1)) * 1.5)) < 1e-9


def test_sd_demand_limit_edge_limit_timeout():
    n = 25
    high = np.linspace(99.0, 99.4, n).astype(np.float64)
    low = high - 0.5
    close = (high + low) / 2.0
    low[8] = 100.0  # depart
    high[8] = 100.5
    kw = dict(
        zl=98.5,
        zh=99.5,
        zone_start=0,
        zone_end=22,
        stop_offset_pct=0.1,
        target_rr=1.5,
        max_hold_bars=50,
        max_limit_bars_exec=3,
        lim_mode=0,
        entry_pct=0.5,
    )
    # Never cross entry 99.5 after arm — price stays below limit
    _assert_py_numba_sd_match(high, low, close, **kw)
    ei, _, _, _, st = simulate_sd_demand_limit_edge_py(high, low, close, **kw)
    assert st == STATUS_NO_TRADE
    assert ei == -1


def test_sd_demand_limit_edge_stop_priority():
    n = 20
    high = np.ones(n, dtype=np.float64) * 100.0
    low = np.ones(n, dtype=np.float64) * 99.0
    close = (high + low) / 2.0
    low[5] = 100.2
    high[5] = 101.0  # depart + arm
    low[6] = 99.0
    high[6] = 100.5  # fill limit @ 99.5
    low[7] = 97.0
    high[7] = 102.0  # stop and target same bar — kernel uses stop first
    kw = dict(
        zl=98.5,
        zh=99.5,
        zone_start=0,
        zone_end=15,
        stop_offset_pct=0.1,
        target_rr=2.0,
        max_hold_bars=50,
        max_limit_bars_exec=10,
        lim_mode=0,
        entry_pct=0.5,
    )
    _assert_py_numba_sd_match(high, low, close, **kw)
    ei, exi, ep, xp, st = simulate_sd_demand_limit_edge_py(high, low, close, **kw)
    assert st == STATUS_CLOSED
    assert ei == 6 and exi == 7
    assert xp < ep  # stopped out (98.4)
    assert abs(xp - (98.5 - 0.1)) < 1e-9


def test_count_bars_inside_any_zone():
    n = 5
    low = np.array([1.0, 1.0, 1.0, 1.0, 1.0], dtype=np.float64)
    high = np.array([1.5, 1.5, 1.5, 1.5, 1.5], dtype=np.float64)
    z_low = np.array([1.2], dtype=np.float64)
    z_high = np.array([1.4], dtype=np.float64)
    z_s = np.array([1], dtype=np.int32)
    z_e = np.array([3], dtype=np.int32)
    out = count_bars_inside_any_zone(low, high, z_low, z_high, z_s, z_e, n, 1)
    assert out[0] == 0
    assert out[1] >= 1
    assert out[2] >= 1
