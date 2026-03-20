"""
GET/POST /api/view - OHLC data + optional module markers for Strategy View chart.
Used for visual testing of modules/indicators (e.g. H/L detection).
"""

import re
import uuid
from pathlib import Path
from typing import Any
import asyncio
import os
import json
import shutil
import subprocess
import tempfile

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from app.services.audit import append_audit_event

router = APIRouter()
MAX_VIEW_CODE_CHARS = 500_000
MAX_VIEW_DEPENDENCIES = 50
MAX_VIEW_DEP_CODE_CHARS = 500_000
MODULE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,79}$")
VIEW_WORKER_TIMEOUT_SEC = 30


def _to_iso(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    try:
        return pd.Timestamp(value).isoformat()
    except Exception:
        return str(value)


def _is_regime_histogram_row(p: Any) -> bool:
    if not isinstance(p, dict) or "date" not in p:
        return False
    if isinstance(p.get("states"), dict):
        st = p["states"]
        return all(k in st for k in ("trend", "chop", "high_vol"))
    return all(k in p for k in ("trend", "chop", "high_vol"))


def _normalize_regime_probs(p: dict) -> tuple[float, float, float]:
    if isinstance(p.get("states"), dict):
        st = p["states"]
        t = float(st.get("trend", 0))
        c = float(st.get("chop", 0))
        h = float(st.get("high_vol", 0))
    else:
        t = float(p.get("trend", 0))
        c = float(p.get("chop", 0))
        h = float(p.get("high_vol", 0))
    s = t + c + h
    if s > 0:
        return t / s, c / s, h / s
    return 0.0, 0.0, 0.0


def _try_build_regime_histogram_line(name: str, raw_list: list) -> dict | None:
    """Vrátí {'name', 'regime_histogram': True, 'data': [{date, trend, chop, high_vol}, ...]} nebo None."""
    if not isinstance(raw_list, list) or len(raw_list) == 0:
        return None
    if not all(_is_regime_histogram_row(p) for p in raw_list if isinstance(p, dict)):
        return None
    pts: list[dict] = []
    for p in raw_list:
        if not isinstance(p, dict) or "date" not in p:
            continue
        t, c, h = _normalize_regime_probs(p)
        pts.append({"date": _to_iso(p["date"]), "trend": t, "chop": c, "high_vol": h})
    if not pts:
        return None
    return {"name": str(name), "regime_histogram": True, "data": pts}


def _get_data_dir() -> Path:
    backend_root = Path(__file__).resolve().parent.parent.parent
    primary = backend_root.parent / "data"
    if (primary / "mock").exists() or (primary / "futures_30m").exists():
        return primary
    for candidate in [Path.cwd() / "data", Path.cwd().parent / "data"]:
        if (candidate / "mock").exists() or (candidate / "futures_30m").exists():
            return candidate
    return primary


def _resolve_safe_data_path(data_dir: Path, data_file: str) -> Path:
    normalized = (data_file or "").replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise ValueError("Unsafe data_file path")
    root = data_dir.resolve()
    path = (root / normalized).resolve()
    if root != path and root not in path.parents:
        raise ValueError("Unsafe data_file path")
    return path


def _load_ohlc(data_file: str, years: float) -> pd.DataFrame:
    """Load and normalize OHLC from CSV/parquet. Returns DataFrame with datetime index."""
    data_dir = _get_data_dir()
    path = _resolve_safe_data_path(data_dir, data_file)
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {data_file}")

    if path.suffix.lower() == ".txt":
        df = pd.read_csv(
            path,
            header=None,
            names=["Date", "Time", "open", "high", "low", "close", "volume"],
        )
        df["datetime"] = pd.to_datetime(
            df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
            format="%m/%d/%Y %H:%M",
            errors="coerce",
        )
        df = df.dropna(subset=["datetime"]).set_index("datetime").sort_index()
    elif path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
        col_map = {}
        for c in df.columns:
            l = c.lower()
            if "close" in l or "last" in l:
                col_map[c] = "close"
            elif "open" in l:
                col_map[c] = "open"
            elif "high" in l:
                col_map[c] = "high"
            elif "low" in l:
                col_map[c] = "low"
            elif "date" in l:
                col_map[c] = "datetime"
            elif "volume" in l:
                col_map[c] = "volume"
        df = df.rename(columns=col_map)
        for dc in ["datetime", "Date", "date"]:
            if dc in df.columns:
                df["datetime"] = pd.to_datetime(df[dc])
                df = df.set_index("datetime").sort_index()
                break
        if "volume" not in df.columns:
            df["volume"] = 1000
    else:
        df = pd.read_parquet(path)

    if years > 0 and len(df) > 0:
        cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
        df = df[df.index >= cutoff]

    return df


# --- View chart candle timeframe (OHLC resample; only coarser than native bars) ---
_CHART_TF_TO_PANDAS: dict[str, str] = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "1D": "1D",
    "1W": "1W",
    "1Mo": "1ME",
}
_CHART_TF_MINUTES: dict[str, float] = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
    "1D": 1440,
    "1W": 10080,
    "1Mo": 43200,
}


