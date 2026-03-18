# -*- coding: utf-8 -*-
"""
Supply/Demand zóny v-1.0 - modul pro detekci S/D zón na základě BOS.

# VIEW_DEPENDENCIES: Swing HL, HL identificator

Použití:
1. Vytvoř modul (např. "S/D Zones") v sekci Moduly
2. Zkopíruj tento kód do main.py modulu
3. Ulož
4. Ve View: vyber modul S/D Zones - zóny se zobrazí (View automaticky načte Swing HL)
5. Ve strategii: přidej Swing HL i S/D Zones do aplikovaných modulů, pak:
   from modules.Swing_HL import get_bos   # pro BOS události
   from modules.S_D_Zones import get_zones # pro S/D zóny (get_zones interně volá get_bos)

Interface pro View:
  detect(ohlc, params=None) -> [{"date","type":"high"|"low"|"internal_high"|"internal_low","value"}, ...]
  get_zones(ohlc, params=None) -> [{"date_start","date_end","value_low","value_high","fillcolor","name","base_length","impulse_score",
    "has_gap"?, "gap_type"?, "gap_date"?, "gap_value_low"?, "gap_value_high"?}, ...]

Pravidla S/D v-1.0 (viz SD_def.md):
- Demand: bullish BOS + pivot = bar s min(low) v momentum leg (od swing low k BOS)
- Supply: bearish BOS + pivot = bar s max(high) v momentum leg (od swing high k BOS)
- Výška zóny: H/L pivot svíčky
- Šířka vlevo: prodloužení doleva, pokud předchozí svíčka má ≥33% H-L v zóně A ≥10% těla v zóně
- Šířka vpravo: zanikne při close pod zónou; dotyk až po svíčce s H/L mimo zónu; max 60 barů
- V podobném místě a blízkém čase nesmí vzniknout 2 zóny stejného typu
"""

import pandas as pd
from typing import Any

VIEW_PARAMS = {
    "timeframe": "1d",
    # Parametry předávané do Swing HL (get_bos)
    "atr_period": 10,
    "atr_multiplier": 1.2,
    "min_bars_between_swings": 3,
    "max_bars": 180,
    "acceptance_bars": 1,
    # Prah pro šířku zóny (0.33 = 33% H-L v zóně)
    "zone_overlap_threshold": 0.33,
    # Min. 10% těla svíčky musí být v zóně pro rozšíření doleva
    "zone_body_overlap_threshold": 0.10,
    # Rozšíření zóny doprava (do budoucna) - max. barů, pak zóna zmizí
    "zone_extend_right_bars": 60,
    # Min. barů mezi zónami stejného typu v podobné cenové oblasti
    "zone_min_bars_between_same": 7,
    # Min. cenový overlap (0-1) pro považování zón za „stejné místo“
    "zone_price_overlap_threshold": 0.25,
    # Touch v blízkosti: předchozí bar musí být do X×ATR od zóny (tap před vyražením)
    "zone_touch_vicinity_atr": 0.5,
    # Inducement (pasivní likvidita): max. vzdálenost H/L od zóny v ATR
    "inducement_max_distance_atr": 2.0,
    # Inducement: max. barů od pivotu (pohyb od zóny)
    "inducement_max_bars": 40,
}


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _bar_overlap_ratio(bar_high: float, bar_low: float, zone_low: float, zone_high: float) -> float:
    """Podíl H-L range svíčky v zóně. 0 pokud bar_range <= 0."""
    bar_range = bar_high - bar_low
    if bar_range <= 0:
        return 0.0
    overlap_low = max(zone_low, bar_low)
    overlap_high = min(zone_high, bar_high)
    overlap_len = max(0.0, overlap_high - overlap_low)
    return overlap_len / bar_range


