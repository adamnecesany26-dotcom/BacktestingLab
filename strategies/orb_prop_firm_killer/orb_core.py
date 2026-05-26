# -*- coding: utf-8 -*-
"""
Sdílená logika **ORB Prop Firm Killer verze 1** (Pine parity): OR, filtry, ladder / TP dle TV.

Verze 2 (čistě dle ``strategies/orb/orb-reference.md``) je v ``orb_prop_firm_killer_ref_v2/orb_reference_core.py``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

NY = "America/New_York"

# Pine option strings (exact)
SL_ATR_DAILY = "ATR % (Daily)"
SL_OR_OPP = "OR Opposite Boundary"
SL_OPP_OR_PRICE = "Opposite OR Price (orbHigh/orbLow)"
SL_FIRST_OR_BAR = "First OR bar High/Low"
TRADE_LADDER = "Ladder Partials + Runner"
TRADE_FULL = "Full Position (TP / EoD only)"
EXIT_EOD = "EoD"
EXIT_RR = "Fixed RR"
POS_FIXED = "Fixed Contracts"
POS_RISK = "% Equity Risk"


def utc_bar_open_to_ny(ts) -> pd.Timestamp:
    """Map bar open time to **America/New_York** for ``session`` / OR logic.

    - **Naive** ``datetime`` / ``Timestamp`` is interpreted as **UTC**. That matches
      ``backtrader`` ``num2date()`` on ``PandasData``: a tz-aware NY index in the
      dataframe is delivered to strategies as **naive UTC** (e.g. 09:30 ET → 14:30
      naive in winter / 13:30 in summer).
    - **Timezone-aware** inputs are converted to NY (no UTC assumption).

    MNQ Parquet in this repo is often stored with a **NY tz-aware** index; the build
    script can also emit **UTC-naive** instants — both work with this function.
    """
    t = pd.Timestamp(ts)
    if t.tzinfo is None:
        t = t.tz_localize("UTC")
    return t.tz_convert(NY)


def parse_session_edges(session: str) -> tuple[int, int]:
    """Return (start_min, end_min) from '0930-1600' style, end exclusive in minutes."""
    s = (session or "0930-1600").strip().replace(":", "")
    a, b = s.split("-", 1)
    sh, sm, eh, em = int(a[:2]), int(a[2:4]), int(b[:2]), int(b[2:4])
    return sh * 60 + sm, eh * 60 + em


def ny_minute_of_bar_open(ts_ny: pd.Timestamp) -> int:
    return int(ts_ny.hour) * 60 + int(ts_ny.minute)


def _parse_htf_tf(tf: str) -> tuple[str, int]:
    """Map Pine ``input.timeframe`` / UI výběr na bucket režim.

    Returns ``(kind, n)`` where ``kind`` is one of ``\"daily\"``, ``\"weekly\"``, ``\"monthly\"``,
    or ``\"intraday\"`` (``n`` = délka slotu v minutách od NY půlnoci, pro ``request.security``-like báze).

    Podporované řetězce (po ``.strip().upper()``): ``60``, ``1H``, ``240``, ``4H``,
    ``1D``, ``W``, ``1W``, … Neznámé intradenní — fallback 60 min.
    """
    t = (tf or "1h").strip().upper().replace(" ", "")
    if not t:
        return "intraday", 60
    if t in ("D", "1D", "DAY"):
        return "daily", 1
    if t in ("W", "1W"):
        return "weekly", 1
    if t in ("M", "1M"):
        return "monthly", 1
    if t.endswith("H") and len(t) > 1 and t[:-1].isdigit():
        return "intraday", int(t[:-1]) * 60
    if t.endswith("M") and len(t) > 1 and t[:-1].isdigit():
        return "intraday", int(t[:-1])
    if t.isdigit():
        m = int(t)
        return "intraday", max(1, m)
    return "intraday", 60


def normalize_htf_tf_ui(raw: object) -> str:
    """Z UI selectu / zpětná kompatibilita s minutami ``60|120|240`` z Pine."""
    s = str(raw or "1h").strip()
    legacy = {"60": "1h", "120": "2h", "240": "4h", "1440": "1D"}
    if s in legacy:
        return legacy[s]
    return s


def _htf_bucket_key(ts_ny: pd.Timestamp, p: dict) -> tuple:
    """Closed HTF period identity for ``close`` aggregation (Pine ``request.security`` HTF bars)."""
    kind, n = _parse_htf_tf(str(p.get("htf_tf", "1h") or "1h"))
    if kind == "daily":
        return ("D", ts_ny.date())
    if kind == "weekly":
        iso = ts_ny.isocalendar()
        return ("W", int(iso[0]), int(iso[1]))
    if kind == "monthly":
        return ("MO", int(ts_ny.year), int(ts_ny.month))
    step = max(1, int(n))
    if step >= 1440:
        return ("D", ts_ny.date())
    mod = ny_minute_of_bar_open(ts_ny)
    slot = mod // step
    return ("M", ts_ny.date(), slot)


def in_session(ts_ny: pd.Timestamp, start_min: int, end_min: int) -> bool:
    m = ny_minute_of_bar_open(ts_ny)
    return start_min <= m < end_min


def wilder_atr(trs: list[float], period: int) -> float | None:
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / float(period)
    for x in trs[period:]:
        atr = (atr * (period - 1) + x) / float(period)
    return atr


def true_range(h: float, l: float, prev_c: float) -> float:
    return max(h - l, abs(h - prev_c), abs(l - prev_c))


def _mintick(p: dict) -> float:
    try:
        m = float(p.get("tick_size", 0.25) or 0.25)
        return m if m > 0 else 0.25
    except (TypeError, ValueError):
        return 0.25


def stop_price(
    p: dict,
    is_long: bool,
    entry: float,
    orb_high: float,
    orb_low: float,
    or_first_hi: float | None,
    or_first_lo: float | None,
    daily_atr: float | None,
) -> float | None:
    min_d = _mintick(p)
    or_w = abs(float(orb_high) - float(orb_low))
    mode = str(p.get("sl_mode", SL_ATR_DAILY))
    mult = float(p.get("sl_mult", 1.0) or 1.0)
    atr_pct = float(p.get("atr_sl_pct", 30.0) or 30.0)

    if mode == SL_ATR_DAILY:
        atr_d = None if daily_atr is None or not math.isfinite(daily_atr) else float(daily_atr) * atr_pct / 100.0
        base = or_w if atr_d is None else atr_d
        adj = max(base * mult, min_d)
        return float(entry) - adj if is_long else float(entry) + adj
    if mode == SL_OR_OPP:
        adj = max(or_w * mult, min_d)
        return float(entry) - adj if is_long else float(entry) + adj
    if mode == SL_OPP_OR_PRICE:
        anc = float(orb_low) if is_long else float(orb_high)
        if orb_high is not None and orb_low is not None:
            adj = max(abs(float(entry) - anc) * mult, min_d)
            return float(entry) - adj if is_long else float(entry) + adj
        adj = max(or_w * mult, min_d)
        return float(entry) - adj if is_long else float(entry) + adj
    if mode == SL_FIRST_OR_BAR:
        anc = or_first_lo if is_long else or_first_hi
        if anc is not None and math.isfinite(float(anc)):
            adj = max(abs(float(entry) - float(anc)) * mult, min_d)
            return float(entry) - adj if is_long else float(entry) + adj
        adj = max(or_w * mult, min_d)
        return float(entry) - adj if is_long else float(entry) + adj
    adj = max(or_w * mult, min_d)
    return float(entry) - adj if is_long else float(entry) + adj


def tp_price(is_long: bool, entry: float, stop: float, rr: float) -> float:
    r_dist = abs(float(entry) - float(stop))
    return float(entry) + r_dist * float(rr) if is_long else float(entry) - r_dist * float(rr)


def lim_at_r(is_long: bool, entry: float, stop: float, r_mult: float) -> float:
    r_dist = abs(float(entry) - float(stop))
    return float(entry) + r_dist * float(r_mult) if is_long else float(entry) - r_dist * float(r_mult)


def qty_for_risk(p: dict, entry: float, stop: float, equity: float) -> float:
    per_sh = abs(float(entry) - float(stop))
    relaxed = bool(p.get("relaxed_bt", True))
    if str(p.get("pos_mode", POS_FIXED)) == POS_FIXED:
        q = float(p.get("contracts", 2.0) or 2.0)
    else:
        risk_amt = float(equity) * float(p.get("risk_pct", 0.5) or 0.0) / 100.0
        q = risk_amt / per_sh if per_sh > 0 else 0.0
    if relaxed:
        q = max(q, 1.0)
    return q


def sum_ladder_qty(p: dict) -> int:
    if str(p.get("trade_mode", TRADE_LADDER)) != TRADE_LADDER:
        return 0
    s = 0
    if p.get("p1_use"):
        s += int(p.get("p1_qty", 0) or 0)
    if p.get("p2_use"):
        s += int(p.get("p2_qty", 0) or 0)
    if p.get("p3_use"):
        s += int(p.get("p3_qty", 0) or 0)
    return s


def entry_qty(p: dict, entry: float, stop: float, equity: float) -> float:
    qb = qty_for_risk(p, entry, stop, equity)
    if bool(p.get("relaxed_bt", True)) and str(p.get("trade_mode")) == TRADE_LADDER:
        slq = sum_ladder_qty(p)
        return max(max(qb, float(slq)), 1.0)
    return qb


@dataclass
class OrbState:
    """Mutable session + OR state (Pine vars)."""

    orb_high: float | None = None
    orb_low: float | None = None
    orb_start_ts: pd.Timestamp | None = None
    orb_end_ts: pd.Timestamp | None = None
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
    day_start_equity: float = 0.0
    session_start_closed: int = 0
    order_armed: bool = False
    entry_px: float | None = None
    stop_px: float | None = None
    tp_px: float | None = None
    entry_qty_plan: float | None = None
    runner_qty_init: float | None = None
    breakout_close_wait: bool = False
    breakout_close_long: bool = False
    pending_long_stop: bool = False
    pending_short_stop: bool = False
    entry_avg: float | None = None
    initial_stop: float | None = None
    partial_done_p1: bool = False
    partial_done_p2: bool = False
    partial_done_p3: bool = False
    # daily history for ATR / avg vol (NY calendar days)
    daily_trs: list[float] = field(default_factory=list)
    daily_vols: list[float] = field(default_factory=list)
    daily_closes: list[float] = field(default_factory=list)
    prev_day_close: float | None = None
    cur_ny_date: object | None = None
    cur_d_o: float | None = None
    cur_d_h: float | None = None
    cur_d_l: float | None = None
    cur_d_c: float | None = None
    cur_d_v: float = 0.0
    # HTF buckets (Pine ``i_htfTf`` + ``ta.ema(...)[1]`` on merged series)
    htf_bucket: object | None = None
    htf_last_close: float | None = None
    htf_ema: float | None = None
    htf_seed: bool = False


@dataclass
class BarCmd:
    op: str
    qty: float = 0.0
    price: float | None = None
    reason: str = ""


def _finalize_day(st: OrbState, p: dict) -> None:
    if st.cur_ny_date is None or st.cur_d_c is None:
        return
    if st.prev_day_close is not None:
        tr = true_range(float(st.cur_d_h or 0), float(st.cur_d_l or 0), float(st.prev_day_close))
        st.daily_trs.append(tr)
    st.daily_vols.append(float(st.cur_d_v))
    st.daily_closes.append(float(st.cur_d_c))
    maxd = int(p.get("atr_len", 14) or 14) + 30
    st.daily_trs = st.daily_trs[-maxd:]
    st.daily_vols = st.daily_vols[-maxd:]
    st.daily_closes = st.daily_closes[-maxd:]
    st.prev_day_close = float(st.cur_d_c)


def _daily_atr_prev(st: OrbState, p: dict) -> float | None:
    n = int(p.get("atr_len", 14) or 14)
    if len(st.daily_trs) < n:
        return None
    return wilder_atr(st.daily_trs, n)


def _daily_avg_vol_prev(st: OrbState) -> float | None:
    vs = st.daily_vols
    if len(vs) < 15:
        return None
    return float(sum(vs[-15:-1]) / 14.0)


def _daily_open_today(st: OrbState) -> float | None:
    return float(st.cur_d_o) if st.cur_d_o is not None else None


def _update_htf(st: OrbState, ts_ny: pd.Timestamp, c: float, p: dict) -> None:
    if not bool(p.get("use_htf")):
        return
    htf_len = int(p.get("htf_ema_len", 50) or 50)
    bucket = _htf_bucket_key(ts_ny, p)
    if st.htf_bucket != bucket:
        if st.htf_last_close is not None and math.isfinite(float(st.htf_last_close)):
            prev_e = st.htf_ema
            cls = float(st.htf_last_close)
            if prev_e is None:
                st.htf_ema = cls
            else:
                k = 2.0 / (htf_len + 1.0)
                st.htf_ema = float(prev_e) + k * (cls - float(prev_e))
        st.htf_bucket = bucket
        st.htf_last_close = float(c)
    else:
        st.htf_last_close = float(c)


def htf_ema_prior_for_bar(st: OrbState) -> float | None:
    """Prior completed HTF EMA (Pine [1] on HTF)."""
    if st.htf_ema is None:
        return None
    return float(st.htf_ema)


def step_orb(
    st: OrbState,
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
    """Update ORB state; return orders. ``position_size`` = broker position at bar open (Backtrader)."""
    cmds: list[BarCmd] = []
    pos = float(position_size)
    ts_ny = utc_bar_open_to_ny(ts_utc)
    smin, emin = parse_session_edges(str(p.get("session", "0930-1600")))
    in_sess = in_session(ts_ny, smin, emin)
    prev_in = getattr(st, "_prev_in_sess", False)
    new_session = in_sess and not prev_in
    session_end = not in_sess and prev_in
    st._prev_in_sess = in_sess

    # NY calendar roll for daily stats
    d = ts_ny.date()
    if st.cur_ny_date != d:
        if st.cur_ny_date is not None:
            _finalize_day(st, p)
        st.cur_ny_date = d
        st.cur_d_o = float(o)
        st.cur_d_h = float(h)
        st.cur_d_l = float(l)
        st.cur_d_c = float(c)
        st.cur_d_v = float(v)
    else:
        st.cur_d_h = max(float(st.cur_d_h or o), float(h))
        st.cur_d_l = min(float(st.cur_d_l or o), float(l))
        st.cur_d_c = float(c)
        st.cur_d_v += float(v)

    _update_htf(st, ts_ny, float(c), p)

    daily_atr_prev = _daily_atr_prev(st, p)
    daily_avg_vol_prev = _daily_avg_vol_prev(st)
    daily_open = _daily_open_today(st)

    if new_session:
        st.orb_high = float(h)
        st.orb_low = float(l)
        st.orb_start_ts = ts_ny
        st.orb_end_ts = None
        st.orb_ready = False
        st.first_candle_dir = 0
        st.first_open = float(o)
        st.or_first_hi = float(h)
        st.or_first_lo = float(l)
        st.or_vol_today = 0.0
        st.order_armed = False
        st.breakout_close_wait = False
        st.pending_long_stop = False
        st.pending_short_stop = False
        st.day_start_equity = float(equity)
        st.session_start_closed = int(closed_trades)
        st.partial_done_p1 = st.partial_done_p2 = st.partial_done_p3 = False

    orb_minutes = int(p.get("orb_minutes", 5) or 5)
    if st.orb_start_ts is not None and in_sess:
        dt_sec = (ts_ny - st.orb_start_ts).total_seconds()
        st.orb_building = bool(in_sess and dt_sec < orb_minutes * 60)
    else:
        st.orb_building = False

    if st.orb_building:
        st.orb_high = max(float(st.orb_high or h), float(h))
        st.orb_low = min(float(st.orb_low or l), float(l))
        st.or_vol_today += float(v)
        st.or_last_close = float(c)

    orb_just = st.orb_building_prev and not st.orb_building
    if orb_just:
        st.orb_end_ts = ts_ny
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
                    "fillcolor": "rgba(250,204,21,0.35)",
                    "name": "ORB",
                }
            )
        if record_view and view_markers is not None:
            view_markers.append(
                {
                    "date": pd.Timestamp(ts_utc).isoformat(),
                    "type": "signal",
                    "value": float(st.orb_high if st.first_candle_dir == 1 else st.orb_low or c),
                }
            )

    st.orb_building_prev = bool(st.orb_building)

    daily_pnl_pct = (
        (float(equity) - float(st.day_start_equity)) / float(st.day_start_equity) * 100.0
        if st.day_start_equity > 0
        else 0.0
    )
    daily_loss_hit = bool(p.get("use_day_stop")) and daily_pnl_pct <= -float(p.get("day_loss_pct", 2.0) or 0.0)

    trades_today = int(closed_trades) - int(st.session_start_closed) + (1 if pos != 0 else 0)

    price_ok = (not bool(p.get("use_uni"))) or (
        daily_open is not None and daily_open >= float(p.get("min_price", 5.0) or 0.0)
    )
    vol_ok = (not bool(p.get("use_uni"))) or (
        daily_avg_vol_prev is not None and daily_avg_vol_prev >= float(p.get("min_avg_vol", 1e6) or 0.0)
    )
    atr_ok = (not bool(p.get("use_uni"))) or (
        daily_atr_prev is not None and daily_atr_prev >= float(p.get("min_atr", 0.5) or 0.0)
    )
    universe_ok = price_ok and vol_ok and atr_ok

    rel_ok = (not bool(p.get("use_rel_vol"))) or (st.rel_vol is not None and st.rel_vol >= float(p.get("rel_vol_min", 1.0) or 0.0))

    dow = ts_ny.weekday()  # Mon=0
    dow_ok = (not bool(p.get("use_dow"))) or (
        (dow == 0 and p.get("dow_mon", True))
        or (dow == 1 and p.get("dow_tue", False))
        or (dow == 2 and p.get("dow_wed", True))
        or (dow == 3 and p.get("dow_thu", False))
        or (dow == 4 and p.get("dow_fri", True))
    )

    ema_h = htf_ema_prior_for_bar(st)
    htf_bull = (not bool(p.get("use_htf"))) or (ema_h is not None and float(c) > float(ema_h))
    htf_bear = (not bool(p.get("use_htf"))) or (ema_h is not None and float(c) < float(ema_h))

    trade_count_ok = trades_today < int(p.get("max_trades", 1) or 1)

    gate_strict = (
        st.orb_ready
        and in_sess
        and universe_ok
        and rel_ok
        and dow_ok
        and (not daily_loss_hit)
        and trade_count_ok
    )
    gate_loose = st.orb_ready and in_sess and trade_count_ok and ((not bool(p.get("use_rel_vol"))) or rel_ok)
    gate = gate_loose if bool(p.get("relaxed_bt", True)) else gate_strict

    if daily_loss_hit or session_end:
        st.pending_long_stop = st.pending_short_stop = False
        st.breakout_close_wait = False

    if (daily_loss_hit or session_end) and pos != 0:
        cmds.append(BarCmd("close_all", reason="session_end" if session_end else "daily_loss"))
        pos = 0.0
        st.entry_avg = st.initial_stop = None
        st.partial_done_p1 = st.partial_done_p2 = st.partial_done_p3 = False

    # --- arm entry (Pine: orbJustFinalized bar) ---
    if orb_just and gate and not st.order_armed and pos == 0:
        if st.first_candle_dir == 1 and htf_bull and st.orb_high is not None:
            eP = float(st.orb_high)
            sP = stop_price(p, True, eP, float(st.orb_high), float(st.orb_low or eP), st.or_first_hi, st.or_first_lo, daily_atr_prev)
            q = entry_qty(p, eP, float(sP or 0), equity)
            lad = sum_ladder_qty(p)
            lad_ok = str(p.get("trade_mode")) != TRADE_LADDER or lad <= q
            if sP is not None and float(sP) < eP and q > 0 and lad_ok:
                st.entry_px = eP
                st.stop_px = float(sP)
                st.tp_px = tp_price(True, eP, float(sP), float(p.get("fixed_rr", 2.0) or 2.0))
                st.entry_qty_plan = q
                st.runner_qty_init = q - lad if str(p.get("trade_mode")) == TRADE_LADDER else q
                st.order_armed = True
                if bool(p.get("close_break_confirm")):
                    st.breakout_close_wait = True
                    st.breakout_close_long = True
                else:
                    st.pending_long_stop = True
        elif st.first_candle_dir == -1 and htf_bear and st.orb_low is not None:
            eP = float(st.orb_low)
            sP = stop_price(p, False, eP, float(st.orb_high or eP), float(st.orb_low), st.or_first_hi, st.or_first_lo, daily_atr_prev)
            q = entry_qty(p, eP, float(sP or 0), equity)
            lad = sum_ladder_qty(p)
            lad_ok = str(p.get("trade_mode")) != TRADE_LADDER or lad <= q
            if sP is not None and float(sP) > eP and q > 0 and lad_ok:
                st.entry_px = eP
                st.stop_px = float(sP)
                st.tp_px = tp_price(False, eP, float(sP), float(p.get("fixed_rr", 2.0) or 2.0))
                st.entry_qty_plan = q
                st.runner_qty_init = q - lad if str(p.get("trade_mode")) == TRADE_LADDER else q
                st.order_armed = True
                if bool(p.get("close_break_confirm")):
                    st.breakout_close_wait = True
                    st.breakout_close_long = False
                else:
                    st.pending_short_stop = True

    # close-confirmed breakout entry
    if (
        st.breakout_close_wait
        and st.order_armed
        and st.entry_px is not None
        and st.entry_qty_plan is not None
        and pos == 0
        and in_sess
        and not daily_loss_hit
    ):
        if st.breakout_close_long and float(c) > float(st.entry_px) and float(st.entry_qty_plan) > 0:
            cmds.append(BarCmd("market_buy", qty=float(st.entry_qty_plan), price=float(c)))
            st.tp_px = tp_price(True, float(c), float(st.stop_px or c), float(p.get("fixed_rr", 2.0) or 2.0))
            st.entry_px = float(c)
            st.entry_avg = float(c)
            st.initial_stop = float(st.stop_px or c)
            pos = float(st.entry_qty_plan)
            st.breakout_close_wait = False
        elif (not st.breakout_close_long) and float(c) < float(st.entry_px) and float(st.entry_qty_plan) > 0:
            cmds.append(BarCmd("market_sell", qty=float(st.entry_qty_plan), price=float(c)))
            st.tp_px = tp_price(False, float(c), float(st.stop_px or c), float(p.get("fixed_rr", 2.0) or 2.0))
            st.entry_px = float(c)
            st.entry_avg = float(c)
            st.initial_stop = float(st.stop_px or c)
            pos = -float(st.entry_qty_plan)
            st.breakout_close_wait = False

    # stop entry fills (trade-through) at stop level — process_orders_on_close fill this bar close path uses coc
    if pos == 0 and not st.breakout_close_wait and st.order_armed and st.entry_px is not None and st.entry_qty_plan:
        if st.pending_long_stop and float(h) >= float(st.entry_px):
            fill = float(st.entry_px)
            cmds.append(BarCmd("market_buy", qty=float(st.entry_qty_plan), price=fill))
            st.entry_avg = fill
            st.initial_stop = float(st.stop_px or fill)
            pos = float(st.entry_qty_plan)
            st.pending_long_stop = False
        elif st.pending_short_stop and float(l) <= float(st.entry_px):
            fill = float(st.entry_px)
            cmds.append(BarCmd("market_sell", qty=float(st.entry_qty_plan), price=fill))
            st.entry_avg = fill
            st.initial_stop = float(st.stop_px or fill)
            pos = -float(st.entry_qty_plan)
            st.pending_short_stop = False

    # view horizontal levels while armed / in trade
    if record_view and view_lines is not None and st.order_armed and st.entry_px is not None:
        view_lines.append({"name": "entry", "data": [{"date": pd.Timestamp(ts_utc).isoformat(), "value": float(st.entry_px)}]})
        if st.stop_px is not None:
            view_lines.append({"name": "stop", "data": [{"date": pd.Timestamp(ts_utc).isoformat(), "value": float(st.stop_px)}]})
        if st.tp_px is not None and str(p.get("exit_mode")) == EXIT_RR:
            view_lines.append({"name": "tp", "data": [{"date": pd.Timestamp(ts_utc).isoformat(), "value": float(st.tp_px)}]})

    # --- exits (manual, POC: evaluate with this bar's OHLC) ---
    if pos > 0 and st.entry_avg is not None and st.initial_stop is not None:
        entry = float(st.entry_avg)
        stop0 = float(st.initial_stop)
        partial_occurred = str(p.get("trade_mode")) == TRADE_LADDER and abs(pos) < float(st.entry_qty_plan or 0) - 1e-4
        active_stop = float(entry) if (bool(p.get("use_be")) and partial_occurred and str(p.get("trade_mode")) == TRADE_LADDER) else stop0

        # SL first
        if float(l) <= float(active_stop):
            cmds.append(BarCmd("close_long", qty=abs(pos), price=float(active_stop)))
            pos = 0.0
            st.order_armed = False
        else:
            if str(p.get("trade_mode")) == TRADE_LADDER:
                if bool(p.get("p1_use")) and not st.partial_done_p1 and int(p.get("p1_qty", 0) or 0) > 0:
                    lp = lim_at_r(True, entry, stop0, float(p.get("p1_r", 1.0) or 1.0))
                    if float(h) >= lp:
                        q = min(float(p.get("p1_qty", 0) or 0), pos)
                        cmds.append(BarCmd("sell_limit", qty=q, price=lp))
                        pos -= q
                        st.partial_done_p1 = True
                if pos > 0 and bool(p.get("p2_use")) and not st.partial_done_p2 and int(p.get("p2_qty", 0) or 0) > 0:
                    lp = lim_at_r(True, entry, stop0, float(p.get("p2_r", 2.0) or 2.0))
                    if float(h) >= lp:
                        q = min(float(p.get("p2_qty", 0) or 0), pos)
                        cmds.append(BarCmd("sell_limit", qty=q, price=lp))
                        pos -= q
                        st.partial_done_p2 = True
                if pos > 0 and bool(p.get("p3_use")) and not st.partial_done_p3 and int(p.get("p3_qty", 0) or 0) > 0:
                    lp = lim_at_r(True, entry, stop0, float(p.get("p3_r", 3.0) or 3.0))
                    if float(h) >= lp:
                        q = min(float(p.get("p3_qty", 0) or 0), pos)
                        cmds.append(BarCmd("sell_limit", qty=q, price=lp))
                        pos -= q
                        st.partial_done_p3 = True
            if pos > 0 and str(p.get("exit_mode")) == EXIT_RR and st.tp_px is not None:
                if float(h) >= float(st.tp_px):
                    cmds.append(BarCmd("close_long", qty=pos, price=float(st.tp_px)))
                    pos = 0.0
                    st.order_armed = False

    elif pos < 0 and st.entry_avg is not None and st.initial_stop is not None:
        entry = float(st.entry_avg)
        stop0 = float(st.initial_stop)
        partial_occurred = str(p.get("trade_mode")) == TRADE_LADDER and abs(pos) < float(st.entry_qty_plan or 0) - 1e-4
        active_stop = float(entry) if (bool(p.get("use_be")) and partial_occurred and str(p.get("trade_mode")) == TRADE_LADDER) else stop0
        if float(h) >= float(active_stop):
            cmds.append(BarCmd("close_short", qty=abs(pos), price=float(active_stop)))
            pos = 0.0
            st.order_armed = False
        else:
            if str(p.get("trade_mode")) == TRADE_LADDER:
                if bool(p.get("p1_use")) and not st.partial_done_p1 and int(p.get("p1_qty", 0) or 0) > 0:
                    lp = lim_at_r(False, entry, stop0, float(p.get("p1_r", 1.0) or 1.0))
                    if float(l) <= lp:
                        q = min(float(p.get("p1_qty", 0) or 0), abs(pos))
                        cmds.append(BarCmd("buy_limit", qty=q, price=lp))
                        pos += q
                        st.partial_done_p1 = True
                if pos < 0 and bool(p.get("p2_use")) and not st.partial_done_p2 and int(p.get("p2_qty", 0) or 0) > 0:
                    lp = lim_at_r(False, entry, stop0, float(p.get("p2_r", 2.0) or 2.0))
                    if float(l) <= lp:
                        q = min(float(p.get("p2_qty", 0) or 0), abs(pos))
                        cmds.append(BarCmd("buy_limit", qty=q, price=lp))
                        pos += q
                        st.partial_done_p2 = True
                if pos < 0 and bool(p.get("p3_use")) and not st.partial_done_p3 and int(p.get("p3_qty", 0) or 0) > 0:
                    lp = lim_at_r(False, entry, stop0, float(p.get("p3_r", 3.0) or 3.0))
                    if float(l) <= lp:
                        q = min(float(p.get("p3_qty", 0) or 0), abs(pos))
                        cmds.append(BarCmd("buy_limit", qty=q, price=lp))
                        pos += q
                        st.partial_done_p3 = True
            if pos < 0 and str(p.get("exit_mode")) == EXIT_RR and st.tp_px is not None:
                if float(l) <= float(st.tp_px):
                    cmds.append(BarCmd("close_short", qty=abs(pos), price=float(st.tp_px)))
                    pos = 0.0
                    st.order_armed = False

    if pos == 0 and (session_end or new_session):
        st.entry_avg = st.initial_stop = st.entry_px = st.stop_px = st.tp_px = st.entry_qty_plan = st.runner_qty_init = None
        st.order_armed = False
        st.pending_long_stop = st.pending_short_stop = False

    return cmds


def replay_view_ohlc(ohlc: pd.DataFrame, params: dict) -> tuple[list[dict], list[dict], list[dict]]:
    """Scan dataframe for OR zones/lines/markers (View mode)."""
    st = OrbState()
    zones: list[dict] = []
    lines: list[dict] = []
    markers: list[dict] = []
    eq = 1_000_000.0
    closed = 0
    pos = 0.0
    for ts, row in ohlc.iterrows():
        cmds = step_orb(
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
    # de-duplicate consecutive identical line entries for cleaner chart
    return zones, lines, markers
