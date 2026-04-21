# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class ZoneRValidatorConfig:
    mfe_cap_R: float = 10.0
    buffer_atr_mult: float = 0.0
    buffer_ticks: float = 0.0
    departure_margin_atr: float = 0.25
    cooldown_bars: int = 6
    max_bars_after_touch: int = 320
    max_touch_events_per_zone: int = 3
    max_zones: int = 400


_MEM_CACHE: dict[str, dict[str, Any]] = {}
_MEM_CACHE_ORDER: list[str] = []
_MEM_CACHE_MAX = 8


def _float(v: Any, default: float | None = None) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    return x


def _int(v: Any, default: int | None = None) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _sha16(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="replace")).hexdigest()[:16]


def zone_id(z: dict[str, Any]) -> str:
    nm = str(z.get("name") or "")
    ds = str(z.get("date_start") or "")
    de = str(z.get("date_end") or "")
    lo = _float(z.get("value_low"), 0.0) or 0.0
    hi = _float(z.get("value_high"), 0.0) or 0.0
    piv = _int(z.get("pivot_idx"), -1) or -1
    raw = f"{nm}|{ds}|{de}|{lo:.6f}|{hi:.6f}|{piv}"
    return _sha16(raw)


def _compute_atr(df: pd.DataFrame, period: int = 14) -> np.ndarray:
    if len(df) < 2:
        return np.zeros(len(df), dtype=np.float64)
    high = (df["high"] if "high" in df.columns else df["High"]).to_numpy(dtype=np.float64, copy=False)
    low = (df["low"] if "low" in df.columns else df["Low"]).to_numpy(dtype=np.float64, copy=False)
    close = (df["close"] if "close" in df.columns else df["Close"]).to_numpy(dtype=np.float64, copy=False)
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    p = max(1, int(period))
    # Wilder's RMA (approx via EWMA alpha=1/p)
    atr = np.empty_like(tr)
    atr[0] = tr[0]
    alpha = 1.0 / float(p)
    for i in range(1, len(tr)):
        atr[i] = atr[i - 1] + alpha * (tr[i] - atr[i - 1])
    return atr


def _parse_config(params: dict[str, Any] | None) -> ZoneRValidatorConfig:
    p = params or {}
    cfg = ZoneRValidatorConfig()
    mfe = _float(p.get("mfe_cap_R"), cfg.mfe_cap_R)
    buf_atr = _float(p.get("buffer_atr_mult"), cfg.buffer_atr_mult)
    buf_ticks = _float(p.get("buffer_ticks"), cfg.buffer_ticks)
    dep = _float(p.get("departure_margin_atr"), cfg.departure_margin_atr)
    cd = _int(p.get("cooldown_bars"), cfg.cooldown_bars)
    mx = _int(p.get("max_bars_after_touch"), cfg.max_bars_after_touch)
    max_ev = _int(p.get("max_touch_events_per_zone"), cfg.max_touch_events_per_zone)
    max_z = _int(p.get("max_zones"), cfg.max_zones)
    return ZoneRValidatorConfig(
        mfe_cap_R=float(mfe if mfe is not None else cfg.mfe_cap_R),
        buffer_atr_mult=float(buf_atr if buf_atr is not None else cfg.buffer_atr_mult),
        buffer_ticks=float(buf_ticks if buf_ticks is not None else cfg.buffer_ticks),
        departure_margin_atr=float(dep if dep is not None else cfg.departure_margin_atr),
        cooldown_bars=int(cd if cd is not None else cfg.cooldown_bars),
        max_bars_after_touch=int(mx if mx is not None else cfg.max_bars_after_touch),
        max_touch_events_per_zone=int(max_ev if max_ev is not None else cfg.max_touch_events_per_zone),
        max_zones=int(max_z if max_z is not None else cfg.max_zones),
    )


def _is_demand(z: dict[str, Any]) -> bool:
    return str(z.get("name") or "") == "Demand"


def _valid_zone(z: dict[str, Any]) -> bool:
    nm = str(z.get("name") or "")
    if nm not in ("Demand", "Supply"):
        return False
    lo = _float(z.get("value_low"))
    hi = _float(z.get("value_high"))
    si = _int(z.get("start_idx"))
    ei = _int(z.get("end_idx"))
    if lo is None or hi is None or not (hi > lo):
        return False
    if si is None or ei is None:
        return False
    return True


