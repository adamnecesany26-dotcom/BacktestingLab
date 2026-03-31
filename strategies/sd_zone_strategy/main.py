# -*- coding: utf-8 -*-
"""
S/D Zone Strategy – zóny na vyšším TF (výchozí 1D), vstup/výstup na exekučním TF (výchozí 30m).

Vyžaduje modul S/D zón (`get_zones`, např. S_D_Zones / SD_identificator) — v Moduly vyber a potvrď.
Pro volitelný filtr trendu (`trend_filter_enabled`) je potřeba modul se `get_trend` (HL_identificator nebo Swing_HL).
Skóre trendu: `trend_chart_timeframe` (výchozí 4h) určuje minimální hrubost TF oproti primární TF zóny
(viz _effective_trend_tf). Prázdný řetězec = trend na stejném TF jako primární zóna (legacy).

Instrument: např. futures_30m/NQ.txt (30m bary); zóny se počítají z resamplovaného OHLC.
Parametr `exec_timeframe` popisuje záměr; skutečný TF řídí data feedu — při nesouladu volitelné varování
(`warn_exec_timeframe_mismatch`). Momentum větev: po signálu se zadá limitní příkaz uvnitř zóny (ne market mimo zónu).

Detailed — moduleOutputs: engine slučuje `zone_timeframes` + `zone_max_bars` ze strategie s get_zones, aby graf
odpovídal výpočtu (dříve stačil timeframe „1d“ z VIEW_PARAMS modulu).

MTF: `zone_timeframes` = čárkou oddělené TF (např. "1w,1d"); překryvy stejného typu se slučují,
    `prefer_higher_tf` vybere geometrii z hrubšího nebo jemnějšího TF.

Pravidla:
- Nejdřív cena musí zónu „opustit“ (Demand: low > zone_high; Supply: high < zone_low na exekučním baru).
- `entry_model`: limit | market_momentum; u limitu určuje `entry_mode` (edge | mid | pct) vnitřní styl limit_edge / limit_mid.
- Legacy: `entry_style` = limit_edge | limit_mid | market_momentum má přednost, pokud je nastaveno.
- Po odchodu zóny: limit na hraně/středu, nebo čekání na momentum (bull/bear + close nad/pod zónou) a market vstup.
- TP: pouze podle `target_rr` × riziko (entry − stop).
- Stop: pod/nad zónou o `stop_offset_pct` × výška zóny.
- Čekající limit se NERUŠÍ jen proto, že modul zkrátil end_idx — pouze při invalidaci close na TF zóny,
  max. počet exekučních barů bez fillu, nebo vyplnění.

Exekuce (zjednodušení vs. reálný order book):
- Volání get_zones dostane `zone_extend_right_bars` přepsané z `zone_max_bars` (parametr strategie řídí životnost zóny v modulu).
- Limitní vstupy bez explicitního spreadu v této strategii — globální slippage/spread z nastavení simulace platí obecně, ne model „limit u bid/ask“.
- Výstup z pozice: po fillu vstupu se zadá **OCO bracket** — Limit (TP) + Stop (SL) přes Backtrader; stejný bar může vyřešit jednu nohu bracketu dle pravidel brokera (lepší než ruční OR na high/low).
"""

from __future__ import annotations

import importlib
import os
from collections import deque
from pathlib import Path

import backtrader as bt
import pandas as pd

try:
    from app.services.sd_feature_pipeline import get_sd_zones_cached as _get_sd_zones_cached
except ImportError:
    _get_sd_zones_cached = None

from app.services.sd_zone_merge import (
    build_merged_sd_zones as _merge_zones_core,
    merged_zone_key,
    min_zone_ohlc_bars,
    parse_zone_timeframes_dict,
    resample_to_zone_tf,
    tf_coarseness,
)

# Stejná priorita swing modulu jako v examples/sd_zones._load_swing_hl_module:
# HL_identificator před Swing_HL (při dvou kopiích v modules/ jeden zdroj BOS/swingů).
_SWING_PKGS = ("HL_identificator", "Swing_HL")
_ZONE_PKGS = ("S_D_Zones", "SD_identificator")


def _zone_module_import_order() -> list[str]:
    """Known S/D module names first, then any other modules/*.py (e.g. S_D_Zones from UI)."""
    from pathlib import Path

    ordered: list[str] = []
    seen: set[str] = set()
    for name in _ZONE_PKGS:
        if name not in seen:
            ordered.append(name)
            seen.add(name)
    try:
        root = Path(__file__).resolve().parent
        mod_dir = root / "modules"
        if mod_dir.is_dir():
            for path in sorted(mod_dir.glob("*.py")):
                stem = path.stem
                if stem == "__init__" or stem.startswith("_"):
                    continue
                if stem not in seen:
                    ordered.append(stem)
                    seen.add(stem)
    except Exception:
        pass
    return ordered


get_zones = None
get_major_swings = None
get_trend = None

for _pkg in _zone_module_import_order():
    try:
        _zm = importlib.import_module(f"modules.{_pkg}")
    except ImportError:
        continue
    _gz = getattr(_zm, "get_zones", None)
    if _gz is not None:
        get_zones = _gz
        break

for _swing_pkg in _SWING_PKGS:
    try:
        _sm = importlib.import_module(f"modules.{_swing_pkg}")
    except ImportError:
        continue
    if get_major_swings is None:
        get_major_swings = getattr(_sm, "get_major_swings", None)
    if get_trend is None:
        get_trend = getattr(_sm, "get_trend", None)

if get_trend is None:
    try:
        _shl = importlib.import_module("examples.swing_hl_detector")
        get_trend = getattr(_shl, "get_trend", None)
    except ImportError:
        pass


# --- Parametry v panelu „Parametry strategie“ (jen jádro obchodu) ---
# Ostatní (MTF merge práh, momentum detail, max hold, …): defaulty v Strategy.params — úprava v kódu.
# S/D geometrie kromě max_base_length / require_inducement: záložka modulu (VIEW_PARAMS).
PARAMS = {
    "zone_timeframes": "1d",
    "prefer_higher_tf": True,
    "exec_timeframe": "30m",
    "entry_model": "limit",
    "entry_mode": "edge",
    "entry_pct": 0.5,
    "target_rr": 1.5,
    "zone_max_bars": 6000,
    "retest_entry_max": 1,
    "zone_trading_far_atr_mult": 8.0,
    "zone_trading_far_consecutive_exec_bars": 12,
    "zone_trading_far_min_track_exec_bars": 36,
    "require_inducement": False,
    "stop_offset_pct": 0.10,
    "trend_filter_enabled": False,
    "max_base_length": 0,
}

