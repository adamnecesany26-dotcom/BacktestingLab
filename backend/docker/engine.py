"""
Backtest engine - executed inside Docker container.
1. Loads strategy dynamically from mounted /app/strategy
2. Loads dataset from parquet
3. Initializes Backtrader
4. Runs strategy
5. Computes metrics
6. Outputs JSON to stdout
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
import time
import datetime as dt
from pathlib import Path

# Add strategy dir to sys.path IMMEDIATELY so "from modules.X" / "from indicators.X" work
_strategy_path = os.environ.get("STRATEGY_PATH", "/app/strategy/strategy.py")
_strategy_dir = os.path.dirname(_strategy_path)
if _strategy_dir and _strategy_dir not in sys.path:
    sys.path.insert(0, _strategy_dir)

import backtrader as bt
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


def _parse_analysis_config() -> dict:
    raw = os.environ.get("ANALYSIS_CONFIG", "{}")
    try:
        parsed = json.loads(raw) if raw else {}
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _compute_advanced_risk_metrics(
    equity_curve_with_dates: list[dict],
    max_drawdown_pct: float,
) -> dict[str, float]:
    if not equity_curve_with_dates:
        return {}
    vals = [float(x.get("value", 0.0)) for x in equity_curve_with_dates]
    if len(vals) < 3:
        return {}
    series = pd.Series(vals)
    rets = series.pct_change().replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    mean_ret = float(rets.mean())
    down = rets[rets < 0]
    downside_std = float(down.std()) if len(down) > 1 else 0.0
    sortino = (mean_ret / downside_std * math.sqrt(252.0)) if downside_std > 0 else 0.0

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
        "sortinoRatio": float(round(sortino, 6)),
        "calmarRatio": float(round(calmar, 6)),
        "marRatio": float(round(calmar, 6)),
        "ulcerIndex": float(round(ulcer_idx, 6)),
        "cagr": float(round(cagr * 100.0, 6)),
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
        value = float(metrics.get(metric_key, 0.0) or 0.0)
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
    return {
        "finalEquity": float(m.get("finalEquity", 0.0) or 0.0),
        "maxDrawdownPct": float(m.get("maxDrawdownPct", m.get("maxDrawdown", 0.0)) or 0.0),
        "profitFactor": float(m.get("profitFactor", 0.0) or 0.0),
        "tradeCount": int(m.get("tradeCount", 0) or 0),
        "winRate": float(m.get("winRate", 0.0) or 0.0),
        "sortinoRatio": float(m.get("sortinoRatio", 0.0) or 0.0),
        "totalReturnUsd": float(m.get("totalReturnUsd", 0.0) or 0.0),
    }


def _run_validation(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str,
    instrument: str,
    strategy_params: dict | None,
    mode: str,
    cfg: dict | None,
) -> dict:
    cfg = cfg or {}
    n = len(data)
    if n < 50 or mode == "single":
        return {"mode": "single", "folds": [], "summary": {}}
    folds: list[dict] = []
    if mode == "oos_split":
        ratio = float(cfg.get("oos_ratio", 0.25) or 0.25)
        ratio = min(max(ratio, 0.05), 0.8)
        split = int(n * (1.0 - ratio))
        split = min(max(split, 20), n - 20)
        train = data.iloc[:split]
        test = data.iloc[split:]
        train_result = run_backtest(strategy_cls, train, data_path=data_path, instrument=instrument, strategy_params=strategy_params)
        test_result = run_backtest(strategy_cls, test, data_path=data_path, instrument=instrument, strategy_params=strategy_params)
        folds.append({"id": "oos_split", "train": _safe_metrics_snapshot(train_result), "test": _safe_metrics_snapshot(test_result)})
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
            train_result = run_backtest(strategy_cls, train, data_path=data_path, instrument=instrument, strategy_params=strategy_params)
            test_result = run_backtest(strategy_cls, test, data_path=data_path, instrument=instrument, strategy_params=strategy_params)
            folds.append({"id": f"wf_{i+1}", "train": _safe_metrics_snapshot(train_result), "test": _safe_metrics_snapshot(test_result)})
    degradation = []
    for f in folds:
        train_ret = float(f["train"].get("totalReturnUsd", 0.0))
        test_ret = float(f["test"].get("totalReturnUsd", 0.0))
        d = 0.0 if abs(train_ret) < 1e-9 else (test_ret - train_ret) / abs(train_ret)
        degradation.append(d)
    return {
        "mode": mode,
        "folds": folds,
        "summary": {
            "foldCount": len(folds),
            "avgDegradation": float(round(sum(degradation) / len(degradation), 6)) if degradation else 0.0,
            "medianDegradation": float(round(sorted(degradation)[len(degradation) // 2], 6)) if degradation else 0.0,
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
    rows: list[dict] = []
    for i, params in enumerate(candidates):
        try:
            out = run_backtest(strategy_cls, data, data_path=data_path, instrument=instrument, strategy_params=params)
            m = _safe_metrics_snapshot(out)
            score = float(m["totalReturnUsd"]) - float(m["maxDrawdownPct"]) * 50.0 + float(m["profitFactor"]) * 100.0
            rows.append({"id": i + 1, "params": params, "metrics": m, "score": score})
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
                grid: dict[tuple[int, int], list[float]] = {}
                for r in rows:
                    p = r.get("params", {})
                    if x_key not in p or y_key not in p:
                        continue
                    x = float(p[x_key])
                    y = float(p[y_key])
                    x_den = (x_max - x_min) if x_max != x_min else 1.0
                    y_den = (y_max - y_min) if y_max != y_min else 1.0
                    xi = min(x_bins - 1, max(0, int(((x - x_min) / x_den) * x_bins)))
                    yi = min(y_bins - 1, max(0, int(((y - y_min) / y_den) * y_bins)))
                    grid.setdefault((xi, yi), []).append(float(r["score"]))
                cells = []
                for yi in range(y_bins):
                    for xi in range(x_bins):
                        vals = grid.get((xi, yi), [])
                        cells.append(
                            {
                                "xBin": xi,
                                "yBin": yi,
                                "count": len(vals),
                                "avgScore": round(sum(vals) / len(vals), 6) if vals else 0.0,
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


def _run_monte_carlo(trades: list[dict], initial_capital: float, cfg: dict | None) -> dict:
    cfg = cfg or {}
    pnl = [float(t.get("pnl", 0.0) or 0.0) for t in trades]
    if not pnl:
        return {"simulations": 0, "drawdownPct": {}, "endingEquity": {}, "riskOfRuin": 0.0}
    sims = int(cfg.get("simulations", 300) or 300)
    sims = min(max(sims, 50), 2000)
    ruin_dd = float(cfg.get("ruin_dd_pct", 50.0) or 50.0)
    dd_vals = []
    end_vals = []
    ruin_count = 0
    for _ in range(sims):
        seq = [random.choice(pnl) for _ in range(len(pnl))]
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
        pf = gross_p / gross_l if gross_l > 0 else (999.0 if gross_p > 0 else 0.0)
        return {
            "trades": len(pnls),
            "expectancyUsd": round(sum(pnls) / len(pnls), 4) if pnls else 0.0,
            "winRate": round((len(wins) / len(pnls) * 100.0), 4) if pnls else 0.0,
            "profitFactor": round(pf, 4),
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
            out = run_backtest(strategy_cls, data_i, data_path=base_data_path, instrument=inst, strategy_params=strategy_params)
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
        "instruments": rows,
        "summary": {
            "weightedReturnUsd": round(portfolio_ret, 4),
            "weightedMaxDrawdownPct": round(portfolio_dd, 4),
            "count": len(rows),
        },
    }


def _build_execution_summary(data: pd.DataFrame, trades: list[dict], cfg: dict | None) -> dict:
    cfg = cfg or {}
    enabled = bool(cfg.get("enabled", False))
    if not enabled or data.empty:
        return {"enabled": False}
    close = pd.to_numeric(data.get("close"), errors="coerce").dropna()
    vol = float(close.pct_change().dropna().std()) if len(close) > 2 else 0.0
    spread_bps = float(cfg.get("spread_bps", 0.0) or 0.0)
    slippage_mult = float(cfg.get("slippage_vol_mult", 0.0) or 0.0)
    latency_bars = int(cfg.get("latency_bars", 0) or 0)
    effective_extra_slippage_pct = (spread_bps / 10000.0) + vol * slippage_mult
    total_fees = sum(float(t.get("fees", 0.0) or 0.0) for t in (trades or []))
    total_slippage_cost = sum(float(t.get("slippageCost", 0.0) or 0.0) for t in (trades or []))
    holding_values = [float(t.get("holdingMinutes", 0.0) or 0.0) for t in (trades or []) if t.get("holdingMinutes") is not None]
    avg_holding_minutes = (sum(holding_values) / len(holding_values)) if holding_values else 0.0

    return {
        "enabled": True,
        "spreadBps": spread_bps,
        "volatility": round(vol, 8),
        "slippageVolMultiplier": slippage_mult,
        "latencyBars": latency_bars,
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


def _run_module_outputs_in_engine(
    strategy_dir: str,
    ohlc: list[dict],
    applied_modules: list[dict] | None,
    source_timeframe: str | None = None,
    work_timeframe: str | None = None,
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

    for mod in applied_modules:
        name = str(mod.get("name") or "")
        params = dict(mod.get("params") or {})
        params.setdefault("data_timeframe", inferred_source_tf)
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
            module_tf = _normalize_tf(params.get("timeframe"))
            if _should_resample(inferred_work_tf or inferred_source_tf, module_tf):
                module_df = _resample_ohlcv(df, module_tf)

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
                        pts = []
                        color = None
                        if isinstance(data, list):
                            pts = [
                                {"date": _iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                                for p in data if isinstance(p, dict)
                            ]
                        elif isinstance(data, dict) and "data" in data:
                            pts = [
                                {"date": _iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                                for p in data["data"] if isinstance(p, dict)
                            ]
                            color = data.get("color")
                        if pts:
                            line_obj = {"name": str(line_name), "data": pts}
                            if color:
                                line_obj["color"] = str(color)
                            lines.append(line_obj)
                elif isinstance(result, list):
                    pts = [
                        {"date": _iso_or_str(p.get("date", "")), "value": float(p.get("value", 0))}
                        for p in result if isinstance(p, dict)
                    ]
                    if pts:
                        lines.append({"name": "line", "data": pts})

            if hasattr(mod_obj, "get_zones"):
                result = _call_with_params(mod_obj.get_zones, module_df, params)
                if isinstance(result, list):
                    for item in result:
                        if (
                            isinstance(item, dict)
                            and "date_start" in item
                            and "date_end" in item
                            and "value_low" in item
                            and "value_high" in item
                        ):
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
                            zones.append(zone)

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
    cache_dir_raw = os.environ.get("DATA_CACHE_PATH", "")
    cache_dir = Path(cache_dir_raw).resolve() if cache_dir_raw else None

    # Explicit file path (e.g. mock/NQ_5Y.csv)
    if data_file:
        p = base / data_file
        if p.exists():
            return _load_file(p, years, timeframe, cache_dir)

    # Try common naming
    candidates = [
        base / "mock" / f"{instrument}_5Y.csv",
        base / "mock" / f"{instrument}.csv",
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
            cache_file = cache_dir / f"dataset_{cache_key}.pkl"
            if cache_file.exists():
                with open(cache_file, "rb") as f:
                    cached = pickle.load(f)
                df_cached = cached.get("df")
                meta_cached = cached.get("meta") or {}
                if isinstance(df_cached, pd.DataFrame):
                    meta_cached["cacheHit"] = True
                    return df_cached, meta_cached
        except Exception:
            pass

    load_start = time.perf_counter()
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
    else:
        df = pd.read_parquet(path)
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

    meta = {
        "cacheHit": cache_hit,
        "cacheKey": cache_key,
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
            cache_file = cache_dir / f"dataset_{cache_key}.pkl"
            payload = {"df": df, "meta": meta}
            with open(cache_file, "wb") as f:
                pickle.dump(payload, f, protocol=pickle.HIGHEST_PROTOCOL)
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
) -> dict:
    """Run Backtrader backtest and return results dict."""
    equity_list = []
    trades_list = []
    total_bars = len(data)

    class EquityRecorder(bt.Strategy):
        """Records broker value at each bar, reports progress to stderr."""

        params = (("total_bars", 0),)

        def __init__(self):
            self._last_pct = -1

        def next(self):
            equity_list.append(self.broker.getvalue())
            if self.params.total_bars > 0:
                pct = min(99, int((len(self) / self.params.total_bars) * 100))
                if pct != self._last_pct and pct % 10 == 0:
                    print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)
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
            _record_trade(trade)

        def notify_order(self, order):
            super().notify_order(order)
            if getattr(order, "trade", None) and order.trade.isclosed:
                _record_trade(order.trade)

    def _record_trade(trade):
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
            size, is_long = 1, True
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
                    is_long = (exec_size or 0) > 0
                entry_price = _get_price_from_history_entry(h_open, trade.price)
                exit_price = _get_price_from_history_entry(h_close, trade.price)
            mfe, mae, mfe_pct, mae_pct = _compute_trade_excursions(
                data=data,
                dt_open=dt_open,
                dt_close=dt_close,
                entry_price=float(entry_price),
                is_long=bool(is_long),
            )

            trades_list.append({
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
            })
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
    instrument_type = os.environ.get("INSTRUMENT_TYPE", "futures")
    env_commission_raw = os.environ.get("COMMISSION_PERC", "")
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
            tick_size = float(os.environ.get("TICK_SIZE", "") or 0)
            value_per_tick = float(os.environ.get("VALUE_PER_TICK", "") or 0)
            if tick_size > 0 and value_per_tick > 0:
                mult = value_per_tick / tick_size
            elif broker_cfg and broker_cfg.get("mult") is not None:
                mult = float(broker_cfg.get("mult", 1) or 1)
        except Exception:
            mult = float(broker_cfg.get("mult", 1) or 1) if broker_cfg else 1.0

    cerebro.broker.setcommission(commission=commission_pct, margin=None, mult=mult)

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

    initial_capital = float(os.environ.get("INITIAL_CAPITAL", "100000"))
    slippage_perc = float(os.environ.get("SLIPPAGE_PERC", "0.001"))

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

    # Equity curve with dates (for export/save)
    equity_curve_with_dates = []
    if isinstance(data.index, pd.DatetimeIndex) and len(data.index) > 0:
        first_ts = data.index[0]
        day_before = (
            (first_ts - pd.Timedelta(days=1)).isoformat()
            if hasattr(first_ts, "isoformat")
            else ""
        )
        equity_curve_with_dates.append({"date": day_before, "value": round(equity_curve[0], 2)})
        for i, ts in enumerate(data.index):
            if i + 1 < len(equity_curve):
                date_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
                equity_curve_with_dates.append({"date": date_str, "value": round(equity_curve[i + 1], 2)})
    else:
        for i, v in enumerate(equity_curve):
            equity_curve_with_dates.append({"date": str(i), "value": round(v, 2)})

    # Metrics
    sharpe = strat.analyzers.sharpe.get_analysis()
    dd = strat.analyzers.drawdown.get_analysis()
    ta = strat.analyzers.trades.get_analysis()

    total_trades = ta.get("total", {}).get("closed", 0) or 0
    won = ta.get("won", {}).get("total", 0) or 0
    win_rate = (won / total_trades * 100) if total_trades else 0
    final_equity = cerebro.broker.getvalue()
    total_return_usd = final_equity - initial_capital
    total_return_pct = round((total_return_usd / initial_capital) * 100, 2)

    losing = [t for t in trades_list if t["pnl"] < 0]
    gross_profit = sum(t["pnl"] for t in trades_list if t["pnl"] > 0)
    gross_loss = abs(sum(t["pnl"] for t in losing))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    expectancy_usd = round(sum(t["pnl"] for t in trades_list) / len(trades_list), 2) if trades_list else 0.0
    avg_loss = abs(sum(t["pnl"] for t in losing) / len(losing)) if losing else 1.0
    expectancy_r = round(expectancy_usd / avg_loss, 2) if avg_loss else 0.0
    long_count = sum(1 for t in trades_list if t["type"] == "buy")
    short_count = sum(1 for t in trades_list if t["type"] == "sell")
    max_equity, curve_max_dd_pct, curve_max_dd_usd = _compute_equity_stats(equity_curve)
    analyzer_max_dd = float(dd.get("max", {}).get("drawdown", 0) or 0)
    max_drawdown_pct = max(analyzer_max_dd, curve_max_dd_pct)
    advanced = _compute_advanced_risk_metrics(equity_curve_with_dates, max_drawdown_pct)

    metrics = {
        "finalEquity": float(final_equity),
        "maxEquity": float(round(max_equity, 2)),
        "sharpeRatio": float(sharpe.get("sharperatio", 0) or 0),
        "maxDrawdown": float(round(max_drawdown_pct, 4)),
        "maxDrawdownPct": float(round(max_drawdown_pct, 4)),
        "maxDrawdownUsd": float(round(curve_max_dd_usd, 2)),
        "tradeCount": int(total_trades),
        "longCount": int(long_count),
        "shortCount": int(short_count),
        "winRate": float(round(win_rate, 2)),
        "totalReturn": float(total_return_pct),
        "totalReturnUsd": float(round(total_return_usd, 2)),
        "profitFactor": float(profit_factor),
        "expectancyUsd": float(expectancy_usd),
        "expectancyR": float(expectancy_r),
        "rMultiple": float(expectancy_r),  # expectancy in R = avg R-multiple per trade
        "commissionPerc": float(commission_pct),
        "sortinoRatio": float(advanced.get("sortinoRatio", 0.0)),
        "calmarRatio": float(advanced.get("calmarRatio", 0.0)),
        "marRatio": float(advanced.get("marRatio", 0.0)),
        "ulcerIndex": float(advanced.get("ulcerIndex", 0.0)),
        "cagr": float(advanced.get("cagr", 0.0)),
    }

    # OHLC for chart (date, open, high, low, close)
    ohlc = []
    if isinstance(data.index, pd.DatetimeIndex):
        for i, ts in enumerate(data.index):
            if i < len(data):
                row = data.iloc[i]
                ohlc.append({
                    "date": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "open": float(row.get("open", row.get("Open", 0))),
                    "high": float(row.get("high", row.get("High", 0))),
                    "low": float(row.get("low", row.get("Low", 0))),
                    "close": float(row.get("close", row.get("Close", 0))),
                })

    return {
        "equity": equity_curve,
        "equityCurve": equity_curve_with_dates,
        "metrics": metrics,
        "trades": trades_list,
        "ohlc": ohlc,
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


def main():
    strategy_path = os.environ.get("STRATEGY_PATH", "/app/strategy/strategy.py")
    # Add strategy dir to sys.path FIRST so "from modules.X" / "from indicators.X" work
    strategy_dir = os.path.dirname(strategy_path)
    if strategy_dir and strategy_dir not in sys.path:
        sys.path.insert(0, strategy_dir)

    data_path = os.environ.get("DATA_PATH", "/app/data")
    instrument = os.environ.get("INSTRUMENT", "NQ")
    timeframe = os.environ.get("TIMEFRAME", "1d")
    years = float(os.environ.get("YEARS", "1"))
    data_file = os.environ.get("DATA_FILE", "")
    strategy_params_raw = os.environ.get("STRATEGY_PARAMS", "{}")
    run_id = os.environ.get("RUN_ID", "")
    applied_modules_raw = os.environ.get("APPLIED_MODULES", "[]")
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
                initial_capital=float(os.environ.get("INITIAL_CAPITAL", "100000")),
                cfg=monte_carlo_cfg,
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
            exp_payload["promoteDecision"] = "candidate_for_promote" if promote_evidence.get("promote") else "hold"
            result["experiment"] = exp_payload

        fwd = _build_forward_bridge(result.get("metrics", {}), execution_cfg.get("forward_bridge") if isinstance(execution_cfg, dict) else None)
        if fwd:
            result.setdefault("executionSummary", {})
            if isinstance(result["executionSummary"], dict):
                result["executionSummary"]["forwardBridge"] = fwd

        if applied_modules:
            result["moduleOutputs"] = _run_module_outputs_in_engine(
                strategy_dir=strategy_dir,
                ohlc=result.get("ohlc", []),
                applied_modules=applied_modules,
                source_timeframe=data_meta.get("sourceTimeframe"),
                work_timeframe=data_meta.get("workTimeframe"),
            )
        perf = result.get("perf", {})
        result["runId"] = run_id or None
        result["manifest"] = {
            "runId": run_id or None,
            "instrument": instrument,
            "timeframe": timeframe,
            "years": years,
            "dataFile": data_file,
            "strategyPath": strategy_path,
            "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
            "strategyParams": strategy_params,
            "appliedModules": applied_modules,
            "analysis": analysis_cfg,
            "engine": "backtest-engine",
            "python": sys.version.split()[0],
            "sourceTimeframe": perf.get("sourceTimeframe"),
            "workTimeframe": perf.get("workTimeframe"),
            "barsIn": perf.get("barsIn"),
            "barsOut": perf.get("barsOut"),
            "cacheHit": perf.get("cacheHit"),
            "dataLoadMs": perf.get("dataLoadMs"),
            "resampleMs": perf.get("resampleMs"),
        }
        print(json.dumps(result))
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        msg = str(e) or f"{type(e).__name__}"
        full = f"{msg}\n\n{tb}"
        print(json.dumps({"error": full}), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
