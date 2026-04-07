# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — examples/premium_discount.py — indikátor/modul (Premium–Mid–Discount) — celý soubor vložit do Firestore (Moduly nebo Indikátory → main.py).
"""
Premium / Mid / Discount indikátor – range mezi Major Swing Low a Major Swing High.

# VIEW_DEPENDENCIES: Swing HL, HL identificator

Logika:
- Každá range = pár Major Swing Low + Major Swing High (střídavě v čase).
- Pro každou range: Discount 0–40 %, Mid 40–60 %, Premium 60–100 %.
- Zóny od místa definice range do definice další range (nebo konec dat).

Vizuálně: Premium lehce červená, Mid lehce šedá, Discount lehce zelená.
"""

import pandas as pd
from typing import Any

VIEW_PARAMS = {
    "timeframe": "1d",
    "data_timeframe": None,
}


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Vrací Major Swing HL markery pro View – aby byly vidět na grafu.
    """
    try:
        from modules.Swing_HL import get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_major_swings
        except ImportError:
            return []

    params = params or {}
    maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
    major_swings = get_major_swings(ohlc, maj_params)
    out: list[dict] = []
    for s in major_swings:
        ts = s.get("timestamp")
        date_str = _to_date_str(ts) if ts is not None else ""
        if date_str:
            out.append({"date": date_str, "type": s["type"], "value": float(s.get("price", 0))})
    return out


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Vrací Discount/Mid/Premium zóny pro každou range v datasetu.
    Každá range = pár Major Swing Low + Major Swing High (v libovolném pořadí).
    Pro každou range: Discount 0–40 %, Mid 40–60 %, Premium 60–100 %.
    """
    try:
        from modules.Swing_HL import get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_major_swings
        except ImportError:
            return []

    params = params or {}
    maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
    major_swings = get_major_swings(ohlc, maj_params)
    if not major_swings:
        return []

    sorted_swings = sorted(major_swings, key=lambda x: x.get("index", 0))
    ranges_list: list[tuple[int, float, float]] = []
    last_low = None
    last_high = None

    for s in sorted_swings:
        t = s.get("type", "")
        idx = s.get("index", -1)
        price = float(s.get("price", 0))
        if t == "major_low":
            last_low = (price, idx)
            if last_high is not None:
                r_low = min(price, last_high[0])
                r_high = max(price, last_high[0])
                if r_high > r_low:
                    # Range od předchozího High do tohoto Low – start na indexu High
                    ranges_list.append((last_high[1], r_low, r_high))
        elif t == "major_high":
            last_high = (price, idx)
            if last_low is not None:
                r_low = min(price, last_low[0])
                r_high = max(price, last_low[0])
                if r_high > r_low:
                    # Range od předchozího Low do tohoto High – start na indexu Low
                    ranges_list.append((last_low[1], r_low, r_high))

    if not ranges_list:
        return []

    n = len(ohlc)
    index = ohlc.index
    zones: list[dict] = []

    for i, (start_idx, range_low, range_high) in enumerate(ranges_list):
        end_idx = ranges_list[i + 1][0] - 1 if i + 1 < len(ranges_list) else n - 1
        end_idx = min(max(end_idx, start_idx), n - 1)

        date_start = _to_date_str(index[start_idx])
        date_end = _to_date_str(index[end_idx]) if end_idx < n else date_start

        range_size = range_high - range_low
        if range_size <= 0:
            continue
        discount_high = range_low + 0.40 * range_size
        mid_high = range_low + 0.60 * range_size

        zones.extend([
            {
                "date_start": date_start,
                "date_end": date_end,
                "value_low": range_low,
                "value_high": discount_high,
                "fillcolor": "rgba(34, 197, 94, 0.2)",
                "name": "Discount",
            },
            {
                "date_start": date_start,
                "date_end": date_end,
                "value_low": discount_high,
                "value_high": mid_high,
                "fillcolor": "rgba(161, 161, 170, 0.25)",
                "name": "Mid",
            },
            {
                "date_start": date_start,
                "date_end": date_end,
                "value_low": mid_high,
                "value_high": range_high,
                "fillcolor": "rgba(239, 68, 68, 0.2)",
                "name": "Premium",
            },
        ])

    return zones
