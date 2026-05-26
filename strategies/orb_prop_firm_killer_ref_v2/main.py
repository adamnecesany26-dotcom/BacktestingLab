# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — strategies/orb_prop_firm_killer_ref_v2/main.py
"""
**ORB Prop Firm Killer — verze 2 (Python).**

Implementace podle ``strategies/orb/orb-reference.md`` (hybrid ORB / SSRN konsensus),
ne podle Pine skriptu. Verze 1 (Pine parity) je v ``strategies/orb_prop_firm_killer/``.

Výchozí sizing: **2 kontrakty** (Fixed), **partial @ 1R** (1 lot off, zbytek běží na TP) — lze vypnout partial
nebo snížit na 1 kontrakt pro „full TP“ bez škálování.

Viz modul ``orb_reference_core.py`` pro přesný rozsah a meze oproti PDF zdrojům.
"""

from __future__ import annotations

import sys
from pathlib import Path

import backtrader as bt
import pandas as pd

_REPO = Path(__file__).resolve().parent.parent.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from strategies.orb_prop_firm_killer_ref_v2.orb_reference_core import (
    RefOrbState,
    replay_view_ohlc_ref,
    step_orb_reference,
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
    def b(key, default=False):
        v = p.get(key, default)
        if v in (1, "1", "true", "True", True):
            return True
        if v in (0, "0", "false", "False", False, None, ""):
            return False
        return bool(v)

    return {
        "strat_mode": str(p.get("strat_mode", "standard") or "standard"),
        "or_minutes_standard": int(p.get("or_minutes_standard", 5) or 5),
        "or_minutes_gap": int(p.get("or_minutes_gap", 30) or 30),
        "gap_min_pct": float(p.get("gap_min_pct", 2.0) or 2.0),
        "session": str(p.get("session", "0930-1600")),
        "close_break_confirm": b("close_break_confirm", False),
        "entry_next_open": b("entry_next_open", True),
        "use_uni": b("use_uni", False),
        "min_price": float(p.get("min_price", 5.0) or 5.0),
        "min_avg_vol": float(p.get("min_avg_vol", 500_000) or 0.0),
        "use_rel_vol": b("use_rel_vol", False),
        "rel_vol_min": float(p.get("rel_vol_min", 2.0) or 2.0),
        "rel_vol_back": int(p.get("rel_vol_back", 14) or 14),
        "atr_len": int(p.get("atr_len", 14) or 14),
        "atr_mult_cap": float(p.get("atr_mult_cap", 1.0) or 1.0),
        "risk_pct": float(p.get("risk_pct", 1.0) or 1.0),
        "pos_mode": str(p.get("pos_mode", "Fixed Contracts") or "Fixed Contracts"),
        "contracts": float(p.get("contracts", 2.0) or 2.0),
        "use_partial_1r": b("use_partial_1r", True),
        "partial_1r_qty": int(p.get("partial_1r_qty", 1) or 0),
        "partial_1r_r": float(p.get("partial_1r_r", 1.0) or 1.0),
        "min_contracts_ladder": float(p.get("min_contracts_ladder", 2.0) or 2.0),
        "profit_target_r": float(p.get("profit_target_r", 10.0) or 10.0),
        "k_or_range": float(p.get("k_or_range", 2.0) or 2.0),
        "false_break_exit_minutes": int(p.get("false_break_exit_minutes", 30) or 0),
        "vol_adv_fraction": float(p.get("vol_adv_fraction", 0.5) or 0.5),
        "require_break_volume": b("require_break_volume", False),
        "or_break_buffer": float(p.get("or_break_buffer", 0.0) or 0.0),
        "time_exit_minutes_before_close": int(p.get("time_exit_minutes_before_close", 15) or 15),
        "max_trades": int(p.get("max_trades", 1) or 1),
        "relaxed_bt": b("relaxed_bt", True),
        "max_spread_pct": float(p.get("max_spread_pct", 0.0) or 0.0),
        "assume_spread_pct": float(p.get("assume_spread_pct", 0.0) or 0.0),
        "use_dow": b("use_dow", False),
        "dow_mon": b("dow_mon", True),
        "dow_tue": b("dow_tue", False),
        "dow_wed": b("dow_wed", True),
        "dow_thu": b("dow_thu", False),
        "dow_fri": b("dow_fri", True),
        "tick_size": float(p.get("tick_size", 0.25) or 0.25),
        "skip_macro_dates": str(p.get("skip_macro_dates", "") or ""),
        "use_vix_gate": b("use_vix_gate", False),
        "vix_min": float(p.get("vix_min", 15.0) or 15.0),
        "vix_max": float(p.get("vix_max", 25.0) or 25.0),
        "vix_series_value": p.get("vix_series_value"),
    }


PARAMS = {
    "process_orders_on_close": True,
    "strat_mode": "standard",
    "or_minutes_standard": 5,
    "or_minutes_gap": 30,
    "gap_min_pct": 2.0,
    "session": "0930-1600",
    "close_break_confirm": False,
    "entry_next_open": True,
    "use_uni": False,
    "min_price": 5.0,
    "min_avg_vol": 500_000.0,
    "use_rel_vol": False,
    "rel_vol_min": 2.0,
    "rel_vol_back": 14,
    "atr_len": 14,
    "atr_mult_cap": 1.0,
    "risk_pct": 1.0,
    "pos_mode": "Fixed Contracts",
    "contracts": 2.0,
    "use_partial_1r": True,
    "partial_1r_qty": 1,
    "partial_1r_r": 1.0,
    "min_contracts_ladder": 2.0,
    "profit_target_r": 10.0,
    "k_or_range": 2.0,
    "false_break_exit_minutes": 30,
    "vol_adv_fraction": 0.5,
    "require_break_volume": False,
    "or_break_buffer": 0.0,
    "time_exit_minutes_before_close": 15,
    "max_trades": 1,
    "relaxed_bt": True,
    "max_spread_pct": 0.0,
    "assume_spread_pct": 0.0,
    "use_dow": False,
    "dow_mon": True,
    "dow_tue": False,
    "dow_wed": True,
    "dow_thu": False,
    "dow_fri": True,
    "tick_size": 0.25,
    "skip_macro_dates": "",
    "use_vix_gate": False,
    "vix_min": 15.0,
    "vix_max": 25.0,
    "vix_series_value": None,
}

PARAMS_META = {
    "process_orders_on_close": {
        "title": "Process orders on close",
        "what_it_means": "Shodně s ostatními strategiemi v enginu — fill na close baru.",
        "booleanWidget": True,
    },
    "strat_mode": {
        "title": "Režim (spec §2)",
        "options": "standard|gap_and_go",
        "option_labels": "Standard 5m OR|Gap-and-go (≥ gap %, 30m OR, long)",
    },
    "or_minutes_standard": {"title": "OR délka — standard (min)"},
    "or_minutes_gap": {"title": "OR délka — gap_and_go (min)"},
    "gap_min_pct": {"title": "Min gap % (jen gap_and_go)", "depends_on_param": "strat_mode", "depends_on_values": "gap_and_go"},
    "session": {"title": "Session (NY)"},
    "close_break_confirm": {
        "title": "Breakout potvrzený closem",
        "what_it_means": "§2.1 — close nad/pod OR; jinak intrabar high/low.",
        "booleanWidget": True,
    },
    "entry_next_open": {
        "title": "Vstup na open dalšího baru",
        "what_it_means": "§2.1 konzervativní model po triggeru.",
        "booleanWidget": True,
    },
    "use_uni": {"title": "Universe (§3)", "booleanWidget": True},
    "min_price": {"title": "Min cena (denní open)", "depends_on_param": "use_uni", "depends_on_values": "1|true|True"},
    "min_avg_vol": {"title": "Min 14d avg volume (proxy §3)", "depends_on_param": "use_uni", "depends_on_values": "1|true|True"},
    "use_rel_vol": {"title": "Rel. objem OR (in-play)", "booleanWidget": True},
    "rel_vol_min": {"title": "Min RelVol", "depends_on_param": "use_rel_vol", "depends_on_values": "1|true|True"},
    "rel_vol_back": {"title": "RelVol lookback (dny)", "depends_on_param": "use_rel_vol", "depends_on_values": "1|true|True"},
    "atr_len": {"title": "ATR délka (denní)"},
    "atr_mult_cap": {"title": "ATR cap násobek (§6)"},
    "risk_pct": {"title": "% rizika na obchod (§6)", "depends_on_param": "pos_mode", "depends_on_values": "% Equity Risk"},
    "pos_mode": {
        "title": "Velikost pozice",
        "options": "Fixed Contracts|% Equity Risk",
        "option_labels": "Pevný počet kontr.|% kapitálu / trade",
    },
    "contracts": {"title": "Kontrakty (pevně)", "depends_on_param": "pos_mode", "depends_on_values": "Fixed Contracts"},
    "use_partial_1r": {"title": "Partial @ 1R (limit)", "booleanWidget": True},
    "partial_1r_qty": {"title": "Partial — počet kontraktů", "depends_on_param": "use_partial_1r", "depends_on_values": "1|true|True"},
    "partial_1r_r": {"title": "Partial — R násobek", "depends_on_param": "use_partial_1r", "depends_on_values": "1|true|True"},
    "min_contracts_ladder": {
        "title": "Min kontrakty (s partial)",
        "what_it_means": "Když je partial zapnutý, sizing se nejméně přibumpuje na partial + runner.",
        "depends_on_param": "use_partial_1r",
        "depends_on_values": "1|true|True",
    },
    "profit_target_r": {"title": "TP × R (standard, §7)"},
    "k_or_range": {"title": "TP k × šířka OR (gap_and_go)", "depends_on_param": "strat_mode", "depends_on_values": "gap_and_go"},
    "false_break_exit_minutes": {"title": "False-break okno (min, 0=vyp)"},
    "vol_adv_fraction": {"title": "Break objem ≥ × denní průměr"},
    "require_break_volume": {"title": "Vyžadovat objem na break baru", "booleanWidget": True},
    "or_break_buffer": {"title": "Buffer nad/pod OR (cena)"},
    "time_exit_minutes_before_close": {"title": "Uzavřít před koncem (min)"},
    "max_trades": {"title": "Max obchodů / den"},
    "relaxed_bt": {"title": "Relaxed test", "booleanWidget": True},
    "max_spread_pct": {"title": "Max spread % (§8 synteticky)"},
    "assume_spread_pct": {"title": "Předpokládaný spread %"},
    "use_dow": {"title": "Filtr dne v týdnu (§4)", "booleanWidget": True},
    "dow_mon": {"title": "Po", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_tue": {"title": "Út", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_wed": {"title": "St", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_thu": {"title": "Čt", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "dow_fri": {"title": "Pá", "depends_on_param": "use_dow", "depends_on_values": "1|true|True"},
    "tick_size": {"title": "Mintick"},
    "skip_macro_dates": {"title": "Vynechat datumy (ISO, čárka)"},
    "use_vix_gate": {"title": "VIX pásmo (§4, potřeba hodnota)", "booleanWidget": True},
    "vix_min": {"title": "VIX min", "depends_on_param": "use_vix_gate", "depends_on_values": "1|true|True"},
    "vix_max": {"title": "VIX max", "depends_on_param": "use_vix_gate", "depends_on_values": "1|true|True"},
    "vix_series_value": {"title": "VIX (ručně pro backtest)", "depends_on_param": "use_vix_gate", "depends_on_values": "1|true|True"},
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
        self._ost = RefOrbState()
        self._closed_trades = 0
        self._p = {k: getattr(self.p, k) for k in PARAMS}

    def notify_trade(self, trade):
        if trade.isclosed:
            self._closed_trades += 1

    def _pd(self) -> dict:
        d = {k: getattr(self.p, k) for k in PARAMS}
        return _params_from_dict(d)

    def next(self):
        dt = bt.num2date(self.data.datetime[0])
        pos = float(self.position.size)
        eq = float(self.broker.getvalue())
        cmds = step_orb_reference(
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
    zones, _, _ = replay_view_ohlc_ref(df, p)
    return zones


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> list:
    df = _norm_ohlc_df(ohlc)
    p = _params_from_dict({**PARAMS, **VIEW_PARAMS, **(params or {})})
    _, lines, _ = replay_view_ohlc_ref(df, p)
    return lines


def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list:
    df = _norm_ohlc_df(ohlc)
    p = _params_from_dict({**PARAMS, **VIEW_PARAMS, **(params or {})})
    _, _, mk = replay_view_ohlc_ref(df, p)
    return mk
