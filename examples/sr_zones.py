# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — examples/sr_zones.py — modul (S/R zóny) — celý soubor vložit do Firestore (Moduly → main.py).
"""
Support/Resistance zóny v-1.2 – pouze major Swing HL.

# VIEW_DEPENDENCIES: Swing HL, HL identificator

Pravidla:
- Pouze major swing high/low (žádné běžné swingy).
- Zóna musí mít alespoň 1 major swing point.
- Zóna je validní pokud:
  (A) 2× touch – dva validní dotyky (cena odcestovala pryč mezi nimi), NEBO
  (B) Cena pobývala v rozmezí 2 major swing bodů – oba body jsou S/R.
"""

import pandas as pd
from typing import Any

VIEW_PARAMS = {
    "timeframe": "1d",
    "atr_period": 10,
    "min_bars_between_swings": 3,
    "max_bars": 180,
    "acceptance_bars": 1,
    "cluster_atr_threshold": 0.5,
    "min_travel_atr": 0.5,
    "retest_lookback_bars": 20,
    # Min. barů, kdy cena musí pobýt v rozmezí 2 swing bodů (pro path B)
    "min_consolidation_bars": 5,
    # Max vzdálenost v barech mezi 2 swing body pro "range consolidation" (path B)
    "max_range_bars": 120,
}


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _compute_atr(ohlc: pd.DataFrame, period: int) -> pd.Series:
    high = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    close = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period, min_periods=1).mean()


def _get_major_swings(ohlc: pd.DataFrame, params: dict) -> list[dict]:
    """Vrátí pouze major swing body: {"price", "type": "high"|"low", "index", "timestamp"}."""
    try:
        from modules.Swing_HL import get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_major_swings
        except ImportError:
            return []

    p = dict(params or {})
    tf = p.get("timeframe", "1d")
    maj_params = {"timeframe": tf, "data_timeframe": p.get("data_timeframe"), **p}
    points: list[dict] = []
    for s in get_major_swings(ohlc, maj_params):
        t = s.get("type", "")
        if "high" in t:
            points.append({
                "price": float(s.get("price", 0)),
                "type": "high",
                "index": s.get("index", 0),
                "timestamp": s.get("timestamp"),
            })
        elif "low" in t:
            points.append({
                "price": float(s.get("price", 0)),
                "type": "low",
                "index": s.get("index", 0),
                "timestamp": s.get("timestamp"),
            })
    return points


def _filter_valid_touches(
    ohlc: pd.DataFrame,
    cluster: list[dict],
    level_price: float,
    atr_series: pd.Series,
    min_travel_atr: float,
) -> list[dict]:
    """Validní dotyky: cena musela odcestovat od zóny před dalším dotykem."""
    if not cluster:
        return []
    sorted_pts = sorted(cluster, key=lambda x: x["index"])
    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    n = len(ohlc)
    valid: list[dict] = [sorted_pts[0]]
    last_touch_idx = sorted_pts[0]["index"]

    for pt in sorted_pts[1:]:
        idx = pt["index"]
        if idx <= last_touch_idx:
            continue
        atr_val = float(atr_series.iloc[min(idx, n - 1)]) if idx < n else 1e-8
        if atr_val <= 0:
            atr_val = 1e-8
        min_travel = atr_val * min_travel_atr
        traveled_away = False
        for i in range(last_touch_idx + 1, idx + 1):
            if i >= n:
                break
            if abs(float(close_col.iloc[i]) - level_price) >= min_travel:
                traveled_away = True
                break
        if traveled_away:
            valid.append(pt)
            last_touch_idx = idx
    return valid


