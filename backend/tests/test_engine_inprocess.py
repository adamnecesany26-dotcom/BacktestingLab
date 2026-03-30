"""engine_inprocess: thread-local run env overlay + serial lock (no full Backtrader run)."""

import os

import pytest


@pytest.fixture(autouse=True)
def _clear_engine_mod_cache():
    import app.services.engine_inprocess as ei

    ei._engine_mod = None
    ei._engine_loaded_mtime = None
    yield
    ei._engine_mod = None
    ei._engine_loaded_mtime = None


def test_inprocess_does_not_mutate_os_environ(monkeypatch):
    import app.services.engine_inprocess as ei

    key = "_BT_INPROC_ENV_TEST_"
    os.environ[key] = "before"
    overlay_calls: list[str] = []

    class _Mod:
        @staticmethod
        def set_engine_run_environ(d):
            overlay_calls.append("set")

        @staticmethod
        def clear_engine_run_environ():
            overlay_calls.append("clear")

        @staticmethod
        def execute_backtest_from_environ():
            assert os.environ.get(key) == "before"
            raise RuntimeError("expected failure")

    monkeypatch.setattr(ei, "_get_engine_module", lambda: _Mod())

    with pytest.raises(RuntimeError, match="expected"):
        ei.run_engine_in_process({key: "during", "RUN_ID": "x"})

    assert os.environ.get(key) == "before"
    assert overlay_calls == ["set", "clear"]
    os.environ.pop(key, None)


def test_inprocess_progress_callback_set_and_cleared(monkeypatch):
    import app.services.engine_inprocess as ei

    seen: list[str] = []

    class _Mod:
        @staticmethod
        def set_engine_run_environ(_d):
            pass

        @staticmethod
        def clear_engine_run_environ():
            pass

        @staticmethod
        def set_engine_progress_callback(fn):
            seen.append("set")

        @staticmethod
        def clear_engine_progress_callback():
            seen.append("clear")

        @staticmethod
        def execute_backtest_from_environ():
            return {"ok": True}

    monkeypatch.setattr(ei, "_get_engine_module", lambda: _Mod())

    def cb(_pct: int) -> None:
        pass

    out = ei.run_engine_in_process({"RUN_ID": "t"}, progress_callback=cb)
    assert out == {"ok": True}
    assert seen == ["set", "clear"]
