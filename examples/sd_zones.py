# -*- coding: utf-8 -*-
"""
Supply/Demand zóny v-1.0 - modul pro detekci S/D zón na základě BOS.

# VIEW_DEPENDENCIES: Swing HL, HL identificator

Použití:
1. Vytvoř modul (např. "S/D Zones") v sekci Moduly
2. Zkopíruj tento kód do main.py modulu
3. Ulož
4. Ve View: vyber modul S/D Zones - zóny se zobrazí (View automaticky načte Swing HL)
5. Modul můžeš pojmenovat S_D_Zones nebo SD_identificator — kód je stejný (zkopíruj celý tento soubor).
6. Ve strategii: přidej HL identificator nebo Swing HL + S/D modul (např. sd_zone_strategy zkouší stejné pořadí jako tento soubor: HL_identificator před Swing_HL).

Interface pro View:
  detect(ohlc, params=None) -> [{"date","type":"high"|"low"|"internal_high"|"internal_low","value"}, ...]
  get_zones(ohlc, params=None) -> zóny + "has_touch", "touch_bar_index", "touch_marker_price", "touch_date" (View),
  get_line(ohlc, params=None) -> stejný trend jako v HL_identificator/Swing_HL (klíč „HL trend“), barvy podle stavu ve View,
    "active_demand_zones_below" (Demand), inducement s "index"; životnost vpravo = 2× zone_extend_right_bars + far-invalidate + střih při překryvu.
  base_length: svíčka je v base jen pokud současně platí práh % rozpětí H–L v zóně a práh % těla v zóně (VIEW_PARAMS).

VIEW_PARAMS musí být bez inline komentářů za hodnotami (např. NE: 1.0, #x) — parser ve View maže komentář
a může odstranit čárku mezi klíči; komentáře jen na samostatných řádcích nad blokem nebo mimo dict.

Pravidla S/D v-1.0 (viz SD_def.md):
- Demand: bullish BOS + pivot = bar s min(low) v momentum leg (od swing low k BOS)
- Supply: bearish BOS + pivot = bar s max(high) v momentum leg (od swing high k BOS)
- Výška zóny: H/L pivot svíčky
- Šířka vlevo: prodloužení doleva, pokud předchozí svíčka má ≥33% H-L v zóně A ≥10% těla v zóně
- Šířka vpravo: 2× zone_extend_right_bars; close invalidace; dotyk; volitelně daleko od zóny (far-invalidate, výchozí vypnuto); střih při ≥60 % překryvu se stejným typem
- Dotyk krátce po odchodu od zóny (rychlá korekce) nemusí ukončit život zóny doprava — viz zone_touch_departure_cooldown_bars.
- Odchod musí mít minimální vzdálenost od hranice v ATR (zone_departure_min_atr), jinak návrat u okraje neukončí zónu falešným „dotykem po departure“.
- V chop/range (okno trend skóre mezi bull a bear prahy) lze doplnit úzké D/S u Major H/L — viz range_major_proximity_*.
- V podobném místě a blízkém čase nesmí vzniknout 2 zóny stejného typu
- max_pivot_candle_range_atr: zóna z pivotu se ignoruje, pokud (high−low) pivotu > násobek ATR
  (ATR z předchozího baru, aby jedna extrémní svíčka nezkreslila měřítko). 0 = vypnuto.
  Pokud je pivot_zone_height_cap_atr > 0, nejdřív se výška zúží na strop × ATR a tento práh se
  uplatní jen když je strop vypnutý.
- pivot_zone_height_cap_atr (+ volitelně pivot_zone_height_cap_atr_supply): úzká široká svíčka se zúží; Supply u extrémů často přísnější strop.
- pivot_volume_spike_*: extrémní objem + široký bar → zóna se nevytvoří.
"""

import importlib
import pandas as pd
from typing import Any

# --- Interní konstanty (nejsou ve VIEW_PARAMS) ---
_ZONE_EXTEND_LEFT_RANGE_RATIO = 0.33
_ZONE_EXTEND_LEFT_BODY_RATIO = 0.10
_ZONE_TOUCH_VICINITY_ATR = 0.5
_ZONE_FAR_INVALIDATE_BARS = 15
_ZONE_FAR_INVALIDATE_ATR = 5.0
_ZONE_MAJOR_PROTECT_ATR = 2.5
_ZONE_MIN_BARS_BETWEEN_SAME = 7
_ZONE_PRICE_OVERLAP_THRESHOLD = 0.25
_INDUCEMENT_MAX_DISTANCE_ATR = 2.0
_INDUCEMENT_MAX_BARS = 40


def _load_swing_hl_module() -> tuple[Any, Any, Any]:
    """
    Jeden zdroj pro get_swings / get_bos / get_major_swings v celém modulu.

    Priorita: HL_identificator (obvykle stejný modul jako máš ve View u swingů),
    poté Swing_HL. Pokud máš v aplikaci oba a Swing_HL je zastaralý/prázdný,
    dřívější „Swing první“ rozbilo S/D zóny i markery.
    """
    for pkg in ("HL_identificator", "Swing_HL"):
        try:
            mod = importlib.import_module(f"modules.{pkg}")
        except ImportError:
            continue
        get_swings = getattr(mod, "get_swings", None)
        if get_swings is None:
            continue
        get_bos = getattr(mod, "get_bos", None)
        get_major_swings = getattr(mod, "get_major_swings", None)
        return get_bos, get_swings, get_major_swings
    return None, None, None


def _load_swing_hl_get_line() -> Any:
    """get_line ze stejného balíčku jako swingy (HL_identificator / Swing_HL) — trendová čára pro View."""
    for pkg in ("HL_identificator", "Swing_HL"):
        try:
            mod = importlib.import_module(f"modules.{pkg}")
        except ImportError:
            continue
        fn = getattr(mod, "get_line", None)
        if callable(fn):
            return fn
    return None


def _load_swing_hl_get_trend() -> Any:
    """get_trend ze stejného balíčku jako swingy; fallback examples.swing_hl_detector (dev)."""
    for pkg in ("HL_identificator", "Swing_HL"):
        try:
            mod = importlib.import_module(f"modules.{pkg}")
        except ImportError:
            continue
        fn = getattr(mod, "get_trend", None)
        if callable(fn):
            return fn
    try:
        ex = importlib.import_module("examples.swing_hl_detector")
        return getattr(ex, "get_trend", None)
    except ImportError:
        return None


def _map_pivot_idx_to_trend_scores_index(
    zoh: pd.DataFrame, pivot_idx: int, trend_params: dict
) -> int:
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
            if wmean >= float(min_demand):
                return True
            if wmean <= float(max_supply):
                return False
            return pol == "both"
        if wmin >= float(min_demand):
            return True
        if wmax <= float(max_supply):
            return False
        return pol == "both"
    if zone_name == "Supply":
        if m == "mean":
            if wmean <= float(max_supply):
                return True
            if wmean >= float(min_demand):
                return False
            return pol == "both"
        if wmax <= float(max_supply):
            return True
        if wmin >= float(min_demand):
            return False
        return pol == "both"
    return True


def _filter_zones_by_trend_window(
    ohlc: pd.DataFrame, zones: list[dict], params: dict
) -> list[dict]:
    if not bool(int(params.get("trend_filter_enabled", 0))):
        return zones
    gt = _load_swing_hl_get_trend()
    if gt is None or ohlc is None or len(ohlc) < 2:
        return zones
    trend_p = {
        **params,
        "timeframe": params.get("timeframe", "1d"),
        "data_timeframe": params.get("data_timeframe") or None,
    }
    tr = gt(ohlc, trend_p)
    if not tr or not tr.get("score"):
        return zones
    scores = tr["score"]
    nwin = max(1, int(params.get("trend_window_bars", 5)))
    mode = str(params.get("trend_window_mode", "minmax"))
    min_d = float(params.get("trend_min_score_demand", 25.0))
    max_s = float(params.get("trend_max_score_supply", -25.0))
    rng_pol = str(params.get("range_zone_policy", "both"))
    out: list[dict] = []
    for z in zones:
        nm = z.get("name")
        if nm not in ("Demand", "Supply"):
            out.append(z)
            continue
        piv = int(z.get("pivot_idx", z.get("end_idx", len(ohlc) - 1)))
        j = _map_pivot_idx_to_trend_scores_index(ohlc, piv, trend_p)
        j = max(0, min(j, len(scores) - 1))
        lo = max(0, j - nwin + 1)
        win = [float(scores[k]) for k in range(lo, j + 1)]
        if _zone_passes_trend_window(str(nm), win, mode, min_d, max_s, rng_pol):
            out.append(z)
    return out


