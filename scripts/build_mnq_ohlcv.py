#!/usr/bin/env python3
"""
Merge MNQ 1m raw text dumps into a single Parquet for the backtest app.

Input format (per line):
  YYYYMMDD HHMMSS;open;high;low;close;volume

Timestamps are interpreted as America/New_York wall clock (matches RTH bars
e.g. 20211206 140000 = Mon 14:00 NY, inside equity index futures day session).

Usage (from repo root):
  python scripts/build_mnq_ohlcv.py
  python scripts/build_mnq_ohlcv.py --max-fill-gap 10   # optional slow hole-fill
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

# Repo root = parent of scripts/
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "strategies" / "orb" / "mnq-raw"
OUT_DIR = ROOT / "data" / "futures_mnq"
OUT_FILE = OUT_DIR / "MNQ_1m.parquet"

NY = "America/New_York"


def _read_raw_txt(path: Path) -> pd.DataFrame:
    df = pd.read_csv(
        path,
        sep=";",
        header=None,
        names=["dt_raw", "open", "high", "low", "close", "volume"],
        dtype={"dt_raw": str},
    )
    ts = pd.to_datetime(df["dt_raw"].str.strip(), format="%Y%m%d %H%M%S", errors="coerce")
    # Use .values so index alignment does not null-out rows (ts is not range-aligned with df index).
    out = pd.DataFrame(
        {
            "open": pd.to_numeric(df["open"], errors="coerce").to_numpy(),
            "high": pd.to_numeric(df["high"], errors="coerce").to_numpy(),
            "low": pd.to_numeric(df["low"], errors="coerce").to_numpy(),
            "close": pd.to_numeric(df["close"], errors="coerce").to_numpy(),
            "volume": pd.to_numeric(df["volume"], errors="coerce").to_numpy(),
        },
        index=ts,
    )
    return out[~out.index.isna()].sort_index()


def _merge_files(paths: list[Path]) -> tuple[pd.DataFrame, int]:
    parts = [_read_raw_txt(p) for p in paths]
    df = pd.concat(parts, axis=0).sort_index()
    dup_n = int(df.index.duplicated().sum())
    df = df[~df.index.duplicated(keep="last")]
    df = df.dropna(subset=["open", "high", "low", "close"], how="any")
    return df, dup_n


def _localize_ny(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    naive = idx.tz_localize(None)
    return naive.tz_localize(NY, ambiguous="infer", nonexistent="shift_forward")


def _gap_fill_doji(df: pd.DataFrame, max_fill_minutes: int) -> pd.DataFrame:
    """Insert O=H=L=C=previous close, volume=0 for missing minutes (same NY date, small gaps only)."""
    if df.empty or max_fill_minutes <= 1:
        return df
    idx = df.index
    out_times: list[pd.Timestamp] = []
    out_o: list[float] = []
    out_h: list[float] = []
    out_l: list[float] = []
    out_c: list[float] = []
    out_v: list[float] = []
    for i in range(len(df)):
        if i > 0:
            prev_ts = idx[i - 1]
            cur_ts = idx[i]
            delta_m = (cur_ts - prev_ts).total_seconds() / 60.0
            if 1.0 < delta_m <= float(max_fill_minutes):
                gap_n = int(delta_m) - 1
                pc = float(df["close"].iloc[i - 1])
                t_ins = prev_ts + pd.Timedelta(minutes=1)
                for _ in range(max(0, gap_n)):
                    if t_ins >= cur_ts:
                        break
                    if t_ins.date() != prev_ts.date():
                        break
                    out_times.append(t_ins)
                    out_o.append(pc)
                    out_h.append(pc)
                    out_l.append(pc)
                    out_c.append(pc)
                    out_v.append(0.0)
                    t_ins = t_ins + pd.Timedelta(minutes=1)
        out_times.append(idx[i])
        out_o.append(float(df["open"].iloc[i]))
        out_h.append(float(df["high"].iloc[i]))
        out_l.append(float(df["low"].iloc[i]))
        out_c.append(float(df["close"].iloc[i]))
        out_v.append(float(df["volume"].iloc[i]))
    out = pd.DataFrame(
        {"open": out_o, "high": out_h, "low": out_l, "close": out_c, "volume": out_v},
        index=pd.DatetimeIndex(out_times),
    )
    return out.sort_index().loc[~out.index.duplicated(keep="last")]


def _rth_hour_histogram(idx: pd.DatetimeIndex) -> str:
    if len(idx) == 0:
        return "NY-hour in [9..16]: n/a (empty index)"
    hours = idx.hour
    rthish = ((hours >= 9) & (hours <= 16)).mean()
    return f"NY-hour in [9..16]: {100.0 * rthish:.1f}% of bars (expect majority for US futures day data)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--max-fill-gap",
        type=int,
        default=0,
        help="If >1, synthesize 1m flat bars for gaps of 2..N minutes (same NY date). Default 0 = off (large datasets).",
    )
    args = ap.parse_args()

    paths = sorted(RAW_DIR.glob("MNQ*.txt"))
    if not paths:
        raise SystemExit(f"No raw files in {RAW_DIR}")

    df, dup_n = _merge_files(paths)
    df.index = _localize_ny(pd.DatetimeIndex(df.index))
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]

    print(f"Files: {len(paths)}  Rows: {len(df)}  Duplicates_dropped_when_merging: {dup_n}")
    print(_rth_hour_histogram(df.index))

    if args.max_fill_gap > 1:
        df = _gap_fill_doji(df, args.max_fill_gap)
        print(f"After gap-fill (max {args.max_fill_gap} min): {len(df)} rows")

    # UTC-naive index for Backtrader/engine compatibility; ORB session logic uses America/New_York anyway.
    df.index = df.index.tz_convert("UTC").tz_localize(None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_FILE, index=True)
    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