# Popisky a výběrová pole pro panel Parametry (frontend parsuje PARAMS_META).
PARAMS_META = {
    "zone_timeframes": {
        "title": "Časové rámce zón",
        "what_it_means": "Více TF pro výpočet zón; stejný typ na různých TF se při překryvu sloučí.",
        "widget": "multiselect",
        "options": "1w|1d|4h|1h|30m",
        "option_labels": "1 týden|1 den|4 hod|1 hod|30 min",
    },
    "prefer_higher_tf": {
        "title": "Preferovat zónu vyššího TF",
        "what_it_means": "Při sloučení z více TF použít geometrii z hrubšího (Ano) nebo jemnějšího (Ne) rámce.",
    },
    "exec_timeframe": {
        "title": "Exekuční timeframe",
        "what_it_means": "Záměr TF simulace; skutečný krok řídí data. Nejmenší rozlišitelný TF = podle souboru dat.",
        "options": "15m|30m|1h|4h|1d|1w",
        "option_labels": "15 min|30 min|1 hod|4 hod|1 den|1 týden",
    },
    "entry_model": {
        "title": "Model vstupu",
        "what_it_means": "Limit = čekání na návrat do zóny s limitem; Market (momentum) = po odchodu čekání na potvrzující bary.",
        "options": "limit|market_momentum",
        "option_labels": "Limit|Market (momentum)",
    },
    "entry_mode": {
        "title": "Způsob limitu",
        "what_it_means": "Kde stojí limit: hrana, střed zóny, nebo vlastní podíl (entry_pct).",
        "options": "edge|mid|pct",
        "option_labels": "Hraně zóny|Střed zóny|Vlastní %",
        "depends_on_param": "entry_model",
        "depends_on_values": "limit",
    },
    "entry_pct": {
        "title": "Vstupní % v zóně",
        "what_it_means": "Jen pro „Vlastní %“: 0–1 uvnitř výšky zóny (směr podle Demand/Supply).",
        "depends_on_param": "entry_mode",
        "depends_on_values": "pct",
        "depends_on_param2": "entry_model",
        "depends_on_values2": "limit",
    },
    "target_rr": {
        "title": "Cílový R:R",
        "what_it_means": "Take-profit jako násobek vzdálenosti entry → stop (riziko).",
    },
    "zone_max_bars": {
        "title": "Extend zóny v modulu (barů na TF zóny)",
        "what_it_means": "Řídí geometrii get_zones (jak daleko doprava modul táhne obdélník). Vysoká hodnota ≈ zóna nemizí jen kvůli počtu barů; konec obchodování řeší retest + vzdálenost.",
    },
    "retest_entry_max": {
        "title": "Max. pokusů o vstup po odchodu od zóny",
        "what_it_means": "1 = jeden cyklus odchod→limit; 2 = po nevyplnění limitu lze znovu po novém odchodu ceny od zóny.",
    },
    "zone_trading_far_atr_mult": {
        "title": "Vypnout obchod — vzdálenost (× ATR od zóny)",
        "what_it_means": "Close dál než tento násobek ATR od nejbližší hrany zóny po N po sobě jdoucích barech → přestaneme hledat vstup (výjimka Major zóny).",
    },
    "zone_trading_far_consecutive_exec_bars": {
        "title": "Vypnout obchod — počet „dalekých\" barů v řadě",
        "what_it_means": "Po tolika po sobě jdoucích exekučních barech splňujících vzdálenost výše se zóna přestane obchodovat.",
    },
    "zone_trading_far_min_track_exec_bars": {
        "title": "Vypnout obchod — min. stáří sledování (exekuční bary)",
        "what_it_means": "Pravidlo dálky od zóny platí až po tomto počtu barů od zařazení zóny do tracku.",
    },
    "require_inducement": {
        "title": "Inducement required",
        "what_it_means": "Vstup jen u zón s nalezenou likviditou před zónou (inducement_count > 0).",
    },
    "stop_offset_pct": {
        "title": "Odstup stopu od zóny",
        "what_it_means": "Násobek výšky zóny (kladné = stop za zónou, záporné = stop může být uvnitř zóny).",
    },
    "trend_filter_enabled": {
        "title": "Filtr trendu",
        "what_it_means": "Zapne filtr přes get_trend. Okno a prahy nastav v záložce modulu S/D.",
    },
    "max_base_length": {
        "title": "Max. délka base (0 = vypnuto)",
        "what_it_means": "Odfiltruje zóny s delší base než tento počet svíček.",
    },
}

# Názvy modulů z knihovny Moduly (odděl |), jejichž VIEW_PARAMS patří do záložky „Moduly“ a jejichž kód se
# při runu přibalí i když uživatel v Dependencies potvrdil jen S/D modul (např. swing/trend helper).
PARAM_MODULE_CHAIN = "HL_identificator"


def _effective_trend_tf(zone_tf: str, trend_min_tf: str) -> str:
    """Trend se počítá na TF s větší „hrubostí“ (vyšší tf_coarseness) mezi zónou a spodní hranicí."""
    tct = (trend_min_tf or "").strip()
    if not tct:
        return (zone_tf or "1d").strip() or "1d"
    z = (zone_tf or "1d").strip() or "1d"
    if tf_coarseness(z) >= tf_coarseness(tct):
        return z
    return tct


def _exec_timeframe_expected_minutes(tf: str) -> float | None:
    s = (tf or "").strip().lower()
    aliases = {
        "15m": 15.0,
        "15min": 15.0,
        "30m": 30.0,
        "30min": 30.0,
        "1h": 60.0,
        "60m": 60.0,
        "4h": 240.0,
        "1d": 1440.0,
        "daily": 1440.0,
        "1w": 10080.0,
        "weekly": 10080.0,
    }
    return aliases.get(s)


def _infer_median_bar_minutes(exec_df: pd.DataFrame) -> float | None:
    if exec_df is None or len(exec_df) < 2:
        return None
    idx = exec_df.index
    if not isinstance(idx, pd.DatetimeIndex):
        return None
    diffs = pd.Series(idx).diff().dropna()
    if diffs.empty:
        return None
    med = diffs.median()
    try:
        return float(med.total_seconds() / 60.0)
    except Exception:
        return None


def _atr_last(exec_df: pd.DataFrame, period: int = 14) -> float:
    """Jednoduchá ATR (rolling mean TR) z exekučního DF — poslední hodnota."""
    if exec_df is None or len(exec_df) < 2:
        return 1e-8
    p = max(2, int(period))
    high = exec_df["high"].astype(float)
    low = exec_df["low"].astype(float)
    close = exec_df["close"].astype(float)
    tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.rolling(p, min_periods=1).mean()
    v = float(atr.iloc[-1]) if len(atr) else 1e-8
    return max(v, 1e-8)


def _distance_close_to_zone_box(close: float, zl: float, zh: float) -> float:
    """0 pokud close uvnitř [zl,zh]; jinak vzdálenost k nejbližší hraně."""
    c = float(close)
    if zl <= c <= zh:
        return 0.0
    if c > zh:
        return c - zh
    return zl - c


def _bar_fully_outside_zone(bar_low: float, bar_high: float, zl: float, zh: float) -> bool:
    """Celé OHLC mimo box zóny (žádný průnik)."""
    return float(bar_low) > float(zh) or float(bar_high) < float(zl)


def _bar_touches_zone(bar_low: float, bar_high: float, zl: float, zh: float) -> bool:
    return not _bar_fully_outside_zone(bar_low, bar_high, zl, zh)


