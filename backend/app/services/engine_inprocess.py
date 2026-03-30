"""
In-process Backtrader engine (same logic as docker/engine.py) for /run fast path.

Avoids subprocess spawn + second Python interpreter when RUN_INPROCESS_ENGINE=1.

Run parameters are passed via a thread-local overlay in the engine module — we do **not**
mutate ``os.environ`` (P1-3). A global lock still serializes runs because ``sys.modules``
purge + dynamic strategy imports are not safe concurrently (P1-2 partial; true parallel
batch uses subprocess when BATCH_PARALLEL_WORKERS > 1).
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys
import threading
from pathlib import Path
from typing import Any

_ENGINE_SERIAL_LOCK = threading.Lock()
_engine_mod: Any = None
_engine_loaded_mtime: float | None = None

_MOD_NAME_RE = re.compile(r"^mod_[A-Za-z0-9_]+$")


def _engine_py_path() -> Path:
    candidate = Path(__file__).resolve().parent.parent / "docker" / "engine.py"
    if candidate.is_file():
        return candidate
    alt = Path(__file__).resolve().parent.parent.parent / "docker" / "engine.py"
    if alt.is_file():
        return alt
    return candidate


def _get_engine_module() -> Any:
    global _engine_mod, _engine_loaded_mtime
    path = _engine_py_path()
    if not path.is_file():
        raise RuntimeError(f"Engine not found: {path}")
    mtime = path.stat().st_mtime
    if _engine_mod is None or _engine_loaded_mtime is None or mtime != _engine_loaded_mtime:
        spec = importlib.util.spec_from_file_location("bt_engine_host", str(path))
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load engine spec")
        _engine_mod = importlib.util.module_from_spec(spec)
        # Backtrader resolves Strategy subclasses via sys.modules[cls.__module__]. The engine
        # file is loaded as "bt_engine_host"; without this entry, wrappers like
        # TradeRecordingStrategy raise KeyError('bt_engine_host') at runtime.
        sys.modules["bt_engine_host"] = _engine_mod
        spec.loader.exec_module(_engine_mod)
        _engine_loaded_mtime = mtime
    return _engine_mod


def _purge_strategy_related_modules() -> None:
    """Drop dynamic strategy / module entries so the next run loads fresh files."""
    for k in list(sys.modules.keys()):
        if k == "strategy_module" or k.startswith("modules.") or _MOD_NAME_RE.match(k):
            try:
                del sys.modules[k]
            except KeyError:
                pass


def run_engine_in_process(env: dict[str, str], progress_callback=None) -> dict:
    """
    Run ``execute_backtest_from_environ()`` with ``env`` applied as a thread-local overlay
    on the engine module (strings only, same keys as subprocess ``os.environ``).

    Optional ``progress_callback(pct: int)`` receives bar progress (0–99) for SSE streaming.
    """
    env_str = {str(k): "" if v is None else str(v) for k, v in env.items()}
    with _ENGINE_SERIAL_LOCK:
        _purge_strategy_related_modules()
        mod = _get_engine_module()
        mod.set_engine_run_environ(env_str)
        if progress_callback is not None:
            mod.set_engine_progress_callback(progress_callback)
        try:
            return mod.execute_backtest_from_environ()
        finally:
            if progress_callback is not None:
                mod.clear_engine_progress_callback()
            mod.clear_engine_run_environ()