def _trend_window_is_chop(
    window_scores: list[float],
    min_demand: float,
    max_supply: float,
) -> bool:
    """True = okno není čistě bull ani čistě bear (konsolidace / nejistota)."""
    if not window_scores:
        return False
    wmin = min(window_scores)
    wmax = max(window_scores)
    clearly_bull = wmin >= float(min_demand)
    clearly_bear = wmax <= float(max_supply)
    return not clearly_bull and not clearly_bear


def _append_major_proximity_chop_zones(
    ohlc: pd.DataFrame,
    zones: list[dict],
    major_swings: list[dict],
    params: dict,
    atr_series: pd.Series,
    index: pd.Index,
    high_col: Any,
    low_col: Any,
    open_col: Any,
    close_col: Any,
    swings: list[dict],
    internals: list[dict],
    threshold: float,
    body_threshold: float,
    effective_max_right: int,
    touch_vicinity_atr: float,
    far_inv_bars: int,
    far_inv_atr: float,
    major_prot: float,
    min_bars_between: int,
    price_overlap_threshold: float,
    atr_period: int,
) -> None:
    if not bool(int(params.get("range_major_proximity_zones_enabled", 1))):
        return
    if not major_swings or ohlc is None or len(ohlc) < 3:
        return

    try:
        width_atr = float(params.get("range_major_zone_width_atr", 0.85))
    except (TypeError, ValueError):
        width_atr = 0.85
    if width_atr <= 0:
        return

    require_chop = bool(int(params.get("range_major_require_chop_trend", 1)))
    try:
        look_bars = max(2, int(params.get("range_major_impulse_lookahead_bars", 8)))
    except (TypeError, ValueError):
        look_bars = 8

    nwin = max(1, int(params.get("trend_window_bars", 5)))
    min_d = float(params.get("trend_min_score_demand", 25.0))
    max_s = float(params.get("trend_max_score_supply", -25.0))

    trend_p = {
        **params,
        "timeframe": params.get("timeframe", "1d"),
        "data_timeframe": params.get("data_timeframe") or None,
    }
    scores: list[float] | None = None
    if require_chop:
        gt = _load_swing_hl_get_trend()
        if gt is None:
            return
        tr = gt(ohlc, trend_p)
        if not tr or not tr.get("score"):
            return
        scores = [float(x) for x in tr["score"]]
        if not scores:
            return

    n = len(ohlc)

    def chop_at_bar(mi: int) -> bool:
        if not require_chop or scores is None:
            return True
        j = _map_pivot_idx_to_trend_scores_index(ohlc, mi, trend_p)
        j = max(0, min(j, len(scores) - 1))
        lo = max(0, j - nwin + 1)
        win = [float(scores[k]) for k in range(lo, j + 1)]
        return _trend_window_is_chop(win, min_d, max_s)

    def overlaps_existing(name: str, pidx: int, zlo: float, zhi: float) -> bool:
        for z in zones:
            if z.get("name") != name:
                continue
            try:
                if _zones_overlap(
                    float(z["value_low"]),
                    float(z["value_high"]),
                    int(z.get("pivot_idx", 0)),
                    zlo,
                    zhi,
                    pidx,
                    min_bars_between,
                    price_overlap_threshold,
                ):
                    return True
            except (TypeError, ValueError, KeyError):
                continue
        return False

    for s in sorted(major_swings, key=lambda x: int(x.get("index", 0))):
        st = str(s.get("type", "")).lower()
        mi = int(s.get("index", -1))
        if mi < 0 or mi >= n:
            continue
        if not chop_at_bar(mi):
            continue
        try:
            px = float(s.get("price", 0))
        except (TypeError, ValueError):
            continue
        atr_m = _atr_at_idx(atr_series, mi)
        w = max(1e-9, width_atr * max(atr_m, 1e-9))

        if st == "major_high":
            zone_type = "Supply"
            zone_high = px
            zone_low = px - w
            zname = "Supply"
        elif st == "major_low":
            zone_type = "Demand"
            zone_low = px
            zone_high = px + w
            zname = "Demand"
        else:
            continue

        zone_low, zone_high = _clamp_pivot_zone_height(zone_low, zone_high, zone_type, atr_m, params)
        if zone_high - zone_low <= 1e-12:
            continue
        if overlaps_existing(zname, mi, zone_low, zone_high):
            continue

        bos_syn = min(mi + look_bars, n - 1)
        if bos_syn <= mi:
            bos_syn = min(mi + 1, n - 1)

        rightmost, has_touch, touch_bi, touch_mp = _compute_zone_width_right(
            ohlc,
            mi,
            zone_low,
            zone_high,
            effective_max_right,
            zone_type,
            atr_series,
            touch_vicinity_atr,
            major_swings,
            far_inv_bars,
            far_inv_atr,
            major_prot,
            params,
        )
        leftmost = _compute_zone_width(ohlc, mi, zone_low, zone_high, threshold, body_threshold)
        base_length = _compute_base_width(ohlc, mi, zone_low, zone_high, rightmost, params)
        impulse_score = _compute_impulse_score(
            ohlc,
            mi,
            bos_syn,
            zone_type,
            high_col,
            low_col,
            open_col,
            close_col,
            atr_series,
            atr_period,
        )
        inducements, inducement_count, inducement_points = _find_inducements(
            ohlc,
            zone_low,
            zone_high,
            mi,
            rightmost,
            zname,
            swings,
            internals,
            major_swings,
            atr_series,
        )

        if zname == "Demand":
            fill = "rgba(34, 197, 94, 0.35)" if has_touch else "rgba(34, 197, 94, 0.25)"
        else:
            fill = "rgba(239, 68, 68, 0.35)" if has_touch else "rgba(239, 68, 68, 0.25)"

        zd: dict[str, Any] = {
            "date_start": _to_date_str(index[leftmost]),
            "date_end": _to_date_str(index[rightmost]),
            "start_idx": leftmost,
            "end_idx": rightmost,
            "pivot_idx": mi,
            "value_low": float(zone_low),
            "value_high": float(zone_high),
            "fillcolor": fill,
            "name": zname,
            "base_length": base_length,
            "impulse_score": impulse_score,
            "has_touch": has_touch,
            "is_major": False,
            "inducements": inducements,
            "inducement_count": inducement_count,
            "inducement_points": inducement_points,
            "zone_origin": "major_chop",
        }
        if has_touch and touch_bi is not None and touch_mp is not None:
            zd["touch_bar_index"] = int(touch_bi)
            zd["touch_marker_price"] = float(touch_mp)
            zd["touch_date"] = _marker_iso_date(index[touch_bi])
        zones.append(zd)


def _hl_swing_overrides_from_params(params: dict | None) -> dict[str, int]:
    """
    Volitelné přepsání numeriky Swing HL (min. vzdálenost swingů, ATR, okno, max_bars).
    Hodnota 0 nebo záporná = nepřepisovat — použije se TF preset z swing_hl_detector.TF_CONFIG
    pro zvolený timeframe zón. Major H/L běží na odvozeném vyšším TF, ale sdílí stejný dict.
    """
    if not params:
        return {}
    out: dict[str, int] = {}
    mapping = (
        ("hl_swing_min_bars_between", "min_bars_between_swings"),
        ("hl_swing_atr_period", "atr_period"),
        ("hl_swing_window_bars", "window_bars"),
        ("hl_swing_max_bars", "max_bars"),
    )
    for src, dst in mapping:
        if src not in params:
            continue
        try:
            v = int(float(params[src]))
        except (TypeError, ValueError):
            continue
        if v > 0:
            out[dst] = v
    return out


