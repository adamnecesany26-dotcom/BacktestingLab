# -*- coding: utf-8 -*-
"""
S/D Zone Strategy – zóny na vyšším TF (výchozí 1D), vstup/výstup na exekučním TF (výchozí 30m).

Vyžaduje moduly: swing/BOS (HL_identificator nebo Swing_HL) + S/D zóny (S_D_Zones nebo SD_identificator).
Pořadí výběru swingu je stejné jako v modulu S/D: nejdřív HL_identificator, pak Swing_HL. V panelu Moduly vyber oba a potvrď.
Instrument: např. futures_30m/NQ.txt (30m bary); zóny se počítají z resamplovaného OHLC.

MTF: `zone_timeframes` = čárkou oddělené TF (např. "1w,1d"); překryvy stejného typu se slučují,
    `prefer_higher_tf` vybere geometrii z hrubšího nebo jemnějšího TF.

Pravidla:
- Nejdřív cena musí zónu „opustit“ (Demand: low > zone_high; Supply: high < zone_low na exekučním baru).
- Poté limit podle `entry_mode` (hranice / střed / procento výšky zóny).
- Čekající limit se NERUŠÍ jen proto, že modul zkrátil end_idx — pouze při invalidaci close na TF zóny,
  max. počet exekučních barů bez fillu, nebo vyplnění.
- TP: snapshot opposing zóny / major swing v okamžiku armování; R:R 1.5–4.0.
- Stop: pod zónou (Demand) / nad zónou (Supply) + stop_width_extra_pct × výška zóny + stop_buffer_pct × výška.

Exekuce (zjednodušení vs. reálný order book):
- Volání get_zones dostane `zone_extend_right_bars` přepsané z `zone_max_bars` (parametr strategie řídí životnost zóny v modulu).
- Limitní vstupy bez explicitního spreadu v této strategii — globální slippage/spread z nastavení simulace platí obecně, ne model „limit u bid/ask“.
- Výstup z pozice: jeden bar OHLC; pokud high/low protne cíl i stop ve stejném baru, rozhodnutí neodpovídá pořadí ticků uvnitř baru (viz _check_exit).
"""

from __future__ import annotations

import copy
import importlib
from collections import deque

import backtrader as bt
import pandas as pd

# Stejná priorita swing modulu jako v examples/sd_zones._load_swing_hl_module:
# HL_identificator před Swing_HL (při dvou kopiích v modules/ jeden zdroj BOS/swingů).
_SWING_PKGS = ("HL_identificator", "Swing_HL")
_ZONE_PKGS = ("S_D_Zones", "SD_identificator")

get_major_swings = None
get_zones = None
for _swing_pkg in _SWING_PKGS:
    for _zone_pkg in _ZONE_PKGS:
        try:
            _sm = importlib.import_module(f"modules.{_swing_pkg}")
            _zm = importlib.import_module(f"modules.{_zone_pkg}")
        except ImportError:
            continue
        _gm = getattr(_sm, "get_major_swings", None)
        _gz = getattr(_zm, "get_zones", None)
        if _gm is not None and _gz is not None:
            get_major_swings = _gm
            get_zones = _gz
            break
    if get_major_swings is not None:
        break


# --- Parametry zóny (shoda s VIEW_PARAMS modulu S/D + obchodní parametry) ---
PARAMS = {
    "zone_timeframe": "1d",
    "zone_timeframes": "1d",
    "prefer_higher_tf": True,
    "exec_timeframe": "30m",
    "entry_mode": "edge",
    "entry_pct": 0.5,
    "min_rr_zone": 1.5,
    "min_rr_swing": 1.5,
    "fallback_rr": 2.0,
    "max_rr": 4.0,
    "zone_max_bars": 60,
    "max_hold_bars": 48,
    "max_limit_bars_exec": 80,
    "stop_width_extra_pct": 0.10,
    "stop_buffer_pct": 0.0,
    "max_zone_age_bars": 0,
    "allow_zones_with_touch": True,
    "min_impulse_score": 0,
    "max_impulse_score": 0,
    "min_inducement_points": 0,
    "max_inducement_points": 0,
    "max_base_length": 0,
    "base_bar_range_in_zone_min": 0.40,
    "base_zone_height_covered_min": 0.80,
    "base_body_in_zone_min": 0.60,
    "atr_period": 10,
    "atr_multiplier": 1.2,
    "min_bars_between_swings": 3,
    "max_bars": 180,
    "acceptance_bars": 1,
    "zone_overlap_threshold": 0.33,
    "zone_body_overlap_threshold": 0.10,
    "zone_extend_right_bars": 60,
    "zone_min_bars_between_same": 7,
    "zone_price_overlap_threshold": 0.25,
    "zone_touch_vicinity_atr": 0.5,
    "inducement_max_distance_atr": 2.0,
    "inducement_max_bars": 40,
    "zone_far_invalidate_bars": 15,
    "zone_far_invalidate_atr": 5.0,
    "zone_major_protect_atr": 2.5,
    "zone_overlap_trim_ratio": 0.6,
}


