# -*- coding: utf-8 -*-
"""
Supply/Demand zóny v-1.0 – modul pro detekci S/D zón na základě BOS.

# VIEW_DEPENDENCIES: Swing HL, HL identificator

Použití:
1. Vytvoř modul (např. "S/D Zones") v sekci Moduly
2. Zkopíruj tento kód do main.py modulu
3. Ulož
4. Ve View: vyber modul S/D Zones – zóny se zobrazí (View automaticky načte Swing HL)
5. Ve strategii: přidej Swing HL i S/D Zones do aplikovaných modulů, pak:
   from modules.Swing_HL import get_bos   # pro BOS události
   from modules.S_D_Zones import get_zones # pro S/D zóny (get_zones interně volá get_bos)

Interface pro View:
  detect(ohlc, params=None) -> [{"date","type":"high"|"low"|"internal_high"|"internal_low","value"}, ...]
  get_zones(ohlc, params=None) -> [{"date_start","date_end","value_low","value_high","fillcolor","name","base_length","impulse_score"}, ...]

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
    # Rozšíření zóny doprava (do budoucna) – max. barů, pak zóna zmizí
    "zone_extend_right_bars": 60,
    # Min. barů mezi zónami stejného typu v podobné cenové oblasti
    "zone_min_bars_between_same": 7,
    # Min. cenový overlap (0–1) pro považování zón za „stejné místo“
    "zone_price_overlap_threshold": 0.25,
}


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


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


def _compute_zone_width_right(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    max_bars: int,
    zone_type: str,
) -> int:
    """
    Vrátí index nejpravější svíčky zóny – rozšíření doprava do budoucna.

    - Zanikne: Demand = close < zone_low, Supply = close > zone_high.
    - Dotyk: cena musí nejdřív vytvořit svíčku, jejíž H/L se zóny NEDOTÝKÁ,
      až poté hledáme dotyk. Demand: pryč = bar_low > zone_high, dotyk = low <= zone_high.
      Supply: pryč = bar_high < zone_low, dotyk = high >= zone_low.
    """
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    close = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    rightmost = pivot_idx
    moved_away = False

    for j in range(pivot_idx + 1, min(pivot_idx + max_bars + 1, n)):
        bar_low = float(low[j])
        bar_high = float(high[j])
        bar_close = float(close[j])

        if zone_type == "Demand":
            if bar_close < zone_low:
                rightmost = max(pivot_idx, j - 1)
                break
            if not moved_away:
                if bar_low > zone_high:
                    moved_away = True
            elif bar_low <= zone_high:
                rightmost = j
                break
        else:
            if bar_close > zone_high:
                rightmost = max(pivot_idx, j - 1)
                break
            if not moved_away:
                if bar_high < zone_low:
                    moved_away = True
            elif bar_high >= zone_low:
                rightmost = j
                break

        rightmost = j
    return rightmost


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Swing pointy + Major Swing HL + Internal HL pro View.
    """
    try:
        from modules.Swing_HL import get_swings, get_major_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_swings, get_major_swings
        except ImportError:
            try:
                from modules.HL_identificator import get_swings
                get_major_swings = None
            except ImportError:
                return []

    params = dict(params or {})
    params["include_internals"] = True
    result = get_swings(ohlc, params)
    if isinstance(result, dict):
        swings = result.get("swings", [])
        internals = result.get("internals", [])
    else:
        swings = result
        internals = []

    out: list[dict] = []
    if get_major_swings:
        maj_params = {"timeframe": params.get("timeframe", "1d"), "data_timeframe": params.get("data_timeframe"), **params}
        for s in get_major_swings(ohlc, maj_params):
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


