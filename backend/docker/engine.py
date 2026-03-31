"""
Backtest engine — runs on the host (subprocess or in-process from FastAPI).

1. Loads strategy from STRATEGY_PATH (strategy dir on sys.path for modules.*)
2. Loads dataset from DATA_PATH / DATA_FILE
3. Initializes Backtrader, runs strategy, computes metrics
4. CLI: prints JSON to stdout; library: use execute_backtest_from_environ() → dict
"""

import importlib.util
import inspect
import json
import hashlib
import itertools
import math
import os
import pickle
import random
import sys
import threading
import time
import datetime as dt
from pathlib import Path

# Strategy directory is prepended in execute_backtest_from_environ() / main() so in-process runs
# see the correct STRATEGY_PATH (subprocess still sets env before Python starts).

# Early stderr so the host sees activity while heavy deps import (cold start can take 10–60s on slow disks/CPU).
print(
    "[engine] Booting — loading backtrader / pandas (first container start may be slow)...",
    file=sys.stderr,
    flush=True,
)
import backtrader as bt
import pandas as pd
print("[engine] Libraries loaded.", file=sys.stderr, flush=True)

try:
    from app.services.sd_feature_pipeline import get_sd_zones_cached as _get_sd_zones_cached_engine
except ImportError:
    _get_sd_zones_cached_engine = None

from app.services.sd_zone_merge import build_merged_sd_zones, parse_zone_timeframes_dict

# In-process progress: runner sets callback on this thread-local before execute_backtest_from_environ().
_ENGINE_PROGRESS_LOCAL = threading.local()


def set_engine_progress_callback(fn):
    """Register ``fn(pct: int)`` (0–99) for SSE progress when engine runs in-process."""
    _ENGINE_PROGRESS_LOCAL.fn = fn


def clear_engine_progress_callback():
    if hasattr(_ENGINE_PROGRESS_LOCAL, "fn"):
        delattr(_ENGINE_PROGRESS_LOCAL, "fn")


def _emit_engine_progress(pct: int) -> None:
    fn = getattr(_ENGINE_PROGRESS_LOCAL, "fn", None)
    if fn is None:
        return
    try:
        fn(int(pct))
    except Exception:
        pass


# In-process runs: runner sets a thread-local overlay so we never mutate os.environ (P1-3).
_ENGINE_ENV_LOCAL = threading.local()


def set_engine_run_environ(overlay: dict[str, str] | None) -> None:
    """Apply per-thread env overlay. Subprocess/CLI runs leave overlay unset → real os.environ."""
    if overlay is None:
        if hasattr(_ENGINE_ENV_LOCAL, "overlay"):
            delattr(_ENGINE_ENV_LOCAL, "overlay")
        return
    _ENGINE_ENV_LOCAL.overlay = {str(k): "" if v is None else str(v) for k, v in overlay.items()}


def clear_engine_run_environ() -> None:
    set_engine_run_environ(None)


def _eget(key: str, default: str = "") -> str:
    ov = getattr(_ENGINE_ENV_LOCAL, "overlay", None)
    if ov is not None and key in ov:
        return ov[key]
    return os.environ.get(key, default)


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


def _safe_iso(dt) -> str:
    if dt is None:
        return ""
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _iso_or_str(value) -> str:
    """Normalize datetime-like values to full ISO string without truncation."""
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    try:
        ts = pd.Timestamp(value)
        return ts.isoformat()
    except Exception:
        return str(value)


