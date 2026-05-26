# -*- coding: utf-8 -*-
"""
ORB hybrid dle ``strategies/orb/orb-reference.md`` (spec verze dokumentu 1.0).

**Verze 2 strategie v repozitáři** — oddělená od ``orb_prop_firm_killer`` (verze 1, Pine parity).

Implementované body specifikace (zjednodušení v závorkách):
- §2 Režimy ``standard`` | ``gap_and_go`` (gap_and_go: jen gap-up dny, jinak skip).
- §2.1 standard: OR délka parametrem, směr z první OR svíčky, doji = žádný obchod.
  Vstup: průraz OR high/low; výchozí stop-vstup na hraně, fill při průrazu (stejná rodina jako TV intrabar);
  *konzervativní* varianta: ``entry_next_open`` = vstup na **open následujícího baru** po trigger baru.
- §2.2 gap_and_go: min gap %, delší OR (30 m), long only, optional objem vs ADV na break baru.
- §3 Universe: min cena, min průměrný denní objem (proxy z historie), synthetic max spread gate.
- §4 Kalendář: dny v týdnu; VIX a makro dny jen pokud jsou zapnuty a dodány parametry (jinak se nefiltruje).
- §5 Relativní objem OR; false-break kill (pod OR low u longa / nad OR high u shorta v ``N`` min).
- §6 Strukturální stop (OR opačná hranice) + **ATR cap** na vzdálenost stopu; sizing ``pos_mode`` / ``contracts`` nebo ``risk_pct`` (sdílená utilita s v1).
- §7 TP ``profit_target_r`` × R nebo časový exit před závěrem; gap_and_go TP = ``k_or_range`` × šířka OR.
- §8 Náklady: přes broker/UI engine — zde jen volitelný spread gate.

Není to 1:1 Pine skript; je to věrná *referenční* Python logika k markdown spec.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from strategies.orb_prop_firm_killer.orb_core import (
    BarCmd,
    in_session,
    lim_at_r,
    ny_minute_of_bar_open,
    parse_session_edges,
    qty_for_risk,
    true_range,
    utc_bar_open_to_ny,
    wilder_atr,
)


def _daily_atr_from_state(trs: list[float], period: int) -> float | None:
    if len(trs) < period:
        return None
    return wilder_atr(trs, period)


def _parse_skip_macro(param: str) -> set[str]:
    out: set[str] = set()
    for part in (param or "").split(","):
        s = part.strip()
        if s:
            out.add(s[:10])
    return out


@dataclass
class RefOrbState:
    cur_ny_date: object | None = None
    daily_trs: list[float] = field(default_factory=list)
    daily_vols: list[float] = field(default_factory=list)
    daily_closes: list[float] = field(default_factory=list)
    prev_day_close: float | None = None

    cur_d_o: float | None = None
    cur_d_h: float | None = None
    cur_d_l: float | None = None
    cur_d_c: float | None = None
    cur_d_v: float = 0.0

    day_skip: bool = False
    long_only_day: bool = False
    or_minutes_today: int = 5

    orb_high: float | None = None
    orb_low: float | None = None
    orb_start_ts: pd.Timestamp | None = None
    orb_building: bool = False
    orb_building_prev: bool = False
    orb_ready: bool = False
    first_candle_dir: int = 0
    first_open: float | None = None
    or_first_hi: float | None = None
    or_first_lo: float | None = None
    or_last_close: float | None = None
    or_vol_today: float = 0.0
    or_vol_hist: list[float] = field(default_factory=list)
    rel_vol: float | None = None

    session_open: float | None = None

    day_start_equity: float = 0.0
    session_start_closed: int = 0

    phase: str = "idle"  # idle | wait_trigger | wait_next_open | in_pos
    pending_side: int = 0
    pending_trigger_ts: pd.Timestamp | None = None
    pending_break_volume: float = 0.0

    order_armed: bool = False
    entry_avg: float | None = None
    entry_ts: pd.Timestamp | None = None
    initial_stop: float | None = None
    stop_distance: float | None = None
    tp_px: float | None = None
    entry_qty_plan: float | None = None

    or_low_at_entry: float | None = None
    or_high_at_entry: float | None = None

    partial_1r_done: bool = False

    _prev_in_sess: bool = field(default=False, repr=False)


def _finalize_day_ref(st: RefOrbState, p: dict) -> None:
    if st.cur_ny_date is None or st.cur_d_c is None:
        return
    if st.prev_day_close is not None:
        tr = true_range(float(st.cur_d_h or 0), float(st.cur_d_l or 0), float(st.prev_day_close))
        st.daily_trs.append(tr)
    st.daily_vols.append(float(st.cur_d_v))
    st.daily_closes.append(float(st.cur_d_c))
    cap = int(p.get("atr_len", 14) or 14) + 30
    st.daily_trs = st.daily_trs[-cap:]
    st.daily_vols = st.daily_vols[-cap:]
    st.daily_closes = st.daily_closes[-cap:]
    st.prev_day_close = float(st.cur_d_c)


def _avg_vol_prev(st: RefOrbState, lookback: int = 14) -> float | None:
    vs = st.daily_vols
    if len(vs) < lookback + 1:
        return None
    return float(sum(vs[-(lookback + 1) : -1]) / lookback)


def step_orb_reference(
    st: RefOrbState,
    p: dict,
    ts_utc,
    o: float,
    h: float,
    l: float,
    c: float,
    v: float,
    equity: float,
    closed_trades: int,
    position_size: float,
    *,
    record_view: bool = False,
    view_zones: list[dict] | None = None,
    view_lines: list[dict] | None = None,
    view_markers: list[dict] | None = None,
) -> list[BarCmd]:
    cmds: list[BarCmd] = []
    pos = float(position_size)
    ts_ny = utc_bar_open_to_ny(ts_utc)
    smin, emin = parse_session_edges(str(p.get("session", "0930-1600")))
    in_sess = in_session(ts_ny, smin, emin)
    prev_in = st._prev_in_sess
    new_session = in_sess and not prev_in
    session_end = not in_sess and prev_in
    st._prev_in_sess = in_sess

    time_exit_before = int(p.get("time_exit_minutes_before_close", 15) or 15)
    time_exit_min = max(0, emin - time_exit_before)
    time_flat = in_sess and ny_minute_of_bar_open(ts_ny) >= time_exit_min

    strat_mode = str(p.get("strat_mode", "standard") or "standard")
    or_std = int(p.get("or_minutes_standard", 5) or 5)
    or_gap = int(p.get("or_minutes_gap", 30) or 30)
    gap_min = float(p.get("gap_min_pct", 2.0) or 0.0)
    atr_len = int(p.get("atr_len", 14) or 14)
    atr_mult = float(p.get("atr_mult_cap", 1.0) or 1.0)
    profit_r = float(p.get("profit_target_r", 10.0) or 10.0)
    k_or = float(p.get("k_or_range", 2.0) or 2.0)
    close_confirm = bool(p.get("close_break_confirm", False))
    entry_next_open = bool(p.get("entry_next_open", True))
    false_break_min = int(p.get("false_break_exit_minutes", 30) or 0)
    vol_adv_frac = float(p.get("vol_adv_fraction", 0.5) or 0.0)
    require_break_vol = bool(p.get("require_break_volume", False))
    or_buffer = float(p.get("or_break_buffer", 0.0) or 0.0)
    relaxed = bool(p.get("relaxed_bt", False))
    max_spread = float(p.get("max_spread_pct", 0.0) or 0.0)
    assumed_spread = float(p.get("assume_spread_pct", 0.0) or 0.0)
    use_partial_1r = bool(p.get("use_partial_1r", True))
    partial_1r_qty = int(p.get("partial_1r_qty", 1) or 0)
    partial_1r_r = float(p.get("partial_1r_r", 1.0) or 1.0)
    min_contracts_ladder = float(p.get("min_contracts_ladder", 2.0) or 2.0)

    d = ts_ny.date()
    if st.cur_ny_date != d:
        if st.cur_ny_date is not None:
            _finalize_day_ref(st, p)
        st.cur_ny_date = d
        st.cur_d_o = float(o)
        st.cur_d_h = float(h)
        st.cur_d_l = float(l)
        st.cur_d_c = float(c)
        st.cur_d_v = float(v)
        st.day_skip = False
        st.long_only_day = False
        st.or_minutes_today = or_std
        st.session_open = float(o)
        st.phase = "idle"
        st.pending_side = 0
        st.pending_trigger_ts = None
        st.order_armed = False
        st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
        st.entry_ts = None
        st.or_low_at_entry = st.or_high_at_entry = None
        st.partial_1r_done = False
        st.day_start_equity = float(equity)
        st.session_start_closed = int(closed_trades)

        st.orb_high = st.orb_low = st.orb_start_ts = None
        st.orb_building = st.orb_building_prev = False
        st.orb_ready = False
        st.first_candle_dir = 0
        st.first_open = float(o)
        st.or_first_hi = float(h)
        st.or_first_lo = float(l)
        st.or_last_close = None
        st.or_vol_today = 0.0

        if strat_mode == "gap_and_go":
            if st.prev_day_close is None or abs(float(st.prev_day_close)) < 1e-12:
                st.day_skip = True
            else:
                gap_pct = (float(o) - float(st.prev_day_close)) / abs(float(st.prev_day_close)) * 100.0
                if gap_pct < gap_min or gap_pct <= 0:
                    st.day_skip = True
                else:
                    st.long_only_day = True
                    st.or_minutes_today = or_gap
    else:
        st.cur_d_h = max(float(st.cur_d_h or o), float(h))
        st.cur_d_l = min(float(st.cur_d_l or o), float(l))
        st.cur_d_c = float(c)
        st.cur_d_v += float(v)

    daily_atr = _daily_atr_from_state(st.daily_trs, atr_len)
    avg_vol_prev = _avg_vol_prev(st, 14)

    daily_open = float(st.cur_d_o) if st.cur_d_o is not None else None
    price_ok = (not bool(p.get("use_uni"))) or (
        daily_open is not None and daily_open >= float(p.get("min_price", 5.0) or 0.0)
    )
    vol_ok = (not bool(p.get("use_uni"))) or (
        avg_vol_prev is not None and avg_vol_prev >= float(p.get("min_avg_vol", 500_000) or 0.0)
    )
    universe_ok = price_ok and vol_ok

    use_rv = bool(p.get("use_rel_vol"))
    rv_ok = (not use_rv) or (st.rel_vol is not None and st.rel_vol >= float(p.get("rel_vol_min", 2.0) or 0.0))

    dow = ts_ny.weekday()
    dow_ok = (not bool(p.get("use_dow"))) or (
        (dow == 0 and p.get("dow_mon", True))
        or (dow == 1 and p.get("dow_tue", False))
        or (dow == 2 and p.get("dow_wed", True))
        or (dow == 3 and p.get("dow_thu", False))
        or (dow == 4 and p.get("dow_fri", True))
    )

    skip_macro = _parse_skip_macro(str(p.get("skip_macro_dates", "") or ""))
    iso = str(ts_ny.date())
    macro_ok = iso not in skip_macro

    use_vix = bool(p.get("use_vix_gate", False))
    vix_val = p.get("vix_series_value")
    try:
        vx = float(vix_val) if vix_val is not None and vix_val != "" else None
    except (TypeError, ValueError):
        vx = None
    vix_ok = (not use_vix) or (
        vx is not None
        and vx >= float(p.get("vix_min", 15.0) or 0.0)
        and vx <= float(p.get("vix_max", 25.0) or 1e9)
    )

    gate = (
        (relaxed or (universe_ok and macro_ok and vix_ok))
        and dow_ok
        and rv_ok
        and (not st.day_skip)
    )

    trades_today = int(closed_trades) - int(st.session_start_closed) + (1 if pos != 0 else 0)
    max_tr = int(p.get("max_trades", 1) or 1)
    trade_ok = trades_today < max_tr

    if new_session and st.orb_start_ts is None and in_sess and not st.day_skip:
        st.orb_high = float(h)
        st.orb_low = float(l)
        st.orb_start_ts = ts_ny
        st.orb_ready = False

    om = st.or_minutes_today
    if st.orb_start_ts is not None and in_sess:
        dt_sec = (ts_ny - st.orb_start_ts).total_seconds()
        st.orb_building = bool(dt_sec < om * 60)
    else:
        st.orb_building = False

    if st.orb_building:
        st.orb_high = max(float(st.orb_high or h), float(h))
        st.orb_low = min(float(st.orb_low or l), float(l))
        st.or_vol_today += float(v)
        st.or_last_close = float(c)

    orb_just = st.orb_building_prev and not st.orb_building
    if orb_just:
        st.orb_ready = True
        oc = st.or_last_close
        fo = float(st.first_open or o)
        if oc is not None:
            if float(oc) > fo:
                st.first_candle_dir = 1
            elif float(oc) < fo:
                st.first_candle_dir = -1
            else:
                st.first_candle_dir = 0
        if st.or_vol_hist:
            avg = sum(st.or_vol_hist) / max(1, len(st.or_vol_hist))
            st.rel_vol = float(st.or_vol_today) / avg if avg > 0 else 1.0
        else:
            st.rel_vol = 1.0
        st.or_vol_hist.append(float(st.or_vol_today))
        cap = int(p.get("rel_vol_back", 14) or 14)
        while len(st.or_vol_hist) > cap:
            st.or_vol_hist.pop(0)
        if record_view and view_zones is not None and st.orb_start_ts is not None and st.orb_high is not None:
            view_zones.append(
                {
                    "date_start": st.orb_start_ts.tz_convert("UTC").isoformat(),
                    "date_end": ts_ny.tz_convert("UTC").isoformat(),
                    "value_low": float(st.orb_low or 0),
                    "value_high": float(st.orb_high or 0),
                    "fillcolor": "rgba(56,189,248,0.35)",
                    "name": "ORB (ref)",
                }
            )

    st.orb_building_prev = bool(st.orb_building)

    def structural_stop_price(is_long: bool) -> float | None:
        if st.orb_high is None or st.orb_low is None:
            return None
        return float(st.orb_low) if is_long else float(st.orb_high)

    def effective_stop_dist(entry: float, is_long: bool) -> float | None:
        s0 = structural_stop_price(is_long)
        if s0 is None:
            return None
        d_struct = abs(float(entry) - float(s0))
        cap = float("inf")
        if daily_atr is not None and atr_mult > 0:
            cap = atr_mult * float(daily_atr)
        d = min(d_struct, cap) if math.isfinite(cap) else d_struct
        tick = float(p.get("tick_size", 0.25) or 0.25)
        return max(d, tick)

    def contracts_for_risk(entry: float, stop_px: float) -> float:
        per_sh = abs(float(entry) - float(stop_px))
        if per_sh <= 0:
            return 0.0
        q = qty_for_risk(p, float(entry), float(stop_px), float(equity))
        if float(q) <= 0:
            return 0.0
        if use_partial_1r and partial_1r_qty > 0:
            q = max(float(q), float(partial_1r_qty) + 1.0)
            q = max(float(q), min_contracts_ladder)
        return float(q)

    def tp_for_mode(is_long: bool, entry: float, sd: float) -> float:
        if strat_mode == "gap_and_go" and st.orb_high is not None and st.orb_low is not None:
            w = abs(float(st.orb_high) - float(st.orb_low))
            tgt = float(entry) + k_or * w if is_long else float(entry) - k_or * w
            return tgt
        return float(entry) + profit_r * sd if is_long else float(entry) - profit_r * sd

    # --- forced flatten: session end or time stop (spec §7) ---
    if session_end or time_flat:
        st.phase = "idle"
        st.pending_side = 0
        st.pending_trigger_ts = None
        st.order_armed = False
    if (session_end or time_flat) and pos != 0:
        cmds.append(BarCmd("close_all", reason="time_or_session"))
        pos = 0.0
        st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
        st.entry_ts = None
        st.or_low_at_entry = st.or_high_at_entry = None
        st.partial_1r_done = False

    # --- SL / TP / false-break (před branami vstupu; »gate« nesmí blokovat výstup) ---
    if pos > 0 and st.entry_avg is not None and st.initial_stop is not None:
        stop0 = float(st.initial_stop)
        if float(l) <= stop0:
            cmds.append(BarCmd("close_long", qty=abs(pos), price=stop0))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False
        elif (
            false_break_min > 0
            and st.or_low_at_entry is not None
            and st.entry_ts is not None
            and (ts_ny - st.entry_ts).total_seconds() <= false_break_min * 60
            and float(l) < float(st.or_low_at_entry)
        ):
            cmds.append(BarCmd("close_all", reason="false_break"))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False
        elif (
            use_partial_1r
            and partial_1r_qty > 0
            and (not st.partial_1r_done)
            and float(pos) > float(partial_1r_qty) + 1e-9
        ):
            lp = lim_at_r(True, float(st.entry_avg), stop0, partial_1r_r)
            if float(h) >= lp:
                qtk = min(float(partial_1r_qty), pos)
                cmds.append(BarCmd("sell_limit", qty=qtk, price=lp))
                pos -= qtk
                st.partial_1r_done = True
        elif st.tp_px is not None and float(h) >= float(st.tp_px):
            cmds.append(BarCmd("close_long", qty=abs(pos), price=float(st.tp_px)))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False

    elif pos < 0 and st.entry_avg is not None and st.initial_stop is not None:
        stop0 = float(st.initial_stop)
        apos = abs(float(pos))
        if float(h) >= stop0:
            cmds.append(BarCmd("close_short", qty=apos, price=stop0))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False
        elif (
            false_break_min > 0
            and st.or_high_at_entry is not None
            and st.entry_ts is not None
            and (ts_ny - st.entry_ts).total_seconds() <= false_break_min * 60
            and float(h) > float(st.or_high_at_entry)
        ):
            cmds.append(BarCmd("close_all", reason="false_break"))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False
        elif (
            use_partial_1r
            and partial_1r_qty > 0
            and (not st.partial_1r_done)
            and apos > float(partial_1r_qty) + 1e-9
        ):
            lp = lim_at_r(False, float(st.entry_avg), stop0, partial_1r_r)
            if float(l) <= lp:
                qtk = min(float(partial_1r_qty), apos)
                cmds.append(BarCmd("buy_limit", qty=qtk, price=lp))
                pos += qtk
                st.partial_1r_done = True
        elif st.tp_px is not None and float(l) <= float(st.tp_px):
            cmds.append(BarCmd("close_short", qty=abs(pos), price=float(st.tp_px)))
            pos = 0.0
            st.phase = "idle"
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False

    if not in_sess:
        if pos == 0 and (session_end or new_session):
            st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
            st.entry_ts = None
            st.or_low_at_entry = st.or_high_at_entry = None
            st.partial_1r_done = False
            if st.phase == "in_pos":
                st.phase = "idle"
        return cmds

    if st.day_skip or not st.orb_ready or st.first_candle_dir == 0:
        return cmds

    if not gate or not trade_ok:
        if st.phase == "wait_next_open":
            st.phase = "idle"
            st.pending_side = 0
            st.pending_trigger_ts = None
        return cmds

    oh = float(st.orb_high or 0)
    ol = float(st.orb_low or 0)
    allow_long = st.first_candle_dir == 1 and (not st.long_only_day or st.long_only_day)
    allow_short = st.first_candle_dir == -1 and not st.long_only_day

    long_trig = (float(c) > oh + or_buffer) if close_confirm else (float(h) >= oh + or_buffer)
    short_trig = (float(c) < ol - or_buffer) if close_confirm else (float(l) <= ol - or_buffer)

    vol_break_ok = True
    if require_break_vol and avg_vol_prev is not None and avg_vol_prev > 0:
        vol_break_ok = float(v) >= vol_adv_frac * float(avg_vol_prev)

    spread_ok = max_spread <= 0 or assumed_spread <= max_spread

    if pos == 0 and st.phase == "wait_next_open" and st.pending_side != 0 and spread_ok:
        is_long = st.pending_side == 1
        entry = float(o)
        sd = effective_stop_dist(entry, is_long)
        if sd is None or sd <= 0:
            st.phase = "idle"
            st.pending_side = 0
            return cmds
        stop_px = float(entry) - sd if is_long else float(entry) + sd
        qty = contracts_for_risk(entry, stop_px)
        if qty <= 0:
            st.phase = "idle"
            st.pending_side = 0
            return cmds
        tp = tp_for_mode(is_long, entry, sd)
        cmds.append(BarCmd("market_buy" if is_long else "market_sell", qty=qty, price=entry))
        st.entry_avg = entry
        st.initial_stop = stop_px
        st.stop_distance = sd
        st.tp_px = tp
        st.entry_qty_plan = qty
        st.entry_ts = ts_ny
        st.or_low_at_entry = ol
        st.or_high_at_entry = oh
        st.phase = "in_pos"
        st.pending_side = 0
        st.pending_trigger_ts = None
        return cmds

    if (
        pos == 0
        and st.phase == "idle"
        and allow_long
        and long_trig
        and vol_break_ok
        and spread_ok
    ):
        if entry_next_open:
            st.phase = "wait_next_open"
            st.pending_side = 1
            st.pending_trigger_ts = ts_ny
            st.pending_break_volume = float(v)
        else:
            entry = float(c) if close_confirm else float(oh + or_buffer)
            sd = effective_stop_dist(entry, True)
            if sd and sd > 0:
                stop_px = float(entry) - sd
                qty = contracts_for_risk(entry, stop_px)
                if qty > 0:
                    tp = tp_for_mode(True, entry, sd)
                    cmds.append(BarCmd("market_buy", qty=qty, price=entry))
                    st.entry_avg = entry
                    st.initial_stop = stop_px
                    st.stop_distance = sd
                    st.tp_px = tp
                    st.entry_qty_plan = qty
                    st.entry_ts = ts_ny
                    st.or_low_at_entry = ol
                    st.or_high_at_entry = oh
                    st.phase = "in_pos"
        return cmds

    if (
        pos == 0
        and st.phase == "idle"
        and allow_short
        and short_trig
        and vol_break_ok
        and spread_ok
    ):
        if entry_next_open:
            st.phase = "wait_next_open"
            st.pending_side = -1
            st.pending_trigger_ts = ts_ny
            st.pending_break_volume = float(v)
        else:
            entry = float(c) if close_confirm else float(ol - or_buffer)
            sd = effective_stop_dist(entry, False)
            if sd and sd > 0:
                stop_px = float(entry) + sd
                qty = contracts_for_risk(entry, stop_px)
                if qty > 0:
                    tp = tp_for_mode(False, entry, sd)
                    cmds.append(BarCmd("market_sell", qty=qty, price=entry))
                    st.entry_avg = entry
                    st.initial_stop = stop_px
                    st.stop_distance = sd
                    st.tp_px = tp
                    st.entry_qty_plan = qty
                    st.entry_ts = ts_ny
                    st.or_low_at_entry = ol
                    st.or_high_at_entry = oh
                    st.phase = "in_pos"
        return cmds

    if pos == 0 and new_session:
        st.entry_avg = st.initial_stop = st.stop_distance = st.tp_px = st.entry_qty_plan = None
        st.entry_ts = None
        st.or_low_at_entry = st.or_high_at_entry = None
        st.partial_1r_done = False
        if st.phase == "in_pos":
            st.phase = "idle"

    return cmds


def replay_view_ohlc_ref(ohlc: pd.DataFrame, params: dict) -> tuple[list[dict], list[dict], list[dict]]:
    st = RefOrbState()
    zones: list[dict] = []
    lines: list[dict] = []
    markers: list[dict] = []
    eq = 1_000_000.0
    closed = 0
    pos = 0.0
    for ts, row in ohlc.iterrows():
        cmds = step_orb_reference(
            st,
            params,
            ts,
            float(row["open"]),
            float(row["high"]),
            float(row["low"]),
            float(row["close"]),
            float(row.get("volume", 0.0) or 0.0),
            eq,
            closed,
            pos,
            record_view=True,
            view_zones=zones,
            view_lines=lines,
            view_markers=markers,
        )
        for cmd in cmds:
            if cmd.op == "market_buy":
                pos = float(cmd.qty)
            elif cmd.op == "market_sell":
                pos = -float(cmd.qty)
            elif cmd.op in ("close_all", "close_long", "close_short"):
                pos = 0.0
            elif cmd.op == "sell_limit":
                pos -= float(cmd.qty)
            elif cmd.op == "buy_limit":
                pos += float(cmd.qty)
    return zones, lines, markers
