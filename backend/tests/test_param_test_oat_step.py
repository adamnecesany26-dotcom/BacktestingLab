"""Engine param_test: explicit step grid (one param)."""

import pandas as pd
import pytest

from app.services import engine_inprocess as ei


@pytest.fixture
def engine_mod():
    return ei._get_engine_module()


def test_param_test_step_grid_builds_five_points(engine_mod, monkeypatch):
    fake_metrics = {
        "finalEquity": 100000.0,
        "totalReturn": 0.0,
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
        assert "p" in strategy_params
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
                "p": {"enabled": True, "min": 0.1, "max": 0.5, "step": 0.1},
            },
        },
    }
    out = engine_mod._run_param_test(
        object(),
        data,
        "",
        "",
        {"p": 0.2},
        validation_cfg,
        None,
    )
    assert out["summary"]["paramTestTotalRuns"] == 5
    assert out["summary"]["paramKeysTested"] == ["p"]
    runs = out["paramTest"]["runs"]
    assert len(runs) == 5
    vals = sorted([r["paramValue"] for r in runs])
    assert vals == [0.1, 0.2, 0.3, 0.4, 0.5]
