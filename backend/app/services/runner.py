"""
Strategy Runner - orchestrates host subprocess execution of the backtest engine.
Supports streaming stdout/stderr to client.
Uses subprocess.Popen (not asyncio) - Python 3.14 on Windows has NotImplementedError in asyncio subprocess.
"""

import asyncio
import datetime as dt
import json
import os
import re
import shutil
import hashlib
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator, Awaitable, Callable, Union

from app.models.run import RunResponse, BacktestMetrics, Trade, OhlcBar, EquityPoint
from app.services.data_ohlc import (
    fingerprint_dataset_file,
    polars_scan_ohlc_schema,
    resolve_safe_data_path,
)
from app.services.ohlc_timeframe import (
    infer_data_timeframe,
    iso_or_str,
    normalize_tf,
    resample_ohlcv,
    should_resample,
)

RUN_TIMEOUT = 3600  # seconds — wall-clock cap for engine subprocess (override RUN_TIMEOUT_SEC or request run_timeout_sec)
# Importing pandas/backtrader in the engine child can be silent on stdout for a long time; keep this generous.
RUN_STREAM_IDLE_TIMEOUT = 1800  # seconds — no SSE/log/progress events (override RUN_STREAM_IDLE_TIMEOUT_SEC)
RUN_TIMEOUT_MAX_SEC = 86400  # hard cap when set from API request
# Do not kill the subprocess on client-disconnect right after start (avoids flaky SSE / strict-mode races).
RUN_DISCONNECT_GRACE_SEC = 20.0
RUN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

# Per-process batch hint: how often the same on-disk dataset key repeats in batch runs.
_BATCH_DATASET_HITS: dict[str, int] = {}


def log_batch_dataset_reuse(
    data_file: str,
    instrument: str,
    timeframe: str,
    years: float,
) -> None:
    """Log fingerprint + hit count when batch items reuse the same resolved data file + slice key."""
    backend_root = Path(__file__).resolve().parent.parent.parent
    data_dir = backend_root.parent / "data"
    p = resolve_safe_data_path(data_dir, data_file or "")
    if not p:
        return
    fp = fingerprint_dataset_file(p)
    key = f"{fp}\x1f{data_file}\x1f{instrument}\x1f{timeframe}\x1f{years}"
    _BATCH_DATASET_HITS[key] = _BATCH_DATASET_HITS.get(key, 0) + 1
    n = _BATCH_DATASET_HITS[key]
    print(
        f"[runner] batch_dataset_hit={n} fingerprint={fp} instrument={instrument} data_file={data_file}",
        flush=True,
    )


def _resolve_disconnect_grace_seconds() -> float:
    raw = os.environ.get("RUN_DISCONNECT_GRACE_SEC")
    if raw is None or str(raw).strip() == "":
        return RUN_DISCONNECT_GRACE_SEC
    try:
        return max(0.0, float(raw))
    except ValueError:
        return RUN_DISCONNECT_GRACE_SEC


def _backtest_engine_script() -> Path:
    """engine.py shipped with repo (formerly run inside Docker)."""
    return Path(__file__).resolve().parent.parent.parent / "docker" / "engine.py"


def _format_engine_failure(stderr: str, returncode: int | None) -> str:
    err = (stderr or "").strip()
    if returncode == 130 or "KeyboardInterrupt" in err:
        return (
            "Běh engine byl přerušen (exit 130 / KeyboardInterrupt). "
            "To není typická chyba pandas — proces dostal signál „zastav“ (jako Ctrl+C). "
            "Nejčastěji: tlačítko Zastavit v aplikaci, zavření záložky / přerušení požadavku. "
            "Zkuste spustit znovu a nechte běh doběhnout; první start může kvůli načtení knihoven chvíli trvat. "
            "(Technický výpis: "
            + (err[:600] + ("…" if len(err) > 600 else ""))
            + ")"
        )
    if returncode == -1:
        return f"Engine (in-process) failed: {err}"
    return f"Engine subprocess failed (exit {returncode}): {err}"


def _extract_params_dict_keys(content: str) -> set[str]:
    """Top-level keys from PARAMS = { ... } (brace-balanced; typical flat strategy PARAMS)."""
    m = re.search(r"\bPARAMS\s*=\s*\{", content)
    if not m:
        return set()
    i = m.end() - 1
    depth = 0
    start = i
    for j in range(i, len(content)):
        if content[j] == "{":
            depth += 1
        elif content[j] == "}":
            depth -= 1
            if depth == 0:
                block = content[start + 1 : j]
                return set(re.findall(r'''["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*:''', block))
    return set()


def _extract_strategy_param_names(files: dict | None, code: str | None) -> set[str]:
    """Parse Strategy.params tuple from Python code to get accepted param names."""
    content = ""
    if files:
        content = files.get("main.py") or files.get("strategy.py") or (next(iter(files.values())) if files else "")
    if not content and code:
        content = code
    if not content:
        return set()
    # Match ("param_name", or ('param_name', inside params = ( ... )
    matches = re.findall(r'\(\s*["\']([a-zA-Z_][a-zA-Z0-9_]*)["\']\s*[,\)]', content)
    return set(matches) | _extract_params_dict_keys(content)


def _param_test_enabled_range_keys(validation_config: dict | None) -> set[str]:
    """OAT sweep keys — must stay in STRATEGY_PARAMS after accepted-params filtering."""
    if not validation_config or not isinstance(validation_config, dict):
        return set()
    pt = validation_config.get("param_test")
    if not isinstance(pt, dict):
        return set()
    raw = pt.get("param_ranges")
    if not isinstance(raw, dict):
        return set()
    out: set[str] = set()
    for k, rcfg in raw.items():
        if k == "module_params":
            continue
        if isinstance(rcfg, dict) and rcfg.get("enabled"):
            out.add(str(k))
    return out