def _touch_events_for_zone(
    df: pd.DataFrame,
    z: dict[str, Any],
    atr: np.ndarray,
    cfg: ZoneRValidatorConfig,
) -> list[dict[str, Any]]:
    n = len(df)
    if n < 2:
        return []

    lo = float(z["value_low"])
    hi = float(z["value_high"])
    is_dem = _is_demand(z)
    si = int(z.get("start_idx", 0))
    ei = int(z.get("end_idx", n - 1))
    piv = int(z.get("pivot_idx", si))
    piv = max(0, min(piv, n - 1))
    si = max(0, min(si, n - 1))
    ei = max(0, min(ei, n - 1))
    start_scan = max(piv, si)

    high = (df["high"] if "high" in df.columns else df["High"]).to_numpy(dtype=np.float64, copy=False)
    low = (df["low"] if "low" in df.columns else df["Low"]).to_numpy(dtype=np.float64, copy=False)

    out: list[dict[str, Any]] = []
    j = min(start_scan + 1, n - 1)
    touch_n = 0

    while j < n and touch_n < cfg.max_touch_events_per_zone:
        atr_j = float(atr[j]) if j < len(atr) else 0.0
        if not math.isfinite(atr_j) or atr_j <= 0:
            atr_j = 1e-8
        dep_margin = cfg.departure_margin_atr * atr_j

        if is_dem:
            # valid touch when price reaches top edge and previous bar was clearly above edge
            prev_outside = (j - 1) >= 0 and float(low[j - 1]) > (hi + dep_margin)
            touched = float(low[j]) <= hi
        else:
            prev_outside = (j - 1) >= 0 and float(high[j - 1]) < (lo - dep_margin)
            touched = float(high[j]) >= lo

        if not (prev_outside and touched):
            j += 1
            continue

        touch_n += 1
        touch_idx = j
        entry = hi if is_dem else lo
        buffer = max(float(cfg.buffer_ticks), float(cfg.buffer_atr_mult) * atr_j)
        stop = (lo - buffer) if is_dem else (hi + buffer)
        risk = abs(entry - stop)
        if not math.isfinite(risk) or risk <= 1e-12:
            j += 1
            continue

        # lifecycle scan forward
        max_end = min(n - 1, touch_idx + max(1, int(cfg.max_bars_after_touch)))
        mfe_raw = -1e18
        mae = 1e18
        mfe_idx = touch_idx
        mae_idx = touch_idx
        end_idx = max_end
        did_stop = False

        for k in range(touch_idx, max_end + 1):
            # stop hit?
            if is_dem:
                if float(low[k]) <= stop:
                    end_idx = k
                    did_stop = True
            else:
                if float(high[k]) >= stop:
                    end_idx = k
                    did_stop = True
            # r_move based on favorable direction using extremum on the bar (best-case within bar)
            if is_dem:
                r_hi = (float(high[k]) - entry) / risk
                r_lo = (float(low[k]) - entry) / risk
            else:
                r_hi = (entry - float(low[k])) / risk
                r_lo = (entry - float(high[k])) / risk

            if r_hi > mfe_raw:
                mfe_raw = r_hi
                mfe_idx = k
            if r_lo < mae:
                mae = r_lo
                mae_idx = k

            if did_stop and k >= end_idx:
                break

        mfe_capped = min(float(mfe_raw), float(cfg.mfe_cap_R))

        # depth in zone (how deep inside before reaction) – use adverse penetration
        if is_dem:
            max_depth = max(0.0, (hi - float(np.min(low[touch_idx : end_idx + 1]))))
        else:
            max_depth = max(0.0, (float(np.max(high[touch_idx : end_idx + 1])) - lo))
        zone_h = max(1e-12, hi - lo)
        depth_pct = max_depth / zone_h
        depth_atr = max_depth / atr_j if atr_j > 1e-12 else 0.0

        ev = {
            "event_idx": int(len(out)),
            "touch_n": int(touch_n),
            "touch_start_idx": int(touch_idx),
            "entry_price": float(entry),
            "stop_price": float(stop),
            "risk": float(risk),
            "mae_R": float(mae),
            "mfe_R_raw": float(mfe_raw),
            "mfe_R_capped": float(mfe_capped),
            "time_to_mfe_bars": int(max(0, mfe_idx - touch_idx)),
            "max_depth_in_zone_pct": float(depth_pct),
            "max_depth_in_zone_atr": float(depth_atr),
            "did_stop": bool(did_stop),
            "bars_to_stop": int(max(0, end_idx - touch_idx)) if did_stop else None,
            "levels": {
                "r1_price": float(entry + (risk if is_dem else -risk)),
                "r2_price": float(entry + (2 * risk if is_dem else -2 * risk)),
                "r3_price": float(entry + (3 * risk if is_dem else -3 * risk)),
            },
            "markers": {
                "touch": {"bar_index": int(touch_idx), "price": float(entry)},
                "entry": {"bar_index": int(touch_idx), "price": float(entry)},
                "stop": {"bar_index": int(touch_idx), "price": float(stop)},
                "mfe": {"bar_index": int(mfe_idx), "price": float(high[mfe_idx] if is_dem else low[mfe_idx])},
                "mae": {"bar_index": int(mae_idx), "price": float(low[mae_idx] if is_dem else high[mae_idx])},
                "end": {"bar_index": int(end_idx), "price": float(low[end_idx] if is_dem else high[end_idx])},
            },
        }
        out.append(ev)

        # cooldown: require departure to consider next touch
        # For demand: wait until low > hi + dep_margin for cooldown_bars
        # For supply: wait until high < lo - dep_margin for cooldown_bars
        cool = max(0, int(cfg.cooldown_bars))
        j = end_idx + 1
        if cool <= 0:
            continue
        streak = 0
        while j < n and streak < cool:
            atr_j2 = float(atr[j]) if j < len(atr) else atr_j
            if not math.isfinite(atr_j2) or atr_j2 <= 0:
                atr_j2 = atr_j
            dep2 = cfg.departure_margin_atr * atr_j2
            if is_dem:
                outside = float(low[j]) > (hi + dep2)
            else:
                outside = float(high[j]) < (lo - dep2)
            streak = streak + 1 if outside else 0
            j += 1

    return out