def _infer_native_bar_minutes(df: pd.DataFrame) -> float:
    """Median bar spacing (minutes), ignoring gaps > 48h (weekends etc.)."""
    if df is None or len(df.index) < 2:
        return 1440.0
    delta_min = df.index.to_series().diff().dt.total_seconds() / 60.0
    valid = delta_min[(delta_min > 0) & (delta_min < 60 * 48)]
    if valid.empty:
        return 1440.0
    return float(valid.median())


def _normalize_chart_tf_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() == "native":
        return None
    if s in _CHART_TF_TO_PANDAS:
        return s
    low = s.lower()
    for k in _CHART_TF_TO_PANDAS:
        if k.lower() == low:
            return k
    return None


def _resample_ohlc_dataframe(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    if df.empty:
        return df
    work = df.copy()
    rename: dict[str, str] = {}
    for c in list(work.columns):
        low = c.lower()
        if low in ("open", "high", "low", "close", "volume"):
            rename[c] = low
    work = work.rename(columns=rename)
    for need in ("open", "high", "low", "close"):
        if need not in work.columns:
            cap = need.capitalize()
            if cap in work.columns:
                work[need] = work[cap]
            else:
                raise ValueError(f"Missing OHLC column for resample: {need}")
    if "volume" not in work.columns:
        work["volume"] = 0.0
    agg_map = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    out = work[["open", "high", "low", "close", "volume"]].resample(rule, label="left", closed="left").agg(agg_map)
    out = out.dropna(subset=["open", "high", "low", "close"], how="any")
    return out


def _apply_view_chart_timeframe(df: pd.DataFrame, chart_timeframe: str | None) -> pd.DataFrame:
    key = _normalize_chart_tf_key(chart_timeframe)
    if key is None:
        return df
    if key not in _CHART_TF_TO_PANDAS:
        raise ValueError(f"Unknown chart_timeframe: {chart_timeframe!r}")
    native_min = _infer_native_bar_minutes(df)
    target_min = _CHART_TF_MINUTES[key]
    if target_min < native_min * 0.99:
        raise ValueError(
            f"chart_timeframe {key} is finer than native data (~{native_min:.1f} min bars); use native or a coarser step."
        )
    rule = _CHART_TF_TO_PANDAS[key]
    return _resample_ohlc_dataframe(df, rule)


def _validate_module_dependencies(module_dependencies: dict[str, str] | None) -> None:
    if not module_dependencies:
        return
    if len(module_dependencies) > MAX_VIEW_DEPENDENCIES:
        raise ValueError(f"Too many module dependencies (max {MAX_VIEW_DEPENDENCIES})")
    for mod_name, mod_content in module_dependencies.items():
        if not MODULE_NAME_RE.fullmatch(str(mod_name)):
            raise ValueError(f"Invalid module dependency name: {mod_name}")
        if mod_content and len(mod_content) > MAX_VIEW_DEP_CODE_CHARS:
            raise ValueError(f"Dependency module '{mod_name}' exceeds max size ({MAX_VIEW_DEP_CODE_CHARS} chars)")


def _series_as_float(df: pd.DataFrame, primary: str, fallback: str) -> pd.Series:
    if primary in df.columns:
        base = df[primary]
    elif fallback in df.columns:
        base = df[fallback]
    else:
        return pd.Series(0.0, index=df.index, dtype="float64")
    return pd.to_numeric(base, errors="coerce").fillna(0.0).astype(float)


def _resolve_view_worker_timeout_seconds() -> int:
    raw = os.environ.get("VIEW_WORKER_TIMEOUT_SEC")
    if raw is None or str(raw).strip() == "":
        return VIEW_WORKER_TIMEOUT_SEC
    try:
        parsed = int(float(raw))
    except ValueError:
        return VIEW_WORKER_TIMEOUT_SEC
    return max(0, parsed)


async def _run_view_code_in_docker(
    *,
    data_file: str,
    years: float,
    module_code: str,
    params: dict[str, Any] | None,
    module_dependencies: dict[str, str] | None,
    actor_id: str,
    chart_timeframe: str | None = None,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    backend_root = Path(__file__).resolve().parent.parent.parent
    project_root = backend_root.parent
    data_dir = _get_data_dir()
    timeout_sec = _resolve_view_worker_timeout_seconds()

    _validate_module_dependencies(module_dependencies)
    if len(module_code or "") > MAX_VIEW_CODE_CHARS:
        raise ValueError(f"module_code exceeds max size ({MAX_VIEW_CODE_CHARS} chars)")

    work_root = project_root / ".view_run"
    work_root.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="view_", dir=work_root))
    try:
        modules_dir = run_dir / "modules"
        modules_dir.mkdir(exist_ok=True)
        (modules_dir / "__init__.py").write_text("", encoding="utf-8")
        for mod_name, mod_content in (module_dependencies or {}).items():
            (modules_dir / f"{mod_name}.py").write_text(mod_content, encoding="utf-8")

        main_path = run_dir / "main.py"
        main_path.write_text(module_code, encoding="utf-8")
        req_path = run_dir / "request.json"
        req_path.write_text(
            json.dumps(
                {
                    "data_file": data_file,
                    "years": years,
                    "params": params or {},
                    "chart_timeframe": chart_timeframe,
                    "main_path": "/app/view/main.py",
                    "deps_dir": "/app/view/modules",
                    "actor_id": actor_id,
                }
            ),
            encoding="utf-8",
        )

        run_path = str(run_dir.resolve()).replace("\\", "/")
        data_path = str(data_dir.resolve()).replace("\\", "/")
        cmd = [
            "docker", "run",
            "--rm",
            "--memory=512m",
            "--cpus=1",
            "--pids-limit=128",
            "--network", "none",
            "--security-opt", "no-new-privileges:true",
            "--cap-drop", "ALL",
            "-v", f"{run_path}:/app/view:rw",
            "-v", f"{data_path}:/app/data:ro",
            "backtest-engine",
            "python", "view_engine.py", "/app/data", "/app/view/request.json",
        ]
        proc = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec if timeout_sec > 0 else None,
            check=False,
        )
        if proc.returncode != 0:
            stderr_preview = (proc.stderr or "unknown view engine error").strip()[:500]
            raise RuntimeError(f"Sandbox view engine failed: {stderr_preview}")
        stdout = (proc.stdout or "").strip()
        if not stdout:
            raise RuntimeError("Sandbox view engine returned empty output")
        payload = json.loads(stdout)
        if isinstance(payload, dict) and payload.get("error"):
            raise RuntimeError(str(payload["error"]))
        ohlc = payload.get("ohlc") if isinstance(payload, dict) else None
        markers = payload.get("markers") if isinstance(payload, dict) else None
        lines = payload.get("lines") if isinstance(payload, dict) else None
        zones = payload.get("zones") if isinstance(payload, dict) else None
        if not isinstance(ohlc, list) or not isinstance(markers, list) or not isinstance(lines, list) or not isinstance(zones, list):
            raise RuntimeError("Sandbox view engine returned invalid payload")
        return ohlc, markers, lines, zones
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def _run_view_code(
    code: str,
    df: pd.DataFrame,
    params: dict | None = None,
    module_dependencies: dict[str, str] | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Execute detect(ohlc), get_line(ohlc), get_zones(ohlc) from module/indicator/strategy.
    Returns (markers, lines, zones).

    module_dependencies: { "Swing_HL": "..." } – moduly pro "from modules.Swing_HL import ..."

    MODULE / INDICATOR / STRATEGIE – všechny používají stejné rozhraní:

    # Markery (bodové značky – H/L, swing points, signály):
    def detect(ohlc: pd.DataFrame) -> list[dict]:
        return [{"date": "YYYY-MM-DD", "type": "high"|"low"|"signal", "value": float}, ...]

    # Čáry (indikátory – EMA, RSI, atd.):
    def get_line(ohlc: pd.DataFrame) -> list[dict] | dict:
        return [{"date", "value"}, ...] nebo {"EMA20": [...], "EMA50": [...]}

    # Zóny/boxy (support/resistance, price zones):
    def get_zones(ohlc: pd.DataFrame) -> list[dict]:
        return [{"date_start": "YYYY-MM-DD", "date_end": "YYYY-MM-DD", "value_low": float, "value_high": float, "fillcolor"?: str, "name"?: str}, ...]
    """
    import importlib.util
    import shutil
    import sys
    import tempfile

    tmp_dir = None
    main_path = None
    mod = None
    module_key = f"view_module_{uuid.uuid4().hex}"
    dep_module_names: list[str] = []

    try:
        if len(code or "") > MAX_VIEW_CODE_CHARS:
            raise ValueError(f"module_code exceeds max size ({MAX_VIEW_CODE_CHARS} chars)")
        _validate_module_dependencies(module_dependencies)

        if module_dependencies:
            tmp_dir = Path(tempfile.mkdtemp())
            modules_dir = tmp_dir / "modules"
            modules_dir.mkdir()
            (modules_dir / "__init__.py").write_text("", encoding="utf-8")
            for mod_name, mod_content in module_dependencies.items():
                dep_module_names.append(mod_name)
                (modules_dir / f"{mod_name}.py").write_text(mod_content, encoding="utf-8")
            main_path = tmp_dir / "main.py"
            main_path.write_text(code, encoding="utf-8")
            sys.path.insert(0, str(tmp_dir))
        else:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
                f.write(code)
                main_path = Path(f.name)

        spec = importlib.util.spec_from_file_location(module_key, main_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("Unable to load view module")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[module_key] = mod
        spec.loader.exec_module(mod)

        params = params or {}
        markers = []
        if hasattr(mod, "detect"):
            result = _call_with_params(mod.detect, df, params)
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict) and "date" in item and "type" in item and "value" in item:
                        markers.append({
                            "date": _to_iso(item["date"]),
                            "type": str(item["type"]).lower(),
                            "value": float(item["value"]),
                        })

        lines = []
        if hasattr(mod, "get_line"):
            result = _call_with_params(mod.get_line, df, params)
            if isinstance(result, dict):
                for name, data in result.items():
                    pts = []
                    color = None
                    segments = None
                    if isinstance(data, list):
                        pts = [{"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))} for p in data if isinstance(p, dict)]
                    elif isinstance(data, dict) and "data" in data:
                        raw_data = data["data"]
                        forced = data.get("kind") == "regime_histogram"
                        if isinstance(raw_data, list) and (
                            forced
                            or (len(raw_data) > 0 and _is_regime_histogram_row(raw_data[0]))
                        ):
                            rh = _try_build_regime_histogram_line(name, raw_data)
                            if rh:
                                lines.append(rh)
                                continue
                            if forced:
                                continue
                        pts = [
                            {"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))}
                            for p in raw_data
                            if isinstance(p, dict)
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
                                        lines.append({"name": str(name), "data": seg_pts, "color": str(seg["color"])})
                        else:
                            line_obj = {"name": str(name), "data": pts}
                            if color:
                                line_obj["color"] = str(color)
                            lines.append(line_obj)
            elif isinstance(result, list):
                pts = [{"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))} for p in result if isinstance(p, dict)]
                if pts:
                    lines.append({"name": "line", "data": pts})

        zones = []
        if hasattr(mod, "get_zones"):
            result = _call_with_params(mod.get_zones, df, params)
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
                            "date_start": _to_iso(item["date_start"]),
                            "date_end": _to_iso(item["date_end"]),
                            "value_low": float(item["value_low"]),
                            "value_high": float(item["value_high"]),
                            "fillcolor": str(item["fillcolor"]) if item.get("fillcolor") else None,
                            "name": str(item["name"]) if item.get("name") else None,
                        }
                        if "base_length" in item:
                            zone["base_length"] = int(item["base_length"])
                        if "impulse_score" in item:
                            zone["impulse_score"] = int(item["impulse_score"])
                        if "touches" in item:
                            zone["touches"] = int(item["touches"])
                        if "strength" in item:
                            zone["strength"] = int(item["strength"])
                        if "has_touch" in item:
                            zone["has_touch"] = bool(item["has_touch"])
                        if "inducements" in item and isinstance(item["inducements"], list):
                            zone["inducements"] = item["inducements"]
                        if "inducement_count" in item:
                            zone["inducement_count"] = int(item["inducement_count"])
                        if "inducement_points" in item:
                            zone["inducement_points"] = int(item["inducement_points"])
                        if "has_gap" in item:
                            zone["has_gap"] = bool(item["has_gap"])
                        if "gap_type" in item:
                            zone["gap_type"] = str(item["gap_type"])
                        if "gap_date" in item:
                            zone["gap_date"] = _to_iso(item["gap_date"])
                        if "gap_value_low" in item:
                            zone["gap_value_low"] = float(item["gap_value_low"])
                        if "gap_value_high" in item:
                            zone["gap_value_high"] = float(item["gap_value_high"])
                        zones.append(zone)

        # Pro moduly se zónami (S/D): doplnit Major Swing HL z dependency, pokud chybí
        if zones and module_dependencies:
            _merge_major_markers_from_deps(markers, df, params, module_dependencies, tmp_dir)

        return markers, lines, zones
    finally:
        if module_key in sys.modules:
            del sys.modules[module_key]
        for dep_name in dep_module_names:
            dep_key = f"modules.{dep_name}"
            if dep_key in sys.modules:
                del sys.modules[dep_key]
        if dep_module_names and "modules" in sys.modules:
            del sys.modules["modules"]
        if tmp_dir and tmp_dir.exists():
            if str(tmp_dir) in sys.path:
                sys.path.remove(str(tmp_dir))
            shutil.rmtree(tmp_dir, ignore_errors=True)
        elif main_path and main_path.exists():
            main_path.unlink(missing_ok=True)


def _view_worker_process(
    data_file: str,
    years: float,
    code: str,
    params: dict[str, Any] | None,
    module_dependencies: dict[str, str] | None,
    queue,
) -> None:
    try:
        df = _load_ohlc(data_file, years)
        markers, lines, zones = _run_view_code(
            code,
            df,
            params=params or {},
            module_dependencies=module_dependencies,
        )
        queue.put({
            "ok": True,
            "markers": markers,
            "lines": lines,
            "zones": zones,
        })
    except Exception as e:
        queue.put({
            "ok": False,
            "error": str(e),
        })


def _run_view_code_isolated(
    data_file: str,
    years: float,
    code: str,
    params: dict[str, Any] | None = None,
    module_dependencies: dict[str, str] | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    import multiprocessing as mp

    ctx = mp.get_context("spawn")
    queue = ctx.Queue(maxsize=1)
    timeout_sec = _resolve_view_worker_timeout_seconds()
    proc = ctx.Process(
        target=_view_worker_process,
        args=(data_file, years, code, params, module_dependencies, queue),
        daemon=True,
    )
    proc.start()
    proc.join(timeout=timeout_sec if timeout_sec > 0 else None)
    if proc.is_alive():
        proc.terminate()
        proc.join(timeout=2)
        if proc.is_alive():
            proc.kill()
            proc.join(timeout=2)
        queue.close()
        queue.join_thread()
        raise TimeoutError(f"View worker timed out after {timeout_sec} seconds.")

    try:
        payload = queue.get(timeout=1)
    except Exception:
        payload = None
    finally:
        queue.close()
        queue.join_thread()

    if not isinstance(payload, dict):
        raise RuntimeError(f"View worker exited unexpectedly (exit_code={proc.exitcode})")
    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or "Unknown isolated view worker error"))

    markers = payload.get("markers")
    lines = payload.get("lines")
    zones = payload.get("zones")
    if not isinstance(markers, list) or not isinstance(lines, list) or not isinstance(zones, list):
        raise RuntimeError("Invalid isolated view worker payload")
    return markers, lines, zones


class ViewRequest(BaseModel):
    data_file: str
    years: float = 0.25
    module_code: str | None = None
    params: dict | None = None
    module_dependencies: dict[str, str] | None = None
    # native / None = source bars; else 1m,5m,…,1Mo (must be coarser than native bar size)
    chart_timeframe: str | None = None


def _call_with_params(fn, df: pd.DataFrame, params: dict):
    """Call fn(df) or fn(df, params) depending on signature."""
    import inspect
    try:
        sig = inspect.signature(fn)
        if len(sig.parameters) >= 2:
            return fn(df, params or {})
    except (ValueError, TypeError):
        pass
    return fn(df)


def _merge_major_markers_from_deps(
    markers: list[dict],
    df: pd.DataFrame,
    params: dict,
    module_dependencies: dict[str, str],
    tmp_dir: "Path | None",
) -> None:
    """
    Doplní major_high a major_low markery z dependency modulu (Swing_HL).
    Použije se pro S/D Zones, aby Major Swing HL byly vždy viditelné na grafu.
    """
    import importlib.util
    import sys

    if not tmp_dir or not tmp_dir.exists() or str(tmp_dir) not in sys.path:
        return

    existing = {(m["date"], m["type"]) for m in markers}
    has_major = any(t in ("major_high", "major_low") for _, t in existing)
    if has_major:
        return  # už máme major markery

    for mod_name in ("Swing_HL", "HL_identificator"):
        if mod_name not in module_dependencies:
            continue
        mod_path = tmp_dir / "modules" / f"{mod_name}.py"
        if not mod_path.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                f"view_dep_{mod_name}_{uuid.uuid4().hex}", mod_path
            )
            dep_mod = importlib.util.module_from_spec(spec)
            if spec.loader is None:
                continue
            spec.loader.exec_module(dep_mod)
            if not hasattr(dep_mod, "detect"):
                continue
            result = _call_with_params(dep_mod.detect, df, params)
            if not isinstance(result, list):
                continue
            for item in result:
                if not (
                    isinstance(item, dict)
                    and "date" in item
                    and "type" in item
                    and "value" in item
                ):
                    continue
                t = str(item["type"]).lower()
                if t not in ("major_high", "major_low"):
                    continue
                key = (_to_iso(item["date"]), t)
                if key not in existing:
                    markers.append({
                        "date": key[0],
                        "type": t,
                        "value": float(item["value"]),
                    })
                    existing.add(key)
            break  # stačí jeden dependency
        except Exception:
            continue


@router.post("/view")
async def get_view_data(req: ViewRequest, request: Request):
    """
    Load OHLC data and optionally run detect()/get_line() from module/indicator/strategy.
    Returns { ohlc: [...], markers: [...], lines: [{name, data: [...]}, ...] }.
    """
    try:
        df = _load_ohlc(req.data_file, req.years)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    actor_id = getattr(request.state, "actor_id", "unknown")
    markers: list = []
    lines: list = []
    zones: list = []

    if req.module_code and req.module_code.strip():
        try:
            ohlc, markers, lines, zones = await _run_view_code_in_docker(
                data_file=req.data_file,
                years=req.years,
                module_code=req.module_code.strip(),
                params=req.params or {},
                module_dependencies=req.module_dependencies,
                actor_id=actor_id,
                chart_timeframe=req.chart_timeframe,
            )
            append_audit_event(
                action="view.run",
                actor_id=actor_id,
                entity="view",
                status="ok",
                details={
                    "data_file": req.data_file,
                    "years": req.years,
                    "has_module_code": True,
                    "chart_timeframe": req.chart_timeframe,
                },
            )
            return {"ohlc": ohlc, "markers": markers, "lines": lines, "zones": zones}
        except Exception as e:
            append_audit_event(
                action="view.run",
                actor_id=actor_id,
                entity="view",
                status="error",
                details={"data_file": req.data_file, "years": req.years, "error": str(e)[:300]},
            )
            raise HTTPException(status_code=400, detail="View error: sandbox execution failed.")

    try:
        df_chart = _apply_view_chart_timeframe(df, req.chart_timeframe)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    ohlc_df = pd.DataFrame({
        "date": [_to_iso(ts) for ts in df_chart.index],
        "open": _series_as_float(df_chart, "open", "Open"),
        "high": _series_as_float(df_chart, "high", "High"),
        "low": _series_as_float(df_chart, "low", "Low"),
        "close": _series_as_float(df_chart, "close", "Close"),
    })
    ohlc = ohlc_df.to_dict(orient="records")

    return {"ohlc": ohlc, "markers": markers, "lines": lines, "zones": zones}
