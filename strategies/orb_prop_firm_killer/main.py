# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — strategies/orb_prop_firm_killer/main.py
"""
**Strategie — verze 1 (implementace v repozitáři).**

ORB Prop Firm Killer — Python port ``ORB_PropFirmKiller.pine`` (Pine v6).
Jde o *TradingView / engine parity* variantu. Literární specifikace hybridního ORB
pro akcie je v ``strategies/orb/orb-reference.md`` — ta je implementována ve **verzi 2**
balíčku ``strategies/orb_prop_firm_killer_ref_v2/``.

**Import:** Engine ukládá do ``.backtest_run/<id>/`` často jen ``main.py``. Pokud ve stejné
složce není ``orb_core.py``, načte se ``orb_core`` z repozitáře (``strategies/orb_prop_firm_killer/``).

**TradingView / engine parity**
- Set strategy param ``process_orders_on_close=true`` (default): enables
  ``cerebro.broker.set_coc(True)`` in ``engine.run_backtest`` for same-bar
  close semantics (matches Pine ``process_orders_on_close``).
- Commission: Pine uses ``strategy.commission.percent`` (round-turn %). This app
  uses ``broker_config`` / UI execution model (per-contract or %). Align
  commission in the Run panel for comparable PnL.
- Slippage: global engine slippage applies on top of fill prices assumed here
  at stop/limit levels.

- **Statistics:** Záznam obchodů, MFE/MAE a equity v `engine.run_backtest` používají
  stejný backtrader broker jako ostatní strategie; u ladder partialů se může pořadí
  naplnění v jedné svíčce lehce lišit od TradingView.
- **HTF EMA:** Parametr ``htf_tf`` odpovídá Pine ``i_htfTf``. V UI je výběr ``1h|2h|4h|1D|1W``; staré číselné minuty (např. ``60``) se při načtení převedou.
  Intradenní agregace používá NY minuty od půlnoci (slot ``(minute_of_day // tf_minutes)``).
  U některých instrumentů se může hraniční čas 4H svíček na TradingView mírně lišit.

**Data / čas**: ``data/futures_mnq/MNQ_1m.parquet`` — raw merge skript
(``scripts/build_mnq_ohlcv.py``) parsuje stampy jako **NY wall clock**, ukládá index
typicky **UTC-naive** (po ``tz_convert("UTC")``) *nebo* může zůstat **tz=America/New_York**
v Parquet. Backtrader ``num2date`` vrací **naive UTC**; ``orb_core.utc_bar_open_to_ny``
z toho znovu udělá NY, takže ``session`` (default ``0930-1600``) je vždy **hodiny v NY**,
ne v lokálu uživatele. Resample 5m/15m/30m přes UI.

**Výchozí sizing / partials**: 2 kontrakty, režim ladder, partial #1 zapnutý (1 kontrakt na 1R),
runner na TP/EoD. Lze vypnout partial nebo přepnout na „Full Position“ a 1 kontrakt.
"""

from __future__ import annotations

import sys
from pathlib import Path

import backtrader as bt
import pandas as pd

try:
    from orb_core import (
        EXIT_RR,
        OrbState,
        TRADE_LADDER,
        lim_at_r,
        replay_view_ohlc,
        step_orb,
        normalize_htf_tf_ui,
    )
except ImportError:
    _here = Path(__file__).resolve()
    _root_found = False
    for _base in _here.parents:
        if (_base / "strategies" / "orb_prop_firm_killer" / "orb_core.py").is_file():
            _s = str(_base)
            if _s not in sys.path:
                sys.path.insert(0, _s)
            _root_found = True
            break
    if not _root_found:
        raise ImportError(
            "orb_core: neither sibling orb_core.py nor repo strategies/orb_prop_firm_killer/orb_core.py found"
        ) from None
    from strategies.orb_prop_firm_killer.orb_core import (
        EXIT_RR,
        OrbState,
        TRADE_LADDER,
        lim_at_r,
        replay_view_ohlc,
        step_orb,
        normalize_htf_tf_ui,
    )


