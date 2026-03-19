# -*- coding: utf-8 -*-
"""
Test strategie – EMA 120 (built-in Backtrader indikátor).

Logika (long-only, smoke-test engine + dat):
  • Nakoupit, když close aktuálního baru je **nad** EMA(120).
  • Prodat (zavřít long), když close je **pod** EMA(120).

Žádné externí moduly/indikátory – vhodné pro ověření datového feedu a brokeru.
"""

import backtrader as bt

PARAMS = {
    "ema_period": 120,
}


class Strategy(bt.Strategy):
    params = (
        ("ema_period", 120),
        # Absorb params from UI / modules (prevents TypeError when extra keys are passed)
        ("swing_tf", "1d"),
        ("timeframe", "1d"),
        ("module_params", {}),
    )

    def __init__(self):
        self.ema = bt.ind.ExponentialMovingAverage(
            self.data.close,
            period=int(self.p.ema_period),
        )

    def next(self):
        # Dokud EMA nemá dostatek barů, Backtrader obvykle nevolá next dřív;
        # pojistka pro vlastní feedy:
        if len(self) < self.p.ema_period:
            return

        close = float(self.data.close[0])
        ema_val = float(self.ema[0])

        if close > ema_val and not self.position:
            self.buy(size=1)
        elif close < ema_val and self.position:
            self.close()
