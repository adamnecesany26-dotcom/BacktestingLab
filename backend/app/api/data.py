"""
GET /data - returns available instruments and date ranges.
Includes broker config (tick, mult, margin) per instrument for futures.
"""

from fastapi import APIRouter
from pathlib import Path
from datetime import datetime
import json
import pandas as pd

router = APIRouter()
_DATA_CACHE: dict[str, object] = {"signature": None, "payload": None}


def _load_broker_config() -> dict:
    """Load broker_config.json - maps instrument -> tick_size, mult, margin, etc."""
    backend_root = Path(__file__).resolve().parent.parent.parent
    data_dir = backend_root.parent / "data"
    config_path = data_dir / "broker_config.json"
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _get_data_dir() -> Path:
    # data.py is in backend/app/api/ -> parent.parent.parent = backend
    backend_root = Path(__file__).resolve().parent.parent.parent
    primary = backend_root.parent / "data"  # project root / data
    if (primary / "mock").exists():
        return primary
    # Fallback when backend runs from different cwd (e.g. project root)
    for candidate in [Path.cwd() / "data", Path.cwd().parent / "data"]:
        if (candidate / "mock").exists():
            return candidate
    return primary


def _process_csv_to_instrument(
    f: Path,
    file_prefix: str,
    instrument_type: str,
    broker_config: dict,
) -> dict | None:
    """Parse CSV and return instrument item with instrumentType."""
    try:
        df = pd.read_csv(f, nrows=1)
        if "Date" not in df.columns and "date" not in df.columns:
            return None
        full = pd.read_csv(f)
        date_col = "Date" if "Date" in full.columns else "date"
        full[date_col] = pd.to_datetime(full[date_col])
        min_d = full[date_col].min()
        max_d = full[date_col].max()
        years = (max_d - min_d).days / 365.25
        name = f.stem  # e.g. NQ_5Y
        parts = name.split("_")
        instrument = parts[0] if parts else name
        item = {
            "instrument": instrument,
            "timeframe": "1d",
            "file": f"{file_prefix}{f.name}",
            "minDate": min_d.strftime("%Y-%m-%d"),
            "maxDate": max_d.strftime("%Y-%m-%d"),
            "yearsAvailable": round(years, 1),
            "instrumentType": instrument_type,
        }
        if instrument in broker_config and "mult" in broker_config[instrument]:
            item["brokerConfig"] = broker_config[instrument]
        return item
    except Exception:
        return None


def _build_data_signature(mock_dir: Path) -> tuple:
    files = sorted(mock_dir.rglob("*.csv"))
    return tuple((str(f.relative_to(mock_dir)), int(f.stat().st_mtime_ns)) for f in files)


@router.get("/data/debug")
async def get_data_debug():
    """Diagnostic: returns data path and whether mock dir exists."""
    data_dir = _get_data_dir()
    mock_dir = data_dir / "mock"
    csv_files = list(mock_dir.glob("*.csv")) if mock_dir.exists() else []
    return {
        "data_dir": str(data_dir.absolute()),
        "mock_exists": mock_dir.exists(),
        "csv_count": len(csv_files),
        "csv_files": [f.name for f in csv_files[:20]],
    }


@router.get("/data")
async def get_available_data():
    """
    Scan data folder for available instruments.
    Returns list of { instrument, timeframe, minDate, maxDate, yearsAvailable, instrumentType, brokerConfig }.
    instrumentType from folder: mock/*.csv → futures, mock/futures/ → futures, mock/stocks/ → stocks, mock/forex/ → forex.
    brokerConfig: { tick_size, tick_value, mult, margin, commission_per_contract } for futures.
    """
    data_dir = _get_data_dir()
    broker_config = _load_broker_config()
    results = []
    seen_files: set[str] = set()

    mock_dir = data_dir / "mock"
    if not mock_dir.exists():
        return {"instruments": results}
    signature = _build_data_signature(mock_dir)
    if _DATA_CACHE.get("signature") == signature and _DATA_CACHE.get("payload") is not None:
        return _DATA_CACHE["payload"]

    # Scan subfolders by type: mock/futures/, mock/stocks/, mock/forex/
    for subdir, inst_type in [("futures", "futures"), ("stocks", "stocks"), ("forex", "forex")]:
        sub_path = mock_dir / subdir
        if sub_path.exists():
            for f in sub_path.glob("*.csv"):
                key = f"{subdir}/{f.name}"
                if key in seen_files:
                    continue
                item = _process_csv_to_instrument(f, f"mock/{subdir}/", inst_type, broker_config)
                if item:
                    seen_files.add(key)
                    results.append(item)

    # Root mock/*.csv → futures (backward compatibility)
    for f in mock_dir.glob("*.csv"):
        if f.name in seen_files:
            continue
        item = _process_csv_to_instrument(f, "mock/", "futures", broker_config)
        if item:
            seen_files.add(f.name)
            results.append(item)

    payload = {"instruments": results}
    _DATA_CACHE["signature"] = signature
    _DATA_CACHE["payload"] = payload
    return payload