def analyze_zones_r_multiple(
    df: pd.DataFrame,
    zones: list[dict[str, Any]],
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cfg = _parse_config(params)
    pblob = str(params or {})
    try:
        last_ix = df.index[-1] if len(df) else ""
        last_iso = last_ix.isoformat() if hasattr(last_ix, "isoformat") else str(last_ix)
    except Exception:
        last_iso = ""
    # Cache key: stable summary of df tail + zones ids + params
    try:
        zids = "|".join(zone_id(z) for z in (zones or []) if isinstance(z, dict))[:8000]
    except Exception:
        zids = ""
    cache_k = _sha16(f"{len(df)}|{last_iso}|{zids}|{pblob}")
    if cache_k in _MEM_CACHE:
        return _MEM_CACHE[cache_k]

    atr = _compute_atr(df, period=int((params or {}).get("atr_period", 14)))

    z_f = [z for z in (zones or []) if isinstance(z, dict) and _valid_zone(z)]
    # Deterministic ordering + limit
    z_f.sort(key=lambda z: (str(z.get("date_start") or ""), str(z.get("name") or ""), float(z.get("value_low", 0.0))))
    if cfg.max_zones > 0:
        z_f = z_f[: int(cfg.max_zones)]

    rows: list[dict[str, Any]] = []
    all_mfe: list[float] = []
    all_mae: list[float] = []
    events_n = 0

    for z in z_f:
        zid = zone_id(z)
        evs = _touch_events_for_zone(df, z, atr, cfg)
        events_n += len(evs)
        for ev in evs:
            all_mfe.append(float(ev.get("mfe_R_capped") or 0.0))
            all_mae.append(float(ev.get("mae_R") or 0.0))

        def _avg(xs: list[float]) -> float | None:
            xs2 = [float(x) for x in xs if math.isfinite(float(x))]
            if not xs2:
                return None
            return float(sum(xs2) / len(xs2))

        mfe_list = [float(e.get("mfe_R_capped") or 0.0) for e in evs]
        mae_list = [float(e.get("mae_R") or 0.0) for e in evs]
        best_mfe = max(mfe_list) if mfe_list else None
        row = {
            "zone_id": zid,
            "zone_meta": {
                "name": z.get("name"),
                "date_start": z.get("date_start"),
                "date_end": z.get("date_end"),
                "start_idx": z.get("start_idx"),
                "end_idx": z.get("end_idx"),
                "pivot_idx": z.get("pivot_idx"),
                "value_low": z.get("value_low"),
                "value_high": z.get("value_high"),
                "inducement_count": z.get("inducement_count"),
                "inducement_points": z.get("inducement_points"),
                "has_touch": z.get("has_touch"),
                "touch_bar_index": z.get("touch_bar_index"),
                "touch_marker_price": z.get("touch_marker_price"),
            },
            "r_config": {
                "entry_rule": "edge",
                "mfe_cap_R": cfg.mfe_cap_R,
                "buffer_atr_mult": cfg.buffer_atr_mult,
                "buffer_ticks": cfg.buffer_ticks,
                "departure_margin_atr": cfg.departure_margin_atr,
                "cooldown_bars": cfg.cooldown_bars,
                "max_bars_after_touch": cfg.max_bars_after_touch,
            },
            "zone_agg": {
                "n_events": int(len(evs)),
                "best_mfe_R_capped": float(best_mfe) if best_mfe is not None else None,
                "avg_mfe_R_capped": _avg(mfe_list),
                "avg_mae_R": _avg(mae_list),
            },
            "touch_events": evs,
        }
        rows.append(row)

    def _pct(xs: list[float], q: float) -> float | None:
        xs2 = [float(x) for x in xs if math.isfinite(float(x))]
        if not xs2:
            return None
        return float(np.quantile(np.asarray(xs2, dtype=np.float64), q))

    summary = {
        "zones_count": int(len(rows)),
        "events_count": int(events_n),
        "avg_mfe_R_capped": (sum(all_mfe) / len(all_mfe)) if all_mfe else None,
        "avg_mae_R": (sum(all_mae) / len(all_mae)) if all_mae else None,
        "p50_mfe_R_capped": _pct(all_mfe, 0.5),
        "p75_mfe_R_capped": _pct(all_mfe, 0.75),
        "p90_mfe_R_capped": _pct(all_mfe, 0.9),
    }

    out = {"summary": summary, "zones": rows, "params_used": {"config": cfg.__dict__}}
    _MEM_CACHE[cache_k] = out
    _MEM_CACHE_ORDER.append(cache_k)
    if len(_MEM_CACHE_ORDER) > _MEM_CACHE_MAX:
        old = _MEM_CACHE_ORDER.pop(0)
        _MEM_CACHE.pop(old, None)
    return out