def _params_for_hl_calls(params: dict | None) -> dict:
    """Sloučení parametrů pro get_swings / get_bos / get_major_swings včetně volitelných hl_swing_* override."""
    p = dict(params or {})
    extra = _hl_swing_overrides_from_params(p)
    if extra:
        p.update(extra)
    try:
        sp = float(p.get("hl_swing_sparsity", 1.0) or 1.0)
    except (TypeError, ValueError):
        sp = 1.0
    p["swing_sparsity"] = max(0.35, min(sp, 5.0))
    return p


# Jen parametry, které má smysl ladit v UI (View + záložka modulu v backtestu).
# max_base_length a require_inducement jsou v panelu strategie sd_zone_strategy (PARAMS), strategie je předává do get_zones.
# EMA / vyhlazení trendu pro get_trend jsou výchozí v HL_identificator / Swing_HL (nebo swing_hl_detector).
VIEW_PARAMS = {
    "timeframe": "1d",
    "data_timeframe": "",
    "zone_extend_right_bars": 60,
    "base_bar_range_in_zone_min": 0.40,
    "base_body_in_zone_min": 0.60,
    "zone_overlap_trim_ratio": 0.6,
    "max_pivot_candle_range_atr": 5.0,
    "trend_filter_enabled": 0,
    "trend_window_bars": 5,
    "trend_window_mode": "minmax",
    "trend_min_score_demand": 25.0,
    "trend_max_score_supply": -25.0,
    "range_zone_policy": "both",
    "hl_swing_min_bars_between": 0,
    "hl_swing_atr_period": 0,
    "hl_swing_window_bars": 0,
    "hl_swing_max_bars": 0,
    "hl_swing_sparsity": 1.0,
    "drop_young_near_dominant_enabled": 1,
    "dominant_zone_min_base": 4,
    "young_near_dominant_max_atr": 1.25,
    "young_dominant_max_pivot_bar_gap": 400,
    "demand_drop_low_rrr_vs_major_supply_enabled": 1,
    "demand_min_rrr_vs_major_supply": 1.5,
    "demand_major_supply_max_atr": 4.0,
    "pivot_volume_spike_skip_enabled": 1,
    "pivot_volume_spike_mult": 3.5,
    "pivot_volume_median_lookback": 30,
    "pivot_volume_spike_min_range_atr": 1.0,
    "pivot_zone_height_cap_atr": 3.0,
    "pivot_zone_height_cap_atr_supply": 1.75,
    "zone_far_invalidate_enabled": 0,
    "zone_touch_departure_cooldown_bars": 6,
    "zone_departure_min_atr": 0.25,
    "range_major_proximity_zones_enabled": 1,
    "range_major_zone_width_atr": 0.85,
    "range_major_require_chop_trend": 1,
    "range_major_impulse_lookahead_bars": 8,
}

