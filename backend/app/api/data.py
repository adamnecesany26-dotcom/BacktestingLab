"""
GET /data - returns available instruments and date ranges.
Includes broker config (tick, mult, margin) per instrument for futures.
"""

from fastapi import APIRouter
from pathlib import Path
import json
import pandas as pd

router = APIRouter()
_DATA_CACHE: dict[str, object] = {"signature": None, "payload": None}

FUTURES_SYMBOL_METADATA: dict[str, str] = {
    "NQ": "Nasdaq-100 E-mini",
    "ES": "S&P 500 E-mini",
    "CL": "Crude Oil WTI",
    "GC": "Gold",
    "EU": "Euro FX",
    "BP": "British Pound",
    "JY": "Japanese Yen",
    "FV": "US 5Y Treasury Note",
    "TY": "US 10Y Treasury Note",
    "US": "US 30Y Treasury Bond",
}


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
    if (primary / "mock").exists() or (primary / "futures_30m").exists():
        return primary
    # Fallback when backend runs from different cwd (e.g. project root)
    for candidate in [Path.cwd() / "data", Path.cwd().parent / "data"]:
        if (candidate / "mock").exists() or (candidate / "futures_30m").exists():
            return candidate
    return primary


def _load_market_data_preview(f: Path) -> pd.DataFrame:
    suffix = f.suffix.lower()
    if suffix == ".txt":
        df = pd.read_csv(
            f,
            header=None,
            names=["Date", "Time", "Open", "High", "Low", "Close", "Volume"],
        )
        dt = pd.to_datetime(
            df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
            format="%m/%d/%Y %H:%M",
            errors="coerce",
        )
        df["datetime"] = dt
        return df.dropna(subset=["datetime"])
    if suffix == ".csv":
        df = pd.read_csv(f)
        date_col = "Date" if "Date" in df.columns else "date" if "date" in df.columns else None
        if not date_col:
            return pd.DataFrame()
        if "Time" in df.columns or "time" in df.columns:
            time_col = "Time" if "Time" in df.columns else "time"
            dt = pd.to_datetime(
                df[date_col].astype(str).str.strip() + " " + df[time_col].astype(str).str.strip(),
                errors="coerce",
            )
        else:
            dt = pd.to_datetime(df[date_col], errors="coerce")
        df["datetime"] = dt
        return df.dropna(subset=["datetime"])
    return pd.DataFrame()


def _process_market_file_to_instrument(
    f: Path,
    file_prefix: str,
    instrument_type: str,
    timeframe: str,
    broker_config: dict,
) -> dict | None:
    """Parse market data file and return instrument item with instrumentType/timeframe."""
    try:
        full = _load_market_data_preview(f)
        if full.empty or "datetime" not in full.columns:
            return None
        min_d = full["datetime"].min()
        max_d = full["datetime"].max()
        years = max((max_d - min_d).total_seconds() / (365.25 * 24 * 60 * 60), 0.0)
        name = f.stem
        parts = name.split("_")
        instrument = (parts[0] if parts else name).upper()
        display_name = FUTURES_SYMBOL_METADATA.get(instrument, instrument)
        item = {
            "instrument": instrument,
            "displayName": display_name,
            "timeframe": timeframe,
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


def _build_data_signature(data_dir: Path) -> tuple:
    files: list[Path] = []
    mock_dir = data_dir / "mock"
    futures_30m_dir = data_dir / "futures_30m"
    if mock_dir.exists():
        files.extend(mock_dir.rglob("*.csv"))
    if futures_30m_dir.exists():
        files.extend(futures_30m_dir.glob("*.txt"))
    files = sorted(files)
    return tuple((str(f.relative_to(data_dir)), int(f.stat().st_mtime_ns)) for f in files)


@router.get("/data/debug")
async def get_data_debug():
    """Diagnostic: returns data path and whether mock dir exists."""
    data_dir = _get_data_dir()
    mock_dir = data_dir / "mock"
    futures_30m_dir = data_dir / "futures_30m"
    csv_files = list(mock_dir.glob("*.csv")) if mock_dir.exists() else []
    txt_files = list(futures_30m_dir.glob("*.txt")) if futures_30m_dir.exists() else []
    return {
        "data_dir": str(data_dir.absolute()),
        "mock_exists": mock_dir.exists(),
        "futures_30m_exists": futures_30m_dir.exists(),
        "csv_count": len(csv_files),
        "txt_count": len(txt_files),
        "csv_files": [f.name for f in csv_files[:20]],
        "txt_files": [f.name for f in txt_files[:20]],
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
    futures_30m_dir = data_dir / "futures_30m"
    if not mock_dir.exists() and not futures_30m_dir.exists():
        return {"instruments": results}
    signature = _build_data_signature(data_dir)
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
                item = _process_market_file_to_instrument(f, f"mock/{subdir}/", inst_type, "1d", broker_config)
                if item:
                    seen_files.add(key)
                    results.append(item)

    # Root mock/*.csv → futures (backward compatibility)
    for f in mock_dir.glob("*.csv"):
        if f.name in seen_files:
            continue
        item = _process_market_file_to_instrument(f, "mock/", "futures", "1d", broker_config)
        if item:
            seen_files.add(f.name)
            results.append(item)

    if futures_30m_dir.exists():
        for f in futures_30m_dir.glob("*.txt"):
            key = f"futures_30m/{f.name}"
            if key in seen_files:
                continue
            item = _process_market_file_to_instrument(f, "futures_30m/", "futures", "30m", broker_config)
            if item:
                seen_files.add(key)
                results.append(item)

    payload = {"instruments": results}
    _DATA_CACHE["signature"] = signature
    _DATA_CACHE["payload"] = payload
    return payload
