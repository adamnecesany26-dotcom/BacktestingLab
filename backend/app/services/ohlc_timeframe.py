"""Shared timeframe inference + OHLCV resample (runner + view_engine + engine parity)."""

from __future__ import annotations

import pandas as pd

TF_TO_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
    "1w": 10080,
    "1M": 43200,
}

TF_TO_PANDAS_RULE = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1D",
    "1w": "1W",
    "1M": "1ME",
}


def normalize_tf(value: str | None) -> str | None:
    if value is None:
        return None
    tf = str(value).strip()
    if not tf:
        return None
    low = tf.lower()
    aliases = {
        "1min": "1m",
        "1minute": "1m",
        "5min": "5m",
        "15min": "15m",
        "30min": "30m",
        "60min": "1h",
        "1hour": "1h",
        "4hour": "4h",
        "day": "1d",
        "daily": "1d",
        "week": "1w",
        "weekly": "1w",
        "month": "1M",
        "monthly": "1M",
    }
    if low in aliases:
        return aliases[low]
    if tf in TF_TO_MINUTES:
        return tf
    if low in TF_TO_MINUTES:
        return low
    return tf


def infer_data_timeframe(df: pd.DataFrame) -> str | None:
    if df is None or len(df) < 2 or not isinstance(df.index, pd.DatetimeIndex):
        return None
    diffs = pd.Series(df.index).diff().dropna()
    if len(diffs) == 0:
        return None
    minutes = diffs.median().total_seconds() / 60.0
    if minutes <= 1.5:
        return "1m"
    if minutes <= 7:
        return "5m"
    if minutes <= 22:
        return "15m"
    if minutes <= 45:
        return "30m"
    if minutes <= 90:
        return "1h"
    if minutes <= 300:
        return "4h"
    if minutes <= 1500:
        return "1d"
    if minutes <= 11000:
        return "1w"
    return "1M"


def should_resample(source_tf: str | None, target_tf: str | None) -> bool:
    src = normalize_tf(source_tf)
    tgt = normalize_tf(target_tf)
    if not src or not tgt:
        return False
    src_m = TF_TO_MINUTES.get(src)
    tgt_m = TF_TO_MINUTES.get(tgt)
    if src_m is None or tgt_m is None:
        return False
    return tgt_m > src_m


def resample_ohlcv(df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    target = normalize_tf(target_tf)
    if not target:
        return df
    rule = TF_TO_PANDAS_RULE.get(target)
    if not rule or df is None or len(df) == 0:
        return df
    open_col = "open" if "open" in df.columns else "Open"
    high_col = "high" if "high" in df.columns else "High"
    low_col = "low" if "low" in df.columns else "Low"
    close_col = "close" if "close" in df.columns else "Close"
    agg = {
        open_col: "first",
        high_col: "max",
        low_col: "min",
        close_col: "last",
    }
    if "volume" in df.columns:
        agg["volume"] = "sum"
    use_right = target in ("1w", "1M")
    out = (
        df.resample(
            rule,
            label="right" if use_right else "left",
            closed="right" if use_right else "left",
        )
        .agg(agg)
        .dropna(how="any")
    )
    return out


def iso_or_str(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    try:
        return pd.Timestamp(value).isoformat()
    except Exception:
        return str(value)
