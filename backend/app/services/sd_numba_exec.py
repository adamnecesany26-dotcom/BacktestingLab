"""
Numba-accelerated SD execution slice: single Demand zone, limit entry after departure.

Matches sd_zone_strategy behaviour for:
  • watch_departure → pending_limit (entry_model limit edge/mid/pct)
  • long limit fill when low <= entry <= high
  • exit: max_hold_bars, else stop-before-target if both touched same bar
  • pending limit cancelled when zone falls out of [zone_start, zone_end] or max_limit_bars_exec

Full MTF merge, trend filter and momentum path are out of scope for this kernel.
"""

from __future__ import annotations

import numpy as np

try:
    from numba import njit
except ImportError:  # pragma: no cover

    def njit(*_args, **_kwargs):
        def deco(fn):
            return fn

        return deco


# lim_mode: 0 = edge (long @ zh), 1 = mid, 2 = pct (zl + span * entry_pct)
STATUS_NO_TRADE = 0
STATUS_CLOSED = 1
STATUS_OPEN_AT_END = 2  # in position, data ended


def _demand_limit_entry(zl: float, zh: float, lim_mode: int, entry_pct: float) -> float:
    span = zh - zl
    if lim_mode == 1:
        return (zl + zh) * 0.5
    if lim_mode == 2:
        p = max(0.0, min(1.0, float(entry_pct)))
        return zl + span * p
    return zh


def simulate_sd_demand_limit_edge_py(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    zl: float,
    zh: float,
    zone_start: int,
    zone_end: int,
    stop_offset_pct: float,
    target_rr: float,
    max_hold_bars: int,
    max_limit_bars_exec: int,
    lim_mode: int,
    entry_pct: float,
) -> tuple[int, int, float, float, int]:
    """
    Returns (entry_bar, exit_bar, entry_px, exit_px, status).
    entry_bar == -1 if no trade. exit_bar == -1 if still open at end (status OPEN_AT_END).
    """
    n = int(close.shape[0])
    h = zh - zl
    if n <= 0 or h <= 1e-15 or zone_start > zone_end:
        return -1, -1, 0.0, 0.0, STATUS_NO_TRADE

    state_none = 0
    state_watch = 1
    state_pending = 2
    state_pos = 3

    state = state_none
    departed = False
    armed = False
    armed_i = -1
    post_min_low = 1e300
    entry_limit = 0.0
    stop_px = 0.0
    target_px = 0.0
    entry_i = -1
    entry_fill = 0.0
    exit_i = -1
    exit_fill = 0.0

    def in_window(i: int) -> bool:
        return zone_start <= i <= zone_end

    for i in range(n):
        hi = float(high[i])
        lo = float(low[i])
        cl = float(close[i])

        if state == state_pos:
            bars_held = i - entry_i
            if bars_held >= max_hold_bars:
                return entry_i, i, entry_fill, cl, STATUS_CLOSED
            if lo <= stop_px:
                return entry_i, i, entry_fill, stop_px, STATUS_CLOSED
            if hi >= target_px:
                return entry_i, i, entry_fill, target_px, STATUS_CLOSED
            continue

        if state == state_none:
            if in_window(i):
                state = state_watch
                departed = False
                armed = False
                post_min_low = 1e300
            else:
                continue

        if state == state_watch:
            if not in_window(i):
                state = state_none
                continue
            if lo > zh:
                if not departed:
                    departed = True
                    post_min_low = lo
                else:
                    post_min_low = min(post_min_low, lo)
            elif departed:
                post_min_low = min(post_min_low, lo)
            if departed and not armed:
                armed = True
                entry_limit = _demand_limit_entry(zl, zh, lim_mode, entry_pct)
                off = h * float(stop_offset_pct)
                stop_px = zl - off
                risk = entry_limit - stop_px
                rr = max(0.01, float(target_rr))
                target_px = entry_limit + risk * rr if risk > 0 else entry_limit
                armed_i = i
                state = state_pending
            continue

        if state == state_pending:
            if not in_window(i):
                state = state_none
                departed = False
                armed = False
                continue
            post_min_low = min(post_min_low, lo)
            if armed_i >= 0 and (i - armed_i) >= max_limit_bars_exec:
                state = state_none
                departed = False
                armed = False
                continue
            if lo <= entry_limit <= hi:
                entry_i = i
                entry_fill = entry_limit
                state = state_pos
            continue

    if state == state_pos:
        return entry_i, -1, entry_fill, float(close[n - 1]), STATUS_OPEN_AT_END
    return -1, -1, 0.0, 0.0, STATUS_NO_TRADE