def _cluster_major_points(
    points: list[dict],
    atr_series: pd.Series,
    atr_threshold: float,
) -> list[dict]:
    """Clustering major bodů podle cenové blízkosti."""
    if not points:
        return []
    mid = len(atr_series) // 2
    atr_val = float(atr_series.iloc[mid]) if mid < len(atr_series) else float(atr_series.iloc[-1])
    if atr_val <= 0:
        atr_val = 1e-8
    max_dist = atr_val * atr_threshold
    clusters: list[list[dict]] = []
    used = [False] * len(points)

    for i, pt in enumerate(points):
        if used[i]:
            continue
        cluster = [pt]
        used[i] = True
        for j in range(i + 1, len(points)):
            if used[j]:
                continue
            if abs(points[j]["price"] - pt["price"]) <= max_dist:
                cluster.append(points[j])
                used[j] = True
        clusters.append(cluster)

    out: list[dict] = []
    for cluster in clusters:
        prices = [c["price"] for c in cluster]
        level_price = float(sum(prices) / len(prices))
        highs = sum(1 for c in cluster if c["type"] == "high")
        lows = sum(1 for c in cluster if c["type"] == "low")
        level_type = "resistance" if highs >= lows else "support"
        out.append({
            "price": level_price,
            "type": level_type,
            "raw_cluster": cluster,
        })
    return out


