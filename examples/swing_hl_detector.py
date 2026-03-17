# -*- coding: utf-8 -*-
"""
Swing High / Low Detector - samostatny modul pro detekci swing bodu, BOS a CHoCH.

Pouziti v aplikaci:
1. Vytvor modul (napr. "Swing HL") v sekci Moduly
2. Zkopiruj tento kod do main.py modulu
3. Uloz
4. Ve View: vyber modul, ikona params - uprav parametry
5. Ve strategii: from modules.Swing_HL import detect, get_swings, get_bos  (nazev podle jmena modulu v app)

Interface pro View:
  detect(ohlc, params=None) -> [{"date", "type": "high"|"low"|"major_high"|"major_low"|"internal_*", "value"}, ...]
  get_line(ohlc, params=None) -> {"Trend": {"data": [...], "segments": [{"from","to","color"}, ...]}}
    Trendová čára nad cenou. Score -100..+100 z Alignment (EMA), Slope, Position, Structure.
  get_zones(ohlc, params=None) -> [{"date_start","date_end","value_low","value_high","fillcolor","name":"BOS"}, ...]
    Čára od Swing H/L k místu BOS, oranžová, nápis uprostřed.

Interface pro strategii/indikator:
  get_swings(ohlc, params=None) -> [{"type","price","index","timestamp"}, ...]
  get_major_swings(ohlc, params=None) -> [{"type":"major_high"|"major_low","price","index","timestamp"}, ...]
  get_bos(ohlc, params=None) -> [{"swing_index","swing_date","bos_index","bos_date","level","type":"bos_bullish"|"bos_bearish"}, ...]
  get_trend(ohlc, params=None) -> {"score": [float,...], "state": [str,...]}
    Trend -100..+100, state: STRONG_BULL|WEAK_BULL|RANGE|WEAK_BEAR|STRONG_BEAR.
    Strategie: trend = get_trend(ohlc, params); if trend["score"][i] >= trend_min_long: ...

TREND_PARAMS – doporučené parametry pro strategie (merge do PARAMS při doladění po runu):
  trend_min_long, trend_max_short, trend_filter_enabled, trend_require_strong, ...

BOS (Break of Structure): close nad posledním swing high nebo pod posledním swing low.
Následující 1 svíčka nesmí uzavřít zpět pod/přes tuto úroveň.

Algoritmus swingu: candidate -> replacement -> confirmation (ATR) -> locked.
"""

import pandas as pd
from typing import Any

ATR_FLOOR = 0.0001
MIN_THRESHOLD_ATR_RATIO = 0.3

# Min. timeframe pro jednotlivé funkce
MIN_TF_SWING = "5m"
MIN_TF_BOS = "1m"
MIN_TF_TREND = "30m"

TF_FINE_TO_COARSE = {  # minuty pro porovnání
    "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440,
    "1w": 10080, "1M": 43200,
}
TF_TO_PANDAS = {
    "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1h", "4h": "4h", "1d": "1D", "1w": "1W", "1M": "1ME",
}
TF_MAJOR_UP = {
    "1m": "5m", "5m": "15m", "15m": "1h", "30m": "1h", "1h": "4h", "4h": "1d",
    "1d": "1w", "1w": "1M", "1M": None,
}

TF_CONFIG = {
    "1m": {"atr_period": 60, "min_bars_between_swings": 12, "window_bars": 2000, "max_bars": 7500},
    "5m": {"atr_period": 40, "min_bars_between_swings": 8, "window_bars": 1000, "max_bars": 1500},
    "15m": {"atr_period": 28, "min_bars_between_swings": 6, "window_bars": 500, "max_bars": 500},
    "30m": {"atr_period": 24, "min_bars_between_swings": 6, "window_bars": 360, "max_bars": 360},
    "1h": {"atr_period": 20, "min_bars_between_swings": 5, "window_bars": 360, "max_bars": 360},
    "4h": {"atr_period": 14, "min_bars_between_swings": 4, "window_bars": 180, "max_bars": 90},
    "1d": {"atr_period": 10, "min_bars_between_swings": 4, "window_bars": 120, "max_bars": 180},
    "1w": {"atr_period": 8, "min_bars_between_swings": 4, "window_bars": 80, "max_bars": 52},
    "1M": {"atr_period": 6, "min_bars_between_swings": 3, "window_bars": 48, "max_bars": 24},
}

