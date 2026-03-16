# -*- coding: utf-8 -*-
"""
Swing HL strategie - Long při 3× Higher High, Short při 3× Lower Low.

Vyžaduje modul Swing HL (from modules.Swing_HL import get_swings).
V panelu Moduly vyber "Swing HL" a potvrď.

REŽIM BEZ OBCHODŮ: next() nic nedělá – jen prohlédnutí Results (Equity, Moduly, …).
"""

import os
import backtrader as bt
from modules.HL_identificator import get_swings

PARAMS = {
    "swing_tf": "1d",
    "hh_count": 3,
    "ll_count": 3,
}


def _get_ohlc_to_current(strat) -> "pd.DataFrame":
    """Vrátí OHLC DataFrame od začátku do aktuálního baru (včetně)."""
    import pandas as pd

    n = len(strat)
    if n <= 0:
        return pd.DataFrame()
    dates = [strat.data.datetime.datetime(-i) for i in range(n - 1, -1, -1)]
    opens = [float(strat.data.open[-i]) for i in range(n - 1, -1, -1)]
    highs = [float(strat.data.high[-i]) for i in range(n - 1, -1, -1)]
    lows = [float(strat.data.low[-i]) for i in range(n - 1, -1, -1)]
    closes = [float(strat.data.close[-i]) for i in range(n - 1, -1, -1)]
    df = pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes},
        index=pd.DatetimeIndex(dates),
    )
    return df


class Strategy(bt.Strategy):
    params = (
        ("swing_tf", "1d"),
        ("hh_count", 3),
        ("ll_count", 3),
        ("module_params", {}),
    )

    def __init__(self):
        pass

    def next(self):
        # Žádné obchody – jen prohlédnutí Results záložky (Equity, Moduly, …)
        return
