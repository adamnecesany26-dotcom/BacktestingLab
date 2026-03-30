"""Param test O: runner must keep sweep keys + module_params after params-tuple filtering."""

from app.services import runner as runner_mod


def test_param_test_enabled_range_keys():
    assert runner_mod._param_test_enabled_range_keys(None) == set()
    assert runner_mod._param_test_enabled_range_keys({}) == set()
    cfg = {
        "param_test": {
            "param_ranges": {
                "ema_fast": {"enabled": True, "min": 10, "max": 30},
                "module_params": {"enabled": True},
                "noise": "x",
            }
        }
    }
    assert runner_mod._param_test_enabled_range_keys(cfg) == {"ema_fast"}


def test_extract_strategy_param_names_tuple_only():
    code = '''
class S(bt.Strategy):
    params = (("ema_slow", 50),)
PARAMS = {"ema_fast": 20, "ema_slow": 50}
'''
    names = runner_mod._extract_strategy_param_names({"main.py": code}, None)
    assert names == {"ema_slow", "ema_fast"}


def test_filter_reinjects_param_test_keys_for_oat():
    """Simulate logic: after tuple-only filter, ema_fast from full request is restored for param_test."""
    strategy_params = {"ema_slow": 50, "ema_fast": 20, "module_params": {"m": {"a": 1}}}
    accepted = {"ema_slow"}
    validation_config = {
        "param_test": {
            "param_ranges": {
                "ema_fast": {"enabled": True, "min": 10, "max": 40},
            }
        }
    }

    module_blob = strategy_params.get("module_params")
    filtered = {k: v for k, v in strategy_params.items() if k in accepted}
    if module_blob is not None:
        filtered["module_params"] = module_blob
    assert "ema_fast" not in filtered

    pt_keys = runner_mod._param_test_enabled_range_keys(validation_config)
    fp = dict(filtered)
    for k in pt_keys:
        if k in strategy_params:
            fp[k] = strategy_params[k]
    assert fp.get("ema_fast") == 20
    assert "module_params" in fp