VIEW_PARAMS = {
    "timeframe": "1d",
    "atr_period": 10,
    "atr_multiplier": 1.6, #nechat!
    "min_bars_between_swings": 3, #nechat!
    "max_bars": 180,
    "max_candidate_bars": 0,
    "allow_unconfirmed_last_swing": True,
    "min_pullback_atr_ratio": 0.4,
    "sensitivity": 1.0, #nechat!
    "window_bars": 120,
    "include_internals": False,
    # BOS (Break of Structure) – close nad/pod posledním swing H/L, 1 bar acceptance
    "acceptance_bars": 1,
    # Trend detection – EMA-based scoring (-100 to +100)
    "ema_fast": 9,
    "ema_medium": 21,
    "ema_slow": 50,
    "trend_line_ema_period": 150,
    "structure_lookback_swings": 4,
    "trend_score_smooth_period": 8,
}

# Pro strategie používající get_trend – merge do PARAMS při doladění po runu
TREND_PARAMS = {
    "trend_min_long": 30,
    "trend_max_short": -30,
    "trend_filter_enabled": True,
    "trend_require_strong": False,
    "trend_smooth_period": 8,
}


def _infer_data_timeframe(ohlc: pd.DataFrame) -> str | None:
    """Odhadne timeframe z časových rozestupů mezi bary."""
    if ohlc is None or len(ohlc) < 2:
        return None
    idx = ohlc.index
    diffs = pd.Series(idx).diff().dropna()
    if len(diffs) == 0:
        return None
    median_td = diffs.median()
    minutes = median_td.total_seconds() / 60
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
    return "1d"


def _resample_ohlc(ohlc: pd.DataFrame, target_tf: str, data_tf: str | None = None) -> pd.DataFrame:
    """Resample OHLC na target_tf. Pouze na hrubší TF."""
    if ohlc is None or len(ohlc) == 0:
        return ohlc
    target = target_tf.lower()
    if target not in TF_TO_PANDAS:
        return ohlc
    src_tf = data_tf or _infer_data_timeframe(ohlc)
    if src_tf and TF_FINE_TO_COARSE.get(target, 0) <= TF_FINE_TO_COARSE.get(src_tf, 0):
        return ohlc
    rule = TF_TO_PANDAS[target]
    high_col = "high" if "high" in ohlc.columns else "High"
    low_col = "low" if "low" in ohlc.columns else "Low"
    open_col = "open" if "open" in ohlc.columns else "Open"
    close_col = "close" if "close" in ohlc.columns else "Close"
    agg = {open_col: "first", high_col: "max", low_col: "min", close_col: "last"}
    if "volume" in ohlc.columns:
        agg["volume"] = "sum"
    use_right = target in ("1w", "1m", "1me", "w", "me", "m")
    return ohlc.resample(rule, label="right" if use_right else "left", closed="right" if use_right else "left").agg(agg).dropna(how="all")


def _ensure_min_tf(ohlc: pd.DataFrame, min_tf: str, tf_param: str, data_tf_param: str | None) -> pd.DataFrame:
    """Resample na min_tf pokud je TF param jemnější."""
    tf = str(tf_param or "1d").lower()
    min_minutes = TF_FINE_TO_COARSE.get(min_tf, 0)
    tf_minutes = TF_FINE_TO_COARSE.get(tf, 1440)
    if tf_minutes >= min_minutes:
        return ohlc
    return _resample_ohlc(ohlc, min_tf, data_tf_param or _infer_data_timeframe(ohlc))


def _compute_atr(ohlc: pd.DataFrame, period: int) -> pd.Series:
    """ATR - Average True Range."""
    high = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    close = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
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


def _map_swing_index_to_original(swing: dict, original_index: pd.DatetimeIndex) -> int:
    """Mapuje swing index z resampled na original ohlc podle timestampu."""
    ts = swing.get("timestamp")
    if ts is None:
        return swing.get("index", 0)
    idx = original_index.searchsorted(ts, side="left")
    if idx >= len(original_index):
        idx = len(original_index) - 1
    return int(idx)


# Resample pravidla s label='right', closed='right' (W, ME)
_RESAMPLE_RIGHT_LABEL = frozenset({"1w", "1W", "1M", "1ME", "W", "ME", "M"})


