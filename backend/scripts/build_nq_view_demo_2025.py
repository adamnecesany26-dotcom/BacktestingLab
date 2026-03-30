"""
Vyřeže z futures_30m/NQ.txt kalendářní rok 2025 a zapíše Parquet pro View demo.

Výstup: data/futures_30m/nq_view_demo_2025.parquet (datetime index, open/high/low/close/volume).
Spusť z kořene repa: python backend/scripts/build_nq_view_demo_2025.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
SRC = REPO_ROOT / "data" / "futures_30m" / "NQ.txt"
OUT = REPO_ROOT / "data" / "futures_30m" / "nq_view_demo_2025.parquet"
YEAR_START = pd.Timestamp("2025-01-01", tz=None)
YEAR_END = pd.Timestamp("2025-12-31 23:59:59", tz=None)


def main() -> int:
    if not SRC.exists():
        print(f"Missing source: {SRC}", file=sys.stderr)
        return 1
    df = pd.read_csv(
        SRC,
        header=None,
        names=["Date", "Time", "open", "high", "low", "close", "volume"],
    )
    dt = pd.to_datetime(
        df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
        format="%m/%d/%Y %H:%M",
        errors="coerce",
    )
    df["datetime"] = dt
    df = df.dropna(subset=["datetime"])
    df = df.set_index("datetime").sort_index()
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"])
    mask = (df.index >= YEAR_START) & (df.index <= YEAR_END)
    out = df.loc[mask, ["open", "high", "low", "close", "volume"]]
    if out.empty:
        print("No rows in 2025 range — check NQ.txt coverage.", file=sys.stderr)
        return 2
    out.to_parquet(OUT, index=True)
    print(f"Wrote {len(out)} bars to {OUT} ({out.index.min()} .. {out.index.max()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
