"""
OHLC dataset helpers: Polars-first metadata + numpy views for fast paths.
Pandas remains in the Backtrader engine; this module supports feature cache / Numba pipelines.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import polars as pl
except ImportError:  # pragma: no cover
    pl = None  # type: ignore


def fingerprint_parquet(path: Path) -> str:
    """
    Stable cache key fragment for a file on disk (no full scan).
    Uses size + mtime + name — sufficient for local single-user cache invalidation.
    """
    return fingerprint_dataset_file(path)


def fingerprint_dataset_file(path: Path) -> str:
    """Same as legacy name `fingerprint_parquet` — works for CSV/txt/parquet (no content read)."""
    p = path.resolve()
    st = p.stat()
    raw = f"{p.name}\x00{st.st_size}\x00{int(st.st_mtime_ns)}".encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:24]


def resolve_safe_data_path(data_dir: Path, data_file: str) -> Path | None:
    """
    Resolve `data_file` relative to `data_dir` with traversal protection.
    Returns None if missing or unsafe.
    """
    if not (data_file or "").strip():
        return None
    rel = str(data_file).replace("\\", "/").lstrip("/")
    if not rel or rel.startswith("../") or "/../" in rel:
        return None
    root = data_dir.resolve()
    p = (root / rel).resolve()
    try:
        p.relative_to(root)
    except ValueError:
        return None
    if not p.is_file():
        return None
    return p


def parse_iso_timestamp_for_index(idx: pd.DatetimeIndex, iso_s: str | None) -> pd.Timestamp | None:
    """
    Parsuje ISO z artefaktů tak, aby šel porovnat a použít v ``searchsorted`` na ``idx``.

    ``futures_30m/*.txt`` dává typicky **tz-naive** index; v Parquet mohou být časy s offsetem/Z.
    Přímo ``idx.min() <= pd.Timestamp(iso)`` pak hodí **TypeError** → dříve HTTP 500 na ``/api/view``.
    """
    if idx is None or idx.empty or iso_s is None:
        return None
    raw = str(iso_s).strip()
    if not raw:
        return None
    try:
        ts = pd.Timestamp(raw)
    except Exception:
        return None
    if pd.isna(ts):
        return None
    idx_tz = getattr(idx, "tz", None)
    if idx_tz is None:
        if ts.tzinfo is not None:
            try:
                ts = ts.tz_convert("UTC")
            except Exception:
                return None
            try:
                ts = pd.Timestamp(
                    ts.year,
                    ts.month,
                    ts.day,
                    ts.hour,
                    ts.minute,
                    ts.second,
                    ts.microsecond,
                )
            except Exception:
                return None
        return ts
    if ts.tzinfo is None:
        try:
            return ts.tz_localize("UTC").tz_convert(idx_tz)
        except Exception:
            try:
                return ts.tz_localize(idx_tz, ambiguous=True, nonexistent="shift_forward")
            except Exception:
                return None
    try:
        return ts.tz_convert(idx_tz)
    except Exception:
        return None


def polars_scan_ohlc_schema(path: Path) -> dict[str, str] | None:
    """Return column names -> dtypes string from lazy scan (cheap)."""
    if pl is None or not path.is_file():
        return None
    try:
        lf = pl.scan_parquet(str(path))
        return {n: str(t) for n, t in lf.collect_schema().items()}
    except Exception:
        return None


def ohlcv_to_numpy_columns(
    dates_ms: np.ndarray,
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Struct-of-arrays bundle (float64 OHLC, int64 ms timestamps)."""
    out: dict[str, np.ndarray] = {
        "time_ms": np.asarray(dates_ms, dtype=np.int64),
        "open": np.asarray(open_, dtype=np.float64),
        "high": np.asarray(high, dtype=np.float64),
        "low": np.asarray(low, dtype=np.float64),
        "close": np.asarray(close, dtype=np.float64),
    }
    if volume is not None:
        out["volume"] = np.asarray(volume, dtype=np.float64)
    return out


def load_parquet_ohlc_numpy(path: Path) -> dict[str, np.ndarray] | None:
    """
    Load OHLCV via Polars into contiguous numpy arrays.
    Expects columns open/high/low/close (case-insensitive) and a datetime column or index.
    """
    if pl is None or not path.is_file():
        return None
    try:
        df = pl.read_parquet(str(path))
    except Exception:
        return None
    cols = {c.lower(): c for c in df.columns}
    for need in ("open", "high", "low", "close"):
        if need not in cols:
            return None
    dt_col = None
    for candidate in ("date", "datetime", "time", "timestamp"):
        if candidate in cols:
            dt_col = cols[candidate]
            break
    if dt_col is None:
        return None
    t = df[dt_col].cast(pl.Datetime(time_unit="ms")).dt.timestamp("ms").to_numpy()
    o = df[cols["open"]].cast(pl.Float64).to_numpy()
    h = df[cols["high"]].cast(pl.Float64).to_numpy()
    l = df[cols["low"]].cast(pl.Float64).to_numpy()
    c = df[cols["close"]].cast(pl.Float64).to_numpy()
    vol = None
    if "volume" in cols:
        vol = df[cols["volume"]].cast(pl.Float64).to_numpy()
    return ohlcv_to_numpy_columns(t, o, h, l, c, vol)