def _map_major_swing_to_original(
    swing: dict,
    resampled: pd.DataFrame,
    original_ohlc: pd.DataFrame,
    major_tf: str = "1w",
) -> tuple[int, float]:
    """
    Mapuje Major swing z resampled na bar v original ohlc – hledá bar s min(low)
    resp. max(high) v periodě resamplovaného baru. Používá searchsorted na
    hranice periody (konzistentní s pandas resample).
    Vrací (index, price) – price z nalezeného baru pro přesné vertikální zarovnání.
    """
    res_idx = swing.get("index", 0)
    orig_idx = original_ohlc.index
    if res_idx >= len(resampled):
        fallback = _map_swing_index_to_original(swing, orig_idx)
        return fallback, float(swing.get("price", 0))

    rule = (major_tf or "1w").lower()
    use_right = rule in _RESAMPLE_RIGHT_LABEL

    if use_right:
        period_end = resampled.index[res_idx]
        if res_idx > 0:
            period_start = resampled.index[res_idx - 1]
            start_pos = int(orig_idx.searchsorted(period_start, side="right"))
        else:
            start_pos = 0
        end_pos = int(orig_idx.searchsorted(period_end, side="right"))
    else:
        period_start = resampled.index[res_idx]
        start_pos = int(orig_idx.searchsorted(period_start, side="left"))
        if res_idx + 1 < len(resampled):
            period_end = resampled.index[res_idx + 1]
            end_pos = int(orig_idx.searchsorted(period_end, side="left"))
        else:
            end_pos = len(original_ohlc)

    if start_pos >= end_pos:
        start_pos = max(0, min(start_pos, len(original_ohlc) - 1))
        return start_pos, float(swing.get("price", 0))

    slice_ohlc = original_ohlc.iloc[start_pos:end_pos]
    high_col = "high" if "high" in slice_ohlc.columns else "High"
    low_col = "low" if "low" in slice_ohlc.columns else "Low"
    h_vals = slice_ohlc[high_col].values
    l_vals = slice_ohlc[low_col].values
    if len(h_vals) == 0 or len(l_vals) == 0:
        return min(start_pos, len(original_ohlc) - 1), float(swing.get("price", 0))

    if swing.get("type") == "high":
        pos_in_slice = int(h_vals.argmax())
        price = float(h_vals[pos_in_slice])
    else:
        pos_in_slice = int(l_vals.argmin())
        price = float(l_vals[pos_in_slice])
    pos = start_pos + pos_in_slice
    pos = min(max(0, pos), len(original_ohlc) - 1)
    return pos, price


