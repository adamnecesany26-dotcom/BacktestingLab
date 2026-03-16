# -*- coding: utf-8 -*-
"""
Swing High / Low Detector - samostatny modul pro detekci swing bodu.

Pouziti v aplikaci:
1. Vytvor modul (napr. "Swing HL") v sekci Moduly
2. Zkopiruj tento kod do main.py modulu
3. Uloz
4. Ve View: vyber modul, ikona params - uprav parametry
5. Ve strategii: from modules.Swing_HL import detect, get_swings  (nazev podle jmena modulu v app)

Interface pro View:
  detect(ohlc, params=None) -> [{"date": "YYYY-MM-DD", "type": "high"|"low", "value": float}, ...]

Interface pro strategii/indikator:
  get_swings(ohlc, params=None) -> [{"type": "high"|"low", "price": float, "index": int, "timestamp": ...}, ...]

  Strategie predava timeframe pro skalovani parametru:
    import os
    tf = params.get("swing_tf", os.environ.get("TIMEFRAME", "1d"))
    swings = get_swings(ohlc, {"timeframe": tf})

Algoritmus: candidate -> replacement -> confirmation (ATR) -> locked.
Vylepseni: zpracovani v oknech (window_bars), single candidate, ATR floor, inferred min_pullback.
"""

import pandas as pd
from typing import Any

ATR_FLOOR = 0.0001
MIN_THRESHOLD_ATR_RATIO = 0.3

TF_CONFIG = {
    "1m": {"atr_period": 60, "min_bars_between_swings": 12, "window_bars": 2000},
    "5m": {"atr_period": 40, "min_bars_between_swings": 8, "window_bars": 1000},
    "15m": {"atr_period": 28, "min_bars_between_swings": 6, "window_bars": 500},
    "1h": {"atr_period": 20, "min_bars_between_swings": 5, "window_bars": 360},
    "4h": {"atr_period": 14, "min_bars_between_swings": 4, "window_bars": 180},
    "1d": {"atr_period": 10, "min_bars_between_swings": 4, "window_bars": 120},
}

VIEW_PARAMS = {
    "timeframe": "1d",
    "atr_period": 10,
    "atr_multiplier": 1.2,
    "min_bars_between_swings": 3,
    "max_candidate_bars": 0,
    "allow_unconfirmed_last_swing": True,
    "min_pullback_atr_ratio": 0.4,
    "sensitivity": 1.2,
    "window_bars": 120,
    "include_internals": False,
}


def _compute_atr(ohlc: pd.DataFrame, period: int) -> pd.Series:
    """ATR - Average True Range."""
    high = ohlc["high"]
    low = ohlc["low"]
    close = ohlc["close"]
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _get_pivot_points(ohlc: pd.DataFrame) -> list[dict]:
    """Vrati vsechny pivot high/low (3-bar pattern). Bez potvrzeni pullbackem."""
    if ohlc is None or len(ohlc) < 3:
        return []
    high = ohlc["high"].values
    low = ohlc["low"].values
    index = ohlc.index
    pivots: list[dict] = []
    for i in range(1, len(ohlc) - 1):
        if high[i] > high[i - 1] and high[i] > high[i + 1]:
            pivots.append({
                "type": "high",
                "price": float(high[i]),
                "index": i,
                "timestamp": index[i],
            })
        if low[i] < low[i - 1] and low[i] < low[i + 1]:
            pivots.append({
                "type": "low",
                "price": float(low[i]),
                "index": i,
                "timestamp": index[i],
            })
    return sorted(pivots, key=lambda x: x["index"])


