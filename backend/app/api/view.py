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
    code: str, df: pd.DataFrame, params: dict | None = None
) -> tuple[list[dict], list[dict]]:
    """
    Execute detect(ohlc) and/or get_line(ohlc) from module/indicator/strategy.
    Returns (markers, lines).

    MODULE / INDICATOR / STRATEGIE – všechny používají stejné rozhraní:

    # Markery (bodové značky – H/L, swing points, signály):
    def detect(ohlc: pd.DataFrame) -> list[dict]:
        return [{"date": "YYYY-MM-DD", "type": "high"|"low"|"signal", "value": float}, ...]

    # Čáry (indikátory – EMA, RSI, atd.):
    def get_line(ohlc: pd.DataFrame) -> list[dict] | dict:
        # Vrátí buď [{date, value}, ...] nebo {name: str, data: [{date, value}, ...]}
        return [{"date": "YYYY-MM-DD", "value": float}, ...]
        # nebo pro více čar: {"EMA20": [...], "EMA50": [...]}
    """
    import tempfile
    import importlib.util
    import sys

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(code)
        tmp_path = f.name

    try:
        spec = importlib.util.spec_from_file_location("view_module", tmp_path)
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
                    if isinstance(data, list):
                        pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in data if isinstance(p, dict)]
                    elif isinstance(data, dict) and "data" in data:
                        pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in data["data"] if isinstance(p, dict)]
                        color = data.get("color")
                    if pts:
                        line_obj = {"name": str(name), "data": pts}
                        if color:
                            line_obj["color"] = str(color)
                        lines.append(line_obj)
            elif isinstance(result, list):
                pts = [{"date": str(p.get("date", ""))[:10], "value": float(p.get("value", 0))} for p in result if isinstance(p, dict)]
                if pts:
                    lines.append({"name": "line", "data": pts})

        return markers, lines
    finally:
        Path(tmp_path).unlink(missing_ok=True)


class ViewRequest(BaseModel):
    data_file: str
    years: float = 0.25
    module_code: str | None = None
    params: dict | None = None


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
    if req.module_code and req.module_code.strip():
        try:
            markers, lines = _run_view_code(
                req.module_code.strip(), df, params=req.params or {}
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"View error: {str(e)}")

    return {"ohlc": ohlc, "markers": markers, "lines": lines}