def _norm_ohlc_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    ren = {}
    for c in out.columns:
        cl = str(c).lower()
        if cl in ("open", "high", "low", "close", "volume"):
            ren[c] = cl
    out = out.rename(columns=ren)
    if not isinstance(out.index, pd.DatetimeIndex) and "datetime" in out.columns:
        out = out.set_index(pd.to_datetime(out["datetime"], errors="coerce"))
    out = out.sort_index()
    return out


def _params_from_dict(p: dict) -> dict:
    """Normalize UI/ PARAMS dict → orb_core ``step_orb`` keys."""
    def b(key, default=False):
        v = p.get(key, default)
        if v in (1, "1", "true", "True", True):
            return True
        if v in (0, "0", "false", "False", False, None, ""):
            return False
        return bool(v)

    return {
        "relaxed_bt": b("relaxed_bt", True),
        "orb_minutes": int(p.get("orb_minutes", 5) or 5),
        "session": str(p.get("session", "0930-1600")),
        "close_break_confirm": b("close_break_confirm", False),
        "use_uni": b("use_uni", False),
        "min_price": float(p.get("min_price", 5.0) or 5.0),
        "min_avg_vol": float(p.get("min_avg_vol", 1_000_000) or 0.0),
        "min_atr": float(p.get("min_atr", 0.5) or 0.0),
        "use_rel_vol": b("use_rel_vol", False),
        "rel_vol_min": float(p.get("rel_vol_min", 1.0) or 1.0),
        "rel_vol_back": int(p.get("rel_vol_back", 14) or 14),
        "sl_mode": str(p.get("sl_mode", "ATR % (Daily)")),
        "atr_len": int(p.get("atr_len", 14) or 14),
        "atr_sl_pct": float(p.get("atr_sl_pct", 30.0) or 30.0),
        "sl_mult": float(p.get("sl_mult", 1.0) or 1.0),
        "trade_mode": str(p.get("trade_mode", "Ladder Partials + Runner")),
        "exit_mode": str(p.get("exit_mode", "EoD")),
        "fixed_rr": float(p.get("fixed_rr", 2.0) or 2.0),
        "pos_mode": str(p.get("pos_mode", "Fixed Contracts")),
        "contracts": float(p.get("contracts", 2.0) or 2.0),
        "risk_pct": float(p.get("risk_pct", 0.5) or 0.5),
        "p1_use": b("p1_use", True),
        "p1_qty": int(p.get("p1_qty", 1) or 0),
        "p1_r": float(p.get("p1_r", 1.0) or 1.0),
        "p2_use": b("p2_use", False),
        "p2_qty": int(p.get("p2_qty", 0) or 0),
        "p2_r": float(p.get("p2_r", 2.0) or 2.0),
        "p3_use": b("p3_use", False),
        "p3_qty": int(p.get("p3_qty", 0) or 0),
        "p3_r": float(p.get("p3_r", 3.0) or 3.0),
        "use_be": b("use_be", True),
        "max_trades": int(p.get("max_trades", 1) or 1),
        "use_day_stop": b("use_day_stop", False),
        "day_loss_pct": float(p.get("day_loss_pct", 2.0) or 2.0),
        "use_htf": b("use_htf", False),
        "htf_tf": normalize_htf_tf_ui(p.get("htf_tf", "1h")),
        "htf_ema_len": int(p.get("htf_ema_len", 50) or 50),
        "use_dow": b("use_dow", False),
        "dow_mon": b("dow_mon", True),
        "dow_tue": b("dow_tue", False),
        "dow_wed": b("dow_wed", True),
        "dow_thu": b("dow_thu", False),
        "dow_fri": b("dow_fri", True),
        "tick_size": float(p.get("tick_size", 0.25) or 0.25),
    }


