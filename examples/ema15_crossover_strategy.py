"""
EMA 15 Crossover Strategy
- Long: když cena překročí EMA 15 nahoru
- Short: když cena překročí EMA 15 dolů
- 1 kontrakt (futures NQ)
"""

import backtrader as bt


class Strategy(bt.Strategy):
    params = (
        ("ema_period", 15),
    )

    def __init__(self):
        self.ema = bt.indicators.EMA(self.data.close, period=self.params.ema_period)

    def next(self):
        if len(self) < 2:
            return

        prev_close = self.data.close[-1]
        prev_ema = self.ema[-1]
        close = self.data.close[0]
        ema = self.ema[0]

        # Překročení nahoru (cross above EMA)
        if prev_close <= prev_ema and close > ema:
            if self.position.size < 0:
                self.buy(size=1)  # zavřít short
            elif self.position.size == 0:
                self.buy(size=1)  # otevřít long

        # Překročení dolů (cross below EMA)
        elif prev_close >= prev_ema and close < ema:
            if self.position.size > 0:
                self.sell(size=1)  # zavřít long
            elif self.position.size == 0:
                self.sell(size=1)  # otevřít short
