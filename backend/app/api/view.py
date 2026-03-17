"""
GET/POST /api/view - OHLC data + optional module markers for Strategy View chart.
Used for visual testing of modules/indicators (e.g. H/L detection).
"""

from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


def _get_data_dir() -> Path:
    backend_root = Path(__file__).resolve().parent.parent.parent
    primary = backend_root.parent / "data"
    if (primary / "mock").exists():
        return primary
    for candidate in [Path.cwd() / "data", Path.cwd().parent / "data"]:
        if (candidate / "mock").exists():
            return candidate
    return primary


def _load_ohlc(data_file: str, years: float) -> pd.DataFrame:
    """Load and normalize OHLC from CSV/parquet. Returns DataFrame with datetime index."""
    data_dir = _get_data_dir()
    path = data_dir / data_file
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {data_file}")

    if path.suffix.lower() == ".csv":
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

    try:
        if module_dependencies:
            tmp_dir = Path(tempfile.mkdtemp())
            modules_dir = tmp_dir / "modules"
            modules_dir.mkdir()
            (modules_dir / "__init__.py").write_text("", encoding="utf-8")
            for mod_name, mod_content in module_dependencies.items():
                (modules_dir / f"{mod_name}.py").write_text(mod_content, encoding="utf-8")
            main_path = tmp_dir / "main.py"
            main_path.write_text(code, encoding="utf-8")
            sys.path.insert(0, str(tmp_dir))
        else:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
                f.write(code)
                main_path = Path(f.name)

        spec = importlib.util.spec_from_file_location("view_module", main_path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["view_module"] = mod
        spec.loader.exec_module(mod)

        params = params or {}
        markers = []
        if hasattr(mod, "detect"):
            result = _call_with_params(mod.detect, df, params)
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict) and "date" in item and "type" in item and "value" in item:
                        markers.append({
                            "date": str(item["date"])[:10],
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
                        pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in data if isinstance(p, dict)]
                    elif isinstance(data, dict) and "data" in data:
                        pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in data["data"] if isinstance(p, dict)]
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
                pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in result if isinstance(p, dict)]
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
                        if "touches" in item:
                            zone["touches"] = int(item["touches"])
                        if "strength" in item:
                            zone["strength"] = int(item["strength"])
                        if "has_touch" in item:
                            zone["has_touch"] = bool(item["has_touch"])
                        zones.append(zone)

        # Pro moduly se zónami (S/D): doplnit Major Swing HL z dependency, pokud chybí
        if zones and module_dependencies:
            _merge_major_markers_from_deps(markers, df, params, module_dependencies, tmp_dir)

        return markers, lines, zones
    finally:
        if tmp_dir and tmp_dir.exists():
            if str(tmp_dir) in sys.path:
                sys.path.remove(str(tmp_dir))
            shutil.rmtree(tmp_dir, ignore_errors=True)
        elif main_path and main_path.exists():
            main_path.unlink(missing_ok=True)


class ViewRequest(BaseModel):
    data_file: str
    years: float = 0.25
    module_code: str | None = None
    params: dict | None = None
    module_dependencies: dict[str, str] | None = None


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
                f"view_dep_{mod_name}", mod_path
            )
            dep_mod = importlib.util.module_from_spec(spec)
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
                key = (str(item["date"])[:10], t)
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
async def get_view_data(req: ViewRequest):
    """
    Load OHLC data and optionally run detect()/get_line() from module/indicator/strategy.
    Returns { ohlc: [...], markers: [...], lines: [{name, data: [...]}, ...] }.
    """
    try:
        df = _load_ohlc(req.data_file, req.years)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    ohlc = []
    for i, (ts, row) in enumerate(df.iterrows()):
        date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
        ohlc.append({
            "date": date_str,
            "open": float(row.get("open", row.get("Open", 0))),
            "high": float(row.get("high", row.get("High", 0))),
            "low": float(row.get("low", row.get("Low", 0))),
            "close": float(row.get("close", row.get("Close", 0))),
        })

    markers = []
    lines = []
    zones = []
    if req.module_code and req.module_code.strip():
        try:
            markers, lines, zones = _run_view_code(
                req.module_code.strip(),
                df,
                params=req.params or {},
                module_dependencies=req.module_dependencies,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"View error: {str(e)}")

    return {"ohlc": ohlc, "markers": markers, "lines": lines, "zones": zones}