def get_swings(
    ohlc: pd.DataFrame,
    params: dict | None = None,
) -> list[dict]:
    """
    Detekce Swing High a Swing Low - candidate -> replacement -> confirmation -> locked.

    Pri len(ohlc) > max_bars pouziva rolling window: kazde okno = poslednich max_bars baru,
    swingy se sbiraji a deduplikuji. Umoznuje spolehlive zobrazeni na cele periode (View 2Y+).

    params["timeframe"]: "1m"|"5m"|"15m"|"30m"|"1h"|"4h"|"1d" - skalovani parametru podle TF.
    params["data_timeframe"]: TF vstupnich dat (odhadne se z dat, pokud chybi).
    Swing H/L: min. 5m – pri jemnejsim TF se data resampluji.
    params["max_bars"]: max. baru v jednom okne (pro 1d doporuceno 180 = 6M).
    params["include_internals"]: True -> vrati {"swings": [...], "internals": [...]}.

    Strategie: swings = get_swings(ohlc, {"timeframe": params.get("swing_tf", "1d")})

    Vraci: list swingu NEBO dict {"swings": [...], "internals": [...]} pri include_internals=True.
    """
    params = dict(params or {})
    tf = str(params.pop("timeframe", "1d")).lower()
    data_tf = params.pop("data_timeframe", None)
    include_internals = params.pop("include_internals", False)

    original_ohlc = ohlc
    work_ohlc = _ensure_min_tf(ohlc, MIN_TF_SWING, tf, data_tf)
    work_tf = MIN_TF_SWING if work_ohlc is not ohlc else tf
    base = TF_CONFIG.get(work_tf, TF_CONFIG["1d"])
    params = {**base, **params}

    max_bars = int(params.get("max_bars", 0))
    atr_period = int(params.get("atr_period", 10))
    min_bars = max(int(params.get("min_bars_between_swings", 4)), 2)

    if work_ohlc is None or len(work_ohlc) < atr_period + 2:
        return {"swings": [], "internals": []} if include_internals else []

    def _map_swings_to_original(sws: list[dict]) -> list[dict]:
        if work_ohlc is original_ohlc:
            return sws
        out = []
        orig_idx = original_ohlc.index
        for s in sws:
            s = dict(s)
            s["index"] = _map_swing_index_to_original(s, orig_idx)
            out.append(s)
        return out

    maj_params = {"timeframe": work_tf, "data_timeframe": data_tf, **params}
    major_swings = get_major_swings(original_ohlc, maj_params)

    if max_bars <= 0 or len(work_ohlc) <= max_bars:
        swings, _ = _get_swings_core(work_ohlc, params)
        swings = _map_swings_to_original(swings)
        atr_series = _compute_atr(work_ohlc, atr_period)
        swings = _deduplicate_swings(swings, original_ohlc, atr_series)
        swings = [s for s in swings if not _swing_overlaps_major(s, major_swings)]
        if include_internals:
            out = _add_internals(swings, original_ohlc, major_swings)
            out["major_swings"] = major_swings
            return out
        return swings

    all_swings: list[dict] = []
    stride = max(1, max_bars // 10)
    seen_ends: set[int] = set()
    for i in range(max_bars, len(work_ohlc) + 1, stride):
        window = work_ohlc.iloc[i - max_bars : i]
        if len(window) < atr_period + 2:
            continue
        swings, _ = _get_swings_core(window, params)
        offset = i - max_bars
        for s in swings:
            s = dict(s)
            s["index"] = s["index"] + offset
            s["timestamp"] = work_ohlc.index[s["index"]]
            all_swings.append(s)
        seen_ends.add(i)
    if len(work_ohlc) > max_bars and len(work_ohlc) not in seen_ends:
        window = work_ohlc.iloc[-max_bars:]
        if len(window) >= atr_period + 2:
            swings, _ = _get_swings_core(window, params)
            offset = len(work_ohlc) - max_bars
            for s in swings:
                s = dict(s)
                s["index"] = s["index"] + offset
                s["timestamp"] = work_ohlc.index[s["index"]]
                all_swings.append(s)

    all_swings = _map_swings_to_original(all_swings)
    atr_series = _compute_atr(work_ohlc, atr_period)
    swings = _deduplicate_swings(all_swings, original_ohlc, atr_series)
    swings = [s for s in swings if not _swing_overlaps_major(s, major_swings)]
    if include_internals:
        out = _add_internals(swings, original_ohlc, major_swings)
        out["major_swings"] = major_swings
        return out
    return swings


def get_major_swings(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Major Swing H/L – swingy na vyšším TF (5m->15m, 15m->1h, atd.).
    Stejná logika jako get_swings, ale na resamplovaných datech.
    Vrací [{"type":"major_high"|"major_low","price","index","timestamp"}, ...].
    """
    params = dict(params or {})
    tf = str(params.get("timeframe", "1d")).lower()
    data_tf = params.get("data_timeframe")
    major_tf = TF_MAJOR_UP.get(tf)
    if not major_tf or major_tf not in TF_CONFIG:
        return []

    resampled = _resample_ohlc(ohlc, major_tf, data_tf or _infer_data_timeframe(ohlc))
    if resampled is ohlc or resampled is None or len(resampled) < 10:
        return []

    base = TF_CONFIG[major_tf]
    maj_params = {**base, **params}
    maj_params["timeframe"] = major_tf
    swings, _ = _get_swings_core(resampled, maj_params)
    out = []
    for s in swings:
        idx, price = _map_major_swing_to_original(s, resampled, ohlc, major_tf)
        out.append({
            "type": f"major_{s['type']}",
            "price": price,
            "index": idx,
            "timestamp": ohlc.index[idx] if idx < len(ohlc) else s.get("timestamp"),
        })
    return sorted(out, key=lambda x: x["index"])


def _swing_overlaps_major(swing: dict, major_swings: list[dict]) -> bool:
    """True pokud swing je na stejném místě jako nějaký Major (v toleranci)."""
    if not major_swings:
        return False
    base_type = swing["type"]
    maj_type = "major_high" if base_type == "high" else "major_low"
    for m in major_swings:
        if m["type"] != maj_type:
            continue
        if abs(swing["index"] - m["index"]) <= MAJOR_SWING_INDEX_TOLERANCE:
            return True
    return False


def _confirm_internal_by_next_candle(ohlc: pd.DataFrame, pivot: dict) -> bool:
    """
    Pravidlo: po internal High musi nasledujici svicka byt bearish nebo mit velmi male telo.
    Po internal Low musi byt bullish nebo mit velmi male telo.
    """
    i = pivot["index"]
    if i + 1 >= len(ohlc):
        return False
    open_ = float(ohlc["open"].iloc[i + 1])
    close = float(ohlc["close"].iloc[i + 1])
    body = abs(close - open_)
    atr_period = 10
    if len(ohlc) >= atr_period + 2:
        atr = _compute_atr(ohlc, atr_period)
        atr_val = max(float(atr.iloc[i + 1]), ATR_FLOOR)
        small_body_threshold = atr_val * 0.15
    else:
        small_body_threshold = body + 1
    is_small_body = body <= small_body_threshold
    if pivot["type"] == "high":
        return close < open_ or is_small_body
    else:
        return close > open_ or is_small_body


def _pivot_overlaps_major(pivot: dict, major_swings: list[dict] | None) -> bool:
    """True pokud pivot je v toleranci Major swingu stejného typu."""
    if not major_swings:
        return False
    base_type = pivot["type"]
    maj_type = "major_high" if base_type == "high" else "major_low"
    for m in major_swings:
        if m["type"] != maj_type:
            continue
        if abs(pivot["index"] - m["index"]) <= MAJOR_SWING_INDEX_TOLERANCE:
            return True
    return False


def _add_internals(swings: list[dict], ohlc: pd.DataFrame, major_swings: list[dict] | None = None) -> dict:
    """Pivot body, ktere nejsou na miste swingu ani Major. Vraci {"swings": [...], "internals": [...]}."""
    pivots = _get_pivot_points(ohlc)
    swing_keys = {(s["index"], s["type"]) for s in swings}
    internals = [
        p
        for p in pivots
        if (p["index"], p["type"]) not in swing_keys
        and not _pivot_overlaps_major(p, major_swings)
        and _confirm_internal_by_next_candle(ohlc, p)
    ]
    return {"swings": swings, "internals": internals}


DEDUP_INDEX_TOLERANCE = 2
DEDUP_PRICE_ATR_TOLERANCE = 0.5
MAJOR_SWING_INDEX_TOLERANCE = 3


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


def _get_last_swing_high(swings: list[dict], up_to_index: int) -> tuple[float | None, int | None]:
    """Poslední swing high před indexem. Vrací (price, index). Akceptuje type 'high' i 'major_high'."""
    before = [
        s for s in swings
        if (s["type"] == "high" or s["type"] == "major_high") and s["index"] < up_to_index
    ]
    if not before:
        return None, None
    s = max(before, key=lambda x: x["index"])
    return s["price"], s["index"]


def _get_last_swing_low(swings: list[dict], up_to_index: int) -> tuple[float | None, int | None]:
    """Poslední swing low před indexem. Vrací (price, index). Akceptuje type 'low' i 'major_low'."""
    before = [
        s for s in swings
        if (s["type"] == "low" or s["type"] == "major_low") and s["index"] < up_to_index
    ]
    if not before:
        return None, None
    s = max(before, key=lambda x: x["index"])
    return s["price"], s["index"]


def _find_bos_from_swings(
    ohlc: pd.DataFrame,
    swings: list[dict],
    params: dict,
    is_major: bool = False,
) -> list[dict]:
    """
    BOS = Break of Structure – close nad posledním swing high nebo pod posledním swing low.
    Následující acceptance_bars svíček nesmí uzavřít zpět.
    is_major: True pokud swings jsou major swingy.
    Vrací: swing_index, swing_date, bos_index, bos_date, level, type, is_major
    """
    params = params or {}
    accept_bars = int(params.get("acceptance_bars", 1))

    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    index = ohlc.index

    results: list[dict] = []
    consumed_swing_highs: set[int] = set()
    consumed_swing_lows: set[int] = set()

    for i in range(1, len(ohlc) - accept_bars):
        close = float(close_col.iloc[i])

        level_high, swing_idx_high = _get_last_swing_high(swings, i)
        if (
            level_high is not None
            and swing_idx_high is not None
            and swing_idx_high not in consumed_swing_highs
            and close > level_high
        ):
            ok = True
            for j in range(1, accept_bars + 1):
                if i + j >= len(ohlc):
                    break
                cj = float(close_col.iloc[i + j])
                if cj < level_high:
                    ok = False
                    break
            if ok:
                results.append({
                    "swing_index": swing_idx_high,
                    "swing_date": _to_date_str(index[swing_idx_high]),
                    "bos_index": i,
                    "bos_date": _to_date_str(index[i]),
                    "level": level_high,
                    "type": "bos_bullish",
                    "is_major": is_major,
                })
                consumed_swing_highs.add(swing_idx_high)

        level_low, swing_idx_low = _get_last_swing_low(swings, i)
        if (
            level_low is not None
            and swing_idx_low is not None
            and swing_idx_low not in consumed_swing_lows
            and close < level_low
        ):
            ok = True
            for j in range(1, accept_bars + 1):
                if i + j >= len(ohlc):
                    break
                cj = float(close_col.iloc[i + j])
                if cj > level_low:
                    ok = False
                    break
            if ok:
                results.append({
                    "swing_index": swing_idx_low,
                    "swing_date": _to_date_str(index[swing_idx_low]),
                    "bos_index": i,
                    "bos_date": _to_date_str(index[i]),
                    "level": level_low,
                    "type": "bos_bearish",
                    "is_major": is_major,
                })
                consumed_swing_lows.add(swing_idx_low)

    return sorted(results, key=lambda x: x["bos_index"])


def _find_bos(ohlc: pd.DataFrame, swings: list[dict], params: dict) -> list[dict]:
    """BOS na běžných swingech. Zachovává zpětnou kompatibilitu."""
    return _find_bos_from_swings(ohlc, swings, params, is_major=False)


def get_bos(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Vrací BOS události pro strategie – na swing H/L i na Major Swing H/L.
    [{"swing_index","swing_date","bos_index","bos_date","level","type","is_major"}, ...]
    is_major: True = BOS na Major Swing H/L, False = BOS na běžném swing H/L.
    """
    p = dict(params or {})
    swing_res = get_swings(ohlc, p)
    swings = swing_res.get("swings", []) if isinstance(swing_res, dict) else (swing_res or [])

    p2 = dict(params or {})
    tf = p2.get("timeframe", "1d")
    data_tf = p2.get("data_timeframe")
    maj_params = {"timeframe": tf, "data_timeframe": data_tf, **p2}
    major_swings = get_major_swings(ohlc, maj_params)

    results = _find_bos_from_swings(ohlc, swings, params or {}, is_major=False)
    results_major = _find_bos_from_swings(ohlc, major_swings, params or {}, is_major=True)
    results = sorted(results + results_major, key=lambda x: x["bos_index"])
    return results


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Zóny pro View – horizontální čára od Swing H/L k místu BOS.
    BOS na Major Swing: name "BOS (M)", odlišená barva.
    """
    events = get_bos(ohlc, params)
    if not events:
        return []

    zones: list[dict] = []
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
        })

    return zones


# --- Trend detection (EMA-based scoring -100 to +100) ---
TREND_COLORS = {
    "STRONG_BULL": "#22c55e",
    "WEAK_BULL": "#86efac",
    "RANGE": "#71717a",
    "WEAK_BEAR": "#fca5a5",
    "STRONG_BEAR": "#ef4444",
}


def _compute_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def _score_alignment(ema_fast: float, ema_med: float, ema_slow: float) -> float:
    """
    Alignment (±40): directional agreement across EMA layers.
    Strong bullish: fast > med > slow → +40
    Partial bullish: 2 of 3 aligned → +25
    Strong bearish: fast < med < slow → -40
    Partial bearish: 2 of 3 aligned → -25
    """
    bull_align = (ema_fast > ema_med) + (ema_med > ema_slow)
    bear_align = (ema_fast < ema_med) + (ema_med < ema_slow)
    if bull_align == 2:
        return 40.0
    if bull_align == 1:
        return 25.0
    if bear_align == 2:
        return -40.0
    if bear_align == 1:
        return -25.0
    return 0.0


def _score_slope(ema_series: pd.Series, i: int, lookback: int = 5) -> float:
    """
    Slope (±20): is the market actively moving?
    Strong up: +20, Weak up: +10, Flat: 0, Weak down: -10, Strong down: -20
    """
    if i < lookback or len(ema_series) < lookback + 1:
        return 0.0
    curr = float(ema_series.iloc[i])
    prev = float(ema_series.iloc[i - lookback])
    if prev <= 0:
        return 0.0
    pct = (curr - prev) / prev
    if pct > 0.02:
        return 20.0
    if pct > 0.005:
        return 10.0
    if pct < -0.02:
        return -20.0
    if pct < -0.005:
        return -10.0
    return 0.0


def _score_position(close: float, ema: float, atr: float) -> float:
    """
    Position (±20): where is price relative to equilibrium (EMA)?
    Clearly above: +20, Slightly above: +10, Neutral: 0, etc.
    """
    if atr <= 0:
        return 0.0
    diff_pct = (close - ema) / atr
    if diff_pct > 1.0:
        return 20.0
    if diff_pct > 0.3:
        return 10.0
    if diff_pct < -1.0:
        return -20.0
    if diff_pct < -0.3:
        return -10.0
    return 0.0


def _classify_swing_for_structure(swings: list[dict], idx: int, atr_val: float, eq_ratio: float = 0.35) -> str:
    """Klasifikuje swing: HH, HL, LH, LL, EQH, EQL."""
    if idx >= len(swings):
        return "HH"
    s = swings[idx]
    typ = s["type"]
    price = s["price"]
    eq = max(atr_val * eq_ratio, ATR_FLOOR)
    if typ == "high":
        prev = [x for i, x in enumerate(swings) if x["type"] == "high" and i < idx]
        if not prev:
            return "HH"
        last = max(prev, key=lambda x: x["index"])["price"]
        d = price - last
        if d > eq:
            return "HH"
        if d < -eq:
            return "LH"
        return "EQH"
    else:
        prev = [x for i, x in enumerate(swings) if x["type"] == "low" and i < idx]
        if not prev:
            return "HL"
        last = max(prev, key=lambda x: x["index"])["price"]
        d = last - price
        if d > eq:
            return "LL"
        if d < -eq:
            return "HL"
        return "EQL"


def _score_structure(swings: list[dict], bar_idx: int, atr: pd.Series, n: int, params: dict) -> float:
    """
    Structure (±20): does price action confirm direction? (HH/HL vs LL/LH)
    Clear bullish: +20, Weak bullish: +10, No structure: 0, etc.
    """
    lookback = int(params.get("structure_lookback_swings", 4))
    swings_up_to = [s for s in swings if s["index"] <= bar_idx]
    if len(swings_up_to) < 2:
        return 0.0
    atr_val = max(float(atr.iloc[min(bar_idx, n - 1)]), ATR_FLOOR)
    labels = [_classify_swing_for_structure(swings_up_to, idx, atr_val) for idx in range(len(swings_up_to))]
    labels = labels[-lookback:]
    bull_pairs = sum(1 for j in range(len(labels) - 1) if labels[j] == "HH" and labels[j + 1] == "HL")
    bear_pairs = sum(1 for j in range(len(labels) - 1) if labels[j] == "LL" and labels[j + 1] == "LH")
    if bull_pairs >= 2:
        return 20.0
    if bull_pairs >= 1:
        return 10.0
    if bear_pairs >= 2:
        return -20.0
    if bear_pairs >= 1:
        return -10.0
    return 0.0


def _score_to_state(score: float) -> str:
    """Mapuje score (-100..+100) na stav pro barvu."""
    if score >= 60:
        return "STRONG_BULL"
    if score >= 30:
        return "WEAK_BULL"
    if score >= -30:
        return "RANGE"
    if score >= -60:
        return "WEAK_BEAR"
    return "STRONG_BEAR"


def _compute_trend_scores(ohlc: pd.DataFrame, params: dict) -> list[tuple[int, float, str]]:
    """
    Vrací pro každý bar: (index, score, state).
    score = alignment + slope + position + structure, clamped [-100, +100].
    """
    params = params or {}
    close = ohlc["close"]
    n = len(ohlc)
    atr_period = int(params.get("atr_period", 10))
    ema_f = int(params.get("ema_fast", 9))
    ema_m = int(params.get("ema_medium", 21))
    ema_s = int(params.get("ema_slow", 50))
    slope_lookback = max(2, min(10, ema_m // 2))

    atr = _compute_atr(ohlc, atr_period)
    ema_fast = _compute_ema(close, ema_f)
    ema_med = _compute_ema(close, ema_m)
    ema_slow = _compute_ema(close, ema_s)

    result = get_swings(ohlc, params)
    swings = result["swings"] if isinstance(result, dict) else result

    out: list[tuple[int, float, str]] = []
    for i in range(n):
        c = float(close.iloc[i])
        atr_val = max(float(atr.iloc[i]), ATR_FLOOR)
        a = _score_alignment(
            float(ema_fast.iloc[i]),
            float(ema_med.iloc[i]),
            float(ema_slow.iloc[i]),
        )
        s = _score_slope(ema_med, i, slope_lookback)
        p = _score_position(c, float(ema_med.iloc[i]), atr_val)
        st = _score_structure(swings, i, atr, n, params) if swings else 0.0
        score = max(-100.0, min(100.0, a + s + p + st))
        out.append((i, score, None))

    scores = pd.Series([x[1] for x in out])
    smooth_period = max(1, int(params.get("trend_score_smooth_period") or params.get("trend_smooth_period", 8)))
    smoothed = scores.ewm(span=smooth_period, adjust=False).mean()
    for i in range(len(out)):
        s = max(-100.0, min(100.0, float(smoothed.iloc[i])))
        state = _score_to_state(s)
        out[i] = (out[i][0], s, state)
    return out


def get_trend(ohlc: pd.DataFrame, params: dict | None = None) -> dict | None:
    """
    Vrací trend pro strategie: {"score": [float,...], "state": [str,...]}.
    score: -100 (max bearish) až +100 (max bullish)
    state: STRONG_BULL | WEAK_BULL | RANGE | WEAK_BEAR | STRONG_BEAR
    Trend: min. 30m TF – při jemnějším TF se data resamplují.

    Použití ve strategii:
      from modules.Swing_HL import get_trend, TREND_PARAMS
      trend = get_trend(ohlc, params)
      if trend and trend["score"][i] >= params.get("trend_min_long", 30):
          # long setup
    """
    if ohlc is None or len(ohlc) < 2:
        return None
    p = params or {}
    tf = str(p.get("timeframe", "1d")).lower()
    data_tf = p.get("data_timeframe")
    work_ohlc = _ensure_min_tf(ohlc, MIN_TF_TREND, tf, data_tf)
    scores = _compute_trend_scores(work_ohlc, p)
    return {
        "score": [s[1] for s in scores],
        "state": [s[2] for s in scores],
    }


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict | None:
    """
    Trendová čára pro View – hladká EMA-like linka (perioda 150), barva podle trendu.
    Trend = score -100..+100 z Alignment, Slope, Position, Structure.
    Vrací {"Trend": {"data": [...], "segments": [{"from": i, "to": j, "color": "..."}, ...]}}.
    """
    if ohlc is None or len(ohlc) < 2:
        return None

    params = params or {}
    ema_period = int(params.get("trend_line_ema_period", 150))
    close = ohlc["close"]
    index = ohlc.index
    trend_ema = _compute_ema(close, ema_period)

    trend_per_bar = _compute_trend_scores(ohlc, params)
    data: list[dict] = []
    for i in range(len(ohlc)):
        value = float(trend_ema.iloc[i])
        date_str = _to_date_str(index[i])
        state = trend_per_bar[i][2]
        data.append({"date": date_str, "value": value, "state": state})

    segments: list[dict] = []
    prev_end = -1
    i = 0
    while i < len(data):
        state = data[i]["state"]
        color = TREND_COLORS.get(state, TREND_COLORS["RANGE"])
        j = i
        while j < len(data) and data[j]["state"] == state:
            j += 1
        seg_end = j - 1
        seg_start = prev_end if prev_end >= 0 else i
        if seg_start <= seg_end:
            segments.append({"from": seg_start, "to": seg_end, "color": color})
        prev_end = seg_end
        i = j

    return {"Trend": {"data": data, "segments": segments}}


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Interface pro View chart - vrati markery ve formatu aplikace.
    [{"date": "YYYY-MM-DD", "type": "high"|"low"|"major_high"|"major_low"|"internal_high"|"internal_low", "value": float}, ...]
    """
    result = get_swings(ohlc, params)
    if isinstance(result, dict):
        swings = result["swings"]
        internals = result["internals"]
    else:
        swings = result
        internals = []

    p = params or {}
    maj_params = {"timeframe": p.get("timeframe", "1d"), "data_timeframe": p.get("data_timeframe"), **p}
    major_swings = get_major_swings(ohlc, maj_params)

    results = []
    for s in major_swings:
        ts = s.get("timestamp")
        date_str = _to_date_str(ts) if ts is not None else ""
        if date_str:
            results.append({"date": date_str, "type": s["type"], "value": s["price"]})
    for s in swings:
        ts = s["timestamp"]
        date_str = _to_date_str(ts)
        results.append({"date": date_str, "type": s["type"], "value": s["price"]})
    for s in internals:
        ts = s["timestamp"]
        date_str = _to_date_str(ts)
        results.append({
            "date": date_str,
            "type": f"internal_{s['type']}",
            "value": s["price"],
        })
    return results