def _module_line_point(p) -> dict | None:
    if not isinstance(p, dict) or "date" not in p:
        return None
    pt: dict = {"date": _iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
    st = p.get("state")
    if st is not None:
        pt["state"] = str(st)
    sc = p.get("score")
    if sc is not None:
        try:
            pt["score"] = float(sc)
        except (TypeError, ValueError):
            pass
    return pt


def _compute_trade_excursions(
    data: pd.DataFrame,
    dt_open,
    dt_close,
    entry_price: float,
    is_long: bool,
) -> tuple[float, float, float, float]:
    """
    Return (mfe, mae, mfe_pct, mae_pct) for one closed trade.
    MFE/MAE are always positive magnitudes in price units.
    """
    if entry_price <= 0:
        return 0.0, 0.0, 0.0, 0.0
    if dt_open is None or dt_close is None or data.empty:
        return 0.0, 0.0, 0.0, 0.0

    try:
        d0 = pd.Timestamp(dt_open)
        d1 = pd.Timestamp(dt_close)
        if d1 < d0:
            d0, d1 = d1, d0
        window = data[(data.index >= d0) & (data.index <= d1)]
        if window.empty:
            return 0.0, 0.0, 0.0, 0.0
        high_col = "high" if "high" in window.columns else "High"
        low_col = "low" if "low" in window.columns else "Low"
        high_max = float(window[high_col].max())
        low_min = float(window[low_col].min())

        if is_long:
            mfe = max(0.0, high_max - entry_price)
            mae = max(0.0, entry_price - low_min)
        else:
            mfe = max(0.0, entry_price - low_min)
            mae = max(0.0, high_max - entry_price)

        mfe_pct = (mfe / entry_price) * 100.0
        mae_pct = (mae / entry_price) * 100.0
        return mfe, mae, mfe_pct, mae_pct
    except Exception:
        return 0.0, 0.0, 0.0, 0.0


def _normalize_tf(value: str | None) -> str | None:
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


def _timeframe_hint_periods_per_year(tf_raw: str | None) -> float | None:
    """Bars-per-year from configured timeframe (manifest), for robust risk annualization (P3-5)."""
    if not tf_raw or not str(tf_raw).strip():
        return None
    key = _normalize_tf(str(tf_raw).strip()) or str(tf_raw).strip().lower()
    minutes = TF_TO_MINUTES.get(key)
    if minutes is None:
        low = key.lower()
        minutes = TF_TO_MINUTES.get(low)
    if minutes is None or float(minutes) <= 0:
        return None
    return float(max(1.0, (365.25 * 24.0 * 60.0) / float(minutes)))


_LAST_DATA_CACHE_PRUNE_MONO: float = 0.0


def _maybe_prune_backtest_disk_cache(cache_dir: Path | None) -> None:
    """Optional TTL / total-size cap for dataset + feature files under DATA_CACHE_PATH (P3-3)."""
    global _LAST_DATA_CACHE_PRUNE_MONO
    if cache_dir is None or not cache_dir.is_dir():
        return
    try:
        max_age_days = float(_eget("CACHE_DATASET_MAX_AGE_DAYS", "0") or 0)
        max_mb = float(_eget("CACHE_DATASET_MAX_TOTAL_MB", "0") or 0)
    except ValueError:
        return
    if max_age_days <= 0 and max_mb <= 0:
        return
    now = time.monotonic()
    if now - _LAST_DATA_CACHE_PRUNE_MONO < 120.0:
        return
    _LAST_DATA_CACHE_PRUNE_MONO = now
    try:
        files = [p for p in cache_dir.rglob("*") if p.is_file()]
        if max_age_days > 0:
            cutoff = time.time() - max_age_days * 86400.0
            for p in files:
                try:
                    if p.stat().st_mtime < cutoff:
                        p.unlink(missing_ok=True)
                except OSError:
                    pass
            files = [p for p in cache_dir.rglob("*") if p.is_file()]
        if max_mb > 0:
            files.sort(key=lambda x: x.stat().st_mtime)
            total = sum(p.stat().st_size for p in files)
            limit_b = max_mb * 1024 * 1024
            i = 0
            while total > limit_b and i < len(files):
                p = files[i]
                try:
                    st = p.stat()
                    p.unlink(missing_ok=True)
                    total -= st.st_size
                except OSError:
                    pass
                i += 1
    except Exception:
        pass


def _infer_data_timeframe(df: pd.DataFrame) -> str | None:
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


def _should_resample(source_tf: str | None, target_tf: str | None) -> bool:
    src = _normalize_tf(source_tf)
    tgt = _normalize_tf(target_tf)
    if not src or not tgt:
        return False
    src_m = TF_TO_MINUTES.get(src)
    tgt_m = TF_TO_MINUTES.get(tgt)
    if src_m is None or tgt_m is None:
        return False
    return tgt_m > src_m


def _parse_strategy_zone_timeframes(strategy_params: dict | None) -> list[str]:
    """Match sd_zone_strategy: zone_timeframes (CSV / list / JSON list string), else zone_timeframe."""
    return parse_zone_timeframes_dict(strategy_params if isinstance(strategy_params, dict) else None)


def _coarsest_zone_tf_for_chart(timeframes: list[str]) -> str | None:
    """Largest bar size among zone_timeframes (for moduleOutputs resampling)."""
    if not timeframes:
        return None
    best_tf: str | None = None
    best_m = -1
    for raw in timeframes:
        key = _normalize_tf(str(raw)) or str(raw).strip()
        m = TF_TO_MINUTES.get(key)
        if m is None:
            continue
        if m > best_m:
            best_m = m
            best_tf = key
    return best_tf or str(timeframes[0]).strip()


def _resample_ohlcv(df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    target = _normalize_tf(target_tf)
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


def _compute_equity_stats(equity_curve: list[float]) -> tuple[float, float, float]:
    """
    Return (max_equity, max_drawdown_pct, max_drawdown_usd) computed from equity curve.
    """
    if not equity_curve:
        return 0.0, 0.0, 0.0
    peak = float(equity_curve[0])
    max_equity = peak
    max_dd_pct = 0.0
    max_dd_usd = 0.0
    for v in equity_curve:
        value = float(v)
        if value > peak:
            peak = value
        if value > max_equity:
            max_equity = value
        if peak > 0:
            dd_usd = peak - value
            dd_pct = (dd_usd / peak) * 100.0
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct
            if dd_usd > max_dd_usd:
                max_dd_usd = dd_usd
    return max_equity, max_dd_pct, max_dd_usd


def _compute_drawdown_analysis(equity_curve_with_dates: list[dict]) -> dict:
    """Extended drawdown metrics: duration, time-to-recovery, underwater integral. O(n) single-pass."""
    empty: dict = {
        "maxDurationBars": 0,
        "maxDurationDays": None,
        "timeToRecoveryBars": None,
        "timeToRecoveryDays": None,
        "underwaterPct": 0.0,
        "avgDurationBars": 0.0,
        "currentDrawdownPct": 0.0,
        "periodsCount": 0,
    }
    if not equity_curve_with_dates or len(equity_curve_with_dates) < 2:
        return empty
    vals = [float(x.get("value", 0.0)) for x in equity_curve_with_dates]
    n = len(vals)
    timestamps: list = []
    for x in equity_curve_with_dates:
        try:
            timestamps.append(pd.Timestamp(x.get("date")))
        except Exception:
            timestamps.append(None)

    def _days_between(i: int, j: int):
        if 0 <= i < n and 0 <= j < n:
            a, b = timestamps[i], timestamps[j]
            if a is not None and b is not None:
                try:
                    if not pd.isna(a) and not pd.isna(b):
                        return abs((b - a).total_seconds()) / 86400.0
                except Exception:
                    pass
        return None

    peak = vals[0]
    peak_idx = 0
    dd_start_idx = -1
    max_dd_pct = 0.0
    max_dd_trough_idx = 0
    max_dd_peak_idx = 0
    underwater_sum_pct = 0.0
    dd_periods: list[tuple[int, int]] = []

    for i in range(n):
        v = vals[i]
        if v >= peak:
            if dd_start_idx >= 0:
                dd_periods.append((dd_start_idx, i))
                dd_start_idx = -1
            peak = v
            peak_idx = i
        else:
            if dd_start_idx < 0:
                dd_start_idx = i
            dd_pct = ((peak - v) / peak) * 100.0 if peak > 0 else 0.0
            underwater_sum_pct += dd_pct
            if dd_pct > max_dd_pct:
                max_dd_pct = dd_pct
                max_dd_trough_idx = i
                max_dd_peak_idx = peak_idx

    if dd_start_idx >= 0:
        dd_periods.append((dd_start_idx, n - 1))

    current_dd_pct = 0.0
    if peak > 0 and vals[-1] < peak:
        current_dd_pct = ((peak - vals[-1]) / peak) * 100.0

    period_bars = [end - start for start, end in dd_periods]
    max_duration_bars = max(period_bars) if period_bars else 0
    avg_duration_bars = sum(period_bars) / len(period_bars) if period_bars else 0.0

    max_duration_days = None
    if dd_periods and max_duration_bars > 0:
        longest = max(dd_periods, key=lambda p: p[1] - p[0])
        max_duration_days = _days_between(longest[0], longest[1])

    recovery_bars = None
    recovery_days = None
    if max_dd_trough_idx > 0:
        peak_val = vals[max_dd_peak_idx]
        for i in range(max_dd_trough_idx + 1, n):
            if vals[i] >= peak_val:
                recovery_bars = i - max_dd_trough_idx
                recovery_days = _days_between(max_dd_trough_idx, i)
                break

    underwater_pct = underwater_sum_pct / max(1, n - 1) if n > 1 else 0.0

    return {
        "maxDurationBars": max_duration_bars,
        "maxDurationDays": round(max_duration_days, 2) if max_duration_days is not None else None,
        "timeToRecoveryBars": recovery_bars,
        "timeToRecoveryDays": round(recovery_days, 2) if recovery_days is not None else None,
        "underwaterPct": round(underwater_pct, 4),
        "avgDurationBars": round(avg_duration_bars, 2),
        "currentDrawdownPct": round(current_dd_pct, 4),
        "periodsCount": len(dd_periods),
    }


def _compute_trade_pnl_distribution(trades: list[dict]) -> dict:
    """Trade PnL distribution: histogram, percentiles, tail risk (CVaR), concentration. O(n log n)."""
    pnl_values = [float(t.get("pnl", 0.0) or 0.0) for t in trades if t.get("pnl") is not None]
    n = len(pnl_values)
    if n == 0:
        return {
            "count": 0, "histogram": [], "percentiles": {},
            "skewness": None, "kurtosis": None,
            "tailRisk": {"cvar5Pct": None, "cvar1Pct": None},
            "concentration": {"top5PnlPct": None, "top10PnlPct": None},
            "totalPnl": 0.0,
        }

    total_pnl = sum(pnl_values)
    sorted_pnl = sorted(pnl_values)

    def pctile(p: float) -> float:
        idx = min(n - 1, max(0, int((n - 1) * p)))
        return float(sorted_pnl[idx])

    percentiles = {
        f"p{int(p*100)}": round(pctile(p), 4)
        for p in (0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)
    }

    series = pd.Series(pnl_values)
    skew_val = round(float(series.skew()), 6) if n >= 3 else None
    kurt_val = round(float(series.kurtosis()), 6) if n >= 4 else None

    def cvar(p: float):
        count = max(1, int(n * p))
        if count > n:
            return None
        tail = sorted_pnl[:count]
        return round(float(sum(tail) / len(tail)), 4) if tail else None

    cvar_5 = cvar(0.05) if n >= 20 else (round(float(sorted_pnl[0]), 4) if n > 0 else None)
    cvar_1 = cvar(0.01) if n >= 100 else None

    top5_pct = None
    top10_pct = None
    if total_pnl > 0:
        sorted_desc = sorted(pnl_values, reverse=True)
        top5_pct = round(sum(sorted_desc[:min(5, n)]) / total_pnl * 100.0, 2)
        top10_pct = round(sum(sorted_desc[:min(10, n)]) / total_pnl * 100.0, 2)

    min_pnl, max_pnl = sorted_pnl[0], sorted_pnl[-1]
    if min_pnl == max_pnl:
        histogram = [{"binStart": round(min_pnl, 2), "binEnd": round(max_pnl + 1, 2), "count": n}]
    else:
        num_bins = min(30, max(5, int(n ** 0.5)))
        bin_width = (max_pnl - min_pnl) / num_bins
        counts = [0] * num_bins
        for v in pnl_values:
            b = min(num_bins - 1, max(0, int((v - min_pnl) / bin_width)))
            counts[b] += 1
        histogram = []
        for b in range(num_bins):
            lo = min_pnl + b * bin_width
            hi = lo + bin_width if b < num_bins - 1 else max_pnl + 0.01
            histogram.append({"binStart": round(lo, 2), "binEnd": round(hi, 2), "count": counts[b]})

    return {
        "count": n,
        "histogram": histogram,
        "percentiles": percentiles,
        "skewness": skew_val,
        "kurtosis": kurt_val,
        "tailRisk": {"cvar5Pct": cvar_5, "cvar1Pct": cvar_1},
        "concentration": {"top5PnlPct": top5_pct, "top10PnlPct": top10_pct},
        "totalPnl": round(total_pnl, 4),
    }


def _compute_bootstrap_ci(
    trades: list[dict],
    equity_curve_with_dates: list[dict],
    n_boot: int = 1000,
    alpha: float = 0.05,
) -> dict:
    """
    Trade-level bootstrap 95% CI for mean PnL, total return, and a Sharpe-like ratio.
    Resamples trades with replacement (i.i.d. assumption on trade level).
    O(n_boot * n_trades) — capped at 2000 bootstraps for performance.
    """
    pnl = [float(t.get("pnl", 0.0) or 0.0) for t in trades if t.get("pnl") is not None]
    n = len(pnl)
    if n < 5:
        return {
            "meanPnl": None,
            "totalReturn": None,
            "sharpe": None,
            "note": f"Too few trades ({n}) for bootstrap — minimum 5 required.",
            "nBoot": 0,
            "alpha": alpha,
        }
    n_boot = min(max(n_boot, 100), 2000)
    lo_idx = max(0, int(n_boot * (alpha / 2.0)) - 1)
    hi_idx = min(n_boot - 1, int(n_boot * (1.0 - alpha / 2.0)))

    mean_pnls: list[float] = []
    total_returns: list[float] = []
    sharpe_likes: list[float] = []

    for _ in range(n_boot):
        sample = [pnl[random.randint(0, n - 1)] for _ in range(n)]
        s_mean = sum(sample) / n
        s_total = sum(sample)
        mean_pnls.append(s_mean)
        total_returns.append(s_total)
        s_std = (sum((x - s_mean) ** 2 for x in sample) / max(1, n - 1)) ** 0.5
        sharpe_likes.append(s_mean / s_std if s_std > 1e-12 else 0.0)

    mean_pnls.sort()
    total_returns.sort()
    sharpe_likes.sort()

    point_mean = sum(pnl) / n
    point_std = (sum((x - point_mean) ** 2 for x in pnl) / max(1, n - 1)) ** 0.5
    point_sharpe = point_mean / point_std if point_std > 1e-12 else 0.0

    ci_pct = round((1.0 - alpha) * 100)
    return {
        "meanPnl": {
            "point": round(point_mean, 4),
            "ciLow": round(mean_pnls[lo_idx], 4),
            "ciHigh": round(mean_pnls[hi_idx], 4),
            "ciPct": ci_pct,
        },
        "totalReturn": {
            "point": round(sum(pnl), 4),
            "ciLow": round(total_returns[lo_idx], 4),
            "ciHigh": round(total_returns[hi_idx], 4),
            "ciPct": ci_pct,
        },
        "sharpe": {
            "point": round(point_sharpe, 6),
            "ciLow": round(sharpe_likes[lo_idx], 6),
            "ciHigh": round(sharpe_likes[hi_idx], 6),
            "ciPct": ci_pct,
            "note": "Trade-level Sharpe (mean/std of trade PnL), not annualized bar-return Sharpe.",
        },
        "note": (
            f"{ci_pct}% CI via trade-level bootstrap ({n_boot} resamples, {n} trades). "
            "Assumes i.i.d. trades — serial correlation in trade outcomes weakens coverage. "
            "CI width reflects sampling uncertainty, not model risk."
        ),
        "nBoot": n_boot,
        "alpha": alpha,
        "nTrades": n,
    }


def _compute_payoff_decomposition(trades: list[dict]) -> dict:
    """Win rate vs payoff ratio decomposition — the edge equation."""
    pnl_values = [float(t.get("pnl", 0.0) or 0.0) for t in trades if t.get("pnl") is not None]
    n = len(pnl_values)
    if n == 0:
        return {
            "winRate": 0.0, "lossRate": 0.0, "avgWin": 0.0, "avgLoss": 0.0,
            "payoffRatio": None, "edgePerTrade": 0.0, "kellyFraction": None,
            "note": "No trades.",
        }
    wins = [p for p in pnl_values if p > 0]
    losses = [p for p in pnl_values if p < 0]
    win_rate = len(wins) / n if n > 0 else 0.0
    loss_rate = 1.0 - win_rate
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = abs(sum(losses) / len(losses)) if losses else 0.0

    payoff_ratio = round(avg_win / avg_loss, 4) if avg_loss > 0 else None
    edge = win_rate * avg_win - loss_rate * avg_loss
    kelly = None
    if payoff_ratio is not None and payoff_ratio > 0:
        kelly = round(win_rate - (loss_rate / payoff_ratio), 6)

    return {
        "winRate": round(win_rate, 6),
        "lossRate": round(loss_rate, 6),
        "avgWin": round(avg_win, 4),
        "avgLoss": round(avg_loss, 4),
        "payoffRatio": payoff_ratio,
        "edgePerTrade": round(edge, 4),
        "kellyFraction": kelly,
        "note": (
            "Edge = WR×AvgWin - LR×AvgLoss. Kelly fraction = WR - LR/PayoffRatio — "
            "theoretical optimal fraction under i.i.d. assumption; real sizing should be much smaller (e.g. half-Kelly)."
        ),
    }


def _parse_analysis_config() -> dict:
    raw = _eget("ANALYSIS_CONFIG", "{}")
    try:
        parsed = json.loads(raw) if raw else {}
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _estimate_periods_per_year_from_equity_spacing(equity_curve_with_dates: list[dict]) -> float:
    if len(equity_curve_with_dates) < 3:
        return 252.0
    try:
        stamps = pd.to_datetime([x.get("date") for x in equity_curve_with_dates], errors="coerce")
        series = pd.Series(stamps).dropna().drop_duplicates().sort_values()
        if len(series) < 3:
            return 252.0
        diffs = series.diff().dropna()
        if len(diffs) == 0:
            return 252.0
        median_minutes = max(diffs.median().total_seconds() / 60.0, 1.0)
        return float(max(1.0, (365.25 * 24.0 * 60.0) / median_minutes))
    except Exception:
        return 252.0


def _resolve_risk_annualization_periods(
    equity_curve_with_dates: list[dict],
    *,
    timeframe_hint: str = "",
) -> tuple[float, str]:
    """Prefer explicit TF from data manifest / TIMEFRAME_HINT env; else median spacing on equity dates."""
    for hint in (
        str(timeframe_hint or "").strip(),
        str(_eget("TIMEFRAME_HINT", "") or "").strip(),
    ):
        if not hint:
            continue
        p = _timeframe_hint_periods_per_year(hint)
        if p is not None:
            return p, "timeframe_hint"
    p2 = _estimate_periods_per_year_from_equity_spacing(equity_curve_with_dates)
    if len(equity_curve_with_dates) >= 3:
        return p2, "equity_median_spacing"
    return p2, "default_sparse_equity"


def _compute_advanced_risk_metrics(
    equity_curve_with_dates: list[dict],
    max_drawdown_pct: float,
    *,
    timeframe_hint: str = "",
) -> dict[str, float]:
    if not equity_curve_with_dates:
        return {}
    vals = [float(x.get("value", 0.0)) for x in equity_curve_with_dates]
    if len(vals) < 3:
        return {}
    series = pd.Series(vals)
    rets = series.pct_change().replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    mean_ret = float(rets.mean())
    std_all = float(rets.std()) if len(rets) > 1 else 0.0
    down = rets[rets < 0]
    downside_std = float(down.std()) if len(down) > 1 else 0.0
    periods_per_year, ann_src = _resolve_risk_annualization_periods(
        equity_curve_with_dates,
        timeframe_hint=timeframe_hint,
    )
    sortino = (mean_ret / downside_std * math.sqrt(periods_per_year)) if downside_std > 0 else 0.0
    sharpe_unified = (mean_ret / std_all * math.sqrt(periods_per_year)) if std_all > 1e-12 else 0.0

    start_v = float(vals[0]) if vals else 0.0
    end_v = float(vals[-1]) if vals else 0.0
    try:
        d0 = pd.Timestamp(equity_curve_with_dates[0].get("date"))
        d1 = pd.Timestamp(equity_curve_with_dates[-1].get("date"))
        days = max(1.0, (d1 - d0).total_seconds() / 86400.0)
        years = days / 365.25
    except Exception:
        years = max(1.0 / 365.25, len(vals) / 252.0)
    cagr = (end_v / start_v) ** (1.0 / years) - 1.0 if start_v > 0 and end_v > 0 and years > 0 else 0.0

    dd_series = []
    peak = vals[0]
    for v in vals:
        peak = max(peak, v)
        dd = ((peak - v) / peak) * 100.0 if peak > 0 else 0.0
        dd_series.append(max(0.0, dd))
    ulcer_idx = math.sqrt(sum(d * d for d in dd_series) / len(dd_series)) if dd_series else 0.0
    calmar = (cagr * 100.0 / max_drawdown_pct) if max_drawdown_pct > 0 else 0.0
    return {
        "sharpeRatio": float(round(sharpe_unified, 6)),
        "sortinoRatio": float(round(sortino, 6)),
        "calmarRatio": float(round(calmar, 6)),
        "marRatio": float(round(calmar, 6)),
        "ulcerIndex": float(round(ulcer_idx, 6)),
        "cagr": float(round(cagr * 100.0, 6)),
        "riskAnnualizationPeriodsPerYear": float(round(periods_per_year, 4)),
        "riskAnnualizationSource": ann_src,
    }


def _gate_pass(value: float, threshold: float, rule: str) -> bool:
    if rule == "min":
        return value >= threshold
    return value <= threshold


def _evaluate_quality_gates(metrics: dict, gates_cfg: dict | None) -> dict:
    gates_cfg = gates_cfg or {}
    checks: list[dict] = []
    rules = [
        ("tradeCount", float(gates_cfg.get("min_trades", 0) or 0), "min"),
        ("maxDrawdownPct", float(gates_cfg.get("max_dd", 0) or 0), "max"),
        ("profitFactor", float(gates_cfg.get("min_pf", 0) or 0), "min"),
        ("sortinoRatio", float(gates_cfg.get("min_sortino", 0) or 0), "min"),
    ]
    for metric_key, threshold, mode in rules:
        if threshold == 0:
            continue
        raw = metrics.get(metric_key)
        if metric_key == "profitFactor" and raw is None:
            passed = False if mode == "min" and threshold > 0 else True
            checks.append(
                {
                    "metric": metric_key,
                    "value": None,
                    "threshold": threshold,
                    "mode": mode,
                    "passed": passed,
                    "note": "profitFactor undefined (e.g. no losing trades in sample) — min_pf gate fails when min_pf > 0.",
                }
            )
            continue
        value = float(raw if raw is not None else 0.0)
        passed = _gate_pass(value, threshold, mode)
        checks.append(
            {
                "metric": metric_key,
                "value": value,
                "threshold": threshold,
                "mode": mode,
                "passed": passed,
            }
        )
    return {"passed": all(x["passed"] for x in checks) if checks else True, "checks": checks}


def _safe_metrics_snapshot(result: dict) -> dict:
    m = result.get("metrics", {}) if isinstance(result, dict) else {}
    pf_raw = m.get("profitFactor")
    if pf_raw is None:
        pf_snap = None
    else:
        pfv = float(pf_raw)
        pf_snap = min(max(pfv, 0.0), 5.0)
    return {
        "finalEquity": float(m.get("finalEquity", 0.0) or 0.0),
        "maxDrawdownPct": float(m.get("maxDrawdownPct", m.get("maxDrawdown", 0.0)) or 0.0),
        "profitFactor": pf_snap,
        "tradeCount": int(m.get("tradeCount", 0) or 0),
        "winRate": float(m.get("winRate", 0.0) or 0.0),
        "sortinoRatio": float(m.get("sortinoRatio", 0.0) or 0.0),
        "totalReturnUsd": float(m.get("totalReturnUsd", 0.0) or 0.0),
    }


def _fold_test_metrics_detail(test_result: dict) -> dict:
    """Subset of test metrics for fold-level reporting (full numbers, bounded size)."""
    m = test_result.get("metrics", {}) if isinstance(test_result, dict) else {}
    if not isinstance(m, dict):
        return {}
    keys = (
        "tradeCount",
        "profitFactor",
        "profitFactorStatus",
        "totalReturnUsd",
        "sharpeRatio",
        "sortinoRatio",
        "maxDrawdownPct",
        "winRate",
        "finalEquity",
        "expectancyR",
        "expectancyUsd",
    )
    out = {}
    for k in keys:
        if k in m:
            out[k] = m.get(k)
    return out


def _df_window_meta(train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict:
    def span(dfi: pd.DataFrame) -> tuple[str, str, int]:
        if dfi is None or len(dfi) == 0:
            return "", "", 0
        i0, i1 = dfi.index[0], dfi.index[-1]
        return _safe_iso(i0), _safe_iso(i1), int(len(dfi))

    ts, te, tnb = span(train_df)
    vs, ve, vnb = span(test_df)
    return {
        "trainStart": ts,
        "trainEnd": te,
        "trainBarCount": tnb,
        "testStart": vs,
        "testEnd": ve,
        "testBarCount": vnb,
    }


def _downsample_1d_series(values: object, max_points: int = 72) -> list[float]:
    """Uniformly sample a numeric sequence for compact JSON (validation sparklines)."""
    if not isinstance(values, list) or not values:
        return []
    if max_points < 2:
        try:
            return [float(values[-1])]
        except (TypeError, ValueError):
            return []
    try:
        nums = [float(x) for x in values]
    except (TypeError, ValueError):
        return []
    n = len(nums)
    if n <= max_points:
        return nums
    out: list[float] = []
    denom = max(1, max_points - 1)
    for i in range(max_points):
        j = int(round(i * (n - 1) / denom))
        j = max(0, min(j, n - 1))
        out.append(nums[j])
    return out


def _fold_sparkline_pct(train_result: dict, test_result: dict, max_each: int = 64) -> dict:
    """Per-window equity as % change from that window's first point (UI sparkline)."""
    def norm_segment(equity_obj: object) -> list[float]:
        pts = _downsample_1d_series(equity_obj, max_each)
        if not pts:
            return []
        base = pts[0]
        if abs(base) < 1e-12:
            return [0.0 for _ in pts]
        return [round((p / base - 1.0) * 100.0, 4) for p in pts]

    if not isinstance(train_result, dict):
        train_result = {}
    if not isinstance(test_result, dict):
        test_result = {}
    return {
        "trainPct": norm_segment(train_result.get("equity")),
        "testPct": norm_segment(test_result.get("equity")),
    }


def _validation_guardrails(
    folds: list[dict],
    quality_gates: dict | None,
    mode: str,
) -> dict:
    """Heuristic flags only — not proof of leakage or absence of issues."""
    qg = quality_gates or {}
    min_trades = int(qg.get("min_trades", 5) or 5)
    min_pf = float(qg.get("min_pf", 0.0) or 0.0)
    hints: list[str] = []
    short_test = False
    low_trades_fold = False
    folds_failed = 0
    worst_fold_id = None
    worst_test_ret: float | None = None

    for f in folds:
        tid = str(f.get("id", ""))
        vnb = int(f.get("testBarCount", 0) or 0)
        if vnb > 0 and vnb < 30:
            short_test = True
        tm = f.get("testMetrics") if isinstance(f.get("testMetrics"), dict) else {}
        tc = int(tm.get("tradeCount", 0) or 0)
        if tc < min_trades:
            low_trades_fold = True
        tr = float(tm.get("totalReturnUsd", 0.0) or 0.0)
        if worst_test_ret is None or tr < worst_test_ret:
            worst_test_ret = tr
            worst_fold_id = tid
        pf_raw = tm.get("profitFactor")
        if pf_raw is None:
            fold_fail_pf = min_pf > 0
        else:
            pfv = float(pf_raw)
            fold_fail_pf = min_pf > 0 and pfv < min_pf
        fold_fail = fold_fail_pf
        if tc < min_trades:
            fold_fail = True
        if fold_fail:
            folds_failed += 1

    if short_test:
        hints.append("At least one fold has a short OOS/test window (<30 bars) — variance of metrics is high.")
    if low_trades_fold:
        hints.append(f"At least one fold has fewer than {min_trades} trades in the test segment.")
    if mode == "walk_forward":
        hints.append(
            "Walk-forward uses rolling/expanding segments; correlation across folds is expected — "
            "do not treat folds as independent trials."
        )

    return {
        "possibleLeakageHints": hints,
        "flags": {
            "shortTestWindow": short_test,
            "lowTradesInSomeFold": low_trades_fold,
        },
        "worstFold": worst_fold_id,
        "foldsFailedGates": folds_failed,
    }


def _run_validation(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str,
    instrument: str,
    strategy_params: dict | None,
    mode: str,
    cfg: dict | None,
    quality_gates: dict | None = None,
) -> dict:
    cfg = cfg or {}
    n = len(data)
    if n < 50 or mode == "single":
        return {"mode": "single", "folds": [], "summary": {}, "guardrails": {}}
    folds: list[dict] = []
    if mode == "oos_split":
        ratio = float(cfg.get("oos_ratio", 0.25) or 0.25)
        ratio = min(max(ratio, 0.05), 0.8)
        split = int(n * (1.0 - ratio))
        split = min(max(split, 20), n - 20)
        train = data.iloc[:split]
        test = data.iloc[split:]
        train_result = run_backtest(strategy_cls, train, data_path=data_path, instrument=instrument, strategy_params=strategy_params, lightweight=True)
        test_result = run_backtest(strategy_cls, test, data_path=data_path, instrument=instrument, strategy_params=strategy_params, lightweight=True)
        meta = _df_window_meta(train, test)
        folds.append(
            {
                "id": "oos_split",
                **meta,
                "train": _safe_metrics_snapshot(train_result),
                "test": _safe_metrics_snapshot(test_result),
                "testMetrics": _fold_test_metrics_detail(test_result),
                "equitySparklinePct": _fold_sparkline_pct(train_result, test_result),
            }
        )
    elif mode == "walk_forward":
        folds_count = int(cfg.get("folds", 4) or 4)
        folds_count = min(max(folds_count, 2), 12)
        test_ratio = float(cfg.get("test_ratio", 0.2) or 0.2)
        test_len = max(20, int(n * test_ratio))
        train_len = max(40, int((n - test_len) / folds_count))
        for i in range(folds_count):
            train_start = i * train_len
            train_end = min(train_start + train_len, n - test_len)
            test_end = min(train_end + test_len, n)
            if test_end - train_end < 20 or train_end - train_start < 20:
                break
            train = data.iloc[train_start:train_end]
            test = data.iloc[train_end:test_end]
            train_result = run_backtest(strategy_cls, train, data_path=data_path, instrument=instrument, strategy_params=strategy_params, lightweight=True)
            test_result = run_backtest(strategy_cls, test, data_path=data_path, instrument=instrument, strategy_params=strategy_params, lightweight=True)
            meta = _df_window_meta(train, test)
            folds.append(
                {
                    "id": f"wf_{i+1}",
                    **meta,
                    "train": _safe_metrics_snapshot(train_result),
                    "test": _safe_metrics_snapshot(test_result),
                    "testMetrics": _fold_test_metrics_detail(test_result),
                    "equitySparklinePct": _fold_sparkline_pct(train_result, test_result),
                }
            )
    degradation = []
    for f in folds:
        train_ret = float(f["train"].get("totalReturnUsd", 0.0))
        test_ret = float(f["test"].get("totalReturnUsd", 0.0))
        d = 0.0 if abs(train_ret) < 1e-9 else (test_ret - train_ret) / abs(train_ret)
        degradation.append(d)
    guardrails = _validation_guardrails(folds, quality_gates, mode)
    summary = {
        "foldCount": len(folds),
        "avgDegradation": float(round(sum(degradation) / len(degradation), 6)) if degradation else 0.0,
        "medianDegradation": float(round(sorted(degradation)[len(degradation) // 2], 6)) if degradation else 0.0,
        "worstFold": guardrails.get("worstFold"),
        "foldsFailedGates": guardrails.get("foldsFailedGates", 0),
    }
    return {
        "mode": mode,
        "folds": folds,
        "summary": summary,
        "guardrails": guardrails,
        "methodology": {
            "optimizesParametersOnTrainSegment": False,
            "description": (
                "Same strategy_params are run on each train window and each test window. "
                "The engine does not search parameters on train and apply the winner to test — "
                "that would require an explicit nested optimization mode (not implemented here)."
            ),
        },
    }


def _is_strategy_numeric_scalar(v: object) -> bool:
    if isinstance(v, bool):
        return False
    return isinstance(v, (int, float))


_PARAM_TEST_METRIC_KEYS = (
    "finalEquity",
    "totalReturnUsd",
    "sharpeRatio",
    "sortinoRatio",
    "profitFactor",
    "profitFactorStatus",
    "tradeCount",
    "maxDrawdownPct",
    "winRate",
)


def _param_test_metrics_slice(m: dict) -> dict:
    return {k: m[k] for k in _PARAM_TEST_METRIC_KEYS if k in m}


def _param_test_best_in_series(series: list[dict], metric: str, *, maximize: bool) -> dict | None:
    best_score = None
    best_row = None
    for row in series:
        raw = row.get(metric)
        if raw is None:
            continue
        try:
            score = float(raw)
        except (TypeError, ValueError):
            continue
        if best_score is None:
            best_score = score
            best_row = row
        elif maximize and score > best_score:
            best_score = score
            best_row = row
        elif not maximize and score < best_score:
            best_score = score
            best_row = row
    if best_row is None:
        return None
    return {
        "paramValue": best_row.get("paramValue"),
        "metricValue": float(best_score),
        "metrics": _param_test_metrics_slice(best_row),
    }


_PARAM_TEST_MAX_METRICS = (
    "totalReturnUsd",
    "sharpeRatio",
    "sortinoRatio",
    "profitFactor",
    "winRate",
    "finalEquity",
    "tradeCount",
)
_PARAM_TEST_MIN_METRICS = ("maxDrawdownPct",)

_PARAM_TEST_METHODOLOGY = {
    "optimizesParametersOnTrainSegment": False,
    "description": (
        "Param test: one-at-a-time (OAT) sweep over numeric strategy PARAMS only; "
        "module_params unchanged; the first result.metrics is the user baseline run."
    ),
}


def _run_param_test(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str,
    instrument: str,
    base_strategy_params: dict | None,
    validation_cfg: dict | None,
    time_context: dict | None = None,
) -> dict:
    raw_pt = (validation_cfg or {}).get("param_test")
    pt = raw_pt if isinstance(raw_pt, dict) else {}
    max_runs = int(pt.get("max_runs", 24) or 24)
    max_runs = min(48, max(4, max_runs))
    raw_ranges = pt.get("param_ranges") if isinstance(pt.get("param_ranges"), dict) else {}
    train_only = bool(pt.get("train_only", False))
    train_ratio = float(pt.get("train_ratio", 0.75) or 0.75)
    train_ratio = min(max(train_ratio, 0.5), 0.9)

    base = dict(base_strategy_params or {})
    module_blob = base.get("module_params")

    # Missing keys that only exist in UI/param_ranges: bootstrap midpoint so OAT is not skipped.
    for k, rcfg in raw_ranges.items():
        if k == "module_params" or k in base:
            continue
        if not isinstance(rcfg, dict) or not rcfg.get("enabled"):
            continue
        try:
            lo_b = float(rcfg.get("min", 0) or 0)
            hi_b = float(rcfg.get("max", lo_b) or lo_b)
        except (TypeError, ValueError):
            continue
        if hi_b < lo_b:
            lo_b, hi_b = hi_b, lo_b
        base[k] = (lo_b + hi_b) / 2.0

    enabled: list[tuple[str, float, float, object]] = []
    for k, rcfg in raw_ranges.items():
        if k == "module_params" or k not in base:
            continue
        if not isinstance(rcfg, dict) or not rcfg.get("enabled"):
            continue
        orig = base.get(k)
        if not _is_strategy_numeric_scalar(orig):
            continue
        lo = float(rcfg.get("min", 0) or 0)
        hi = float(rcfg.get("max", lo) or lo)
        if hi < lo:
            lo, hi = hi, lo
        enabled.append((k, lo, hi, orig))

    empty = {
        "mode": "param_test",
        "folds": [],
        "summary": {
            "foldCount": 0,
            "avgDegradation": 0.0,
            "medianDegradation": 0.0,
            "paramTestTotalRuns": 0,
            "paramKeysTested": [],
        },
        "guardrails": {
            "possibleLeakageHints": [
                "Param test: žádný povolený numerický parametr — zkontroluj rozsahy a zaškrtnutí u strategie PARAMS.",
            ],
            "flags": {},
        },
        "methodology": _PARAM_TEST_METHODOLOGY,
        "paramTest": {
            "maxRunsBudget": max_runs,
            "samplesPerParam": 0,
            "runs": [],
            "byParam": {},
        },
    }

    if not enabled:
        return empty

    n_params = len(enabled)
    samples = max(1, max_runs // n_params)
    if samples < 2 and n_params * 2 <= max_runs:
        samples = 2
    if n_params * samples > max_runs:
        samples = max(1, max_runs // n_params)

    data_explore = data
    data_holdout = None
    actually_split = False
    if train_only and len(data) >= 60:
        split_idx = int(len(data) * train_ratio)
        split_idx = max(split_idx, 30)
        if split_idx < len(data) - 20:
            data_explore = data.iloc[:split_idx].copy()
            data_holdout = data.iloc[split_idx:].copy()
            actually_split = True

    total_steps = n_params * samples
    step_i = 0
    runs_out: list[dict] = []
    by_series: dict[str, list[dict]] = {t[0]: [] for t in enabled}

    for key, lo, hi, orig in enabled:
        is_int_param = type(orig) is int
        for j in range(samples):
            if samples <= 1:
                alpha = 0.5
            else:
                alpha = j / (samples - 1)
            v = lo + (hi - lo) * alpha
            if is_int_param:
                v = int(round(v))
            else:
                v = float(v)
            merged = dict(base)
            merged[key] = v
            if module_blob is not None:
                merged["module_params"] = module_blob
            step_i += 1
            pct = min(99, int(100 * step_i / max(total_steps, 1)))
            print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)
            res = run_backtest(
                strategy_cls,
                data_explore,
                data_path=data_path,
                instrument=instrument,
                strategy_params=merged,
                time_context=time_context,
                lightweight=True,
            )
            m = res.get("metrics") or {}
            slice_m = _param_test_metrics_slice(m)
            row = {"paramValue": v, **slice_m}
            runs_out.append({"paramKey": key, "paramValue": v, "metrics": slice_m})
            by_series[key].append(row)

    by_out: dict[str, dict] = {}
    for key, series in by_series.items():
        best_by: dict[str, dict | None] = {}
        for mk in _PARAM_TEST_MAX_METRICS:
            best_by[mk] = _param_test_best_in_series(series, mk, maximize=True)
        for mk in _PARAM_TEST_MIN_METRICS:
            best_by[mk] = _param_test_best_in_series(series, mk, maximize=False)
        by_out[key] = {"series": series, "bestByMetric": best_by}

    hints = [
        f"Param test: {total_steps} simulací (OAT po parametrech) — vícenásobné porovnání zvyšuje riziko falešných špiček; "
        "používej jen k exploraci citlivosti, ne k finálnímu výběru bez OOS/WF."
    ]
    if actually_split:
        hints.append(
            f"train_only=true: explorace běžela jen na train části ({len(data_explore)} barů z {len(data)}). "
            "Holdout metriky nejlepšího parametru jsou v paramTest.holdoutBest."
        )
    elif train_only and not actually_split:
        hints.append("train_only=true požadováno, ale data příliš krátká pro bezpečný split — běželo na celých datech.")

    holdout_best = None
    if actually_split and data_holdout is not None:
        best_return = None
        best_params_for_holdout = None
        for run_row in runs_out:
            ret = float((run_row.get("metrics") or {}).get("totalReturnUsd", 0.0) or 0.0)
            if best_return is None or ret > best_return:
                best_return = ret
                best_params_for_holdout = {run_row["paramKey"]: run_row["paramValue"]}
        if best_params_for_holdout:
            holdout_params = dict(base)
            holdout_params.update(best_params_for_holdout)
            if module_blob is not None:
                holdout_params["module_params"] = module_blob
            try:
                holdout_res = run_backtest(
                    strategy_cls, data_holdout,
                    data_path=data_path, instrument=instrument,
                    strategy_params=holdout_params, time_context=time_context,
                    lightweight=True,
                )
                holdout_best = {
                    "selectedParams": best_params_for_holdout,
                    "trainBestReturnUsd": round(best_return, 4) if best_return is not None else None,
                    "holdoutMetrics": _param_test_metrics_slice(holdout_res.get("metrics") or {}),
                    "holdoutBars": len(data_holdout),
                    "trainBars": len(data_explore),
                }
            except Exception:
                pass

    methodology = dict(_PARAM_TEST_METHODOLOGY)
    if actually_split:
        methodology["optimizesParametersOnTrainSegment"] = True
        methodology["trainOnlyEnabled"] = True
        methodology["trainRatio"] = train_ratio
        methodology["description"] = (
            f"Param test with train_only=true: OAT sweep runs only on train portion "
            f"({len(data_explore)} bars, ratio={train_ratio}). Best-by-return param is then "
            f"evaluated once on holdout ({len(data_holdout) if data_holdout is not None else 0} bars)."
        )

    return {
        "mode": "param_test",
        "folds": [],
        "summary": {
            "foldCount": 0,
            "avgDegradation": 0.0,
            "medianDegradation": 0.0,
            "paramTestTotalRuns": total_steps,
            "paramKeysTested": [t[0] for t in enabled],
        },
        "guardrails": {
            "possibleLeakageHints": hints,
            "flags": {"paramTestMultipleComparisons": True, "trainOnlyUsed": actually_split},
        },
        "methodology": methodology,
        "paramTest": {
            "maxRunsBudget": max_runs,
            "samplesPerParam": samples,
            "trainOnly": actually_split,
            "trainBars": len(data_explore) if actually_split else len(data),
            "holdoutBars": len(data_holdout) if data_holdout is not None else 0,
            "runs": runs_out,
            "byParam": by_out,
            "holdoutBest": holdout_best,
        },
    }


def _build_param_candidates(
    base_params: dict[str, object],
    sweep_mode: str | None,
    sweep_cfg: dict | None,
) -> list[dict]:
    sweep_cfg = sweep_cfg or {}
    mode = (sweep_mode or "random").lower()
    max_samples = int(sweep_cfg.get("max_samples", 24) or 24)
    max_samples = min(max(max_samples, 4), 128)
    ranges = sweep_cfg.get("param_ranges")
    if not isinstance(ranges, dict) or not ranges:
        ranges = {}
        for k, v in base_params.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                lo = float(v) * 0.8
                hi = float(v) * 1.2 if float(v) != 0 else 1.0
                ranges[k] = {"min": lo, "max": hi}
    if not ranges:
        return []
    keys = list(ranges.keys())
    candidates: list[dict] = []
    if mode == "grid":
        per_key_values = []
        for k in keys:
            rcfg = ranges.get(k) or {}
            lo = float(rcfg.get("min", 0.0) or 0.0)
            hi = float(rcfg.get("max", lo) or lo)
            step = rcfg.get("step")
            if step is None:
                per_key_values.append([lo, (lo + hi) / 2.0, hi])
            else:
                step = float(step or 1.0)
                vals = []
                cur = lo
                guard = 0
                while cur <= hi and guard < 200:
                    vals.append(cur)
                    cur += step
                    guard += 1
                per_key_values.append(vals or [lo])
        for combo in itertools.product(*per_key_values):
            row = dict(base_params)
            for i, key in enumerate(keys):
                row[key] = combo[i]
            candidates.append(row)
            if len(candidates) >= max_samples:
                break
    else:
        for _ in range(max_samples):
            row = dict(base_params)
            for k in keys:
                rcfg = ranges.get(k) or {}
                lo = float(rcfg.get("min", 0.0) or 0.0)
                hi = float(rcfg.get("max", lo) or lo)
                row[k] = random.uniform(lo, hi)
            candidates.append(row)
    return candidates


def _run_sweep_robustness(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str,
    instrument: str,
    base_params: dict | None,
    sweep_mode: str | None,
    sweep_cfg: dict | None,
) -> dict:
    candidates = _build_param_candidates(dict(base_params or {}), sweep_mode, sweep_cfg)
    if not candidates:
        return {"mode": sweep_mode, "tested": 0, "results": [], "stabilityScore": 0.0}
    sweep_cfg = sweep_cfg or {}
    holdout_ratio = float(sweep_cfg.get("holdout_ratio", 0.2) or 0.0)
    holdout_ratio = min(max(holdout_ratio, 0.0), 0.45)
    min_total = int(sweep_cfg.get("holdout_min_total_bars", 120) or 120)
    min_holdout_bars = int(sweep_cfg.get("holdout_min_holdout_bars", 40) or 40)
    use_holdout = holdout_ratio > 0 and len(data) >= min_total
    data_train = data
    data_hold = data
    if use_holdout:
        split = int(len(data) * (1.0 - holdout_ratio))
        split = max(split, min_holdout_bars)
        if split >= len(data) - max(10, min_holdout_bars // 2):
            use_holdout = False
        else:
            data_train = data.iloc[:split].copy()
            data_hold = data.iloc[split:].copy()
    penalty_scale = float(sweep_cfg.get("multiple_testing_penalty_scale", 25.0) or 25.0)
    max_ranking_rows = int(sweep_cfg.get("max_ranking_rows_export", 100) or 100)
    max_ranking_rows = min(max(max_ranking_rows, 10), 500)

    rows: list[dict] = []
    for i, params in enumerate(candidates):
        try:
            out_full = run_backtest(strategy_cls, data, data_path=data_path, instrument=instrument, strategy_params=params, lightweight=True)
            m_full = _safe_metrics_snapshot(out_full)
            if use_holdout:
                out_tr = run_backtest(
                    strategy_cls, data_train, data_path=data_path, instrument=instrument, strategy_params=params, lightweight=True,
                )
                out_hd = run_backtest(
                    strategy_cls, data_hold, data_path=data_path, instrument=instrument, strategy_params=params, lightweight=True,
                )
                m_tr = _safe_metrics_snapshot(out_tr)
                m_hd = _safe_metrics_snapshot(out_hd)
                score_train = _sweep_objective_from_run(out_tr, m_tr)
                score_hold = _sweep_objective_from_run(out_hd, m_hd)
                score_raw = score_hold
            else:
                out_tr = out_full
                out_hd = out_full
                m_tr = m_full
                m_hd = m_full
                score_train = _sweep_objective_from_run(out_full, m_full)
                score_hold = score_train
                score_raw = score_train
            n_try = max(2, len(candidates))
            penalty = penalty_scale * math.log(n_try)
            score_adj = score_raw - penalty
            metrics_primary = m_hd if use_holdout else m_full
            rows.append(
                {
                    "id": i + 1,
                    "params": params,
                    "metrics": metrics_primary,
                    "metricsTrain": m_tr,
                    "metricsHoldout": m_hd,
                    "scoreRawHoldoutOrFull": round(score_raw, 6),
                    "scoreTrain": round(score_train, 6) if use_holdout else None,
                    "scoreMultipleTestingAdjusted": round(score_adj, 6),
                    "holdoutEnabled": use_holdout,
                    "score": round(score_raw, 6),
                    "sweepMetricsSource": "holdout" if use_holdout else "full",
                }
            )
        except Exception:
            continue
    rows.sort(key=lambda x: x["score"], reverse=True)
    top = rows[: max(1, min(20, len(rows)))]
    if top:
        scores = [float(x["score"]) for x in top]
        mean = sum(scores) / len(scores)
        var = sum((x - mean) ** 2 for x in scores) / len(scores)
        stdev = math.sqrt(var)
        stability = 1.0 / (1.0 + (stdev / max(1.0, abs(mean))))
    else:
        stability = 0.0
    score_values = [float(x["score"]) for x in rows]
    score_values_sorted = sorted(score_values)

    def pctile(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        idx = int((len(values) - 1) * p)
        return float(values[idx])

    heatmap = None
    if rows:
        candidate_keys = []
        first_params = rows[0].get("params", {})
        if isinstance(first_params, dict):
            for k, v in first_params.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    candidate_keys.append(str(k))
        if len(candidate_keys) >= 2:
            x_key, y_key = candidate_keys[0], candidate_keys[1]
            xv = [float(r["params"][x_key]) for r in rows if x_key in r.get("params", {})]
            yv = [float(r["params"][y_key]) for r in rows if y_key in r.get("params", {})]
            if xv and yv:
                x_min, x_max = min(xv), max(xv)
                y_min, y_max = min(yv), max(yv)
                x_bins = 6
                y_bins = 6
                grid: dict[tuple[int, int], list[dict]] = {}

                def _sweep_bin_ixy(x: float, y: float) -> tuple[int, int]:
                    x_den = (x_max - x_min) if x_max != x_min else 1.0
                    y_den = (y_max - y_min) if y_max != y_min else 1.0
                    xi_loc = min(x_bins - 1, max(0, int(((x - x_min) / x_den) * x_bins)))
                    yi_loc = min(y_bins - 1, max(0, int(((y - y_min) / y_den) * y_bins)))
                    return xi_loc, yi_loc

                for r in rows:
                    p = r.get("params", {})
                    if x_key not in p or y_key not in p:
                        continue
                    x = float(p[x_key])
                    y = float(p[y_key])
                    xi, yi = _sweep_bin_ixy(x, y)
                    m_snap = r.get("metrics") if isinstance(r.get("metrics"), dict) else {}
                    tr = float(m_snap.get("totalReturnUsd", 0.0) or 0.0)
                    wr = float(m_snap.get("winRate", 0.0) or 0.0)
                    grid.setdefault((xi, yi), []).append(
                        {"score": float(r["score"]), "totalReturnUsd": tr, "winRate": wr}
                    )
                cells = []
                for yi in range(y_bins):
                    for xi in range(x_bins):
                        vals = grid.get((xi, yi), [])
                        if vals:
                            scores = [float(v["score"]) for v in vals]
                            pnls = [float(v["totalReturnUsd"]) for v in vals]
                            wrs = [float(v["winRate"]) for v in vals]
                            cells.append(
                                {
                                    "xBin": xi,
                                    "yBin": yi,
                                    "count": len(vals),
                                    "avgScore": round(sum(scores) / len(scores), 6),
                                    "avgTotalReturnUsd": round(sum(pnls) / len(pnls), 4),
                                    "avgWinRate": round(sum(wrs) / len(wrs), 4),
                                    "bestScore": round(max(scores), 6),
                                    "maxTotalReturnUsd": round(max(pnls), 4),
                                }
                            )
                        else:
                            cells.append(
                                {
                                    "xBin": xi,
                                    "yBin": yi,
                                    "count": 0,
                                    "avgScore": 0.0,
                                    "avgTotalReturnUsd": 0.0,
                                    "avgWinRate": 0.0,
                                    "bestScore": 0.0,
                                    "maxTotalReturnUsd": 0.0,
                                }
                            )
                heatmap = {
                    "xKey": x_key,
                    "yKey": y_key,
                    "xRange": [round(x_min, 8), round(x_max, 8)],
                    "yRange": [round(y_min, 8), round(y_max, 8)],
                    "xBins": x_bins,
                    "yBins": y_bins,
                    "cells": cells,
                }

    ranking_sample: list[dict] = []
    hm_x_key = heatmap.get("xKey") if isinstance(heatmap, dict) else None
    hm_y_key = heatmap.get("yKey") if isinstance(heatmap, dict) else None
    hm_x_range = heatmap.get("xRange") if isinstance(heatmap, dict) else None
    hm_y_range = heatmap.get("yRange") if isinstance(heatmap, dict) else None
    hm_x_bins = heatmap.get("xBins") if isinstance(heatmap, dict) else None
    hm_y_bins = heatmap.get("yBins") if isinstance(heatmap, dict) else None

    for r in rows[:max_ranking_rows]:
        m_primary = r.get("metrics") if isinstance(r.get("metrics"), dict) else {}
        item: dict = {
            "id": r["id"],
            "params": r["params"],
            "metrics": dict(m_primary),
            "scoreRawHoldoutOrFull": r.get("scoreRawHoldoutOrFull"),
            "scoreMultipleTestingAdjusted": r.get("scoreMultipleTestingAdjusted"),
            "metricsHoldout": r.get("metricsHoldout"),
            "metricsTrain": r.get("metricsTrain"),
            "holdoutEnabled": r.get("holdoutEnabled"),
        }
        if (
            hm_x_key
            and hm_y_key
            and isinstance(hm_x_range, list)
            and len(hm_x_range) >= 2
            and isinstance(hm_y_range, list)
            and len(hm_y_range) >= 2
            and hm_x_bins is not None
            and hm_y_bins is not None
        ):
            p = r.get("params", {})
            if isinstance(p, dict) and hm_x_key in p and hm_y_key in p:
                try:
                    x_min_h, x_max_h = float(hm_x_range[0]), float(hm_x_range[1])
                    y_min_h, y_max_h = float(hm_y_range[0]), float(hm_y_range[1])
                    xb_i = int(hm_x_bins)
                    yb_i = int(hm_y_bins)
                    x = float(p[str(hm_x_key)])
                    y = float(p[str(hm_y_key)])
                    x_den = (x_max_h - x_min_h) if x_max_h != x_min_h else 1.0
                    y_den = (y_max_h - y_min_h) if y_max_h != y_min_h else 1.0
                    xi_h = min(xb_i - 1, max(0, int(((x - x_min_h) / x_den) * xb_i)))
                    yi_h = min(yb_i - 1, max(0, int(((y - y_min_h) / y_den) * yb_i)))
                    item["heatmapBin"] = {"xBin": xi_h, "yBin": yi_h}
                except (TypeError, ValueError):
                    pass
        ranking_sample.append(item)

    return {
        "mode": sweep_mode,
        "tested": len(rows),
        "results": top,
        "stabilityScore": float(round(stability, 6)),
        "best": top[0] if top else None,
        "scoreDistribution": {
            "p10": round(pctile(score_values_sorted, 0.10), 6),
            "p50": round(pctile(score_values_sorted, 0.50), 6),
            "p90": round(pctile(score_values_sorted, 0.90), 6),
        },
        "heatmap": heatmap,
        "nestedHoldout": {
            "enabled": use_holdout,
            "holdoutRatioConfigured": holdout_ratio,
            "trainBarCount": int(len(data_train)) if use_holdout else None,
            "holdoutBarCount": int(len(data_hold)) if use_holdout else None,
        },
        "multipleTestingPenaltyScale": penalty_scale,
        "rankingSample": ranking_sample,
        "scoreFieldNote": "Primary ranking uses scoreRawHoldoutOrFull (holdout segment when enabled, else full sample).",
    }


def _compute_path_max_dd(equity_vals: list[float]) -> float:
    if not equity_vals:
        return 0.0
    peak = equity_vals[0]
    max_dd = 0.0
    for v in equity_vals:
        peak = max(peak, v)
        if peak > 0:
            dd = ((peak - v) / peak) * 100.0
            max_dd = max(max_dd, dd)
    return max_dd


def _profit_factor_detailed(gross_profit: float, gross_loss: float) -> dict:
    """
    Profit factor = gross wins / gross losses (absolute). When there are no losing trades,
    the ratio is undefined: value is None (JSON null), not a sentinel like 999.
    forScoring is a finite proxy used only for sweep ordering (bounded).
    """
    gp = float(gross_profit)
    gl = float(gross_loss)
    if gp <= 0 and gl <= 0:
        return {
            "value": None,
            "status": "no_gross_activity",
            "forScoring": 0.0,
            "grossProfit": gp,
            "grossLoss": gl,
        }
    if gl > 1e-12:
        ratio = gp / gl
        return {
            "value": round(ratio, 6),
            "status": "defined",
            "forScoring": min(1000.0, max(0.0, ratio)),
            "grossProfit": gp,
            "grossLoss": gl,
        }
    syn_den = max(1e-9, 0.01 * max(gp, 1.0))
    return {
        "value": None,
        "status": "undefined_no_losing_trades",
        "forScoring": min(100.0, gp / syn_den),
        "grossProfit": gp,
        "grossLoss": 0.0,
    }


def _compute_profit_factor(gross_profit: float, gross_loss: float) -> float | None:
    """Backward-compat: returns None when undefined (callers that need float should use forScoring)."""
    d = _profit_factor_detailed(gross_profit, gross_loss)
    v = d.get("value")
    return float(v) if v is not None else None


def _sweep_objective_from_run(out: dict, m: dict) -> float:
    """Finite score for sweep ranking; uses profitFactor forScoring when PF ratio undefined."""
    tr = out.get("trades") if isinstance(out, dict) else []
    tr = tr or []
    gp = sum(float(t.get("pnl", 0) or 0) for t in tr if float(t.get("pnl", 0) or 0) > 0)
    gl = abs(sum(float(t.get("pnl", 0) or 0) for t in tr if float(t.get("pnl", 0) or 0) < 0))
    pfb = _profit_factor_detailed(gp, gl)
    pf_s = float(pfb["forScoring"])
    dd = float(m.get("maxDrawdownPct", m.get("maxDrawdown", 0.0)) or 0.0)
    return float(m.get("totalReturnUsd", 0.0) or 0.0) - dd * 50.0 + pf_s * 100.0


def _validate_ohlc_dataframe(df: pd.DataFrame) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for OHLC invariants. Expects lowercase ohlc columns after normalize."""
    errors: list[str] = []
    warns: list[str] = []
    if df is None or len(df) == 0:
        return errors, warns
    cols = {c.lower(): c for c in df.columns}
    for need in ("open", "high", "low", "close"):
        if need not in cols:
            errors.append(f"Missing column: {need}")
    if errors:
        return errors, warns
    o = pd.to_numeric(df[cols["open"]], errors="coerce")
    h = pd.to_numeric(df[cols["high"]], errors="coerce")
    l = pd.to_numeric(df[cols["low"]], errors="coerce")
    c = pd.to_numeric(df[cols["close"]], errors="coerce")
    bad = (h < l) & h.notna() & l.notna()
    if bool(bad.any()):
        n = int(bad.sum())
        errors.append(f"high < low on {n} row(s)")
    inside = (h >= o) & (h >= c) & (l <= o) & (l <= c)
    nanm = o.notna() & h.notna() & l.notna() & c.notna()
    viol = nanm & ~inside
    if bool(viol.any()):
        n2 = int(viol.sum())
        warns.append(f"OHLC geometry violated (O/C outside H-L range) on {n2} row(s)")
    return errors, warns


def _default_mc_block_size(timeframe: str, n_trades: int) -> int:
    tf = _normalize_tf(timeframe) or "1d"
    minutes = TF_TO_MINUTES.get(tf, 1440)
    nt = max(1, int(n_trades))
    if minutes <= 30:
        return max(3, min(12, max(3, nt // 15)))
    if minutes <= 240:
        return max(2, min(8, max(2, nt // 20)))
    return max(2, min(5, max(2, nt // 25)))


def _mc_resample_pnl_iid(pnl: list[float]) -> list[float]:
    return [random.choice(pnl) for _ in range(len(pnl))]


def _mc_resample_pnl_blocks(pnl: list[float], block_size: int) -> list[float]:
    n = len(pnl)
    if n == 0:
        return []
    bs = max(1, min(int(block_size), n))
    out: list[float] = []
    while len(out) < n:
        start = random.randint(0, n - bs)
        out.extend(pnl[start : start + bs])
    return out[:n]


def _run_monte_carlo(
    trades: list[dict],
    initial_capital: float,
    cfg: dict | None,
    *,
    data_timeframe: str = "1d",
) -> dict:
    cfg = cfg or {}
    pnl = [float(t.get("pnl", 0.0) or 0.0) for t in trades]
    mode = str(cfg.get("mode", "iid_trade") or "iid_trade").lower().strip()
    if mode not in ("iid_trade", "block_bootstrap"):
        mode = "iid_trade"
    block_size = cfg.get("block_size")
    try:
        block_size_i = int(block_size) if block_size is not None else _default_mc_block_size(data_timeframe, len(pnl))
    except (TypeError, ValueError):
        block_size_i = _default_mc_block_size(data_timeframe, len(pnl))
    block_size_i = max(1, min(block_size_i, max(1, len(pnl))))

    base_note = (
        "riskOfRuin is a bootstrap estimate from resampled closed-trade PnL paths, not a structural market probability."
    )
    if not pnl:
        return {
            "simulations": 0,
            "drawdownPct": {},
            "endingEquity": {},
            "riskOfRuin": 0.0,
            "method": "trade_pnl_bootstrap",
            "mode": mode,
            "blockSize": block_size_i,
            "note": base_note + " No trades — MC skipped.",
        }

    sims = int(cfg.get("simulations", 300) or 300)
    sims = min(max(sims, 50), 2000)
    ruin_dd = float(cfg.get("ruin_dd_pct", 50.0) or 50.0)
    dd_vals = []
    end_vals = []
    ruin_count = 0
    for _ in range(sims):
        if mode == "block_bootstrap":
            seq = _mc_resample_pnl_blocks(pnl, block_size_i)
        else:
            seq = _mc_resample_pnl_iid(pnl)
        eq = [float(initial_capital)]
        cur = float(initial_capital)
        for x in seq:
            cur += x
            eq.append(cur)
        max_dd = _compute_path_max_dd(eq)
        dd_vals.append(max_dd)
        end_vals.append(eq[-1])
        if max_dd >= ruin_dd:
            ruin_count += 1
    dd_vals.sort()
    end_vals.sort()

    def pctile(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        idx = int((len(values) - 1) * p)
        return float(values[idx])

    mode_note = (
        "IID resampling of individual trade PnL (ignores serial correlation)."
        if mode == "iid_trade"
        else f"Block bootstrap (block_size={block_size_i}) preserves short-run serial correlation in trade PnL order."
    )
    return {
        "simulations": sims,
        "drawdownPct": {
            "p50": round(pctile(dd_vals, 0.50), 4),
            "p90": round(pctile(dd_vals, 0.90), 4),
            "p95": round(pctile(dd_vals, 0.95), 4),
        },
        "endingEquity": {
            "p50": round(pctile(end_vals, 0.50), 2),
            "p10": round(pctile(end_vals, 0.10), 2),
            "p90": round(pctile(end_vals, 0.90), 2),
        },
        "riskOfRuin": round(ruin_count / sims, 6),
        "method": "trade_pnl_bootstrap",
        "mode": mode,
        "blockSize": block_size_i if mode == "block_bootstrap" else None,
        "note": f"{base_note} {mode_note}",
    }


def _run_regime_analysis(ohlc: list[dict], trades: list[dict], cfg: dict | None = None) -> dict:
    cfg = cfg or {}
    if not ohlc or not trades:
        return {"regimes": {}, "sessions": {}}
    df = pd.DataFrame(ohlc)
    if "date" not in df.columns:
        return {"regimes": {}, "sessions": {}}
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).set_index("date").sort_index()
    if df.empty:
        return {"regimes": {}, "sessions": {}}
    close = pd.to_numeric(df.get("close"), errors="coerce").ffill()
    ret = close.pct_change().fillna(0.0)
    vol = ret.rolling(32, min_periods=8).std().fillna(0.0)
    vol_med = float(vol.median()) if len(vol) else 0.0
    sma_fast = close.rolling(20, min_periods=5).mean()
    sma_slow = close.rolling(80, min_periods=10).mean()
    trend = (sma_fast - sma_slow).fillna(0.0)

    def classify(ts: pd.Timestamp) -> str:
        if ts not in df.index:
            idx = df.index.searchsorted(ts)
            if idx >= len(df.index):
                idx = len(df.index) - 1
            ts = df.index[idx]
        vol_state = "highVol" if float(vol.loc[ts]) > vol_med else "lowVol"
        tr = float(trend.loc[ts])
        trend_state = "trend" if abs(tr) > max(1e-9, float(close.loc[ts]) * 0.001) else "range"
        return f"{trend_state}_{vol_state}"

    reg_map: dict[str, list[float]] = {}
    ses_map: dict[str, list[float]] = {"asia": [], "europe": [], "us": []}
    for t in trades:
        entry = t.get("entryDate") or t.get("date")
        if not entry:
            continue
        try:
            ts = pd.Timestamp(entry)
        except Exception:
            continue
        key = classify(ts)
        reg_map.setdefault(key, []).append(float(t.get("pnl", 0.0) or 0.0))
        h = ts.hour
        ses_key = "asia" if 0 <= h < 8 else ("europe" if 8 <= h < 14 else "us")
        ses_map.setdefault(ses_key, []).append(float(t.get("pnl", 0.0) or 0.0))

    def summarize(pnls: list[float]) -> dict:
        wins = [x for x in pnls if x > 0]
        losses = [x for x in pnls if x < 0]
        gross_p = sum(wins)
        gross_l = abs(sum(losses))
        bd = _profit_factor_detailed(gross_p, gross_l)
        return {
            "trades": len(pnls),
            "expectancyUsd": round(sum(pnls) / len(pnls), 4) if pnls else 0.0,
            "winRate": round((len(wins) / len(pnls) * 100.0), 4) if pnls else 0.0,
            "profitFactor": bd["value"],
            "profitFactorStatus": bd["status"],
            "totalPnl": round(sum(pnls), 4),
        }

    return {
        "regimes": {k: summarize(v) for k, v in reg_map.items()},
        "sessions": {k: summarize(v) for k, v in ses_map.items()},
    }


def _run_portfolio_analysis(
    strategy_cls,
    base_data_path: str,
    base_instrument: str,
    base_timeframe: str,
    base_years: float,
    strategy_params: dict | None,
    cfg: dict | None,
) -> dict | None:
    cfg = cfg or {}
    instruments = cfg.get("instruments")
    if not isinstance(instruments, list) or len(instruments) < 2:
        return None
    rows = []
    weight_sum = 0.0
    for item in instruments:
        if not isinstance(item, dict):
            continue
        inst = str(item.get("instrument", base_instrument))
        tf = str(item.get("timeframe", base_timeframe))
        years = float(item.get("years", base_years) or base_years)
        data_file = str(item.get("data_file", ""))
        w = float(item.get("weight", 1.0) or 1.0)
        try:
            data_i, _ = load_data(base_data_path, inst, tf, years, data_file)
            out = run_backtest(strategy_cls, data_i, data_path=base_data_path, instrument=inst, strategy_params=strategy_params, lightweight=True)
            m = _safe_metrics_snapshot(out)
            rows.append({"instrument": inst, "weight": w, "metrics": m})
            weight_sum += w
        except Exception:
            continue
    if not rows:
        return None
    if weight_sum <= 0:
        weight_sum = float(len(rows))
    portfolio_ret = 0.0
    portfolio_dd = 0.0
    for r in rows:
        wn = float(r["weight"]) / weight_sum
        portfolio_ret += float(r["metrics"]["totalReturnUsd"]) * wn
        portfolio_dd += float(r["metrics"]["maxDrawdownPct"]) * wn
    return {
        "model": "independent_isolated_capital_per_instrument",
        "disclaimer": (
            "Each instrument is backtested with the full initial_capital in isolation — no shared equity pool, "
            "no cross-margin, no correlated drawdown path. Weighted return/DD are linear blends of per-run metrics, "
            "not a multi-asset portfolio simulation."
        ),
        "instruments": rows,
        "summary": {
            "weightedIndependentReturnUsd": round(portfolio_ret, 4),
            "weightedIndependentMaxDrawdownPct": round(portfolio_dd, 4),
            "count": len(rows),
            "weightedReturnUsd": round(portfolio_ret, 4),
            "weightedMaxDrawdownPct": round(portfolio_dd, 4),
            "weightedReturnUsdDeprecatedAlias": True,
        },
    }


def _engine_methodology_notes() -> dict[str, str]:
    """Short methodology strings for manifest / export (single source in engine)."""
    return {
        "profitFactor": (
            "Gross winning trade PnL sum divided by absolute gross losing trade PnL sum. "
            "When there are no losing trades, profitFactor is null (undefined) with status undefined_no_losing_trades — not 999."
        ),
        "monteCarloRiskOfRuin": (
            "Fraction of bootstrap paths where max drawdown (%) exceeds ruin_dd_pct. "
            "Interpret as a resampling stress test, not a calibrated tail probability."
        ),
        "expectancyR": (
            "Expectancy in R units uses average loss magnitude as rough risk proxy; not broker-reported R-multiple per trade."
        ),
        "walkForwardGuardrails": (
            "Fold-level hints are heuristics (short windows, low trade count); they are not proof of leakage or robustness."
        ),
        "executionCosts": (
            "Fees are in pnlcomm. Broker slippage is applied via set_slippage_perc before pnlcomm. "
            "Per-trade slippageCost is a parallel notional estimate for charts — do not treat fees+slippageCost as additive to PnL."
        ),
        "executionLatencyProxy": (
            "execution_model.slippage_latency_proxy_bars (alias latency_bars) adds mean_abs_return×bars to slippage_perc; "
            "it does not delay orders or signals."
        ),
        "executionVolatilityCalibration": (
            "When execution model is enabled, volatility (for slippage_vol_mult) and mean |bar return| (for latency proxy) "
            "are computed on the first min(500, max(3, n/4)) bars only — not the full sample — to avoid lookahead bias."
        ),
        "drawdownDuration": (
            "maxDrawdownDurationBars/Days measures the longest single drawdown period (peak-to-recovery). "
            "timeToRecovery is bars/days from the deepest trough back to the preceding peak (null if not recovered). "
            "underwaterPct is the average DD% across all bars — combining depth and duration."
        ),
        "tradePnlDistribution": (
            "Histogram, percentiles, skewness, kurtosis, and tail CVaR from closed-trade PnL. "
            "concentration.top5PnlPct shows what fraction of total return comes from the top 5 trades — "
            "high concentration signals fragile edge dependent on outliers."
        ),
        "stressMultiplier": (
            "execution_model.stress_multiplier > 1.0 multiplies the execution-model slippage/spread penalty "
            "by that factor before adding to base slippage_perc. Use for scenario stress testing."
        ),
        "portfolioModel": (
            "independent_isolated_capital_per_instrument: each instrument backtested with full initial_capital "
            "in isolation. Weighted metrics are linear blends, NOT a multi-asset portfolio simulation with "
            "shared equity, cross-margin, or correlated drawdown paths."
        ),
        "bootstrapCI": (
            "Trade-level bootstrap resampling (i.i.d.) for 95% CI on mean PnL, total return, and trade-level Sharpe. "
            "Serial correlation between trades is NOT captured — CIs may be too narrow for clustered strategies."
        ),
        "payoffDecomposition": (
            "Edge equation: WinRate × AvgWin - LossRate × AvgLoss. Payoff ratio = AvgWin / AvgLoss. "
            "Kelly fraction assumes i.i.d. Bernoulli trades — real position sizing should be much smaller."
        ),
        "trialCount": (
            "Total configurations tested in this session (main run + param_test OAT runs + sweep samples). "
            "naiveAdjustedAlpha = 0.05 / trialCount is a rough Bonferroni correction — not exact when tests are correlated."
        ),
        "primaryRunScope": (
            "Headline metrics (final equity, trade count, equity curve, trades list) always come from exactly ONE "
            "full-sample backtest on all loaded bars. Out-of-sample split and walk-forward only ADD extra lightweight "
            "runs on train/test time slices under `validation` in the JSON — they do not replace or rescale the primary run. "
            "Expect the same primary numbers for single vs OOS vs WF when strategy params and data are unchanged."
        ),
        "paramTestTrainOnly": (
            "When train_only=true, param test OAT sweep runs on the first train_ratio fraction of data. "
            "The best param by totalReturnUsd is evaluated once on the holdout. "
            "Prevents optimizing on the same data used for final validation."
        ),
        "propRedFlags": (
            "Automated red-flag detection scanning results for suspicious patterns: "
            "extremely high Sharpe with few trades, no losing trades, PF undefined, "
            "single run without validation, execution model disabled, smooth equity, CI spanning zero, "
            "concentrated PnL. Trust levels: not_trustworthy / low_trust / cautious / acceptable."
        ),
    }


def _compute_prop_red_flags(
    metrics: dict,
    trades: list[dict],
    validation_mode: str,
    execution_enabled: bool,
    equity_curve: list[float],
    bootstrap_ci: dict | None,
) -> dict:
    """
    Structured red-flag detection for prop-level trust assessment.
    Each flag: {id, severity: 'critical'|'warning'|'info', message, detail}.
    """
    flags: list[dict] = []
    tc = int(metrics.get("tradeCount", 0) or 0)
    sharpe = float(metrics.get("sharpeRatio", 0.0) or 0.0)
    pf_status = str(metrics.get("profitFactorStatus", "") or "")
    pf_raw = metrics.get("profitFactor")
    max_dd = float(metrics.get("maxDrawdownPct", 0.0) or 0.0)
    win_rate = float(metrics.get("winRate", 0.0) or 0.0)
    total_return = float(metrics.get("totalReturnUsd", 0.0) or 0.0)

    if tc < 10:
        flags.append({
            "id": "too_few_trades",
            "severity": "critical",
            "message": f"Only {tc} trades — insufficient for any statistical conclusion.",
            "detail": "Prop minimum is typically 50–100+ trades across varied market conditions.",
        })
    elif tc < 30:
        flags.append({
            "id": "low_trade_count",
            "severity": "warning",
            "message": f"Low trade count ({tc}) — metrics have high variance.",
            "detail": "Bootstrap CI widths reflect this uncertainty; treat headline numbers with caution.",
        })

    if abs(sharpe) > 3.0 and tc < 100:
        flags.append({
            "id": "suspicious_sharpe",
            "severity": "critical",
            "message": f"Sharpe {sharpe:.2f} with only {tc} trades — likely sample artifact.",
            "detail": "Extremely high Sharpe from bar returns on small samples is a classic red flag. Verify with longer OOS.",
        })
    elif abs(sharpe) > 2.5 and tc < 200:
        flags.append({
            "id": "high_sharpe_small_sample",
            "severity": "warning",
            "message": f"Sharpe {sharpe:.2f} at {tc} trades may not survive OOS.",
            "detail": "Annualized bar-return Sharpe is sensitive to data frequency and sample length.",
        })

    if pf_status == "undefined_no_losing_trades":
        flags.append({
            "id": "no_losing_trades",
            "severity": "critical",
            "message": "No losing trades — PF is undefined (sentinel). This is not infinite edge.",
            "detail": "A strategy with zero losses on historical data is either curve-fit, has too few trades, or uses a very short window.",
        })

    pnl_values = [float(t.get("pnl", 0.0) or 0.0) for t in trades if t.get("pnl") is not None]
    losing_periods = sum(1 for p in pnl_values if p < 0)
    if tc >= 20 and losing_periods == 0:
        flags.append({
            "id": "no_losses_in_sample",
            "severity": "critical",
            "message": "No losing trades in 20+ trades — extreme curve-fit signal.",
        })
    elif tc >= 10 and win_rate > 95:
        flags.append({
            "id": "unrealistic_win_rate",
            "severity": "warning",
            "message": f"Win rate {win_rate:.1f}% — unrealistically high; check for look-ahead bias.",
        })

    if validation_mode == "single":
        flags.append({
            "id": "no_validation",
            "severity": "warning",
            "message": "Single run without OOS/WF validation — highest overfitting risk.",
            "detail": "Results reflect one trajectory; enable Walk-Forward or OOS split for basic robustness check.",
        })

    if not execution_enabled:
        flags.append({
            "id": "execution_off",
            "severity": "warning",
            "message": "Execution model disabled — no slippage/spread penalty applied.",
            "detail": "Real trading always has execution costs. Enable the execution model for realistic results.",
        })

    if validation_mode == "single" and not execution_enabled:
        flags.append({
            "id": "minimal_config",
            "severity": "critical",
            "message": "Single run + no execution model = minimum credibility configuration.",
            "detail": "This is an exploration run. Do not treat these numbers as evidence of edge.",
        })

    if max_dd < 0.5 and tc >= 15 and total_return > 0:
        flags.append({
            "id": "suspiciously_low_dd",
            "severity": "info",
            "message": f"Max DD only {max_dd:.2f}% — verify this isn't an artifact of short/narrow data window.",
        })

    if len(equity_curve) > 20:
        diffs = [equity_curve[i] - equity_curve[i - 1] for i in range(1, len(equity_curve))]
        positive_diffs = sum(1 for d in diffs if d >= 0)
        smoothness = positive_diffs / len(diffs) if diffs else 0
        if smoothness > 0.92 and tc >= 10:
            flags.append({
                "id": "too_smooth_equity",
                "severity": "warning",
                "message": f"Equity curve rises {smoothness*100:.0f}% of bars — may be under-modeled pain.",
                "detail": "A very smooth equity curve often signals granularity artifacts or insufficient execution modeling.",
            })

    if bootstrap_ci:
        mean_ci = bootstrap_ci.get("meanPnl")
        if isinstance(mean_ci, dict):
            ci_low = float(mean_ci.get("ciLow", 0) or 0)
            ci_high = float(mean_ci.get("ciHigh", 0) or 0)
            if ci_low < 0 < ci_high:
                flags.append({
                    "id": "ci_spans_zero",
                    "severity": "warning",
                    "message": "Bootstrap CI for mean PnL includes zero — edge not statistically confirmed.",
                    "detail": f"95% CI: [{ci_low:.2f}, {ci_high:.2f}]. Cannot reject null hypothesis of no edge.",
                })

    pnl_sorted = sorted(pnl_values, reverse=True)
    if len(pnl_sorted) >= 5 and total_return > 0:
        top5_sum = sum(pnl_sorted[:5])
        top5_pct = (top5_sum / total_return) * 100.0 if total_return > 0 else 0.0
        if top5_pct > 80:
            flags.append({
                "id": "concentrated_pnl",
                "severity": "warning",
                "message": f"Top 5 trades contribute {top5_pct:.0f}% of total profit — edge depends on outliers.",
                "detail": "Remove the top 5 trades and check if the strategy is still profitable.",
            })

    critical_count = sum(1 for f in flags if f["severity"] == "critical")
    warning_count = sum(1 for f in flags if f["severity"] == "warning")

    if critical_count > 0:
        trust_level = "not_trustworthy"
        trust_label = "Results have critical red flags — do not treat as evidence of edge."
    elif warning_count >= 3:
        trust_level = "low_trust"
        trust_label = "Multiple warnings — significant concerns remain."
    elif warning_count > 0:
        trust_level = "cautious"
        trust_label = "Some concerns — verify with stricter conditions before trusting."
    else:
        trust_level = "acceptable"
        trust_label = "No major red flags detected — still requires OOS confirmation."

    return {
        "flags": flags,
        "criticalCount": critical_count,
        "warningCount": warning_count,
        "trustLevel": trust_level,
        "trustLabel": trust_label,
    }


def _build_cost_attribution(trades: list[dict] | None, total_return_usd: float) -> dict:
    rows = trades or []
    tc = len(rows)
    total_fees = sum(float(t.get("fees", 0.0) or 0.0) for t in rows)
    total_slip = sum(float(t.get("slippageCost", 0.0) or 0.0) for t in rows)
    sum_pnl = sum(float(t.get("pnl", 0.0) or 0.0) for t in rows)
    gross_abs = sum(abs(float(t.get("pnl", 0.0) or 0.0)) for t in rows)
    out: dict = {
        "totalFees": round(total_fees, 6),
        "totalSlippageCost": round(total_slip, 6),
        "tradeCount": tc,
        "avgFeePerTrade": round(total_fees / tc, 6) if tc else 0.0,
        "avgSlippagePerTrade": round(total_slip / tc, 6) if tc else 0.0,
        "sumClosedTradePnl": round(sum_pnl, 6),
        "interpretationModel": (
            "Fees are embedded in pnlcomm. Broker slippage model already moved fill prices before pnlcomm. "
            "slippageCost per trade is a parallel notional×slippage estimate for reporting — do not add it to PnL again."
        ),
        "definitions": {
            "fees": "Sum of Backtrader closed-trade commission per trade (already reflected in pnlcomm).",
            "slippageCost": "Parallel estimate from notional × configured slippage_perc (mirrors broker slippage for attribution only).",
            "pnl": "Closed-trade PnL after commission (pnlcomm), with prices already affected by set_slippage_perc.",
        },
    }
    denom = abs(float(total_return_usd)) if abs(float(total_return_usd)) > 1e-9 else (abs(sum_pnl) if abs(sum_pnl) > 1e-9 else 0.0)
    if denom > 1e-12:
        out["feesToAbsNetReturnRatio"] = round(total_fees / denom, 6)
    else:
        out["feesToAbsNetReturnRatio"] = None
    if gross_abs > 1e-9:
        out["feesToGrossAbsClosedPnlRatio"] = round(total_fees / gross_abs, 6)
        out["slippageEstimateToGrossAbsClosedPnlRatio"] = round(total_slip / gross_abs, 6)
    else:
        out["feesToGrossAbsClosedPnlRatio"] = None
        out["slippageEstimateToGrossAbsClosedPnlRatio"] = None
    out["deprecatedCombinedExecutionCostsRatio"] = {
        "note": "Legacy (fees+slippageEstimate)/denom double-counts economic meaning vs pnlcomm — use feesToAbsNetReturnRatio + slippage line separately.",
        "value": round((total_fees + total_slip) / denom, 6) if denom > 1e-12 else None,
    }
    return out


def _execution_slippage_calibration_stats(close_series: pd.Series) -> tuple[float, float, int]:
    """Std and mean |pct_change| on the first calibration window only (no full-sample lookahead)."""
    s = pd.to_numeric(close_series, errors="coerce").dropna()
    n = len(s)
    if n <= 2:
        return 0.0, 0.0, 0
    cal_n = min(500, max(3, n // 4))
    cal = s.iloc[:cal_n]
    ch = cal.pct_change().dropna()
    if len(ch) < 2:
        return 0.0, 0.0, cal_n
    return float(ch.std()), float(ch.abs().mean()), cal_n


def _build_execution_summary(data: pd.DataFrame, trades: list[dict], cfg: dict | None) -> dict:
    cfg = cfg or {}
    enabled = bool(cfg.get("enabled", False))
    if not enabled or data.empty:
        return {"enabled": False}
    close = pd.to_numeric(data.get("close"), errors="coerce").dropna()
    vol, _mean_abs_cal, cal_bars = _execution_slippage_calibration_stats(close)
    spread_bps = float(cfg.get("spread_bps", 0.0) or 0.0)
    slippage_mult = float(cfg.get("slippage_vol_mult", 0.0) or 0.0)
    latency_bars = int(cfg.get("slippage_latency_proxy_bars", cfg.get("latency_bars", 0)) or 0)
    effective_extra_slippage_pct = (spread_bps / 10000.0) + vol * slippage_mult
    total_fees = sum(float(t.get("fees", 0.0) or 0.0) for t in (trades or []))
    total_slippage_cost = sum(float(t.get("slippageCost", 0.0) or 0.0) for t in (trades or []))
    holding_values = [float(t.get("holdingMinutes", 0.0) or 0.0) for t in (trades or []) if t.get("holdingMinutes") is not None]
    avg_holding_minutes = (sum(holding_values) / len(holding_values)) if holding_values else 0.0

    return {
        "enabled": True,
        "spreadBps": spread_bps,
        "volatility": round(vol, 8),
        "volatilityCalibrationBars": cal_bars,
        "volatilityCalibrationNote": "Std of returns on first N bars only (matches broker slippage calibration; no full-sample lookahead).",
        "slippageVolMultiplier": slippage_mult,
        "slippageLatencyProxyBars": latency_bars,
        "latencyModel": "adds_to_slippage_perc_not_order_delay",
        "latencyBarsDeprecatedAlias": bool(cfg.get("latency_bars") is not None and cfg.get("slippage_latency_proxy_bars") is None),
        "effectiveExtraSlippagePct": round(effective_extra_slippage_pct, 8),
        "tradeCount": len(trades or []),
        "totalFees": round(total_fees, 6),
        "totalSlippageCost": round(total_slippage_cost, 6),
        "avgHoldingMinutes": round(avg_holding_minutes, 4),
    }


def _build_forward_bridge(metrics: dict, cfg: dict | None) -> dict | None:
    cfg = cfg or {}
    if not cfg:
        return None
    baseline = cfg.get("baseline_final_equity")
    if baseline is None:
        return {"mode": str(cfg.get("mode", "paper_shadow")), "status": "baseline_missing"}
    try:
        baseline_v = float(baseline)
        current_v = float(metrics.get("finalEquity", 0.0) or 0.0)
    except Exception:
        return {"mode": str(cfg.get("mode", "paper_shadow")), "status": "invalid_baseline"}
    drift = ((current_v - baseline_v) / baseline_v) * 100.0 if baseline_v != 0 else 0.0
    return {
        "mode": str(cfg.get("mode", "paper_shadow")),
        "baselineFinalEquity": baseline_v,
        "currentFinalEquity": current_v,
        "driftPct": round(drift, 6),
        "status": "ok",
    }


def _build_run_diff(current_metrics: dict, baseline_metrics: dict | None) -> dict | None:
    if not isinstance(baseline_metrics, dict) or not baseline_metrics:
        return None
    diff_map = {}
    keys = (
        "finalEquity",
        "totalReturnUsd",
        "maxDrawdownPct",
        "profitFactor",
        "winRate",
        "sortinoRatio",
        "calmarRatio",
        "tradeCount",
    )
    for key in keys:
        cur = current_metrics.get(key)
        base = baseline_metrics.get(key)
        if cur is None or base is None:
            continue
        try:
            cur_f = float(cur)
            base_f = float(base)
        except Exception:
            continue
        delta = cur_f - base_f
        delta_pct = (delta / abs(base_f) * 100.0) if abs(base_f) > 1e-12 else 0.0
        diff_map[key] = {
            "current": round(cur_f, 8),
            "baseline": round(base_f, 8),
            "delta": round(delta, 8),
            "deltaPct": round(delta_pct, 8),
        }
    if not diff_map:
        return None
    return diff_map


def _build_promote_evidence(
    quality_gate: dict | None,
    validation: dict | None,
    robustness: dict | None,
    experiment_cfg: dict | None,
) -> dict:
    quality_gate = quality_gate or {}
    validation = validation or {}
    robustness = robustness or {}
    experiment_cfg = experiment_cfg or {}
    gate_passed = bool(quality_gate.get("passed", False))
    promote_requested = bool(experiment_cfg.get("promote_on_pass", False))
    fold_count = int((validation.get("summary") or {}).get("foldCount", 0) or 0)
    stability = float(robustness.get("stabilityScore", 0.0) or 0.0)
    promote = promote_requested and gate_passed
    reason = "manual_hold"
    if promote:
        reason = "gate_passed_and_promote_requested"
    elif promote_requested and not gate_passed:
        reason = "gates_failed"
    return {
        "gatePassed": gate_passed,
        "promoteRequested": promote_requested,
        "foldCount": fold_count,
        "stabilityScore": round(stability, 6),
        "promote": promote,
        "reason": reason,
    }


def _to_module_name(name: str) -> str:
    return (name or "module").replace(" ", "_").replace("-", "_").replace(".", "_") or "module"


def _call_with_params(fn, df: pd.DataFrame, params: dict):
    """Call fn(df) or fn(df, params) depending on signature."""
    try:
        sig = inspect.signature(fn)
        if len(sig.parameters) >= 2:
            return fn(df, params or {})
    except (ValueError, TypeError):
        pass
    return fn(df)


def _module_zone_dict_for_chart(item: dict) -> dict | None:
    """Serialize one get_zones / merged zone dict for Detailed chart (matches legacy _run_module_outputs loop)."""
    if (
        not isinstance(item, dict)
        or "date_start" not in item
        or "date_end" not in item
        or "value_low" not in item
        or "value_high" not in item
    ):
        return None
    zone = {
        "date_start": _iso_or_str(item["date_start"]),
        "date_end": _iso_or_str(item["date_end"]),
        "value_low": float(item["value_low"]),
        "value_high": float(item["value_high"]),
        "fillcolor": str(item["fillcolor"]) if item.get("fillcolor") else None,
        "name": str(item["name"]) if item.get("name") else None,
    }
    if "base_length" in item:
        zone["base_length"] = int(item["base_length"])
    if "impulse_score" in item:
        zone["impulse_score"] = int(item["impulse_score"])
    if "touches" in item:
        zone["touches"] = int(item["touches"])
    if "strength" in item:
        zone["strength"] = int(item["strength"])
    if "has_touch" in item:
        zone["has_touch"] = bool(item["has_touch"])
    if "has_gap" in item:
        zone["has_gap"] = bool(item["has_gap"])
    if "gap_type" in item:
        zone["gap_type"] = str(item["gap_type"])
    if "gap_date" in item:
        zone["gap_date"] = _iso_or_str(item["gap_date"])
    if "gap_value_low" in item:
        zone["gap_value_low"] = float(item["gap_value_low"])
    if "gap_value_high" in item:
        zone["gap_value_high"] = float(item["gap_value_high"])
    if "inducements" in item and isinstance(item["inducements"], list):
        zone["inducements"] = item["inducements"]
    if "inducement_count" in item:
        zone["inducement_count"] = int(item["inducement_count"])
    if "inducement_points" in item:
        zone["inducement_points"] = int(item["inducement_points"])
    ptf = item.get("_primary_tf") or item.get("_source_tf")
    if ptf:
        zone["primaryTf"] = str(ptf)
    mtfs = item.get("_merged_tfs")
    if isinstance(mtfs, list) and mtfs:
        zone["mergedTimeframes"] = [str(x) for x in mtfs]
    return zone


def _append_sd_chart_zones_from_merge_flat(flat_sd: list, zones: list) -> None:
    """Detailed chart: export all Demand/Supply z get_zones, ne jen merge aktivní na posledním baru.

    merged_list z build_merged_sd_zones je záměrně omezený na ``si <= d_idx <= ei`` (živé zóny pro MTF),
    takže po backtestu tam skoro nic není — obchody ve výsledcích pak nemají nakreslené zóny.
    """
    seen: set[tuple] = set()
    for item in flat_sd:
        if not isinstance(item, dict) or item.get("name") not in ("Demand", "Supply"):
            continue
        key = (
            str(item.get("name")),
            round(float(item.get("value_low", 0.0)), 6),
            round(float(item.get("value_high", 0.0)), 6),
            str(item.get("date_start", "")),
            str(item.get("date_end", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        zd = _module_zone_dict_for_chart(item)
        if zd:
            zones.append(zd)


def _run_module_outputs_in_engine(
    strategy_dir: str,
    ohlc: list[dict],
    applied_modules: list[dict] | None,
    source_timeframe: str | None = None,
    work_timeframe: str | None = None,
    strategy_params: dict | None = None,
) -> dict[str, dict]:
    """Run detect/get_line/get_zones in-container for applied modules."""
    if not applied_modules or not ohlc:
        return {}

    df = pd.DataFrame(ohlc)
    if "date" in df.columns:
        df["datetime"] = pd.to_datetime(df["date"])
        df = df.set_index("datetime")
    if "open" not in df.columns and "Open" in df.columns:
        df["open"] = df["Open"]
    if "high" not in df.columns and "High" in df.columns:
        df["high"] = df["High"]
    if "low" not in df.columns and "Low" in df.columns:
        df["low"] = df["Low"]
    if "close" not in df.columns and "Close" in df.columns:
        df["close"] = df["Close"]
    if "volume" not in df.columns:
        df["volume"] = 0.0

    inferred_source_tf = _normalize_tf(source_timeframe) or _infer_data_timeframe(df)
    inferred_work_tf = _normalize_tf(work_timeframe) or inferred_source_tf

    outputs: dict[str, dict] = {}
    modules_dir = Path(strategy_dir) / "modules"
    if not modules_dir.exists():
        return outputs

    sp_flat = strategy_params if isinstance(strategy_params, dict) else {}
    chart_zone_tfs = _parse_strategy_zone_timeframes(sp_flat)
    chart_zone_tf = _coarsest_zone_tf_for_chart(chart_zone_tfs) if chart_zone_tfs else None

    for mod in applied_modules:
        name = str(mod.get("name") or "")
        params = dict(mod.get("params") or {})
        params.setdefault("work_timeframe", inferred_work_tf)
        mod_name = _to_module_name(name)
        mod_path = modules_dir / f"{mod_name}.py"
        if not mod_path.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"mod_{mod_name}", mod_path)
            mod_obj = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod_obj
            spec.loader.exec_module(mod_obj)

            markers = []
            lines = []
            zones = []
            module_df = df
            sd_params_for_merge: dict | None = None
            if getattr(mod_obj, "get_zones", None):
                mp_all = sp_flat.get("module_params")
                if isinstance(mp_all, dict) and mp_all:
                    merged_nested: dict = {}
                    for _mn, val in mp_all.items():
                        if isinstance(val, dict):
                            merged_nested.update(val)
                    if merged_nested:
                        params = {**merged_nested, **params}
                zmb = sp_flat.get("zone_max_bars")
                if zmb is not None and str(zmb).strip() != "":
                    try:
                        params["zone_extend_right_bars"] = int(float(zmb))
                    except (TypeError, ValueError):
                        pass
                for src_k, dst_k in (
                    ("max_base_length", "max_base_length"),
                    ("require_inducement", "require_inducement"),
                    ("base_bar_range_in_zone_min", "base_bar_range_in_zone_min"),
                    ("base_body_in_zone_min", "base_body_in_zone_min"),
                    ("zone_overlap_trim_ratio", "zone_overlap_trim_ratio"),
                    ("max_pivot_candle_range_atr", "max_pivot_candle_range_atr"),
                ):
                    if src_k in sp_flat and sp_flat[src_k] is not None:
                        params[dst_k] = sp_flat[src_k]
                sd_params_for_merge = dict(params)
                if chart_zone_tf:
                    params["timeframe"] = chart_zone_tf
            module_tf = _normalize_tf(params.get("timeframe"))
            if _should_resample(inferred_work_tf or inferred_source_tf, module_tf):
                module_df = _resample_ohlcv(df, module_tf)
            # Swing HL / S&D: data_timeframe must match the bar spacing of the OHLC passed in.
            # Otherwise get_swings resamples again and zones differ from sd_zone_strategy (pre-resampled zoh).
            inferred_module_tf = _infer_data_timeframe(module_df)
            if inferred_module_tf:
                params["data_timeframe"] = inferred_module_tf
            else:
                params.setdefault("data_timeframe", inferred_work_tf or inferred_source_tf)

            if hasattr(mod_obj, "detect"):
                result = _call_with_params(mod_obj.detect, module_df, params)
                if isinstance(result, list):
                    for item in result:
                        if isinstance(item, dict) and "date" in item and "type" in item and "value" in item:
                            markers.append({
                                "date": _iso_or_str(item["date"]),
                                "type": str(item["type"]).lower(),
                                "value": float(item["value"]),
                            })

            if hasattr(mod_obj, "get_line"):
                result = _call_with_params(mod_obj.get_line, module_df, params)
                if isinstance(result, dict):
                    for line_name, data in result.items():
                        pts: list[dict] = []
                        color = None
                        segments = None
                        if isinstance(data, list):
                            pts = [
                                lp
                                for p in data
                                if isinstance(p, dict) and (lp := _module_line_point(p)) is not None
                            ]
                        elif isinstance(data, dict) and "data" in data:
                            pts = [
                                lp
                                for p in data["data"]
                                if isinstance(p, dict) and (lp := _module_line_point(p)) is not None
                            ]
                            color = data.get("color")
                            segments = data.get("segments")
                        if pts:
                            if isinstance(segments, list) and len(segments) > 0:
                                for seg in segments:
                                    if not isinstance(seg, dict):
                                        continue
                                    if "from" not in seg or "to" not in seg or "color" not in seg:
                                        continue
                                    try:
                                        i0, i1 = int(seg["from"]), int(seg["to"]) + 1
                                    except (TypeError, ValueError):
                                        continue
                                    if i0 < 0 or i1 > len(pts) or i0 >= i1:
                                        continue
                                    seg_pts = pts[i0:i1]
                                    if seg_pts:
                                        lines.append({
                                            "name": str(line_name),
                                            "data": seg_pts,
                                            "color": str(seg["color"]),
                                        })
                            else:
                                line_obj = {"name": str(line_name), "data": pts}
                                if color:
                                    line_obj["color"] = str(color)
                                lines.append(line_obj)
                elif isinstance(result, list):
                    pts = [
                        lp
                        for p in result
                        if isinstance(p, dict) and (lp := _module_line_point(p)) is not None
                    ]
                    if pts:
                        lines.append({"name": "line", "data": pts})

            if hasattr(mod_obj, "get_zones"):
                merged_sd_chart = False
                if (
                    sd_params_for_merge is not None
                    and chart_zone_tfs
                    and callable(getattr(mod_obj, "get_zones", None))
                ):
                    prefer = bool(sp_flat.get("prefer_higher_tf", True))
                    try:
                        overlap_th = float(sp_flat.get("zone_price_overlap_threshold", 0.25))
                    except (TypeError, ValueError):
                        overlap_th = 0.25

                    def _mp_for_zone_tf(zone_tf: str) -> dict:
                        mp = dict(sd_params_for_merge)
                        tf_n = str(zone_tf).strip()
                        mp["timeframe"] = tf_n
                        mp["data_timeframe"] = _normalize_tf(tf_n) or tf_n
                        zmb_l = sp_flat.get("zone_max_bars")
                        if zmb_l is not None and str(zmb_l).strip() != "":
                            try:
                                mp["zone_extend_right_bars"] = int(float(zmb_l))
                            except (TypeError, ValueError):
                                pass
                        return mp

                    disk_on = str(_eget("SD_ZONE_DISK_CACHE", "1")).strip().lower() not in (
                        "0",
                        "false",
                        "no",
                        "off",
                    )
                    fp = (_eget("HOST_DATASET_FINGERPRINT") or "").strip() or None
                    cdir_raw = (_eget("DATA_CACHE_PATH") or "").strip()
                    cache_dir = Path(cdir_raw) if cdir_raw else None
                    mem: dict = {}
                    try:
                        _merged_live, flat_for_chart = build_merged_sd_zones(
                            df,
                            chart_zone_tfs,
                            mod_obj.get_zones,
                            _mp_for_zone_tf,
                            prefer,
                            overlap_th,
                            get_zones_cached=_get_sd_zones_cached_engine,
                            sd_cache=mem,
                            cache_dir=cache_dir,
                            data_fingerprint=fp,
                            disk_cache_enabled=disk_on,
                        )
                        _append_sd_chart_zones_from_merge_flat(flat_for_chart, zones)
                        merged_sd_chart = True
                    except Exception as merge_exc:
                        print(
                            f"[engine] MTF merged moduleOutputs fallback to single TF: {merge_exc}",
                            file=sys.stderr,
                            flush=True,
                        )

                if not merged_sd_chart:
                    result = _call_with_params(mod_obj.get_zones, module_df, params)
                    if isinstance(result, list):
                        for item in result:
                            zd = _module_zone_dict_for_chart(item)
                            if zd:
                                zones.append(zd)

            outputs[name] = {"markers": markers, "lines": lines, "zones": zones}
        except Exception as e:
            print(f"[engine] module output error {name}: {e}", file=sys.stderr, flush=True)
        finally:
            if f"mod_{mod_name}" in sys.modules:
                del sys.modules[f"mod_{mod_name}"]
    return outputs


def load_strategy(strategy_path: str):
    """Dynamically load strategy module from path."""
    path = Path(strategy_path)
    if not path.exists():
        raise FileNotFoundError(f"Strategy not found: {strategy_path}")

    # Add strategy directory to sys.path so "from modules.X" and "from indicators.X" work
    strategy_dir = path.parent
    strategy_dir_str = str(strategy_dir.resolve())
    if strategy_dir_str not in sys.path:
        sys.path.insert(0, strategy_dir_str)

    spec = importlib.util.spec_from_file_location("strategy_module", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["strategy_module"] = module
    spec.loader.exec_module(module)

    # Find Strategy class (first bt.Strategy subclass)
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, type) and issubclass(obj, bt.Strategy):
            return obj
    raise ValueError("No bt.Strategy subclass found in strategy file")


def _filter_params_for_strategy(strategy_cls, params: dict) -> dict:
    """Keep only params that the strategy class accepts (avoids unexpected keyword errors)."""
    if not params:
        return {}
    try:
        accepted = {x[0] for x in strategy_cls.params._getitems()}
    except Exception:
        return params
    return {k: v for k, v in params.items() if k in accepted}


def load_data(
    data_path: str,
    instrument: str,
    timeframe: str,
    years: float = 1.0,
    data_file: str = "",
) -> tuple[pd.DataFrame, dict]:
    """
    Load OHLCV data and apply central timeframe pipeline.
    Returns (dataframe, metadata).
    """
    base = Path(data_path)
    cache_dir_raw = _eget("DATA_CACHE_PATH", "")
    cache_dir = Path(cache_dir_raw).resolve() if cache_dir_raw else None
    _maybe_prune_backtest_disk_cache(cache_dir)

    # Explicit file path (e.g. mock/NQ_5Y.csv)
    if data_file:
        p = _resolve_safe_data_path(base, data_file)
        if p.exists():
            return _load_file(p, years, timeframe, cache_dir)

    # Try common naming
    candidates = [
        base / "mock" / f"{instrument}_5Y.csv",
        base / "mock" / f"{instrument}.csv",
        base / "futures_30m" / f"{instrument}.txt",
        base / f"{instrument}_{timeframe}.parquet",
        base / f"{instrument}.parquet",
    ]
    for p in candidates:
        if p.exists():
            return _load_file(p, years, timeframe, cache_dir)

    raise FileNotFoundError(f"No data found for {instrument} in {base}")


def _normalize_ohlcv_columns(df: pd.DataFrame) -> pd.DataFrame:
    col_map = {}
    for c in df.columns:
        l = str(c).lower()
        if "close" in l or "last" in l:
            col_map[c] = "close"
        elif "open" in l:
            col_map[c] = "open"
        elif "high" in l:
            col_map[c] = "high"
        elif "low" in l:
            col_map[c] = "low"
        elif "date" in l or "time" in l:
            col_map[c] = "datetime"
        elif "volume" in l:
            col_map[c] = "volume"
    out = df.rename(columns=col_map)

    if "datetime" in out.columns:
        out["datetime"] = pd.to_datetime(out["datetime"], errors="coerce")
        out = out.dropna(subset=["datetime"]).set_index("datetime")
    elif isinstance(out.index, pd.DatetimeIndex):
        pass
    else:
        try:
            out.index = pd.to_datetime(out.index, errors="coerce")
            out = out[~out.index.isna()]
        except Exception:
            pass

    out = out.sort_index()
    if "volume" not in out.columns:
        out["volume"] = 1000.0
        try:
            out.attrs["volumeIsSyntheticPlaceholder"] = True
        except Exception:
            pass
        print(
            "[engine] Data has no volume column — using synthetic volume=1000 for Backtrader feed; "
            "volume-dependent logic is not realistic.",
            file=sys.stderr,
            flush=True,
        )
    else:
        try:
            out.attrs["volumeIsSyntheticPlaceholder"] = False
        except Exception:
            pass

    for c in ("open", "high", "low", "close", "volume"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    out = out.dropna(subset=[c for c in ("open", "high", "low", "close") if c in out.columns])
    return out


def _apply_years_filter(df: pd.DataFrame, years: float) -> pd.DataFrame:
    if years > 0 and len(df) > 0 and isinstance(df.index, pd.DatetimeIndex):
        cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
        return df[df.index >= cutoff]
    return df


def _build_cache_key(path: Path, years: float, target_tf: str | None) -> str:
    stat = path.stat()
    payload = f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{years}|{_normalize_tf(target_tf)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


_RESULT_CACHE: dict[str, tuple[float, dict]] = {}
_RESULT_CACHE_MAX = 128
_RESULT_CACHE_TTL_SEC = float(os.environ.get("RESULT_CACHE_TTL_SEC", "3600") or 3600)


def _result_cache_key(
    code_digest: str,
    strategy_params: dict | None,
    data_fingerprint: str,
    n_bars: int,
    lightweight: bool,
) -> str:
    params_str = json.dumps(strategy_params or {}, sort_keys=True, default=str)
    raw = f"{code_digest}|{params_str}|{data_fingerprint}|{n_bars}|{int(lightweight)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _result_cache_get(key: str) -> dict | None:
    entry = _RESULT_CACHE.get(key)
    if entry is None:
        return None
    ts, result = entry
    if time.monotonic() - ts > _RESULT_CACHE_TTL_SEC:
        _RESULT_CACHE.pop(key, None)
        return None
    return result


def _result_cache_put(key: str, result: dict) -> None:
    now = time.monotonic()
    for k, (ts, _) in list(_RESULT_CACHE.items()):
        if now - ts > _RESULT_CACHE_TTL_SEC:
            _RESULT_CACHE.pop(k, None)
    while len(_RESULT_CACHE) >= _RESULT_CACHE_MAX:
        try:
            oldest = next(iter(_RESULT_CACHE))
            del _RESULT_CACHE[oldest]
        except StopIteration:
            break
    _RESULT_CACHE[key] = (now, result)


def _resolve_safe_data_path(data_dir: Path, data_file: str) -> Path:
    normalized = (data_file or "").replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        raise ValueError("Unsafe data_file path")
    root = data_dir.resolve()
    path = (root / normalized).resolve()
    if root != path and root not in path.parents:
        raise ValueError("Unsafe data_file path")
    return path


def _read_market_data_file(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".txt":
        df = pd.read_csv(
            path,
            header=None,
            names=["Date", "Time", "open", "high", "low", "close", "volume"],
        )
        df["datetime"] = pd.to_datetime(
            df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
            format="%m/%d/%Y %H:%M",
            errors="coerce",
        )
        return df.drop(columns=["Date", "Time"], errors="ignore")
    if suffix == ".csv":
        return pd.read_csv(path)
    return pd.read_parquet(path)


def _load_file(
    path: Path,
    years: float,
    target_timeframe: str,
    cache_dir: Path | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Load/normalize/filter and optionally resample+cache data."""
    target_tf = _normalize_tf(target_timeframe)
    cache_hit = False
    cache_key = None
    if cache_dir:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_key = _build_cache_key(path, years, target_tf)
            pq_path = cache_dir / f"dataset_{cache_key}.parquet"
            meta_path = cache_dir / f"dataset_{cache_key}.meta.json"
            if pq_path.is_file() and meta_path.is_file():
                try:
                    df_cached = pd.read_parquet(pq_path)
                    meta_cached = json.loads(meta_path.read_text(encoding="utf-8"))
                    if isinstance(df_cached, pd.DataFrame) and isinstance(meta_cached, dict):
                        meta_cached["cacheHit"] = True
                        meta_cached.setdefault("cacheFormat", "parquet")
                        return df_cached, meta_cached
                except Exception:
                    pass
            pkl_path = cache_dir / f"dataset_{cache_key}.pkl"
            if pkl_path.is_file():
                try:
                    with open(pkl_path, "rb") as f:
                        cached = pickle.load(f)
                    df_cached = cached.get("df")
                    meta_cached = cached.get("meta") or {}
                    if isinstance(df_cached, pd.DataFrame):
                        meta_cached["cacheHit"] = True
                        meta_cached.setdefault("cacheFormat", "pickle_legacy")
                        return df_cached, meta_cached
                except Exception:
                    pass
        except Exception:
            pass

    load_start = time.perf_counter()
    df = _read_market_data_file(path)
    df = _normalize_ohlcv_columns(df)
    df = _apply_years_filter(df, years)
    load_ms = int((time.perf_counter() - load_start) * 1000)

    source_tf = _infer_data_timeframe(df)
    source_bars = len(df)
    resample_ms = 0
    work_tf = source_tf

    if _should_resample(source_tf, target_tf):
        resample_start = time.perf_counter()
        df = _resample_ohlcv(df, target_tf or "")
        resample_ms = int((time.perf_counter() - resample_start) * 1000)
        work_tf = _normalize_tf(target_tf) or source_tf

    stat = path.stat()
    fast_fingerprint = hashlib.sha256(
        f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}".encode("utf-8")
    ).hexdigest()[:24]

    meta = {
        "cacheHit": cache_hit,
        "cacheKey": cache_key,
        "datasetFingerprint": fast_fingerprint,
        "dataLoadMs": load_ms,
        "resampleMs": resample_ms,
        "sourceTimeframe": source_tf,
        "workTimeframe": work_tf,
        "barsIn": int(source_bars),
        "barsOut": int(len(df)),
        "sourceFile": str(path),
    }

    if cache_dir and cache_key:
        try:
            pq_path = cache_dir / f"dataset_{cache_key}.parquet"
            meta_path = cache_dir / f"dataset_{cache_key}.meta.json"
            df.to_parquet(pq_path, index=True)
            meta_path.write_text(json.dumps(meta, default=str), encoding="utf-8")
        except Exception:
            pass

    return df, meta


def _load_broker_config(data_path: str, instrument: str) -> dict | None:
    """Load broker config for instrument from data/broker_config.json."""
    config_path = Path(data_path) / "broker_config.json"
    if not config_path.exists():
        return None
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
        return config.get(instrument)
    except Exception:
        return None


def run_backtest(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str = "",
    instrument: str = "",
    strategy_params: dict | None = None,
    time_context: dict | None = None,
    lightweight: bool = False,
) -> dict:
    """Run Backtrader backtest and return results dict. lightweight=True skips heavy analytics."""
    equity_list = []
    trades_list = []
    total_bars = len(data)

    ohlc_errors, ohlc_warns = _validate_ohlc_dataframe(data)
    for w in ohlc_warns:
        print(f"[engine] OHLC validation warning: {w}", file=sys.stderr, flush=True)
    if ohlc_errors:
        _ohlc_relax = str(_eget("STRICT_OHLC_VALIDATION", "1")).strip().lower() in (
            "0",
            "false",
            "no",
            "off",
        )
        strict_ohlc = not _ohlc_relax
        msg = "; ".join(ohlc_errors)
        if strict_ohlc:
            raise ValueError(f"STRICT_OHLC_VALIDATION: {msg}")
        for e in ohlc_errors:
            print(f"[engine] OHLC validation error (continuing): {e}", file=sys.stderr, flush=True)

    code_digest_env = _eget("CODE_DIGEST", "")
    if code_digest_env and lightweight:
        tc = time_context or {}
        ds_fp = str(tc.get("datasetFingerprint") or "").strip()
        if len(data) > 0:
            data_fp = f"{ds_fp}|{len(data)}|{data.index[0]}|{data.index[-1]}" if ds_fp else f"{len(data)}|{data.index[0]}|{data.index[-1]}"
        else:
            data_fp = f"{ds_fp}|empty" if ds_fp else "empty"
        rc_key = _result_cache_key(code_digest_env, strategy_params, data_fp, len(data), lightweight)
        cached = _result_cache_get(rc_key)
        if cached is not None:
            return cached

    class EquityRecorder(bt.Strategy):
        """Records broker value at each bar, reports progress to stderr."""

        params = (("total_bars", 0),)

        def __init__(self):
            self._last_pct = -1

        def next(self):
            equity_list.append(self.broker.getvalue())
            if self.params.total_bars > 0:
                pct = min(99, int((len(self) / self.params.total_bars) * 100))
                if len(self) == 1:
                    pct = max(pct, 5)
                if pct != self._last_pct and (len(self) == 1 or pct % 5 == 0):
                    print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)
                    _emit_engine_progress(pct)
                    self._last_pct = pct

    _recorded_trade_ids = set()

    def _get_executed_price(order, default):
        """Get actual fill price from order.executed (not limit/stop price)."""
        ex = getattr(order, "executed", None)
        if ex is not None:
            p = getattr(ex, "price", None)
            if p is not None and p != 0:
                return float(p)
        return default

    def _get_price_from_history_entry(histentry, default):
        """TradeHistory.event.price = execution price (not Order object)."""
        ev = getattr(histentry, "event", None)
        if ev is not None:
            p = getattr(ev, "price", None)
            if p is not None and p != 0:
                return float(p)
        return default

    class TradeRecordingStrategy(strategy_cls):
        """Wraps user strategy to record closed trades via notify_trade and notify_order."""

        def notify_trade(self, trade):
            super().notify_trade(trade)
            _record_trade(trade, self)

        def notify_order(self, order):
            super().notify_order(order)
            if getattr(order, "trade", None) and order.trade.isclosed:
                _record_trade(order.trade, self)

    def _record_trade(trade, recording_strat=None):
        """Record a closed trade to trades_list. Deduplicated (notify_trade + notify_order both fire)."""
        if not trade.isclosed:
            return
        tid = id(trade)
        if tid in _recorded_trade_ids:
            return
        _recorded_trade_ids.add(tid)
        try:
            dt_open = trade.open_datetime() if hasattr(trade, "open_datetime") else None
            dt_close = trade.close_datetime() if hasattr(trade, "close_datetime") else None
            # Backtrader exposes trade.long for closed PnL trades; history[0].event.size can mis-classify shorts.
            is_long = bool(getattr(trade, "long", True))
            size = 1
            entry_price = trade.price
            exit_price = trade.price
            if hasattr(trade, "history") and trade.history:
                h_open = trade.history[0]
                h_close = trade.history[-1]
                ev_open = getattr(h_open, "event", None)
                ev_close = getattr(h_close, "event", None)
                if ev_open is not None:
                    exec_size = getattr(ev_open, "size", None)
                    size = abs(exec_size) if exec_size is not None else 1
                    if getattr(trade, "long", None) is None:
                        is_long = (exec_size or 0) > 0
                entry_price = _get_price_from_history_entry(h_open, trade.price)
                exit_price = _get_price_from_history_entry(h_close, trade.price)
            try:
                ep = float(entry_price)
                xp = float(exit_price)
                pnl_c = float(trade.pnlcomm)
                denom = abs(float(size) * float(mult))
                if abs(xp - ep) < 1e-12 and abs(pnl_c) > 1e-3 and denom > 1e-12:
                    exit_price = round(ep + (pnl_c / denom if is_long else -pnl_c / denom), 6)
            except (TypeError, ValueError, ZeroDivisionError):
                pass
            mfe, mae, mfe_pct, mae_pct = _compute_trade_excursions(
                data=data,
                dt_open=dt_open,
                dt_close=dt_close,
                entry_price=float(entry_price),
                is_long=bool(is_long),
            )

            d = {
                "date": _safe_iso(dt_close),
                "entryDate": _safe_iso(dt_open),
                "exitDate": _safe_iso(dt_close),
                "type": "buy" if is_long else "sell",
                "size": size,
                "pnl": float(trade.pnlcomm),
                "price": exit_price,
                "entryPrice": float(entry_price),
                "exitPrice": float(exit_price),
                "mfe": round(mfe, 6),
                "mae": round(mae, 6),
                "mfePct": round(mfe_pct, 6),
                "maePct": round(mae_pct, 6),
                "fees": float(getattr(trade, "commission", 0.0) or 0.0),
                "slippageCost": float(
                    (
                        abs(float(entry_price)) * float(size) * float(mult) * float(slippage_perc)
                        + abs(float(exit_price)) * float(size) * float(mult) * float(slippage_perc)
                    )
                    if float(slippage_perc) > 0
                    else 0.0
                ),
                "barsHeld": int(getattr(trade, "barlen", 0) or 0),
                "holdingMinutes": float(
                    ((pd.Timestamp(dt_close) - pd.Timestamp(dt_open)).total_seconds() / 60.0)
                    if dt_open is not None and dt_close is not None
                    else 0.0
                ),
            }
            if recording_strat is not None:
                try:
                    dec = getattr(recording_strat, "decorate_trade_record", None)
                    if callable(dec):
                        merged = dec(d, trade)
                        if isinstance(merged, dict):
                            d = merged
                except Exception:
                    pass
            trades_list.append(d)
        except Exception:
            pass

    cerebro = bt.Cerebro()

    # Ensure datetime index
    if not isinstance(data.index, pd.DatetimeIndex):
        data = data.reset_index()
        if "datetime" in data.columns:
            data = data.set_index("datetime")
        elif "date" in data.columns:
            data = data.set_index("date")

    # Unified percent commission model across all instrument types.
    # Keep multiplier for futures-like products so PnL scaling stays realistic.
    broker_cfg = _load_broker_config(data_path, instrument)
    instrument_type = _eget("INSTRUMENT_TYPE", "futures")
    env_commission_raw = _eget("COMMISSION_PERC", "")
    commission_pct = 0.0
    if env_commission_raw:
        try:
            commission_pct = max(0.0, float(env_commission_raw))
        except ValueError:
            commission_pct = 0.0
    elif broker_cfg and broker_cfg.get("commission_perc") is not None:
        commission_pct = max(0.0, float(broker_cfg.get("commission_perc", 0) or 0))
    else:
        default_cfg = None
        try:
            cfg_path = Path(data_path) / "broker_config.json"
            if cfg_path.exists():
                with open(cfg_path, encoding="utf-8") as f:
                    full_cfg = json.load(f)
                default_cfg = full_cfg.get("default", {})
        except Exception:
            pass
        if default_cfg and default_cfg.get("commission_perc") is not None:
            commission_pct = max(0.0, float(default_cfg.get("commission_perc", 0) or 0))

    mult = 1.0
    if instrument_type == "futures":
        # Prefer explicit UI values when available.
        try:
            tick_size = float(_eget("TICK_SIZE", "") or 0)
            value_per_tick = float(_eget("VALUE_PER_TICK", "") or 0)
            if tick_size > 0 and value_per_tick > 0:
                mult = value_per_tick / tick_size
            elif broker_cfg and broker_cfg.get("mult") is not None:
                mult = float(broker_cfg.get("mult", 1) or 1)
        except Exception:
            mult = float(broker_cfg.get("mult", 1) or 1) if broker_cfg else 1.0

    execution_cfg_early: dict = {}
    try:
        raw_ex = _eget("EXECUTION_MODEL_JSON", "{}")
        execution_cfg_early = json.loads(raw_ex) if raw_ex else {}
        if not isinstance(execution_cfg_early, dict):
            execution_cfg_early = {}
    except Exception:
        execution_cfg_early = {}
    comm_mode = str(execution_cfg_early.get("commission_mode") or "percentage").strip().lower()
    try:
        per_contract_usd = float(execution_cfg_early.get("commission_per_contract", 2.25) or 0.0)
    except (TypeError, ValueError):
        per_contract_usd = 2.25
    use_per_contract = comm_mode == "per_contract" and instrument_type == "futures" and per_contract_usd >= 0.0
    commission_mode_saved = "per_contract" if use_per_contract else "percentage"

    cerebro.broker.setcommission(
        commission=0.0 if use_per_contract else commission_pct,
        margin=None,
        mult=mult,
    )
    if use_per_contract:

        class _PerContractComm(bt.CommInfoBase):
            params = (("usd", float(per_contract_usd)),)

            def _getcommission(self, size, price, pseudoexec):
                return abs(float(size)) * float(self.p.usd)

        cerebro.broker.addcommissioninfo(_PerContractComm())

    data_bt = bt.feeds.PandasData(
        dataname=data,
        datetime=None,
        open="open",
        high="high",
        low="low",
        close="close",
        volume="volume",
        openinterest=-1,
    )
    cerebro.adddata(data_bt)
    cerebro.addstrategy(EquityRecorder, total_bars=total_bars)
    params = _filter_params_for_strategy(strategy_cls, strategy_params or {})
    cerebro.addstrategy(TradeRecordingStrategy, **params)

    initial_capital = float(_eget("INITIAL_CAPITAL", "100000"))
    slippage_perc = float(_eget("SLIPPAGE_PERC", "0.001"))
    execution_cfg = dict(execution_cfg_early)
    if bool(execution_cfg.get("enabled", False)):
        close = pd.to_numeric(data.get("close"), errors="coerce").dropna()
        volatility, mean_abs_ret, cal_n = _execution_slippage_calibration_stats(close)
        execution_cfg["volatilityCalibrationBars"] = int(cal_n)
        execution_cfg["volatilityCalibrationNote"] = (
            "Slippage vol multiplier and latency proxy use std/mean|ret| on first N bars only (no full-sample lookahead)."
        )
        spread_bps = float(execution_cfg.get("spread_bps", 0.0) or 0.0)
        slippage_mult = float(execution_cfg.get("slippage_vol_mult", 0.0) or 0.0)
        latency_bars = int(
            execution_cfg.get("slippage_latency_proxy_bars", execution_cfg.get("latency_bars", 0)) or 0
        )
        latency_penalty = mean_abs_ret * max(0, latency_bars)
        extra_slippage_perc = (spread_bps / 10000.0) + (volatility * slippage_mult) + latency_penalty
        stress_mult = float(execution_cfg.get("stress_multiplier", 1.0) or 1.0)
        if stress_mult > 1.0:
            extra_slippage_perc *= stress_mult
            execution_cfg["stressMultiplierApplied"] = float(round(stress_mult, 4))
        slippage_perc = max(0.0, slippage_perc + extra_slippage_perc)
        execution_cfg["applied_effective_slippage_perc"] = float(round(slippage_perc, 10))
        execution_cfg["applied_extra_slippage_perc"] = float(round(extra_slippage_perc, 10))
        execution_cfg["slippageLatencyProxyBarsApplied"] = latency_bars
        execution_cfg["latencyModel"] = "adds_to_slippage_perc_not_order_delay"

    cerebro.broker.setcash(initial_capital)
    cerebro.broker.set_slippage_perc(slippage_perc)
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name="sharpe")
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name="drawdown")
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")

    results = cerebro.run(tradehistory=True)
    strat = results[1]  # User strategy (0=EquityRecorder)

    # Fallback: if notify_trade/notify_order didn't capture trades, try strategy's _trades
    if not trades_list and hasattr(strat, "_trades"):
        for _data_feed, trades in strat._trades.items():
            for t in trades:
                if getattr(t, "isclosed", False):
                    _record_trade(t)

    print("PROGRESS:100", file=sys.stderr, flush=True)

    # Equity curve - include initial value
    equity_curve = [initial_capital] + equity_list

    # Equity curve with dates — vectorized
    equity_curve_with_dates = []
    if not lightweight:
        if isinstance(data.index, pd.DatetimeIndex) and len(data.index) > 0:
            first_ts = data.index[0]
            day_before = (first_ts - pd.Timedelta(days=1)).isoformat() if hasattr(first_ts, "isoformat") else ""
            # Mikrosekundy z indexu baru → unikátní ISO i při duplicitním času v indexu CSV;
            # frontend (lightweight-charts) vyžaduje striktně rostoucí UTCTimestamp.
            eq_dates = [
                (pd.Timestamp(data.index[i]) + pd.Timedelta(microseconds=min(i, 999_999))).isoformat()
                for i in range(len(data.index))
            ]
            n_eq = min(len(eq_dates), len(equity_curve) - 1)
            equity_curve_with_dates = [{"date": day_before, "value": round(equity_curve[0], 2)}]
            equity_curve_with_dates.extend(
                {"date": eq_dates[i], "value": round(equity_curve[i + 1], 2)} for i in range(n_eq)
            )
        else:
            equity_curve_with_dates = [{"date": str(i), "value": round(v, 2)} for i, v in enumerate(equity_curve)]

    # Metrics
    sharpe = strat.analyzers.sharpe.get_analysis()
    dd = strat.analyzers.drawdown.get_analysis()
    ta = strat.analyzers.trades.get_analysis()

    total_trades = ta.get("total", {}).get("closed", 0) or 0
    won = ta.get("won", {}).get("total", 0) or 0
    listed = len(trades_list)
    trade_count_ui = int(listed) if listed else int(total_trades)
    won_listed = sum(1 for t in trades_list if t.get("pnl", 0) > 0)
    win_rate = (won_listed / listed * 100.0) if listed else ((won / total_trades * 100) if total_trades else 0)
    final_equity = cerebro.broker.getvalue()
    total_return_usd = final_equity - initial_capital
    total_return_pct = round((total_return_usd / initial_capital) * 100, 2)

    losing = [t for t in trades_list if t["pnl"] < 0]
    gross_profit = sum(t["pnl"] for t in trades_list if t["pnl"] > 0)
    gross_loss = abs(sum(t["pnl"] for t in losing))
    pf_bundle = _profit_factor_detailed(gross_profit, gross_loss)
    profit_factor = pf_bundle["value"]
    expectancy_usd = round(sum(t["pnl"] for t in trades_list) / len(trades_list), 2) if trades_list else 0.0
    avg_loss = abs(sum(t["pnl"] for t in losing) / len(losing)) if losing else 1.0
    expectancy_r = round(expectancy_usd / avg_loss, 2) if avg_loss else 0.0
    long_count = sum(1 for t in trades_list if t["type"] == "buy")
    short_count = sum(1 for t in trades_list if t["type"] == "sell")
    max_equity, curve_max_dd_pct, curve_max_dd_usd = _compute_equity_stats(equity_curve)
    analyzer_max_dd = float(dd.get("max", {}).get("drawdown", 0) or 0)
    max_drawdown_pct = max(analyzer_max_dd, curve_max_dd_pct)

    if lightweight:
        metrics = {
            "finalEquity": float(final_equity),
            "maxEquity": float(round(max_equity, 2)),
            "sharpeRatioLegacyAnalyzer": float(sharpe.get("sharperatio", 0) or 0),
            "maxDrawdown": float(round(max_drawdown_pct, 4)),
            "maxDrawdownPct": float(round(max_drawdown_pct, 4)),
            "maxDrawdownUsd": float(round(curve_max_dd_usd, 2)),
            "tradeCount": trade_count_ui,
            "longCount": int(long_count),
            "shortCount": int(short_count),
            "winRate": float(round(win_rate, 2)),
            "totalReturn": float(total_return_pct),
            "totalReturnUsd": float(round(total_return_usd, 2)),
            "profitFactor": profit_factor,
            "profitFactorStatus": str(pf_bundle["status"]),
            "grossProfitClosedTrades": round(float(gross_profit), 4),
            "grossLossAbsClosedTrades": round(float(gross_loss), 4),
            "expectancyUsd": float(expectancy_usd),
            "expectancyR": float(expectancy_r),
            "rMultiple": float(expectancy_r),
            "commissionPerc": float(commission_pct),
            "commissionMode": str(commission_mode_saved),
            "commissionPerContract": float(per_contract_usd) if use_per_contract else None,
        }
        _lw_result = {
            "equity": equity_curve,
            "equityCurve": [],
            "metrics": metrics,
            "trades": trades_list,
            "ohlc": [],
            "perf": {
                "barsIn": int((time_context or {}).get("barsIn", len(data))),
                "barsOut": int((time_context or {}).get("barsOut", len(data))),
                "lightweight": True,
            },
        }
        if code_digest_env:
            _result_cache_put(rc_key, _lw_result)
        return _lw_result

    tf_for_ann = str(
        (time_context or {}).get("workTimeframe") or (time_context or {}).get("sourceTimeframe") or ""
    )
    advanced = _compute_advanced_risk_metrics(
        equity_curve_with_dates,
        max_drawdown_pct,
        timeframe_hint=tf_for_ann,
    )
    dd_analysis = _compute_drawdown_analysis(equity_curve_with_dates)
    trade_pnl_dist = _compute_trade_pnl_distribution(trades_list)
    bootstrap_ci = _compute_bootstrap_ci(trades_list, equity_curve_with_dates)
    payoff_decomp = _compute_payoff_decomposition(trades_list)

    metrics = {
        "finalEquity": float(final_equity),
        "maxEquity": float(round(max_equity, 2)),
        "sharpeRatio": float(advanced.get("sharpeRatio", 0.0)),
        "sharpeRatioLegacyAnalyzer": float(sharpe.get("sharperatio", 0) or 0),
        "maxDrawdown": float(round(max_drawdown_pct, 4)),
        "maxDrawdownPct": float(round(max_drawdown_pct, 4)),
        "maxDrawdownUsd": float(round(curve_max_dd_usd, 2)),
        "tradeCount": trade_count_ui,
        "longCount": int(long_count),
        "shortCount": int(short_count),
        "winRate": float(round(win_rate, 2)),
        "totalReturn": float(total_return_pct),
        "totalReturnUsd": float(round(total_return_usd, 2)),
        "profitFactor": profit_factor,
        "profitFactorStatus": str(pf_bundle["status"]),
        "grossProfitClosedTrades": round(float(gross_profit), 4),
        "grossLossAbsClosedTrades": round(float(gross_loss), 4),
        "expectancyUsd": float(expectancy_usd),
        "expectancyR": float(expectancy_r),
        "rMultiple": float(expectancy_r),
        "commissionPerc": float(commission_pct),
        "commissionMode": str(commission_mode_saved),
        "commissionPerContract": float(per_contract_usd) if use_per_contract else None,
        "sortinoRatio": float(advanced.get("sortinoRatio", 0.0)),
        "calmarRatio": float(advanced.get("calmarRatio", 0.0)),
        "marRatio": float(advanced.get("marRatio", 0.0)),
        "ulcerIndex": float(advanced.get("ulcerIndex", 0.0)),
        "cagr": float(advanced.get("cagr", 0.0)),
        "riskAnnualizationPeriodsPerYear": float(advanced.get("riskAnnualizationPeriodsPerYear", 0.0) or 0.0),
        "riskAnnualizationSource": str(advanced.get("riskAnnualizationSource") or ""),
        "maxDrawdownDurationBars": int(dd_analysis.get("maxDurationBars", 0)),
        "maxDrawdownDurationDays": dd_analysis.get("maxDurationDays"),
        "timeToRecoveryBars": dd_analysis.get("timeToRecoveryBars"),
        "timeToRecoveryDays": dd_analysis.get("timeToRecoveryDays"),
        "currentDrawdownPct": float(dd_analysis.get("currentDrawdownPct", 0.0)),
        "payoffRatio": payoff_decomp.get("payoffRatio"),
        "edgePerTrade": float(payoff_decomp.get("edgePerTrade", 0.0)),
        "kellyFraction": payoff_decomp.get("kellyFraction"),
    }

    # OHLC for chart — vectorized export with server-side cap
    max_ohlc_bars = int(_eget("MAX_OHLC_EXPORT_BARS", "8000") or 8000)
    ohlc = []
    if isinstance(data.index, pd.DatetimeIndex) and len(data) > 0:
        export_df = data
        if len(data) > max_ohlc_bars:
            step = len(data) / max_ohlc_bars
            indices = [int(i * step) for i in range(max_ohlc_bars)]
            if indices[-1] != len(data) - 1:
                indices[-1] = len(data) - 1
            export_df = data.iloc[indices]
        dates_str = export_df.index.strftime("%Y-%m-%dT%H:%M:%S").tolist()
        o_col = "open" if "open" in export_df.columns else "Open"
        h_col = "high" if "high" in export_df.columns else "High"
        l_col = "low" if "low" in export_df.columns else "Low"
        c_col = "close" if "close" in export_df.columns else "Close"
        o_vals = export_df[o_col].tolist() if o_col in export_df.columns else [0.0] * len(export_df)
        h_vals = export_df[h_col].tolist() if h_col in export_df.columns else [0.0] * len(export_df)
        l_vals = export_df[l_col].tolist() if l_col in export_df.columns else [0.0] * len(export_df)
        c_vals = export_df[c_col].tolist() if c_col in export_df.columns else [0.0] * len(export_df)
        ohlc = [
            {"date": dates_str[i], "open": o_vals[i], "high": h_vals[i], "low": l_vals[i], "close": c_vals[i]}
            for i in range(len(export_df))
        ]

    return {
        "equity": equity_curve,
        "equityCurve": equity_curve_with_dates,
        "metrics": metrics,
        "trades": trades_list,
        "ohlc": ohlc,
        "drawdownAnalysis": dd_analysis,
        "tradePnlDistribution": trade_pnl_dist,
        "bootstrapCI": bootstrap_ci,
        "payoffDecomposition": payoff_decomp,
        "perf": {
            "barsIn": int((time_context or {}).get("barsIn", len(data))),
            "barsOut": int((time_context or {}).get("barsOut", len(data))),
            "sourceTimeframe": (time_context or {}).get("sourceTimeframe"),
            "workTimeframe": (time_context or {}).get("workTimeframe"),
            "cacheHit": bool((time_context or {}).get("cacheHit", False)),
            "dataLoadMs": int((time_context or {}).get("dataLoadMs", 0) or 0),
            "resampleMs": int((time_context or {}).get("resampleMs", 0) or 0),
        },
    }


def execute_backtest_from_environ() -> dict:
    """
    Full backtest pipeline (same as CLI main). Returns result dict for JSON serialization.
    Prepends strategy dir to sys.path for the duration of the call (required for in-process runs).
    """
    strategy_path = _eget("STRATEGY_PATH", "/app/strategy/strategy.py")
    strategy_dir = os.path.dirname(strategy_path)
    inserted_path = False
    if strategy_dir and strategy_dir not in sys.path:
        sys.path.insert(0, strategy_dir)
        inserted_path = True
    try:
        return _execute_backtest_from_environ_body(
            strategy_path=strategy_path,
            strategy_dir=strategy_dir,
        )
    finally:
        if inserted_path:
            try:
                sys.path.remove(strategy_dir)
            except ValueError:
                pass


def _execute_backtest_from_environ_body(*, strategy_path: str, strategy_dir: str) -> dict:
    data_path = _eget("DATA_PATH", "/app/data")
    instrument = _eget("INSTRUMENT", "NQ")
    timeframe = _eget("TIMEFRAME", "1d")
    years = float(_eget("YEARS", "1"))
    data_file = _eget("DATA_FILE", "")
    strategy_params_raw = _eget("STRATEGY_PARAMS", "{}")
    run_seed_raw = _eget("RUN_SEED", "")
    code_digest = _eget("CODE_DIGEST", "")
    actor_id = _eget("ACTOR_ID", "")
    image_digest = _eget("ENGINE_IMAGE_DIGEST", "")
    run_id = _eget("RUN_ID", "")
    applied_modules_raw = _eget("APPLIED_MODULES", "[]")
    analysis_cfg = _parse_analysis_config()
    try:
        strategy_params = json.loads(strategy_params_raw) if strategy_params_raw else {}
    except json.JSONDecodeError:
        strategy_params = {}
    try:
        applied_modules = json.loads(applied_modules_raw) if applied_modules_raw else []
        if not isinstance(applied_modules, list):
            applied_modules = []
    except json.JSONDecodeError:
        applied_modules = []

    try:
        run_seed_value = None
        if run_seed_raw.strip():
            try:
                run_seed_value = int(float(run_seed_raw))
            except Exception:
                run_seed_value = None
        if run_seed_raw.strip():
            try:
                random.seed(int(float(run_seed_raw)))
            except Exception:
                random.seed(run_seed_raw)
        modules_dir = Path(strategy_dir) / "modules"
        print(f"[engine] strategy_dir={strategy_dir} sys.path[0]={sys.path[0] if sys.path else '?'} modules_exists={modules_dir.exists()}", file=sys.stderr, flush=True)
        if modules_dir.exists():
            for f in modules_dir.iterdir():
                print(f"[engine] modules/{f.name}", file=sys.stderr, flush=True)
        print("[engine] Loading strategy...", file=sys.stderr, flush=True)
        strategy_cls = load_strategy(strategy_path)
        print("[engine] Loading data...", file=sys.stderr, flush=True)
        data, data_meta = load_data(data_path, instrument, timeframe, years, data_file)
        if not isinstance(strategy_params, dict):
            strategy_params = {}
        strategy_params = dict(strategy_params)
        strategy_params.setdefault("data_timeframe", data_meta.get("sourceTimeframe"))
        strategy_params.setdefault("work_timeframe", data_meta.get("workTimeframe"))
        print(f"[engine] Running backtest ({len(data)} bars)...", file=sys.stderr, flush=True)
        result = run_backtest(
            strategy_cls,
            data,
            data_path=str(data_path),
            instrument=instrument,
            strategy_params=strategy_params,
            time_context=data_meta,
        )
        validation_mode = str(analysis_cfg.get("validation_mode", "single") or "single")
        validation_cfg = analysis_cfg.get("validation_config") if isinstance(analysis_cfg.get("validation_config"), dict) else {}
        quality_gates = analysis_cfg.get("quality_gates") if isinstance(analysis_cfg.get("quality_gates"), dict) else {}
        sweep_mode = analysis_cfg.get("sweep_mode")
        sweep_cfg = analysis_cfg.get("sweep_config") if isinstance(analysis_cfg.get("sweep_config"), dict) else {}
        monte_carlo_cfg = analysis_cfg.get("monte_carlo") if isinstance(analysis_cfg.get("monte_carlo"), dict) else {}
        regime_cfg = analysis_cfg.get("regime_config") if isinstance(analysis_cfg.get("regime_config"), dict) else {}
        portfolio_cfg = analysis_cfg.get("portfolio_config") if isinstance(analysis_cfg.get("portfolio_config"), dict) else {}
        execution_cfg = analysis_cfg.get("execution_model") if isinstance(analysis_cfg.get("execution_model"), dict) else {}
        experiment_cfg = analysis_cfg.get("experiment") if isinstance(analysis_cfg.get("experiment"), dict) else {}

        if validation_mode in ("oos_split", "walk_forward"):
            result["validation"] = _run_validation(
                strategy_cls=strategy_cls,
                data=data,
                data_path=str(data_path),
                instrument=instrument,
                strategy_params=strategy_params,
                mode=validation_mode,
                cfg=validation_cfg,
                quality_gates=quality_gates,
            )
        elif validation_mode == "param_test":
            result["validation"] = _run_param_test(
                strategy_cls=strategy_cls,
                data=data,
                data_path=str(data_path),
                instrument=instrument,
                base_strategy_params=strategy_params,
                validation_cfg=validation_cfg,
                time_context=data_meta,
            )

        if sweep_mode in ("grid", "random"):
            result["robustness"] = _run_sweep_robustness(
                strategy_cls=strategy_cls,
                data=data,
                data_path=str(data_path),
                instrument=instrument,
                base_params=strategy_params,
                sweep_mode=str(sweep_mode),
                sweep_cfg=sweep_cfg,
            )

        if monte_carlo_cfg:
            result["monteCarlo"] = _run_monte_carlo(
                trades=result.get("trades", []),
                initial_capital=float(_eget("INITIAL_CAPITAL", "100000")),
                cfg=monte_carlo_cfg,
                data_timeframe=timeframe,
            )

        if regime_cfg:
            result["regimeAnalysis"] = _run_regime_analysis(
                ohlc=result.get("ohlc", []),
                trades=result.get("trades", []),
                cfg=regime_cfg,
            )

        if portfolio_cfg:
            result["portfolio"] = _run_portfolio_analysis(
                strategy_cls=strategy_cls,
                base_data_path=str(data_path),
                base_instrument=instrument,
                base_timeframe=timeframe,
                base_years=years,
                strategy_params=strategy_params,
                cfg=portfolio_cfg,
            )

        if execution_cfg:
            result["executionSummary"] = _build_execution_summary(
                data=data,
                trades=result.get("trades", []),
                cfg=execution_cfg,
            )

        if quality_gates:
            gate = _evaluate_quality_gates(result.get("metrics", {}), quality_gates)
            if result.get("validation") and isinstance(result["validation"], dict):
                summary = result["validation"].get("summary", {})
                avg_deg = float(summary.get("avgDegradation", 0.0) or 0.0)
                max_deg = float(quality_gates.get("oos_degradation_limit", 0.0) or 0.0)
                if max_deg:
                    gate.setdefault("checks", []).append(
                        {
                            "metric": "oosAvgDegradation",
                            "value": avg_deg,
                            "threshold": -abs(max_deg),
                            "mode": "min",
                            "passed": avg_deg >= -abs(max_deg),
                        }
                    )
                    gate["passed"] = bool(gate.get("passed", True)) and (avg_deg >= -abs(max_deg))
            result["qualityGate"] = gate

        if experiment_cfg:
            exp_payload = dict(experiment_cfg)
            run_diff = _build_run_diff(
                current_metrics=result.get("metrics", {}),
                baseline_metrics=exp_payload.get("baseline_metrics"),
            )
            promote_evidence = _build_promote_evidence(
                quality_gate=result.get("qualityGate"),
                validation=result.get("validation"),
                robustness=result.get("robustness"),
                experiment_cfg=exp_payload,
            )
            exp_payload["runDiff"] = run_diff
            exp_payload["promoteEvidence"] = promote_evidence
            exp_payload["promoteDecision"] = "review_candidate" if promote_evidence.get("promote") else "hold"
            result["experiment"] = exp_payload

        fwd = _build_forward_bridge(result.get("metrics", {}), execution_cfg.get("forward_bridge") if isinstance(execution_cfg, dict) else None)
        if fwd:
            result.setdefault("executionSummary", {})
            if isinstance(result["executionSummary"], dict):
                result["executionSummary"]["forwardBridge"] = fwd

        # Cost attribution (always, for Results/Analytics) — ratios use totalReturnUsd from metrics
        _m = result.get("metrics") or {}
        _tr_usd = float(_m.get("totalReturnUsd", 0.0) or 0.0)
        _ca = _build_cost_attribution(result.get("trades"), _tr_usd)
        result.setdefault("executionSummary", {})
        if isinstance(result["executionSummary"], dict):
            if execution_cfg and not result["executionSummary"].get("enabled", False):
                result["executionSummary"]["enabled"] = bool(execution_cfg.get("enabled", False))
            result["executionSummary"]["costAttribution"] = _ca
        else:
            result["executionSummary"] = {
                "enabled": bool(execution_cfg and execution_cfg.get("enabled", False)),
                "costAttribution": _ca,
            }

        if applied_modules:
            result["moduleOutputs"] = _run_module_outputs_in_engine(
                strategy_dir=strategy_dir,
                ohlc=result.get("ohlc", []),
                applied_modules=applied_modules,
                source_timeframe=data_meta.get("sourceTimeframe"),
                work_timeframe=data_meta.get("workTimeframe"),
                strategy_params=strategy_params,
            )
        perf = result.get("perf", {})
        result["runId"] = run_id or None
        manifest: dict = {
            "runId": run_id or None,
            "actorId": actor_id or None,
            "instrument": instrument,
            "timeframe": timeframe,
            "years": years,
            "dataFile": data_file,
            "strategyPath": strategy_path,
            "runSeed": run_seed_value,
            "codeDigest": code_digest or None,
            "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
            "strategyParams": strategy_params,
            "appliedModules": applied_modules,
            "analysis": analysis_cfg,
            "engine": "host-worker",
            "python": sys.version.split()[0],
            "sourceTimeframe": perf.get("sourceTimeframe"),
            "workTimeframe": perf.get("workTimeframe"),
            "barsIn": perf.get("barsIn"),
            "barsOut": perf.get("barsOut"),
            "cacheHit": perf.get("cacheHit"),
            "datasetFingerprint": data_meta.get("datasetFingerprint"),
            "dataLoadMs": perf.get("dataLoadMs"),
            "resampleMs": perf.get("resampleMs"),
            "methodology": _engine_methodology_notes(),
            # So exports/UI know why OOS/WF does not change headline metrics vs single run.
            "primaryMetricsSource": "full_dataset",
            "validationMode": validation_mode,
        }
        if str(image_digest or "").strip():
            manifest["imageDigest"] = str(image_digest).strip()

        trial_count = 1
        val = result.get("validation")
        manifest["validationFoldCount"] = (
            len(val.get("folds") or []) if isinstance(val, dict) else 0
        )
        if isinstance(val, dict):
            trial_count += int((val.get("summary") or {}).get("paramTestTotalRuns", 0) or 0)
        rob = result.get("robustness")
        if isinstance(rob, dict):
            trial_count += int(rob.get("tested", 0) or 0)
        manifest["trialCount"] = trial_count
        manifest["naiveAdjustedAlpha"] = round(0.05 / max(trial_count, 1), 6) if trial_count > 1 else None

        result["manifest"] = manifest
        result["overfittingSignals"] = {
            "trialCount": trial_count,
            "naiveAdjustedAlpha": manifest["naiveAdjustedAlpha"],
            "naiveAdjustedNote": (
                f"Tested {trial_count} configurations total. "
                f"Naive Bonferroni-adjusted significance: {manifest['naiveAdjustedAlpha']:.4f} (0.05 / {trial_count}). "
                "This is a rough lower bound — actual FPR depends on correlation between tests."
            ) if trial_count > 1 else None,
        }

        exec_enabled = bool(execution_cfg and execution_cfg.get("enabled", False))
        result["propRedFlags"] = _compute_prop_red_flags(
            metrics=result.get("metrics", {}),
            trades=result.get("trades", []),
            validation_mode=validation_mode,
            execution_enabled=exec_enabled,
            equity_curve=result.get("equity", []),
            bootstrap_ci=result.get("bootstrapCI"),
        )
        return result
    except Exception:
        raise


def main():
    try:
        print(json.dumps(execute_backtest_from_environ(), default=str))
    except Exception as e:
        import traceback

        tb = traceback.format_exc()
        msg = str(e) or f"{type(e).__name__}"
        full = f"{msg}\n\n{tb}"
        print(json.dumps({"error": full}), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
