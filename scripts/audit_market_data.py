# -*- coding: utf-8 -*-
"""
Audit market data under data/: blank lines, NaN in OHLCV, suspicious time gaps.

Expected gaps (not reported): up to max(28 h, 4× median bar spacing); longer if the span
hits Sat/Sun, or Dec 24+ / Jan 1–2 (vánoční uzavření).

Usage:
  python scripts/audit_market_data.py
  python scripts/audit_market_data.py --data-dir /path/to/data
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

OHLCV_LOWER = ("open", "high", "low", "close", "volume")


def _data_root(cli_path: str | None) -> Path:
    if cli_path:
        return Path(cli_path).resolve()
    return Path(__file__).resolve().parent.parent / "data"


def _collect_files(root: Path) -> list[Path]:
    out: list[Path] = []
    if not root.is_dir():
        return out
    for pat in ("**/*.txt", "**/*.csv", "**/*.parquet"):
        out.extend(root.glob(pat))
    return sorted(set(out))


def _blank_lines_in_file(path: Path) -> list[int]:
    """1-based line numbers that are empty or whitespace-only (stream, bez načtení celého souboru do RAM)."""
    bad: list[int] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, start=1):
                if line.strip() == "":
                    bad.append(i)
    except OSError:
        return bad
    return bad


def _load_ohlc(path: Path) -> pd.DataFrame | None:
    suffix = path.suffix.lower()
    try:
        if suffix == ".txt":
            df = pd.read_csv(
                path,
                header=None,
                names=["Date", "Time", "open", "high", "low", "close", "volume"],
            )
            dt = pd.to_datetime(
                df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
                format="%m/%d/%Y %H:%M",
                errors="coerce",
            )
            df["datetime"] = dt
            return df
        if suffix == ".csv":
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
                    col_map[c] = "datetime_col"
                elif "volume" in l:
                    col_map[c] = "volume"
            df = df.rename(columns=col_map)
            if "datetime_col" in df.columns:
                df["datetime"] = pd.to_datetime(df["datetime_col"], errors="coerce")
            else:
                return None
            return df
        if suffix == ".parquet":
            df = pd.read_parquet(path)
            if isinstance(df.index, pd.DatetimeIndex):
                df = df.reset_index()
                if df.columns[0] != "datetime":
                    df = df.rename(columns={df.columns[0]: "datetime"})
            if "datetime" not in df.columns:
                for c in df.columns:
                    if "date" in str(c).lower():
                        df["datetime"] = pd.to_datetime(df[c], errors="coerce")
                        break
            return df
    except Exception:
        return None
    return None


def _normalize_ohlc_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    rename = {}
    for c in out.columns:
        if isinstance(c, str):
            low = c.lower()
            if low in OHLCV_LOWER or low == "datetime":
                rename[c] = low if low != "datetime" else "datetime"
    return out.rename(columns=rename)


def _interval_hits_weekend(t0: pd.Timestamp, t1: pd.Timestamp) -> bool:
    """True if (t0, t1] overlaps a Saturday or Sunday (kalendář US futures)."""
    t0 = pd.Timestamp(t0)
    t1 = pd.Timestamp(t1)
    d0 = t0.normalize()
    d1 = t1.normalize()
    span_days = (d1 - d0).days
    if span_days >= 5:
        return True
    if span_days <= 0:
        return t0.dayofweek >= 5 or t1.dayofweek >= 5
    first_sat = d0 + pd.Timedelta(days=(5 - d0.dayofweek) % 7)
    first_sun = d0 + pd.Timedelta(days=(6 - d0.dayofweek) % 7)
    return (d0 < first_sat <= d1) or (d0 < first_sun <= d1)


def _interval_covers_year_end_closure(t0: pd.Timestamp, t1: pd.Timestamp) -> bool:
    """Vánoce / Silvestr / Nový rok – typické dlouhé mezery bez so/ne v řetězci."""
    d0 = pd.Timestamp(t0).normalize()
    d1 = pd.Timestamp(t1).normalize()
    for d in pd.date_range(d0, d1, freq="D"):
        if d.month == 12 and d.day >= 24:
            return True
        if d.month == 1 and d.day <= 2:
            return True
    return False


def audit_file(path: Path) -> dict:
    rel = str(path)
    out: dict = {"file": rel, "blank_lines": [], "nan_rows": [], "datetime_na_rows": 0, "suspicious_gaps": []}

    out["blank_lines"] = _blank_lines_in_file(path)

    df = _load_ohlc(path)
    if df is None or df.empty:
        out["error"] = "load_failed_or_empty"
        return out

    df = _normalize_ohlc_columns(df)
    if "datetime" not in df.columns:
        out["error"] = "no_datetime"
        return out

    dt_na = df["datetime"].isna()
    out["datetime_na_rows"] = int(dt_na.sum())
    if dt_na.any():
        out["nan_rows"].append(
            {"column": "datetime", "count": int(dt_na.sum()), "row_indices": df.index[dt_na].tolist()[:50]}
        )

    for col in OHLCV_LOWER:
        if col not in df.columns:
            continue
        s = pd.to_numeric(df[col], errors="coerce")
        na = s.isna()
        # Rows where original was non-empty string but became NaN — still NaN
        n = int(na.sum())
        if n > 0:
            out["nan_rows"].append(
                {
                    "column": col,
                    "count": n,
                    "row_indices": df.index[na].tolist()[:50],
                }
            )

    work = df.loc[~df["datetime"].isna()].sort_values("datetime").reset_index(drop=True)
    if len(work) < 2:
        return out

    diffs = work["datetime"].diff()
    pos = diffs.iloc[1:]
    median_gap = pos.median()
    if pd.isna(median_gap) or median_gap <= pd.Timedelta(0):
        return out

    # Denní/noční pauza + zkrácené seance; až ~28 h zachytí i výjimečné „národní“ uzavření ve všední den.
    max_regular = max(pd.Timedelta(hours=28), median_gap * 4)

    for i in range(1, len(work)):
        gap = work["datetime"].iloc[i] - work["datetime"].iloc[i - 1]
        if gap <= max_regular:
            continue
        t0 = work["datetime"].iloc[i - 1]
        t1 = work["datetime"].iloc[i]
        if _interval_hits_weekend(t0, t1):
            continue
        if _interval_covers_year_end_closure(t0, t1):
            continue
        out["suspicious_gaps"].append(
            {
                "after_row_index": i,
                "prev_ts": str(t0),
                "next_ts": str(t1),
                "gap_hours": round(gap.total_seconds() / 3600, 2),
                "median_gap_minutes": round(median_gap.total_seconds() / 60, 2),
            }
        )

    out["median_bar_gap_minutes"] = round(median_gap.total_seconds() / 60, 2)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit OHLC files for blanks, NaN, gaps.")
    ap.add_argument("--data-dir", default=None, help="Data root (default: project data/)")
    ap.add_argument("--json", action="store_true", help="Print JSON per file")
    args = ap.parse_args()
    root = _data_root(args.data_dir)
    files = _collect_files(root)
    if not files:
        print(f"No .txt/.csv/.parquet under {root}", file=sys.stderr)
        return 1

    issues = 0
    for f in files:
        r = audit_file(f)
        if args.json:
            import json

            print(json.dumps(r, default=str))
            continue

        rel = Path(r["file"]).name
        bl = r.get("blank_lines") or []
        nanr = r.get("nan_rows") or []
        gaps = r.get("suspicious_gaps") or []
        err = r.get("error")

        if err:
            print(f"[{rel}] ERROR: {err}")
            issues += 1
            continue

        if bl:
            print(f"[{rel}] BLANK LINES ({len(bl)}): first -> {bl[:20]}{' ...' if len(bl) > 20 else ''}")
            issues += 1
        if r.get("datetime_na_rows", 0):
            print(f"[{rel}] INVALID DATETIME rows: {r['datetime_na_rows']}")
            issues += 1
        for nr in nanr:
            if nr["column"] == "datetime":
                continue
            print(f"[{rel}] NaN in {nr['column']}: {nr['count']} rows (sample idx: {nr.get('row_indices', [])[:10]})")
            issues += 1
        if gaps:
            med = r.get("median_bar_gap_minutes") or 30
            thr = max(180.0, float(med) * 4.0)
            print(f"[{rel}] SUSPICIOUS GAPS (>{thr:.0f}m effective, no Sat/Sun in span): {len(gaps)}")
            for g in gaps[:15]:
                print(f"    {g['prev_ts']} -> {g['next_ts']}  ({g['gap_hours']} h)")
            if len(gaps) > 15:
                print(f"    ... +{len(gaps) - 15} more")
            issues += 1
        if not bl and not nanr and not gaps and not r.get("datetime_na_rows"):
            med = r.get("median_bar_gap_minutes", "?")
            print(f"[{rel}] OK  (median gap ~{med} min)")

    if not args.json:
        print(f"\nScanned {len(files)} file(s) under {root}")
    return 0 if issues == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