def _get_swings_core(
    ohlc: pd.DataFrame,
    params: dict | None = None,
    initial_state: dict | None = None,
) -> tuple[list[dict], dict | None]:
    """
    Jádro detekce swingů - zpracuje jeden blok dat.
    initial_state: {"last_swing_type", "last_swing_idx", "last_swing_price"} pro kontinuitu mezi okny.
    Vraci (swingy s index relativnim k zacatku ohlc, final_state pro dalsi okno).
    """
    params = params or {}
    atr_period = int(params.get("atr_period", 10))
    atr_multiplier = float(params.get("atr_multiplier", 1.5))
    min_bars = max(int(params.get("min_bars_between_swings", 4)), 2)
    max_candidate_bars = int(params.get("max_candidate_bars", 0))
    allow_unconfirmed_last = params.get("allow_unconfirmed_last_swing", False)
    min_pullback_ratio = float(params.get("min_pullback_atr_ratio", 0.5))
    sensitivity = max(0.5, float(params.get("sensitivity", 1.0)))

    if ohlc is None or len(ohlc) < atr_period + 2:
        return [], initial_state

    high = ohlc["high"].values
    low = ohlc["low"].values
    atr = _compute_atr(ohlc, atr_period).values
    index = ohlc.index

    swings: list[dict] = []
    cand_high: float | None = None
    cand_high_idx: int | None = None
    cand_low: float | None = None
    cand_low_idx: int | None = None

    if initial_state:
        last_swing_idx = int(initial_state.get("last_swing_idx", -min_bars - 1))
        last_swing_type = initial_state.get("last_swing_type")
        last_swing_price: float | None = initial_state.get("last_swing_price")
    else:
        last_swing_idx = -min_bars - 1
        last_swing_type = None
        last_swing_price = None

    for i in range(1, len(ohlc) - 1):
        atr_val = atr[i] if atr[i] > 0 else (atr[i - 1] if i > 0 else 0.01)
        atr_val = max(atr_val, ATR_FLOOR)
        threshold = max(atr_val * atr_multiplier, atr_val * MIN_THRESHOLD_ATR_RATIO) / sensitivity
        min_pullback = atr_val * min_pullback_ratio / sensitivity

        if max_candidate_bars > 0 and cand_high_idx is not None and i - cand_high_idx > max_candidate_bars:
            cand_high = None
            cand_high_idx = None
        if max_candidate_bars > 0 and cand_low_idx is not None and i - cand_low_idx > max_candidate_bars:
            cand_low = None
            cand_low_idx = None

        look_for_high = last_swing_type is None or last_swing_type == "low" or last_swing_type == "high"
        look_for_low = last_swing_type is None or last_swing_type == "high" or last_swing_type == "low"

        if look_for_high:
            is_pivot_high = high[i] > high[i - 1] and high[i] > high[i + 1]
            if is_pivot_high or (cand_high is not None and high[i] > cand_high):
                if cand_high is None or high[i] > cand_high:
                    cand_high = float(high[i])
                    cand_high_idx = i

        if look_for_low:
            is_pivot_low = low[i] < low[i - 1] and low[i] < low[i + 1]
            if is_pivot_low or (cand_low is not None and low[i] < cand_low):
                if cand_low is None or low[i] < cand_low:
                    cand_low = float(low[i])
                    cand_low_idx = i

        can_confirm = i - last_swing_idx >= min_bars

        if (
            cand_high is not None
            and cand_high_idx is not None
            and look_for_high
            and can_confirm
            and i > cand_high_idx
        ):
            effective_last_high = (swings[-1]["price"] if swings and swings[-1]["type"] == "high"
                                  else (last_swing_price if last_swing_type == "high" else None))
            is_new_extreme = (last_swing_type == "high" and effective_last_high is not None
                              and cand_high > effective_last_high)
            confirmed_by_pullback = low[i] <= cand_high - threshold
            if (last_swing_type != "high" and confirmed_by_pullback) or (is_new_extreme and i > cand_high_idx):
                start = max(0, last_swing_idx + 1)
                is_extremum = all(high[j] <= cand_high for j in range(start, cand_high_idx + 1))
                if is_extremum:
                    if is_new_extreme and effective_last_high is not None:
                        last_high_price = effective_last_high
                        search_start = max(0, last_swing_idx + min_bars)
                        search_end = cand_high_idx
                        if search_end > search_start:
                            min_low_idx = min(
                                range(search_start, search_end),
                                key=lambda j: low[j],
                            )
                            inferred_low = float(low[min_low_idx])
                            min_inferred = max(threshold, min_pullback, atr_val)
                            if last_high_price - inferred_low >= min_inferred:
                                swings.append({
                                    "type": "low",
                                    "price": inferred_low,
                                    "index": min_low_idx,
                                    "timestamp": index[min_low_idx],
                                })
                                last_swing_idx = min_low_idx
                                last_swing_type = "low"
                                last_swing_price = inferred_low
                    swings.append({
                        "type": "high",
                        "price": cand_high,
                        "index": cand_high_idx,
                        "timestamp": index[cand_high_idx],
                    })
                    last_swing_idx = cand_high_idx
                    last_swing_type = "high"
                    last_swing_price = cand_high
                    cand_high = None
                    cand_high_idx = None
                    cand_low = None
                    cand_low_idx = None
                    continue

        if (
            cand_low is not None
            and cand_low_idx is not None
            and look_for_low
            and can_confirm
            and i > cand_low_idx
        ):
            effective_last_low = (swings[-1]["price"] if swings and swings[-1]["type"] == "low"
                                 else (last_swing_price if last_swing_type == "low" else None))
            is_new_extreme = (last_swing_type == "low" and effective_last_low is not None
                              and cand_low < effective_last_low)
            confirmed_by_pullback = high[i] >= cand_low + threshold
            if (last_swing_type != "low" and confirmed_by_pullback) or (is_new_extreme and i > cand_low_idx):
                start = max(0, last_swing_idx + 1)
                is_extremum = all(low[j] >= cand_low for j in range(start, cand_low_idx + 1))
                if is_extremum:
                    if is_new_extreme and effective_last_low is not None:
                        last_low_price = effective_last_low
                        search_start = max(0, last_swing_idx + min_bars)
                        search_end = cand_low_idx
                        if search_end > search_start:
                            max_high_idx = max(
                                range(search_start, search_end),
                                key=lambda j: high[j],
                            )
                            inferred_high = float(high[max_high_idx])
                            min_inferred = max(threshold, min_pullback, atr_val)
                            if inferred_high - last_low_price >= min_inferred:
                                swings.append({
                                    "type": "high",
                                    "price": inferred_high,
                                    "index": max_high_idx,
                                    "timestamp": index[max_high_idx],
                                })
                                last_swing_idx = max_high_idx
                                last_swing_type = "high"
                                last_swing_price = inferred_high
                    swings.append({
                        "type": "low",
                        "price": cand_low,
                        "index": cand_low_idx,
                        "timestamp": index[cand_low_idx],
                    })
                    last_swing_idx = cand_low_idx
                    last_swing_type = "low"
                    last_swing_price = cand_low
                    cand_high = None
                    cand_high_idx = None
                    cand_low = None
                    cand_low_idx = None

    last_atr = max(atr[-1] if len(atr) > 0 and atr[-1] > 0 else 0.01, ATR_FLOOR)
    last_threshold = max(last_atr * atr_multiplier, last_atr * MIN_THRESHOLD_ATR_RATIO) / sensitivity
    last_min_pullback = max(last_threshold, last_atr * min_pullback_ratio / sensitivity, last_atr / sensitivity)
    n_bars = len(ohlc)
    end_threshold = max(min_bars, 3)

    if allow_unconfirmed_last and swings and cand_high is not None and cand_high_idx is not None:
        if last_swing_type == "high" and cand_high > swings[-1]["price"]:
            last_high_price = swings[-1]["price"]
            search_start = max(0, last_swing_idx + min_bars)
            search_end = cand_high_idx
            if search_end > search_start:
                min_low_idx = min(range(search_start, search_end), key=lambda j: low[j])
                inferred_low = float(low[min_low_idx])
                if last_high_price - inferred_low >= last_min_pullback:
                    swings.append({
                        "type": "low",
                        "price": inferred_low,
                        "index": min_low_idx,
                        "timestamp": index[min_low_idx],
                    })
            swings.append({
                "type": "high",
                "price": cand_high,
                "index": cand_high_idx,
                "timestamp": index[cand_high_idx],
            })
            last_swing_idx = cand_high_idx
            last_swing_type = "high"
            last_swing_price = cand_high
            cand_high = None
            cand_high_idx = None
    elif allow_unconfirmed_last and swings and cand_low is not None and cand_low_idx is not None:
        if last_swing_type == "low" and cand_low < swings[-1]["price"]:
            last_low_price = swings[-1]["price"]
            search_start = max(0, last_swing_idx + min_bars)
            search_end = cand_low_idx
            if search_end > search_start:
                max_high_idx = max(range(search_start, search_end), key=lambda j: high[j])
                inferred_high = float(high[max_high_idx])
                if inferred_high - last_low_price >= last_min_pullback:
                    swings.append({
                        "type": "high",
                        "price": inferred_high,
                        "index": max_high_idx,
                        "timestamp": index[max_high_idx],
                    })
            swings.append({
                "type": "low",
                "price": cand_low,
                "index": cand_low_idx,
                "timestamp": index[cand_low_idx],
            })
            last_swing_idx = cand_low_idx
            last_swing_type = "low"
            last_swing_price = cand_low
            cand_low = None
            cand_low_idx = None

    while allow_unconfirmed_last and swings:
        added = False
        if last_swing_type == "low" and cand_high is not None and cand_high_idx is not None:
            bars_after = n_bars - 1 - cand_high_idx
            if bars_after < end_threshold and cand_high_idx - last_swing_idx >= min_bars:
                start = max(0, last_swing_idx + 1)
                if all(high[j] <= cand_high for j in range(start, cand_high_idx + 1)):
                    swings.append({
                        "type": "high",
                        "price": cand_high,
                        "index": cand_high_idx,
                        "timestamp": index[cand_high_idx],
                    })
                    last_swing_type = "high"
                    last_swing_idx = cand_high_idx
                    last_swing_price = cand_high
                    cand_high = None
                    cand_high_idx = None
                    added = True
        elif last_swing_type == "high" and cand_low is not None and cand_low_idx is not None:
            bars_after = n_bars - 1 - cand_low_idx
            if bars_after < end_threshold and cand_low_idx - last_swing_idx >= min_bars:
                start = max(0, last_swing_idx + 1)
                if all(low[j] >= cand_low for j in range(start, cand_low_idx + 1)):
                    swings.append({
                        "type": "low",
                        "price": cand_low,
                        "index": cand_low_idx,
                        "timestamp": index[cand_low_idx],
                    })
                    last_swing_type = "low"
                    last_swing_idx = cand_low_idx
                    last_swing_price = cand_low
                    cand_low = None
                    cand_low_idx = None
                    added = True
        if not added:
            break

    final_state = None
    if last_swing_type is not None and last_swing_idx >= 0:
        final_state = {
            "last_swing_type": last_swing_type,
            "last_swing_idx": last_swing_idx,
            "last_swing_price": last_swing_price or 0.0,
        }
    elif initial_state:
        final_state = initial_state
    return swings, final_state


