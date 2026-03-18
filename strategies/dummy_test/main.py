# -*- coding: utf-8 -*-
"""
Dummy test strategie – jeden nákup, SL 1000 bodů, TP 1000 bodů.

Pro NQ (mult=20): 1000 bodů = 20 000 USD.
Očekávaný výsledek: +20 000 USD (TP) nebo -20 000 USD (SL), bez slippage.
"""

import backtrader as bt

PARAMS = {
    "stop_points": 1000,
    "target_points": 1000,
}


class Strategy(bt.Strategy):
    params = (
        ("stop_points", 1000),
        ("target_points", 1000),
        # Absorb params that may be passed from modules/UI (prevents TypeError)
        ("swing_tf", "1d"),
        ("timeframe", "1d"),
        ("module_params", {}),
    )

    def __init__(self):
        self._entry_price = None
        self._stop_order = None

    def notify_order(self, order):
        if order.status != order.Completed:
            return
        if order.isbuy() and self.position.size > 0:
            # Entry vyplněn – nastavíme SL a budeme kontrolovat TP
            self._entry_price = order.executed.price
            stop_price = self._entry_price - self.params.stop_points
            self._stop_order = self.sell(size=1, exectype=bt.Order.Stop, price=stop_price)
        elif order == self._stop_order:
            self._stop_order = None

    def next(self):
        # Bar 1: koupit 1 kontrakt na market
        if len(self) == 1 and self.position.size == 0:
            self.buy(size=1)
            return

        # V pozici – kontrola TP (SL je přes stop order)
        if self.position.size > 0 and self._entry_price is not None:
            target_price = self._entry_price + self.params.target_points
            bar_high = float(self.data.high[0])

            # TP hitnut?
            if bar_high >= target_price:
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._entry_price = None
                return

            # SL se řeší přes stop order – ten se vyplní automaticky
