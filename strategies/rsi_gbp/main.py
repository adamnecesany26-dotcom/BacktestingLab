# -*- coding: utf-8 -*-
"""
Breakout swing strategie (trend + komprese + kvalita svíčky).

Logika (shrnutí):
* Trend: long jen při Close > EMA(50) a EMA(50) > EMA(200); short opačně.
* Komprese: ATR(14) < SMA(ATR(14), 20) na breakout svíčce.
* Breakout long: Close > max(High dokončených 20 předchozích svíček) (aktuální bar se do max nepočítá).
* Breakout short: Close < min(Low těchže 20 svíček).
* Kvalita svíčky: range > 1.2*ATR, tělo/range > 0.6, close u extrému > 0.7, range < 2.5*ATR.
* Vstup: na open **následující** svíčky po splnění (pending), SL = Low/High breakout svíčky, TP = 2R.
* Konzervace při současném zásahu SL+TP v jedné svíčce: předpoklad nejdřív SL.

Časový rámec: periody jsou v **počtu svíček** dat feedu.
Smoke test: ``smoke_trade_every_bars`` (obchoduje se mimo tento setup).
"""

from __future__ import annotations

import backtrader as bt

PARAMS = {
    "smoke_trade_every_bars": 0,
    "ema_trend_fast": 50,
    "ema_trend_slow": 200,
    "atr_period": 14,
    "atr_sma_period": 20,
    "breakout_lookback": 20,
    "body_ratio_min": 0.6,
    "close_extreme_ratio": 0.7,
    "expansion_atr_mult": 1.2,
    "max_range_atr_mult": 2.5,
    "rrr": 2.0,
    "lot_size": 1.0,
}