def _compute_zone_width(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    threshold: float,
    body_threshold: float = 0.10,
) -> int:
    """
    Vrátí index nejlevější svíčky, která se počítá do šířky zóny.
    Zóna se prodlužuje doleva, dokud předchozí svíčka splňuje OBOJÍ:
    - >= threshold (33%) svého H-L v zóně
    - >= body_threshold (10%) těla svíčky v zóně
    """
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    open_col = ohlc["open"].values if "open" in ohlc.columns else ohlc["Open"].values
    close_col = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values

    leftmost = pivot_idx
    for j in range(pivot_idx - 1, -1, -1):
        bar_high = float(high[j])
        bar_low = float(low[j])
        bar_open = float(open_col[j])
        bar_close = float(close_col[j])
        bar_range = bar_high - bar_low
        if bar_range <= 0:
            continue
        overlap_low = max(zone_low, bar_low)
        overlap_high = min(zone_high, bar_high)
        overlap_len = max(0.0, overlap_high - overlap_low)
        ratio = overlap_len / bar_range
        if ratio < threshold:
            break
        body_low = min(bar_open, bar_close)
        body_high = max(bar_open, bar_close)
        body_len = body_high - body_low
        if body_len > 0:
            body_overlap_low = max(zone_low, body_low)
            body_overlap_high = min(zone_high, body_high)
            body_overlap = max(0.0, body_overlap_high - body_overlap_low)
            body_ratio = body_overlap / body_len
            if body_ratio < body_threshold:
                break
        leftmost = j
    return leftmost


def _compute_base_width(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    rightmost: int,
    base_threshold: float = 0.49,
) -> int:
    """
    Base = svíčky s >= base_threshold (49%) své H-L range v zóně, v obou směrech od pivotu.
    Vrací počet barů (min 1).
    """
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    n = len(ohlc)

    leftmost_base = pivot_idx
    for j in range(pivot_idx - 1, -1, -1):
        bar_high = float(high[j])
        bar_low = float(low[j])
        if _bar_overlap_ratio(bar_high, bar_low, zone_low, zone_high) >= base_threshold:
            leftmost_base = j
        else:
            break

    rightmost_base = pivot_idx
    for j in range(pivot_idx + 1, min(rightmost + 1, n)):
        bar_high = float(high[j])
        bar_low = float(low[j])
        if _bar_overlap_ratio(bar_high, bar_low, zone_low, zone_high) >= base_threshold:
            rightmost_base = j
        else:
            break

    return max(1, rightmost_base - leftmost_base + 1)