VIEW_PARAMS_META = {
    "timeframe": {
        "title": "Časový rámec zón a struktury",
        "whatItMeans": "Na tomto timeframe se počítají swingy, BOS a z toho S/D zóny. U jemných dat (např. 30m) dává smysl 1d nebo 4h, aby nebyl šum na každé svíčce.",
        "howToUse": ["Shoda s tím, jak „čteš“ graf ručně — stejný TF jako u tvé analýzy supply/demand."],
    },
    "data_timeframe": {
        "title": "Velikost baru vstupních dat",
        "whatItMeans": "Říká modulu rozestup OHLC, která worker dostane po agregaci grafu. Ve View aplikace hodnotu drží v souladu s výběrem TF svíček (auto); ruční odchylka způsobí prázdné swingy/zóny.",
    },
    "hl_swing_min_bars_between": {
        "title": "Swing HL — min. počet barů mezi swingy (0 = auto podle TF)",
        "whatItMeans": "Nižší hodnota = hustší swingy na zvoleném timeframe zón; vyšší = řidší. Nula přenechá preset z modulu Swing HL pro daný TF.",
    },
    "hl_swing_atr_period": {
        "title": "Swing HL — perioda ATR (0 = auto)",
        "whatItMeans": "Potvrzení pullbacku proti ATR; kratší ATR citlivější swingy. Nula = preset pro TF zón.",
    },
    "hl_swing_window_bars": {
        "title": "Swing HL — window_bars (0 = auto)",
        "whatItMeans": "Délka použitého okna u rolling výpočtu na dlouhých sériích. Nula = preset pro TF zón.",
    },
    "hl_swing_max_bars": {
        "title": "Swing HL — max_bars v jednom okně (0 = auto)",
        "whatItMeans": "Omezí jedno okno výpočtu (viz Swing HL). Nula = preset pro TF zón.",
    },
    "hl_swing_sparsity": {
        "title": "Swing HL — řidší/hustší (1.0 = norma pro každý TF)",
        "whatItMeans": "Násobí minimální vzdálenost swingů proti presetu daného timeframe zón a mírně zpřísní ATR potvrzení. Stejné číslo na 30m i 4h = stejná *relativní* hustota vůči výchozímu TF. Zkus 1.3–1.8 když jsou swingy moc časté na jemnějším TF.",
    },
    "zone_extend_right_bars": {
        "title": "Horizont zóny doprava (×2 bary)",
        "whatItMeans": "Smyčka sleduje nejvýše 2× tuto hodnotu barů za pivotem. Ukončení: close za zónou, volitelný far-invalidate (výchozí vypnuto), nebo dotyk (kromě rychlé korekce v zone_touch_departure_cooldown_bars).",
        "howToUse": ["Příklad 60 → až ~120 barů; na 30m přepočítej podle toho, jak dlouho chceš zónu sledovat."],
    },
    "base_bar_range_in_zone_min": {
        "title": "Base — min. podíl rozpětí H–L uvnitř zóny",
        "whatItMeans": "Svíčka se započte do šířky base jen pokud současně splní i podíl těla (base_body_in_zone_min). Tento práh: kolik % celého rozpětí svíčky (high−low) musí ležet uvnitř výšky zóny.",
        "howToUse": ["Nižší hodnota = volnější, delší base; vyšší = přísnější."],
    },
    "base_body_in_zone_min": {
        "title": "Base — min. podíl těla (open–close) uvnitř zóny",
        "whatItMeans": "Spolu s base_bar_range_in_zone_min: obě podmínky musí platit současně. U doji (nulové tělo) stačí splnění prahu rozpětí.",
    },
    "zone_overlap_trim_ratio": {
        "title": "Střih při překryvu zón (0–1)",
        "whatItMeans": "Dvě zóny stejného typu: pokud se jejich cenové pásmo překrývá alespoň v tomto poměru vůči nižší zóny (výška), starší zóna končí těsně před začátkem mladší (časově).",
    },
    "max_pivot_candle_range_atr": {
        "title": "Odmítnout zónu — příliš široká pivot svíčka (× ATR)",
        "whatItMeans": "Výška zóny = high−low pivotu. Pokud je tento rozsah větší než tento násobek ATR, Demand/Supply zóna se z tohoto BOS nevytvoří. ATR z předchozího baru. Nula = vypnuto.",
        "howToUse": ["Výchozí 5; zvedni (např. 8), pokud schází zóny; sniž pro přísnější filtr."],
    },
    "trend_filter_enabled": {
        "title": "Filtr trendu (okno skóre u pivotu)",
        "whatItMeans": "Pokud je 1, Demand/Supply se vyřadí podle agregovaného trend skóre v okně kolem pivot_idx (stejná logika jako sd_zone_strategy). View pak odpovídá backtestu při stejných VIEW_PARAMS.",
    },
    "trend_window_bars": {
        "title": "Šířka okna trendu (počet barů TF zón)",
        "whatItMeans": "U indexu pivotu se z trend skóre vezme posledních N hodnot (včetně pivot baru).",
    },
    "trend_window_mode": {
        "title": "Agregace v okně",
        "whatItMeans": "minmax: Demand vyžaduje min(skóre) ≥ práh bull; Supply max(skóre) ≤ práh bear. mean: stejné prahy na průměr okna.",
    },
    "trend_min_score_demand": {
        "title": "Min. skóre pro Demand (bull kontext)",
        "whatItMeans": "Hodnoty z get_trend (stejné jako HL trend). Typicky +20 až +30.",
    },
    "trend_max_score_supply": {
        "title": "Max. skóre pro Supply (bear kontext)",
        "whatItMeans": "Typicky −20 až −30.",
    },
    "range_zone_policy": {
        "title": "Chování v neutrálním / smíšeném pásmu",
        "whatItMeans": "both = zónu ponechat; none = při range (okno není čistě bull ani bear podle prahů) zónu zahodit.",
    },
    "drop_young_near_dominant_enabled": {
        "title": "Zahodit mladší S/D u blízké dominantní",
        "whatItMeans": "Stejný typ: starší zóna dominantní (Major nebo base ≥ práh) a mladší ne — pokud jsou cenově těsně u sebe (násobek ATR mezi hranami), mladší se vyřadí.",
    },
    "dominant_zone_min_base": {
        "title": "Dominantní — min. délka base (když není Major)",
        "whatItMeans": "Zóna se považuje za dominantní i bez Major, pokud base_length ≥ této hodnoty. 0 = jen is_major.",
    },
    "young_near_dominant_max_atr": {
        "title": "Blízkost mladší vs. dominantní (× ATR)",
        "whatItMeans": "Max. vzdálenost nejbližších hran starší a mladší zóny (stejný typ), normalizace ATR u pivotu mladší zóny.",
    },
    "young_dominant_max_pivot_bar_gap": {
        "title": "Max. rozestup pivotů (bary) pro pravidlo mladší/dominantní",
        "whatItMeans": "Pouze pokud |pivot_mladší − pivot_starší| ≤ tomuto číslu; jinak se pravidlo neaplikuje.",
    },
    "demand_drop_low_rrr_vs_major_supply_enabled": {
        "title": "Demand pryč při slabém RRR vůči Major Supply",
        "whatItMeans": "Nad Demand je blízká Supply s is_major; pokud poměr odměna (TP na spodní hraně Supply od horního okraje Demand) ku riziku (výška Demand) klesne pod práh, Demand se vyřadí.",
    },
    "demand_min_rrr_vs_major_supply": {
        "title": "Min. RRR Demand vs. Major Supply",
        "whatItMeans": "Pod této hodnotou se Demand zruší, pokud platí zásah Major Supply výše.",
    },
    "demand_major_supply_max_atr": {
        "title": "Max. vzdálenost Demand–Major Supply (× ATR)",
        "whatItMeans": "Berou se jen Major Supply nad Demandem, jejichž spodní hrana je nejvýše tento násobek ATR nad horní hranou Demandu.",
    },
    "pivot_volume_spike_skip_enabled": {
        "title": "Vyřadit zónu při extrémním objemu na pivotu",
        "whatItMeans": "Objem pivotu vs. medián objemů v předchozích bareních; při překročení násobku a dostatečně široké svíčce (min. × ATR) se zóna z tohoto BOS nevytvoří — typické chaotickejší čárky.",
    },
    "pivot_volume_spike_mult": {
        "title": "Objemový spike — násobek med. objemu",
        "whatItMeans": "Pivotní objem musí být alespoň tento násobek mediánu objemu z lookbacku před pivotem (bez aktuálního baru).",
    },
    "pivot_volume_median_lookback": {
        "title": "Objemový spike — lookback (bary)",
        "whatItMeans": "Počet předchozích barů pro medián objemu; kratší okno = citlivější spike.",
    },
    "pivot_volume_spike_min_range_atr": {
        "title": "Spike skip — min. šířka pivotu (× ATR)",
        "whatItMeans": "Vyhození kvůli objemu jen pokud je zároveň rozsah H−L pivotu alespoň tento násobek ATR (vyhne se falešným skipům u úzkých barů).",
    },
    "pivot_zone_height_cap_atr": {
        "title": "Strop výšky zóny z pivotu — výchozí / Demand (× ATR)",
        "whatItMeans": "Široká svíčka: zóna se zúží na nejvýše tento násobek ATR u Demand (a u Supply, pokud není pivot_zone_height_cap_atr_supply). Supply drží horní hranu, Demand spodní. Nula = strop vypnutý pro daný typ.",
    },
    "pivot_zone_height_cap_atr_supply": {
        "title": "Strop výšky Supply z pivotu (× ATR)",
        "whatItMeans": "U Supply často stačí užší pásmo (vrcholové svíčky bývají extrémně dlouhé). Kladné číslo přepíše pro Supply hodnotu pivot_zone_height_cap_atr. Nula = použij jen pivot_zone_height_cap_atr.",
    },
    "zone_far_invalidate_enabled": {
        "title": "Ukončit zónu při dlouhém „odstupu“ od ceny (far invalidate)",
        "whatItMeans": "0 = vypnuto (zóna nekončí jen tím, že je cena dlouho daleko podle A×ATR v řadě). 1 = zapnuto původní logiku N po sobě jdoucích barů mimo pásmo.",
    },
    "zone_touch_departure_cooldown_bars": {
        "title": "Ignorovat ukončující dotyk po odchodu (bary)",
        "whatItMeans": "Po prvním odchodu ceny od zóny: pokud následný návrat/dotyk nastane do toliko barů, neaplikuje se konec života zóny z dotyku (rychlá korekce). 0 = vždy platí dotyk jako dřív.",
    },
    "zone_departure_min_atr": {
        "title": "Min. odchod od zóny (× ATR)",
        "whatItMeans": "Demand: celý bar musí být alespoň tento násobek ATR nad horní hranou zóny, než se počítá odchod (a může platit návrat/dotyk). Supply symetricky dolů. 0 = původní chování (stačilo lehce nad horní hranou).",
    },
    "range_major_proximity_zones_enabled": {
        "title": "Doplnit zóny u Major v chop/range",
        "whatItMeans": "Pokud okno trend skóre u baru Major není čistě bull ani čistě bear (stejné prahy jako trend filtr), přidá se úzký Supply u major_high a Demand u major_low poblíž ceny Majoru.",
    },
    "range_major_zone_width_atr": {
        "title": "Šířka major-proximity zóny (× ATR)",
        "whatItMeans": "Výška boxu od extrému Majoru dovnitř grafu (Demand nahoru od low, Supply dolů od high).",
    },
    "range_major_require_chop_trend": {
        "title": "Major-proximity jen při chop z trend skóre",
        "whatItMeans": "1 = bez get_trend / bez smíšeného okna se zóny nepřidají. 0 = přidat vždy (pokud je zapnuto range_major_proximity_zones_enabled).",
    },
    "range_major_impulse_lookahead_bars": {
        "title": "Major-proximity — lookahead pro impulse_score (bary)",
        "whatItMeans": "Syntetický „BOS“ index = pivot + tato hodnota (strop konce řady) pro výpočet impulse_score u doplněných zón.",
    },
}


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _marker_iso_date(ts: Any) -> str:
    """ISO čas pro View / mapování na OHLC (ne jen YYYY-MM-DD)."""
    if ts is None:
        return ""
    try:
        return pd.Timestamp(ts).isoformat()
    except (ValueError, TypeError, OSError):
        return _to_date_str(ts)


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


def _bar_counts_as_base(
    bar_high: float,
    bar_low: float,
    bar_open: float,
    bar_close: float,
    zone_low: float,
    zone_high: float,
    range_in_zone_min: float,
    body_in_zone_min: float,
) -> bool:
    """
    Svíčka patří do base jen pokud:
    - podíl rozpětí H–L ležící v [zone_low, zone_high] ≥ range_in_zone_min, a zároveň
    - podíl těla v zóně ≥ body_in_zone_min (u doji / nulového těla stačí jen první podmínka).
    """
    zl, zh = zone_low, zone_high
    if zh - zl <= 0:
        return False

    ov_lo = max(zl, bar_low)
    ov_hi = min(zh, bar_high)
    ov = max(0.0, ov_hi - ov_lo)

    bar_range = bar_high - bar_low
    if bar_range <= 1e-12:
        return False
    range_ok = (ov / bar_range) >= range_in_zone_min
    if not range_ok:
        return False

    body_lo = min(bar_open, bar_close)
    body_hi = max(bar_open, bar_close)
    body_len = body_hi - body_lo
    if body_len <= 1e-12:
        return True

    b_ov_lo = max(zl, body_lo)
    b_ov_hi = min(zh, body_hi)
    b_ov = max(0.0, b_ov_hi - b_ov_lo)
    return (b_ov / body_len) >= body_in_zone_min