class Strategy(bt.Strategy):
    params = (
        ("smoke_trade_every_bars", 0),
        ("ema_trend_fast", 50),
        ("ema_trend_slow", 200),
        ("atr_period", 14),
        ("atr_sma_period", 20),
        ("breakout_lookback", 20),
        ("body_ratio_min", 0.6),
        ("close_extreme_ratio", 0.7),
        ("expansion_atr_mult", 1.2),
        ("max_range_atr_mult", 2.5),
        ("rrr", 2.0),
        ("lot_size", 1.0),
        ("swing_tf", "30m"),
        ("timeframe", "30m"),
        ("data_timeframe", None),
        ("work_timeframe", None),
        ("module_params", {}),
    )

    def __init__(self):
        ef = max(int(self.p.ema_trend_fast), 2)
        es = max(int(self.p.ema_trend_slow), ef + 1)

        self.ema_fast = bt.ind.EMA(self.data.close, period=ef)
        self.ema_slow = bt.ind.EMA(self.data.close, period=es)

        ap = max(int(self.p.atr_period), 2)
        asp = max(int(self.p.atr_sma_period), 2)
        self.atr = bt.ind.ATR(self.data, period=ap)
        self.sma_atr = bt.ind.SMA(self.atr, period=asp)

        self._pending: dict | None = None
        self._sl: float | None = None
        self._tp: float | None = None

        lb = max(int(self.p.breakout_lookback), 2)
        self._warm = es + asp + ap + lb + 5

    def _size(self) -> float:
        return max(float(self.p.lot_size), 1e-9)

    def _prior_n_high(self, n: int) -> float | None:
        if len(self) <= n:
            return None
        return max(float(self.data.high[-i]) for i in range(1, n + 1))

    def _prior_n_low(self, n: int) -> float | None:
        if len(self) <= n:
            return None
        return min(float(self.data.low[-i]) for i in range(1, n + 1))

    def _candle_quality_long(self, o: float, h: float, l: float, c: float, atrv: float) -> bool:
        rng = h - l
        eps = self._quote_eps()
        if rng <= eps:
            return False
        exp_m = float(self.p.expansion_atr_mult)
        max_m = float(self.p.max_range_atr_mult)
        body_min = float(self.p.body_ratio_min)
        ex_min = float(self.p.close_extreme_ratio)
        if not (rng > exp_m * atrv):
            return False
        if not (abs(c - o) / rng > body_min):
            return False
        if not ((c - l) / rng > ex_min):
            return False
        if not (rng < max_m * atrv):
            return False
        return True

    def _quote_eps(self) -> float:
        try:
            px = abs(float(self.data.close[0]))
            return max(1e-9, px * 1e-10)
        except Exception:
            return 1e-9

    def _candle_quality_short(self, o: float, h: float, l: float, c: float, atrv: float) -> bool:
        rng = h - l
        eps = self._quote_eps()
        if rng <= eps:
            return False
        exp_m = float(self.p.expansion_atr_mult)
        max_m = float(self.p.max_range_atr_mult)
        body_min = float(self.p.body_ratio_min)
        ex_min = float(self.p.close_extreme_ratio)
        if not (rng > exp_m * atrv):
            return False
        if not (abs(c - o) / rng > body_min):
            return False
        if not ((h - c) / rng > ex_min):
            return False
        if not (rng < max_m * atrv):
            return False
        return True

    def _try_pending_entry(self) -> None:
        if self._pending is None or self.position.size != 0:
            return

        p = self._pending
        self._pending = None
        entry = float(self.data.open[0])

        if p["side"] == "long":
            sl = float(p["stop"])
            r = entry - sl
            if r <= 0:
                self._sl = self._tp = None
                return
            tp = entry + float(self.p.rrr) * r
            self.buy(size=self._size())
            self._sl, self._tp = sl, tp
        else:
            sl = float(p["stop"])
            r = sl - entry
            if r <= 0:
                self._sl = self._tp = None
                return
            tp = entry - float(self.p.rrr) * r
            self.sell(size=self._size())
            self._sl, self._tp = sl, tp

    def _manage_open_position(self) -> None:
        if self.position.size == 0 or self._sl is None or self._tp is None:
            return

        low0 = float(self.data.low[0])
        high0 = float(self.data.high[0])

        if self.position.size > 0:
            hit_sl = low0 <= self._sl
            hit_tp = high0 >= self._tp
            if hit_sl and hit_tp:
                self.close()
            elif hit_sl:
                self.close()
            elif hit_tp:
                self.close()
        else:
            hit_sl = high0 >= self._sl
            hit_tp = low0 <= self._tp
            if hit_sl and hit_tp:
                self.close()
            elif hit_sl:
                self.close()
            elif hit_tp:
                self.close()

    def next(self):
        if len(self) < self._warm:
            return

        smoke = int(getattr(self.p, "smoke_trade_every_bars", 0) or 0)
        if smoke > 0:
            k = len(self) - self._warm
            if k > 0 and k % smoke == 0:
                if int(self.position.size) == 0:
                    self._pending = None
                    self._sl = self._tp = None
                    self.buy(size=self._size())
                else:
                    self.close()
                    self._sl = self._tp = None
            return

        if self.position.size != 0:
            self._manage_open_position()

        if self.position.size == 0:
            self._sl = self._tp = None
            self._try_pending_entry()
            if self.position.size != 0:
                self._manage_open_position()

        if self.position.size != 0:
            return

        lb = max(int(self.p.breakout_lookback), 2)
        hh_prior = self._prior_n_high(lb)
        ll_prior = self._prior_n_low(lb)
        if hh_prior is None or ll_prior is None:
            return

        atrv = float(self.atr[0])
        smav = float(self.sma_atr[0])
        if atrv <= 0 or smav <= 0:
            return

        c0 = float(self.data.close[0])
        h0 = float(self.data.high[0])
        l0 = float(self.data.low[0])
        o0 = float(self.data.open[0])

        ema_f = float(self.ema_fast[0])
        ema_s = float(self.ema_slow[0])

        compress = atrv < smav

        long_trend = c0 > ema_f and ema_f > ema_s
        short_trend = c0 < ema_f and ema_f < ema_s

        long_break = c0 > hh_prior
        short_break = c0 < ll_prior

        long_ok = (
            long_trend
            and compress
            and long_break
            and self._candle_quality_long(o0, h0, l0, c0, atrv)
        )
        short_ok = (
            short_trend
            and compress
            and short_break
            and self._candle_quality_short(o0, h0, l0, c0, atrv)
        )

        if long_ok and not short_ok:
            self._pending = {"side": "long", "stop": l0}
        elif short_ok and not long_ok:
            self._pending = {"side": "short", "stop": h0}
        else:
            self._pending = None
