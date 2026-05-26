"""RunRequest validation_mode: single | walk_forward | param_test | oos_split."""

from app.models.run import RunRequest


def test_run_request_param_test_ok():
    r = RunRequest(
        instrument="NQ",
        timeframe="1d",
        code="x",
        validation_mode="param_test",
        validation_config={
            "param_test": {
                "max_runs": 24,
                "param_ranges": {"atr_pct": {"enabled": True, "min": 0.1, "max": 0.5, "step": 0.1}},
            }
        },
    )
    assert r.validation_mode == "param_test"


def test_run_request_oos_split_ok():
    r = RunRequest(
        instrument="NQ",
        timeframe="1d",
        code="x",
        validation_mode="oos_split",
        validation_config={"oos_ratio": 0.25},
    )
    assert r.validation_mode == "oos_split"


def test_run_request_walk_forward_ok():
    r = RunRequest(
        instrument="NQ",
        timeframe="1d",
        code="x",
        validation_mode="walk_forward",
        validation_config={"folds": 4, "test_ratio": 0.2},
    )
    assert r.validation_mode == "walk_forward"
    assert r.validation_config == {"folds": 4, "test_ratio": 0.2}