def _find_range_consolidation_zones(
    ohlc: pd.DataFrame,
    points: list[dict],
    min_consolidation_bars: int,
    max_range_bars: int,
    retest_bars: int,
) -> list[dict]:
    """
    Path B: Dvojice major bodů, mezi nimiž cena pobývala.
    Oba body se stanou S/R.
    """
    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    n = len(ohlc)
    zones: list[dict] = []
    seen_prices: set[tuple[float, str]] = set()
    price_tol = 1e-6

    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            p1, p2 = points[i], points[j]
            i1, i2 = p1["index"], p2["index"]
            if abs(i2 - i1) > max_range_bars:
                continue
            rng_lo = min(p1["price"], p2["price"])
            rng_hi = max(p1["price"], p2["price"])
            if rng_hi - rng_lo < price_tol:
                continue
            start_i = min(i1, i2)
            end_i = min(max(i1, i2) + max_range_bars // 2, n)
            bars_in_range = 0
            for k in range(start_i, end_i):
                if k >= n:
                    break
                c = float(close_col.iloc[k])
                if rng_lo <= c <= rng_hi:
                    bars_in_range += 1
            if bars_in_range < min_consolidation_bars:
                continue
            for pt in (p1, p2):
                pr = pt["price"]
                key = (round(pr / price_tol) * price_tol, "resistance" if pt["type"] == "high" else "support")
                if key in seen_prices:
                    continue
                seen_prices.add(key)
                zone_type = "resistance" if pt["type"] == "high" else "support"
                start_idx, end_idx, final_type = _compute_zone_range(
                    ohlc, pr, zone_type, pt["index"], pt["index"], retest_bars
                )
                idx = ohlc.index
                name = "Resistance" if final_type == "resistance" else "Support"
                fill = "rgba(239, 68, 68, 0.2)" if final_type == "resistance" else "rgba(34, 197, 94, 0.2)"
                zones.append({
                    "date_start": _to_date_str(idx[start_idx]),
                    "date_end": _to_date_str(idx[min(end_idx, n - 1)]),
                    "value_low": pr,
                    "value_high": pr,
                    "fillcolor": fill,
                    "name": name,
                    "touches": 2,
                    "strength": 2,
                    "source": "range_consolidation",
                })
    return zones


def _compute_zone_range(
    ohlc: pd.DataFrame,
    level_price: float,
    zone_type: str,
    first_idx: int,
    last_touch_idx: int,
    retest_bars: int,
) -> tuple[int, int, str]:
    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    n = len(ohlc)
    start_idx, end_idx = first_idx, last_touch_idx
    current_type = zone_type
    flipped = False
    i = last_touch_idx + 1

    while i < n:
        c = float(close_col.iloc[i])
        if current_type == "support":
            if c < level_price:
                if not flipped:
                    for j in range(i + 1, min(i + 1 + retest_bars, n)):
                        if float(close_col.iloc[j]) >= level_price:
                            end_idx = j
                            current_type = "resistance"
                            flipped = True
                            i = j
                            break
                    else:
                        return start_idx, i - 1, zone_type
                else:
                    return start_idx, i - 1, current_type
            else:
                end_idx = i
        else:
            if c > level_price:
                if not flipped:
                    for j in range(i + 1, min(i + 1 + retest_bars, n)):
                        if float(close_col.iloc[j]) <= level_price:
                            end_idx = j
                            current_type = "support"
                            flipped = True
                            i = j
                            break
                    else:
                        return start_idx, i - 1, zone_type
                else:
                    return start_idx, i - 1, current_type
            else:
                end_idx = i
        i += 1
    return start_idx, end_idx, current_type


def _build_zones_from_clusters(
    ohlc: pd.DataFrame,
    clusters: list[dict],
    atr_series: pd.Series,
    min_travel_atr: float,
    retest_bars: int,
) -> list[dict]:
    """Path A: Clustery s 2+ validními dotyky."""
    if len(ohlc) == 0:
        return []
    idx = ohlc.index
    zones: list[dict] = []

    for c in clusters:
        level_price = c["price"]
        zone_type = c["type"]
        raw = c["raw_cluster"]
        valid = _filter_valid_touches(ohlc, raw, level_price, atr_series, min_travel_atr)
        if len(valid) < 2:
            continue

        sorted_valid = sorted(valid, key=lambda x: x["index"])
        first_idx = sorted_valid[0]["index"]
        last_idx = sorted_valid[-1]["index"]
        start_idx, end_idx, final_type = _compute_zone_range(
            ohlc, level_price, zone_type, first_idx, last_idx, retest_bars
        )
        date_start = _to_date_str(idx[start_idx])
        date_end = _to_date_str(idx[min(end_idx, len(idx) - 1)])
        name = "Support" if final_type == "support" else "Resistance"
        fill = "rgba(34, 197, 94, 0.2)" if final_type == "support" else "rgba(239, 68, 68, 0.2)"
        zones.append({
            "date_start": date_start,
            "date_end": date_end,
            "value_low": level_price,
            "value_high": level_price,
            "fillcolor": fill,
            "name": name,
            "touches": len(valid),
            "strength": len(valid),
            "source": "cluster_2touch",
        })
    return zones


def _deduplicate_zones(zones: list[dict], atr_val: float, price_tol_atr: float = 0.3) -> list[dict]:
    """Odstraní duplicity – zóny se stejnou cenou (v toleranci)."""
    if not zones:
        return []
    tol = atr_val * price_tol_atr
    out: list[dict] = []
    for z in zones:
        pr = z["value_low"]
        dup = False
        for o in out:
            if abs(o["value_low"] - pr) <= tol and o["name"] == z["name"]:
                dup = True
                break
        if not dup:
            out.append(z)
    return out


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    p = dict(params or {})
    atr_period = int(p.get("atr_period", 10))
    atr_threshold = float(p.get("cluster_atr_threshold", 0.5))
    min_travel_atr = float(p.get("min_travel_atr", 0.5))
    retest_bars = int(p.get("retest_lookback_bars", 20))
    min_consolidation_bars = int(p.get("min_consolidation_bars", 5))
    max_range_bars = int(p.get("max_range_bars", 120))

    points = _get_major_swings(ohlc, p)
    if not points:
        return []

    atr_series = _compute_atr(ohlc, atr_period)
    mid = len(atr_series) // 2
    atr_val = float(atr_series.iloc[mid]) if mid < len(atr_series) else float(atr_series.iloc[-1])
    if atr_val <= 0:
        atr_val = 1e-8

    zones: list[dict] = []

    clusters = _cluster_major_points(points, atr_series, atr_threshold)
    zones_a = _build_zones_from_clusters(ohlc, clusters, atr_series, min_travel_atr, retest_bars)
    zones.extend(zones_a)

    zones_b = _find_range_consolidation_zones(
        ohlc, points, min_consolidation_bars, max_range_bars, retest_bars
    )
    zones.extend(zones_b)

    return _deduplicate_zones(zones, atr_val)


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    zones = get_zones(ohlc, params)
    return [
        {"date": z["date_start"], "type": z["name"].lower(), "value": z["value_low"]}
        for z in zones
    ]