def _compute_zone_width_right(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    max_bars: int,
    zone_type: str,
    atr_series: pd.Series,
    touch_vicinity_atr: float,
) -> tuple[int, bool]:
    """
    Vrátí (rightmost_idx, has_touch).
    Zóna zaniká: 1) close invalidation (close pod/nad zónou), NEBO
                 2) dotyk ceny se zónou POTÉ, co cena nejdřív opustila zónu
                    (Demand: bar_low > zone_high pak bar_low <= zone_high; Supply: obráceně).
    has_touch = True pokud byl dotyk v blízkosti zóny (tap před vyražením).
    """
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    close = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    rightmost = pivot_idx
    has_touch = False
    has_left_zone = False

    for j in range(pivot_idx + 1, min(pivot_idx + max_bars + 1, n)):
        bar_close = float(close[j])
        bar_high = float(high[j])
        bar_low = float(low[j])

        if zone_type == "Demand":
            if bar_low > zone_high:
                has_left_zone = True
            if has_left_zone and bar_low <= zone_high:
                atr_val = float(atr_series.iloc[min(j - 1, n - 1)]) if j > 0 else 1e-8
                if atr_val <= 0:
                    atr_val = 1e-8
                margin = atr_val * touch_vicinity_atr
                prev_close = float(close[j - 1])
                if zone_low - margin <= prev_close <= zone_high + margin:
                    has_touch = True
                # Touch má prioritu – zóna končí 3 bary po dotyku (rezerva pro entry)
                rightmost = min(j + 3, n - 1)
                break
            if bar_close < zone_low:
                rightmost = j - 1
                break
        else:
            if bar_high < zone_low:
                has_left_zone = True
            if has_left_zone and bar_high >= zone_low:
                atr_val = float(atr_series.iloc[min(j - 1, n - 1)]) if j > 0 else 1e-8
                if atr_val <= 0:
                    atr_val = 1e-8
                margin = atr_val * touch_vicinity_atr
                prev_close = float(close[j - 1])
                if zone_low - margin <= prev_close <= zone_high + margin:
                    has_touch = True
                # Touch má prioritu – zóna končí 3 bary po dotyku (rezerva pro entry)
                rightmost = min(j + 3, n - 1)
                break
            if bar_close > zone_high:
                rightmost = j - 1
                break

        rightmost = j
    return rightmost, has_touch


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Swing pointy + Major Swing HL + Internal HL pro View.
    """
    get_major_swings = None
    try:
        from modules.Swing_HL import get_swings, get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_swings
        except ImportError:
            return []
        try:
            from modules.HL_identificator import get_major_swings
        except ImportError:
            get_major_swings = None

    params = dict(params or {})
    params["include_internals"] = True
    result = get_swings(ohlc, params)
    if isinstance(result, dict):
        swings = result.get("swings", [])
        internals = result.get("internals", [])
        major_swings = result.get("major_swings", [])
        if not major_swings and get_major_swings:
            maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
            major_swings = get_major_swings(ohlc, maj_params)
    else:
        swings = result
        internals = []
        major_swings = []
        if get_major_swings:
            maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
            major_swings = get_major_swings(ohlc, maj_params)

    out: list[dict] = []
    for s in major_swings:
        ts = s.get("timestamp")
        date_str = _to_date_str(ts) if ts is not None else ""
        if date_str:
            out.append({"date": date_str, "type": s["type"], "value": float(s.get("price", 0))})
    for s in swings:
        ts = s.get("timestamp")
        date_str = _to_date_str(ts) if ts is not None else ""
        if date_str:
            out.append({
                "date": date_str,
                "type": s.get("type", "high"),
                "value": float(s.get("price", 0)),
            })
    for s in internals:
        ts = s.get("timestamp")
        date_str = _to_date_str(ts) if ts is not None else ""
        if date_str:
            out.append({
                "date": date_str,
                "type": f"internal_{s.get('type', 'high')}",
                "value": float(s.get("price", 0)),
            })
    return out


def _compute_atr(ohlc: pd.DataFrame, period: int) -> pd.Series:
    """ATR pro range expansion v impulse score."""
    high = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    close = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period, min_periods=1).mean()


def _compute_impulse_score(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    bos_idx: int,
    zone_type: str,
    high_col: Any,
    low_col: Any,
    open_col: Any,
    close_col: Any,
    atr_series: pd.Series,
    atr_period: int,
) -> int:
    """
    Impulse score 1-4: síla pohybu ze zóny.
    Odpovídá otázce: "Byl impuls ze zóny silný?"
    TF-agnostické: move/ATR, rychlost (počet barů), směrová dominance.
    4 = velmi silný, 3 = silný, 2 = průměrný, 1 = slabý.
    """
    n_bars = bos_idx - pivot_idx + 1
    if n_bars < 2:
        return 1

    move = abs(float(close_col.iloc[bos_idx]) - float(close_col.iloc[pivot_idx]))
    atr_val = float(atr_series.iloc[bos_idx]) if bos_idx < len(atr_series) else float(atr_series.iloc[-1])
    if atr_val <= 0:
        atr_val = 1e-8

    move_norm = move / atr_val

    # Podíl svíček ve směru: Demand = zelené, Supply = červené
    in_direction = sum(
        1 for i in range(pivot_idx, min(bos_idx + 1, len(ohlc)))
        if (zone_type == "Demand" and float(close_col.iloc[i]) > float(open_col.iloc[i]))
        or (zone_type == "Supply" and float(close_col.iloc[i]) < float(open_col.iloc[i]))
    )
    direction_ratio = in_direction / max(1, n_bars)

    # Filtr: silná opačná svíčka = chop/noise
    for i in range(pivot_idx, min(bos_idx + 1, len(ohlc))):
        body = abs(float(close_col.iloc[i]) - float(open_col.iloc[i]))
        if body > atr_val * 0.7:
            if zone_type == "Demand" and float(close_col.iloc[i]) < float(open_col.iloc[i]):
                return 1
            if zone_type == "Supply" and float(close_col.iloc[i]) > float(open_col.iloc[i]):
                return 1

    # Silný impuls = velký pohyb + rychlý + ve směru
    is_strong = (
        move_norm >= 1.5
        and n_bars <= 2 * atr_period
        and direction_ratio >= 0.6
    )

    if not is_strong:
        if move_norm >= 1.0 and direction_ratio >= 0.5:
            return 2
        return 1

    if move_norm >= 2.5 and direction_ratio >= 0.7:
        return 4
    return 3


def _zones_overlap(
    z1_low: float,
    z1_high: float,
    z1_pivot_idx: int,
    z2_low: float,
    z2_high: float,
    z2_pivot_idx: int,
    min_bars: int,
    price_overlap_threshold: float,
) -> bool:
    """
    True pokud zóny jsou v podobném místě a blízkém čase.
    """
    if abs(z1_pivot_idx - z2_pivot_idx) > min_bars:
        return False
    overlap_low = max(z1_low, z2_low)
    overlap_high = min(z1_high, z2_high)
    overlap_len = max(0.0, overlap_high - overlap_low)
    z1_range = z1_high - z1_low
    z2_range = z2_high - z2_low
    if z1_range <= 0 or z2_range <= 0:
        return overlap_len > 0
    ratio1 = overlap_len / z1_range
    ratio2 = overlap_len / z2_range
    return ratio1 >= price_overlap_threshold or ratio2 >= price_overlap_threshold


def _find_pivot_momentum_leg(
    ohlc: pd.DataFrame,
    swings: list[dict],
    bos_idx: int,
    swing_idx: int,
    bos_type: str,
    high_col: Any,
    low_col: Any,
) -> int | None:
    """
    Pivot = bar s extrémem v momentum leg.
    Demand: min(low) od posledního swing low k BOS.
    Supply: max(high) od posledního swing high k BOS.
    Bez validního swingu v momentum leg zónu nevytváříme (žádný fallback bos_idx-30).
    """
    if bos_type == "bos_bullish":
        before = [s for s in swings if s["type"] == "low" and s["index"] < swing_idx]
        if not before:
            return None
        start_idx = max(s["index"] for s in before)
        start_idx = min(start_idx, bos_idx - 1)
        search_start = max(0, start_idx)
        search_end = min(bos_idx, len(ohlc) - 1)
        if search_end <= search_start:
            return None
        min_low_idx = min(
            range(search_start, search_end + 1),
            key=lambda i: float(low_col.iloc[i]),
        )
        return min_low_idx
    else:
        before = [s for s in swings if s["type"] == "high" and s["index"] < swing_idx]
        if not before:
            return None
        start_idx = max(s["index"] for s in before)
        start_idx = min(start_idx, bos_idx - 1)
        search_start = max(0, start_idx)
        search_end = min(bos_idx, len(ohlc) - 1)
        if search_end <= search_start:
            return None
        max_high_idx = max(
            range(search_start, search_end + 1),
            key=lambda i: float(high_col.iloc[i]),
        )
        return max_high_idx


def _find_inducements(
    ohlc: pd.DataFrame,
    zone_low: float,
    zone_high: float,
    pivot_idx: int,
    rightmost: int,
    zone_type: str,
    swings: list[dict],
    internals: list[dict],
    major_swings: list[dict],
    atr_series: pd.Series,
    params: dict,
) -> tuple[list[dict], int]:
    """
    Inducement = H/L (swing/internal/major) během pohybu od zóny – pasivní likvidita.
    Demand: hledáme lows; Supply: hledáme highs.
    Pravidla: max vzdálenost od zóny (ATR).
    Invalidation: 1) cena udělala nižší low (Demand) / vyšší high (Supply) než inducement;
                  2) novější inducement sáhl pod/nad starší.
    Vrací (inducements, inducement_count, inducement_points).
    inducement_count = počet míst, inducement_points = bodování (max 4).
    """
    max_dist_atr = float(params.get("inducement_max_distance_atr", 2.0))
    max_bars = int(params.get("inducement_max_bars", 40))
    search_end = min(pivot_idx + max_bars, rightmost, len(ohlc) - 1)
    search_start = pivot_idx + 1
    if search_end <= search_start:
        return [], 0

    atr_val = float(atr_series.iloc[pivot_idx]) if pivot_idx < len(atr_series) else float(atr_series.iloc[-1])
    if atr_val <= 0:
        atr_val = 1e-8

    # Demand: zone_high je horní hranice; low inducement musí být blízko (nad zone_high, do max_dist_atr*ATR)
    # Supply: zone_low je dolní hranice; high inducement musí být blízko (pod zone_low, do max_dist_atr*ATR)
    if zone_type == "Demand":
        ref_level = zone_high
        max_dist = max_dist_atr * atr_val
        # low je validní pokud je v [zone_high - malá tolerance, zone_high + max_dist] - vlastně "nad" zónou
        # Inducement low = pullback během pohybu nahoru. Musí být blízko zóny = ne moc daleko nad zone_high
        def in_range(val: float) -> bool:
            dist = val - ref_level  # distance above zone
            return 0 <= dist <= max_dist  # low musí být nad zónou, ale ne moc daleko

        def invalidation(newer_val: float, older_val: float) -> bool:
            return newer_val < older_val  # novější low pod starším = starší invalidní
    else:
        ref_level = zone_low
        max_dist = max_dist_atr * atr_val
        def in_range(val: float) -> bool:
            dist = ref_level - val  # distance below zone
            return 0 <= dist <= max_dist  # high musí být pod zónou, ale ne moc daleko

        def invalidation(newer_val: float, older_val: float) -> bool:
            return newer_val > older_val  # novější high nad starším = starší invalidní

    candidates: list[dict] = []

    def add(t: str, pts: int, s: dict):
        idx = s.get("index", -1)
        if search_start <= idx <= search_end:
            val = float(s.get("price", 0))
            if in_range(val):
                candidates.append({"index": idx, "value": val, "type": t, "points": pts})

    for s in swings:
        if zone_type == "Demand" and s.get("type") == "low":
            add("swing_low", 2, s)
        elif zone_type == "Supply" and s.get("type") == "high":
            add("swing_high", 2, s)

    for s in internals:
        if zone_type == "Demand" and s.get("type") == "low":
            add("internal_low", 1, s)
        elif zone_type == "Supply" and s.get("type") == "high":
            add("internal_high", 1, s)

    for s in major_swings:
        if zone_type == "Demand" and s.get("type") == "major_low":
            add("major_low", 4, s)
        elif zone_type == "Supply" and s.get("type") == "major_high":
            add("major_high", 4, s)

    # Invalidation: 1) cena udělala nižší low (Demand) / vyšší high (Supply) než inducement -> invalidní
    # 2) novější inducement sáhl pod/nad starší -> starší invalidní
    low_col = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    high_col = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    n_bars = len(ohlc)

    candidates.sort(key=lambda x: x["index"])
    valid: list[dict] = []
    for i, c in enumerate(candidates):
        invalidated = False
        ind_idx = c["index"]
        ind_val = c["value"]
        for j in range(ind_idx + 1, min(search_end + 1, n_bars)):
            if zone_type == "Demand":
                if float(low_col[j]) < ind_val:
                    invalidated = True
                    break
            else:
                if float(high_col[j]) > ind_val:
                    invalidated = True
                    break
        if invalidated:
            continue
        for j in range(i + 1, len(candidates)):
            if invalidation(candidates[j]["value"], ind_val):
                invalidated = True
                break
        if not invalidated:
            valid.append(c)

    # count = počet míst (úrovní likvidity), total = bodování (internal=1, swing=2, major=4, max 4)
    count = len(valid)
    total = min(4, sum(c["points"] for c in valid))

    index = ohlc.index
    inducements = [
        {
            "date": _to_date_str(index[c["index"]]),
            "value": c["value"],
            "type": c["type"],
            "index": c["index"],
        }
        for c in valid
    ]

    return inducements, count, total


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Supply/Demand zóny v-1.0 - BOS-based.
    Pivot = bar s extrémem v momentum leg (začátek pohybu), ne striktně opačná barva.
    Demand: pivot = bar s min(low) od swing low k BOS.
    Supply: pivot = bar s max(high) od swing high k BOS.
    """
    try:
        from modules.Swing_HL import get_bos, get_swings, get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_bos, get_swings, get_major_swings
        except ImportError:
            try:
                from modules.HL_identificator import get_bos, get_swings
            except ImportError:
                return []
            get_major_swings = None

    params = params or {}
    threshold = float(params.get("zone_overlap_threshold", 0.33))
    body_threshold = float(params.get("zone_body_overlap_threshold", 0.10))
    max_right_bars = int(params.get("zone_extend_right_bars", 60))
    atr_period = int(params.get("atr_period", 10))
    touch_vicinity_atr = float(params.get("zone_touch_vicinity_atr", 0.5))
    min_bars_between = int(params.get("zone_min_bars_between_same", 7))
    price_overlap_threshold = float(params.get("zone_price_overlap_threshold", 0.25))

    high_col = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low_col = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    open_col = ohlc["open"] if "open" in ohlc.columns else ohlc["Open"]
    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    index = ohlc.index
    atr_series = _compute_atr(ohlc, atr_period)

    events = get_bos(ohlc, params)
    if not events:
        return []

    swing_params = dict(params)
    swing_params["include_internals"] = True
    swing_result = get_swings(ohlc, swing_params)
    if isinstance(swing_result, dict):
        swings = swing_result.get("swings", [])
        internals = swing_result.get("internals", [])
        major_swings = swing_result.get("major_swings", [])
        if not major_swings and get_major_swings:
            maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
            major_swings = get_major_swings(ohlc, maj_params)
    else:
        swings = swing_result
        internals = []
        major_swings = []
        if get_major_swings:
            maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
            major_swings = get_major_swings(ohlc, maj_params)

    zones: list[dict] = []

    # BOS - horizontální čára od Swing H/L k místu BOS
    for ev in events:
        is_major = ev.get("is_major", False)
        name = "BOS (M)" if is_major else "BOS"
        fill = "rgba(251, 191, 36, 0.45)" if is_major else "rgba(245, 158, 11, 0.35)"
        zones.append({
            "date_start": ev["swing_date"],
            "date_end": ev["bos_date"],
            "value_low": ev["level"],
            "value_high": ev["level"],
            "fillcolor": fill,
            "name": name,
            "base_length": 0,
            "impulse_score": 0,
        })

    # S/D zóny - pivot = extrém v momentum leg; bez duplicit v podobném místě a čase
    added_sd: list[tuple[int, float, float, str]] = []

    for ev in events:
        bos_idx = ev["bos_index"]
        swing_idx = ev["swing_index"]
        if bos_idx < 1:
            continue

        pivot_idx = _find_pivot_momentum_leg(
            ohlc, swings, bos_idx, swing_idx, ev["type"], high_col, low_col
        )
        if pivot_idx is None:
            continue

        zone_low = float(low_col.iloc[pivot_idx])
        zone_high = float(high_col.iloc[pivot_idx])

        # Detekce gapu přímo u zóny (mezi pivotem a následující svíčkou) – zóna se NEROZŠIŘUJE
        gap_info: dict | None = None
        if pivot_idx + 1 < len(ohlc):
            next_low = float(low_col.iloc[pivot_idx + 1])
            next_high = float(high_col.iloc[pivot_idx + 1])
            next_date = _to_date_str(index[pivot_idx + 1])
            if next_low > zone_high:
                gap_info = {
                    "has_gap": True,
                    "gap_type": "up",
                    "gap_date": next_date,
                    "gap_value_low": zone_high,
                    "gap_value_high": next_low,
                }
            elif next_high < zone_low:
                gap_info = {
                    "has_gap": True,
                    "gap_type": "down",
                    "gap_date": next_date,
                    "gap_value_low": next_high,
                    "gap_value_high": zone_low,
                }

        if ev["type"] == "bos_bullish":
            zone_type = "Demand"
        elif ev["type"] == "bos_bearish":
            zone_type = "Supply"
        else:
            continue

        skip_duplicate = False
        for prev_pivot, prev_low, prev_high, prev_type in added_sd:
            if prev_type != zone_type:
                continue
            if _zones_overlap(
                zone_low, zone_high, pivot_idx,
                prev_low, prev_high, prev_pivot,
                min_bars_between, price_overlap_threshold,
            ):
                skip_duplicate = True
                break
        if skip_duplicate:
            continue

        rightmost, has_touch = _compute_zone_width_right(
            ohlc, pivot_idx, zone_low, zone_high, max_right_bars, zone_type,
            atr_series, touch_vicinity_atr,
        )

        if ev["type"] == "bos_bullish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = _compute_base_width(ohlc, pivot_idx, zone_low, zone_high, rightmost)
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Demand",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            inducements, inducement_count, inducement_points = _find_inducements(
                ohlc, zone_low, zone_high, pivot_idx, rightmost, "Demand",
                swings, internals, major_swings, atr_series, params,
            )
            fill = "rgba(34, 197, 94, 0.35)" if has_touch else "rgba(34, 197, 94, 0.25)"
            zone_dict: dict = {
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "start_idx": leftmost,
                "end_idx": rightmost,
                "value_low": zone_low,
                "value_high": zone_high,
                "fillcolor": fill,
                "name": "Demand",
                "base_length": base_length,
                "impulse_score": impulse_score,
                "has_touch": has_touch,
                "is_major": ev.get("is_major", False),
                "inducements": inducements,
                "inducement_count": inducement_count,
                "inducement_points": inducement_points,
            }
            if gap_info:
                zone_dict.update(gap_info)
            zones.append(zone_dict)
            added_sd.append((pivot_idx, zone_low, zone_high, "Demand"))
        elif ev["type"] == "bos_bearish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = _compute_base_width(ohlc, pivot_idx, zone_low, zone_high, rightmost)
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Supply",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            inducements, inducement_count, inducement_points = _find_inducements(
                ohlc, zone_low, zone_high, pivot_idx, rightmost, "Supply",
                swings, internals, major_swings, atr_series, params,
            )
            fill = "rgba(239, 68, 68, 0.35)" if has_touch else "rgba(239, 68, 68, 0.25)"
            zone_dict = {
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "start_idx": leftmost,
                "end_idx": rightmost,
                "value_low": zone_low,
                "value_high": zone_high,
                "fillcolor": fill,
                "name": "Supply",
                "base_length": base_length,
                "impulse_score": impulse_score,
                "has_touch": has_touch,
                "is_major": ev.get("is_major", False),
                "inducements": inducements,
                "inducement_count": inducement_count,
                "inducement_points": inducement_points,
            }
            if gap_info:
                zone_dict.update(gap_info)
            zones.append(zone_dict)
            added_sd.append((pivot_idx, zone_low, zone_high, "Supply"))

    return zones