def _map_zone_pivot_to_trend_score_index(
    exec_df: pd.DataFrame,
    zone_tf: str,
    trend_tf: str,
    pivot_idx: int,
    trend_params: dict,
) -> int:
    """Mapuje pivot index ze zónového resamplu na index v řadě trend skóre (jiný TF + vnitřní resample get_trend)."""
    zoh = resample_to_zone_tf(exec_df, zone_tf)
    toh = resample_to_zone_tf(exec_df, trend_tf)
    if zoh.empty or toh.empty:
        return 0
    piv = max(0, min(int(pivot_idx), len(zoh) - 1))
    ts = zoh.index[piv]
    ji = int(toh.index.get_indexer([pd.Timestamp(ts)], method="nearest")[0])
    ji = max(0, min(ji, len(toh) - 1))
    return _map_pivot_idx_to_trend_scores_index(toh, ji, trend_params)


def _parse_zone_timeframes(params) -> list[str]:
    d = {
        "zone_timeframes": getattr(params, "zone_timeframes", None),
        "zone_timeframe": getattr(params, "zone_timeframe", None),
    }
    out = parse_zone_timeframes_dict(d)
    return out if out else ["1d"]


def _get_exec_ohlc_df(strat: bt.Strategy) -> pd.DataFrame:
    n = len(strat.data)
    if n <= 0:
        return pd.DataFrame()
    dates = [strat.data.datetime.datetime(-i) for i in range(n - 1, -1, -1)]
    opens = [float(strat.data.open[-i]) for i in range(n - 1, -1, -1)]
    highs = [float(strat.data.high[-i]) for i in range(n - 1, -1, -1)]
    lows = [float(strat.data.low[-i]) for i in range(n - 1, -1, -1)]
    closes = [float(strat.data.close[-i]) for i in range(n - 1, -1, -1)]
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes},
        index=pd.DatetimeIndex(dates),
    )


def _build_merged_sd_zones(
    exec_df: pd.DataFrame,
    timeframes: list[str],
    get_zones_fn,
    module_params_fn,
    prefer_higher_tf: bool,
    overlap_threshold: float,
    *,
    sd_cache: dict | None = None,
    cache_dir: Path | None = None,
    data_fingerprint: str | None = None,
    disk_cache_enabled: bool = True,
) -> tuple[list[dict], list[dict]]:
    """
    Vrátí (merged_zone_dicts, flat_all_sd_for_targets).
    Každá merged zóna má _primary_tf, _merged_tfs, _d_idx (index posledního baru na daném TF).
    """
    return _merge_zones_core(
        exec_df,
        timeframes,
        get_zones_fn,
        module_params_fn,
        prefer_higher_tf,
        overlap_threshold,
        get_zones_cached=_get_sd_zones_cached,
        sd_cache=sd_cache,
        cache_dir=cache_dir,
        data_fingerprint=data_fingerprint,
        disk_cache_enabled=disk_cache_enabled,
    )


def _limit_entry_price(is_long: bool, zl: float, zh: float, mode: str, pct: float) -> float:
    span = zh - zl
    m = (mode or "edge").strip().lower()
    if m == "mid":
        return (zl + zh) / 2.0
    if m == "pct":
        p = max(0.0, min(1.0, float(pct)))
        return zl + span * p
    return zh if is_long else zl


def _stop_outside_zone(is_long: bool, zl: float, zh: float, stop_offset_pct: float) -> float:
    """SL vzdálený od hrany zóny o stop_offset_pct × výška zóny (pod spodkem Demand / nad vrškem Supply)."""
    h = zh - zl
    off = h * float(stop_offset_pct)
    if is_long:
        return zl - off
    return zh + off


def _target_from_rr(entry: float, stop: float, is_long: bool, target_rr: float) -> float:
    risk = (entry - stop) if is_long else (stop - entry)
    if risk <= 0:
        return entry
    rr = max(0.01, float(target_rr))
    return entry + risk * rr if is_long else entry - risk * rr


def _dip_pct_after_departure_demand(zh: float, zl: float, min_low_since_departure: float) -> float:
    h = zh - zl
    if h <= 1e-12:
        return 0.0
    return max(0.0, (zh - float(min_low_since_departure)) / h * 100.0)


def _dip_pct_after_departure_supply(zh: float, zl: float, max_high_since_departure: float) -> float:
    h = zh - zl
    if h <= 1e-12:
        return 0.0
    return max(0.0, (float(max_high_since_departure) - zl) / h * 100.0)


def _zone_passes_trade_filters(strat: "Strategy", z: dict, d_idx: int) -> bool:
    if not bool(strat.params.allow_zones_with_touch) and z.get("has_touch"):
        return False
    piv = int(z.get("pivot_idx", z.get("end_idx", d_idx)))
    age = int(d_idx) - piv
    max_age = int(strat.params.max_zone_age_bars)
    if max_age > 0 and age > max_age:
        return False
    imp = int(z.get("impulse_score") or 0)
    mi = int(strat.params.min_impulse_score)
    ma = int(strat.params.max_impulse_score)
    if mi > 0 and imp < mi:
        return False
    if ma > 0 and imp > ma:
        return False
    ip = int(z.get("inducement_points") or 0)
    imin = int(strat.params.min_inducement_points)
    imax = int(strat.params.max_inducement_points)
    if imin > 0 and ip < imin:
        return False
    if imax > 0 and ip > imax:
        return False
    mx_base = int(strat.params.max_base_length)
    if mx_base > 0:
        bl_raw = z.get("base_length")
        if bl_raw is None:
            return False
        if int(bl_raw) > mx_base:
            return False
    if int(getattr(strat.params, "require_inducement", 0)) and int(z.get("inducement_count") or 0) <= 0:
        return False
    return True


def _map_pivot_idx_to_trend_scores_index(
    zoh: pd.DataFrame, pivot_idx: int, trend_params: dict
) -> int:
    """get_trend může uvnitř resamplovat na MIN_TF; index pivotu mapujeme přes čas."""
    if zoh is None or zoh.empty:
        return 0
    piv = max(0, min(int(pivot_idx), len(zoh) - 1))
    try:
        _shl = importlib.import_module("examples.swing_hl_detector")
        _ensure = getattr(_shl, "_ensure_min_tf", None)
        _min_tf = getattr(_shl, "MIN_TF_TREND", "30m")
        if _ensure is not None:
            work = _ensure(
                zoh,
                str(_min_tf),
                str(trend_params.get("timeframe", "1d")).lower(),
                trend_params.get("data_timeframe"),
            )
            if work is not None and not work.empty and len(work) != len(zoh):
                ts = zoh.index[piv]
                j = int(work.index.get_indexer([pd.Timestamp(ts)], method="nearest")[0])
                if j < 0:
                    j = 0
                return max(0, min(j, len(work) - 1))
    except ImportError:
        pass
    return piv


