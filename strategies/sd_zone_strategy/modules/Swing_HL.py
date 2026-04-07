# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — strategies/sd_zone_strategy/modules/Swing_HL.py — modul — celý soubor vložit do Firestore (Moduly → main.py, např. „Swing HL“).
"""
Swing High / Low Detector - samostatny modul pro detekci swing bodu, BOS a CHoCH.

Pouziti v aplikaci:
1. Vytvor modul (napr. "Swing HL") v sekci Moduly
2. Zkopiruj tento kod do main.py modulu (po kazde zmene v git repozitari znovu vloz cely soubor,
   jinak View bezime na stare verzi z uloziste a opravy se neprojevi)
3. Uloz
4. Ve View: vyber modul, ikona params - uprav parametry
5. Ve strategii: from modules.Swing_HL import detect, get_swings, get_bos  (nazev podle jmena modulu v app)
6. Pokud strategie tento modul nenaimportuje staticky (napr. dynamicke nacitani), pridej do strategie
   PARAM_MODULE_CHAIN = "Swing HL" (presny nazev polozky v Moduly), aby se VIEW_PARAMS modulu objevily v zalozce Moduly
   a main.py modulu se pribalil pri runu.

Major / Internal: Na grafu 1D → Major jen ze swingů 1W. Na jakémkoli TF jemnějším než 1D → Major = všechny swingy z 1W i z 1D (stejné body jako na týdenním + denním TF). Internály dle TF_INTERNAL_SPEC.
  View engine předává params["_view_ohlc_native"] (OHLC před přepočtem grafu) pro správné internály z nižšího TF.

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

BOS (Break of Structure): close nad nejnovějším ještě nevyčerpaným swing high (resp. pod low);
  po BOS se pivot označí jako vyčerpaný, takže se další BOS bere z dalšího nejnovějšího nevyčerpaného.
Následující acceptance_bars svíček nesmí uzavřít zpět pod/přes level.

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

TF_FINE_TO_COARSE = {  # minuty pro porovnání (1M = měsíc; 1m = 1 minuta)
    "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440,
    "1w": 10080, "1M": 43200,
}
TF_TO_PANDAS = {
    "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
    "1h": "1h", "4h": "4h", "1d": "1D", "1w": "1W", "1M": "1ME",
}

def _major_sources_and_resample_tf(chart_tf: str, ohlc: pd.DataFrame) -> tuple[str, tuple[str, ...]]:
    """
    (source_tf_effective, zdroje pro detekci majorů).

    - **1M**: žádní majory. **1w**: z **1M**. **1d**: z **1M + 1w**.
    - **Jemněji než 1d** (4h, 1h, 30m, …): majory z **1M + 1w + 1d** (všechny vyšší TF,
      aby weekly/monthly úrovně na intraday grafu nechyběly).

    ``tf_res`` pořád vychází z grafového TF vs. inferovaného kroku OHLC (resampling svíček).
    """
    th = _canonical_chart_tf(chart_tf)
    if th not in TF_FINE_TO_COARSE or th == "1M":
        return th, ()
    if th == "1w":
        return th, ("1M",)

    if ohlc is None or len(ohlc) < 2:
        tf_res = th
    else:
        sp = _infer_data_timeframe(ohlc)
        tm = TF_FINE_TO_COARSE.get(th, 0)
        sm = TF_FINE_TO_COARSE.get(sp, 0) if sp else 0
        if tm > 0 and sm > 0:
            tf_res = sp if sm < tm else th
        elif sm > 0:
            tf_res = sp
        else:
            tf_res = th

    if th == "1d":
        return tf_res, ("1M", "1w")
    return tf_res, ("1M", "1w", "1d")


def _major_tf_sources_for_chart(chart_tf: str, ohlc: pd.DataFrame | None = None) -> tuple[str, ...]:
    """
    Zdroje majorů; s `ohlc` použije skutečný krok svíček (doporučeno z get_major_swings).
    Bez OHLC zůstává rozlišení jen podle řetězce TF (legacy / rychlé testy).
    """
    if ohlc is not None and len(ohlc) >= 2:
        return _major_sources_and_resample_tf(chart_tf, ohlc)[1]
    tf = _canonical_chart_tf(chart_tf)
    if tf not in TF_FINE_TO_COARSE or tf == "1M":
        return ()
    if tf == "1w":
        return ("1M",)
    if tf == "1d":
        return ("1M", "1w")
    return ("1M", "1w", "1d")

# Internal: ("resample", child_tf) z nativních dat (_view_ohlc_native), jinak pivot/synthetic fallback;
# ("synthetic",) = jemné pivoty na chart OHLC; u 30m navíc 30m_internal mikro-swiny.
TF_INTERNAL_SPEC: dict[str, tuple] = {
    "1m": ("synthetic",),
    "5m": ("synthetic",),
    "15m": ("resample", "5m"),
    "30m": ("resample", "15m"),
    "1h": ("resample", "30m"),
    "4h": ("resample", "1h"),
    "1d": ("resample", "4h"),
    "1w": ("resample", "1d"),
    "1M": ("resample", "1w"),
}

# Parametry z VIEW pro výpočet major swingů (na vyšším TF): nedávají se tam obecné klíče z TF_CONFIG
# aktuálního grafu (např. 4h atr_period), aby se nepřepsal preset „major_tf“ (1w / 1d).
_MAJOR_SWING_PARAM_KEYS = frozenset({
    "atr_multiplier",
    "min_pullback_atr_ratio",
    "sensitivity",
    "allow_unconfirmed_last_swing",
    "max_candidate_bars",
})

TF_CONFIG = {
    "1m": {"atr_period": 60, "min_bars_between_swings": 12, "window_bars": 2000, "max_bars": 7500},
    "5m": {"atr_period": 40, "min_bars_between_swings": 8, "window_bars": 1000, "max_bars": 1500},
    "15m": {"atr_period": 28, "min_bars_between_swings": 6, "window_bars": 500, "max_bars": 500},
    "30m": {"atr_period": 24, "min_bars_between_swings": 6, "window_bars": 360, "max_bars": 360},
    # Jemnější internály na 30m grafu (bez jemnějších dat) — stejná řada, kratší min_bars / ATR okno.
    "30m_internal": {"atr_period": 18, "min_bars_between_swings": 3, "window_bars": 360, "max_bars": 360},
    "1h": {"atr_period": 20, "min_bars_between_swings": 5, "window_bars": 360, "max_bars": 360},
    "4h": {"atr_period": 18, "min_bars_between_swings": 10, "window_bars": 160, "max_bars": 90},
    "1d": {"atr_period": 10, "min_bars_between_swings": 4, "window_bars": 120, "max_bars": 180},
    "1w": {"atr_period": 8, "min_bars_between_swings": 4, "window_bars": 80, "max_bars": 52},
    "1M": {"atr_period": 6, "min_bars_between_swings": 3, "window_bars": 48, "max_bars": 24},
}

VIEW_PARAMS = {
    "timeframe": "1d",
    "data_timeframe": "",
    "sensitivity": 1.0,
    "atr_multiplier": 1.65,
    "include_internals": False,
    "acceptance_bars": 1,
    "max_bars": 180,
    "bos_include_internal_pivots": 0,
}

# Internal defaults – not exposed in UI but still respected if passed by strategy/other module.
_VIEW_PARAMS_INTERNAL = {
    "max_candidate_bars": 0,
    "allow_unconfirmed_last_swing": True,
    "min_pullback_atr_ratio": 0.42,
    "swing_sparsity": 1.12,
    "bos_pivot_cluster_max_bars": 6,
    "bos_pivot_cluster_atr_mult": 0.35,
    "bos_range_merge_atr_mult": 2.5,
    "bos_range_merge_max_swing_bars": 20,
    "ema_fast": 9,
    "ema_medium": 21,
    "ema_slow": 50,
    "trend_line_ema_period": 150,
    "structure_lookback_swings": 4,
    "trend_score_smooth_period": 8,
    "force_extremes_between_same_swings": True,
}

TREND_PARAMS = {
    "trend_min_long": 30,
    "trend_max_short": -30,
    "trend_filter_enabled": True,
    "trend_require_strong": False,
    "trend_smooth_period": 8,
}


def _median_bar_gap_minutes(ohlc: pd.DataFrame) -> float | None:
    """
    Typický krok mezi bary v minutách — medián kladných mezer < 48 h (stejně jako view_engine).
    Bez filtru by víkend/mezi-session skoky zkreslily 4h řadu do bucketu „1d“ a Major by se braly jen z 1W.
    """
    if ohlc is None or len(ohlc.index) < 2:
        return None
    delta_min = pd.Series(ohlc.index).diff().dt.total_seconds() / 60.0
    valid = delta_min[(delta_min > 0) & (delta_min < 60 * 48)]
    if len(valid) > 0:
        return float(valid.median())
    pos = delta_min[delta_min > 0]
    if len(pos) == 0:
        return None
    return float(pos.median())


def _infer_data_timeframe(ohlc: pd.DataFrame) -> str | None:
    """Odhadne timeframe z časových rozestupů mezi bary (_median_bar_gap_minutes)."""
    if ohlc is None or len(ohlc) < 2:
        return None
    minutes = _median_bar_gap_minutes(ohlc)
    if minutes is None:
        return None
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
    # Širší bucket: jinak hranice 300 min + mezery v datech často přehazují skutečné 4h do „1d“.
    if minutes <= 720:
        return "4h"
    # Nad 4h: denní mezery až ~3 dny (víkend), pak týden / měsíc
    if minutes <= 4320:
        return "1d"
    if minutes <= 20160:
        return "1w"
    return "1M"


def _reconcile_view_chart_tf_with_ohlc(declared_chart_tf: str, ohlc: pd.DataFrame) -> str:
    """
    View někdy předá hrubší graf-TF než skutečný krok OHLC (1D v params při 4h svíčkách).
    Pak _chart_tf_for_hierarchy skončí na 1d, inference z týchž dat může být taky 1d →
    _major_sources_and_resample_tf dá jen 1W. Pokud je z mediánu mezer < 48h série jemnější než den,
    použij tento TF.
    """
    if ohlc is None or len(ohlc) < 2:
        return declared_chart_tf
    spacing_tf = _infer_data_timeframe(ohlc)
    if not spacing_tf or declared_chart_tf not in TF_FINE_TO_COARSE or spacing_tf not in TF_FINE_TO_COARSE:
        return declared_chart_tf
    vm = TF_FINE_TO_COARSE[declared_chart_tf]
    sm = TF_FINE_TO_COARSE[spacing_tf]
    one_d = TF_FINE_TO_COARSE["1d"]
    if sm < one_d and vm >= one_d:
        return spacing_tf
    return declared_chart_tf


def _canonical_chart_tf(tf: str) -> str:
    """
    Sjednotí timeframe z View (`1D`, `1Mo`, …) na klíče TF_CONFIG / hierarchie.
    1M (měsíc) musí zůstat '1M', nesmí spadnout na 1min přes .lower().
    """
    t = str(tf).strip()
    tl = t.lower()
    if t in ("1Mo", "1ME", "1M") or tl in ("1mo", "1me", "1month"):
        return "1M"
    if t in ("1D",) or tl in ("1d", "daily"):
        return "1d"
    if t in ("1W",) or tl in ("1w", "weekly"):
        return "1w"
    return tl


def _chart_tf_for_hierarchy(
    ohlc: pd.DataFrame,
    timeframe_param: str,
    data_tf_param: str | None,
    view_chart_tf: str | None = None,
) -> str:
    """
    TF svíček grafu pro TF_PARENT / TF_INTERNAL / Major výpočet.

    Pořadí:
    1) _view_chart_tf z View (backend po agregaci grafu).
    2) data_timeframe z requestu, pokud není v rozporu s odhadnutým krokem z OHLC:
       pokud je data_tf hrubší než inference (např. deklarace 1d při skutečných 4h baru), ignorovat — typicky
       zastaralý stav z UI / zone sync.
       Pokud je data_tf **jemnější** než inference (soubor 30m, graf přepočítán na 4h), **také** ignorovat —
       jinak by skončila hierarchie na „30m“ nad 4h svíčkami a major zdroje (1M/1w/1d) a mapování majorů
       neseděly s grafem (uživatel nevidí 1d jako major na 4h).
    3) Inference z mediánu mezer < 48 h mezi bary (kvůli víkendům / mezerám).
    4) timeframe_param + jemnější krok OHLC (_refine_chart_tf_with_bar_spacing).
    """
    if isinstance(view_chart_tf, str) and view_chart_tf.strip():
        vc = _canonical_chart_tf(view_chart_tf.strip())
        if vc in TF_FINE_TO_COARSE:
            return _reconcile_view_chart_tf_with_ohlc(vc, ohlc)

    inferred = _infer_data_timeframe(ohlc)
    data_c: str | None = None
    if isinstance(data_tf_param, str) and data_tf_param.strip():
        dc = _canonical_chart_tf(data_tf_param.strip())
        if dc in TF_FINE_TO_COARSE:
            data_c = dc

    if data_c:
        stale_coarser = False
        if inferred and inferred in TF_FINE_TO_COARSE:
            if TF_FINE_TO_COARSE[data_c] > TF_FINE_TO_COARSE[inferred]:
                stale_coarser = True
        # Grafové OHLC je hrubší než nativní data_tf (agregace ve View) → TF struktury = podle řady v df.
        chart_coarser_than_native_meta = False
        if inferred and inferred in TF_FINE_TO_COARSE and data_c in TF_FINE_TO_COARSE:
            if TF_FINE_TO_COARSE[data_c] < TF_FINE_TO_COARSE[inferred]:
                chart_coarser_than_native_meta = True
        if not stale_coarser and not chart_coarser_than_native_meta:
            return _refine_chart_tf_with_bar_spacing(data_c, ohlc)

    if inferred:
        return _refine_chart_tf_with_bar_spacing(inferred, ohlc)
    if data_c:
        return _refine_chart_tf_with_bar_spacing(data_c, ohlc)
    out = _canonical_chart_tf(str(timeframe_param or "1d"))
    return _refine_chart_tf_with_bar_spacing(out, ohlc)


def _refine_chart_tf_with_bar_spacing(tf_out: str, ohlc: pd.DataFrame) -> str:
    """
    Když deklarovaný / odhadnutý TF je hrubší než typický krok OHLC, upřesni (např. fallback timeframe=1d při 4h datech).
    Neaplikovat, pokud už platí _view_chart_tf (ten řeší View výš).
    """
    spacing_tf = _infer_data_timeframe(ohlc)
    if (
        spacing_tf
        and tf_out in TF_FINE_TO_COARSE
        and spacing_tf in TF_FINE_TO_COARSE
        and TF_FINE_TO_COARSE[spacing_tf] < TF_FINE_TO_COARSE[tf_out]
    ):
        return spacing_tf
    return tf_out


def _resample_ohlc(
    ohlc: pd.DataFrame,
    target_tf: str,
    data_tf: str | None = None,
    source_tf_effective: str | None = None,
) -> pd.DataFrame:
    """Resample OHLC na target_tf. Pouze na hrubší TF.

    Jemnost zdroje = min(chart TF, odhad z indexu), aby 4h OHLC + deklarace „1d“ nikdy nepřeskočila agregaci na 1D.
    Bez source_tf_effective zůstává odvod od _infer_data_timeframe a data_tf jen ve větvi inferred_min==0.
    """
    if ohlc is None or len(ohlc) == 0:
        return ohlc
    target = _canonical_chart_tf(target_tf)
    if target not in TF_TO_PANDAS:
        return ohlc
    target_min = TF_FINE_TO_COARSE.get(target, 0)
    inferred = _infer_data_timeframe(ohlc)
    inferred_min = TF_FINE_TO_COARSE.get(inferred, 0) if inferred else 0

    eff_src: str | None = None
    if isinstance(source_tf_effective, str) and source_tf_effective.strip():
        es = _canonical_chart_tf(source_tf_effective.strip())
        if es in TF_FINE_TO_COARSE:
            eff_src = es

    # Jemnost řady: min(z deklarovaného chart TF, krok z indexu). Jinak při „1d“ v params ale 4h OHLC
    # target 1d == src_min → předčasný return a get_major_swings přeskočí 1D zdroj (zůstaly jen 1W).
    declared_min = TF_FINE_TO_COARSE.get(eff_src, 0) if eff_src else 0
    if eff_src and inferred_min > 0 and declared_min > 0:
        src_min = min(declared_min, inferred_min)
    elif eff_src:
        src_min = declared_min
    elif inferred_min > 0:
        src_min = inferred_min
    else:
        src_tf = data_tf or inferred
        src_min = TF_FINE_TO_COARSE.get(_canonical_chart_tf(str(src_tf)), 0) if src_tf else 0

    if src_min > 0:
        if target_min <= src_min:
            return ohlc
    else:
        src_tf = data_tf or inferred
        if src_tf and target_min <= TF_FINE_TO_COARSE.get(str(src_tf).lower(), 0):
            return ohlc

    rule = TF_TO_PANDAS[target]
    high_col = "high" if "high" in ohlc.columns else "High"
    low_col = "low" if "low" in ohlc.columns else "Low"
    open_col = "open" if "open" in ohlc.columns else "Open"
    close_col = "close" if "close" in ohlc.columns else "Close"
    agg = {open_col: "first", high_col: "max", low_col: "min", close_col: "last"}
    if "volume" in ohlc.columns:
        agg["volume"] = "sum"
    # Stejné jako View (_resample_ohlc_dataframe): vždy left/left — jinak 1W z daily ≠ 1W nativní graf.
    return ohlc.resample(rule, label="left", closed="left").agg(agg).dropna(how="all")


def _ensure_min_tf(ohlc: pd.DataFrame, min_tf: str, tf_param: str, data_tf_param: str | None) -> pd.DataFrame:
    """Resample na min_tf pokud je TF param jemnější."""
    tf = _canonical_chart_tf(str(tf_param or "1d"))
    min_minutes = TF_FINE_TO_COARSE.get(min_tf, 0)
    tf_minutes = TF_FINE_TO_COARSE.get(tf, 1440)
    if tf_minutes >= min_minutes:
        return ohlc
    return _resample_ohlc(
        ohlc,
        min_tf,
        data_tf_param or _infer_data_timeframe(ohlc),
        source_tf_effective=tf,
    )


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


def _marker_iso_date(ts: Any) -> str:
    if ts is None:
        return ""
    try:
        return pd.Timestamp(ts).isoformat()
    except (ValueError, TypeError, OSError):
        return _to_date_str(ts)


def _get_pivot_points(ohlc: pd.DataFrame) -> list[dict]:
    """Vrati vsechny pivot high/low (3-bar pattern). Bez potvrzeni pullbackem."""
    if ohlc is None or len(ohlc) < 3:
        return []
    high_col = "high" if "high" in ohlc.columns else "High"
    low_col = "low" if "low" in ohlc.columns else "Low"
    high = ohlc[high_col].values
    low = ohlc[low_col].values
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
    require_hl_alternation = bool(params.get("require_hl_alternation", True))

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

        # Striktní H-L-H-L: po high jen low, po low jen high (None = start, hledáme obě nohy prvního swingu).
        if require_hl_alternation:
            look_for_high = last_swing_type is None or last_swing_type == "low"
            look_for_low = last_swing_type is None or last_swing_type == "high"
        else:
            look_for_high = True
            look_for_low = True

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
            # Se striktním střídáním je zde vždy last_swing_type None nebo "low" — stačí pullback pod high.
            confirmed_by_pullback = low[i] <= cand_high - threshold
            if confirmed_by_pullback:
                start = max(0, last_swing_idx + 1)
                is_extremum = all(high[j] <= cand_high for j in range(start, cand_high_idx + 1))
                if is_extremum:
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
            confirmed_by_pullback = high[i] >= cand_low + threshold
            if confirmed_by_pullback:
                start = max(0, last_swing_idx + 1)
                is_extremum = all(low[j] >= cand_low for j in range(start, cand_low_idx + 1))
                if is_extremum:
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

    if (
        allow_unconfirmed_last
        and swings
        and cand_high is not None
        and cand_high_idx is not None
        and abs(int(cand_high_idx) - int(swings[-1]["index"])) >= min_bars
    ):
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
    elif (
        allow_unconfirmed_last
        and swings
        and cand_low is not None
        and cand_low_idx is not None
        and abs(int(cand_low_idx) - int(swings[-1]["index"])) >= min_bars
    ):
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


def _inject_forced_extremes_between_same_swings(
    swings: list[dict],
    ohlc: pd.DataFrame,
    major_swings: list[dict] | None = None,
) -> list[dict]:
    """
    HH → doplnění swing low na bar s nejnižším low v otevřeném intervalu (když tam není swing low).
    LL → doplnění swing high na bar s nejvyšším high v otevřeném intervalu (když tam není swing high).

    Výjimky (nic nevynucovat): v mezeře už je major_low u páru HH, nebo major_high u páru LL
    (nebo příslušný běžný swing stejného typu v ordered seznamu).
    """
    if not swings or ohlc is None or len(ohlc) < 3:
        return [dict(s) for s in swings]
    majors = major_swings or []
    high_col = "high" if "high" in ohlc.columns else "High"
    low_col = "low" if "low" in ohlc.columns else "Low"
    low_a = ohlc[low_col].values
    high_a = ohlc[high_col].values
    tdx = ohlc.index
    ordered = sorted((dict(s) for s in swings), key=lambda s: (int(s["index"]), 0 if s["type"] == "high" else 1))
    n = len(ohlc)
    to_add: list[dict] = []
    for left, right in zip(ordered, ordered[1:]):
        i0 = int(left["index"])
        i1 = int(right["index"])
        if left["type"] == "high" and right["type"] == "high":
            if i1 - i0 < 2:
                continue
            if any(s["type"] == "low" and i0 < int(s["index"]) < i1 for s in ordered):
                continue
            if any(
                s.get("type") == "major_low" and i0 < int(s["index"]) < i1
                for s in majors
            ):
                continue
            seg = low_a[i0 + 1 : i1]
            if seg.size == 0:
                continue
            min_j = int(seg.argmin()) + i0 + 1
            if 0 <= min_j < n:
                to_add.append({
                    "type": "low",
                    "price": float(low_a[min_j]),
                    "index": min_j,
                    "timestamp": tdx[min_j],
                })
        elif left["type"] == "low" and right["type"] == "low":
            if i1 - i0 < 2:
                continue
            if any(s["type"] == "high" and i0 < int(s["index"]) < i1 for s in ordered):
                continue
            if any(
                s.get("type") == "major_high" and i0 < int(s["index"]) < i1
                for s in majors
            ):
                continue
            seg = high_a[i0 + 1 : i1]
            if seg.size == 0:
                continue
            max_j = int(seg.argmax()) + i0 + 1
            if 0 <= max_j < n:
                to_add.append({
                    "type": "high",
                    "price": float(high_a[max_j]),
                    "index": max_j,
                    "timestamp": tdx[max_j],
                })
    if not to_add:
        return ordered
    out = ordered + to_add
    out.sort(key=lambda s: (int(s["index"]), 0 if s["type"] == "high" else 1))
    return out


def _map_swing_index_to_original(swing: dict, original_index: pd.DatetimeIndex) -> int:
    """Mapuje swing index z resampled na original ohlc podle timestampu."""
    ts = swing.get("timestamp")
    if ts is None:
        return swing.get("index", 0)
    idx = original_index.searchsorted(ts, side="left")
    if idx >= len(original_index):
        idx = len(original_index) - 1
    return int(idx)


def _map_pivot_from_work_to_original(pivot: dict, original_ohlc: pd.DataFrame) -> dict:
    """Pivot z work (agregované) OHLC → index a cena na nativním baru pro inducement / View."""
    idx = _map_swing_index_to_original(
        {"timestamp": pivot.get("timestamp"), "index": pivot.get("index", 0)},
        original_ohlc.index,
    )
    idx = min(max(0, idx), len(original_ohlc) - 1)
    high_col = "high" if "high" in original_ohlc.columns else "High"
    low_col = "low" if "low" in original_ohlc.columns else "Low"
    if pivot.get("type") == "high":
        price = float(original_ohlc[high_col].iloc[idx])
    else:
        price = float(original_ohlc[low_col].iloc[idx])
    return {
        "type": pivot["type"],
        "index": idx,
        "price": price,
        "timestamp": original_ohlc.index[idx],
    }


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

    # Bin = [period_start, period_end) — jednotné s View (_resample_ohlc label=left closed=left), včetně 1w/1M.
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

    params["timeframe"]: "1m"|"5m"|"15m"|"30m"|"1h"|"4h"|"1d" - cilovy TF vypoctu; pri jemnejsich datech se OHLC resampluje nahoru.
    params["data_timeframe"]: TF vstupnich dat (odhadne se z dat, pokud chybi) – pro spravny resample (napr. View 30m + timeframe 1d).
    Swing H/L: min. 5m – pri jemnejsim TF nez 5m se data nejdriv resampluji na 5m.
    params["max_bars"]: max. baru v jednom okne (pro 1d doporuceno 180 = 6M).
    params["include_internals"]: True -> vrati {"swings": [...], "internals": [...]}.
    params["omit_swings_overlapping_major"]: default True – swing na stejném místě jako major se vyhodí (BOS/get_bos).
        Pro View markery nastav False (viz detect v Swing HL / S_D_Zones).
    params["require_hl_alternation"]: default True – striktní střídání H/L. False = hustší swingy v trendu (oba směry současně).
    params["force_extremes_between_same_swings"]: default True – mezi HH doplní low na nejnižší svíčku v mezeře (symetricky mezi LL).

    Strategie: swings = get_swings(ohlc, {"timeframe": params.get("swing_tf", "1d")})

    Vraci: list swingu NEBO dict {"swings": [...], "internals": [...]} pri include_internals=True.
    """
    params = dict(params or {})
    native_view_ohlc = params.pop("_view_ohlc_native", None)
    _v_ui = params.pop("_view_chart_tf", None)
    _v_inf = params.pop("_view_ohlc_inferred_tf", None)
    view_chart_tf_raw = (
        _v_ui if isinstance(_v_ui, str) and str(_v_ui).strip() else _v_inf
    )
    vct = None
    if isinstance(view_chart_tf_raw, str) and view_chart_tf_raw.strip():
        vc = _canonical_chart_tf(view_chart_tf_raw.strip())
        if vc in TF_FINE_TO_COARSE:
            vct = vc
    require_hl_alternation = bool(params.pop("require_hl_alternation", True))
    tf = _canonical_chart_tf(str(params.pop("timeframe", "1d")))
    data_tf = params.pop("data_timeframe", None)
    if isinstance(data_tf, str) and str(data_tf).strip():
        data_tf = _canonical_chart_tf(str(data_tf).strip())
    else:
        data_tf = None
    include_internals = params.pop("include_internals", False)
    omit_swings_overlapping_major = bool(params.pop("omit_swings_overlapping_major", True))

    original_ohlc = ohlc
    tf = _chart_tf_for_hierarchy(original_ohlc, tf, data_tf, vct)
    base_ohlc = _ensure_min_tf(ohlc, MIN_TF_SWING, tf, data_tf)
    src_tf = data_tf or _infer_data_timeframe(ohlc)
    if not src_tf or src_tf not in TF_FINE_TO_COARSE:
        src_tf = _infer_data_timeframe(base_ohlc) or tf
    src_minutes = TF_FINE_TO_COARSE.get(src_tf, 0) if src_tf in TF_FINE_TO_COARSE else 0
    tf_minutes = TF_FINE_TO_COARSE.get(tf, 1440)
    if src_minutes > 0 and tf_minutes > src_minutes:
        coarse = _resample_ohlc(
            base_ohlc,
            tf,
            data_tf or src_tf,
            source_tf_effective=vct or data_tf or src_tf,
        )
        if coarse is not None and len(coarse) >= 3:
            work_ohlc = coarse
            work_tf = tf
        else:
            work_ohlc = base_ohlc
            work_tf = MIN_TF_SWING if base_ohlc is not ohlc else tf
    else:
        work_ohlc = base_ohlc
        work_tf = MIN_TF_SWING if base_ohlc is not ohlc else tf
    base = TF_CONFIG.get(work_tf, TF_CONFIG["1d"])
    params = {**base, **params}
    try:
        swing_sparsity = float(params.pop("swing_sparsity", 1.0) or 1.0)
    except (TypeError, ValueError):
        swing_sparsity = 1.0
    swing_sparsity = max(0.35, min(float(swing_sparsity), 5.0))
    swing_core_params = dict(params)
    swing_core_params["require_hl_alternation"] = require_hl_alternation
    mb0 = max(int(swing_core_params.get("min_bars_between_swings", 4)), 2)
    swing_core_params["min_bars_between_swings"] = max(2, int(round(mb0 * swing_sparsity)))
    atr_m0 = float(swing_core_params.get("atr_multiplier", 1.6))
    atr_bump = 1.0 + 0.12 * max(0.0, swing_sparsity - 1.0)
    swing_core_params["atr_multiplier"] = min(3.5, atr_m0 * atr_bump)
    swing_core_params.setdefault("force_extremes_between_same_swings", True)

    maj_params = {
        "timeframe": tf,
        "data_timeframe": data_tf,
        "swing_sparsity": swing_sparsity,
        **params,
    }
    maj_params["_view_chart_tf"] = vct if vct else tf

    max_bars = int(params.get("max_bars", 0))
    atr_period = int(params.get("atr_period", 10))

    if work_ohlc is None or len(work_ohlc) < atr_period + 2:
        return {"swings": [], "internals": [], "major_swings": []} if include_internals else []

    wf_min = TF_FINE_TO_COARSE.get(work_tf, 1440)
    if max_bars > 0 and wf_min >= 60:
        # Denní svíce: typicky 2–5k barů na ~15 let — obecný práh 12k rolling nikdy nezapne a jeden
        # průchod _get_swings_core na celé řadě degraduje; intradenně necháme vyšší práh.
        if work_tf == "1d":
            _rolling_min_len = max(400, int(max_bars * 3))
        else:
            _rolling_min_len = max(12000, int(max_bars * 30))
    elif max_bars > 0:
        _rolling_min_len = max(15000, int(max_bars * 2))
    else:
        _rolling_min_len = 0
    use_rolling_windows = (
        max_bars > 0
        and len(work_ohlc) > max_bars
        and len(work_ohlc) > _rolling_min_len
    )

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

    major_swings = get_major_swings(original_ohlc, maj_params)

    if max_bars <= 0 or len(work_ohlc) <= max_bars or not use_rolling_windows:
        swings, _ = _get_swings_core(work_ohlc, swing_core_params)
        swings = _map_swings_to_original(swings)
        atr_series = _compute_atr(work_ohlc, atr_period)
        swings = _deduplicate_swings(swings, original_ohlc, atr_series)
        mb_sp = max(int(swing_core_params.get("min_bars_between_swings", 4)), 2)
        swings = _enforce_same_type_min_spacing(swings, mb_sp)
        if bool(swing_core_params.get("force_extremes_between_same_swings", True)):
            swings = _inject_forced_extremes_between_same_swings(swings, original_ohlc, major_swings)
        if require_hl_alternation:
            swings = _enforce_strict_hl_alternation(swings)
        else:
            swings = sorted(swings, key=lambda s: (int(s["index"]), 0 if s.get("type") == "high" else 1))
        if omit_swings_overlapping_major:
            swings = [s for s in swings if not _swing_overlaps_major(s, major_swings)]
        if include_internals:
            pivot_src = work_ohlc if work_ohlc is not original_ohlc else None
            internals = _internals_from_hierarchy(
                swings, original_ohlc, tf, major_swings, native_view_ohlc, swing_core_params, pivot_src
            )
            return {"swings": swings, "internals": internals, "major_swings": major_swings}
        return swings

    all_swings: list[dict] = []
    stride = max(1, max_bars // 10)
    seen_ends: set[int] = set()
    for i in range(max_bars, len(work_ohlc) + 1, stride):
        window = work_ohlc.iloc[i - max_bars : i]
        if len(window) < atr_period + 2:
            continue
        swings, _ = _get_swings_core(window, swing_core_params)
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
            swings, _ = _get_swings_core(window, swing_core_params)
            offset = len(work_ohlc) - max_bars
            for s in swings:
                s = dict(s)
                s["index"] = s["index"] + offset
                s["timestamp"] = work_ohlc.index[s["index"]]
                all_swings.append(s)

    all_swings = _map_swings_to_original(all_swings)
    atr_series = _compute_atr(work_ohlc, atr_period)
    swings = _deduplicate_swings(all_swings, original_ohlc, atr_series)
    mb_sp = max(int(swing_core_params.get("min_bars_between_swings", 4)), 2)
    swings = _enforce_same_type_min_spacing(swings, mb_sp)
    if bool(swing_core_params.get("force_extremes_between_same_swings", True)):
        swings = _inject_forced_extremes_between_same_swings(swings, original_ohlc, major_swings)
    if require_hl_alternation:
        swings = _enforce_strict_hl_alternation(swings)
    else:
        swings = sorted(swings, key=lambda s: (int(s["index"]), 0 if s.get("type") == "high" else 1))
    if omit_swings_overlapping_major:
        swings = [s for s in swings if not _swing_overlaps_major(s, major_swings)]
    if include_internals:
        pivot_src = work_ohlc if work_ohlc is not original_ohlc else None
        internals = _internals_from_hierarchy(
            swings, original_ohlc, tf, major_swings, native_view_ohlc, swing_core_params, pivot_src
        )
        return {"swings": swings, "internals": internals, "major_swings": major_swings}
    return swings


def _dedupe_merged_major_swings(majors: list[dict]) -> list[dict]:
    """Sloučí téměř totožné major markery ze zdrojů 1M+1w (+ u intraday i 1d), stejný typ, blízký index."""
    if len(majors) < 2:
        return sorted(majors, key=lambda x: int(x["index"]))
    tol = MAJOR_SWING_INDEX_TOLERANCE
    ordered = sorted(
        majors,
        key=lambda x: (int(x["index"]), 0 if x["type"] == "major_high" else 1),
    )
    out: list[dict] = []
    for m in ordered:
        m = dict(m)
        if not out:
            out.append(m)
            continue
        prev = out[-1]
        if m["type"] == prev["type"] and abs(int(m["index"]) - int(prev["index"])) <= tol:
            if m["type"] == "major_high":
                if float(m["price"]) > float(prev["price"]) or (
                    float(m["price"]) == float(prev["price"]) and int(m["index"]) > int(prev["index"])
                ):
                    out[-1] = m
            else:
                if float(m["price"]) < float(prev["price"]) or (
                    float(m["price"]) == float(prev["price"]) and int(m["index"]) > int(prev["index"])
                ):
                    out[-1] = m
        else:
            out.append(m)
    return out


def get_major_swings(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Major Swing H/L — na **1d** grafu z **1M + 1w**; na **1w** z **1M**; na TF jemnějších než 1d
    výhradně z **1d** (denní swingy namapované na indexy vstupního OHLC).
    Vrací [{"type":"major_high"|"major_low","price","index","timestamp"}, ...].
    """
    params = dict(params or {})
    raw_tf = _canonical_chart_tf(str(params.get("timeframe", "1d")))
    data_tf_raw = params.get("data_timeframe")
    vraw = params.get("_view_chart_tf") or params.get("_view_ohlc_inferred_tf")
    vctf = None
    if isinstance(vraw, str) and vraw.strip():
        vc = _canonical_chart_tf(vraw.strip())
        if vc in TF_FINE_TO_COARSE:
            vctf = vc
    tf = _chart_tf_for_hierarchy(
        ohlc,
        raw_tf,
        data_tf_raw if isinstance(data_tf_raw, str) else None,
        vctf,
    )
    tf_resample, sources = _major_sources_and_resample_tf(tf, ohlc)
    if not sources:
        return []

    data_tf = params.get("data_timeframe")
    dt_arg = _canonical_chart_tf(str(data_tf).strip()) if isinstance(data_tf, str) and str(data_tf).strip() else None
    tuning = {k: params[k] for k in _MAJOR_SWING_PARAM_KEYS if k in params}

    merged: list[dict] = []
    for major_tf in sources:
        if major_tf not in TF_CONFIG:
            continue
        resampled = _resample_ohlc(ohlc, major_tf, dt_arg, source_tf_effective=tf_resample)
        min_resampled = 6 if major_tf in ("1w", "1M") else 10
        if resampled is ohlc or resampled is None or len(resampled) < min_resampled:
            continue

        base = dict(TF_CONFIG[major_tf])
        maj_params = {**base, **tuning}
        maj_params["timeframe"] = major_tf
        maj_params["require_hl_alternation"] = False
        try:
            sp = float(params.get("swing_sparsity", 1.0) or 1.0)
        except (TypeError, ValueError):
            sp = 1.0
        sp = max(0.35, min(float(sp), 5.0))
        mb_m = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
        maj_params["min_bars_between_swings"] = max(2, int(round(mb_m * sp)))
        atr_mm = float(maj_params.get("atr_multiplier", 1.6))
        atr_bm = 1.0 + 0.12 * max(0.0, sp - 1.0)
        maj_params["atr_multiplier"] = min(3.5, atr_mm * atr_bm)
        swings, _ = _get_swings_core(resampled, maj_params)
        atr_period = int(maj_params.get("atr_period", 10))
        atr_series = _compute_atr(resampled, atr_period)
        swings = _deduplicate_swings(swings, resampled, atr_series)
        mb = max(int(maj_params.get("min_bars_between_swings", 4)), 2)
        swings = _enforce_same_type_min_spacing(swings, mb)
        if bool(maj_params.get("force_extremes_between_same_swings", True)):
            swings = _inject_forced_extremes_between_same_swings(swings, resampled, None)
        swings = sorted(swings, key=lambda s: (int(s["index"]), 0 if s.get("type") == "high" else 1))
        for s in swings:
            idx, price = _map_major_swing_to_original(s, resampled, ohlc, major_tf)
            merged.append({
                "type": f"major_{s['type']}",
                "price": price,
                "index": idx,
                "timestamp": ohlc.index[idx] if idx < len(ohlc) else s.get("timestamp"),
            })

    return _dedupe_merged_major_swings(merged)


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


def _internals_synthetic_pivots(
    swings: list[dict],
    original_ohlc: pd.DataFrame,
    major_swings: list[dict] | None,
    pivot_source_ohlc: pd.DataFrame | None,
) -> list[dict]:
    src = pivot_source_ohlc if pivot_source_ohlc is not None else original_ohlc
    pivots = _get_pivot_points(src)
    if pivot_source_ohlc is not None:
        pivots = [_map_pivot_from_work_to_original(p, original_ohlc) for p in pivots]
    swing_keys = {(s["index"], s["type"]) for s in swings}
    return [
        p
        for p in pivots
        if (p["index"], p["type"]) not in swing_keys
        and not _pivot_overlaps_major(p, major_swings)
        and _confirm_internal_by_next_candle(original_ohlc, p)
    ]


def _internals_micro_swings_30m(
    swings: list[dict],
    chart_ohlc: pd.DataFrame,
    major_swings: list[dict] | None,
    tuning: dict,
) -> list[dict]:
    base = dict(TF_CONFIG["30m_internal"])
    tdict = {k: tuning[k] for k in _MAJOR_SWING_PARAM_KEYS if k in tuning}
    micro = {**base, **tdict, "require_hl_alternation": True}
    raw, _ = _get_swings_core(chart_ohlc, micro)
    raw = _enforce_strict_hl_alternation(raw)
    mb_sp = max(int(micro.get("min_bars_between_swings", 3)), 2)
    raw = _enforce_same_type_min_spacing(raw, mb_sp)
    swing_keys = {(s["index"], s["type"]) for s in swings}
    high_col = "high" if "high" in chart_ohlc.columns else "High"
    low_col = "low" if "low" in chart_ohlc.columns else "Low"
    out: list[dict] = []
    for s in raw:
        idx = int(s["index"])
        idx = min(max(0, idx), len(chart_ohlc) - 1)
        price = (
            float(chart_ohlc[high_col].iloc[idx])
            if s["type"] == "high"
            else float(chart_ohlc[low_col].iloc[idx])
        )
        p = {"type": s["type"], "index": idx, "price": price, "timestamp": chart_ohlc.index[idx]}
        if (idx, p["type"]) in swing_keys:
            continue
        if _pivot_overlaps_major(p, major_swings):
            continue
        if _confirm_internal_by_next_candle(chart_ohlc, p):
            out.append(p)
    return out


def _internals_from_hierarchy(
    swings: list[dict],
    chart_ohlc: pd.DataFrame,
    chart_tf: str,
    major_swings: list[dict] | None,
    native_ov: pd.DataFrame | None,
    tuning: dict,
    pivot_source_ohlc: pd.DataFrame | None,
) -> list[dict]:
    """
    Internály z nižšího TF (resample z native_view před agregací grafu), jinak synthetic / 30m micro.
    """
    ctf = _canonical_chart_tf(chart_tf)
    spec = TF_INTERNAL_SPEC.get(ctf, ("synthetic",))
    if spec[0] == "synthetic":
        if ctf == "30m":
            return _internals_micro_swings_30m(swings, chart_ohlc, major_swings, tuning)
        return _internals_synthetic_pivots(swings, chart_ohlc, major_swings, pivot_source_ohlc)

    child_tf = spec[1]
    native = native_ov if native_ov is not None and len(native_ov) else chart_ohlc
    inferred_native = _infer_data_timeframe(native)
    nmin = TF_FINE_TO_COARSE.get(inferred_native or "", 999999)
    cmin = TF_FINE_TO_COARSE.get(child_tf, 0)
    if nmin < cmin:
        src_nat = _canonical_chart_tf(inferred_native) if inferred_native else None
        sn = src_nat if src_nat in TF_FINE_TO_COARSE else None
        child_ohlc = _resample_ohlc(native, child_tf, inferred_native, source_tf_effective=sn)
    elif nmin == cmin:
        child_ohlc = native
    else:
        # native is COARSER than child TF - cannot resample down, fall back
        if ctf == "30m":
            return _internals_micro_swings_30m(swings, chart_ohlc, major_swings, tuning)
        return _internals_synthetic_pivots(swings, chart_ohlc, major_swings, pivot_source_ohlc)
    if child_ohlc is None or len(child_ohlc) < 5:
        return _internals_synthetic_pivots(swings, chart_ohlc, major_swings, pivot_source_ohlc)

    if child_tf not in TF_CONFIG:
        return _internals_synthetic_pivots(swings, chart_ohlc, major_swings, pivot_source_ohlc)

    base = dict(TF_CONFIG[child_tf])
    tdict = {k: tuning[k] for k in _MAJOR_SWING_PARAM_KEYS if k in tuning}
    child_params = {**base, **tdict, "require_hl_alternation": True}
    raw_swings, _ = _get_swings_core(child_ohlc, child_params)
    raw_swings = _enforce_strict_hl_alternation(raw_swings)
    mb_sp = max(int(child_params.get("min_bars_between_swings", 4)), 2)
    raw_swings = _enforce_same_type_min_spacing(raw_swings, mb_sp)

    swing_keys = {(s["index"], s["type"]) for s in swings}
    internals_out: list[dict] = []
    orig_idx = chart_ohlc.index
    high_col = "high" if "high" in chart_ohlc.columns else "High"
    low_col = "low" if "low" in chart_ohlc.columns else "Low"
    for s in raw_swings:
        idx = _map_swing_index_to_original(s, orig_idx)
        idx = min(max(0, idx), len(chart_ohlc) - 1)
        price = (
            float(chart_ohlc[high_col].iloc[idx])
            if s["type"] == "high"
            else float(chart_ohlc[low_col].iloc[idx])
        )
        p = {"type": s["type"], "index": idx, "price": price, "timestamp": chart_ohlc.index[idx]}
        if (idx, p["type"]) in swing_keys:
            continue
        if _pivot_overlaps_major(p, major_swings):
            continue
        if _confirm_internal_by_next_candle(chart_ohlc, p):
            internals_out.append(p)
    return internals_out


DEDUP_INDEX_TOLERANCE = 2
DEDUP_PRICE_ATR_TOLERANCE = 0.5
MAJOR_SWING_INDEX_TOLERANCE = 3


def _enforce_same_type_min_spacing(swings: list[dict], min_bars: int) -> list[dict]:
    """
    Odstraní příliš blízké swingy stejného typu (typicky LL/HH při require_hl_alternation=False).
    Ponechá výraznější extrém: vyšší high / nižší low; při shodě ceny novější index.
    """
    if min_bars <= 1 or len(swings) < 2:
        return [dict(s) for s in swings]
    ordered = sorted(swings, key=lambda x: (int(x["index"]), 0 if x.get("type") == "high" else 1))
    out: list[dict] = [dict(ordered[0])]
    for cur_raw in ordered[1:]:
        cur = dict(cur_raw)
        prev = out[-1]
        if cur["type"] != prev["type"]:
            out.append(cur)
            continue
        d = int(cur["index"]) - int(prev["index"])
        if d >= min_bars:
            out.append(cur)
            continue
        if cur["type"] == "high":
            if cur["price"] > prev["price"] or (
                cur["price"] == prev["price"] and cur["index"] > prev["index"]
            ):
                out[-1] = cur
        else:
            if cur["price"] < prev["price"] or (
                cur["price"] == prev["price"] and cur["index"] > prev["index"]
            ):
                out[-1] = cur
    return out


def _enforce_strict_hl_alternation(swings: list[dict]) -> list[dict]:
    """
    Po deduplikaci / sloučení oken může zůstat HH nebo LL. Sloučí po sobě jdoucí stejný typ:
    high → ponechá vyšší high (při shodě ceny novější index), low → nižší low.
    Výsledek je striktně střídavá řada H-L-H-L podle indexu.
    """
    if len(swings) < 2:
        return [dict(s) for s in swings]
    ordered = sorted(swings, key=lambda x: (x["index"], x.get("type", "")))
    out: list[dict] = [dict(ordered[0])]
    for s in ordered[1:]:
        cur = dict(s)
        if cur["type"] == out[-1]["type"]:
            if cur["type"] == "high":
                if cur["price"] > out[-1]["price"] or (
                    cur["price"] == out[-1]["price"] and cur["index"] > out[-1]["index"]
                ):
                    out[-1] = cur
            else:
                if cur["price"] < out[-1]["price"] or (
                    cur["price"] == out[-1]["price"] and cur["index"] > out[-1]["index"]
                ):
                    out[-1] = cur
        else:
            out.append(cur)
    return out


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


def _get_last_unconsumed_swing_high(
    swings: list[dict], up_to_index: int, consumed: set[int]
) -> tuple[float | None, int | None]:
    """Nejnovější swing high před up_to_index, který ještě nemá uzavřený BOS (ne v consumed)."""
    before = [
        s for s in swings
        if (s["type"] == "high" or s["type"] == "major_high")
        and int(s["index"]) < up_to_index
        and int(s["index"]) not in consumed
    ]
    if not before:
        return None, None
    s = max(before, key=lambda x: int(x["index"]))
    return float(s["price"]), int(s["index"])


def _get_last_unconsumed_swing_low(
    swings: list[dict], up_to_index: int, consumed: set[int]
) -> tuple[float | None, int | None]:
    """Nejnovější swing low před up_to_index, který ještě nemá uzavřený BOS."""
    before = [
        s for s in swings
        if (s["type"] == "low" or s["type"] == "major_low")
        and int(s["index"]) < up_to_index
        and int(s["index"]) not in consumed
    ]
    if not before:
        return None, None
    s = max(before, key=lambda x: int(x["index"]))
    return float(s["price"]), int(s["index"])


def _collapse_bos_pivot_clusters(
    swings: list[dict],
    ohlc: pd.DataFrame,
    params: dict | None,
) -> list[dict]:
    """
    Před výpočtem BOS sloučit těsné skupiny stejného typu (konsolidace):
    u high / major_high ponechat jen nejvyšší cenu, u low / major_low nejnižší.
    Skupina smí sahat nejvýše bos_pivot_cluster_max_bars indexů od **prvního** pivotu
    (aby se v trendu neřetězily všechny high až k listopadu a nezůstal jediný „nezlomený“ štít).
    Uvnitř skupiny: sousedé splní mezeru ≤ max_gap NEBO těsná cena v ATR.
    Oba parametry ≤ 0 → slučování vypnuto.
    """
    if not swings or ohlc is None or len(ohlc) < 3:
        return [dict(s) for s in swings]
    p = params or {}
    try:
        max_gap = int(p.get("bos_pivot_cluster_max_bars", 6))
    except (TypeError, ValueError):
        max_gap = 6
    try:
        atr_mult = float(p.get("bos_pivot_cluster_atr_mult", 0.35))
    except (TypeError, ValueError):
        atr_mult = 0.35
    if max_gap <= 0 and atr_mult <= 0:
        return [dict(s) for s in swings]

    # Jen cena (atr_mult) bez max_gap — stále omezit šířku clusteru, jinak by se řetězilo přes trendy.
    cluster_span_cap = max_gap
    if cluster_span_cap <= 0 and atr_mult > 0:
        cluster_span_cap = 8

    atr_period = max(2, int(p.get("atr_period", 10)))
    atr_series = _compute_atr(ohlc, atr_period)
    highs_t = frozenset({"high", "major_high"})
    lows_t = frozenset({"low", "major_low"})

    highs = [dict(s) for s in swings if s.get("type") in highs_t]
    lows = [dict(s) for s in swings if s.get("type") in lows_t]
    other = [dict(s) for s in swings if s.get("type") not in highs_t and s.get("type") not in lows_t]

    def _collapse_side(side: list[dict], is_high: bool) -> list[dict]:
        if len(side) < 2:
            return side
        sorted_s = sorted(side, key=lambda x: int(x["index"]))
        kept: list[dict] = []
        i = 0
        while i < len(sorted_s):
            cluster = [sorted_s[i]]
            j = i + 1
            while j < len(sorted_s):
                cur = sorted_s[j]
                span = int(cur["index"]) - int(cluster[0]["index"])
                if cluster_span_cap > 0 and span > cluster_span_cap:
                    break
                prev = cluster[-1]
                di = int(cur["index"]) - int(prev["index"])
                ix = int(cur["index"])
                ix = min(max(0, ix), len(atr_series) - 1)
                atr_i = max(float(atr_series.iloc[ix]), ATR_FLOOR)
                dprice = abs(float(cur["price"]) - float(prev["price"]))
                gap_ok = max_gap > 0 and di <= max_gap
                price_ok = atr_mult > 0 and dprice <= atr_mult * atr_i
                if gap_ok or price_ok:
                    cluster.append(cur)
                    j += 1
                else:
                    break
            if is_high:
                winner = max(cluster, key=lambda s: (float(s["price"]), int(s["index"])))
            else:
                winner = min(cluster, key=lambda s: (float(s["price"]), -int(s["index"])))
            kept.append(dict(winner))
            i = j
        return kept

    out = _collapse_side(highs, True) + _collapse_side(lows, False) + other
    return sorted(out, key=lambda s: (int(s["index"]), 0 if s.get("type") in highs_t else 1))


def _find_bos_from_swings(
    ohlc: pd.DataFrame,
    swings: list[dict],
    params: dict,
    *,
    bos_swing_kind: str = "swing",
) -> list[dict]:
    """
    BOS = Break of Structure – close nad posledním swing high nebo pod posledním swing low.
    Následující acceptance_bars svíček nesmí uzavřít zpět.
    bos_swing_kind: "swing" | "major" | "internal" – z jaké sady pivotů se BOS počítá (nezávislé streamy).
    Vrací: swing_index, swing_date, bos_index, bos_date, level, type, is_major, bos_swing_kind
    """
    is_major = bos_swing_kind == "major"
    params = params or {}
    accept_bars = int(params.get("acceptance_bars", 1))

    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    index = ohlc.index

    results: list[dict] = []
    consumed_swing_highs: set[int] = set()
    consumed_swing_lows: set[int] = set()

    for i in range(1, len(ohlc) - accept_bars):
        close = float(close_col.iloc[i])

        level_high, swing_idx_high = _get_last_unconsumed_swing_high(swings, i, consumed_swing_highs)
        if level_high is not None and swing_idx_high is not None and close > level_high:
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
                    "swing_date": _marker_iso_date(index[swing_idx_high]),
                    "bos_index": i,
                    "bos_date": _marker_iso_date(index[i]),
                    "level": level_high,
                    "type": "bos_bullish",
                    "is_major": is_major,
                    "bos_swing_kind": bos_swing_kind,
                })
                consumed_swing_highs.add(swing_idx_high)

        level_low, swing_idx_low = _get_last_unconsumed_swing_low(swings, i, consumed_swing_lows)
        if level_low is not None and swing_idx_low is not None and close < level_low:
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
                    "swing_date": _marker_iso_date(index[swing_idx_low]),
                    "bos_index": i,
                    "bos_date": _marker_iso_date(index[i]),
                    "level": level_low,
                    "type": "bos_bearish",
                    "is_major": is_major,
                    "bos_swing_kind": bos_swing_kind,
                })
                consumed_swing_lows.add(swing_idx_low)

    return sorted(results, key=lambda x: x["bos_index"])


def _find_bos(ohlc: pd.DataFrame, swings: list[dict], params: dict) -> list[dict]:
    """BOS na běžných swingech. Zachovává zpětnou kompatibilitu."""
    return _find_bos_from_swings(ohlc, swings, params, bos_swing_kind="swing")


def _bos_event_stream_rank(ev: dict) -> int:
    """Vyšší = preferovat při shodě ceny (major > swing > internal)."""
    if ev.get("is_major"):
        return 2
    k = str(ev.get("bos_swing_kind", "") or "").strip().lower()
    if k == "major":
        return 2
    if k == "swing":
        return 1
    return 0


def _merge_bos_events_in_consolidation_ranges(
    events: list[dict],
    ohlc: pd.DataFrame,
    params: dict | None,
) -> list[dict]:
    """
    Sloučí BOS ze swing / major / internal streamů, pokud spadají do stejného „range“:
    podobná cena (šířka pásma ≤ bos_range_merge_atr_mult × ATR u prvního pivota) a
    swing_index v okně bos_range_merge_max_swing_bars od začátku clusteru.
    Býčí: ponechá událost s nejvyšším level (nejdůležitější rezistence).
    Medvědí: s nejnižším level.
    bos_range_merge_atr_mult ≤ 0 → vypnuto.
    """
    if len(events) < 2 or ohlc is None or len(ohlc) < 3:
        return [dict(e) for e in events]
    p = params or {}
    try:
        lvl_mult = float(p.get("bos_range_merge_atr_mult", 2.5))
    except (TypeError, ValueError):
        lvl_mult = 2.5
    if lvl_mult <= 0:
        return [dict(e) for e in events]
    try:
        max_sw = int(p.get("bos_range_merge_max_swing_bars", 25))
    except (TypeError, ValueError):
        max_sw = 25
    if max_sw <= 0:
        max_sw = 10**9

    atr_period = max(2, int(p.get("atr_period", 10)))
    atr_s = _compute_atr(ohlc, atr_period)

    def atr_at(si: int) -> float:
        ii = min(max(0, int(si)), len(atr_s) - 1)
        return max(float(atr_s.iloc[ii]), ATR_FLOOR)

    bulls = [dict(e) for e in events if e.get("type") == "bos_bullish"]
    bears = [dict(e) for e in events if e.get("type") == "bos_bearish"]
    other = [dict(e) for e in events if e.get("type") not in ("bos_bullish", "bos_bearish")]

    def _run_side(side: list[dict], *, bullish: bool) -> list[dict]:
        if len(side) < 2:
            return side
        side.sort(key=lambda e: int(e["swing_index"]))
        out: list[dict] = []
        i = 0
        while i < len(side):
            cluster = [side[i]]
            t0 = int(side[i]["swing_index"])
            thr = lvl_mult * atr_at(t0)
            j = i + 1
            while j < len(side):
                e = side[j]
                if int(e["swing_index"]) - t0 > max_sw:
                    break
                levels = [float(x["level"]) for x in cluster] + [float(e["level"])]
                if max(levels) - min(levels) > thr:
                    break
                cluster.append(side[j])
                j += 1
            if bullish:
                w = max(
                    cluster,
                    key=lambda e: (
                        float(e["level"]),
                        _bos_event_stream_rank(e),
                        int(e.get("swing_index", 0)),
                    ),
                )
            else:
                w = min(
                    cluster,
                    key=lambda e: (
                        float(e["level"]),
                        -_bos_event_stream_rank(e),
                        -int(e.get("swing_index", 0)),
                    ),
                )
            out.append(dict(w))
            i = j
        return out

    merged_b = _run_side(bulls, bullish=True) + _run_side(bears, bullish=False) + other
    return sorted(merged_b, key=lambda x: int(x["bos_index"]))


def get_bos(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Vrací BOS události – swing H/L, Major Swing H/L a volitelně Internal H/L (samostatné streamy).
    [{"swing_index","swing_date","bos_index","bos_date","level","type","is_major","bos_swing_kind"}, ...]
    bos_swing_kind: "swing" | "major" | "internal". Param bos_include_internal_pivots=0 vypne internal větev.
    """
    p = dict(params or {})
    p_fetch = dict(p)
    p_fetch["include_internals"] = True
    # Jako detect(): plná sada hlavních swingů včetně těch na stejném baru jako major — jinak chybí úrovně k BOS.
    p_fetch["omit_swings_overlapping_major"] = False
    # Stejné H/L chování jako detect() — výchozí True ve get_swings by ořízlo swingy oproti grafu.
    p_fetch["require_hl_alternation"] = False
    # Stejné max_bars / rolling jako get_swings (VIEW / precompute); max_bars=0 v params vynutilí jeden průchod.
    swing_res = get_swings(ohlc, p_fetch)
    swings = swing_res.get("swings", []) if isinstance(swing_res, dict) else (swing_res or [])
    internals = swing_res.get("internals", []) if isinstance(swing_res, dict) else []

    p2 = dict(params or {})
    tf = _canonical_chart_tf(str(p2.get("timeframe", "1d")))
    major_swings = swing_res.get("major_swings") or [] if isinstance(swing_res, dict) else []
    if not major_swings:
        data_tf = p2.get("data_timeframe")
        maj_params = {"timeframe": tf, "data_timeframe": data_tf, **p2}
        major_swings = get_major_swings(ohlc, maj_params)

    cparams = dict(p)
    swings_bos = _collapse_bos_pivot_clusters(swings, ohlc, cparams)
    major_bos = _collapse_bos_pivot_clusters(major_swings, ohlc, cparams)
    internals_bos = _collapse_bos_pivot_clusters(internals, ohlc, cparams)

    results = _find_bos_from_swings(ohlc, swings_bos, params or {}, bos_swing_kind="swing")
    results_major = _find_bos_from_swings(ohlc, major_bos, params or {}, bos_swing_kind="major")
    results_internal: list[dict] = []
    if bool(int(p.get("bos_include_internal_pivots", 1))):
        results_internal = _find_bos_from_swings(ohlc, internals_bos, params or {}, bos_swing_kind="internal")
    results = sorted(results + results_major + results_internal, key=lambda x: x["bos_index"])
    results = _merge_bos_events_in_consolidation_ranges(results, ohlc, p)
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
        if str(ev.get("bos_swing_kind", "")) == "internal":
            continue
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
    tf = _canonical_chart_tf(str(p.get("timeframe", "1d")))
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
        score = float(trend_per_bar[i][1])
        state = trend_per_bar[i][2]
        data.append({"date": date_str, "value": value, "state": state, "score": score})

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
    p = dict(params or {})
    _view_tf_snap = {
        k: str(p[k]).strip()
        for k in ("_view_chart_tf", "_view_ohlc_inferred_tf")
        if isinstance(p.get(k), str) and str(p[k]).strip()
    }
    p["require_hl_alternation"] = False
    p["include_internals"] = True
    p["omit_swings_overlapping_major"] = False
    result = get_swings(ohlc, p)
    swings = result["swings"]
    internals = result["internals"]
    major_swings = result.get("major_swings") or []

    if not major_swings:
        fb: dict[str, Any] = {
            "timeframe": p.get("timeframe", "1d"),
            "data_timeframe": p.get("data_timeframe"),
        }
        for k in _MAJOR_SWING_PARAM_KEYS:
            if k in p:
                fb[k] = p[k]
        fb.update(_view_tf_snap)
        major_swings = get_major_swings(ohlc, fb)

    results = []
    for s in major_swings:
        ts = s.get("timestamp")
        date_str = _marker_iso_date(ts) if ts is not None else ""
        if date_str:
            row: dict[str, Any] = {"date": date_str, "type": s["type"], "value": s["price"]}
            if "index" in s:
                row["bar_index"] = int(s["index"])
            results.append(row)
    for s in swings:
        ts = s["timestamp"]
        date_str = _marker_iso_date(ts)
        row = {"date": date_str, "type": s["type"], "value": s["price"]}
        if "index" in s:
            row["bar_index"] = int(s["index"])
        results.append(row)
    for s in internals:
        ts = s["timestamp"]
        date_str = _marker_iso_date(ts)
        row = {
            "date": date_str,
            "type": f"internal_{s['type']}",
            "value": s["price"],
        }
        if "index" in s:
            row["bar_index"] = int(s["index"])
        results.append(row)
    return results
