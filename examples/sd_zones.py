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
    "active_demand_zones_below" (Demand), inducement s "index"; životnost vpravo = 2× zone_extend_right_bars + far-invalidate + střih při překryvu.
  base_length: počet barů v konsolidaci (OR: base_bar_range_in_zone_min + base_zone_height_covered_min + base_body_in_zone_min ve VIEW_PARAMS).

VIEW_PARAMS musí být bez inline komentářů za hodnotami (např. NE: 1.0, #x) — parser ve View maže komentář
a může odstranit čárku mezi klíči; komentáře jen na samostatných řádcích nad blokem nebo mimo dict.

Pravidla S/D v-1.0 (viz SD_def.md):
- Demand: bullish BOS + pivot = bar s min(low) v momentum leg (od swing low k BOS)
- Supply: bearish BOS + pivot = bar s max(high) v momentum leg (od swing high k BOS)
- Výška zóny: H/L pivot svíčky
- Šířka vlevo: prodloužení doleva, pokud předchozí svíčka má ≥33% H-L v zóně A ≥10% těla v zóně
- Šířka vpravo: 2× zone_extend_right_bars; close invalidace; dotyk; daleko od zóny (ATR + výjimka u Major HL); střih při ≥60 % překryvu se stejným typem
- V podobném místě a blízkém čase nesmí vzniknout 2 zóny stejného typu
"""

import importlib
import pandas as pd
from typing import Any


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


VIEW_PARAMS = {
    "timeframe": "1d",
    "data_timeframe": "",
    "zone_extend_right_bars": 60,
    "zone_overlap_threshold": 0.33,
    "zone_body_overlap_threshold": 0.10,
    "zone_touch_vicinity_atr": 0.5,
    "inducement_max_distance_atr": 2.0,
    "inducement_max_bars": 40,
    "base_bar_range_in_zone_min": 0.40,
    "base_zone_height_covered_min": 0.80,
    "base_body_in_zone_min": 0.60,
    "max_base_length": 0,
    "zone_far_invalidate_bars": 15,
    "zone_far_invalidate_atr": 5.0,
    "zone_major_protect_atr": 2.5,
    "zone_overlap_trim_ratio": 0.6,
}

VIEW_PARAMS_META = {
    "timeframe": {
        "title": "Časový rámec zón a struktury",
        "whatItMeans": "Na tomto timeframe se počítají swingy, BOS a z toho S/D zóny. U jemných dat (např. 30m) dává smysl 1d nebo 4h, aby nebyl šum na každé svíčce.",
        "howToUse": ["Shoda s tím, jak „čteš“ graf ručně — stejný TF jako u tvé analýzy supply/demand."],
    },
    "data_timeframe": {
        "title": "Velikost baru vstupních dat",
        "whatItMeans": "Říká modulu, jak jsou rozestupy skutečných OHLC, které dostane (čas mezi bary). Ve View by měl odpovídat agregaci grafu: při zobrazení 1D svíček má být typicky 1d, i když soubor je 30m — frontend to tak posílá. Jinak Swing HL může vrátit prázdné běžné swingy.",
    },
    "zone_extend_right_bars": {
        "title": "Životnost zóny doprava (počet barů)",
        "whatItMeans": "Jak dlouho (v bodech grafu = počtem svíček aktuálního grafu) může zóna pokračovat doprava, dokud ji neukončí invalidace nebo pravidla dotyku. Vyšší číslo = zóna déle „visí“ v budoucnu.",
        "howToUse": ["Na denním grafu 60 = zhruba 60 obchodních dní; na 30m přepočítej podle toho, co považuješ za rozumné okno pro reakci na zónu."],
    },
    "zone_overlap_threshold": {
        "title": "Prodlužování zóny doleva — podíl knotu v pásku",
        "whatItMeans": "Když jdeš od pivotu doleva, přidává se sousední svíčka jen pokud dostatečný díl jejího rozpětí high–low leží uvnitř výšky zóny. Vyšší hodnota = přísnější, užší zóna doleva.",
    },
    "zone_body_overlap_threshold": {
        "title": "Prodlužování doleva — podíl těla v pásku",
        "whatItMeans": "Stejné prodlužování vlevo, ale kouká se na tělo svíčky (open–close). Musí platit současně s podmínkou výše (knot i tělo).",
    },
    "zone_touch_vicinity_atr": {
        "title": "Dotyk zóny (násobek ATR)",
        "whatItMeans": "Před vyražením BOS musí být „dotyk“ zóny: předchozí close musí být blízko hranice zóny, blízkost se měří jako tento násobek ATR. Nižší = přísnější dotyk, vyšší = tolerantnější.",
    },
    "inducement_max_distance_atr": {
        "title": "Inducement — max. vzdálenost od zóny (× ATR)",
        "whatItMeans": "Inducement je hledaný extrém (high/low) krátce po odchodu ceny od zóny. Tento parametr omezuje, jak daleko od hranice zóny smí být (v násobcích ATR).",
    },
    "inducement_max_bars": {
        "title": "Inducement — max. počet barů od pivotu",
        "whatItMeans": "Inducement se hledá jen v prvních N svíčkách po pivotu zóny. Zabrání tomu, aby se zařadily staré úrovně z daleké minulosti.",
    },
    "base_bar_range_in_zone_min": {
        "title": "Co počítáme jako součást base (konsolidace) — podíl rozpětí H–L",
        "whatItMeans": "Svíčka patří do šířky base kolem pivotu, pokud je splněno alespoň jedno: (1) tento podíl rozpětí H–L leží v zóně, NEBO (2) průnik H–L pokrývá aspoň podíl výšky zóny dle base_zone_height_covered_min, NEBO (3) aspoň podíl těla v zóně dle base_body_in_zone_min.",
        "howToUse": ["Snižuješ-li toto číslo, přidá se víc svíček do base; zvedáš-li, base bývá kratší."],
    },
    "base_zone_height_covered_min": {
        "title": "Base — min. podíl pokrytí výšky zóny knotem (H–L)",
        "whatItMeans": "Alternativní pravidlo: svíčka se započte do šířky base, pokud její rozpětí high–low pokrývá alespoň tento podíl výšky zóny (vedle base_bar_range_in_zone_min a base_body_in_zone_min).",
    },
    "base_body_in_zone_min": {
        "title": "Base — min. podíl těla (open–close) uvnitř zóny",
        "whatItMeans": "Alternativní pravidlo: svíčka se započte do base, pokud alespoň tento podíl těla leží uvnitř výšky zóny.",
    },
    "max_base_length": {
        "title": "Filtr: max. délka base (0 = vypnuto)",
        "whatItMeans": "Pokud je větší než 0, ve výstupu zůstanou jen Demand/Supply zóny, jejichž base má nejvýše tolik svíček. Slouží k odhození příliš roztažených „pásů“. Nula = žádný filtr. BOS čáry ve výstupu tento filtr neovlivní — můžeš tedy vidět BOS, ale žádné D/S, pokud je limit moc přísný.",
    },
    "zone_far_invalidate_bars": {
        "title": "Vyřazení zóny — po sobě jdoucí bary „daleko od zóny“",
        "whatItMeans": "Když je cena po tuto dobu souvisle velmi nad zónou (Demand) / pod zónou (Supply) v jednotkách ATR, zóna se ukončí — trend pravděpodobně nepřivede cenu zpět. Výjimka: zóna v blízkosti Major Swing HL.",
    },
    "zone_far_invalidate_atr": {
        "title": "Co je „daleko“ (× ATR od hranice zóny)",
        "whatItMeans": "Demand: low celé svíčky musí být výš než zone_high + tento násobek ATR. Supply symetricky dolů od zone_low.",
    },
    "zone_major_protect_atr": {
        "title": "Ochrana u Major HL (× ATR)",
        "whatItMeans": "Pokud je cena některého major swing high/low do této vzdálenosti (v ATR) od výšky zóny, pravidlo „daleko od zóny“ zónu neukončí.",
    },
    "zone_overlap_trim_ratio": {
        "title": "Střih při překryvu zón (0–1)",
        "whatItMeans": "Dvě zóny stejného typu: pokud se jejich cenové pásmo překrývá alespoň v tomto poměru vůči nižší zóny (výška), starší zóna končí těsně před začátkem mladší (časově).",
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
    zone_height_cover_min: float,
    body_in_zone_min: float,
) -> bool:
    """
    Svíčka patří do base (konsolidace), pokud platí alespoň jedno:
    (A) ≥ range_in_zone_min podílu jejího H–L leží v [zone_low, zone_high]
    (B) průnik H–L se zónou pokrývá ≥ zone_height_cover_min výšky zóny
    (C) ≥ body_in_zone_min těla leží v zóně
    """
    zl, zh = zone_low, zone_high
    h_zone = zh - zl
    if h_zone <= 0:
        return False

    ov_lo = max(zl, bar_low)
    ov_hi = min(zh, bar_high)
    ov = max(0.0, ov_hi - ov_lo)

    bar_range = bar_high - bar_low
    if bar_range > 1e-12 and (ov / bar_range) >= range_in_zone_min:
        return True
    if (ov / h_zone) >= zone_height_cover_min:
        return True

    body_lo = min(bar_open, bar_close)
    body_hi = max(bar_open, bar_close)
    body_len = body_hi - body_lo
    if body_len > 1e-12:
        b_ov_lo = max(zl, body_lo)
        b_ov_hi = min(zh, body_hi)
        b_ov = max(0.0, b_ov_hi - b_ov_lo)
        if (b_ov / body_len) >= body_in_zone_min:
            return True
    return False


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
    zone_height_cover_min = float(params.get("base_zone_height_covered_min", 0.80))
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
            zone_height_cover_min,
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
) -> tuple[int, bool, int | None, float | None]:
    """
    Vrátí (rightmost_idx, has_touch, touch_bar_idx | None, touch_marker_price | None).
    touch_* = svíčka registrovaného dotyku (Low u Demand, High u Supply) pro View.
    """
    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    close = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    rightmost = pivot_idx
    has_touch = False
    has_left_zone = False
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
        if far_consecutive_bars > 0 and far_atr_mult > 0:
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
            if bar_low > zone_high:
                has_left_zone = True
            if has_left_zone and bar_low <= zone_high:
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
            if bar_high < zone_low:
                has_left_zone = True
            if has_left_zone and bar_high >= zone_low:
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
    params["include_internals"] = True
    # Ve View chceme vidět běžné swingy i když leží „na“ majoru (BOS logika je jinde).
    params["omit_swings_overlapping_major"] = False
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
    params: dict,
) -> tuple[list[dict], int, int]:
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
    threshold = float(params.get("zone_overlap_threshold", 0.33))
    body_threshold = float(params.get("zone_body_overlap_threshold", 0.10))
    max_right_bars = int(params.get("zone_extend_right_bars", 60))
    effective_max_right = max(1, max_right_bars * 2)
    far_inv_bars = int(params.get("zone_far_invalidate_bars", 15))
    far_inv_atr = float(params.get("zone_far_invalidate_atr", 5.0))
    major_prot = float(params.get("zone_major_protect_atr", 2.5))
    overlap_trim = float(params.get("zone_overlap_trim_ratio", 0.6))
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
                swings, internals, major_swings, atr_series, params,
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
                swings, internals, major_swings, atr_series, params,
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
            params,
        )
        z["inducements"] = ind
        z["inducement_count"] = ic
        z["inducement_points"] = ip

    return zones