def _zone_passes_trend_window(
    zone_name: str,
    window_scores: list[float],
    mode: str,
    min_demand: float,
    max_supply: float,
    range_policy: str,
) -> bool:
    if not window_scores:
        return True
    wmin = min(window_scores)
    wmax = max(window_scores)
    wmean = sum(window_scores) / len(window_scores)
    pol = (range_policy or "both").strip().lower()
    if pol not in ("both", "none"):
        pol = "both"
    m = (mode or "minmax").strip().lower()
    if zone_name == "Demand":
        if m == "mean":
            agg = wmean
            if agg >= float(min_demand):
                return True
            if agg <= float(max_supply):
                return False
            return pol == "both"
        if wmin >= float(min_demand):
            return True
        if wmax <= float(max_supply):
            return False
        return pol == "both"
    if zone_name == "Supply":
        if m == "mean":
            agg = wmean
            if agg <= float(max_supply):
                return True
            if agg >= float(min_demand):
                return False
            return pol == "both"
        if wmax <= float(max_supply):
            return True
        if wmin >= float(min_demand):
            return False
        return pol == "both"
    return True


def _resolve_effective_entry_style(entry_model: str, entry_style: str, entry_mode: str) -> str:
    """Vnitřní styl: limit_edge | limit_mid | market_momentum. Legacy entry_style má přednost."""
    es = (entry_style or "").strip().lower()
    if es in ("limit_edge", "limit_mid", "limit_pct", "market_momentum"):
        return es
    em = (entry_model or "").strip().lower()
    if em == "market_momentum":
        return "market_momentum"
    if em == "limit":
        mode = (entry_mode or "edge").strip().lower()
        if mode == "mid":
            return "limit_mid"
        if mode == "pct":
            return "limit_pct"
        return "limit_edge"
    mode2 = (entry_mode or "edge").strip().lower()
    if mode2 == "mid":
        return "limit_mid"
    return "limit_edge"


def _daily_invalidates(zone: dict, daily_close: float) -> bool:
    zl = float(zone["value_low"])
    zh = float(zone["value_high"])
    if zone.get("name") == "Demand":
        return daily_close < zl
    if zone.get("name") == "Supply":
        return daily_close > zh
    return False


