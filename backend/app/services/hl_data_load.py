"""
Native OHLC load for H/L precompute — same trimming rules as ``view_engine._load_ohlc_uncached``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd


def slice_ohlc_by_iso(df: pd.DataFrame, start_iso: str | None, end_iso: str | None) -> pd.DataFrame:
    if df.empty:
        return df
    out = df
    if start_iso and str(start_iso).strip():
        out = out[out.index >= pd.Timestamp(str(start_iso).strip())]
    if end_iso and str(end_iso).strip():
        out = out[out.index <= pd.Timestamp(str(end_iso).strip())]
    return out


def load_native_ohlc(
    data_root: Path,
    data_file: str,
    years: float,
    start_iso: str | None = None,
    end_iso: str | None = None,
) -> pd.DataFrame:
    """
    Load OHLC from ``data_root`` / ``data_file`` with traversal checks done by caller.
    ``years`` <= 0 keeps the full series after load (same as view engine).
    """
    safe_file = (data_file or "").replace("\\", "/").lstrip("/")
    if not safe_file or safe_file.startswith("../") or "/../" in safe_file:
        raise ValueError("Unsafe data_file path")
    p = (data_root / safe_file).resolve()
    if not p.is_file():
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
        col_map: dict[str, str] = {}
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
            df["volume"] = 1000.0
            try:
                df.attrs["volumeIsSyntheticPlaceholder"] = True
            except Exception:
                pass
            print(
                "[hl_data_load] CSV has no volume — synthetic volume=1000.",
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

    for need in ("open", "high", "low", "close"):
        if need not in df.columns:
            cap = need.capitalize()
            if cap in df.columns:
                df = df.rename(columns={cap: need})
            else:
                raise ValueError(f"Missing OHLC column: {need}")
    if "volume" not in df.columns:
        df["volume"] = 0.0

    y = float(years or 0.0)
    if y > 0 and len(df) > 0:
        cutoff = df.index.max() - pd.Timedelta(days=y * 365.25)
        df = df[df.index >= cutoff]
    df = slice_ohlc_by_iso(df, start_iso, end_iso)
    return df
