# -*- coding: utf-8 -*-
"""
S/D Zone Strategy – Long na Demand, Short na Supply.

Vyžaduje moduly: Swing HL, S/D Zones (S_D_Zones).
V panelu Moduly vyber oba a potvrď.

Pravidla:
- Vstup: Každá aktivní zóna má limit order na hranici – vyplní se když cena jakkoliv překryje tuto úroveň.
- Stop: dolní hranice zóny (Demand) / horní hranice (Supply) – trigger když cena navštíví tuto úroveň a TP nebyl hitnut.
- Target: 1) opposing zóna (R:R≥1.5), 2) major swing H/L (R:R≥1.5), 3) fixně 2.0 RRR. Max. RRR 4.0.
- Futures: 1 kontrakt, tick = 5 USD (nebo dle broker_config).
"""

import backtrader as bt
import pandas as pd
from typing import Any

try:
    from modules.Swing_HL import get_major_swings
    from modules.S_D_Zones import get_zones
except ImportError:
    try:
        from modules.HL_identificator import get_major_swings
        from modules.S_D_Zones import get_zones
    except ImportError:
        try:
            from modules.Swing_HL import get_major_swings
            from modules.SD_identificator import get_zones
        except ImportError:
            try:
                from modules.HL_identificator import get_major_swings
                from modules.SD_identificator import get_zones
            except ImportError:
                get_major_swings = None
                get_zones = None


def _debug_log(_msg: str, _data: dict, _hypothesis: str = "") -> None:
    """No-op při backtestu. Pro agent/debug lze nahradit skutečným logováním."""
    pass


PARAMS = {
    "timeframe": "1d",
    "min_rr_zone": 1.5,
    "min_rr_swing": 1.5,
    "fallback_rr": 2.0,
    "max_rr": 4.0,
    "zone_max_bars": 60,
    "max_hold_bars": 30,
    "stop_buffer_pct": 0.0,  # nepoužívá se, zachováno pro zpětnou kompatibilitu
    "stop_width_extra_pct": 0.10,  # SL = opačná hranice + 10 % šířky zóny
}


def _get_ohlc_to_current(strat) -> pd.DataFrame:
    """OHLC od začátku do aktuálního baru (včetně)."""
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


def _to_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _zone_valid_at_bar(zone: dict, current_idx: int) -> bool:
    """Zóna je platná v daný bar – index-based (robustnější než date)."""
    start = zone.get("start_idx")
    end = zone.get("end_idx")
    if start is None or end is None:
        return True
    return start <= current_idx <= end


def _compute_target_demand(
    entry: float,
    stop: float,
    zones: list[dict],
    major_swings: list[dict],
    min_rr_zone: float,
    min_rr_swing: float,
    fallback_rr: float,
) -> float:
    """
    Target pro long: opposing zone (Supply) nebo major_high nebo fixní RRR.
    """
    risk = entry - stop
    if risk <= 0:
        return entry + abs(risk) * fallback_rr

    # 1) Nejbližší Supply zóna nad entry, R:R >= min_rr_zone
    supply_zones = [z for z in zones if z.get("name") == "Supply"]
    candidates = [z for z in supply_zones if float(z.get("value_low", 0)) > entry]
    if candidates:
        nearest = min(candidates, key=lambda z: float(z["value_low"]))
        target = float(nearest["value_low"])
        reward = target - entry
        if reward / risk >= min_rr_zone:
            return target

    # 2) Nejbližší major_high nad entry, R:R >= min_rr_swing
    if major_swings:
        highs = [s for s in major_swings if s.get("type") == "major_high"]
        above = [s for s in highs if float(s.get("price", 0)) > entry]
        if above:
            nearest = min(above, key=lambda s: float(s["price"]))
            target = float(nearest["price"])
            reward = target - entry
            if reward / risk >= min_rr_swing:
                return target

    # 3) Fixní RRR
    return entry + risk * fallback_rr


def _compute_target_supply(
    entry: float,
    stop: float,
    zones: list[dict],
    major_swings: list[dict],
    min_rr_zone: float,
    min_rr_swing: float,
    fallback_rr: float,
) -> float:
    """
    Target pro short: opposing zone (Demand) nebo major_low nebo fixní RRR.
    """
    risk = stop - entry
    if risk <= 0:
        return entry - abs(risk) * fallback_rr

    # 1) Nejbližší Demand zóna pod entry
    demand_zones = [z for z in zones if z.get("name") == "Demand"]
    candidates = [z for z in demand_zones if float(z.get("value_high", 0)) < entry]
    if candidates:
        nearest = max(candidates, key=lambda z: float(z["value_high"]))
        target = float(nearest["value_high"])
        reward = entry - target
        if reward / risk >= min_rr_zone:
            return target

    # 2) Nejbližší major_low pod entry
    if major_swings:
        lows = [s for s in major_swings if s.get("type") == "major_low"]
        below = [s for s in lows if float(s.get("price", 0)) < entry]
        if below:
            nearest = max(below, key=lambda s: float(s["price"]))
            target = float(nearest["price"])
            reward = entry - target
            if reward / risk >= min_rr_swing:
                return target

    # 3) Fixní RRR
    return entry - risk * fallback_rr