class Strategy(bt.Strategy):
    params = (
        ("zone_timeframe", "1d"),
        ("zone_timeframes", "1d"),
        ("prefer_higher_tf", True),
        ("exec_timeframe", "30m"),
        ("entry_model", "limit"),
        ("entry_style", ""),
        ("entry_mode", "edge"),
        ("entry_pct", 0.5),
        ("target_rr", 1.5),
        ("zone_max_bars", 6000),
        ("retest_entry_max", 1),
        ("zone_trading_far_atr_mult", 8.0),
        ("zone_trading_far_consecutive_exec_bars", 12),
        ("zone_trading_far_min_track_exec_bars", 36),
        ("max_hold_bars", 48),
        ("max_limit_bars_exec", 80),
        ("stop_offset_pct", 0.10),
        ("momentum_max_wait_bars", 80),
        ("momentum_require_bull_bar", True),
        ("momentum_close_above_zone_high", True),
        ("max_zone_age_bars", 0),
        ("allow_zones_with_touch", True),
        ("min_impulse_score", 0),
        ("max_impulse_score", 0),
        ("min_inducement_points", 0),
        ("max_inducement_points", 0),
        ("max_base_length", 0),
        ("require_inducement", 0),
        ("base_bar_range_in_zone_min", 0.40),
        ("base_body_in_zone_min", 0.60),
        ("atr_period", 10),
        ("atr_multiplier", 1.2),
        ("min_bars_between_swings", 3),
        ("max_bars", 180),
        ("acceptance_bars", 1),
        ("zone_extend_right_bars", 60),
        ("zone_overlap_trim_ratio", 0.6),
        ("max_pivot_candle_range_atr", 5.0),
        ("zone_price_overlap_threshold", 0.25),
        ("trend_filter_enabled", False),
        ("trend_chart_timeframe", "4h"),
        ("momentum_limit_in_zone", True),
        ("warn_exec_timeframe_mismatch", True),
        ("trend_window_bars", 5),
        ("trend_window_mode", "minmax"),
        ("trend_min_score_demand", 25.0),
        ("trend_max_score_supply", -25.0),
        ("range_zone_policy", "both"),
        ("module_params", {}),
    )

    def __init__(self):
        self._entry_price = None
        self._stop_price = None
        self._target_price = None
        self._entry_zone_key = None
        self._stop_order = None
        self._tp_order = None
        self._entry_bar = 0
        self._pending_orders: list = []
        self._zone_track: dict[str, dict] = {}
        self._trade_meta_queue: deque = deque()
        self._last_zone_ohlc: pd.DataFrame = pd.DataFrame()
        self._zone_height_history: list[float] = []
        self._missing_modules_warned: bool = False
        self._exec_tf_mismatch_warned: bool = False
        self._sd_empty_supply_demand_warned: bool = False
        self._sd_zones_mem_cache: dict[tuple[str, str, int, str], list[dict]] = {}

    def _sd_zone_feature_cache_kwargs(self) -> dict:
        """Phase-2 S/D feature cache: RAM + disk under DATA_CACHE_PATH when fingerprint is set."""
        disk_on = str(os.environ.get("SD_ZONE_DISK_CACHE", "1")).strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        )
        fp = (os.environ.get("HOST_DATASET_FINGERPRINT") or "").strip() or None
        cdir = (os.environ.get("DATA_CACHE_PATH") or "").strip()
        return {
            "sd_cache": self._sd_zones_mem_cache,
            "cache_dir": Path(cdir) if cdir else None,
            "data_fingerprint": fp,
            "disk_cache_enabled": disk_on,
        }

    def _effective_entry_style(self) -> str:
        return _resolve_effective_entry_style(
            str(getattr(self.params, "entry_model", "") or ""),
            str(getattr(self.params, "entry_style", "") or ""),
            str(getattr(self.params, "entry_mode", "edge") or "edge"),
        )

    def _limit_mode_for_entry(self) -> str:
        es = self._effective_entry_style()
        if es == "limit_mid":
            return "mid"
        if es == "limit_pct":
            return "pct"
        em = str(self.params.entry_mode).strip().lower()
        if em == "pct":
            return "pct"
        return "edge"

    def _stop_offset_pct_val(self) -> float:
        v = getattr(self.params, "stop_offset_pct", None)
        if v is not None:
            return float(v)
        sw = float(getattr(self.params, "stop_width_extra_pct", 0.1) or 0.1)
        bf = float(getattr(self.params, "stop_buffer_pct", 0) or 0)
        return sw + bf

    def _zone_size_bucket(self, zone_height: float) -> int:
        hist = self._zone_height_history
        h = float(zone_height)
        if h <= 1e-12:
            return 2
        if len(hist) < 5:
            return 2
        s = sorted(hist)
        n = len(s)
        i33 = max(0, min(n - 1, n // 3))
        i66 = max(0, min(n - 1, (2 * n) // 3))
        p33, p66 = s[i33], s[i66]
        if h <= p33:
            return 1
        if h <= p66:
            return 2
        return 3

    def _record_zone_height(self, zone_height: float) -> None:
        if zone_height > 1e-12:
            self._zone_height_history.append(float(zone_height))

    def _maybe_warn_no_supply_demand_zones(self, exec_df: pd.DataFrame) -> None:
        """Jednou za běh: dost historky na coarse TF, ale get_zones nevrátí žádné D/S (častá příčina 0 obchodů)."""
        if self._sd_empty_supply_demand_warned or get_zones is None:
            return
        tfs = _parse_zone_timeframes(self.params)
        coarse = self._coarsest_tf(tfs)
        zoh = resample_to_zone_tf(exec_df, coarse)
        need = min_zone_ohlc_bars(coarse)
        if len(zoh) < need:
            return
        self._sd_empty_supply_demand_warned = True
        try:
            zt = get_zones(zoh, self._sd_module_params_for_tf(coarse))
            n_sd = sum(1 for z in zt if z.get("name") in ("Demand", "Supply"))
        except Exception:
            return
        if n_sd > 0:
            return
        print(
            "sd_zone_strategy: get_zones na "
            f"{coarse} (po resamplu {len(zoh)} barů) nevrátil žádné Demand/Supply — bez nich strategie neobchoduje. "
            "Zkus prodloužit rozsah dat, upravit zone_timeframes (např. 30m u 30m souboru), "
            "nebo zkontrolovat parametry S/D modulu / trend_filtr.",
            flush=True,
        )

    def _sd_zone_trade_meta(
        self,
        zk: str,
        z: dict,
        st: dict,
        primary_tf: str,
        tfs: list[str],
        piv: int,
        d_idx: int,
        entry: float,
        stop: float,
        target: float,
        entry_style_used: str,
        dip_pct: float,
        zone_height: float,
        size_bucket: int,
        trap_zone: bool = False,
    ) -> dict:
        ic = int(z.get("inducement_count") or 0)
        return {
            "zoneKey": zk,
            "zoneName": z.get("name"),
            "primaryTf": primary_tf,
            "mergedTfs": st.get("merged_tfs"),
            "baseLength": z.get("base_length"),
            "impulseScore": z.get("impulse_score"),
            "inducementCount": ic,
            "inducementPoints": z.get("inducement_points"),
            "hadInducement": ic > 0,
            "hasTouch": z.get("has_touch"),
            "hasGap": z.get("has_gap"),
            "zoneAgeBars": d_idx - piv,
            "pivotIdx": piv,
            "entryStyle": entry_style_used,
            "entryModel": str(getattr(self.params, "entry_model", "limit")),
            "entryMode": str(self.params.entry_mode),
            "entryPct": float(self.params.entry_pct),
            "entryLimit": entry,
            "stopPrice": stop,
            "targetPrice": target,
            "targetRr": float(self.params.target_rr),
            "zoneTimeframes": ",".join(tfs),
            "execTimeframe": self.params.exec_timeframe,
            "preEntryDipPct": float(dip_pct),
            "zoneHeight": float(zone_height),
            "zoneSizeBucket": int(size_bucket),
            "trapZone": bool(trap_zone),
        }

    def _sd_module_params_for_tf(self, zone_tf: str) -> dict:
        """Sloučí nested module_params z UI a ploché parametry strategie; timeframe = zone_tf.

        zone_max_bars se mapuje na zone_extend_right_bars kvůli kompatibilitě API modulu; S/D výpočet
        tou hodnotou už neomezuje horizont zóny vpravo (životnost řeší close, dotyk, far-invalidate).
        """
        raw = dict(self.params.module_params or {})
        nested: dict = {}
        for _mod_name, val in raw.items():
            if isinstance(val, dict):
                nested.update(val)
        p = {**nested}
        keys = [
            "atr_period",
            "atr_multiplier",
            "min_bars_between_swings",
            "max_bars",
            "acceptance_bars",
            "zone_extend_right_bars",
            "zone_overlap_trim_ratio",
            "max_pivot_candle_range_atr",
            "base_bar_range_in_zone_min",
            "base_body_in_zone_min",
            "max_base_length",
            "require_inducement",
        ]
        for k in keys:
            v = getattr(self.params, k, None)
            p[k] = v if v is not None else p.get(k)
        p["timeframe"] = zone_tf
        p["data_timeframe"] = zone_tf
        p["zone_extend_right_bars"] = int(self.params.zone_max_bars)
        return p

    def _trend_params_for_get_trend(self, zone_tf: str) -> dict:
        """Parametry pro get_trend — EMA/smooth/lookback bereme jen z module_params (HL_identificator / Swing HL), ne ze strategie."""
        p = dict(self._sd_module_params_for_tf(zone_tf))
        nested: dict = {}
        for _mod_name, val in (self.params.module_params or {}).items():
            if isinstance(val, dict):
                nested.update(val)
        for k in (
            "ema_fast",
            "ema_medium",
            "ema_slow",
            "structure_lookback_swings",
            "trend_score_smooth_period",
            "trend_smooth_period",
        ):
            if k in nested:
                p[k] = nested[k]
        return p

    def _coarsest_tf(self, timeframes: list[str]) -> str:
        if not timeframes:
            return "1d"
        return max(timeframes, key=tf_coarseness)

    def decorate_trade_record(self, d: dict, trade) -> dict:
        if self._trade_meta_queue:
            meta = self._trade_meta_queue.popleft()
            out = dict(d)
            out["zoneMeta"] = meta
            el = meta.get("entryLimit")
            if el is not None:
                try:
                    out["entryPrice"] = float(el)
                except (TypeError, ValueError):
                    pass
            return out
        return d

    def notify_order(self, order):
        if order.status in (order.Canceled, order.Margin, order.Rejected):
            if order == self._stop_order:
                self._stop_order = None
            if order == getattr(self, "_tp_order", None):
                self._tp_order = None
            self._pending_orders = [(o, zk, e, s, t, il, meta) for o, zk, e, s, t, il, meta in self._pending_orders if o is not order]
            for zk, st in list(self._zone_track.items()):
                if st.get("order") is order:
                    st["order"] = None
                    st["state"] = "watch_departure"
                    st["departed"] = False
                    st["armed"] = False
                    st["momentum_wait_bars"] = 0
                    st["post_departure_min_low"] = float("inf")
                    st["post_departure_max_high"] = float("-inf")
            return
        if order.status != order.Completed:
            return
        if order == self._stop_order or order == getattr(self, "_tp_order", None):
            self._stop_order = None
            self._tp_order = None
            self._reset_trade()
            return

        i = None
        for j, row in enumerate(self._pending_orders):
            o = row[0]
            if o is order:
                i = j
                break
        if i is None:
            print(
                "sd_zone_strategy: notify_order Completed bez párování v _pending_orders — "
                "ignorováno (žádný heuristický fallback podle ceny).",
                flush=True,
            )
            return
        _, zone_key, entry, stop, target, is_long, meta = self._pending_orders.pop(i)
        for o2, *_ in list(self._pending_orders):
            self.cancel(o2)
        self._pending_orders.clear()
        self._entry_price = entry
        self._stop_price = stop
        self._target_price = target
        self._entry_zone_key = zone_key
        self._entry_bar = len(self)
        size = abs(order.executed.size)
        if meta:
            self._trade_meta_queue.append(meta)
        if is_long:
            self._tp_order = self.sell(size=size, exectype=bt.Order.Limit, price=target)
            self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop, oco=self._tp_order)
        else:
            self._tp_order = self.buy(size=size, exectype=bt.Order.Limit, price=target)
            self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop, oco=self._tp_order)
        if zone_key in self._zone_track:
            del self._zone_track[zone_key]

    def next(self):
        if get_zones is None:
            if not self._missing_modules_warned:
                self._missing_modules_warned = True
                print(
                    "sd_zone_strategy: Chybí get_zones — přidej a potvrď modul S/D zóny."
                )
            return

        if self.position.size != 0:
            self._check_exit()
            return

        exec_df = _get_exec_ohlc_df(self)
        self._maybe_warn_no_supply_demand_zones(exec_df)
        if exec_df.empty or len(exec_df) < 10:
            return

        if bool(getattr(self.params, "warn_exec_timeframe_mismatch", True)) and not self._exec_tf_mismatch_warned:
            exp = _exec_timeframe_expected_minutes(str(self.params.exec_timeframe))
            got = _infer_median_bar_minutes(exec_df)
            if exp and got and exp > 0 and got > 0:
                ratio = max(exp, got) / min(exp, got)
                if ratio > 1.35:
                    print(
                        f"sd_zone_strategy: exec_timeframe={self.params.exec_timeframe} (~{exp:.0f} min) "
                        f"vs medián mezi bary feedu ~{got:.0f} min — logika běží na skutečném TF dat, ne na parametru.",
                        flush=True,
                    )
            self._exec_tf_mismatch_warned = True

        tfs = _parse_zone_timeframes(self.params)
        coarse = self._coarsest_tf(tfs)
        zone_ohlc_coarse = resample_to_zone_tf(exec_df, coarse)
        self._last_zone_ohlc = zone_ohlc_coarse
        _min_coarse = min_zone_ohlc_bars(coarse)
        if zone_ohlc_coarse.empty or len(zone_ohlc_coarse) < _min_coarse:
            return

        overlap_th = float(self.params.zone_price_overlap_threshold)
        merged_zones, _flat_sd = _build_merged_sd_zones(
            exec_df,
            tfs,
            get_zones,
            self._sd_module_params_for_tf,
            bool(self.params.prefer_higher_tf),
            overlap_th,
            **self._sd_zone_feature_cache_kwargs(),
        )

        trend_scores_by_ett: dict[str, list[float] | None] = {}
        trend_params_by_ett: dict[str, dict] = {}
        tct_raw = str(getattr(self.params, "trend_chart_timeframe", "") or "")
        if int(self.params.trend_filter_enabled) and get_trend is not None:
            need_ett: set[str] = set()
            for z in merged_zones:
                ptf = str(z.get("_primary_tf", tfs[0]))
                need_ett.add(_effective_trend_tf(ptf, tct_raw))
            for ett in sorted(need_ett):
                zoh_t = resample_to_zone_tf(exec_df, ett)
                tp = self._trend_params_for_get_trend(ett)
                trend_params_by_ett[ett] = tp
                _min_trend = min_zone_ohlc_bars(ett)
                if zoh_t.empty or len(zoh_t) < _min_trend:
                    trend_scores_by_ett[ett] = None
                    continue
                tr = get_trend(zoh_t, tp)
                trend_scores_by_ett[ett] = list(tr["score"]) if tr and tr.get("score") else None

        seen_sd_keys: set[str] = set()
        for z in merged_zones:
            primary_tf = z.get("_primary_tf", tfs[0])
            merged_tfs = list(z.get("_merged_tfs") or [primary_tf])
            d_idx = int(z.get("_d_idx", len(resample_to_zone_tf(exec_df, primary_tf)) - 1))
            zk = merged_zone_key(z, primary_tf, merged_tfs)
            if not _zone_passes_trade_filters(self, z, d_idx):
                continue
            if int(self.params.trend_filter_enabled) and get_trend is not None:
                ett = _effective_trend_tf(str(primary_tf), tct_raw)
                tp_tf = trend_params_by_ett.get(ett) or self._trend_params_for_get_trend(ett)
                sc = trend_scores_by_ett.get(ett)
                if sc:
                    sd_mp = self._sd_module_params_for_tf(str(primary_tf))
                    piv = int(z.get("pivot_idx", z.get("end_idx", d_idx)))
                    j = _map_zone_pivot_to_trend_score_index(
                        exec_df, str(primary_tf), ett, piv, tp_tf
                    )
                    j = max(0, min(j, len(sc) - 1))
                    nwin = max(1, int(sd_mp.get("trend_window_bars", self.params.trend_window_bars)))
                    lo = max(0, j - nwin + 1)
                    win = [float(sc[k]) for k in range(lo, j + 1)]
                    if not _zone_passes_trend_window(
                        str(z.get("name", "")),
                        win,
                        str(sd_mp.get("trend_window_mode", self.params.trend_window_mode)),
                        float(sd_mp.get("trend_min_score_demand", self.params.trend_min_score_demand)),
                        float(sd_mp.get("trend_max_score_supply", self.params.trend_max_score_supply)),
                        str(sd_mp.get("range_zone_policy", self.params.range_zone_policy)),
                    ):
                        continue
            seen_sd_keys.add(zk)
            si, ei = z.get("start_idx"), z.get("end_idx")
            in_window = si is not None and ei is not None and int(si) <= d_idx <= int(ei)
            if zk not in self._zone_track and in_window:
                self._zone_track[zk] = {
                    "state": "watch_departure",
                    "departed": False,
                    "armed": False,
                    "zone": dict(z),
                    "is_long": z.get("name") == "Demand",
                    "order": None,
                    "armed_exec_bar": None,
                    "primary_tf": primary_tf,
                    "merged_tfs": merged_tfs,
                    "post_departure_min_low": float("inf"),
                    "post_departure_max_high": float("-inf"),
                    "momentum_wait_bars": 0,
                    "track_started_bar": len(self),
                    "far_consecutive": 0,
                    "entry_attempts_used": 0,
                    "retired_trading": False,
                }
            elif zk in self._zone_track:
                st = self._zone_track[zk]
                st["zone"] = dict(z)
                st["primary_tf"] = primary_tf
                st["merged_tfs"] = merged_tfs
                if "post_departure_min_low" not in st:
                    st["post_departure_min_low"] = float("inf")
                    st["post_departure_max_high"] = float("-inf")
                    st["momentum_wait_bars"] = 0
                st.setdefault("track_started_bar", len(self))
                st.setdefault("far_consecutive", 0)
                st.setdefault("entry_attempts_used", 0)
                st.setdefault("retired_trading", False)

        for zk in list(self._zone_track.keys()):
            if zk not in seen_sd_keys:
                st = self._zone_track[zk]
                o = st.get("order")
                if o and o.status in (o.Submitted, o.Accepted):
                    self.cancel(o)
                del self._zone_track[zk]

        bar_high = float(self.data.high[0])
        bar_low = float(self.data.low[0])
        bar_close = float(self.data.close[0])
        bar_open = float(self.data.open[0])
        est = self._effective_entry_style()
        offpct = self._stop_offset_pct_val()
        tgt_rr = float(self.params.target_rr)
        lim_mode = self._limit_mode_for_entry()
        req_bull = int(self.params.momentum_require_bull_bar)
        req_close_beyond = int(self.params.momentum_close_above_zone_high)
        max_mom = int(self.params.momentum_max_wait_bars)
        mom_lim = bool(getattr(self.params, "momentum_limit_in_zone", True))
        pct_ent = float(self.params.entry_pct)

        for zk, st in list(self._zone_track.items()):
            z = st["zone"]
            zl, zh = float(z["value_low"]), float(z["value_high"])
            zh_val = zh - zl
            primary_tf = st.get("primary_tf") or tfs[0]
            zoh_tf = resample_to_zone_tf(exec_df, primary_tf)
            if zoh_tf.empty:
                del self._zone_track[zk]
                continue
            daily_close = float(zoh_tf["close"].iloc[-1])
            piv = int(z.get("pivot_idx", z.get("end_idx", 0)))
            d_idx = int(z.get("_d_idx", len(zoh_tf) - 1))

            if _daily_invalidates(z, daily_close):
                o = st.get("order")
                if o and o.status in (o.Submitted, o.Accepted):
                    self.cancel(o)
                del self._zone_track[zk]
                continue

            if st.get("retired_trading"):
                continue

            atr_live = _atr_last(exec_df, period=max(2, int(getattr(self.params, "atr_period", 14))))
            mult_far = float(getattr(self.params, "zone_trading_far_atr_mult", 0) or 0)
            n_far = int(getattr(self.params, "zone_trading_far_consecutive_exec_bars", 0) or 0)
            min_track = int(getattr(self.params, "zone_trading_far_min_track_exec_bars", 0) or 0)
            track_age_bars = len(self) - int(st.get("track_started_bar", len(self)))
            is_mj = bool(z.get("is_major"))
            if not is_mj and mult_far > 0 and n_far > 0 and track_age_bars >= min_track:
                dist = _distance_close_to_zone_box(bar_close, zl, zh)
                if dist > mult_far * atr_live:
                    st["far_consecutive"] = int(st.get("far_consecutive", 0)) + 1
                    if st["far_consecutive"] >= n_far:
                        o = st.get("order")
                        if o and o.status in (o.Submitted, o.Accepted):
                            self.cancel(o)
                        st["retired_trading"] = True
                else:
                    st["far_consecutive"] = 0
            else:
                st["far_consecutive"] = 0

            if st.get("retired_trading"):
                continue

            state = st["state"]

            if state == "wait_momentum":
                if st["is_long"]:
                    st["post_departure_min_low"] = min(float(st["post_departure_min_low"]), bar_low)
                    st["momentum_wait_bars"] = int(st.get("momentum_wait_bars", 0)) + 1
                    ok_bar = (not req_bull) or (bar_close > bar_open)
                    ok_lvl = (not req_close_beyond) or (bar_close > zh)
                    if ok_bar and ok_lvl:
                        entry = float(bar_close)
                        if not (zl <= entry <= zh):
                            entry = _limit_entry_price(True, zl, zh, lim_mode, pct_ent)
                        entry = min(max(entry, zl), zh)
                        stop = _stop_outside_zone(True, zl, zh, offpct)
                        target = _target_from_rr(entry, stop, True, tgt_rr)
                        dip = _dip_pct_after_departure_demand(zh, zl, st["post_departure_min_low"])
                        bucket = self._zone_size_bucket(zh_val)
                        self._record_zone_height(zh_val)
                        trap = float(st["post_departure_min_low"]) < zh
                        meta = self._sd_zone_trade_meta(
                            zk, z, st, primary_tf, tfs, piv, d_idx, entry, stop, target,
                            est, dip, zh_val, bucket, trap,
                        )
                        order = self.buy(size=1, exectype=bt.Order.Limit, price=entry)
                        self._pending_orders.append((order, zk, entry, stop, target, True, meta))
                        st["state"] = "pending_limit"
                        st["order"] = order
                        st["armed_exec_bar"] = len(self)
                    elif st["momentum_wait_bars"] >= max_mom:
                        del self._zone_track[zk]
                else:
                    st["post_departure_max_high"] = max(float(st["post_departure_max_high"]), bar_high)
                    st["momentum_wait_bars"] = int(st.get("momentum_wait_bars", 0)) + 1
                    ok_bar = (not req_bull) or (bar_close < bar_open)
                    ok_lvl = (not req_close_beyond) or (bar_close < zl)
                    if ok_bar and ok_lvl:
                        entry = float(bar_close)
                        if mom_lim or not (zl <= entry <= zh):
                            entry = _limit_entry_price(False, zl, zh, lim_mode, pct_ent)
                        entry = min(max(entry, zl), zh)
                        stop = _stop_outside_zone(False, zl, zh, offpct)
                        target = _target_from_rr(entry, stop, False, tgt_rr)
                        dip = _dip_pct_after_departure_supply(zh, zl, st["post_departure_max_high"])
                        bucket = self._zone_size_bucket(zh_val)
                        self._record_zone_height(zh_val)
                        trap = float(st["post_departure_max_high"]) > zl
                        meta = self._sd_zone_trade_meta(
                            zk, z, st, primary_tf, tfs, piv, d_idx, entry, stop, target,
                            est, dip, zh_val, bucket, trap,
                        )
                        order = self.sell(size=1, exectype=bt.Order.Limit, price=entry)
                        st["state"] = "pending_limit"
                        self._pending_orders.append((order, zk, entry, stop, target, False, meta))
                        st["order"] = order
                        st["armed_exec_bar"] = len(self)
                    elif st["momentum_wait_bars"] >= max_mom:
                        del self._zone_track[zk]
                continue

            if state == "watch_departure":
                if st["is_long"]:
                    if bar_low > zh:
                        if not st.get("departed"):
                            st["departed"] = True
                            st["post_departure_min_low"] = bar_low
                        else:
                            st["post_departure_min_low"] = min(float(st["post_departure_min_low"]), bar_low)
                    elif st.get("departed"):
                        st["post_departure_min_low"] = min(float(st["post_departure_min_low"]), bar_low)
                    if st["departed"] and not st.get("armed"):
                        st["armed"] = True
                        if est in ("limit_edge", "limit_mid", "limit_pct"):
                            entry = _limit_entry_price(
                                True, zl, zh, lim_mode, float(self.params.entry_pct),
                            )
                            entry = min(max(entry, zl), zh)
                            stop = _stop_outside_zone(True, zl, zh, offpct)
                            target = _target_from_rr(entry, stop, True, tgt_rr)
                            dip = _dip_pct_after_departure_demand(zh, zl, st["post_departure_min_low"])
                            bucket = self._zone_size_bucket(zh_val)
                            self._record_zone_height(zh_val)
                            trap = float(st["post_departure_min_low"]) < zh
                            meta = self._sd_zone_trade_meta(
                                zk, z, st, primary_tf, tfs, piv, d_idx, entry, stop, target,
                                est, dip, zh_val, bucket, trap,
                            )
                            order = self.buy(size=1, exectype=bt.Order.Limit, price=entry)
                            self._pending_orders.append((order, zk, entry, stop, target, True, meta))
                            st["state"] = "pending_limit"
                            st["order"] = order
                            st["armed_exec_bar"] = len(self)
                        elif est == "market_momentum":
                            st["state"] = "wait_momentum"
                            st["momentum_wait_bars"] = 0
                else:
                    if bar_high < zl:
                        if not st.get("departed"):
                            st["departed"] = True
                            st["post_departure_max_high"] = bar_high
                        else:
                            st["post_departure_max_high"] = max(float(st["post_departure_max_high"]), bar_high)
                    elif st.get("departed"):
                        st["post_departure_max_high"] = max(float(st["post_departure_max_high"]), bar_high)
                    if st["departed"] and not st.get("armed"):
                        st["armed"] = True
                        if est in ("limit_edge", "limit_mid", "limit_pct"):
                            entry = _limit_entry_price(
                                False, zl, zh, lim_mode, float(self.params.entry_pct),
                            )
                            entry = min(max(entry, zl), zh)
                            stop = _stop_outside_zone(False, zl, zh, offpct)
                            target = _target_from_rr(entry, stop, False, tgt_rr)
                            dip = _dip_pct_after_departure_supply(zh, zl, st["post_departure_max_high"])
                            bucket = self._zone_size_bucket(zh_val)
                            self._record_zone_height(zh_val)
                            trap = float(st["post_departure_max_high"]) > zl
                            meta = self._sd_zone_trade_meta(
                                zk, z, st, primary_tf, tfs, piv, d_idx, entry, stop, target,
                                est, dip, zh_val, bucket, trap,
                            )
                            order = self.sell(size=1, exectype=bt.Order.Limit, price=entry)
                            self._pending_orders.append((order, zk, entry, stop, target, False, meta))
                            st["state"] = "pending_limit"
                            st["order"] = order
                            st["armed_exec_bar"] = len(self)
                        elif est == "market_momentum":
                            st["state"] = "wait_momentum"
                            st["momentum_wait_bars"] = 0

            elif state in ("pending_limit", "pending_market"):
                if st["is_long"]:
                    st["post_departure_min_low"] = min(float(st["post_departure_min_low"]), bar_low)
                else:
                    st["post_departure_max_high"] = max(float(st["post_departure_max_high"]), bar_high)
                ab = st.get("armed_exec_bar")
                if ab is not None and (len(self) - ab) >= int(self.params.max_limit_bars_exec):
                    o = st.get("order")
                    if o and o.status in (o.Submitted, o.Accepted):
                        self.cancel(o)
                    st["order"] = None
                    attempts = int(st.get("entry_attempts_used", 0)) + 1
                    st["entry_attempts_used"] = attempts
                    max_r = max(1, int(getattr(self.params, "retest_entry_max", 1)))
                    if attempts >= max_r:
                        st["retired_trading"] = True
                    else:
                        st["state"] = "watch_departure"
                        st["armed"] = False
                        st["departed"] = False
                        st["momentum_wait_bars"] = 0
                        st["post_departure_min_low"] = float("inf")
                        st["post_departure_max_high"] = float("-inf")

    def _check_exit(self):
        """TP/SL řeší OCO bracket z notify_order; zde jen max-hold a obnova bracketu po reloadu."""
        if self._stop_price is None or self._target_price is None:
            if self._recover_stop_target():
                pass
            else:
                self.close()
                self._reset_trade()
            return

        bars_held = len(self) - self._entry_bar

        if bars_held >= self.params.max_hold_bars:
            if self._stop_order:
                self.cancel(self._stop_order)
                self._stop_order = None
            if getattr(self, "_tp_order", None):
                self.cancel(self._tp_order)
                self._tp_order = None
            self.close()
            self._reset_trade()
            return

    def _recover_stop_target(self) -> bool:
        if get_zones is None:
            return False
        entry = float(self.position.price)
        is_long = self.position.size > 0
        exec_df = _get_exec_ohlc_df(self)
        tfs = _parse_zone_timeframes(self.params)
        coarse = self._coarsest_tf(tfs)
        zone_ohlc = resample_to_zone_tf(exec_df, coarse)
        if zone_ohlc.empty or len(zone_ohlc) < min_zone_ohlc_bars(coarse):
            return False
        _, flat_sd = _build_merged_sd_zones(
            exec_df,
            tfs,
            get_zones,
            self._sd_module_params_for_tf,
            bool(self.params.prefer_higher_tf),
            float(self.params.zone_price_overlap_threshold),
            **self._sd_zone_feature_cache_kwargs(),
        )
        if not flat_sd:
            return False
        offpct = self._stop_offset_pct_val()
        tgt_rr = float(self.params.target_rr)
        lim_mode = self._limit_mode_for_entry()
        pct = float(self.params.entry_pct)

        best: dict | None = None
        best_dist = float("inf")
        for z in flat_sd:
            if z.get("name") not in ("Demand", "Supply"):
                continue
            if is_long and z.get("name") != "Demand":
                continue
            if not is_long and z.get("name") != "Supply":
                continue
            zl, zh = float(z["value_low"]), float(z["value_high"])
            zh0 = zh - zl
            if zh0 <= 0:
                continue
            margin = max(zh0 * 0.01, entry * 0.005)
            ref_entry = _limit_entry_price(z.get("name") == "Demand", zl, zh, lim_mode, pct)
            in_band = zl - margin <= entry <= zh + margin
            if abs(entry - ref_entry) > margin and not in_band:
                continue
            dist = abs(entry - ref_entry)
            if in_band:
                dist = min(dist, abs(entry - zl), abs(entry - zh))
            if dist < best_dist:
                best_dist = dist
                best = z
        if best is None:
            return False
        z = best
        zl, zh = float(z["value_low"]), float(z["value_high"])
        stop = _stop_outside_zone(is_long, zl, zh, offpct)
        target = _target_from_rr(entry, stop, is_long, tgt_rr)
        self._entry_price = entry
        self._stop_price = stop
        self._target_price = target
        self._entry_bar = len(self)
        size = abs(int(self.position.size))
        if is_long:
            self._tp_order = self.sell(size=size, exectype=bt.Order.Limit, price=target)
            self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop, oco=self._tp_order)
        else:
            self._tp_order = self.buy(size=size, exectype=bt.Order.Limit, price=target)
            self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop, oco=self._tp_order)
        return True

    def _reset_trade(self):
        self._entry_price = None
        self._stop_price = None
        self._target_price = None
        self._entry_zone_key = None
        self._stop_order = None
        self._tp_order = None
        for o, *_ in list(self._pending_orders):
            self.cancel(o)
        self._pending_orders.clear()

    def get_zones(self, ohlc, params=None):
        if get_zones is None:
            return []
        p = dict(params or self.params.module_params or {})
        tf = _parse_zone_timeframes(self.params)[0]
        p = {**self._sd_module_params_for_tf(tf), **p}
        return get_zones(ohlc, p)