_TF_TO_RULE = {
    "1d": "1D",
    "1D": "1D",
    "daily": "1D",
    "4h": "4h",
    "1h": "1h",
    "30m": "30min",
    "15m": "15min",
    "1w": "1W",
    "1W": "1W",
    "weekly": "1W",
}

_TF_COARSENESS = {
    "1w": 100,
    "1W": 100,
    "weekly": 100,
    "1d": 90,
    "1D": 90,
    "daily": 90,
    "4h": 70,
    "1h": 60,
    "30m": 50,
    "30min": 50,
    "15m": 40,
    "15min": 40,
}


def _pandas_rule_for_zone_tf(zone_tf: str) -> str:
    z = (zone_tf or "1d").strip()
    return _TF_TO_RULE.get(z, _TF_TO_RULE.get(z.lower(), "1D"))


def _tf_coarseness(tf: str) -> int:
    s = (tf or "1d").strip()
    return int(_TF_COARSENESS.get(s, _TF_COARSENESS.get(s.lower(), 50)))


def _parse_zone_timeframes(params) -> list[str]:
    ts = getattr(params, "zone_timeframes", None)
    if ts is not None and str(ts).strip():
        parts = [p.strip() for p in str(ts).split(",") if p.strip()]
        if parts:
            return parts
    zt = getattr(params, "zone_timeframe", None) or "1d"
    z = str(zt).strip()
    return [z] if z else ["1d"]


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


def _resample_to_zone_tf(exec_df: pd.DataFrame, zone_tf: str) -> pd.DataFrame:
    if exec_df.empty:
        return exec_df
    rule = _pandas_rule_for_zone_tf(zone_tf)
    agg = {
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
    }
    out = exec_df.resample(rule, label="left", closed="left").agg(agg).dropna(how="any")
    return out


def _merged_zone_key(z: dict, primary_tf: str, merged_tfs: list[str]) -> str:
    zl, zh = float(z["value_low"]), float(z["value_high"])
    nm = z.get("name", "")
    tfs = ",".join(sorted(merged_tfs))
    return f"{nm}|{primary_tf}|{tfs}|{zl:.6g}|{zh:.6g}"


def _zones_price_overlap_ratio(z1: dict, z2: dict) -> float:
    zl1, zh1 = float(z1["value_low"]), float(z1["value_high"])
    zl2, zh2 = float(z2["value_low"]), float(z2["value_high"])
    w1, w2 = zh1 - zl1, zh2 - zl2
    if w1 <= 0 or w2 <= 0:
        return 0.0
    ov = max(0.0, min(zh1, zh2) - max(zl1, zl2))
    return ov / min(w1, w2)


def _cluster_tagged_zones(
    tagged: list[tuple[dict, str, int]], name: str, overlap_threshold: float
) -> list[list[tuple[dict, str, int]]]:
    same = [(z, tf, d) for z, tf, d in tagged if z.get("name") == name]
    clusters: list[list[tuple[dict, str, int]]] = []
    used: set[int] = set()
    for i, item in enumerate(same):
        if i in used:
            continue
        cl = [item]
        used.add(i)
        growing = True
        while growing:
            growing = False
            for j, item2 in enumerate(same):
                if j in used:
                    continue
                z2 = item2[0]
                for zc, _, _ in cl:
                    if _zones_price_overlap_ratio(zc, z2) >= overlap_threshold:
                        cl.append(item2)
                        used.add(j)
                        growing = True
                        break
        clusters.append(cl)
    return clusters