def _compute_code_digest(files: dict[str, str] | None, code: str | None) -> str:
    hasher = hashlib.sha256()
    if files:
        for key in sorted(files.keys()):
            hasher.update(key.encode("utf-8", errors="ignore"))
            hasher.update(b"\x00")
            hasher.update((files.get(key) or "").encode("utf-8", errors="ignore"))
            hasher.update(b"\x00")
    elif code:
        hasher.update((code or "").encode("utf-8", errors="ignore"))
    else:
        hasher.update(b"empty")
    return hasher.hexdigest()


def _read_stream_sync(
    proc: subprocess.Popen,
    queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
    stdout_buffer: list,
    stderr_buffer: list,
) -> None:
    """Read stdout/stderr in thread, put events in queue via call_soon_threadsafe."""
    def put(ev: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ev)

    def read_stream(stream, name: str, buffer: list) -> bool:
        """Return True if should stop (result or error)."""
        try:
            for line in iter(stream.readline, b""):
                decoded = line.decode(errors="replace").rstrip()
                buffer.append(decoded)
                if name == "stderr" and decoded.startswith("PROGRESS:"):
                    try:
                        pct = int(decoded.split(":")[1].strip())
                        put({"type": "progress", "value": pct})
                    except (ValueError, IndexError):
                        put({"type": "log", "line": decoded, "stream": name})
                elif name == "stdout" and decoded.strip():
                    try:
                        data = json.loads(decoded)
                        if "equity" in data:
                            put({"type": "result", "data": data})
                            return True
                        if "error" in data:
                            msg = data.get("error") or decoded or "Engine error"
                            put({"type": "error", "message": str(msg)})
                            return True
                    except json.JSONDecodeError:
                        pass
                    put({"type": "log", "line": decoded, "stream": name})
                elif name == "stderr" and decoded.strip():
                    try:
                        data = json.loads(decoded)
                        if "error" in data:
                            msg = data.get("error") or decoded or "Engine error"
                            put({"type": "error", "message": str(msg)})
                            return True
                    except json.JSONDecodeError:
                        pass
                    put({"type": "log", "line": decoded, "stream": name})
                elif decoded.strip():
                    put({"type": "log", "line": decoded, "stream": name})
        except Exception:
            pass
        return False

    def run():
        t1 = threading.Thread(target=lambda: read_stream(proc.stdout, "stdout", stdout_buffer))
        t2 = threading.Thread(target=lambda: read_stream(proc.stderr, "stderr", stderr_buffer))
        t1.daemon = True
        t2.daemon = True
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        put({"type": "done"})
        put({"type": "done"})

    threading.Thread(target=run, daemon=True).start()


def _to_module_name(name: str) -> str:
    """Convert module display name to Python module name (e.g. 'Swing HL' -> 'Swing_HL')."""
    return (name or "module").replace(" ", "_").replace("-", "_").replace(".", "_") or "module"


def _merge_strategy_params(
    strategy_params: dict | None,
    instrument_type: str,
    share_size: int | None,
    lot_size: float | None,
    pip_size: float | None,
    pip_value: float | None,
) -> dict:
    """Merge backtest params (share_size, lot_size, etc.) into strategy params for use in strategy."""
    merged = dict(strategy_params or {})
    if instrument_type == "stocks" and share_size is not None:
        merged["share_size"] = share_size
    if instrument_type == "forex":
        if lot_size is not None:
            merged["lot_size"] = lot_size
        if pip_size is not None:
            merged["pip_size"] = pip_size
        if pip_value is not None:
            merged["pip_value"] = pip_value
    return merged


def _resolve_run_timeout_seconds(request_override: int | None = None) -> int:
    """
    Wall-clock timeout for the backtest engine subprocess.
    - Request `run_timeout_sec` (if provided) wins over env/default.
    - RUN_TIMEOUT_SEC env overrides default when request omits value.
    - Value <= 0: disabled (no wall timeout).
    """
    if request_override is not None:
        try:
            o = int(request_override)
        except (TypeError, ValueError):
            o = None
        if o is not None:
            if o <= 0:
                return 0
            return min(o, RUN_TIMEOUT_MAX_SEC)
    raw = os.environ.get("RUN_TIMEOUT_SEC")
    if raw is None or str(raw).strip() == "":
        return RUN_TIMEOUT
    try:
        parsed = int(float(raw))
    except ValueError:
        return RUN_TIMEOUT
    return parsed