@njit(cache=True)
def simulate_sd_demand_limit_edge_numba(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    zl: float,
    zh: float,
    zone_start: int,
    zone_end: int,
    stop_offset_pct: float,
    target_rr: float,
    max_hold_bars: int,
    max_limit_bars_exec: int,
    lim_mode: int,
    entry_pct: float,
) -> tuple[int, int, float, float, int]:
    n = close.shape[0]
    h = zh - zl
    if n <= 0 or h <= 1e-15 or zone_start > zone_end:
        return -1, -1, 0.0, 0.0, 0

    state_none = 0
    state_watch = 1
    state_pending = 2
    state_pos = 3

    state = state_none
    departed = False
    armed = False
    armed_i = -1
    post_min_low = 1.0e300
    entry_limit = 0.0
    stop_px = 0.0
    target_px = 0.0
    entry_i = -1
    entry_fill = 0.0

    for i in range(n):
        hi = high[i]
        lo = low[i]
        cl = close[i]

        if state == state_pos:
            bars_held = i - entry_i
            if bars_held >= max_hold_bars:
                return entry_i, i, entry_fill, cl, 1
            if lo <= stop_px:
                return entry_i, i, entry_fill, stop_px, 1
            if hi >= target_px:
                return entry_i, i, entry_fill, target_px, 1
            continue

        if state == state_none:
            if zone_start <= i <= zone_end:
                state = state_watch
                departed = False
                armed = False
                post_min_low = 1.0e300
            continue

        if state == state_watch:
            if not (zone_start <= i <= zone_end):
                state = state_none
                continue
            if lo > zh:
                if not departed:
                    departed = True
                    post_min_low = lo
                else:
                    if lo < post_min_low:
                        post_min_low = lo
            elif departed:
                if lo < post_min_low:
                    post_min_low = lo
            if departed and not armed:
                armed = True
                span = zh - zl
                if lim_mode == 1:
                    entry_limit = (zl + zh) * 0.5
                elif lim_mode == 2:
                    p = entry_pct
                    if p < 0.0:
                        p = 0.0
                    elif p > 1.0:
                        p = 1.0
                    entry_limit = zl + span * p
                else:
                    entry_limit = zh
                off = h * stop_offset_pct
                stop_px = zl - off
                risk = entry_limit - stop_px
                rr = target_rr
                if rr < 0.01:
                    rr = 0.01
                if risk > 0.0:
                    target_px = entry_limit + risk * rr
                else:
                    target_px = entry_limit
                armed_i = i
                state = state_pending
            continue

        if state == state_pending:
            if not (zone_start <= i <= zone_end):
                state = state_none
                departed = False
                armed = False
                continue
            if lo < post_min_low:
                post_min_low = lo
            if armed_i >= 0 and (i - armed_i) >= max_limit_bars_exec:
                state = state_none
                departed = False
                armed = False
                continue
            if lo <= entry_limit <= hi:
                entry_i = i
                entry_fill = entry_limit
                state = state_pos
            continue

    if state == state_pos:
        return entry_i, -1, entry_fill, close[n - 1], 2
    return -1, -1, 0.0, 0.0, 0


@njit(cache=True)
def count_bars_inside_any_zone(
    low: np.ndarray,
    high: np.ndarray,
    z_low: np.ndarray,
    z_high: np.ndarray,
    z_start: np.ndarray,
    z_end: np.ndarray,
    n_bars: int,
    n_zones: int,
) -> np.ndarray:
    """
    For each bar i, count how many zones j satisfy start_j <= i <= end_j and
    price range [low_i, high_i] overlaps [z_low_j, z_high_j].
    """
    out = np.zeros(n_bars, dtype=np.int32)
    for i in range(n_bars):
        lo = low[i]
        hi = high[i]
        c = 0
        for j in range(n_zones):
            if z_start[j] <= i <= z_end[j]:
                if hi >= z_low[j] and lo <= z_high[j]:
                    c += 1
        out[i] = c
    return out
