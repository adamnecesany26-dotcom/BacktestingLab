"""H/L precompute (fáze 2) — manifest + Parquet výstupy."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.artifact_store import hl_manifest_path, read_json_if_exists
from app.services.hl_data_load import load_native_ohlc
from app.services.hl_precompute import compute_hl_module_digest, get_swing_hl_module, run_hl_precompute
from app.services.sd_zone_merge import pandas_rule_for_zone_tf


def _ohlc_30m(n: int = 600) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    t0 = pd.Timestamp("2022-01-03 09:30", tz="UTC")
    idx = pd.date_range(t0, periods=n, freq="30min")
    close = 100 + np.cumsum(rng.normal(0, 0.35, size=n))
    high = close + rng.uniform(0.05, 0.6, size=n)
    low = close - rng.uniform(0.05, 0.6, size=n)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1.0},
        index=idx,
    )


def test_pandas_rule_monthly():
    assert pandas_rule_for_zone_tf("1M") == "1ME"
    assert pandas_rule_for_zone_tf("1MO") == "1ME"


def test_hl_precompute_30m_native_writes_coarser_artifacts_not_30m():
    """Nativní 30m data → předpočet jen do 1h (30m v artefaktech záměrně chybí)."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        # Krátká série: 1M po resamplu má málo svící: nestrjeme se na měsíční výstup
        df = _ohlc_30m(900)
        df.to_parquet(data_dir / "sample.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="sample.parquet",
            years=0.0,
            artifacts_base=root,
            use_lock=False,
        )
        did = result["dataset_id"]
        assert len(did) == 20

        mpath = hl_manifest_path(root, did)
        assert mpath.is_file()
        man = read_json_if_exists(mpath)
        assert man is not None
        assert man.get("kind") == "hl"
        assert man.get("schema_version") == 1
        assert man.get("native_inferred_tf") == "30m"
        assert compute_hl_module_digest()

        arts = man.get("artifacts") or {}
        assert "30m" not in arts
        assert "1h" in arts
        skipped = man.get("skipped_timeframes") or []
        assert not any(s.get("tf") == "30m" for s in skipped)

        hl_dir = mpath.parent
        assert (hl_dir / "1h_swings.parquet").is_file()
        tdf = pd.read_parquet(hl_dir / "1h_swings.parquet")
        assert len(tdf) >= 0
        h1 = arts.get("1h") or {}
        assert int(h1.get("bar_count") or 0) >= 1


def test_hl_precompute_daily_includes_monthly_when_enough_history():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        rng = np.random.default_rng(2)
        idx = pd.date_range("2018-01-01", periods=800, freq="1D", tz="UTC")
        close = 100.0 + np.cumsum(rng.normal(0, 0.8, size=len(idx)))
        df = pd.DataFrame(
            {
                "open": np.roll(close, 1),
                "high": close + 0.6,
                "low": close - 0.6,
                "close": close,
                "volume": 1.0,
            },
            index=idx,
        )
        df.iloc[0, df.columns.get_loc("open")] = close[0]
        df.to_parquet(data_dir / "long_daily.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="long_daily.parquet",
            artifacts_base=root,
            use_lock=False,
        )
        man = read_json_if_exists(hl_manifest_path(root, result["dataset_id"]))
        assert man is not None
        arts = man.get("artifacts") or {}
        assert "1M" in arts
        hl_dir = Path(result["hl_dir"])
        msw = pd.read_parquet(hl_dir / arts["1M"]["swings"])
        assert len(msw) >= 1


def test_hl_precompute_daily_skips_intraday_timeframes():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        rng = np.random.default_rng(1)
        idx = pd.date_range("2020-01-01", periods=400, freq="1D", tz="UTC")
        close = 100.0 + np.cumsum(rng.normal(0, 1.0, size=len(idx)))
        df = pd.DataFrame(
            {
                "open": np.roll(close, 1),
                "high": close + 0.5,
                "low": close - 0.5,
                "close": close,
                "volume": 1.0,
            },
            index=idx,
        )
        df.iloc[0, df.columns.get_loc("open")] = close[0]
        df.to_parquet(data_dir / "daily.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="daily.parquet",
            artifacts_base=root,
            use_lock=False,
        )
        man = read_json_if_exists(hl_manifest_path(root, result["dataset_id"]))
        assert man is not None
        assert man.get("native_inferred_tf") == "1d"
        skipped = {s["tf"]: s["reason"] for s in (man.get("skipped_timeframes") or [])}
        assert "4h" in skipped
        assert "1h" in skipped
        arts = man.get("artifacts") or {}
        assert "1d" in arts
        assert "30m" not in arts


