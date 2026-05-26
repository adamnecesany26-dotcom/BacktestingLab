"""Smoke tests for ORB Prop Firm Killer strategy and MNQ ETL helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module", autouse=True)
def _repo_root_path():
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    yield


def _load_engine_mod():
    import sys

    name = "docker_engine_orb_test"
    path = ROOT / "backend" / "docker" / "engine.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_utc_bar_open_to_ny_rth_align():
    from strategies.orb_prop_firm_killer.orb_core import utc_bar_open_to_ny

    tsu = pd.Timestamp("2024-01-02 14:30:00")
    ny = utc_bar_open_to_ny(tsu)
    assert ny.hour == 9
    assert ny.minute == 30


def test_orb_prop_firm_killer_engine_smoke():
    eng = _load_engine_mod()
    strat_path = ROOT / "strategies" / "orb_prop_firm_killer" / "main.py"
    cls = eng.load_strategy(str(strat_path))
    # 2024-01-02 14:30 UTC ≈ 09:30 US/Eastern (EST)
    idx = pd.date_range("2024-01-02 14:30", periods=420, freq="min", tz="UTC")
    n = len(idx)
    close = [100.0 + (i % 5) * 0.02 for i in range(n)]
    high = [c + 0.15 for c in close]
    low = [c - 0.15 for c in close]
    open_ = [close[i] if i == 0 else close[i - 1] for i in range(n)]
    # spike through OR high mid-session
    for i in range(30, 80):
        close[i] = 100.0 + (i - 30) * 0.05
        high[i] = close[i] + 0.1
        low[i] = close[i] - 0.1
        open_[i] = close[i - 1]
    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": [100.0] * n},
        index=idx.tz_localize(None),
    )
    params = {
        "process_orders_on_close": True,
        "relaxed_bt": True,
        "orb_minutes": 5,
        "use_htf": False,
        "use_uni": False,
        "use_rel_vol": False,
        "contracts": 1.0,
        "trade_mode": "Full Position (TP / EoD only)",
    }
    out = eng.run_backtest(cls, df, strategy_params=params, lightweight=True)
    assert isinstance(out, dict)
    assert "trades" in out
    assert isinstance(out["trades"], list)


def test_orb_ref_v2_engine_smoke():
    eng = _load_engine_mod()
    strat_path = ROOT / "strategies" / "orb_prop_firm_killer_ref_v2" / "main.py"
    cls = eng.load_strategy(str(strat_path))
    idx = pd.date_range("2024-01-02 14:30", periods=420, freq="min", tz="UTC")
    n = len(idx)
    close = [100.0 + (i % 5) * 0.02 for i in range(n)]
    high = [c + 0.15 for c in close]
    low = [c - 0.15 for c in close]
    open_ = [close[i] if i == 0 else close[i - 1] for i in range(n)]
    for i in range(30, 80):
        close[i] = 100.0 + (i - 30) * 0.05
        high[i] = close[i] + 0.1
        low[i] = close[i] - 0.1
        open_[i] = close[i - 1]
    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": [100.0] * n},
        index=idx.tz_localize(None),
    )
    params = {
        "process_orders_on_close": True,
        "relaxed_bt": True,
        "or_minutes_standard": 5,
        "use_uni": False,
        "use_rel_vol": False,
        "strat_mode": "standard",
    }
    out = eng.run_backtest(cls, df, strategy_params=params, lightweight=True)
    assert isinstance(out, dict)
    assert "trades" in out
    assert isinstance(out["trades"], list)


def test_htf_bucket_key_30m_intraday():
    from strategies.orb_prop_firm_killer.orb_core import _htf_bucket_key

    ny = "America/New_York"
    p30 = {"htf_tf": "30"}
    t1 = pd.Timestamp("2024-06-01 10:15").tz_localize(ny)
    t2 = pd.Timestamp("2024-06-01 10:45").tz_localize(ny)
    t_same = pd.Timestamp("2024-06-01 10:29").tz_localize(ny)
    assert _htf_bucket_key(t1, p30) == _htf_bucket_key(t_same, p30)
    assert _htf_bucket_key(t1, p30) != _htf_bucket_key(t2, p30)
    pd_ = {"htf_tf": "1D"}
    assert _htf_bucket_key(t1, pd_)[0] == "D"


def test_htf_tf_select_labels_parse_like_legacy_minutes():
    from strategies.orb_prop_firm_killer.orb_core import _parse_htf_tf, normalize_htf_tf_ui

    assert normalize_htf_tf_ui("60") == "1h"
    assert normalize_htf_tf_ui("240") == "4h"
    assert _parse_htf_tf("1h") == ("intraday", 60)
    assert _parse_htf_tf("4h") == ("intraday", 240)
    assert _parse_htf_tf("1D")[0] == "daily"
    assert _parse_htf_tf("1W")[0] == "weekly"


def test_orb_view_replay_returns_zones():
    from strategies.orb_prop_firm_killer.main import get_zones, PARAMS

    idx = pd.date_range("2024-01-03 14:30", periods=300, freq="min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": 15500.0,
            "high": 15510.0,
            "low": 15490.0,
            "close": 15505.0,
            "volume": 50.0,
        },
        index=idx.tz_localize(None),
    )
    z = get_zones(df, {**PARAMS, "use_htf": False})
    assert isinstance(z, list)
