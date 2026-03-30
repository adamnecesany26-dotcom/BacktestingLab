"""Engine OAT: bootstrap strategy_params key from enabled range when missing from base."""

import pandas as pd
import pytest

from app.services import engine_inprocess as ei


@pytest.fixture
def engine_mod():
    return ei._get_engine_module()


def test_run_param_test_bootstraps_missing_base_key(engine_mod, monkeypatch):
    fake_metrics = {
        "finalEquity": 100000.0,
        "totalReturnUsd": 0.0,
        "sharpeRatio": 0.0,
        "sortinoRatio": 0.0,
        "profitFactor": 1.0,
        "profitFactorStatus": "ok",
        "tradeCount": 0,
        "maxDrawdownPct": 0.0,
        "winRate": 0.0,
    }

    def fake_run_backtest(*_a, strategy_params=None, **_k):
        assert strategy_params is not None
        assert "oat_missing" in strategy_params
        return {"metrics": fake_metrics}

    monkeypatch.setattr(engine_mod, "run_backtest", fake_run_backtest)

    data = pd.DataFrame(
        {"open": [1.0, 2.0], "close": [1.0, 2.0]},
        index=pd.DatetimeIndex(pd.date_range("2020-01-01", periods=2)),
    )
    validation_cfg = {
        "param_test": {
            "max_runs": 24,
            "param_ranges": {
                "oat_missing": {"enabled": True, "min": 1.0, "max": 5.0},
            },
        },
    }
    out = engine_mod._run_param_test(
        object(),
        data,
        "",
        "",
        {},
        validation_cfg,
        None,
    )
    assert out["summary"]["paramTestTotalRuns"] > 0
    assert "oat_missing" in out["summary"]["paramKeysTested"]
    assert len(out["paramTest"]["runs"]) > 0
