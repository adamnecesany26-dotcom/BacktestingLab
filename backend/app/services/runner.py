"""
Strategy Runner - orchestrates Docker container execution.
Supports streaming stdout/stderr to client.
Uses subprocess.Popen (not asyncio) - Python 3.14 on Windows has NotImplementedError in asyncio subprocess.
"""

import asyncio
import json
import re
import subprocess
import threading
from pathlib import Path
from typing import AsyncGenerator, Awaitable, Callable, Union

from app.models.run import RunResponse, BacktestMetrics, Trade, OhlcBar, EquityPoint

RUN_TIMEOUT = 180  # 3 minutes


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
    return set(matches)


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
            full_path = run_dir / file_path
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

    sys.path.insert(0, str(run_dir))

    for mod in applied_modules:
        name = mod.get("name") or ""
        params = mod.get("params") or {}
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

            markers = []
            lines = []
            zones = []

            if hasattr(mod_obj, "detect"):
                try:
                    sig = inspect.signature(mod_obj.detect)
                    result = mod_obj.detect(df, params) if len(sig.parameters) >= 2 else mod_obj.detect(df)
                except (ValueError, TypeError):
                    result = mod_obj.detect(df)
                if isinstance(result, list):
                    for item in result:
                        if isinstance(item, dict) and "date" in item and "type" in item and "value" in item:
                            markers.append({
                                "date": str(item["date"])[:10],
                                "type": str(item["type"]).lower(),
                                "value": float(item["value"]),
                            })

            if hasattr(mod_obj, "get_line"):
                try:
                    sig = inspect.signature(mod_obj.get_line)
                    result = mod_obj.get_line(df, params) if len(sig.parameters) >= 2 else mod_obj.get_line(df)
                except (ValueError, TypeError):
                    result = mod_obj.get_line(df)
                if isinstance(result, dict):
                    for line_name, data in result.items():
                        pts = []
                        color = None
                        segments = None
                        if isinstance(data, list):
                            pts = [
                                {"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))}
                                for p in data if isinstance(p, dict)
                            ]
                        elif isinstance(data, dict) and "data" in data:
                            pts = [
                                {"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))}
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
                        {"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))}
                        for p in result if isinstance(p, dict)
                    ]
                    if pts:
                        lines.append({"name": "line", "data": pts})

            if hasattr(mod_obj, "get_zones"):
                try:
                    sig = inspect.signature(mod_obj.get_zones)
                    result = mod_obj.get_zones(df, params) if len(sig.parameters) >= 2 else mod_obj.get_zones(df)
                except (ValueError, TypeError):
                    result = mod_obj.get_zones(df)
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
                                "date_start": str(item["date_start"])[:10],
                                "date_end": str(item["date_end"])[:10],
                                "value_low": float(item["value_low"]),
                                "value_high": float(item["value_high"]),
                                "fillcolor": str(item["fillcolor"]) if item.get("fillcolor") else None,
                                "name": str(item["name"]) if item.get("name") else None,
                            }
                            if "base_length" in item:
                                zone["base_length"] = int(item["base_length"])
                            if "impulse_score" in item:
                                zone["impulse_score"] = int(item["impulse_score"])
                            if "has_gap" in item:
                                zone["has_gap"] = bool(item["has_gap"])
                            if "gap_type" in item:
                                zone["gap_type"] = str(item["gap_type"])
                            if "gap_date" in item:
                                zone["gap_date"] = str(item["gap_date"])[:10]
                            if "gap_value_low" in item:
                                zone["gap_value_low"] = float(item["gap_value_low"])
                            if "gap_value_high" in item:
                                zone["gap_value_high"] = float(item["gap_value_high"])
                            if "inducements" in item and isinstance(item["inducements"], list):
                                zone["inducements"] = [
                                    {"date": str(x.get("date", ""))[:10], "value": float(x.get("value", 0)), "type": str(x.get("type", ""))}
                                    for x in item["inducements"] if isinstance(x, dict)
                                ]
                            if "inducement_count" in item:
                                zone["inducement_count"] = int(item["inducement_count"])
                            if "inducement_points" in item:
                                zone["inducement_points"] = int(item["inducement_points"])
                            zones.append(zone)

            outputs[name] = {"markers": markers, "lines": lines, "zones": zones}
        except Exception as e:
            print(f"[runner] Module {name} output error: {e}", flush=True)
        finally:
            if f"mod_{mod_name}" in sys.modules:
                del sys.modules[f"mod_{mod_name}"]

    if str(run_dir) in sys.path:
        sys.path.remove(str(run_dir))
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
    instrument_type: str = "futures",
    tick_size: float | None = None,
    value_per_tick: float | None = None,
    share_size: int | None = None,
    lot_size: float | None = None,
    pip_size: float | None = None,
    pip_value: float | None = None,
    strategy_params: dict | None = None,
    applied_modules: list | None = None,
    is_client_connected: Callable[[], Union[bool, Awaitable[bool]]] = lambda: True,
) -> AsyncGenerator[dict, None]:
    """
    Execute strategy in Docker sandbox, yield events for streaming.
    Yields: {"type": "log", "line": "..."} | {"type": "progress", "value": 0-100} | {"type": "result", "data": {...}} | {"type": "error", "message": "..."}
    """
    backend_root = Path(__file__).resolve().parent.parent.parent
    project_root = backend_root.parent
    data_dir = project_root / "data"
    run_dir = project_root / ".backtest_run"
    run_dir.mkdir(parents=True, exist_ok=True)

    entry_file = _prepare_strategy_files(run_dir, code, files)
    strategy_path = run_dir / entry_file

    # Filter params to only those the strategy accepts (avoids "unexpected keyword argument")
    accepted_params = _extract_strategy_param_names(files, code)
    filtered_params = strategy_params
    if accepted_params:
        filtered_params = {k: v for k, v in (strategy_params or {}).items() if k in accepted_params}

    try:
        if not data_dir.exists():
            data_dir.mkdir(parents=True, exist_ok=True)

        run_path = str(run_dir.absolute()).replace("\\", "/")
        data_path = str(data_dir.absolute()).replace("\\", "/")
        print(f"[runner] run_dir={run_path} data_dir={data_path}", flush=True)
        cmd = [
            "docker", "run",
            "--rm",
            "--memory=1g",
            "--cpus=1",
            "--network", "none",
            "-v", f"{run_path}:/app/strategy:rw",
            "-v", f"{data_path}:/app/data:ro",
            "-e", f"STRATEGY_PATH=/app/strategy/{entry_file}",
            "-e", f"DATA_PATH=/app/data",
            "-e", f"INSTRUMENT={instrument}",
            "-e", f"TIMEFRAME={timeframe}",
            "-e", f"YEARS={years}",
            "-e", f"DATA_FILE={data_file}",
            "-e", f"INITIAL_CAPITAL={initial_capital}",
            "-e", f"SLIPPAGE_PERC={slippage_perc}",
            "-e", f"INSTRUMENT_TYPE={instrument_type}",
            "-e", f"TICK_SIZE={tick_size if tick_size is not None else ''}",
            "-e", f"VALUE_PER_TICK={value_per_tick if value_per_tick is not None else ''}",
            "-e", f"SHARE_SIZE={share_size if share_size is not None else ''}",
            "-e", f"LOT_SIZE={lot_size if lot_size is not None else ''}",
            "-e", f"PIP_SIZE={pip_size if pip_size is not None else ''}",
            "-e", f"PIP_VALUE={pip_value if pip_value is not None else ''}",
            "-e", f"STRATEGY_PARAMS={json.dumps(_merge_strategy_params(filtered_params, instrument_type, share_size, lot_size, pip_size, pip_value))}",
            "backtest-engine",
        ]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )

        queue: asyncio.Queue = asyncio.Queue()
        stdout_buffer: list[str] = []
        stderr_buffer: list[str] = []
        loop = asyncio.get_event_loop()
        _read_stream_sync(proc, queue, loop, stdout_buffer, stderr_buffer)

        async def kill_after_timeout():
            await asyncio.sleep(RUN_TIMEOUT)
            if proc.poll() is None:
                proc.kill()

        timeout_task = asyncio.create_task(kill_after_timeout())

        done_count = 0
        result_data = None
        error_msg = None

        while done_count < 2:
            conn = is_client_connected()
            if asyncio.iscoroutine(conn):
                conn = await conn
            if not conn:
                proc.kill()
                break
            try:
                ev = await asyncio.wait_for(queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            if ev.get("type") == "done":
                done_count += 1
                continue
            if ev.get("type") == "result":
                result_data = ev.get("data")
                if result_data and applied_modules:
                    ohlc_raw = result_data.get("ohlc", [])
                    mods = [
                        {"id": getattr(m, "id", ""), "name": getattr(m, "name", ""), "params": getattr(m, "params", None) or {}}
                        for m in applied_modules
                    ]
                    try:
                        mo = _run_module_outputs(run_dir, ohlc_raw, mods)
                        if mo:
                            result_data["moduleOutputs"] = mo
                            ev = {"type": "result", "data": result_data}
                    except Exception as ex:
                        print(f"[runner] moduleOutputs error: {ex}", flush=True)
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

        try:
            timeout_task.cancel()
        except asyncio.CancelledError:
            pass

        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

        if not result_data and not error_msg and proc.returncode != 0:
            err = "\n".join(stderr_buffer) or "Unknown error"
            msg = f"Docker failed (exit {proc.returncode}): {err}"
            print(f"[runner] DOCKER FAILED:\n{msg[:1500]}", flush=True)
            (run_dir / "last_error_strategy.py").write_text(
                (code or "")[:5000] if code else str(files or {})[:5000], encoding="utf-8"
            )
            yield {"type": "error", "message": msg}
    finally:
        for f in run_dir.glob("*.py"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
        for d in run_dir.iterdir():
            if d.is_dir():
                for f in d.rglob("*.py"):
                    try:
                        f.unlink(missing_ok=True)
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
    instrument_type: str = "futures",
    tick_size: float | None = None,
    value_per_tick: float | None = None,
    share_size: int | None = None,
    lot_size: float | None = None,
    pip_size: float | None = None,
    pip_value: float | None = None,
    strategy_params: dict | None = None,
    applied_modules: list | None = None,
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
        instrument_type=instrument_type,
        tick_size=tick_size,
        value_per_tick=value_per_tick,
        share_size=share_size,
        lot_size=lot_size,
        pip_size=pip_size,
        pip_value=pip_value,
        strategy_params=strategy_params,
        applied_modules=applied_modules,
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
    return RunResponse(
        equity=result_data.get("equity", []),
        equityCurve=[EquityPoint(**p) for p in equity_curve_raw] if equity_curve_raw else None,
        metrics=BacktestMetrics(**result_data.get("metrics", {})),
        trades=[Trade(**t) for t in result_data.get("trades", [])],
        ohlc=[OhlcBar(**b) for b in ohlc_raw] if ohlc_raw else None,
        moduleOutputs=module_outputs,
    )
