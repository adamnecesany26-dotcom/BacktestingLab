# -*- coding: utf-8 -*-
"""
Deterministic order-behavior probes for the Backtrader stack (market / limit / bracket / partial).

Used by backend/tests/test_mnq_unit_order_audit.py with OHLC scripted on top of real MNQ timestamps.
"""

from __future__ import annotations

import backtrader as bt

PARAMS = {
    "scenario": "bracket_sl",
    "trigger_bar": 6,
    "stake": 2,
}


class Strategy(bt.Strategy):
    params = tuple((k, PARAMS[k]) for k in PARAMS) + (
        ("swing_tf", "1m"),
        ("timeframe", "1m"),
        ("data_timeframe", None),
        ("work_timeframe", None),
        ("module_params", {}),
    )

    def __init__(self):
        self.audit: list[dict] = []
        self._entry_px: float | None = None
        self._partial_phase = 0

    def notify_order(self, order):
        super().notify_order(order)
        if order.status == order.Completed:
            self.audit.append(
                {
                    "isbuy": bool(order.isbuy()),
                    "size": float(abs(order.executed.size)),
                    "price": float(order.executed.price),
                    "exectype": int(order.exectype),
                }
            )
            if self.p.scenario == "partial_scale" and order.isbuy() and self._partial_phase == 0:
                self._entry_px = float(order.executed.price)
                self._partial_phase = 1

    def next(self):
        sc = str(self.p.scenario)
        t = int(self.p.trigger_bar)
        st = int(self.p.stake)

        if sc == "bracket_sl":
            if len(self) == t and not self.position:
                c = float(self.data.close[0])
                self.buy_bracket(
                    size=st,
                    exectype=bt.Order.Market,
                    stopprice=c - 10.0,
                    limitprice=c + 30.0,
                )
            return

        if sc == "bracket_tp":
            if len(self) == t and not self.position:
                c = float(self.data.close[0])
                self.buy_bracket(
                    size=st,
                    exectype=bt.Order.Market,
                    stopprice=c - 40.0,
                    limitprice=c + 12.0,
                )
            return

        if sc == "bracket_same_bar":
            # Both stop and limit touched same bar; broker ordering should favor stop (conservative for long SL).
            if len(self) == t and not self.position:
                c = float(self.data.close[0])
                self.buy_bracket(
                    size=st,
                    exectype=bt.Order.Market,
                    stopprice=c - 5.0,
                    limitprice=c + 10.0,
                )
            return

        if sc == "limit_entry":
            if len(self) == t and not self.position:
                c = float(self.data.close[0])
                self.buy(size=st, price=c - 4.0, exectype=bt.Order.Limit)
            elif len(self) == t + 14 and self.position:
                self.close()
            return

        if sc == "market_next_open":
            if len(self) == t and not self.position:
                self.buy(size=st)
            elif len(self) == t + 14 and self.position:
                self.close()
            return

        if sc == "roundtrip_short":
            if len(self) == t and not self.position:
                self.sell(size=st)
            elif len(self) == t + 3 and self.position.size < 0:
                self.buy(size=abs(int(self.position.size)))
            return

        if sc == "partial_scale":
            half = max(1, st // 2)
            rest = st - half
            if len(self) == t and not self.position and self._partial_phase == 0:
                self.buy(size=st)
            elif (
                len(self) == t + 1
                and int(self.position.size) == st
                and self._partial_phase == 1
                and self._entry_px is not None
            ):
                self.sell(size=half, price=self._entry_px + 6.0, exectype=bt.Order.Limit)
                self._partial_phase = 2
            elif (
                len(self) == t + 2
                and int(self.position.size) == rest
                and self._partial_phase == 2
                and self._entry_px is not None
            ):
                self.sell(size=rest, price=self._entry_px - 5.0, exectype=bt.Order.Stop)
                self._partial_phase = 3
            return