def _pick_cluster_representative(
    cluster: list[tuple[dict, str, int]], prefer_higher_tf: bool
) -> tuple[dict, str, int]:
    def key(item: tuple[dict, str, int]) -> int:
        c = _tf_coarseness(item[1])
        return -c if prefer_higher_tf else c

    best = min(cluster, key=key)
    return best


def _build_merged_sd_zones(
    exec_df: pd.DataFrame,
    timeframes: list[str],
    get_zones_fn,
    module_params_fn,
    prefer_higher_tf: bool,
    overlap_threshold: float,
) -> tuple[list[dict], list[dict]]:
    """
    Vrátí (merged_zone_dicts, flat_all_sd_for_targets).
    Každá merged zóna má _primary_tf, _merged_tfs, _d_idx (index posledního baru na daném TF).
    """
    tagged: list[tuple[dict, str, int]] = []
    flat_sd: list[dict] = []
    for tf in timeframes:
        zoh = _resample_to_zone_tf(exec_df, tf)
        if zoh.empty or len(zoh) < 30:
            continue
        mp = module_params_fn(tf)
        zones = get_zones_fn(zoh, mp)
        d_idx = len(zoh) - 1
        for z in zones:
            if z.get("name") not in ("Demand", "Supply"):
                continue
            flat_sd.append(z)
            si, ei = z.get("start_idx"), z.get("end_idx")
            if si is None or ei is None:
                continue
            if int(si) <= d_idx <= int(ei):
                zc = dict(z)
                tagged.append((zc, tf, d_idx))

    merged: list[dict] = []
    for nm in ("Demand", "Supply"):
        for cluster in _cluster_tagged_zones(tagged, nm, overlap_threshold):
            rep_z, rep_tf, rep_d = _pick_cluster_representative(cluster, prefer_higher_tf)
            merged_tfs = sorted({t for _, t, _ in cluster})
            out = dict(rep_z)
            out["_primary_tf"] = rep_tf
            out["_merged_tfs"] = merged_tfs
            out["_d_idx"] = rep_d
            merged.append(out)
    return merged, flat_sd


def _limit_entry_price(is_long: bool, zl: float, zh: float, mode: str, pct: float) -> float:
    span = zh - zl
    m = (mode or "edge").strip().lower()
    if m == "mid":
        return (zl + zh) / 2.0
    if m == "pct":
        p = max(0.0, min(1.0, float(pct)))
        return zl + span * p
    return zh if is_long else zl


def _stop_outside_zone(
    is_long: bool,
    zl: float,
    zh: float,
    stop_width_extra_pct: float,
    stop_buffer_pct: float,
) -> float:
    h = zh - zl
    extra = h * float(stop_width_extra_pct)
    buf = h * float(stop_buffer_pct)
    if is_long:
        return zl - extra - buf
    return zh + extra + buf


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
    return True


def _daily_invalidates(zone: dict, daily_close: float) -> bool:
    zl = float(zone["value_low"])
    zh = float(zone["value_high"])
    if zone.get("name") == "Demand":
        return daily_close < zl
    if zone.get("name") == "Supply":
        return daily_close > zh
    return False


def _compute_target_demand(
    entry: float,
    stop: float,
    zones: list[dict],
    major_swings: list[dict],
    min_rr_zone: float,
    min_rr_swing: float,
    fallback_rr: float,
) -> float:
    risk = entry - stop
    if risk <= 0:
        return entry + abs(risk) * fallback_rr
    supply_zones = [z for z in zones if z.get("name") == "Supply"]
    candidates = [z for z in supply_zones if float(z.get("value_low", 0)) > entry]
    if candidates:
        nearest = min(candidates, key=lambda z: float(z["value_low"]))
        target = float(nearest["value_low"])
        if (target - entry) / risk >= min_rr_zone:
            return target
    if major_swings:
        highs = [s for s in major_swings if s.get("type") == "major_high"]
        above = [s for s in highs if float(s.get("price", 0)) > entry]
        if above:
            nearest = min(above, key=lambda s: float(s["price"]))
            target = float(nearest["price"])
            if (target - entry) / risk >= min_rr_swing:
                return target
    return entry + risk * fallback_rr