PARAMS = {
    "process_orders_on_close": True,
    "relaxed_bt": True,
    "orb_minutes": 5,
    "session": "0930-1600",
    "close_break_confirm": False,
    "use_uni": False,
    "min_price": 5.0,
    "min_avg_vol": 1_000_000.0,
    "min_atr": 0.5,
    "use_rel_vol": False,
    "rel_vol_min": 1.0,
    "rel_vol_back": 14,
    "sl_mode": "ATR % (Daily)",
    "atr_len": 14,
    "atr_sl_pct": 30.0,
    "sl_mult": 1.0,
    "trade_mode": "Ladder Partials + Runner",
    "exit_mode": "EoD",
    "fixed_rr": 2.0,
    "pos_mode": "Fixed Contracts",
    "contracts": 2.0,
    "risk_pct": 0.5,
    "p1_use": True,
    "p1_qty": 1,
    "p1_r": 1.0,
    "p2_use": False,
    "p2_qty": 0,
    "p2_r": 2.0,
    "p3_use": False,
    "p3_qty": 0,
    "p3_r": 3.0,
    "use_be": True,
    "max_trades": 1,
    "use_day_stop": False,
    "day_loss_pct": 2.0,
    "use_htf": False,
    "htf_tf": "1h",
    "htf_ema_len": 50,
    "use_dow": False,
    "dow_mon": True,
    "dow_tue": False,
    "dow_wed": True,
    "dow_thu": False,
    "dow_fri": True,
    "tick_size": 0.25,
}

