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
    return backend_root.parent / "data"  # project root / data


@router.get("/data")
async def get_available_data():
    """
    Scan data folder for available instruments.
    Returns list of { instrument, timeframe, minDate, maxDate, yearsAvailable, brokerConfig }.
    brokerConfig: { tick_size, tick_value, mult, margin, commission_per_contract } for futures.
    """
    data_dir = _get_data_dir()
    broker_config = _load_broker_config()
    results = []

    mock_dir = data_dir / "mock"
    if mock_dir.exists():
        for f in mock_dir.glob("*.csv"):
            try:
                df = pd.read_csv(f, nrows=1)
                if "Date" in df.columns or "date" in df.columns:
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
                        "file": f"mock/{f.name}",
                        "minDate": min_d.strftime("%Y-%m-%d"),
                        "maxDate": max_d.strftime("%Y-%m-%d"),
                        "yearsAvailable": round(years, 1),
                    }
                    if instrument in broker_config and "mult" in broker_config[instrument]:
                        item["brokerConfig"] = broker_config[instrument]
                    results.append(item)
            except Exception:
                pass

    return {"instruments": results}