def _compute_target_supply(
    entry: float,
    stop: float,
    zones: list[dict],
    major_swings: list[dict],
    min_rr_zone: float,
    min_rr_swing: float,
    fallback_rr: float,
) -> float:
    risk = stop - entry
    if risk <= 0:
        return entry - abs(risk) * fallback_rr
    demand_zones = [z for z in zones if z.get("name") == "Demand"]
    candidates = [z for z in demand_zones if float(z.get("value_high", 0)) < entry]
    if candidates:
        nearest = max(candidates, key=lambda z: float(z["value_high"]))
        target = float(nearest["value_high"])
        if (entry - target) / risk >= min_rr_zone:
            return target
    if major_swings:
        lows = [s for s in major_swings if s.get("type") == "major_low"]
        below = [s for s in lows if float(s.get("price", 0)) < entry]
        if below:
            nearest = max(below, key=lambda s: float(s["price"]))
            target = float(nearest["price"])
            if (entry - target) / risk >= min_rr_swing:
                return target
    return entry - risk * fallback_rr


class Strategy(bt.Strategy):
    params = (
        ("zone_timeframe", "1d"),
        ("zone_timeframes", "1d"),
        ("prefer_higher_tf", True),
        ("exec_timeframe", "30m"),
        ("entry_mode", "edge"),
        ("entry_pct", 0.5),
        ("min_rr_zone", 1.5),
        ("min_rr_swing", 1.5),
        ("fallback_rr", 2.0),
        ("max_rr", 4.0),
        ("zone_max_bars", 60),
        ("max_hold_bars", 48),
        ("max_limit_bars_exec", 80),
        ("stop_width_extra_pct", 0.10),
        ("stop_buffer_pct", 0.0),
        ("max_zone_age_bars", 0),
        ("allow_zones_with_touch", True),
        ("min_impulse_score", 0),
        ("max_impulse_score", 0),
        ("min_inducement_points", 0),
        ("max_inducement_points", 0),
        ("max_base_length", 0),
        ("base_bar_range_in_zone_min", 0.40),
        ("base_zone_height_covered_min", 0.80),
        ("base_body_in_zone_min", 0.60),
        ("atr_period", 10),
        ("atr_multiplier", 1.2),
        ("min_bars_between_swings", 3),
        ("max_bars", 180),
        ("acceptance_bars", 1),
        ("zone_overlap_threshold", 0.33),
        ("zone_body_overlap_threshold", 0.10),
        ("zone_extend_right_bars", 60),
        ("zone_min_bars_between_same", 7),
        ("zone_price_overlap_threshold", 0.25),
        ("zone_touch_vicinity_atr", 0.5),
        ("inducement_max_distance_atr", 2.0),
        ("inducement_max_bars", 40),
        ("zone_far_invalidate_bars", 15),
        ("zone_far_invalidate_atr", 5.0),
        ("zone_major_protect_atr", 2.5),
        ("zone_overlap_trim_ratio", 0.6),
        ("module_params", {}),
    )

    def __init__(self):
        self._entry_price = None
        self._stop_price = None
        self._target_price = None
        self._entry_zone_key = None
        self._stop_order = None
        self._entry_bar = 0
        self._pending_orders: list = []
        self._zone_track: dict[str, dict] = {}
        self._trade_meta_queue: deque = deque()
        self._last_zone_ohlc: pd.DataFrame = pd.DataFrame()

    def _sd_module_params_for_tf(self, zone_tf: str) -> dict:
        """Sloučí nested module_params z UI a ploché parametry strategie; timeframe = zone_tf.

        Hodnota zone_extend_right_bars předaná do modulu je vždy přepsána z params.zone_max_bars
        (UI pole zone_extend_right_bars u modulu v backtestu tím pro výpočet zón neplatí).
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
            "zone_overlap_threshold",
            "zone_body_overlap_threshold",
            "zone_extend_right_bars",
            "zone_min_bars_between_same",
            "zone_price_overlap_threshold",
            "zone_touch_vicinity_atr",
            "inducement_max_distance_atr",
            "inducement_max_bars",
            "zone_far_invalidate_bars",
            "zone_far_invalidate_atr",
            "zone_major_protect_atr",
            "zone_overlap_trim_ratio",
            "base_bar_range_in_zone_min",
            "base_zone_height_covered_min",
            "base_body_in_zone_min",
        ]
        for k in keys:
            v = getattr(self.params, k, None)
            p[k] = v if v is not None else p.get(k)
        p["timeframe"] = zone_tf
        p["data_timeframe"] = zone_tf
        p["zone_extend_right_bars"] = int(self.params.zone_max_bars)
        return p

    def _coarsest_tf(self, timeframes: list[str]) -> str:
        if not timeframes:
            return "1d"
        return max(timeframes, key=_tf_coarseness)

    def decorate_trade_record(self, d: dict, trade) -> dict:
        if self._trade_meta_queue:
            meta = self._trade_meta_queue.popleft()
            out = dict(d)
            out["zoneMeta"] = meta
            return out
        return d

    def notify_order(self, order):
        if order.status in (order.Canceled, order.Margin, order.Rejected):
            if order == self._stop_order:
                self._stop_order = None
            self._pending_orders = [(o, zk, e, s, t, il, meta) for o, zk, e, s, t, il, meta in self._pending_orders if o is not order]
            for zk, st in list(self._zone_track.items()):
                if st.get("order") is order:
                    st["order"] = None
                    st["state"] = "watch_departure"
                    st["departed"] = False
                    st["armed"] = False
            return
        if order.status != order.Completed:
            return
        if order == self._stop_order:
            self._stop_order = None
            self._reset_trade()
            return

        exec_price = getattr(getattr(order, "executed", None), "price", None) or 0.0
        i = None
        for j, row in enumerate(self._pending_orders):
            o = row[0]
            if o is order:
                i = j
                break
        if i is None and exec_price:
            for j, row in enumerate(self._pending_orders):
                _, _, entry, *_ = row
                if abs(entry - exec_price) / max(entry, 1e-9) < 0.005:
                    i = j
                    break
        if i is not None:
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
                self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop)
            else:
                self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop)
            if zone_key in self._zone_track:
                del self._zone_track[zone_key]

    def next(self):
        if get_zones is None or get_major_swings is None:
            return

        if self.position.size != 0:
            self._check_exit()
            return

        exec_df = _get_exec_ohlc_df(self)
        if exec_df.empty or len(exec_df) < 10:
            return

        tfs = _parse_zone_timeframes(self.params)
        coarse = self._coarsest_tf(tfs)
        zone_ohlc_coarse = _resample_to_zone_tf(exec_df, coarse)
        self._last_zone_ohlc = zone_ohlc_coarse
        if zone_ohlc_coarse.empty or len(zone_ohlc_coarse) < 30:
            return

        overlap_th = float(self.params.zone_price_overlap_threshold)
        merged_zones, flat_sd = _build_merged_sd_zones(
            exec_df,
            tfs,
            get_zones,
            self._sd_module_params_for_tf,
            bool(self.params.prefer_higher_tf),
            overlap_th,
        )

        mp_coarse = self._sd_module_params_for_tf(coarse)
        maj_params = {"timeframe": mp_coarse.get("timeframe", coarse), **mp_coarse}
        major_swings = get_major_swings(zone_ohlc_coarse, maj_params) if get_major_swings else []

        snap_zones = copy.deepcopy(flat_sd)

        seen_sd_keys: set[str] = set()
        for z in merged_zones:
            primary_tf = z.get("_primary_tf", tfs[0])
            merged_tfs = list(z.get("_merged_tfs") or [primary_tf])
            d_idx = int(z.get("_d_idx", len(_resample_to_zone_tf(exec_df, primary_tf)) - 1))
            zk = _merged_zone_key(z, primary_tf, merged_tfs)
            seen_sd_keys.add(zk)
            if not _zone_passes_trade_filters(self, z, d_idx):
                continue
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
                }
            elif zk in self._zone_track:
                st = self._zone_track[zk]
                st["zone"] = dict(z)
                st["primary_tf"] = primary_tf
                st["merged_tfs"] = merged_tfs

        bar_high = float(self.data.high[0])
        bar_low = float(self.data.low[0])

        for zk, st in list(self._zone_track.items()):
            z = st["zone"]
            zl, zh = float(z["value_low"]), float(z["value_high"])
            primary_tf = st.get("primary_tf") or tfs[0]
            zoh_tf = _resample_to_zone_tf(exec_df, primary_tf)
            if zoh_tf.empty:
                del self._zone_track[zk]
                continue
            daily_close = float(zoh_tf["close"].iloc[-1])

            if _daily_invalidates(z, daily_close):
                o = st.get("order")
                if o and o.status in (o.Submitted, o.Accepted):
                    self.cancel(o)
                del self._zone_track[zk]
                continue

            if st["state"] == "watch_departure":
                if st["is_long"]:
                    if bar_low > zh:
                        st["departed"] = True
                    if st["departed"] and not st.get("armed"):
                        st["armed"] = True
                        entry = _limit_entry_price(
                            True,
                            zl,
                            zh,
                            str(self.params.entry_mode),
                            float(self.params.entry_pct),
                        )
                        stop = _stop_outside_zone(
                            True,
                            zl,
                            zh,
                            self.params.stop_width_extra_pct,
                            self.params.stop_buffer_pct,
                        )
                        target = _compute_target_demand(
                            entry,
                            stop,
                            snap_zones,
                            copy.deepcopy(major_swings),
                            self.params.min_rr_zone,
                            self.params.min_rr_swing,
                            self.params.fallback_rr,
                        )
                        risk = entry - stop
                        if risk > 0:
                            target = min(target, entry + risk * self.params.max_rr)
                        order = self.buy(size=1, exectype=bt.Order.Limit, price=entry)
                        piv = int(z.get("pivot_idx", z.get("end_idx", 0)))
                        d_idx = int(z.get("_d_idx", len(zoh_tf) - 1))
                        meta = {
                            "zoneKey": zk,
                            "zoneName": z.get("name"),
                            "primaryTf": primary_tf,
                            "mergedTfs": st.get("merged_tfs"),
                            "baseLength": z.get("base_length"),
                            "impulseScore": z.get("impulse_score"),
                            "inducementCount": z.get("inducement_count"),
                            "inducementPoints": z.get("inducement_points"),
                            "hasTouch": z.get("has_touch"),
                            "hasGap": z.get("has_gap"),
                            "zoneAgeBars": d_idx - piv,
                            "pivotIdx": piv,
                            "entryMode": str(self.params.entry_mode),
                            "entryPct": float(self.params.entry_pct),
                            "entryLimit": entry,
                            "stopPrice": stop,
                            "targetPrice": target,
                            "zoneTimeframes": ",".join(tfs),
                            "execTimeframe": self.params.exec_timeframe,    
                        }
                        self._pending_orders.append((order, zk, entry, stop, target, True, meta))
                        st["state"] = "pending_limit"
                        st["order"] = order
                        st["armed_exec_bar"] = len(self)
                else:
                    if bar_high < zl:
                        st["departed"] = True
                    if st["departed"] and not st.get("armed"):
                        st["armed"] = True
                        entry = _limit_entry_price(
                            False,
                            zl,
                            zh,
                            str(self.params.entry_mode),
                            float(self.params.entry_pct),
                        )
                        stop = _stop_outside_zone(
                            False,
                            zl,
                            zh,
                            self.params.stop_width_extra_pct,
                            self.params.stop_buffer_pct,
                        )
                        target = _compute_target_supply(
                            entry,
                            stop,
                            snap_zones,
                            copy.deepcopy(major_swings),
                            self.params.min_rr_zone,
                            self.params.min_rr_swing,
                            self.params.fallback_rr,
                        )
                        risk = stop - entry
                        if risk > 0:
                            target = max(target, entry - risk * self.params.max_rr)
                        order = self.sell(size=1, exectype=bt.Order.Limit, price=entry)
                        piv = int(z.get("pivot_idx", z.get("end_idx", 0)))
                        d_idx = int(z.get("_d_idx", len(zoh_tf) - 1))
                        meta = {
                            "zoneKey": zk,
                            "zoneName": z.get("name"),
                            "primaryTf": primary_tf,
                            "mergedTfs": st.get("merged_tfs"),
                            "baseLength": z.get("base_length"),
                            "impulseScore": z.get("impulse_score"),
                            "inducementCount": z.get("inducement_count"),
                            "inducementPoints": z.get("inducement_points"),
                            "hasTouch": z.get("has_touch"),
                            "hasGap": z.get("has_gap"),
                            "zoneAgeBars": d_idx - piv,
                            "pivotIdx": piv,
                            "entryMode": str(self.params.entry_mode),
                            "entryPct": float(self.params.entry_pct),
                            "entryLimit": entry,
                            "stopPrice": stop,
                            "targetPrice": target,
                            "zoneTimeframes": ",".join(tfs),
                            "execTimeframe": self.params.exec_timeframe,
                        }
                        self._pending_orders.append((order, zk, entry, stop, target, False, meta))
                        st["state"] = "pending_limit"
                        st["order"] = order
                        st["armed_exec_bar"] = len(self)

            elif st["state"] == "pending_limit":
                ab = st.get("armed_exec_bar")
                if ab is not None and (len(self) - ab) >= int(self.params.max_limit_bars_exec):
                    o = st.get("order")
                    if o and o.status in (o.Submitted, o.Accepted):
                        self.cancel(o)
                    del self._zone_track[zk]

    def _check_exit(self):
        if self._stop_price is None or self._target_price is None:
            if self._recover_stop_target():
                pass
            else:
                self.close()
                self._reset_trade()
            return

        bar_high = float(self.data.high[0])
        bar_low = float(self.data.low[0])
        bars_held = len(self) - self._entry_bar

        if bars_held >= self.params.max_hold_bars:
            if self._stop_order:
                self.cancel(self._stop_order)
                self._stop_order = None
            self.close()
            self._reset_trade()
            return

        if self.position.size > 0:
            if bar_high >= self._target_price or bar_low <= self._stop_price:
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._reset_trade()
        else:
            if bar_high >= self._stop_price or bar_low <= self._target_price:
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._reset_trade()

    def _recover_stop_target(self) -> bool:
        if get_zones is None or get_major_swings is None:
            return False
        entry = float(self.position.price)
        is_long = self.position.size > 0
        exec_df = _get_exec_ohlc_df(self)
        tfs = _parse_zone_timeframes(self.params)
        coarse = self._coarsest_tf(tfs)
        zone_ohlc = _resample_to_zone_tf(exec_df, coarse)
        if zone_ohlc.empty or len(zone_ohlc) < 30:
            return False
        mp = self._sd_module_params_for_tf(coarse)
        maj_params = {"timeframe": mp.get("timeframe", coarse), **mp}
        major_swings = get_major_swings(zone_ohlc, maj_params) if get_major_swings else []
        _, flat_sd = _build_merged_sd_zones(
            exec_df,
            tfs,
            get_zones,
            self._sd_module_params_for_tf,
            bool(self.params.prefer_higher_tf),
            float(self.params.zone_price_overlap_threshold),
        )
        zones = flat_sd
        tol = 0.02
        mode = str(self.params.entry_mode).strip().lower()
        pct = float(self.params.entry_pct)

        for z in zones:
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
            ref_entry = _limit_entry_price(z.get("name") == "Demand", zl, zh, mode, pct)
            if abs(entry - ref_entry) > margin and not (zl - margin <= entry <= zh + margin):
                continue
            extra_h = zh0 * float(self.params.stop_width_extra_pct)
            buf = zh0 * float(self.params.stop_buffer_pct)
            if z.get("name") == "Demand" and is_long:
                stop = zl - extra_h - buf
                target = _compute_target_demand(
                    entry,
                    stop,
                    zones,
                    major_swings,
                    self.params.min_rr_zone,
                    self.params.min_rr_swing,
                    self.params.fallback_rr,
                )
                risk = entry - stop
                if risk > 0:
                    target = min(target, entry + risk * self.params.max_rr)
                self._entry_price = entry
                self._stop_price = stop
                self._target_price = target
                self._entry_bar = len(self)
                size = abs(int(self.position.size))
                self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop)
                return True
            if z.get("name") == "Supply" and not is_long:
                stop = zh + extra_h + buf
                target = _compute_target_supply(
                    entry,
                    stop,
                    zones,
                    major_swings,
                    self.params.min_rr_zone,
                    self.params.min_rr_swing,
                    self.params.fallback_rr,
                )
                risk = stop - entry
                if risk > 0:
                    target = max(target, entry - risk * self.params.max_rr)
                self._entry_price = entry
                self._stop_price = stop
                self._target_price = target
                self._entry_bar = len(self)
                size = abs(int(self.position.size))
                self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop)
                return True
        return False

    def _reset_trade(self):
        self._entry_price = None
        self._stop_price = None
        self._target_price = None
        self._entry_zone_key = None
        self._stop_order = None
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
