"""
View engine — host subprocess for /api/view (module/indicator chart helpers).
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import math
import os
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any

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


def _view_line_point(p: Any) -> dict | None:
    """Bod čáry pro View: date, value; volitelně state, score (trend z Swing HL)."""
    if not isinstance(p, dict) or "date" not in p:
        return None
    pt: dict[str, Any] = {"date": _to_iso(p.get("date", "")), "value": float(p.get("value", 0))}
    st = p.get("state")
    if st is not None:
        pt["state"] = str(st)
    sc = p.get("score")
    if sc is not None:
        try:
            pt["score"] = float(sc)
        except (TypeError, ValueError):
            pass
    return pt


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


def _series_as_float(df: pd.DataFrame, primary: str, fallback: str) -> pd.Series:
    if primary in df.columns:
        base = df[primary]
    elif fallback in df.columns:
        base = df[fallback]
    else:
        return pd.Series(0.0, index=df.index, dtype="float64")
    return pd.to_numeric(base, errors="coerce").fillna(0.0).astype(float)


_CHART_TF_TO_PANDAS: dict[str, str] = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
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
    "4h": 240,
    "1D": 1440,
    "1W": 10080,
    "1Mo": 43200,
}


def _infer_native_bar_minutes(df: pd.DataFrame) -> float:
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


def _swing_hl_canonical_view_chart_tf(norm_key: str | None) -> str | None:
    """Klíče TF stejné jako v modules/Swing_HL.py TF_FINE_TO_COARSE (1d/1w/1M)."""
    if not norm_key:
        return None
    return {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "4h": "4h",
        "1D": "1d",
        "1W": "1w",
        "1Mo": "1M",
    }.get(norm_key)


def _swing_hl_tf_from_bar_minutes(minutes: float) -> str:
    """Stejné prahy jako Swing_HL._infer_data_timeframe (medián mezer < 48 h)."""
    if minutes <= 1.5:
        return "1m"
    if minutes <= 7:
        return "5m"
    if minutes <= 22:
        return "15m"
    if minutes <= 45:
        return "30m"
    if minutes <= 90:
        return "1h"
    if minutes <= 720:
        return "4h"
    if minutes <= 4320:
        return "1d"
    if minutes <= 20160:
        return "1w"
    return "1M"


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
            f"chart_timeframe {key} is finer than native data (~{native_min:.1f} min bars); use native or coarser."
        )
    rule = _CHART_TF_TO_PANDAS[key]
    return _resample_ohlc_dataframe(df, rule)


_VIEW_OHLC_CACHE_MAX = max(1, int(float(os.environ.get("VIEW_OHLC_CACHE_MAX", "32") or 32)))
_VIEW_OHLC_CACHE: "OrderedDict[tuple[str, int, float, str, str], pd.DataFrame]" = OrderedDict()


def _slice_ohlc_by_iso(df: pd.DataFrame, start_iso: str | None, end_iso: str | None) -> pd.DataFrame:
    if df.empty:
        return df
    out = df
    if start_iso and str(start_iso).strip():
        out = out[out.index >= pd.Timestamp(str(start_iso).strip())]
    if end_iso and str(end_iso).strip():
        out = out[out.index <= pd.Timestamp(str(end_iso).strip())]
    return out


def _load_ohlc_uncached(
    data_root: Path,
    data_file: str,
    years: float,
    start_iso: str | None = None,
    end_iso: str | None = None,
) -> pd.DataFrame:
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
            try:
                df.attrs["volumeIsSyntheticPlaceholder"] = True
            except Exception:
                pass
            print(
                "[view_engine] CSV has no volume — synthetic volume=1000; chart/module volume logic is not realistic.",
                file=sys.stderr,
                flush=True,
            )
        else:
            try:
                df.attrs["volumeIsSyntheticPlaceholder"] = False
            except Exception:
                pass
    else:
        df = pd.read_parquet(p)
        if not isinstance(df.index, pd.DatetimeIndex):
            if "datetime" in df.columns:
                df = df.set_index(pd.to_datetime(df["datetime"], errors="coerce")).sort_index()
                df = df[~df.index.isna()]
            else:
                raise ValueError(f"Parquet must have DatetimeIndex or 'datetime' column: {p.name}")

    if years > 0 and len(df) > 0:
        cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
        df = df[df.index >= cutoff]
    df = _slice_ohlc_by_iso(df, start_iso, end_iso)
    return df


def _load_ohlc(
    data_root: Path,
    data_file: str,
    years: float,
    start_iso: str | None = None,
    end_iso: str | None = None,
) -> pd.DataFrame:
    safe_file = (data_file or "").replace("\\", "/").lstrip("/")
    if not safe_file or safe_file.startswith("../") or "/../" in safe_file:
        raise ValueError("Unsafe data_file path")
    p = (data_root / safe_file).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Data file not found: {data_file}")
    try:
        st = p.stat()
        mtime_ns = int(st.st_mtime_ns)
    except OSError:
        mtime_ns = 0
    cache_key = (str(p), mtime_ns, float(years), start_iso or "", end_iso or "")
    hit = _VIEW_OHLC_CACHE.get(cache_key)
    if hit is not None:
        _VIEW_OHLC_CACHE.move_to_end(cache_key)
        return hit.copy()
    df = _load_ohlc_uncached(data_root, data_file, years, start_iso, end_iso)
    _VIEW_OHLC_CACHE[cache_key] = df
    _VIEW_OHLC_CACHE.move_to_end(cache_key)
    while len(_VIEW_OHLC_CACHE) > _VIEW_OHLC_CACHE_MAX:
        _VIEW_OHLC_CACHE.popitem(last=False)
    return df.copy()


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
                    mkr: dict[str, Any] = {
                        "date": _to_iso(item["date"]),
                        "type": str(item["type"]).lower(),
                        "value": float(item["value"]),
                    }
                    bi = item.get("bar_index")
                    if isinstance(bi, int):
                        mkr["bar_index"] = bi
                    elif isinstance(bi, float) and math.isfinite(bi):
                        mkr["bar_index"] = int(bi)
                    markers.append(mkr)

    if hasattr(mod, "get_line"):
        result = _call_with_params(mod.get_line, df, params)
        if isinstance(result, dict):
            for name, data in result.items():
                pts: list[dict] = []
                color = None
                segments = None
                if isinstance(data, list):
                    pts = [lp for p in data if isinstance(p, dict) and (lp := _view_line_point(p)) is not None]
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
                    pts = [lp for p in raw_data if isinstance(p, dict) and (lp := _view_line_point(p)) is not None]
                    color = data.get("color")
                    segments = data.get("segments")
                if pts:
                    if isinstance(segments, list) and len(segments) > 0:
                        for seg in segments:
                            if not isinstance(seg, dict):
                                continue
                            if "from" not in seg or "to" not in seg or "color" not in seg:
                                continue
                            try:
                                i0, i1 = int(seg["from"]), int(seg["to"]) + 1
                            except (TypeError, ValueError):
                                continue
                            if i0 < 0 or i1 > len(pts) or i0 >= i1:
                                continue
                            seg_pts = pts[i0:i1]
                            if seg_pts:
                                lines.append({
                                    "name": str(name),
                                    "data": seg_pts,
                                    "color": str(seg["color"]),
                                })
                    else:
                        line_obj = {"name": str(name), "data": pts}
                        if color:
                            line_obj["color"] = str(color)
                        lines.append(line_obj)
        elif isinstance(result, list):
            pts = [lp for p in result if isinstance(p, dict) and (lp := _view_line_point(p)) is not None]
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
                    zone: dict = {
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
                        norm_ind = []
                        for ind in item["inducements"]:
                            if not isinstance(ind, dict):
                                continue
                            one = dict(ind)
                            if "date" in one:
                                one["date"] = _to_iso(one["date"])
                            if "value" in one:
                                try:
                                    one["value"] = float(one["value"])
                                except (TypeError, ValueError):
                                    pass
                            if "index" in one:
                                try:
                                    one["index"] = int(one["index"])
                                except (TypeError, ValueError):
                                    pass
                            norm_ind.append(one)
                        zone["inducements"] = norm_ind
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
    # years == 0 = celá historie (bez cutoff). Nepoužívat `or 0.25` — 0 je v Pythonu falsy.
    _yr = req.get("years", None)
    years = float(0.25 if _yr is None else _yr)
    start_iso = req.get("start_iso")
    end_iso = req.get("end_iso")
    if isinstance(start_iso, str):
        start_iso = start_iso.strip() or None
    else:
        start_iso = None
    if isinstance(end_iso, str):
        end_iso = end_iso.strip() or None
    else:
        end_iso = None

    df_native = _load_ohlc(data_path, data_file, years, start_iso, end_iso)
    chart_tf = req.get("chart_timeframe")
    try:
        df = _apply_view_chart_timeframe(df_native, chart_tf if isinstance(chart_tf, str) else None)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
    params = dict(req.get("params") if isinstance(req.get("params"), dict) else {})
    _norm_ctf = _normalize_chart_tf_key(chart_tf if isinstance(chart_tf, str) else None)
    _vctf = _swing_hl_canonical_view_chart_tf(_norm_ctf)
    if _vctf:
        params["_view_chart_tf"] = _vctf
    try:
        _inf_m = _infer_native_bar_minutes(df)
        params["_view_ohlc_inferred_tf"] = _swing_hl_tf_from_bar_minutes(_inf_m)
    except Exception:
        pass
    params["_view_ohlc_native"] = df_native
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

