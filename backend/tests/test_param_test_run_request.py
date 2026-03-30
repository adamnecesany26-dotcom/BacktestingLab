"""RunRequest accepts param_test validation mode and param_test config shape."""

from app.models.run import RunRequest


def test_run_request_param_test_validation_mode():
    r = RunRequest(
        instrument="NQ",
        timeframe="1d",
        code="x",
        validation_mode="param_test",
        validation_config={
            "param_test": {
                "max_runs": 24,
                "param_ranges": {
                    "target_rr": {"enabled": True, "min": 1.0, "max": 3.0},
                },
            }
        },
    )
    assert r.validation_mode == "param_test"
    assert isinstance(r.validation_config, dict)
    pt = r.validation_config.get("param_test")
    assert isinstance(pt, dict)
    assert pt.get("max_runs") == 24