def _compute_base_width(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    rightmost: int,
    params: dict | None = None,
) -> int:
    """
    Base = souvislý blok svíček od pivotu doleva/doprava (ne dál než rightmost),
    kde každá svíčka splní _bar_counts_as_base podle prahů v params / VIEW_PARAMS.
    Vrací počet barů (min 1).
    """
    params = params or {}
    range_in_zone_min = float(params.get("base_bar_range_in_zone_min", 0.40))
    body_in_zone_min = float(params.get("base_body_in_zone_min", 0.60))

    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    open_col = ohlc["open"].values if "open" in ohlc.columns else ohlc["Open"].values
    close_col = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    def qualifies(j: int) -> bool:
        return _bar_counts_as_base(
            float(high[j]),
            float(low[j]),
            float(open_col[j]),
            float(close_col[j]),
            zone_low,
            zone_high,
            range_in_zone_min,
            body_in_zone_min,
        )

    leftmost_base = pivot_idx
    for j in range(pivot_idx - 1, -1, -1):
        if qualifies(j):
            leftmost_base = j
        else:
            break

    rightmost_base = pivot_idx
    for j in range(pivot_idx + 1, min(rightmost + 1, n)):
        if qualifies(j):
            rightmost_base = j
        else:
            break

    return max(1, rightmost_base - leftmost_base + 1)


def _zone_near_major_structure(
    zone_low: float,
    zone_high: float,
    major_swings: list[dict],
    atr_ref: float,
    protect_atr_mult: float,
) -> bool:
    """True pokud je zóna v „oblasti“ major swing HL (ochrana proti far-invalidate)."""
    if not major_swings or atr_ref <= 0 or protect_atr_mult <= 0:
        return False
    max_d = protect_atr_mult * atr_ref
    for s in major_swings:
        t = str(s.get("type", "")).lower()
        if "major" not in t:
            continue
        try:
            p = float(s.get("price", 0))
        except (TypeError, ValueError):
            continue
        if zone_low <= p <= zone_high:
            return True
        d = min(abs(p - zone_low), abs(p - zone_high))
        if d <= max_d:
            return True
    return False


def _vertical_overlap_ratio(z1_lo: float, z1_hi: float, z2_lo: float, z2_hi: float) -> float:
    o = min(z1_hi, z2_hi) - max(z1_lo, z2_lo)
    if o <= 0:
        return 0.0
    h1 = z1_hi - z1_lo
    h2 = z2_hi - z2_lo
    smaller = min(h1, h2)
    if smaller <= 0:
        return 0.0
    return o / smaller


def _time_ranges_overlap(a0: int, a1: int, b0: int, b1: int) -> bool:
    return max(a0, b0) <= min(a1, b1)


def _trim_overlapping_sd_zones(
    zones: list[dict],
    index: pd.Index,
    overlap_ratio_min: float,
) -> None:
    """Starší zóna stejného typu se zkrátí před začátek mladší při ≥ překryvu ceny a času."""
    by_name: dict[str, list[dict]] = {"Demand": [], "Supply": []}
    for z in zones:
        n = z.get("name")
        if n in by_name:
            by_name[str(n)].append(z)
    for name in ("Demand", "Supply"):
        arr = sorted(by_name[name], key=lambda z: int(z.get("pivot_idx", 0)))
        for j in range(1, len(arr)):
            newer = arr[j]
            ns = int(newer.get("start_idx", 0))
            ne = int(newer.get("end_idx", ns))
            for i in range(j):
                older = arr[i]
                os_ = int(older.get("start_idx", 0))
                oe = int(older.get("end_idx", os_))
                if not _time_ranges_overlap(os_, oe, ns, ne):
                    continue
                r = _vertical_overlap_ratio(
                    float(older["value_low"]),
                    float(older["value_high"]),
                    float(newer["value_low"]),
                    float(newer["value_high"]),
                )
                if r >= overlap_ratio_min:
                    end_older = min(oe, ns - 1)
                    if end_older < os_:
                        end_older = os_
                    older["end_idx"] = end_older
                    older["date_end"] = _to_date_str(index[end_older])


def _annotate_demand_zones_below(zones: list[dict]) -> None:
    """Počet aktivních Demand zón hlouběji (nižší ceny) než tato zóna."""
    demands = [z for z in zones if z.get("name") == "Demand"]
    for z in demands:
        z_lo = float(z["value_low"])
        z_hi = float(z["value_high"])
        p0 = int(z.get("pivot_idx", 0))
        cnt = 0
        for o in demands:
            if o is z:
                continue
            if int(o.get("pivot_idx", -1)) == p0:
                continue
            o_hi = float(o["value_high"])
            o_s = int(o.get("start_idx", 0))
            o_e = int(o.get("end_idx", o_s))
            if o_e < o_s:
                continue
            if o_hi < z_lo:
                cnt += 1
        z["active_demand_zones_below"] = cnt


def _compute_zone_width_right(
    ohlc: pd.DataFrame,
    pivot_idx: int,
    zone_low: float,
    zone_high: float,
    max_bars: int,
    zone_type: str,
    atr_series: pd.Series,
    touch_vicinity_atr: float,
    major_swings: list[dict],
    far_consecutive_bars: int,
    far_atr_mult: float,
    major_protect_atr_mult: float,
    params: dict | None = None,
) -> tuple[int, bool, int | None, float | None]:
    """
    Vrátí (rightmost_idx, has_touch, touch_bar_idx | None, touch_marker_price | None).
    touch_* = svíčka registrovaného dotyku (Low u Demand, High u Supply) pro View.
    """
    p = params or {}
    try:
        touch_cooldown = max(0, int(p.get("zone_touch_departure_cooldown_bars", 6)))
    except (TypeError, ValueError):
        touch_cooldown = 6
    far_enabled = bool(int(p.get("zone_far_invalidate_enabled", 0)))
    try:
        dep_min_atr = float(p.get("zone_departure_min_atr", 0.25))
    except (TypeError, ValueError):
        dep_min_atr = 0.25
    if dep_min_atr < 0:
        dep_min_atr = 0.0

    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    close = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    rightmost = pivot_idx
    has_touch = False
    has_left_zone = False
    departure_idx: int | None = None
    touch_bar_idx: int | None = None
    touch_marker_price: float | None = None
    consecutive_far = 0

    for j in range(pivot_idx + 1, min(pivot_idx + max_bars + 1, n)):
        bar_close = float(close[j])
        bar_high = float(high[j])
        bar_low = float(low[j])
        atr_val = float(atr_series.iloc[min(j, n - 1)])
        if atr_val <= 0:
            atr_val = 1e-8

        far_kill = False
        if (
            far_enabled
            and far_consecutive_bars > 0
            and far_atr_mult > 0
        ):
            if zone_type == "Demand":
                is_far = bar_low > zone_high + far_atr_mult * atr_val
            else:
                is_far = bar_high < zone_low - far_atr_mult * atr_val
            if is_far and not _zone_near_major_structure(
                zone_low, zone_high, major_swings, atr_val, major_protect_atr_mult
            ):
                consecutive_far += 1
                if consecutive_far >= far_consecutive_bars:
                    cut = j - far_consecutive_bars
                    rightmost = max(pivot_idx, cut)
                    far_kill = True
            else:
                consecutive_far = 0
        if far_kill:
            break

        if zone_type == "Demand":
            dep_edge = zone_high + dep_min_atr * atr_val
            departed_now = bar_low > zone_high if dep_min_atr <= 0 else bar_low > dep_edge
            if departed_now:
                if departure_idx is None:
                    departure_idx = j
                has_left_zone = True
            if has_left_zone and bar_low <= zone_high:
                quick_corr = (
                    touch_cooldown > 0
                    and departure_idx is not None
                    and (j - departure_idx) <= touch_cooldown
                )
                if quick_corr:
                    has_left_zone = False
                    departure_idx = None
                    rightmost = j
                    continue
                margin = atr_val * touch_vicinity_atr
                prev_close = float(close[j - 1])
                if zone_low - margin <= prev_close <= zone_high + margin:
                    has_touch = True
                    touch_bar_idx = j
                    touch_marker_price = float(low[j])
                rightmost = min(j + 3, n - 1)
                break
            if bar_close < zone_low:
                rightmost = j - 1
                break
        else:
            dep_edge = zone_low - dep_min_atr * atr_val
            departed_now = bar_high < zone_low if dep_min_atr <= 0 else bar_high < dep_edge
            if departed_now:
                if departure_idx is None:
                    departure_idx = j
                has_left_zone = True
            if has_left_zone and bar_high >= zone_low:
                quick_corr = (
                    touch_cooldown > 0
                    and departure_idx is not None
                    and (j - departure_idx) <= touch_cooldown
                )
                if quick_corr:
                    has_left_zone = False
                    departure_idx = None
                    rightmost = j
                    continue
                margin = atr_val * touch_vicinity_atr
                prev_close = float(close[j - 1])
                if zone_low - margin <= prev_close <= zone_high + margin:
                    has_touch = True
                    touch_bar_idx = j
                    touch_marker_price = float(high[j])
                rightmost = min(j + 3, n - 1)
                break
            if bar_close > zone_high:
                rightmost = j - 1
                break

        rightmost = j
    return rightmost, has_touch, touch_bar_idx, touch_marker_price