def get_swings(
    ohlc: pd.DataFrame,
    params: dict | None = None,
) -> list[dict]:
    """
    Detekce Swing High a Swing Low - candidate -> replacement -> confirmation -> locked.
    Pri window_bars > 0 a delce dat > window_bars zpracuje data v prekryvajících se oknech.

    params["timeframe"]: "1m"|"5m"|"15m"|"1h"|"4h"|"1d" - skalovani parametru podle TF.
    params["include_internals"]: True -> vrati {"swings": [...], "internals": [...]}, internals = pivoty mimo swingy.

    Strategie: swings = get_swings(ohlc, {"timeframe": params.get("swing_tf", "1d")})

    Vraci: list swingu NEBO dict {"swings": [...], "internals": [...]} pri include_internals=True.
    """
    params = dict(params or {})
    tf = str(params.pop("timeframe", "1d")).lower()
    include_internals = params.pop("include_internals", False)
    base = TF_CONFIG.get(tf, TF_CONFIG["1d"])
    params = {**base, **params}

    window_bars = int(params.get("window_bars", 0))
    atr_period = int(params.get("atr_period", 10))
    min_bars = max(int(params.get("min_bars_between_swings", 4)), 2)

    if ohlc is None or len(ohlc) < atr_period + 2:
        return {"swings": [], "internals": []} if include_internals else []

    if window_bars <= 0 or len(ohlc) <= window_bars:
        swings, _ = _get_swings_core(ohlc, params)
        if include_internals:
            return _add_internals(swings, ohlc)
        return swings

    atr_period_val = int(params.get("atr_period", 10))
    overlap = max(2 * atr_period_val, 2 * min_bars, window_bars // 3)
    stride = max(1, window_bars - overlap)
    all_swings: list[dict] = []
    initial_state: dict | None = None

    start = 0
    while start < len(ohlc):
        end = min(start + window_bars, len(ohlc))
        window_df = ohlc.iloc[start:end]
        if len(window_df) < atr_period + 2:
            break
        swings, final_state = _get_swings_core(window_df, params, initial_state)
        if final_state:
            last_global_idx = start + final_state["last_swing_idx"]
            next_start = start + stride
            computed_idx = last_global_idx - next_start
            initial_state = {
                "last_swing_type": final_state["last_swing_type"],
                "last_swing_idx": max(-min_bars, computed_idx),
                "last_swing_price": final_state["last_swing_price"],
            }
        else:
            initial_state = None
        for s in swings:
            s = dict(s)
            s["index"] = start + s["index"]
            all_swings.append(s)
        if end >= len(ohlc):
            break
        start += stride

    atr_series = _compute_atr(ohlc, atr_period)
    swings = _deduplicate_swings(all_swings, ohlc, atr_series)
    if include_internals:
        return _add_internals(swings, ohlc)
    return swings


def _add_internals(swings: list[dict], ohlc: pd.DataFrame) -> dict:
    """Pivot body, ktere nejsou na miste swingu. Vraci {"swings": [...], "internals": [...]}."""
    pivots = _get_pivot_points(ohlc)
    swing_keys = {(s["index"], s["type"]) for s in swings}
    internals = [p for p in pivots if (p["index"], p["type"]) not in swing_keys]
    return {"swings": swings, "internals": internals}


DEDUP_INDEX_TOLERANCE = 2
DEDUP_PRICE_ATR_TOLERANCE = 0.5


def _deduplicate_swings(
    swings: list[dict],
    ohlc: pd.DataFrame | None = None,
    atr_series: pd.Series | None = None,
) -> list[dict]:
    """
    Slouci swingy stejneho typu v toleranci ±DEDUP_INDEX_TOLERANCE baru.
    Slouci jen pokud rozdil cen < ATR * DEDUP_PRICE_ATR_TOLERANCE (ochrana double top/bottom).
    """
    if not swings:
        return []
    atr_val = None
    if ohlc is not None and atr_series is not None and len(atr_series) > 0:
        atr_val = float(atr_series.median())
        atr_val = max(atr_val, ATR_FLOOR)
    sorted_swings = sorted(swings, key=lambda x: (x["index"], x["type"]))
    result: list[dict] = []
    for s in sorted_swings:
        merged = False
        for i, r in enumerate(result):
            if r["type"] != s["type"]:
                continue
            if abs(r["index"] - s["index"]) > DEDUP_INDEX_TOLERANCE:
                continue
            price_diff = abs(r["price"] - s["price"])
            if atr_val is not None and price_diff >= atr_val * DEDUP_PRICE_ATR_TOLERANCE:
                continue
            if s["type"] == "high" and s["price"] > r["price"]:
                result[i] = dict(s)
            elif s["type"] == "low" and s["price"] < r["price"]:
                result[i] = dict(s)
            merged = True
            break
        if not merged:
            result.append(dict(s))
    return sorted(result, key=lambda x: x["index"])


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Interface pro View chart - vrati markery ve formatu aplikace.
    [{"date": "YYYY-MM-DD", "type": "high"|"low"|"internal_high"|"internal_low", "value": float}, ...]
    """
    result = get_swings(ohlc, params)
    if isinstance(result, dict):
        swings = result["swings"]
        internals = result["internals"]
    else:
        swings = result
        internals = []

    results = []
    for s in swings:
        ts = s["timestamp"]
        date_str = _to_date_str(ts)
        results.append({
            "date": date_str,
            "type": s["type"],
            "value": s["price"],
        })
    for s in internals:
        ts = s["timestamp"]
        date_str = _to_date_str(ts)
        results.append({
            "date": date_str,
            "type": f"internal_{s['type']}",
            "value": s["price"],
        })
    return results