PARAMS_META = {
    "process_orders_on_close": {
        "group": "8) Engine & Pine parity",
        "order": 80,
        "title": "Process orders on close",
        "what_it_means": "Zapnout stejnou simulaci jako TV ``process_orders_on_close`` — engine nastaví broker cheat-on-close.",
        "booleanWidget": True,
    },
    "relaxed_bt": {
        "group": "0) Cross-instrument backtest",
        "order": 10,
        "title": "Relaxed instrument test (recommended for futures)",
        "what_it_means": "Volnější gate (bez universe / DoW / daily loss); RelVol stahuje zvlášť.",
        "booleanWidget": True,
    },
    "orb_minutes": {
        "group": "1) Opening range",
        "order": 20,
        "title": "ORB length (minutes)",
        "what_it_means": "Délka opening range od první session svíčky.",
        "options": "5|15|30",
        "option_labels": "5|15|30",
    },
    "session": {
        "group": "1) Opening range",
        "order": 30,
        "title": "Trading session (start–end)",
        "what_it_means": "Formát 0930-1600 — RTH výchozí (NY wall čas jako ve TV).",
    },
    "close_break_confirm": {
        "group": "1) Opening range",
        "order": 40,
        "title": "Close confirmation for breakout",
        "what_it_means": "Čeká na close za hranou OR místo stop příkazu.",
        "booleanWidget": True,
    },
    "use_uni": {
        "group": "2) Universe filters",
        "order": 50,
        "title": "Apply universe filters",
        "booleanWidget": True,
    },
    "min_price": {
        "group": "2) Universe filters",
        "order": 60,
        "title": "Min price ($)",
        "depends_on_param": "use_uni",
        "depends_on_values": "1|true|True",
    },
    "min_avg_vol": {
        "group": "2) Universe filters",
        "order": 70,
        "title": "Min 14d avg volume (sh)",
        "depends_on_param": "use_uni",
        "depends_on_values": "1|true|True",
    },
    "min_atr": {
        "group": "2) Universe filters",
        "order": 80,
        "title": "Min 14d ATR ($)",
        "depends_on_param": "use_uni",
        "depends_on_values": "1|true|True",
    },
    "use_rel_vol": {
        "group": "3) Relative volume filter",
        "order": 90,
        "title": "Require above-average OR volume",
        "booleanWidget": True,
    },
    "rel_vol_min": {
        "group": "3) Relative volume filter",
        "order": 100,
        "title": "Min relative volume (1.0 = 100%)",
        "depends_on_param": "use_rel_vol",
        "depends_on_values": "1|true|True",
    },
    "rel_vol_back": {
        "group": "3) Relative volume filter",
        "order": 110,
        "title": "RelVol lookback (sessions)",
        "depends_on_param": "use_rel_vol",
        "depends_on_values": "1|true|True",
    },
    "sl_mode": {
        "group": "4) Stop loss",
        "order": 120,
        "title": "SL mode",
        "options": "ATR % (Daily)|OR Opposite Boundary|Opposite OR Price (orbHigh/orbLow)|First OR bar High/Low",
        "option_labels": "ATR % (Daily)|OR Opposite|Opposite OR price|First ORBar H/L",
    },
    "atr_len": {"group": "4) Stop loss", "order": 130, "title": "ATR length (daily)"},
    "atr_sl_pct": {"group": "4) Stop loss", "order": 140, "title": "ATR % for SL"},
    "sl_mult": {"group": "4) Stop loss", "order": 150, "title": "SL distance multiplier"},
    "trade_mode": {
        "group": "5) Exit style",
        "order": 160,
        "title": "Trade style",
        "options": "Ladder Partials + Runner|Full Position (TP / EoD only)",
    },
    "exit_mode": {
        "group": "5) Exit style",
        "order": 170,
        "title": "Runner / full exit mode",
        "options": "EoD|Fixed RR",
    },
    "fixed_rr": {
        "group": "5) Exit style",
        "order": 180,
        "title": "Fixed risk-reward (R:R)",
        "depends_on_param": "exit_mode",
        "depends_on_values": "Fixed RR",
    },
    "pos_mode": {
        "group": "5B) Position size",
        "order": 190,
        "title": "Sizing mode",
        "options": "Fixed Contracts|% Equity Risk",
    },
    "contracts": {"group": "5B) Position size", "order": 200, "title": "Contracts / shares (fixed mode)"},
    "risk_pct": {
        "group": "5B) Position size",
        "order": 210,
        "title": "Risk per trade (% equity) [% mode only]",
        "depends_on_param": "pos_mode",
        "depends_on_values": "% Equity Risk",
    },
    "p1_use": {"group": "5C) Ladder partials (optional)", "order": 220, "title": "Partial #1 enable", "booleanWidget": True},
    "p1_qty": {
        "group": "5C) Ladder partials (optional)",
        "order": 230,
        "title": "Partial #1 — contracts",
        "depends_on_param": "p1_use",
        "depends_on_values": "1|true|True",
    },
    "p1_r": {
        "group": "5C) Ladder partials (optional)",
        "order": 240,
        "title": "Partial #1 — @ R",
        "depends_on_param": "p1_use",
        "depends_on_values": "1|true|True",
    },
    "p2_use": {"group": "5C) Ladder partials (optional)", "order": 250, "title": "Partial #2 enable", "booleanWidget": True},
    "p2_qty": {
        "group": "5C) Ladder partials (optional)",
        "order": 260,
        "title": "Partial #2 — contracts",
        "depends_on_param": "p2_use",
        "depends_on_values": "1|true|True",
    },
    "p2_r": {
        "group": "5C) Ladder partials (optional)",
        "order": 270,
        "title": "Partial #2 — @ R",
        "depends_on_param": "p2_use",
        "depends_on_values": "1|true|True",
    },
    "p3_use": {"group": "5C) Ladder partials (optional)", "order": 280, "title": "Partial #3 enable", "booleanWidget": True},
    "p3_qty": {
        "group": "5C) Ladder partials (optional)",
        "order": 290,
        "title": "Partial #3 — contracts",
        "depends_on_param": "p3_use",
        "depends_on_values": "1|true|True",
    },
    "p3_r": {
        "group": "5C) Ladder partials (optional)",
        "order": 300,
        "title": "Partial #3 — @ R",
        "depends_on_param": "p3_use",
        "depends_on_values": "1|true|True",
    },
    "use_be": {
        "group": "5C) Ladder partials (optional)",
        "order": 310,
        "title": "Move runner stop to BE after first partial",
        "booleanWidget": True,
    },
    "max_trades": {"group": "6) Risk management", "order": 320, "title": "Max trades per day"},
    "use_day_stop": {"group": "6) Risk management", "order": 330, "title": "Hard daily loss circuit-breaker", "booleanWidget": True},
    "day_loss_pct": {
        "group": "6) Risk management",
        "order": 340,
        "title": "Daily loss limit (%)",
        "depends_on_param": "use_day_stop",
        "depends_on_values": "1|true|True",
    },
    "use_htf": {"group": "7) Optional filters", "order": 350, "title": "HTF trend filter (advanced)", "booleanWidget": True},
    "htf_tf": {
        "group": "7) Optional filters",
        "order": 360,
        "title": "HTF timeframe",
        "what_it_means": "Stejné řetězce jako Pine: 1,5,15,30,60,240, 1H, 4H, 1D, W, M …",
        "options": "1h|2h|4h|1D|1W",
        "depends_on_param": "use_htf",
        "depends_on_values": "1|true|True",
    },
    "htf_ema_len": {
        "group": "7) Optional filters",
        "order": 370,
        "title": "HTF EMA length",
        "depends_on_param": "use_htf",
        "depends_on_values": "1|true|True",
    },
    "use_dow": {"group": "7) Optional filters", "order": 380, "title": "Day-of-week filter", "booleanWidget": True},
    "dow_mon": {"group": "7) Optional filters", "order": 390, "title": "Mon", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_tue": {"group": "7) Optional filters", "order": 400, "title": "Tue", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_wed": {"group": "7) Optional filters", "order": 410, "title": "Wed", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_thu": {"group": "7) Optional filters", "order": 420, "title": "Thu", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_fri": {"group": "7) Optional filters", "order": 430, "title": "Fri", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "tick_size": {
        "group": "8) Engine & Pine parity",
        "order": 90,
        "title": "Mintick (price)",
        "what_it_means": "syminfo.mintick — min SL distance rounding.",
    },
}

VIEW_PARAMS = {k: PARAMS[k] for k in PARAMS if k != "process_orders_on_close"}
VIEW_PARAMS_META = {k: v for k, v in PARAMS_META.items() if k != "process_orders_on_close"}


class Strategy(bt.Strategy):
    params = tuple((k, PARAMS[k]) for k in PARAMS) + (
        ("swing_tf", "30m"),
        ("timeframe", "30m"),
        ("data_timeframe", None),
        ("work_timeframe", None),
        ("module_params", {}),
    )

    def __init__(self):
        self._ost = OrbState()
        self._closed_trades = 0
        self._p = {k: getattr(self.p, k) for k in PARAMS}

    def notify_trade(self, trade):
        if trade.isclosed:
            self._closed_trades += 1

    def decorate_trade_record(self, d, _trade):
        """Pro Graf detail: zoneMeta = ORB box, SL/TP, případné partial rungs (limity)."""
        try:
            st = self._ost
            p = self._pd()
            zm: dict = {}
            if isinstance(d.get("zoneMeta"), dict):
                zm = dict(d["zoneMeta"])
            if (
                st.orb_high is not None
                and st.orb_low is not None
                and st.orb_start_ts is not None
            ):
                end_ts = st.orb_end_ts if st.orb_end_ts is not None else st.orb_start_ts
                zm["zoneValueLow"] = float(st.orb_low)
                zm["zoneValueHigh"] = float(st.orb_high)
                zm["zoneDateStart"] = st.orb_start_ts.tz_convert("UTC").isoformat()
                zm["zoneDateEnd"] = pd.Timestamp(end_ts).tz_convert("UTC").isoformat()
            if st.entry_avg is not None and st.initial_stop is not None:
                is_long = d.get("type") == "buy"
                entry = float(st.entry_avg)
                stop0 = float(st.initial_stop)
                zm["stopPrice"] = stop0
                if (
                    bool(p.get("use_be"))
                    and str(p.get("trade_mode")) == TRADE_LADDER
                    and (st.partial_done_p1 or st.partial_done_p2 or st.partial_done_p3)
                ):
                    zm["breakEvenStopPrice"] = entry
                if str(p.get("trade_mode")) == TRADE_LADDER:
                    if bool(p.get("p1_use")) and int(p.get("p1_qty", 0) or 0) > 0:
                        zm["partialPrice1"] = float(
                            lim_at_r(is_long, entry, stop0, float(p.get("p1_r", 1.0) or 1.0))
                        )
                    if bool(p.get("p2_use")) and int(p.get("p2_qty", 0) or 0) > 0:
                        zm["partialPrice2"] = float(
                            lim_at_r(is_long, entry, stop0, float(p.get("p2_r", 2.0) or 2.0))
                        )
                    if bool(p.get("p3_use")) and int(p.get("p3_qty", 0) or 0) > 0:
                        zm["partialPrice3"] = float(
                            lim_at_r(is_long, entry, stop0, float(p.get("p3_r", 3.0) or 3.0))
                        )
                if str(p.get("exit_mode")) == EXIT_RR and st.tp_px is not None:
                    zm["targetPrice"] = float(st.tp_px)
            d["zoneMeta"] = zm
        except Exception:
            pass
        return d

    def _pd(self) -> dict:
        d = {k: getattr(self.p, k) for k in PARAMS}
        return _params_from_dict(d)

    def next(self):
        dt = bt.num2date(self.data.datetime[0])
        pos = float(self.position.size)
        eq = float(self.broker.getvalue())
        cmds = step_orb(
            self._ost,
            self._pd(),
            dt,
            float(self.data.open[0]),
            float(self.data.high[0]),
            float(self.data.low[0]),
            float(self.data.close[0]),
            float(self.data.volume[0]),
            eq,
            self._closed_trades,
            pos,
        )
        for cmd in cmds:
            if cmd.op == "market_buy":
                self.buy(size=cmd.qty)
            elif cmd.op == "market_sell":
                self.sell(size=cmd.qty)
            elif cmd.op == "close_all":
                self.close()
            elif cmd.op == "close_long":
                if self.position.size > 0:
                    self.sell(size=min(float(cmd.qty), float(self.position.size)))
            elif cmd.op == "close_short":
                if self.position.size < 0:
                    self.buy(size=min(float(cmd.qty), float(abs(self.position.size))))
            elif cmd.op == "sell_limit":
                self.sell(size=cmd.qty, price=cmd.price, exectype=bt.Order.Limit)
            elif cmd.op == "buy_limit":
                self.buy(size=cmd.qty, price=cmd.price, exectype=bt.Order.Limit)


def get_zones(ohlc: pd.DataFrame, params: dict | None = None) -> list:
    df = _norm_ohlc_df(ohlc)
    p = _params_from_dict({**PARAMS, **VIEW_PARAMS, **(params or {})})
    zones, _, _ = replay_view_ohlc(df, p)
    return zones


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> list:
    df = _norm_ohlc_df(ohlc)
    p = _params_from_dict({**PARAMS, **VIEW_PARAMS, **(params or {})})
    _, lines, _ = replay_view_ohlc(df, p)
    return lines


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list:
    df = _norm_ohlc_df(ohlc)
    p = _params_from_dict({**PARAMS, **VIEW_PARAMS, **(params or {})})
    _, _, mk = replay_view_ohlc(df, p)
    return mk