def _collapse_swings_strict_hl_alternate(swings: list[dict]) -> list[dict]:
    """Stejná logika jako v Swing HL: po sobě HH/LL sloučit → striktní H-L-H-L."""
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


def _fallback_swings_from_three_bar_pivots(ohlc: pd.DataFrame) -> list[dict]:
    """
    Když zigzag z get_swings vrátí prázdné swingy (nesoulad TF/dat), 3-bar pivot H/L
    pro stejný tvar jako internály — View pak ukáže Swing HL a S/D má nohu pro pivot.
    """
    if ohlc is None or len(ohlc) < 3:
        return []
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    idx = ohlc.index
    out: list[dict] = []
    for i in range(1, len(ohlc) - 1):
        if high[i] > high[i - 1] and high[i] > high[i + 1]:
            out.append({"type": "high", "price": float(high[i]), "index": i, "timestamp": idx[i]})
        if low[i] < low[i - 1] and low[i] < low[i + 1]:
            out.append({"type": "low", "price": float(low[i]), "index": i, "timestamp": idx[i]})
    return _collapse_swings_strict_hl_alternate(sorted(out, key=lambda x: x["index"]))


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Swing pointy + Major Swing HL + Internal HL pro View.
    """
    _, get_swings, get_major_swings = _load_swing_hl_module()
    if get_swings is None:
        return []

    params = dict(params or {})
    hp = _params_for_hl_calls(params)
    hp["include_internals"] = True
    # Ve View chceme vidět běžné swingy i když leží „na“ majoru (BOS logika je jinde).
    hp["omit_swings_overlapping_major"] = False
    result = get_swings(ohlc, hp)
    if isinstance(result, dict):
        swings = result.get("swings", [])
        internals = result.get("internals", [])
        major_swings = result.get("major_swings", [])
        if not major_swings and get_major_swings:
            maj_params = {"timeframe": hp.get("timeframe", "1d"), "data_timeframe": hp.get("data_timeframe"), **hp}
            major_swings = get_major_swings(ohlc, maj_params)
    else:
        swings = result
        internals = []
        major_swings = []
        if get_major_swings:
            maj_params = {"timeframe": hp.get("timeframe", "1d"), "data_timeframe": hp.get("data_timeframe"), **hp}
            major_swings = get_major_swings(ohlc, maj_params)

    if not swings:
        swings = _fallback_swings_from_three_bar_pivots(ohlc)

    out: list[dict] = []
    for s in major_swings:
        ts = s.get("timestamp")
        date_str = _marker_iso_date(ts) if ts is not None else ""
        if date_str:
            out.append({"date": date_str, "type": s["type"], "value": float(s.get("price", 0))})
    for s in swings:
        ts = s.get("timestamp")
        date_str = _marker_iso_date(ts) if ts is not None else ""
        if date_str:
            out.append({
                "date": date_str,
                "type": s.get("type", "high"),
                "value": float(s.get("price", 0)),
            })
    for s in internals:
        ts = s.get("timestamp")
        date_str = _marker_iso_date(ts) if ts is not None else ""
        if date_str:
            out.append({
                "date": date_str,
                "type": f"internal_{s.get('type', 'high')}",
                "value": float(s.get("price", 0)),
            })
    return out


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict | None:
    """
    Trend z HL_identificator / Swing_HL — stejná logika jako v tom modulu (get_line → Trend).
    Ve View se zobrazí jako řada „HL trend“ vedle zón z get_zones, aby šlo kontrolovat shodu trendu a S/D.
    """
    fn = _load_swing_hl_get_line()
    if fn is None or ohlc is None or len(ohlc) < 2:
        return None
    p = _params_for_hl_calls(params)
    raw = fn(ohlc, p)
    if not isinstance(raw, dict):
        return None
    if "Trend" in raw:
        return {"HL trend": raw["Trend"]}
    return raw


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


def _volume_series(ohlc: pd.DataFrame) -> pd.Series | None:
    for col in ("volume", "Volume", "vol", "Vol"):
        if col not in ohlc.columns:
            continue
        s = pd.to_numeric(ohlc[col], errors="coerce")
        if s.notna().any() and float(s.fillna(0.0).abs().sum()) > 0.0:
            return s.fillna(0.0)
    return None


def _pivot_skip_volume_spike(
    pivot_idx: int,
    pivot_range: float,
    atr_val: float,
    vol_series: pd.Series | None,
    params: dict,
) -> bool:
    if not bool(int(params.get("pivot_volume_spike_skip_enabled", 1))):
        return False
    if vol_series is None or atr_val <= 1e-12:
        return False
    try:
        mult = float(params.get("pivot_volume_spike_mult", 3.5))
        lookback = int(params.get("pivot_volume_median_lookback", 30))
        min_rng_atr = float(params.get("pivot_volume_spike_min_range_atr", 1.0))
    except (TypeError, ValueError):
        mult, lookback, min_rng_atr = 3.5, 30, 1.0
    if mult <= 0 or lookback < 3:
        return False
    if pivot_range + 1e-12 < min_rng_atr * atr_val:
        return False
    lo = max(0, int(pivot_idx) - lookback)
    hi = int(pivot_idx)
    if hi <= lo:
        return False
    prev = vol_series.iloc[lo:hi]
    med = float(prev.median())
    if med <= 1e-9:
        return False
    try:
        v = float(vol_series.iloc[pivot_idx])
    except (TypeError, ValueError, IndexError):
        return False
    return v >= mult * med


def _pivot_zone_height_cap_atr_for_type(zone_type: str, params: dict) -> float:
    """Kladný násobek ATR pro strop výšky; Supply může mít vlastní užší cap."""
    try:
        generic = float(params.get("pivot_zone_height_cap_atr", 0) or 0)
    except (TypeError, ValueError):
        generic = 0.0
    if zone_type == "Supply":
        try:
            sp = float(params.get("pivot_zone_height_cap_atr_supply", 0) or 0)
        except (TypeError, ValueError):
            sp = 0.0
        if sp > 0:
            return sp
        return generic
    if zone_type == "Demand":
        try:
            dm = float(params.get("pivot_zone_height_cap_atr_demand", 0) or 0)
        except (TypeError, ValueError):
            dm = 0.0
        if dm > 0:
            return dm
        return generic
    return generic


def _clamp_pivot_zone_height(
    zone_low: float,
    zone_high: float,
    zone_type: str,
    atr_val: float,
    params: dict,
) -> tuple[float, float]:
    cap_atr = _pivot_zone_height_cap_atr_for_type(zone_type, params)
    if cap_atr <= 0 or atr_val <= 1e-12:
        return zone_low, zone_high
    h = zone_high - zone_low
    cap = cap_atr * atr_val
    if h <= cap + 1e-12:
        return zone_low, zone_high
    if zone_type == "Demand":
        return zone_low, zone_low + cap
    if zone_type == "Supply":
        return zone_high - cap, zone_high
    return zone_low, zone_high


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
    major_swings: list[dict] | None = None,
) -> int | None:
    """
    Pivot = bar s extrémem v momentum leg.
    Demand: min(low) od posledního swing low k BOS.
    Supply: max(high) od posledního swing high k BOS.
    Bez validního swingu v momentum leg zónu nevytváříme (žádný fallback bos_idx-30).
    """
    if bos_type == "bos_bullish":
        before = [s for s in swings if s["type"] == "low" and s["index"] < swing_idx]
        if not before and major_swings:
            before = [
                s for s in major_swings
                if s.get("type") == "major_low" and s["index"] < swing_idx
            ]
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
        if not before and major_swings:
            before = [
                s for s in major_swings
                if s.get("type") == "major_high" and s["index"] < swing_idx
            ]
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
) -> tuple[list[dict], int, int]:
    """
    Inducement = H/L (swing/internal/major) během pohybu od zóny – pasivní likvidita.
    Demand: hledáme lows; Supply: hledáme highs.
    Okno a vzdálenost od hranice zóny: pevné konstanty _INDUCEMENT_* (ne VIEW_PARAMS).
    Invalidation: 1) cena udělala nižší low (Demand) / vyšší high (Supply) než inducement;
                  2) novější inducement sáhl pod/nad starší.
    Vrací (inducements, inducement_count, inducement_points).
    inducement_count = počet míst, inducement_points = bodování (max 4).
    """
    max_dist_atr = _INDUCEMENT_MAX_DISTANCE_ATR
    max_bars = _INDUCEMENT_MAX_BARS
    search_end = min(pivot_idx + max_bars, rightmost, len(ohlc) - 1)
    search_start = pivot_idx + 1
    if search_end <= search_start:
        return [], 0, 0

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


def _atr_at_idx(atr_series: pd.Series, idx: int) -> float:
    n = int(len(atr_series))
    if n <= 0:
        return 0.0
    i = max(0, min(int(idx), n - 1))
    v = atr_series.iloc[i]
    try:
        return float(v) if pd.notna(v) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _zone_is_dominant_sd(z: dict, params: dict) -> bool:
    if bool(z.get("is_major")):
        return True
    try:
        mb = int(params.get("dominant_zone_min_base", 4))
    except (TypeError, ValueError):
        mb = 4
    if mb <= 0:
        return False
    try:
        bl = int(z.get("base_length") or 0)
    except (TypeError, ValueError):
        bl = 0
    return bl >= mb


def _sd_zone_key(z: dict) -> tuple[str, int, int]:
    return (
        str(z.get("name") or ""),
        int(z.get("pivot_idx", -1)),
        int(z.get("start_idx", -1)),
    )


def _drop_young_sd_near_dominant(
    zones: list[dict],
    atr_series: pd.Series,
    params: dict,
) -> list[dict]:
    if not bool(int(params.get("drop_young_near_dominant_enabled", 1))):
        return zones
    try:
        max_atr = float(params.get("young_near_dominant_max_atr", 1.25))
    except (TypeError, ValueError):
        max_atr = 1.25
    try:
        max_bar_gap = int(params.get("young_dominant_max_pivot_bar_gap", 400))
    except (TypeError, ValueError):
        max_bar_gap = 400
    if max_bar_gap < 0:
        max_bar_gap = 10**9

    def edges_near_supply(older: dict, younger: dict, atr_y: float) -> bool:
        thr = max_atr * max(atr_y, 1e-9)
        gap = abs(float(older["value_low"]) - float(younger["value_high"]))
        return gap <= thr

    def edges_near_demand(older: dict, younger: dict, atr_y: float) -> bool:
        thr = max_atr * max(atr_y, 1e-9)
        gap = abs(float(younger["value_low"]) - float(older["value_high"]))
        return gap <= thr

    supplies = [z for z in zones if z.get("name") == "Supply"]
    demands = [z for z in zones if z.get("name") == "Demand"]
    remove: set[tuple[str, int, int]] = set()

    for group, near_fn in ((supplies, edges_near_supply), (demands, edges_near_demand)):
        sorted_z = sorted(group, key=lambda zz: int(zz.get("pivot_idx", 0)))
        n = len(sorted_z)
        for j in range(n):
            z_y = sorted_z[j]
            if _zone_is_dominant_sd(z_y, params):
                continue
            pz = int(z_y.get("pivot_idx", 0))
            atr_z = _atr_at_idx(atr_series, pz)
            for i in range(j):
                d_o = sorted_z[i]
                if not _zone_is_dominant_sd(d_o, params):
                    continue
                pd = int(d_o.get("pivot_idx", 0))
                if pz <= pd:
                    continue
                if abs(pz - pd) > max_bar_gap:
                    continue
                if near_fn(d_o, z_y, atr_z):
                    remove.add(_sd_zone_key(z_y))
                    break

    if not remove:
        return zones
    return [z for z in zones if z.get("name") not in ("Demand", "Supply") or _sd_zone_key(z) not in remove]


def _filter_demands_low_rrr_vs_major_supply(
    zones: list[dict],
    atr_series: pd.Series,
    params: dict,
) -> list[dict]:
    if not bool(int(params.get("demand_drop_low_rrr_vs_major_supply_enabled", 1))):
        return zones
    try:
        min_rrr = float(params.get("demand_min_rrr_vs_major_supply", 1.5))
    except (TypeError, ValueError):
        min_rrr = 1.5
    try:
        max_pair_atr = float(params.get("demand_major_supply_max_atr", 4.0))
    except (TypeError, ValueError):
        max_pair_atr = 4.0

    supplies_major = [
        z
        for z in zones
        if z.get("name") == "Supply" and bool(z.get("is_major"))
    ]
    remove: set[tuple[str, int, int]] = set()

    for d in zones:
        if d.get("name") != "Demand":
            continue
        try:
            d_lo = float(d["value_low"])
            d_hi = float(d["value_high"])
        except (TypeError, ValueError, KeyError):
            continue
        risk = d_hi - d_lo
        if risk <= 1e-12:
            continue
        p = int(d.get("pivot_idx", 0))
        atr_d = _atr_at_idx(atr_series, p)
        scale = max(atr_d, 1e-9)

        best_g_atr: float | None = None
        best_s: dict | None = None
        for s in supplies_major:
            try:
                s_lo = float(s["value_low"])
            except (TypeError, ValueError, KeyError):
                continue
            if s_lo <= d_hi:
                continue
            gap = s_lo - d_hi
            g_atr = gap / scale
            if g_atr > max_pair_atr:
                continue
            if best_g_atr is None or g_atr < best_g_atr:
                best_g_atr = g_atr
                best_s = s

        if best_s is None:
            continue
        reward = float(best_s["value_low"]) - d_hi
        if reward <= 0:
            continue
        rrr = reward / risk
        if rrr + 1e-12 < min_rrr:
            remove.add(_sd_zone_key(d))

    if not remove:
        return zones
    return [z for z in zones if z.get("name") != "Demand" or _sd_zone_key(z) not in remove]


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    Supply/Demand zóny v-1.0 - BOS-based.
    Pivot = bar s extrémem v momentum leg (začátek pohybu), ne striktně opačná barva.
    Demand: pivot = bar s min(low) od swing low k BOS.
    Supply: pivot = bar s max(high) od swing high k BOS.
    """
    get_bos, get_swings, get_major_swings = _load_swing_hl_module()
    if get_bos is None or get_swings is None:
        return []

    params = params or {}
    hp = _params_for_hl_calls(params)
    threshold = _ZONE_EXTEND_LEFT_RANGE_RATIO
    body_threshold = _ZONE_EXTEND_LEFT_BODY_RATIO
    max_right_bars = int(params.get("zone_extend_right_bars", 60))
    effective_max_right = max(1, max_right_bars * 2)
    far_inv_bars = _ZONE_FAR_INVALIDATE_BARS
    far_inv_atr = _ZONE_FAR_INVALIDATE_ATR
    major_prot = _ZONE_MAJOR_PROTECT_ATR
    overlap_trim = float(params.get("zone_overlap_trim_ratio", 0.6))
    atr_period = int(params.get("atr_period", 10))
    touch_vicinity_atr = _ZONE_TOUCH_VICINITY_ATR
    min_bars_between = _ZONE_MIN_BARS_BETWEEN_SAME
    price_overlap_threshold = _ZONE_PRICE_OVERLAP_THRESHOLD
    max_pivot_range_atr = float(params.get("max_pivot_candle_range_atr", 5.0))

    high_col = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low_col = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    open_col = ohlc["open"] if "open" in ohlc.columns else ohlc["Open"]
    close_col = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    index = ohlc.index
    atr_series = _compute_atr(ohlc, atr_period)

    events = get_bos(ohlc, hp)
    if not events:
        return []

    swing_params = dict(hp)
    swing_params["include_internals"] = True
    swing_result = get_swings(ohlc, swing_params)
    if isinstance(swing_result, dict):
        swings = swing_result.get("swings", [])
        internals = swing_result.get("internals", [])
        major_swings = swing_result.get("major_swings", [])
        if not major_swings and get_major_swings:
            maj_params = {"timeframe": hp.get("timeframe", "1d"), "data_timeframe": hp.get("data_timeframe"), **hp}
            major_swings = get_major_swings(ohlc, maj_params)
    else:
        swings = swing_result
        internals = []
        major_swings = []
        if get_major_swings:
            maj_params = {"timeframe": hp.get("timeframe", "1d"), "data_timeframe": hp.get("data_timeframe"), **hp}
            major_swings = get_major_swings(ohlc, maj_params)

    if not swings:
        swings = _fallback_swings_from_three_bar_pivots(ohlc)

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
            ohlc, swings, bos_idx, swing_idx, ev["type"], high_col, low_col, major_swings
        )
        if pivot_idx is None:
            continue

        zone_low = float(low_col.iloc[pivot_idx])
        zone_high = float(high_col.iloc[pivot_idx])

        atr_ref = pivot_idx - 1 if pivot_idx > 0 else pivot_idx
        atr_val = float(atr_series.iloc[atr_ref]) if atr_ref < len(atr_series) else float(atr_series.iloc[-1])
        pivot_range = zone_high - zone_low
        vol_s = _volume_series(ohlc)
        if _pivot_skip_volume_spike(pivot_idx, pivot_range, atr_val, vol_s, params):
            continue

        if ev["type"] == "bos_bullish":
            zone_type = "Demand"
        elif ev["type"] == "bos_bearish":
            zone_type = "Supply"
        else:
            continue

        zone_low, zone_high = _clamp_pivot_zone_height(zone_low, zone_high, zone_type, atr_val, params)
        cap_atr = _pivot_zone_height_cap_atr_for_type(zone_type, params)
        if max_pivot_range_atr > 0 and cap_atr <= 0:
            pr_after = zone_high - zone_low
            if atr_val > 1e-12 and pr_after > max_pivot_range_atr * atr_val:
                continue

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

        rightmost, has_touch, touch_bi, touch_mp = _compute_zone_width_right(
            ohlc,
            pivot_idx,
            zone_low,
            zone_high,
            effective_max_right,
            zone_type,
            atr_series,
            touch_vicinity_atr,
            major_swings,
            far_inv_bars,
            far_inv_atr,
            major_prot,
            params,
        )

        if ev["type"] == "bos_bullish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = _compute_base_width(ohlc, pivot_idx, zone_low, zone_high, rightmost, params)
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Demand",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            inducements, inducement_count, inducement_points = _find_inducements(
                ohlc, zone_low, zone_high, pivot_idx, rightmost, "Demand",
                swings, internals, major_swings, atr_series,
            )
            fill = "rgba(34, 197, 94, 0.35)" if has_touch else "rgba(34, 197, 94, 0.25)"
            zone_dict: dict = {
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "start_idx": leftmost,
                "end_idx": rightmost,
                "pivot_idx": int(pivot_idx),
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
            if has_touch and touch_bi is not None and touch_mp is not None:
                zone_dict["touch_bar_index"] = int(touch_bi)
                zone_dict["touch_marker_price"] = float(touch_mp)
                zone_dict["touch_date"] = _marker_iso_date(index[touch_bi])
            zones.append(zone_dict)
            added_sd.append((pivot_idx, zone_low, zone_high, "Demand"))
        elif ev["type"] == "bos_bearish":
            leftmost = _compute_zone_width(ohlc, pivot_idx, zone_low, zone_high, threshold, body_threshold)
            base_length = _compute_base_width(ohlc, pivot_idx, zone_low, zone_high, rightmost, params)
            impulse_score = _compute_impulse_score(
                ohlc, pivot_idx, bos_idx, "Supply",
                high_col, low_col, open_col, close_col, atr_series, atr_period,
            )
            inducements, inducement_count, inducement_points = _find_inducements(
                ohlc, zone_low, zone_high, pivot_idx, rightmost, "Supply",
                swings, internals, major_swings, atr_series,
            )
            fill = "rgba(239, 68, 68, 0.35)" if has_touch else "rgba(239, 68, 68, 0.25)"
            zone_dict = {
                "date_start": _to_date_str(index[leftmost]),
                "date_end": _to_date_str(index[rightmost]),
                "start_idx": leftmost,
                "end_idx": rightmost,
                "pivot_idx": int(pivot_idx),
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
            if has_touch and touch_bi is not None and touch_mp is not None:
                zone_dict["touch_bar_index"] = int(touch_bi)
                zone_dict["touch_marker_price"] = float(touch_mp)
                zone_dict["touch_date"] = _marker_iso_date(index[touch_bi])
            zones.append(zone_dict)
            added_sd.append((pivot_idx, zone_low, zone_high, "Supply"))

    _append_major_proximity_chop_zones(
        ohlc,
        zones,
        major_swings,
        params,
        atr_series,
        index,
        high_col,
        low_col,
        open_col,
        close_col,
        swings,
        internals,
        threshold,
        body_threshold,
        effective_max_right,
        touch_vicinity_atr,
        far_inv_bars,
        far_inv_atr,
        major_prot,
        min_bars_between,
        price_overlap_threshold,
        atr_period,
    )

    max_base = int(params.get("max_base_length", 0))
    if max_base > 0:
        zones = [
            z
            for z in zones
            if z.get("name") not in ("Demand", "Supply")
            or int(z.get("base_length") or 0) <= max_base
        ]

    if 0 < overlap_trim <= 1.0:
        _trim_overlapping_sd_zones(zones, index, overlap_trim)
    zones = _drop_young_sd_near_dominant(zones, atr_series, params)
    zones = _filter_demands_low_rrr_vs_major_supply(zones, atr_series, params)
    _annotate_demand_zones_below(zones)

    for z in zones:
        if z.get("name") not in ("Demand", "Supply"):
            continue
        zt = "Demand" if z["name"] == "Demand" else "Supply"
        pi = int(z["pivot_idx"])
        ri = int(z["end_idx"])
        ind, ic, ip = _find_inducements(
            ohlc,
            float(z["value_low"]),
            float(z["value_high"]),
            pi,
            ri,
            zt,
            swings,
            internals,
            major_swings,
            atr_series,
        )
        z["inducements"] = ind
        z["inducement_count"] = ic
        z["inducement_points"] = ip

    if bool(int(params.get("require_inducement", 0))):
        zones = [
            z
            for z in zones
            if z.get("name") not in ("Demand", "Supply")
            or int(z.get("inducement_count") or 0) > 0
        ]

    zones = _filter_zones_by_trend_window(ohlc, zones, params)

    return zones
