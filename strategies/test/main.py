# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — strategies/test/main.py — strategie — celý soubor vložit do Firestore (Strategie → main.py).
"""
Test strategie – EMA křížení (rychlá / pomalá), long i short.

Účel: smoke-test engineu (signály, obchody, reverze pozice), ne hledání edge.

Logika:
  • Long: rychlá EMA se podle předchozího a aktuálního baru překříží **nad** pomalou.
  • Short: rychlá EMA se překříží **pod** pomalou.
  • Konstantní velikost pozice (`stake`) – ruční rebalance `delta = target - position` přes **pouze** `buy(size=…)` / `sell(size=…)`
    (v Backtraderu je u `buy`/`sell`/`order_target_size` první poziční argument vždy `data`, ne velikost — `buy(1)` je chyba).
  • Volitelně fixní SL / TP vůči vstupní ceně obchodu (notify_trade): např. −1 % / +2 % u longu,
    u shortu symetricky (cena proti pozici = stop, ve prospěch = TP).

Žádné externí moduly – jen built-in Backtrader indikátory.
"""

import backtrader as bt

PARAMS = {
    "ema_fast": 20,
    "ema_slow": 50,
    "stake": 1,
    "use_stops": True,
    "stop_loss_pct": 0.01,
    "take_profit_pct": 0.02,
}


class Strategy(bt.Strategy):
    params = (
        ("ema_fast", 20),
        ("ema_slow", 50),
        ("stake", 1),
        ("use_stops", True),
        ("stop_loss_pct", 0.01),
        ("take_profit_pct", 0.02),
        # Absorb params from UI / engine (prevents TypeError when extra keys are passed)
        ("swing_tf", "1d"),
        ("timeframe", "1d"),
        ("data_timeframe", None),
        ("work_timeframe", None),
        ("module_params", {}),
    )

    def __init__(self):
        ef = int(self.p.ema_fast)
        es = int(self.p.ema_slow)
        self.ema_fast_line = bt.ind.ExponentialMovingAverage(self.data.close, period=ef)
        self.ema_slow_line = bt.ind.ExponentialMovingAverage(self.data.close, period=es)
        self._warmup = max(ef, es) + 1
        self.entry_price = None

    def _rebalance_to(self, target: int) -> None:
        """Stejná logika jako order_target_size, ale bez rizika špatných pozičních argumentů BT API."""
        pos = int(self.position.size)
        delta = int(target) - pos
        if delta == 0:
            return
        if delta > 0:
            self.buy(size=delta)
        else:
            self.sell(size=-delta)

    def notify_trade(self, trade):
        if trade.isopen:
            self.entry_price = float(trade.price)
        elif trade.isclosed and not self.position:
            self.entry_price = None

    def next(self):
        if len(self) < self._warmup:
            return

        # --- Risk: fixní SL / TP (na close baru; jednoduchý model pro dummy) ---
        if self.position and self.p.use_stops and self.entry_price is not None:
            sl = float(self.p.stop_loss_pct)
            tp = float(self.p.take_profit_pct)
            ep = float(self.entry_price)
            c = float(self.data.close[0])

            if self.position.size > 0:
                if c <= ep * (1.0 - sl) or c >= ep * (1.0 + tp):
                    self.close()
                    return
            elif self.position.size < 0:
                if c >= ep * (1.0 + sl) or c <= ep * (1.0 - tp):
                    self.close()
                    return

        f0, f1 = float(self.ema_fast_line[0]), float(self.ema_fast_line[-1])
        s0, s1 = float(self.ema_slow_line[0]), float(self.ema_slow_line[-1])

        bullish_cross = f0 > s0 and f1 <= s1
        bearish_cross = f0 < s0 and f1 >= s1

        stake = int(self.p.stake)
        if bullish_cross:
            self._rebalance_to(stake)
        elif bearish_cross:
            self._rebalance_to(-stake)
