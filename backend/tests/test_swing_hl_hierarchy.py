"""Tests for hierarchical TF_PARENT / TF_INTERNAL and native OHLC injection."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_MOD_PATH = (
    Path(__file__).resolve().parents[2]
    / "strategies"
    / "sd_zone_strategy"
    / "modules"
    / "Swing_HL.py"
)


@pytest.fixture(scope="module")
def sh():
    spec = importlib.util.spec_from_file_location("swing_hl_test", _MOD_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _demo_ohlc_30m(n: int = 800) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    t0 = pd.Timestamp("2024-01-02 09:30", tz="UTC")
    idx = pd.date_range(t0, periods=n, freq="30min")
    close = 100 + np.cumsum(rng.normal(0, 0.35, size=n))
    high = close + rng.uniform(0.05, 0.6, size=n)
    low = close - rng.uniform(0.05, 0.6, size=n)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close},
        index=idx,
    )


def test_weekly_chart_disables_majors_despite_daily_param(sh):
    idx = pd.date_range("2020-01-01", periods=80, freq="1W", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )
    assert sh._chart_tf_for_hierarchy(ohlc, "1d", "1w") == "1w"
    majors = sh.get_major_swings(
        ohlc,
        {"timeframe": "1d", "data_timeframe": "1w"},
    )
    assert majors == []


def test_daily_chart_tf_from_ohlc_not_polluted_timeframe_1w(sh):
    rng = np.random.default_rng(7)
    idx = pd.date_range("2020-01-01", periods=320, freq="1D", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 1.2, size=len(idx)))
    ohlc = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + rng.uniform(0.3, 1.5, size=len(idx)),
            "low": close - rng.uniform(0.3, 1.5, size=len(idx)),
            "close": close,
        },
        index=idx,
    )
    ohlc.iloc[0, ohlc.columns.get_loc("open")] = close[0]
    assert sh._chart_tf_for_hierarchy(ohlc, "1w", "1d") == "1d"
    majors = sh.get_major_swings(
        ohlc,
        {"timeframe": "1w", "data_timeframe": "1d", "max_bars": 0},
    )
    assert isinstance(majors, list)
    assert all(m["type"] in ("major_high", "major_low") for m in majors)
    assert len(majors) >= 1


def _ohlc_4h_simple(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=n, freq="4h", tz="UTC")
    return pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )


def test_major_sources_4h_includes_m_w_d(sh):
    ohlc = _ohlc_4h_simple()
    assert sh._major_tf_sources_for_chart("4h", ohlc) == ("1M", "1w", "1d")


def test_major_sources_30m_includes_m_w_d(sh):
    idx = pd.date_range("2020-01-01", periods=200, freq="30min", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )
    assert sh._major_tf_sources_for_chart("30m", ohlc) == ("1M", "1w", "1d")


def test_major_sources_1d_month_and_week(sh):
    idx = pd.date_range("2020-01-01", periods=80, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.002},
        index=idx,
    )
    assert sh._major_tf_sources_for_chart("1d", ohlc) == ("1M", "1w")


def test_major_sources_after_hierarchy_4h_ohlc_not_stale_1d(sh):
    """Po _chart_tf_for_hierarchy: reálné 4h svíčky → chart 4h, majory z 1M+1w+1d."""
    ohlc = _ohlc_4h_simple(100)
    chart_tf = sh._chart_tf_for_hierarchy(ohlc, "1d", "", None)
    assert chart_tf == "4h"
    assert sh._major_tf_sources_for_chart(chart_tf, ohlc) == ("1M", "1w", "1d")
    tf_r, src = sh._major_sources_and_resample_tf(chart_tf, ohlc)
    assert src == ("1M", "1w", "1d")
    assert tf_r == "4h"


def test_resample_daily_from_4h_when_chart_tf_stale_1d(sh):
    """Deklarovaný chart TF 1d při 4h OHLC nesmí přeskočit agregaci na 1D (jinak chybí major ze 1D)."""
    idx = pd.date_range("2020-01-01", periods=120, freq="4h", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )
    daily = sh._resample_ohlc(ohlc, "1d", None, source_tf_effective="1d")
    assert daily is not ohlc
    assert len(daily) < len(ohlc)


def test_canonical_chart_tf_month_not_minute(sh):
    assert sh._canonical_chart_tf("1Mo") == "1M"
    assert sh._canonical_chart_tf("1M") == "1M"
    assert sh._canonical_chart_tf("1m") == "1m"


def test_get_major_swings_on_4h_chart(sh):
    # 1W majors potřebují dost týdnů po převodu 30m→4h (600 30m ≈ jen ~2 týdny → prázdné).
    native = _demo_ohlc_30m(2500)
    four_h = sh._resample_ohlc(native, "4h", sh._infer_data_timeframe(native))
    assert four_h is not None and len(four_h) > 20
    majors = sh.get_major_swings(
        four_h,
        {"timeframe": "4h", "data_timeframe": "4h", "max_bars": 0},
    )
    assert isinstance(majors, list)
    assert all(m["type"] in ("major_high", "major_low") for m in majors)
    if majors:
        assert 0 <= majors[0]["index"] < len(four_h)


def _ohlc_4h_series_with_skewed_median_gaps(n: int = 150) -> pd.DataFrame:
    """Dlouhé meže 72h + krátké 4h — celkový medián by býval byl „1d“, po filtru <48h zůstane 4h."""
    rng = np.random.default_rng(99)
    t0 = pd.Timestamp("2024-01-02 14:00", tz="UTC")
    idx_list = [t0]
    n_gap = n - 1
    n_short = max(1, n_gap // 2 - 6)
    for i in range(n_gap):
        step_h = 4 if i < n_short else 72
        idx_list.append(idx_list[-1] + pd.Timedelta(hours=step_h))
    idx = pd.DatetimeIndex(idx_list)
    close = 100.0 + np.cumsum(rng.normal(0, 0.4, size=n))
    high = close + rng.uniform(0.05, 0.45, size=n)
    low = close - rng.uniform(0.05, 0.45, size=n)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


def test_view_chart_tf_1d_on_4h_ohlc_reconciles_to_spacing(sh):
    """Špatný _view_chart_tf=1d při skutečných 4h svíčkách → hierarchie 4h, major z 1M+1w+1d."""
    ohlc = _ohlc_4h_series_with_skewed_median_gaps(150)
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1d", "", "1d") == "4h"
    assert sh._major_tf_sources_for_chart(sh._chart_tf_for_hierarchy(ohlc, "1d", "", "1d"), ohlc) == (
        "1M",
        "1w",
        "1d",
    )
    majors = sh.get_major_swings(
        ohlc, {"timeframe": "1d", "_view_chart_tf": "1d", "max_bars": 0}
    )
    assert len(majors) >= 2
    assert all(m["type"] in ("major_high", "major_low") for m in majors)


def test_view_chart_tf_overrides_skewed_median_infer(sh):
    ohlc = _ohlc_4h_series_with_skewed_median_gaps(150)
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1w", "4h", "4h") == "4h"
    majors = sh.get_major_swings(
        ohlc,
        {"timeframe": "1w", "data_timeframe": "4h", "_view_chart_tf": "4h", "max_bars": 0},
    )
    assert isinstance(majors, list)
    assert len(majors) >= 1
    assert all(m["type"] in ("major_high", "major_low") for m in majors)


def test_data_timeframe_reconciles_when_finer_than_infer(sh):
    ohlc = _ohlc_4h_series_with_skewed_median_gaps(150)
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1w", "4h", None) == "4h"
    majors = sh.get_major_swings(
        ohlc,
        {"timeframe": "1w", "data_timeframe": "4h", "max_bars": 0},
    )
    assert len(majors) >= 1


def test_hierarchy_prefers_data_timeframe_before_infer(sh):
    """Bez _view_chart_tf: data_timeframe 4h nebo odhad z mezer — graf 4h, Major z 1M+1w+1d."""
    ohlc = _ohlc_4h_series_with_skewed_median_gaps(150)
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1w", "4h", None) == "4h"
    assert sh._major_tf_sources_for_chart(
        sh._chart_tf_for_hierarchy(ohlc, "1w", "4h", None),
        ohlc,
    ) == ("1M", "1w", "1d")


def test_infer_uses_intraweek_median_not_weekend_skew(sh):
    """4h řada s pauzami o víkendu — bez filtru <48h by medián spadl do '1d'."""
    parts: list[pd.Timestamp] = []
    t = pd.Timestamp("2024-01-02 14:00", tz="UTC")
    for _w in range(8):
        for _b in range(30):
            parts.append(t)
            t = t + pd.Timedelta(hours=4)
        t = t + pd.Timedelta(days=2)
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=pd.DatetimeIndex(parts),
    )
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1d", "", None) == "4h"


def test_hierarchy_infer_when_data_tf_missing(sh):
    idx = pd.date_range("2020-01-01", periods=50, freq="4h", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        index=idx,
    )
    assert sh._chart_tf_for_hierarchy(ohlc, "1d", None, None) == "4h"


def test_hierarchy_ignores_stale_coarser_data_tf(sh):
    """data_timeframe 1d při inferovaných 4h datech se ignoruje; TF grafu zůstane 4h (Major z 1D)."""
    rng = np.random.default_rng(201)
    idx = pd.date_range("2020-01-01", periods=400, freq="4h", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 0.5, size=len(idx)))
    ohlc = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + rng.uniform(0.1, 0.5, size=len(idx)),
            "low": close - rng.uniform(0.1, 0.5, size=len(idx)),
            "close": close,
        },
        index=idx,
    )
    ohlc.iloc[0, ohlc.columns.get_loc("open")] = close[0]
    assert sh._infer_data_timeframe(ohlc) == "4h"
    assert sh._chart_tf_for_hierarchy(ohlc, "1w", "1d", None) == "4h"
    majors = sh.get_major_swings(ohlc, {"timeframe": "1w", "data_timeframe": "1d", "max_bars": 0})
    assert len(majors) >= 1
    assert all(m["type"] in ("major_high", "major_low") for m in majors)


def test_inject_forced_low_between_two_highs(sh):
    idx = pd.date_range("2024-01-01", periods=10, freq="1h", tz="UTC")
    ohlc = pd.DataFrame({
        "open": 100.0,
        "high": 101.0,
        "low": 99.5,
        "close": 100.0,
    }, index=idx)
    ohlc.loc[idx[2], ["high", "low"]] = [104.0, 102.0]
    ohlc.loc[idx[5], ["high", "low", "close"]] = [106.0, 88.0, 90.0]
    ohlc.loc[idx[8], ["high", "low"]] = [107.0, 103.0]
    swings = [
        {"type": "high", "price": 104.0, "index": 2, "timestamp": idx[2]},
        {"type": "high", "price": 107.0, "index": 8, "timestamp": idx[8]},
    ]
    out = sh._inject_forced_extremes_between_same_swings(swings, ohlc)
    lows = [s for s in out if s["type"] == "low"]
    assert len(lows) == 1
    assert lows[0]["index"] == 5
    assert abs(lows[0]["price"] - 88.0) < 1e-9


def test_inject_forced_high_between_two_lows(sh):
    idx = pd.date_range("2024-01-01", periods=10, freq="1h", tz="UTC")
    ohlc = pd.DataFrame({
        "open": 100.0,
        "high": 101.0,
        "low": 99.5,
        "close": 100.0,
    }, index=idx)
    ohlc.loc[idx[5], ["high", "low"]] = [115.0, 103.0]
    swings = [
        {"type": "low", "price": 99.0, "index": 2, "timestamp": idx[2]},
        {"type": "low", "price": 98.0, "index": 8, "timestamp": idx[8]},
    ]
    out = sh._inject_forced_extremes_between_same_swings(swings, ohlc)
    highs = [s for s in out if s["type"] == "high"]
    assert len(highs) == 1
    assert highs[0]["index"] == 5
    assert abs(highs[0]["price"] - 115.0) < 1e-9


def test_inject_skips_when_major_low_between_two_highs(sh):
    idx = pd.date_range("2024-01-01", periods=10, freq="1h", tz="UTC")
    ohlc = pd.DataFrame({
        "open": 100.0,
        "high": 101.0,
        "low": 99.5,
        "close": 100.0,
    }, index=idx)
    ohlc.loc[idx[2], ["high", "low"]] = [104.0, 102.0]
    ohlc.loc[idx[5], ["high", "low", "close"]] = [106.0, 88.0, 90.0]
    ohlc.loc[idx[8], ["high", "low"]] = [107.0, 103.0]
    swings = [
        {"type": "high", "price": 104.0, "index": 2, "timestamp": idx[2]},
        {"type": "high", "price": 107.0, "index": 8, "timestamp": idx[8]},
    ]
    majors = [{"type": "major_low", "price": 88.0, "index": 5, "timestamp": idx[5]}]
    out = sh._inject_forced_extremes_between_same_swings(swings, ohlc, majors)
    assert [s for s in out if s["type"] == "low"] == []


def test_inject_skips_when_major_high_between_two_lows(sh):
    idx = pd.date_range("2024-01-01", periods=10, freq="1h", tz="UTC")
    ohlc = pd.DataFrame({
        "open": 100.0,
        "high": 101.0,
        "low": 99.5,
        "close": 100.0,
    }, index=idx)
    ohlc.loc[idx[3], ["high", "low"]] = [112.0, 108.0]
    swings = [
        {"type": "low", "price": 99.0, "index": 2, "timestamp": idx[2]},
        {"type": "low", "price": 98.0, "index": 7, "timestamp": idx[7]},
    ]
    majors = [{"type": "major_high", "price": 112.0, "index": 3, "timestamp": idx[3]}]
    out = sh._inject_forced_extremes_between_same_swings(swings, ohlc, majors)
    assert [s for s in out if s["type"] == "high"] == []


def test_internals_use_native_when_injected(sh):
    native = _demo_ohlc_30m(400)
    four_h = sh._resample_ohlc(native, "4h", sh._infer_data_timeframe(native))
    out = sh.get_swings(
        four_h,
        {
            "timeframe": "4h",
            "data_timeframe": "4h",
            "max_bars": 0,
            "include_internals": True,
            "omit_swings_overlapping_major": False,
            "require_hl_alternation": False,
            "_view_ohlc_native": native,
        },
    )
    assert isinstance(out, dict)
    assert "internals" in out
    assert isinstance(out["internals"], list)


def test_bos_pivot_cluster_does_not_chain_across_long_trend(sh):
    """Šířka clusteru od prvního pivotu — nedoplnit všechny měsíční high do jedné skupiny."""
    idx = pd.date_range("2025-01-01", periods=40, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": 99.0,
            "high": 102.0,
            "low": 98.0,
            "close": 100.0,
        },
        index=idx,
    )
    swings = [
        {"type": "high", "price": 100.0, "index": 0, "timestamp": idx[0]},
        {"type": "high", "price": 101.0, "index": 6, "timestamp": idx[6]},
        {"type": "high", "price": 102.0, "index": 12, "timestamp": idx[12]},
    ]
    out = sh._collapse_bos_pivot_clusters(
        swings, ohlc, {"bos_pivot_cluster_max_bars": 6, "bos_pivot_cluster_atr_mult": 0.35}
    )
    assert len(out) == 2
    assert {int(s["index"]) for s in out} == {6, 12}


def test_bos_pivot_cluster_keeps_highest_high_in_cluster(sh):
    idx = pd.date_range("2025-01-01", periods=30, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {
            "open": 99.0,
            "high": 102.0,
            "low": 98.0,
            "close": 100.0,
        },
        index=idx,
    )
    swings = [
        {"type": "high", "price": 100.0, "index": 5, "timestamp": idx[5]},
        {"type": "high", "price": 101.0, "index": 7, "timestamp": idx[7]},
    ]
    out = sh._collapse_bos_pivot_clusters(
        swings, ohlc, {"bos_pivot_cluster_max_bars": 10, "bos_pivot_cluster_atr_mult": 0.0}
    )
    assert len(out) == 1
    assert out[0]["price"] == 101.0
    assert int(out[0]["index"]) == 7


def test_merge_bos_events_in_range_keeps_highest_bull(sh):
    idx = pd.date_range("2025-01-01", periods=40, freq="1D", tz="UTC")
    ohlc = pd.DataFrame(
        {"open": 99.0, "high": 102.0, "low": 98.0, "close": 100.0},
        index=idx,
    )
    events = [
        {
            "type": "bos_bullish",
            "level": 100.0,
            "swing_index": 5,
            "bos_index": 8,
            "bos_swing_kind": "major",
            "is_major": True,
        },
        {
            "type": "bos_bullish",
            "level": 101.5,
            "swing_index": 7,
            "bos_index": 9,
            "bos_swing_kind": "internal",
            "is_major": False,
        },
    ]
    out = sh._merge_bos_events_in_consolidation_ranges(
        events,
        ohlc,
        {"bos_range_merge_atr_mult": 2.5, "bos_range_merge_max_swing_bars": 25},
    )
    assert len(out) == 1
    assert out[0]["level"] == 101.5


def _norm_major_rows(m: list[dict]) -> list[tuple]:
    rows = [
        (str(x["type"]), int(x["index"]), round(float(x["price"]), 4))
        for x in m
    ]
    return sorted(rows, key=lambda t: (t[1], t[0]))


def _mirror_pre_dedupe_major_swings(sh, ohlc: pd.DataFrame, params: dict) -> tuple[list[dict], tuple[str, ...], str]:
    """
    Kopie smyčky z get_major_swings před _dedupe_merged_major_swings (pro kontrolu konzistence).
    """
    raw_tf = sh._canonical_chart_tf(str(params.get("timeframe", "1d")))
    data_tf_raw = params.get("data_timeframe")
    vraw = params.get("_view_chart_tf")
    vctf = None
    if isinstance(vraw, str) and vraw.strip():
        vc = sh._canonical_chart_tf(vraw.strip())
        if vc in sh.TF_FINE_TO_COARSE:
            vctf = vc
    tf = sh._chart_tf_for_hierarchy(
        ohlc,
        raw_tf,
        data_tf_raw if isinstance(data_tf_raw, str) else None,
        vctf,
    )
    tf_resample, sources = sh._major_sources_and_resample_tf(tf, ohlc)
    merged: list[dict] = []
    if not sources:
        return merged, sources, tf_resample

    data_tf = params.get("data_timeframe")
    dt_arg = (
        sh._canonical_chart_tf(str(data_tf).strip())
        if isinstance(data_tf, str) and str(data_tf).strip()
        else None
    )
    tuning = {k: params[k] for k in sh._MAJOR_SWING_PARAM_KEYS if k in params}

    for major_tf in sources:
        if major_tf not in sh.TF_CONFIG:
            continue
        resampled = sh._resample_ohlc(ohlc, major_tf, dt_arg, source_tf_effective=tf_resample)
        min_resampled = 6 if major_tf == "1w" else 10
        if resampled is ohlc or resampled is None or len(resampled) < min_resampled:
            continue

        base = dict(sh.TF_CONFIG[major_tf])
        maj_params = {**base, **tuning}
        maj_params["timeframe"] = major_tf
        maj_params["require_hl_alternation"] = False
        try:
            sp = float(params.get("swing_sparsity", 1.0) or 1.0)
        except (TypeError, ValueError):
            sp = 1.0
        sp = max(0.35, min(float(sp), 5.0))
        mb_m = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
        maj_params["min_bars_between_swings"] = max(2, int(round(mb_m * sp)))
        atr_mm = float(maj_params.get("atr_multiplier", 1.6))
        atr_bm = 1.0 + 0.12 * max(0.0, sp - 1.0)
        maj_params["atr_multiplier"] = min(3.5, atr_mm * atr_bm)
        swings, _ = sh._get_swings_core(resampled, maj_params)
        atr_period = int(maj_params.get("atr_period", 10))
        atr_series = sh._compute_atr(resampled, atr_period)
        swings = sh._deduplicate_swings(swings, resampled, atr_series)
        mb = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
        swings = sh._enforce_same_type_min_spacing(swings, mb)
        if bool(maj_params.get("force_extremes_between_same_swings", True)):
            swings = sh._inject_forced_extremes_between_same_swings(swings, resampled, None)
        swings = sorted(swings, key=lambda s: (int(s["index"]), 0 if s.get("type") == "high" else 1))
        for s in swings:
            idx, price = sh._map_major_swing_to_original(s, resampled, ohlc, major_tf)
            merged.append({
                "type": f"major_{s['type']}",
                "price": price,
                "index": idx,
                "timestamp": ohlc.index[idx] if idx < len(ohlc) else s.get("timestamp"),
            })

    return merged, sources, tf_resample


def _major_swings_one_tf_only(sh, ohlc, tf_resample, major_tf: str, params: dict) -> list[dict]:
    data_tf = params.get("data_timeframe")
    dt_arg = (
        sh._canonical_chart_tf(str(data_tf).strip())
        if isinstance(data_tf, str) and str(data_tf).strip()
        else None
    )
    tuning = {k: params[k] for k in sh._MAJOR_SWING_PARAM_KEYS if k in params}
    resampled = sh._resample_ohlc(ohlc, major_tf, dt_arg, source_tf_effective=tf_resample)
    min_resampled = 6 if major_tf == "1w" else 10
    if resampled is ohlc or resampled is None or len(resampled) < min_resampled:
        return []
    base = dict(sh.TF_CONFIG[major_tf])
    maj_params = {**base, **tuning}
    maj_params["timeframe"] = major_tf
    maj_params["require_hl_alternation"] = False
    try:
        sp = float(params.get("swing_sparsity", 1.0) or 1.0)
    except (TypeError, ValueError):
        sp = 1.0
    sp = max(0.35, min(float(sp), 5.0))
    mb_m = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
    maj_params["min_bars_between_swings"] = max(2, int(round(mb_m * sp)))
    atr_mm = float(maj_params.get("atr_multiplier", 1.6))
    atr_bm = 1.0 + 0.12 * max(0.0, sp - 1.0)
    maj_params["atr_multiplier"] = min(3.5, atr_mm * atr_bm)
    swings, _ = sh._get_swings_core(resampled, maj_params)
    atr_period = int(maj_params.get("atr_period", 10))
    atr_series = sh._compute_atr(resampled, atr_period)
    swings = sh._deduplicate_swings(swings, resampled, atr_series)
    mb = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
    swings = sh._enforce_same_type_min_spacing(swings, mb)
    if bool(maj_params.get("force_extremes_between_same_swings", True)):
        swings = sh._inject_forced_extremes_between_same_swings(swings, resampled, None)
    swings = sorted(swings, key=lambda s: (int(s["index"]), 0 if s.get("type") == "high" else 1))
    out = []
    for s in swings:
        idx, price = sh._map_major_swing_to_original(s, resampled, ohlc, major_tf)
        out.append({
            "type": f"major_{s['type']}",
            "price": price,
            "index": idx,
            "timestamp": ohlc.index[idx] if idx < len(ohlc) else s.get("timestamp"),
        })
    return out


def test_demo_data_4h_majors_equal_decomposed_1m_1w_1d(sh):
    """
    Na demo 30m → 4h: get_major_swings odpovídá sloučení 1M + 1w + 1d swingů → map na 4h → dedupe.
    Simuluje View: stale timeframe=1d, _view_chart_tf=4h.
    """
    native = _demo_ohlc_30m(4500)
    four_h = sh._resample_ohlc(native, "4h", sh._infer_data_timeframe(native))
    assert len(four_h) > 250
    params = {
        "timeframe": "1d",
        "data_timeframe": "",
        "_view_chart_tf": "4h",
        "max_bars": 0,
        "swing_sparsity": sh.VIEW_PARAMS.get("swing_sparsity", 1.12),
    }
    merged, sources, tf_res = _mirror_pre_dedupe_major_swings(sh, four_h, params)
    assert sources == ("1M", "1w", "1d")
    assert len(merged) >= 4
    expected = sh._dedupe_merged_major_swings(merged)
    actual = sh.get_major_swings(four_h, params)
    assert _norm_major_rows(actual) == _norm_major_rows(expected)


def test_demo_data_4h_each_1d_reference_has_matching_major(sh):
    """Každý swing z 1D řady zmapovaný na 4h má odpovídající major_* po finálním dedupe (±tol)."""
    native = _demo_ohlc_30m(4500)
    four_h = sh._resample_ohlc(native, "4h", sh._infer_data_timeframe(native))
    params = {
        "timeframe": "1d",
        "data_timeframe": "",
        "_view_chart_tf": "4h",
        "max_bars": 0,
        "swing_sparsity": sh.VIEW_PARAMS.get("swing_sparsity", 1.12),
    }
    tf = sh._chart_tf_for_hierarchy(four_h, "1d", None, "4h")
    tf_res, sources = sh._major_sources_and_resample_tf(tf, four_h)
    assert sources == ("1M", "1w", "1d")

    daily_rows = _major_swings_one_tf_only(sh, four_h, tf_res, "1d", params)
    weekly_rows = _major_swings_one_tf_only(sh, four_h, tf_res, "1w", params)
    assert len(daily_rows) >= 2
    assert len(weekly_rows) >= 1

    majors = sh.get_major_swings(four_h, params)
    tol = sh.MAJOR_SWING_INDEX_TOLERANCE

    def covered(ref: dict) -> bool:
        typ, ix = ref["type"], int(ref["index"])
        return any(
            m["type"] == typ and abs(int(m["index"]) - ix) <= tol for m in majors
        )

    for ref in daily_rows + weekly_rows:
        assert covered(ref), (
            f"major missing for ref {ref} — have {[(m['type'], m['index']) for m in majors]}"
        )


def test_demo_data_1h_majors_equal_decomposed_1m_1w_1d(sh):
    """Totéž pro jemnější graf (1h) — zdroje 1M+1w+1d."""
    native = _demo_ohlc_30m(6000)
    one_h = sh._resample_ohlc(native, "1h", sh._infer_data_timeframe(native))
    assert len(one_h) > 400
    params = {
        "timeframe": "1d",
        "data_timeframe": "",
        "_view_chart_tf": "1h",
        "max_bars": 0,
        "swing_sparsity": 1.12,
    }
    merged, sources, _ = _mirror_pre_dedupe_major_swings(sh, one_h, params)
    assert sources == ("1M", "1w", "1d")
    assert len(merged) >= 4
    expected = sh._dedupe_merged_major_swings(merged)
    actual = sh.get_major_swings(one_h, params)
    assert _norm_major_rows(actual) == _norm_major_rows(expected)
