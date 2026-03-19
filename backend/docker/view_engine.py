"""
View engine - executes module/indicator visualization code inside Docker sandbox.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import sys
from pathlib import Path

import pandas as pd


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


def _series_as_float(df: pd.DataFrame, primary: str, fallback: str) -> pd.Series:
    if primary in df.columns:
        base = df[primary]
    elif fallback in df.columns:
        base = df[fallback]
    else:
        return pd.Series(0.0, index=df.index, dtype="float64")
    return pd.to_numeric(base, errors="coerce").fillna(0.0).astype(float)


def _load_ohlc(data_root: Path, data_file: str, years: float) -> pd.DataFrame:
    safe_file = (data_file or "").replace("\\", "/").lstrip("/")
    if not safe_file or safe_file.startswith("../") or "/../" in safe_file:
        raise ValueError("Unsafe data_file path")
    p = (data_root / safe_file).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Data file not found: {data_file}")

    if p.suffix.lower() == ".txt":
        df = pd.read_csv(
            p,
            header=None,
            names=["Date", "Time", "open", "high", "low", "close", "volume"],
        )
        df["datetime"] = pd.to_datetime(
            df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
            format="%m/%d/%Y %H:%M",
            errors="coerce",
        )
        df = df.dropna(subset=["datetime"]).set_index("datetime").sort_index()
    elif p.suffix.lower() == ".csv":
        df = pd.read_csv(p)
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
        df = pd.read_parquet(p)

    if years > 0 and len(df) > 0:
        cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
        df = df[df.index >= cutoff]
    return df


def _call_with_params(fn, df: pd.DataFrame, params: dict):
    try:
        sig = inspect.signature(fn)
        if len(sig.parameters) >= 2:
            return fn(df, params or {})
    except (ValueError, TypeError):
        pass
    return fn(df)


def _run_view_code(main_path: Path, module_key: str, df: pd.DataFrame, params: dict) -> tuple[list[dict], list[dict], list[dict]]:
    spec = importlib.util.spec_from_file_location(module_key, main_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load view module")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_key] = mod
    spec.loader.exec_module(mod)

    markers: list[dict] = []
    lines: list[dict] = []
    zones: list[dict] = []

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

    if hasattr(mod, "get_line"):
        result = _call_with_params(mod.get_line, df, params)
        if isinstance(result, dict):
            for name, data in result.items():
                pts = []
                color = None
                if isinstance(data, list):
                    pts = [{"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))} for p in data if isinstance(p, dict)]
                elif isinstance(data, dict) and "data" in data:
                    pts = [{"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))} for p in data["data"] if isinstance(p, dict)]
                    color = data.get("color")
                if pts:
                    line_obj = {"name": str(name), "data": pts}
                    if color:
                        line_obj["color"] = str(color)
                    lines.append(line_obj)
        elif isinstance(result, list):
            pts = [{"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))} for p in result if isinstance(p, dict)]
            if pts:
                lines.append({"name": "line", "data": pts})

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
                    zones.append({
                        "date_start": _to_iso(item["date_start"]),
                        "date_end": _to_iso(item["date_end"]),
                        "value_low": float(item["value_low"]),
                        "value_high": float(item["value_high"]),
                        "fillcolor": str(item["fillcolor"]) if item.get("fillcolor") else None,
                        "name": str(item["name"]) if item.get("name") else None,
                    })

    return markers, lines, zones


def main() -> None:
    data_path = Path((sys.argv[1] if len(sys.argv) > 1 else "/app/data")).resolve()
    req_path = Path((sys.argv[2] if len(sys.argv) > 2 else "/app/view/request.json")).resolve()

    if not req_path.exists():
        raise FileNotFoundError("View request payload not found")
    req = json.loads(req_path.read_text(encoding="utf-8"))

    main_path = Path(req.get("main_path", "/app/view/main.py")).resolve()
    if not main_path.exists():
        raise FileNotFoundError("View module code file not found")

    deps_dir = Path(req.get("deps_dir", "/app/view/modules")).resolve()
    if deps_dir.exists():
        sys.path.insert(0, str(deps_dir.parent))

    data_file = str(req.get("data_file", ""))
    years = float(req.get("years", 0.25) or 0.25)
    params = req.get("params") if isinstance(req.get("params"), dict) else {}

    df = _load_ohlc(data_path, data_file, years)
    markers, lines, zones = _run_view_code(main_path, "sandbox_view_module", df, params)
    ohlc_df = pd.DataFrame({
        "date": [_to_iso(ts) for ts in df.index],
        "open": _series_as_float(df, "open", "Open"),
        "high": _series_as_float(df, "high", "High"),
        "low": _series_as_float(df, "low", "Low"),
        "close": _series_as_float(df, "close", "Close"),
    })
    payload = {"ohlc": ohlc_df.to_dict(orient="records"), "markers": markers, "lines": lines, "zones": zones}
    print(json.dumps(payload))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