def _use_inprocess_engine() -> bool:
    raw = os.environ.get("RUN_INPROCESS_ENGINE", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return True


def _inprocess_engine_allowed_for_digest(code_digest: str) -> bool:
    """If INPROCESS_ENGINE_DIGESTS is set, code_digest must be listed (hex, case-insensitive)."""
    raw = os.environ.get("INPROCESS_ENGINE_DIGESTS", "").strip()
    if not raw:
        return True
    allowed = {x.strip().lower() for x in raw.split(",") if x.strip()}
    return (code_digest or "").strip().lower() in allowed


def _inprocess_during_stream_env() -> bool:
    """In-process engine during SSE streaming (default ON for single-user). Set =0 to force subprocess."""
    raw = os.environ.get("RUN_INPROCESS_DURING_STREAM", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return True


def _may_use_inprocess_engine(
    code_digest: str,
    *,
    disallow_inprocess_engine: bool,
    sse_stream: bool,
) -> bool:
    if not _use_inprocess_engine() or not _inprocess_engine_allowed_for_digest(code_digest):
        return False
    if not disallow_inprocess_engine:
        return True
    if sse_stream and _inprocess_during_stream_env():
        return True
    return False


def _resolve_stream_idle_timeout_seconds(request_override: int | None = None) -> int:
    """Max seconds without any stream event while engine still running → treat as stall."""
    if request_override is not None:
        try:
            o = int(request_override)
        except (TypeError, ValueError):
            o = None
        if o is not None:
            if o <= 0:
                return 0
            return min(o, RUN_TIMEOUT_MAX_SEC)
    raw = os.environ.get("RUN_STREAM_IDLE_TIMEOUT_SEC")
    if raw is None or str(raw).strip() == "":
        return RUN_STREAM_IDLE_TIMEOUT
    try:
        parsed = int(float(raw))
    except ValueError:
        return RUN_STREAM_IDLE_TIMEOUT
    return max(0, parsed)


def _resolve_safe_run_dir(run_root: Path, run_id: str | None) -> tuple[str, Path]:
    """Build run_dir from run_id and keep it constrained under run_root."""
    resolved_run_id = (run_id or "").strip() or f"run_{dt.datetime.utcnow().strftime('%Y%m%dT%H%M%S')}_{uuid.uuid4().hex[:10]}"
    if not RUN_ID_RE.fullmatch(resolved_run_id):
        raise ValueError("Invalid run_id format. Use only letters, numbers, '_' and '-' (max 80 chars).")
    run_root_resolved = run_root.resolve()
    run_dir = (run_root_resolved / resolved_run_id).resolve()
    if run_root_resolved != run_dir and run_root_resolved not in run_dir.parents:
        raise ValueError("Unsafe run_id path.")
    return resolved_run_id, run_dir


def _normalize_result_payload(
    result_data: dict | None,
    *,
    run_id: str,
    instrument: str,
    timeframe: str,
    years: float,
    data_file: str,
    instrument_type: str,
    initial_capital: float,
    slippage_perc: float,
    commission_perc: float,
    validation_mode: str,
    sweep_mode: str | None,
    execution_model: dict | None,
    experiment: dict | None,
    runner_duration_ms: int,
    runner_host_prepare_ms: int | None = None,
    runner_engine_wall_ms: int | None = None,
    host_dataset_fingerprint: str | None = None,
    host_dataset_parquet_column_count: int | None = None,
    runner_engine_notes: list[str] | None = None,
) -> dict:
    normalized = dict(result_data or {})
    normalized.setdefault("equity", [])
    normalized.setdefault("trades", [])
    normalized.setdefault("ohlc", [])
    normalized.setdefault("moduleOutputs", None)
    normalized.setdefault("validation", None)
    normalized.setdefault("robustness", None)
    normalized.setdefault("monteCarlo", None)
    normalized.setdefault("regimeAnalysis", None)
    normalized.setdefault("portfolio", None)
    normalized.setdefault("executionSummary", None)
    normalized.setdefault("qualityGate", None)
    normalized.setdefault("experiment", None)
    normalized.setdefault("batchSummary", None)

    normalized["runId"] = run_id
    normalized.setdefault("manifest", {})
    if not isinstance(normalized["manifest"], dict):
        normalized["manifest"] = {}
    normalized["manifest"].update({
        "runId": run_id,
        "instrument": instrument,
        "timeframe": timeframe,
        "years": years,
        "dataFile": data_file,
        "instrumentType": instrument_type,
        "initialCapital": initial_capital,
        "slippagePerc": slippage_perc,
        "commissionPerc": commission_perc,
        "validationMode": validation_mode,
        "sweepMode": sweep_mode,
        "executionModel": execution_model or {},
        "experiment": experiment or {},
        "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        "runnerDurationMs": runner_duration_ms,
        "engine": "host-worker",
    })
    if runner_host_prepare_ms is not None:
        normalized["manifest"]["runnerHostPrepareMs"] = runner_host_prepare_ms
    if runner_engine_wall_ms is not None:
        normalized["manifest"]["runnerEngineWallMs"] = runner_engine_wall_ms
    if host_dataset_fingerprint:
        normalized["manifest"]["hostDatasetFingerprint"] = host_dataset_fingerprint
    if host_dataset_parquet_column_count is not None:
        normalized["manifest"]["hostDatasetParquetColumnCount"] = host_dataset_parquet_column_count
    if runner_engine_notes:
        normalized["manifest"]["runnerEngineNotes"] = list(runner_engine_notes)
    normalized["manifest"].pop("imageDigest", None)
    perf = normalized.get("perf")
    if isinstance(perf, dict):
        if runner_host_prepare_ms is not None:
            perf["runnerHostPrepareMs"] = runner_host_prepare_ms
        if runner_engine_wall_ms is not None:
            perf["runnerEngineWallMs"] = runner_engine_wall_ms
        if host_dataset_fingerprint:
            perf["hostDatasetFingerprint"] = host_dataset_fingerprint
        if host_dataset_parquet_column_count is not None:
            perf["hostDatasetParquetColumnCount"] = host_dataset_parquet_column_count
    elif runner_host_prepare_ms is not None or runner_engine_wall_ms is not None or host_dataset_fingerprint:
        normalized["perf"] = {
            k: v
            for k, v in (
                ("runnerHostPrepareMs", runner_host_prepare_ms),
                ("runnerEngineWallMs", runner_engine_wall_ms),
                ("hostDatasetFingerprint", host_dataset_fingerprint),
                ("hostDatasetParquetColumnCount", host_dataset_parquet_column_count),
            )
            if v is not None
        }
    return normalized


def _safe_join_run_path(run_dir: Path, file_path: str) -> Path:
    """Join and validate user file path to prevent traversal outside run_dir."""
    normalized = file_path.replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise ValueError(f"Unsafe file path: {file_path}")
    target = (run_dir / normalized).resolve()
    run_root = run_dir.resolve()
    if run_root != target and run_root not in target.parents:
        raise ValueError(f"Unsafe file path: {file_path}")
    return target


def _prepare_strategy_files(run_dir: Path, code: str | None, files: dict[str, str] | None) -> str:
    """
    Write strategy files to run_dir. Returns the entry point filename (main.py or strategy.py).
    Always creates indicators/ and modules/ with __init__.py so "from modules.X" / "from indicators.X"
    can resolve the package (avoids "No module named 'modules'" when user forgets to select module).
    """
    if files and len(files) > 0:
        for subdir in ("indicators", "modules"):
            pkg_dir = run_dir / subdir
            pkg_dir.mkdir(parents=True, exist_ok=True)
            (pkg_dir / "__init__.py").write_text("", encoding="utf-8")
        for file_path, content in files.items():
            full_path = _safe_join_run_path(run_dir, file_path)
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
        if "main.py" in files:
            return "main.py"
        return next(iter(files.keys()))
    if code:
        (run_dir / "strategy.py").write_text(code, encoding="utf-8")
        return "strategy.py"
    raise ValueError("Either code or files must be provided")


def _run_module_outputs(
    run_dir: Path,
    ohlc: list[dict],
    applied_modules: list[dict] | None,
) -> dict[str, dict]:
    """
    Run detect/get_line for each applied module. Returns { module_name: { markers, lines } }.
    """
    if not applied_modules or not ohlc:
        return {}

    import inspect
    import importlib.util
    import sys

    import pandas as pd

    df = pd.DataFrame(ohlc)
    if "date" in df.columns:
        df["datetime"] = pd.to_datetime(df["date"])
        df = df.set_index("datetime")
    elif not df.empty and not hasattr(df.index, "dtype"):
        pass
    elif not df.empty and str(getattr(df.index.dtype, "name", "")) != "datetime64[ns]":
        try:
            df.index = pd.to_datetime(df.index)
        except Exception:
            pass

    for c in ["open", "high", "low", "close"]:
        if c not in df.columns and c.capitalize() in df.columns:
            df[c] = df[c.capitalize()]

    outputs: dict[str, dict] = {}
    modules_dir = run_dir / "modules"
    if not modules_dir.exists():
        return outputs

    run_dir_s = str(run_dir)
    path_inserted = False
    try:
        sys.path.insert(0, run_dir_s)
        path_inserted = True
        for mod in applied_modules:
            name = mod.get("name") or ""
            params = dict(mod.get("params") or {})
            mod_name = _to_module_name(name)
            mod_path = modules_dir / f"{mod_name}.py"
            if not mod_path.exists():
                continue
            try:
                spec = importlib.util.spec_from_file_location(
                    f"mod_{mod_name}", mod_path
                )
                mod_obj = importlib.util.module_from_spec(spec)
                sys.modules[spec.name] = mod_obj
                spec.loader.exec_module(mod_obj)
    
                inferred_source = infer_data_timeframe(df)
                if inferred_source:
                    params.setdefault("data_timeframe", inferred_source)
                    params.setdefault("work_timeframe", inferred_source)
                module_df = df
                module_tf = normalize_tf(params.get("timeframe"))
                if should_resample(inferred_source, module_tf):
                    module_df = resample_ohlcv(df, module_tf)
    
                markers = []
                lines = []
                zones = []
    
                if hasattr(mod_obj, "detect"):
                    try:
                        sig = inspect.signature(mod_obj.detect)
                        result = mod_obj.detect(module_df, params) if len(sig.parameters) >= 2 else mod_obj.detect(module_df)
                    except (ValueError, TypeError):
                        result = mod_obj.detect(module_df)
                    if isinstance(result, list):
                        for item in result:
                            if isinstance(item, dict) and "date" in item and "type" in item and "value" in item:
                                markers.append({
                                    "date": iso_or_str(item["date"]),
                                    "type": str(item["type"]).lower(),
                                    "value": float(item["value"]),
                                })
    
                if hasattr(mod_obj, "get_line"):
                    try:
                        sig = inspect.signature(mod_obj.get_line)
                        result = mod_obj.get_line(module_df, params) if len(sig.parameters) >= 2 else mod_obj.get_line(module_df)
                    except (ValueError, TypeError):
                        result = mod_obj.get_line(module_df)
                    if isinstance(result, dict):
                        for line_name, data in result.items():
                            pts = []
                            color = None
                            segments = None
                            if isinstance(data, list):
                                pts = [
                                    {"date": iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                                    for p in data if isinstance(p, dict)
                                ]
                            elif isinstance(data, dict) and "data" in data:
                                pts = [
                                    {"date": iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                                    for p in data["data"] if isinstance(p, dict)
                                ]
                                color = data.get("color")
                                segments = data.get("segments")
                            if pts:
                                if segments:
                                    for seg in segments:
                                        if isinstance(seg, dict) and "from" in seg and "to" in seg and "color" in seg:
                                            i0, i1 = int(seg["from"]), int(seg["to"]) + 1
                                            seg_pts = pts[i0:i1]
                                            if seg_pts:
                                                lines.append({"name": str(line_name), "data": seg_pts, "color": str(seg["color"])})
                                else:
                                    line_obj = {"name": str(line_name), "data": pts}
                                    if color:
                                        line_obj["color"] = str(color)
                                    lines.append(line_obj)
                    elif isinstance(result, list):
                        pts = [
                            {"date": iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                            for p in result if isinstance(p, dict)
                        ]
                        if pts:
                            lines.append({"name": "line", "data": pts})
    
                if hasattr(mod_obj, "get_zones"):
                    try:
                        sig = inspect.signature(mod_obj.get_zones)
                        result = mod_obj.get_zones(module_df, params) if len(sig.parameters) >= 2 else mod_obj.get_zones(module_df)
                    except (ValueError, TypeError):
                        result = mod_obj.get_zones(module_df)
                    if isinstance(result, list):
                        for item in result:
                            if (
                                isinstance(item, dict)
                                and "date_start" in item
                                and "date_end" in item
                                and "value_low" in item
                                and "value_high" in item
                            ):
                                zone = {
                                    "date_start": iso_or_str(item["date_start"]),
                                    "date_end": iso_or_str(item["date_end"]),
                                    "value_low": float(item["value_low"]),
                                    "value_high": float(item["value_high"]),
                                    "fillcolor": str(item["fillcolor"]) if item.get("fillcolor") else None,
                                    "name": str(item["name"]) if item.get("name") else None,
                                }
                                if "base_length" in item:
                                    zone["base_length"] = int(item["base_length"])
                                if "impulse_score" in item:
                                    zone["impulse_score"] = int(item["impulse_score"])
                                if "has_touch" in item:
                                    zone["has_touch"] = bool(item["has_touch"])
                                if "touch_bar_index" in item:
                                    zone["touch_bar_index"] = int(item["touch_bar_index"])
                                if "touch_marker_price" in item:
                                    zone["touch_marker_price"] = float(item["touch_marker_price"])
                                if "has_gap" in item:
                                    zone["has_gap"] = bool(item["has_gap"])
                                if "gap_type" in item:
                                    zone["gap_type"] = str(item["gap_type"])
                                if "gap_date" in item:
                                    zone["gap_date"] = iso_or_str(item["gap_date"])
                                if "gap_value_low" in item:
                                    zone["gap_value_low"] = float(item["gap_value_low"])
                                if "gap_value_high" in item:
                                    zone["gap_value_high"] = float(item["gap_value_high"])
                                if "inducements" in item and isinstance(item["inducements"], list):
                                    zone["inducements"] = [
                                        {
                                            "date": iso_or_str(x.get("date", "")),
                                            "value": float(x.get("value", 0)),
                                            "type": str(x.get("type", "")),
                                        }
                                        for x in item["inducements"] if isinstance(x, dict)
                                    ]
                                if "inducement_count" in item:
                                    zone["inducement_count"] = int(item["inducement_count"])
                                if "inducement_points" in item:
                                    zone["inducement_points"] = int(item["inducement_points"])
                                if "active_demand_zones_below" in item:
                                    zone["active_demand_zones_below"] = int(item["active_demand_zones_below"])
                                zones.append(zone)
    
                outputs[name] = {"markers": markers, "lines": lines, "zones": zones}
            except Exception as e:
                print(f"[runner] Module {name} output error: {e}", flush=True)
            finally:
                if f"mod_{mod_name}" in sys.modules:
                    del sys.modules[f"mod_{mod_name}"]
    finally:
        if path_inserted and run_dir_s in sys.path:
            sys.path.remove(run_dir_s)
    return outputs


async def run_strategy_streaming(
    code: str | None = None,
    files: dict[str, str] | None = None,
    instrument: str = "",
    timeframe: str = "",
    years: float = 1.0,
    data_file: str = "",
    initial_capital: float = 100000.0,
    slippage_perc: float = 0.001,
    commission_perc: float = 0.0,
    instrument_type: str = "futures",
    tick_size: float | None = None,
    value_per_tick: float | None = None,
    share_size: int | None = None,
    lot_size: float | None = None,
    pip_size: float | None = None,
    pip_value: float | None = None,
    strategy_params: dict | None = None,
    applied_modules: list | None = None,
    run_id: str | None = None,
    validation_mode: str = "single",
    validation_config: dict | None = None,
    quality_gates: dict | None = None,
    sweep_mode: str | None = None,
    sweep_config: dict | None = None,
    monte_carlo: dict | None = None,
    regime_config: dict | None = None,
    portfolio_config: dict | None = None,
    execution_model: dict | None = None,
    experiment: dict | None = None,
    actor_id: str = "unknown",
    is_client_connected: Callable[[], Union[bool, Awaitable[bool]]] = lambda: True,
    run_timeout_sec: int | None = None,
    stream_idle_timeout_sec: int | None = None,
    disallow_inprocess_engine: bool = False,
    sse_stream: bool = False,
) -> AsyncGenerator[dict, None]:
    """
    Execute strategy in a host Python subprocess (backtest engine), yield events for streaming.
    Yields: {"type": "log", "line": "..."} | {"type": "progress", "value": 0-100} | {"type": "result", "data": {...}} | {"type": "error", "message": "..."}
    """
    backend_root = Path(__file__).resolve().parent.parent.parent
    project_root = backend_root.parent
    data_dir = project_root / "data"
    cache_dir = project_root / ".backtest_cache"
    run_root = project_root / ".backtest_run"
    run_root.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    resolved_run_id, run_dir = _resolve_safe_run_dir(run_root, run_id)
    run_dir.mkdir(parents=True, exist_ok=True)

    prep_started = time.perf_counter()
    entry_file = _prepare_strategy_files(run_dir, code, files)

    # Filter params to only those the strategy accepts (avoids "unexpected keyword argument").
    # Keep module_params and param_test sweep keys even if missing from params-tuple regex
    # (PARAMS dict keys may not appear as ("name", default) in source).
    accepted_params = _extract_strategy_param_names(files, code)
    if accepted_params and strategy_params:
        module_blob = strategy_params.get("module_params")
        filtered_params = {k: v for k, v in strategy_params.items() if k in accepted_params}
        if module_blob is not None:
            filtered_params["module_params"] = module_blob
    else:
        filtered_params = dict(strategy_params) if strategy_params else None

    if validation_mode == "param_test" and strategy_params:
        pt_keys = _param_test_enabled_range_keys(validation_config)
        if pt_keys:
            fp = dict(filtered_params or {})
            for k in pt_keys:
                if k in strategy_params:
                    fp[k] = strategy_params[k]
            filtered_params = fp

    try:
        if not data_dir.exists():
            data_dir.mkdir(parents=True, exist_ok=True)

        run_path = str(run_dir.absolute()).replace("\\", "/")
        data_path = str(data_dir.absolute()).replace("\\", "/")
        cache_path = str(cache_dir.absolute()).replace("\\", "/")
        print(f"[runner] run_dir={run_path} data_dir={data_path} run_id={resolved_run_id}", flush=True)
        applied_modules_payload = [
            {
                "id": str(getattr(m, "id", "") if not isinstance(m, dict) else m.get("id", "")),
                "name": str(getattr(m, "name", "") if not isinstance(m, dict) else m.get("name", "")),
                "params": (getattr(m, "params", None) if not isinstance(m, dict) else m.get("params")) or {},
            }
            for m in (applied_modules or [])
        ]
        analysis_payload = {
            "validation_mode": validation_mode,
            "validation_config": validation_config or {},
            "quality_gates": quality_gates or {},
            "sweep_mode": sweep_mode,
            "sweep_config": sweep_config or {},
            "monte_carlo": monte_carlo or {},
            "regime_config": regime_config or {},
            "portfolio_config": portfolio_config or {},
            "execution_model": execution_model or {},
            "experiment": experiment or {},
        }
        seed = None
        try:
            if isinstance(experiment, dict) and experiment.get("seed") is not None:
                seed = int(experiment.get("seed"))
        except Exception:
            seed = None
        if seed is None:
            seed = int(uuid.uuid4().int % 1_000_000_000)
        code_digest = _compute_code_digest(files, code)
        engine_script = _backtest_engine_script()
        if not engine_script.is_file():
            raise RuntimeError(f"Backtest engine not found: {engine_script}")

        strategy_path_abs = str((Path(run_path) / entry_file).resolve())
        env = os.environ.copy()
        _backend_root = Path(__file__).resolve().parent.parent.parent
        _project_root = str(_backend_root.parent.resolve())
        _backend_root_s = str(_backend_root.resolve())
        _existing_pp = env.get("PYTHONPATH", "").strip()
        _roots = f"{_project_root}{os.pathsep}{_backend_root_s}"
        env["PYTHONPATH"] = f"{_roots}{os.pathsep}{_existing_pp}" if _existing_pp else _roots
        env["STRATEGY_PATH"] = strategy_path_abs
        env["DATA_PATH"] = str(Path(data_path).resolve())
        env["DATA_CACHE_PATH"] = str(Path(cache_path).resolve())
        env["INSTRUMENT"] = str(instrument)
        env["TIMEFRAME"] = str(timeframe)
        env["YEARS"] = str(years)
        env["DATA_FILE"] = str(data_file)
        env["INITIAL_CAPITAL"] = str(initial_capital)
        env["SLIPPAGE_PERC"] = str(slippage_perc)
        env["COMMISSION_PERC"] = str(commission_perc)
        env["INSTRUMENT_TYPE"] = str(instrument_type)
        env["TICK_SIZE"] = str(tick_size if tick_size is not None else "")
        env["VALUE_PER_TICK"] = str(value_per_tick if value_per_tick is not None else "")
        env["SHARE_SIZE"] = str(share_size if share_size is not None else "")
        env["LOT_SIZE"] = str(lot_size if lot_size is not None else "")
        env["PIP_SIZE"] = str(pip_size if pip_size is not None else "")
        env["PIP_VALUE"] = str(pip_value if pip_value is not None else "")
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["RUN_ID"] = str(resolved_run_id)
        env["STRATEGY_PARAMS"] = json.dumps(
            _merge_strategy_params(filtered_params, instrument_type, share_size, lot_size, pip_size, pip_value)
        )
        env["APPLIED_MODULES"] = json.dumps(applied_modules_payload)
        env["ANALYSIS_CONFIG"] = json.dumps(analysis_payload)
        env["EXECUTION_MODEL_JSON"] = json.dumps(execution_model or {})
        env["ACTOR_ID"] = str(actor_id)
        env["RUN_SEED"] = str(seed)
        env["CODE_DIGEST"] = str(code_digest)
        env["ENGINE_IMAGE_DIGEST"] = ""

        ds_path = resolve_safe_data_path(data_dir, data_file or "")
        host_ds_fp = fingerprint_dataset_file(ds_path) if ds_path else None
        pq_cols: int | None = None
        if ds_path and ds_path.suffix.lower() in (".parquet", ".pq"):
            sch = polars_scan_ohlc_schema(ds_path)
            pq_cols = len(sch) if sch else None
        if host_ds_fp:
            print(f"[runner] host_dataset_fingerprint={host_ds_fp} data_file={data_file}", flush=True)
        env["HOST_DATASET_FINGERPRINT"] = host_ds_fp or ""
        t_before_popen = time.perf_counter()
        runner_host_prepare_ms = int((t_before_popen - prep_started) * 1000)

        env_str = {str(k): "" if v is None else str(v) for k, v in env.items()}

        may_in = _may_use_inprocess_engine(
            code_digest,
            disallow_inprocess_engine=disallow_inprocess_engine,
            sse_stream=sse_stream,
        )
        runner_engine_notes: list[str] = []
        wants_in = _use_inprocess_engine() and _inprocess_engine_allowed_for_digest(code_digest)
        if wants_in and not may_in:
            if disallow_inprocess_engine and sse_stream and not _inprocess_during_stream_env():
                runner_engine_notes.append("inProcessSkipped:sseDefault")
            elif disallow_inprocess_engine and not sse_stream:
                runner_engine_notes.append("inProcessSkipped:parallelBatch")

        notes_for_normalize = runner_engine_notes if runner_engine_notes else None

        if may_in:
            from app.services.engine_inprocess import run_engine_in_process

            print("[runner] in-process engine (RUN_INPROCESS_ENGINE=1)", flush=True)
            proc_started = time.perf_counter()
            loop = asyncio.get_running_loop()
            progress_queue: asyncio.Queue = asyncio.Queue()

            def _inprocess_progress_cb(pct: int) -> None:
                try:
                    loop.call_soon_threadsafe(progress_queue.put_nowait, int(pct))
                except Exception:
                    pass

            engine_task = asyncio.create_task(
                asyncio.to_thread(run_engine_in_process, env_str, _inprocess_progress_cb)
            )
            yield {"type": "progress", "value": 5}
            try:
                while not engine_task.done():
                    get_task = asyncio.create_task(progress_queue.get())
                    done, _pending = await asyncio.wait(
                        {engine_task, get_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if get_task in done:
                        try:
                            pct = get_task.result()
                            yield {"type": "progress", "value": int(pct)}
                        except Exception:
                            pass
                    else:
                        get_task.cancel()
                        try:
                            await get_task
                        except asyncio.CancelledError:
                            pass
                while True:
                    try:
                        pct = progress_queue.get_nowait()
                        yield {"type": "progress", "value": int(pct)}
                    except asyncio.QueueEmpty:
                        break
                raw_out = await engine_task
            except Exception as e:
                if not engine_task.done():
                    engine_task.cancel()
                    try:
                        await engine_task
                    except (asyncio.CancelledError, Exception):
                        pass
                err = str(e) or type(e).__name__
                yield {"type": "error", "message": _format_engine_failure(err, -1)}
                return
            captured_engine_wall_ms = int((time.perf_counter() - proc_started) * 1000)
            if not isinstance(raw_out, dict):
                yield {"type": "error", "message": "In-process engine returned invalid payload"}
                return
            result_data = _normalize_result_payload(
                raw_out,
                run_id=resolved_run_id,
                instrument=instrument,
                timeframe=timeframe,
                years=years,
                data_file=data_file,
                instrument_type=instrument_type,
                initial_capital=initial_capital,
                slippage_perc=slippage_perc,
                commission_perc=commission_perc,
                validation_mode=validation_mode,
                sweep_mode=sweep_mode,
                execution_model=execution_model,
                experiment=experiment,
                runner_duration_ms=int((time.perf_counter() - prep_started) * 1000),
                runner_host_prepare_ms=runner_host_prepare_ms,
                runner_engine_wall_ms=captured_engine_wall_ms,
                host_dataset_fingerprint=host_ds_fp,
                host_dataset_parquet_column_count=pq_cols,
                runner_engine_notes=notes_for_normalize,
            )
            if isinstance(result_data.get("manifest"), dict):
                result_data["manifest"]["engineExecutionMode"] = "inprocess"
            yield {"type": "result", "data": result_data}
            print(f"[runner] engine_wall_ms={captured_engine_wall_ms}", flush=True)
            return

        cmd = [sys.executable, str(engine_script)]
        print(f"[runner] host engine: {cmd[0]} {cmd[1]}", flush=True)

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            env=env,
        )
        proc_started = time.perf_counter()
        disconnect_grace_sec = _resolve_disconnect_grace_seconds()

        queue: asyncio.Queue = asyncio.Queue()
        stdout_buffer: list[str] = []
        stderr_buffer: list[str] = []
        loop = asyncio.get_event_loop()
        _read_stream_sync(proc, queue, loop, stdout_buffer, stderr_buffer)
        yield {"type": "progress", "value": 5}
        wall_timeout = _resolve_run_timeout_seconds(run_timeout_sec)
        idle_timeout = _resolve_stream_idle_timeout_seconds(stream_idle_timeout_sec)

        timeout_triggered = False
        stream_stall_triggered = False
        stream_stall_message = ""

        async def kill_after_timeout():
            nonlocal timeout_triggered
            await asyncio.sleep(float(wall_timeout))
            if proc.poll() is None:
                timeout_triggered = True
                proc.kill()

        timeout_task = asyncio.create_task(kill_after_timeout()) if wall_timeout > 0 else None

        done_count = 0
        result_data = None
        error_msg = None
        last_queue_event_at = time.perf_counter()
        proc_exit_observed_at: float | None = None
        captured_engine_wall_ms: int | None = None

        while done_count < 2:
            conn = is_client_connected()
            if asyncio.iscoroutine(conn):
                conn = await conn
            if not conn:
                # Avoid killing during cold import if the HTTP client briefly reports disconnected.
                if time.perf_counter() - proc_started < disconnect_grace_sec:
                    await asyncio.sleep(0.5)
                    continue
                proc.kill()
                break
            try:
                ev = await asyncio.wait_for(queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                now = time.perf_counter()
                if proc.poll() is not None:
                    if proc_exit_observed_at is None:
                        proc_exit_observed_at = now
                    elif now - proc_exit_observed_at >= 2.0:
                        break
                if (
                    idle_timeout > 0
                    and proc.poll() is None
                    and (now - last_queue_event_at) >= idle_timeout
                    and not result_data
                    and not error_msg
                ):
                    stream_stall_triggered = True
                    stream_stall_message = f"Run stream stalled for {idle_timeout} seconds."
                    proc.kill()
                    break
                continue
            last_queue_event_at = time.perf_counter()
            if ev.get("type") == "done":
                done_count += 1
                continue
            if ev.get("type") == "result":
                result_data = ev.get("data")
                if result_data:
                    captured_engine_wall_ms = int((time.perf_counter() - proc_started) * 1000)
                    result_data = _normalize_result_payload(
                        result_data,
                        run_id=resolved_run_id,
                        instrument=instrument,
                        timeframe=timeframe,
                        years=years,
                        data_file=data_file,
                        instrument_type=instrument_type,
                        initial_capital=initial_capital,
                        slippage_perc=slippage_perc,
                        commission_perc=commission_perc,
                        validation_mode=validation_mode,
                        sweep_mode=sweep_mode,
                        execution_model=execution_model,
                        experiment=experiment,
                        runner_duration_ms=int((time.perf_counter() - prep_started) * 1000),
                        runner_host_prepare_ms=runner_host_prepare_ms,
                        runner_engine_wall_ms=captured_engine_wall_ms,
                        host_dataset_fingerprint=host_ds_fp,
                        host_dataset_parquet_column_count=pq_cols,
                        runner_engine_notes=notes_for_normalize,
                    )
                    ev = {"type": "result", "data": result_data}
            if ev.get("type") == "error":
                error_msg = ev.get("message")
                preview = (error_msg or "")[:800]
                print(f"[runner] ERROR from engine:\n{preview}", flush=True)
                debug_path = run_dir / "last_error_strategy.py"
                err_content = (code or "")[:5000] if code else str(files or {})[:5000]
                debug_path.write_text(err_content, encoding="utf-8")
                print(f"[runner] Strategy saved to {debug_path} for debug", flush=True)
            yield ev
            if ev.get("type") in ("result", "error"):
                proc.kill()
                break

        if timeout_task is not None:
            try:
                timeout_task.cancel()
            except asyncio.CancelledError:
                pass

        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

        if timeout_triggered and not result_data:
            timeout_msg = f"Run timed out after {wall_timeout} seconds."
            yield {"type": "error", "message": timeout_msg}
        elif stream_stall_triggered and not result_data and not error_msg:
            yield {"type": "error", "message": stream_stall_message}
        elif not result_data and not error_msg and proc.returncode != 0:
            err = "\n".join(stderr_buffer) or "Unknown error"
            msg = _format_engine_failure(err, proc.returncode)
            print(f"[runner] ENGINE FAILED:\n{msg[:1500]}", flush=True)
            (run_dir / "last_error_strategy.py").write_text(
                (code or "")[:5000] if code else str(files or {})[:5000], encoding="utf-8"
            )
            yield {"type": "error", "message": msg}
        elif result_data and captured_engine_wall_ms is not None:
            print(f"[runner] engine_wall_ms={captured_engine_wall_ms}", flush=True)
    finally:
        try:
            shutil.rmtree(run_dir, ignore_errors=True)
        except Exception:
            pass


async def run_strategy(
    code: str | None = None,
    files: dict[str, str] | None = None,
    instrument: str = "",
    timeframe: str = "",
    years: float = 1.0,
    data_file: str = "",
    initial_capital: float = 100000.0,
    slippage_perc: float = 0.001,
    commission_perc: float = 0.0,
    instrument_type: str = "futures",
    tick_size: float | None = None,
    value_per_tick: float | None = None,
    share_size: int | None = None,
    lot_size: float | None = None,
    pip_size: float | None = None,
    pip_value: float | None = None,
    strategy_params: dict | None = None,
    applied_modules: list | None = None,
    run_id: str | None = None,
    validation_mode: str = "single",
    validation_config: dict | None = None,
    quality_gates: dict | None = None,
    sweep_mode: str | None = None,
    sweep_config: dict | None = None,
    monte_carlo: dict | None = None,
    regime_config: dict | None = None,
    portfolio_config: dict | None = None,
    execution_model: dict | None = None,
    experiment: dict | None = None,
    actor_id: str = "unknown",
    run_timeout_sec: int | None = None,
    stream_idle_timeout_sec: int | None = None,
    disallow_inprocess_engine: bool = False,
    sse_stream: bool = False,
) -> RunResponse:
    """Non-streaming version - for backward compatibility."""
    result_data = None
    async for ev in run_strategy_streaming(
        code=code,
        files=files,
        instrument=instrument,
        timeframe=timeframe,
        years=years,
        data_file=data_file,
        initial_capital=initial_capital,
        slippage_perc=slippage_perc,
        commission_perc=commission_perc,
        instrument_type=instrument_type,
        tick_size=tick_size,
        value_per_tick=value_per_tick,
        share_size=share_size,
        lot_size=lot_size,
        pip_size=pip_size,
        pip_value=pip_value,
        strategy_params=strategy_params,
        applied_modules=applied_modules,
        run_id=run_id,
        validation_mode=validation_mode,
        validation_config=validation_config,
        quality_gates=quality_gates,
        sweep_mode=sweep_mode,
        sweep_config=sweep_config,
        monte_carlo=monte_carlo,
        regime_config=regime_config,
        portfolio_config=portfolio_config,
        execution_model=execution_model,
        experiment=experiment,
        actor_id=actor_id,
        run_timeout_sec=run_timeout_sec,
        stream_idle_timeout_sec=stream_idle_timeout_sec,
        disallow_inprocess_engine=disallow_inprocess_engine,
        sse_stream=sse_stream,
    ):
        if ev.get("type") == "result":
            result_data = ev.get("data")
            break
        if ev.get("type") == "error":
            raise RuntimeError(ev.get("message", "Unknown error"))

    if not result_data:
        raise RuntimeError("No result from engine")

    ohlc_raw = result_data.get("ohlc", [])
    equity_curve_raw = result_data.get("equityCurve", [])
    module_outputs = result_data.get("moduleOutputs")
    return RunResponse(
        equity=result_data.get("equity", []),
        equityCurve=[EquityPoint(**p) for p in equity_curve_raw] if equity_curve_raw else None,
        metrics=BacktestMetrics(**result_data.get("metrics", {})),
        trades=[Trade(**t) for t in result_data.get("trades", [])],
        ohlc=[OhlcBar(**b) for b in ohlc_raw] if ohlc_raw else None,
        moduleOutputs=module_outputs,
        runId=result_data.get("runId"),
        manifest=result_data.get("manifest"),
        validation=result_data.get("validation"),
        robustness=result_data.get("robustness"),
        monteCarlo=result_data.get("monteCarlo"),
        regimeAnalysis=result_data.get("regimeAnalysis"),
        portfolio=result_data.get("portfolio"),
        executionSummary=result_data.get("executionSummary"),
        qualityGate=result_data.get("qualityGate"),
        experiment=result_data.get("experiment"),
        batchSummary=result_data.get("batchSummary"),
    )
