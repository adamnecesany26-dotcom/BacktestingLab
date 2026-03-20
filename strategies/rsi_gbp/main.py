# -*- coding: utf-8 -*-
"""
RSI strategie pro Backtesting app (Backtrader) – není 1:1 Pine z TradingView,
ale stejná myšlenka: překřížení RSI s pásmy + fixní TP/SL v USD (forex / GBP páry).

Logika:
  • Long: RSI v předchozím baru ≤ oversold a v aktuálním > oversold (výstup z přeprodanosti).
  • Short: RSI v předchozím ≥ overbought a v aktuálním < overbought (vstup z překoupení).
  • Uzavření: křížení opačného pásma, nebo TP +400 USD / SL −250 USD podle vzdálenosti v ceně
    z odhadu: USD na pip = pip_value × lot_size (hodnoty z UI / broker config se sloučí do params).

Nastav v aplikaci Instrument Type = Forex, správný lot, pip size a pip value pro svůj pár (např. GBPUSD).
"""

import backtrader as bt

PARAMS = {
    "rsi_period": 14,
    "rsi_os": 30,
    "rsi_ob": 70,
    "take_profit_usd": 400.0,
    "stop_loss_usd": 250.0,
    "lot_size": 1.0,
    "pip_size": 0.0001,
    "pip_value": 10.0,
}


class Strategy(bt.Strategy):
    params = (
        ("rsi_period", 14),
        ("rsi_os", 30),
        ("rsi_ob", 70),
        ("take_profit_usd", 400.0),
        ("stop_loss_usd", 250.0),
        ("lot_size", 1.0),
        ("pip_size", 0.0001),
        ("pip_value", 10.0),
        ("swing_tf", "1d"),
        ("timeframe", "1d"),
        ("data_timeframe", None),
        ("work_timeframe", None),
        ("module_params", {}),
    )

    def __init__(self):
        self.rsi = bt.ind.RSI(self.data.close, period=int(self.p.rsi_period))

    def _size(self) -> float:
        return max(float(self.p.lot_size), 1e-9)

    def _usd_per_pip(self) -> float:
        return max(float(self.p.pip_value) * float(self.p.lot_size), 1e-12)

    def _price_dist_for_usd(self, usd: float) -> float:
        pips = float(usd) / self._usd_per_pip()
        return pips * float(self.p.pip_size)

    def next(self):
        warm = int(self.p.rsi_period) + 2
        if len(self) < warm:
            return

        r0 = float(self.rsi[0])
        r1 = float(self.rsi[-1])
        os_ = float(self.p.rsi_os)
        ob = float(self.p.rsi_ob)
        c = float(self.data.close[0])
        sl_dist = self._price_dist_for_usd(float(self.p.stop_loss_usd))
        tp_dist = self._price_dist_for_usd(float(self.p.take_profit_usd))

        pos = int(self.position.size)
        if pos != 0:
            ep = float(self.position.price)
            if pos > 0:
                if c <= ep - sl_dist or c >= ep + tp_dist:
                    self.close()
                    return
                if r1 >= ob and r0 < ob:
                    self.close()
                    return
            else:
                if c >= ep + sl_dist or c <= ep - tp_dist:
                    self.close()
                    return
                if r1 <= os_ and r0 > os_:
                    self.close()
                    return
            return

        if r1 <= os_ and r0 > os_:
            self.buy(size=self._size())
        elif r1 >= ob and r0 < ob:
            self.sell(size=self._size())