class Strategy(bt.Strategy):
    params = (
        ("timeframe", "1d"),
        ("min_rr_zone", 1.5),
        ("min_rr_swing", 1.5),
        ("fallback_rr", 2.0),
        ("max_rr", 4.0),
        ("zone_max_bars", 60),
        ("max_hold_bars", 30),
        ("stop_buffer_pct", 0.0),  # nepoužívá se (stop = hranice zóny), zachováno pro zpětnou kompatibilitu
        ("stop_width_extra_pct", 0.10),  # SL = opačná hranice + 10 % šířky zóny
        ("module_params", {}),
    )

    def __init__(self):
        self._entry_price: float | None = None
        self._stop_price: float | None = None
        self._target_price: float | None = None
        self._entry_zone_key: str | None = None
        self._stop_order: bt.Order | None = None
        self._entry_bar: int = 0
        self._pending_orders: list = []  # [(order, zone_key, entry, stop, target, is_long), ...]

    def notify_order(self, order):
        """Po vyplnění entry umístíme stop order. Při fill zrušíme ostatní pending entry ordery."""
        if order.status in (order.Canceled, order.Margin, order.Rejected):
            if order == self._stop_order:
                self._stop_order = None
            self._pending_orders = [(o, zk, e, s, t, il) for o, zk, e, s, t, il in self._pending_orders if o is not order]
            return
        if order.status != order.Completed:
            return
        if order == self._stop_order:
            self._stop_order = None
            self._reset_trade()
            return
        # 1) Match by identity; 2) fallback: match by executed price (když order není v _pending_orders)
        exec_price = getattr(getattr(order, "executed", None), "price", None) or 0.0
        i = None
        for j, (o, zone_key, entry, stop, target, is_long) in enumerate(self._pending_orders):
            if o is order:
                i = j
                break
        if i is None and exec_price:
            for j, (o, zone_key, entry, stop, target, is_long) in enumerate(self._pending_orders):
                if abs(entry - exec_price) / max(entry, 1e-9) < 0.005:
                    i = j
                    break
        if i is not None:
            _, zone_key, entry, stop, target, is_long = self._pending_orders[i]
            self._pending_orders.pop(i)
            for o2, *_ in list(self._pending_orders):
                self.cancel(o2)
            self._pending_orders.clear()
            self._entry_price = entry
            self._stop_price = stop
            self._target_price = target
            self._entry_zone_key = zone_key
            self._entry_bar = len(self)
            size = abs(order.executed.size)
            if is_long:
                self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop)
            else:
                self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop)

    def next(self):
        if get_zones is None or get_major_swings is None:
            return

        # Již v pozici – kontrola stop/target
        if self.position.size != 0:
            self._check_exit()
            return

        # Potřebujeme min. 30 barů pro zóny
        if len(self) < 30:
            return

        ohlc = _get_ohlc_to_current(self)
        if ohlc.empty or len(ohlc) < 30:
            return

        params = dict(self.params.module_params or {})
        params.setdefault("timeframe", self.params.timeframe)
        params.setdefault("zone_extend_right_bars", self.params.zone_max_bars)

        zones = get_zones(ohlc, params)
        maj_params = {"timeframe": params.get("timeframe", "1d"), **params}
        major_swings = get_major_swings(ohlc, maj_params) if get_major_swings else []

        current_idx = len(ohlc) - 1
        valid_zone_keys: set[str] = set()

        for z in zones:
            if z.get("name") not in ("Demand", "Supply"):
                continue
            if not _zone_valid_at_bar(z, current_idx):
                continue
            zl = float(z["value_low"])
            zh = float(z["value_high"])
            zone_height = zh - zl
            if zone_height <= 0:
                continue

            zone_key = f"{z.get('date_start', '')}|{zl}"
            valid_zone_keys.add(zone_key)

            if zone_key in (item[1] for item in self._pending_orders):
                continue

            extra = zone_height * self.params.stop_width_extra_pct
            if z.get("name") == "Demand":
                entry = zh
                stop = zl - extra  # opačná hranice (low) - 10 % šířky
                target = _compute_target_demand(
                    entry, stop, zones, major_swings,
                    self.params.min_rr_zone, self.params.min_rr_swing, self.params.fallback_rr,
                )
                risk = entry - stop
                if risk > 0:
                    max_target = entry + risk * self.params.max_rr
                    target = min(target, max_target)
                order = self.buy(size=1, exectype=bt.Order.Limit, price=entry)
            else:
                entry = zl
                stop = zh + extra  # opačná hranice (high) + 10 % šířky
                target = _compute_target_supply(
                    entry, stop, zones, major_swings,
                    self.params.min_rr_zone, self.params.min_rr_swing, self.params.fallback_rr,
                )
                risk = stop - entry
                if risk > 0:
                    min_target = entry - risk * self.params.max_rr
                    target = max(target, min_target)
                order = self.sell(size=1, exectype=bt.Order.Limit, price=entry)

            self._pending_orders.append((order, zone_key, entry, stop, target, z.get("name") == "Demand"))

        for item in list(self._pending_orders):
            order, zone_key, *_ = item
            if zone_key not in valid_zone_keys:
                self.cancel(order)
                self._pending_orders.remove(item)

    def _check_exit(self):
        """Target: manuální kontrola. Stop: přes stop order (vyplnění na stop ceně). Max hold: časový exit."""
        # Orphan position: máme pozici ale stop/target nebyly nastaveny (order nebyl v _pending_orders při fill)
        if self._stop_price is None or self._target_price is None:
            # Recovery: zkusíme znovu vypočítat stop/target z aktuálních zón
            if self._recover_stop_target():
                pass  # máme stop/target, pokračujeme normálně
            else:
                self.close()
                self._reset_trade()
                return

        bar_high = float(self.data.high[0])
        bar_low = float(self.data.low[0])

        # Max hold – po X barech bez stop/target zavřeme
        bars_held = len(self) - self._entry_bar
        if bars_held >= self.params.max_hold_bars:
            # #region agent log
            _debug_log("close_max_hold", {"bar": len(self), "bars_held": bars_held}, "C")
            # #endregion
            if self._stop_order:
                self.cancel(self._stop_order)
                self._stop_order = None
            self.close()
            self._reset_trade()
            return

        if self.position.size > 0:
            if bar_high >= self._target_price:
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._reset_trade()
        else:
            if bar_high >= self._stop_price:
                # #region agent log
                _debug_log("close_stop_short", {"bar": len(self)}, "C")
                # #endregion
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._reset_trade()
            elif bar_low <= self._target_price:
                if self._stop_order:
                    self.cancel(self._stop_order)
                    self._stop_order = None
                self.close()
                self._reset_trade()

    def _recover_stop_target(self) -> bool:
        """Obnoví stop/target z aktuálních zón, když notify_order je nenastavil (order nebyl v _pending_orders)."""
        if get_zones is None or get_major_swings is None:
            return False
        entry = self.position.price
        is_long = self.position.size > 0
        ohlc = _get_ohlc_to_current(self)
        if ohlc.empty or len(ohlc) < 30:
            return False
        params = dict(self.params.module_params or {})
        params.setdefault("timeframe", self.params.timeframe)
        params.setdefault("zone_extend_right_bars", self.params.zone_max_bars)
        zones = get_zones(ohlc, params)
        maj_params = {"timeframe": params.get("timeframe", "1d"), **params}
        major_swings = get_major_swings(ohlc, maj_params) if get_major_swings else []
        tol = 0.005  # 0.5 % tolerance pro match entry
        for z in zones:
            if z.get("name") not in ("Demand", "Supply"):
                continue
            zl = float(z["value_low"])
            zh = float(z["value_high"])
            zone_height = zh - zl
            if zone_height <= 0:
                continue
            extra = zone_height * self.params.stop_width_extra_pct
            if z.get("name") == "Demand" and is_long:
                if abs(entry - zh) / zh <= tol:
                    stop = zl - extra
                    target = _compute_target_demand(
                        entry, stop, zones, major_swings,
                        self.params.min_rr_zone, self.params.min_rr_swing, self.params.fallback_rr,
                    )
                    risk = entry - stop
                    if risk > 0:
                        target = min(target, entry + risk * self.params.max_rr)
                    self._entry_price = entry
                    self._stop_price = stop
                    self._target_price = target
                    self._entry_bar = len(self)
                    size = abs(int(self.position.size))
                    self._stop_order = self.sell(size=size, exectype=bt.Order.Stop, price=stop)
                    return True
            elif z.get("name") == "Supply" and not is_long:
                if abs(entry - zl) / zl <= tol:
                    stop = zh + extra
                    target = _compute_target_supply(
                        entry, stop, zones, major_swings,
                        self.params.min_rr_zone, self.params.min_rr_swing, self.params.fallback_rr,
                    )
                    risk = stop - entry
                    if risk > 0:
                        target = max(target, entry - risk * self.params.max_rr)
                    self._entry_price = entry
                    self._stop_price = stop
                    self._target_price = target
                    self._entry_bar = len(self)
                    size = abs(int(self.position.size))
                    self._stop_order = self.buy(size=size, exectype=bt.Order.Stop, price=stop)
                    return True
        return False

    def _reset_trade(self):
        self._entry_price = None
        self._stop_price = None
        self._target_price = None
        self._entry_zone_key = None
        self._stop_order = None
        for o, *_ in list(self._pending_orders):
            self.cancel(o)
        self._pending_orders.clear()

    def get_zones(self, ohlc, params=None):
        """Pro View – zobrazí S/D zóny pro debug."""
        if get_zones is None:
            return []
        p = dict(params or self.params.module_params or {})
        p.setdefault("timeframe", self.params.timeframe)
        return get_zones(ohlc, p)