def test_hl_manifest_full_history_vs_view_default_years_window():
    """
    Build (years=0) drží celý rozsah souboru; View default years=0.25 ořezává poslední ~čtvrt roku —
    proto bývá live jiný než artefakt bez sjednocení years.
    """
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        idx = pd.date_range("2018-01-01", periods=400, freq="1D", tz="UTC")
        df = pd.DataFrame(
            {
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.0,
                "volume": 1.0,
            },
            index=idx,
        )
        df.to_parquet(data_dir / "win.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="win.parquet",
            years=0.0,
            artifacts_base=root,
            use_lock=False,
        )
        man = read_json_if_exists(hl_manifest_path(root, result["dataset_id"]))
        assert man is not None
        tr_start = pd.Timestamp(str(man.get("time_range_start") or ""))
        tr_end = pd.Timestamp(str(man.get("time_range_end") or ""))
        assert tr_start == df.index.min()
        assert tr_end == df.index.max()

        short = load_native_ohlc(data_dir, "win.parquet", years=0.25)
        assert len(short) < len(df)
        assert short.index.min() > df.index.min()


def test_long_daily_precompute_swings_use_rolling_not_degenerate():
    """Multi-year daily: swings Parquet má více než pár řádků (regrese max_bars=0 single-pass)."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        rng = np.random.default_rng(11)
        idx = pd.date_range("2018-01-01", periods=900, freq="1D", tz="UTC")
        close = 100.0 + np.cumsum(rng.normal(0, 0.85, size=len(idx)))
        df = pd.DataFrame(
            {
                "open": np.roll(close, 1),
                "high": close + 0.6,
                "low": close - 0.6,
                "close": close,
                "volume": 1.0,
            },
            index=idx,
        )
        df.iloc[0, df.columns.get_loc("open")] = close[0]
        df.to_parquet(data_dir / "long_1d.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="long_1d.parquet",
            artifacts_base=root,
            use_lock=False,
        )
        man = read_json_if_exists(hl_manifest_path(root, result["dataset_id"]))
        assert man is not None
        hl_dir = Path(result["hl_dir"])
        arts = man.get("artifacts") or {}
        sw_name = (arts.get("1d") or {}).get("swings")
        assert sw_name
        s_df = pd.read_parquet(hl_dir / sw_name)
        assert len(s_df) >= 12
        bos_name = (arts.get("1d") or {}).get("bos")
        assert bos_name
        b_df = pd.read_parquet(hl_dir / bos_name)
        assert len(b_df) >= 1


def test_get_swings_long_daily_max_bars_zero_vs_tf_default():
    """Dlouhá denní řada: max_bars=0 jednoprůchod může dát málo swingů; TF default + rolling dá víc."""
    sh = get_swing_hl_module()
    rng = np.random.default_rng(13)
    idx = pd.date_range("2018-01-01", periods=850, freq="1D", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 0.9, size=len(idx)))
    df_chart = pd.DataFrame(
        {
            "open": np.roll(close, 1),
            "high": close + 0.55,
            "low": close - 0.55,
            "close": close,
            "volume": 1.0,
        },
        index=idx,
    )
    df_chart.iloc[0, df_chart.columns.get_loc("open")] = close[0]

    p0 = {
        "timeframe": "1d",
        "data_timeframe": "1d",
        "include_internals": False,
        "require_hl_alternation": False,
        "omit_swings_overlapping_major": False,
        "max_bars": 0,
    }
    r0 = sh.get_swings(df_chart, p0)
    swings0 = r0 if isinstance(r0, list) else (r0.get("swings") or [])

    p_roll = {**p0, "max_bars": 180}
    r1 = sh.get_swings(df_chart, p_roll)
    swings1 = r1 if isinstance(r1, list) else (r1.get("swings") or [])

    assert len(swings1) > len(swings0)


def test_hl_precompute_1d_majors_parquet_non_empty_when_daily_native():
    """Majory pro 1D TF musí být v artefacts zapsané (major_high / major_low z vyšších zdrojů)."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        rng = np.random.default_rng(7)
        idx = pd.date_range("2018-01-01", periods=900, freq="1D", tz="UTC")
        close = 100.0 + np.cumsum(rng.normal(0, 0.85, size=len(idx)))
        df = pd.DataFrame(
            {
                "open": np.roll(close, 1),
                "high": close + 0.6,
                "low": close - 0.6,
                "close": close,
                "volume": 1.0,
            },
            index=idx,
        )
        df.iloc[0, df.columns.get_loc("open")] = close[0]
        df.to_parquet(data_dir / "nq_like_daily.parquet")

        result = run_hl_precompute(
            data_dir=data_dir,
            data_file="nq_like_daily.parquet",
            artifacts_base=root,
            use_lock=False,
        )
        man = read_json_if_exists(hl_manifest_path(root, result["dataset_id"]))
        assert man is not None
        arts = man.get("artifacts") or {}
        assert "1d" in arts
        hl_dir = Path(result["hl_dir"])
        maj_path = hl_dir / arts["1d"]["majors"]
        maj_df = pd.read_parquet(maj_path)
        assert len(maj_df) >= 1
        types = set(str(t).lower() for t in maj_df.get("type", []) if pd.notna(t))
        assert types & {"major_high", "major_low"} or types & {"high", "low"}