def _detect_fvg_in_range(
    high_col: Any,
    low_col: Any,
    start_idx: int,
    end_idx: int,
    zone_type: str,
) -> bool:
    """
    FVG (Fair Value Gap) v momentum leg.
    Bullish FVG: bar[i].high < bar[i+2].low (gap mezi bar 1 a bar 3)
    Bearish FVG: bar[i].low > bar[i+2].high
    Vrací True pokud je alespoň jeden FVG ve směru zóny.
    """
    n = len(high_col)
    for i in range(start_idx, min(end_idx - 1, n - 2)):  # i+2 must be valid
        h0 = float(high_col.iloc[i])
        l0 = float(low_col.iloc[i])
        h2 = float(high_col.iloc[i + 2])
        l2 = float(low_col.iloc[i + 2])
        if zone_type == "Demand":
            if h0 < l2:
                return True
        else:
            if l0 > h2:
                return True
    return False


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
    Impulse score 1–10: síla momentum ze zóny.
    Komponenty: body dominance (2), direction alignment (2), FVG (2),
    consecutive momentum (2), range expansion (2).
    """
    raw = 0.0
    bars = list(range(pivot_idx, min(bos_idx + 1, len(ohlc))))
    if len(bars) < 2:
        return 1

    # 1. Body dominance (0–2): průměr body/(H-L) u pivot + 2 barů
    body_ratios = []
    for i in bars[:3]:
        h, l, o, c = float(high_col.iloc[i]), float(low_col.iloc[i]), float(open_col.iloc[i]), float(close_col.iloc[i])
        rng = h - l
        if rng > 0:
            body = abs(c - o)
            body_ratios.append(body / rng)
    avg_body = sum(body_ratios) / len(body_ratios) if body_ratios else 0
    if avg_body >= 0.6:
        raw += 2
    elif avg_body >= 0.4:
        raw += 1

    # 2. Direction alignment (0–2): pivot + 2 barů, bullish pro Demand / bearish pro Supply
    aligned = 0
    for i in bars[:3]:
        o, c = float(open_col.iloc[i]), float(close_col.iloc[i])
        if zone_type == "Demand" and c > o:
            aligned += 1
        elif zone_type == "Supply" and c < o:
            aligned += 1
    if aligned >= 3:
        raw += 2
    elif aligned >= 2:
        raw += 1

    # 3. FVG (0–2)
    if _detect_fvg_in_range(high_col, low_col, pivot_idx, bos_idx + 1, zone_type):
        raw += 2

    # 4. Consecutive momentum (0–2): po sobě jdoucí bary ve směru
    consec = 0
    for j in range(1, len(bars)):
        c_prev = float(close_col.iloc[bars[j - 1]])
        c_curr = float(close_col.iloc[bars[j]])
        if zone_type == "Demand" and c_curr > c_prev:
            consec += 1
        elif zone_type == "Supply" and c_curr < c_prev:
            consec += 1
        else:
            break
    if consec >= 3:
        raw += 2
    elif consec >= 2:
        raw += 1

    # 5. Range expansion (0–2): pohyb vs ATR
    atr_val = float(atr_series.iloc[bos_idx]) if bos_idx < len(atr_series) else float(atr_series.iloc[-1])
    if atr_val <= 0:
        atr_val = 1e-8
    move = abs(float(close_col.iloc[bos_idx]) - float(close_col.iloc[pivot_idx]))
    if move >= atr_val:
        raw += 2
    elif move >= 0.5 * atr_val:
        raw += 1

    # Normalizace na 1–10
    score = max(1, min(10, round(1 + 9 * (raw / 10))))
    return score


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
    """
    if bos_type == "bos_bullish":
        before = [s for s in swings if s["type"] == "low" and s["index"] < swing_idx]
        start_idx = max(s["index"] for s in before) if before else max(0, bos_idx - 30)
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
        start_idx = max(s["index"] for s in before) if before else max(0, bos_idx - 30)
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


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Supply/Demand zóny v-1.0 – BOS-based.
    Pivot = bar s extrémem v momentum leg (začátek pohybu), ne striktně opačná barva.
    Demand: pivot = bar s min(low) od swing low k BOS.
    Supply: pivot = bar s max(high) od swing high k BOS.
    """
    try:
        from modules.Swing_HL import get_bos, get_swings
    except ImportError:
        try:
            from modules.HL_identificator import get_bos, get_swings
        except ImportError:
            return []

    params = params or {}
    threshold = float(params.get("zone_overlap_threshold", 0.33))
    body_threshold = float(params.get("zone_body_overlap_threshold", 0.10))
    max_right_bars = int(params.get("zone_extend_right_bars", 60))
    atr_period = int(params.get("atr_period", 10))
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

    swing_result = get_swings(ohlc, params)
    swings = swing_result["swings"] if isinstance(swing_result, dict) else swing_result

    zones: list[dict] = []

    # BOS – horizontální čára od Swing H/L k místu BOS (oranžová)
    for ev in events:
        zones.append({
            "date_start": ev["swing_date"],
            "date_end": ev["bos_date"],
            "value_low": ev["level"],
            "value_high": ev["level"],
            "fillcolor": "rgba(245, 158, 11, 0.35)",
            "name": "BOS",
            "base_length": 0,
            "impulse_score": 0,
        })

    # S/D zóny – pivot = extrém v momentum leg; bez duplicit v podobném místě a čase
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

        rightmost = _compute_zone_width_right(
            ohlc, pivot_idx, zone_low, zone_high, max_right_bars, zone_type
        )

        if ev["type"] == "bos_bullish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = pivot_idx - leftmost
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Demand",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            zones.append({
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "value_low": zone_low,
                "value_high": zone_high,
                "fillcolor": "rgba(34, 197, 94, 0.25)",
                "name": "Demand",
                "base_length": base_length,
                "impulse_score": impulse_score,
            })
            added_sd.append((pivot_idx, zone_low, zone_high, "Demand"))
        elif ev["type"] == "bos_bearish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = pivot_idx - leftmost
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Supply",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            zones.append({
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "value_low": zone_low,
                "value_high": zone_high,
                "fillcolor": "rgba(239, 68, 68, 0.25)",
                "name": "Supply",
                "base_length": base_length,
                "impulse_score": impulse_score,
            })
            added_sd.append((pivot_idx, zone_low, zone_high, "Supply"))

    return zones
