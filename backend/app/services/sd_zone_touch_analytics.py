"""
S/D zone touch analytics — forward scan from ``touch_events`` (``examples.sd_zones`` contract),
not a separate touch detector. OHLC index = chart bars (same as View after timeframe parity).
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.services.view_artifacts import _iso_to_chart_bar_index


def stop_loss_from_zone_height(
    zone_name: str,
    value_high: float,
    value_low: float,
    sl_zone_height_mult: float,
) -> float:
    """
    Demand (long bias): stop = zone_high - mult * height (below zone top).
    Supply (short bias): stop = zone_low + mult * height (above zone bottom).
    """
    h = float(value_high) - float(value_low)
    if h <= 0 or not math.isfinite(h):
        return float("nan")
    m = float(sl_zone_height_mult)
    if not math.isfinite(m) or m <= 0:
        return float("nan")
    if zone_name == "Demand":
        return float(value_high) - m * h
    if zone_name == "Supply":
        return float(value_low) + m * h
    return float("nan")


def parse_touch_events_from_artifact_row(row: Any) -> list[dict[str, Any]]:
    """Parquet řádek → seznam touch událostí (ISO + cena); prázdné → fallback z touch1."""
    raw = None
    if hasattr(row, "get"):
        raw = row.get("touch_events_json")
    elif isinstance(row, dict):
        raw = row.get("touch_events_json")
    out: list[dict[str, Any]] = []
    if raw is not None and str(raw).strip():
        try:
            parsed = json.loads(str(raw))
            if isinstance(parsed, list):
                out = [x for x in parsed if isinstance(x, dict)]
        except (json.JSONDecodeError, TypeError, ValueError):
            out = []
    if out:
        return out
    t1 = row.get("touch1_at") if hasattr(row, "get") else (row.get("touch1_at") if isinstance(row, dict) else None)
    p1 = row.get("touch1_price") if hasattr(row, "get") else (row.get("touch1_price") if isinstance(row, dict) else None)
    if t1 and str(t1).strip():
        try:
            px = float(p1) if p1 is not None else float("nan")
        except (TypeError, ValueError):
            px = float("nan")
        if math.isfinite(px):
            return [{"touch_date": str(pd.Timestamp(t1).isoformat()), "price": px, "bar_index": None}]
    return []


def touch_events_chart_bars(
    chart_index: pd.DatetimeIndex,
    touch_events: list[dict[str, Any]],
) -> list[tuple[int, float, dict[str, Any]]]:
    """Vrátí (entry_bar, entry_price, raw_event) pro každou událost s mapovatelným časem."""
    mapped: list[tuple[int, float, dict[str, Any]]] = []
    for ev in touch_events:
        iso = ev.get("touch_date") or ev.get("date")
        if iso is None or not str(iso).strip():
            continue
        bi = _iso_to_chart_bar_index(chart_index, str(iso).strip())
        if bi is None:
            continue
        try:
            px = float(ev.get("price", float("nan")))
        except (TypeError, ValueError):
            px = float("nan")
        if not math.isfinite(px):
            continue
        mapped.append((int(bi), float(px), ev))
    return mapped


@dataclass
class SdTouchAnalyticsParams:
    sl_zone_height_mult: float = 1.25
    max_mfe_R: float = 10.0
    # Winner threshold used for MAE semantics:
    # - if price reaches `winner_rr` before SL, MAE is measured only up to that first threshold-hit bar
    # - otherwise MAE is measured normally (incl. SL depth)
    winner_rr: float = 1.5
    # When set (>0): after favorable excursion reaches this many R (on bars > entry_bar),
    # stop is moved to entry (breakeven). Then only BE exit, winner_rr target, or max_mfe_R cap ends the trade.
    # Intrabar: conservative SL first with the *current* stop; then MFE updates; then BE arms; then same-bar BE exit.
    breakeven_move_r: float | None = None
    tradable_only: bool = False
    zone_origins: set[str] | None = None
    entry_price_mode: str = "touch_price"  # "touch_price" | "zone_edge" | "zone_mid"
    risk_display: str = "r"  # "r" | "usd"
    equity: float = 100_000.0
    risk_pct: float = 0.01
    risk_pct_min: float | None = None
    risk_pct_max: float | None = None
    risk_seed: int | None = None


def _resolve_notional_risk_usd(p: SdTouchAnalyticsParams) -> float:
    eq = max(float(p.equity), 0.0)
    lo = p.risk_pct_min
    hi = p.risk_pct_max
    if lo is not None and hi is not None and float(hi) > float(lo):
        rng = random.Random(int(p.risk_seed) if p.risk_seed is not None else 0)
        rp = float(lo) + rng.random() * (float(hi) - float(lo))
        return eq * rp
    return eq * float(p.risk_pct)


def _stop_touch_price_eps(sl_px: float, entry_price: float, r_unit: float) -> float:
    """Tolerance for SL touch vs OHLC (sub-tick float noise)."""
    return max(1e-10 * abs(float(r_unit)), 1e-9 * max(abs(float(sl_px)), abs(float(entry_price))), 1e-15)


def _touch_candle_mae_r_if_proven(
    *,
    is_long: bool,
    entry_price: float,
    hi: float,
    lo: float,
    zone_lo: float,
    zone_hi: float,
    touch_px: float,
    r_unit: float,
    eps_px: float,
) -> float | None:
    """
    On the touch bar we still skip unknown-order MFE, but MAE may count when the bar proves
    price went past the zone edge or the touch level (real adverse excursion vs entry).
    """
    if r_unit <= 0 or not math.isfinite(r_unit):
        return None
    if is_long:
        if not (lo < zone_lo - eps_px or lo < touch_px - eps_px):
            return None
        adv = float(entry_price) - lo
    else:
        if not (hi > zone_hi + eps_px or hi > touch_px + eps_px):
            return None
        adv = hi - float(entry_price)
    if not math.isfinite(adv) or adv <= 0:
        return None
    return adv / r_unit


def _bos_direction(ev_type: str) -> str | None:
    t = str(ev_type or "").strip().lower()
    if t == "bos_bullish":
        return "bull"
    if t == "bos_bearish":
        return "bear"
    return None


def analyze_touch_events_on_ohlc(
    ohlc: pd.DataFrame,
    zones: list[dict[str, Any]],
    bos_markers: list[dict[str, Any]] | None,
    params: SdTouchAnalyticsParams | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    ``zones`` musí obsahovat: zone_id, name (Demand/Supply), value_low, value_high, source_tf,
    volitelně zone_origin, tradable, touch_events (list dictů s touch_date + price).

    ``bos_markers`` z View artefaktu: ``type`` bos_bullish/bos_bearish, ``bar_index`` int.
    """
    p = params or SdTouchAnalyticsParams()
    idx = ohlc.index
    if not isinstance(idx, pd.DatetimeIndex) or len(ohlc) == 0:
        return [], {"error": "empty_or_non_datetime_index"}

    high = ohlc["high"].values if "high" in ohlc.columns else ohlc["High"].values
    low = ohlc["low"].values if "low" in ohlc.columns else ohlc["Low"].values
    close = ohlc["close"].values if "close" in ohlc.columns else ohlc["Close"].values
    n = len(ohlc)

    bos_list: list[tuple[int, str]] = []
    if bos_markers:
        for m in bos_markers:
            if not isinstance(m, dict):
                continue
            d = _bos_direction(str(m.get("type", "")))
            if d is None:
                continue
            try:
                bi = int(m.get("bar_index", -1))
            except (TypeError, ValueError):
                continue
            if 0 <= bi < n:
                bos_list.append((bi, d))
    bos_list.sort(key=lambda x: x[0])

    notional = _resolve_notional_risk_usd(p) if p.risk_display == "usd" else None

    trades: list[dict[str, Any]] = []
    for z in zones:
        if not isinstance(z, dict):
            continue
        name = str(z.get("name", ""))
        if name not in ("Demand", "Supply"):
            continue
        if p.tradable_only and not z.get("tradable", True):
            continue
        zo = z.get("zone_origin")
        if p.zone_origins is not None and zo is not None and str(zo) not in p.zone_origins:
            continue
        tev = z.get("touch_events")
        if not isinstance(tev, list) or not tev:
            continue
        mapped = touch_events_chart_bars(idx, tev)
        vl = float(z.get("value_low", 0))
        vh = float(z.get("value_high", 0))
        sl_px = stop_loss_from_zone_height(name, vh, vl, p.sl_zone_height_mult)
        if not math.isfinite(sl_px):
            continue
        is_long = name == "Demand"
        zid = str(z.get("zone_id", ""))

        for touch_idx, (entry_bar, entry_price, raw_ev) in enumerate(mapped):
            if entry_bar < 0 or entry_bar >= n:
                continue
            # Entry price can be derived from zone geometry instead of touch price.
            ep_mode = str(getattr(p, "entry_price_mode", "touch_price") or "touch_price").strip().lower()
            entry_touch_price = float(entry_price)
            if ep_mode == "zone_edge":
                entry_price = float(vh) if is_long else float(vl)
            elif ep_mode == "zone_mid":
                entry_price = 0.5 * (float(vl) + float(vh))
            # Sanity: touch musí být v rámci svíčky i zóny, jinak analytika neodpovídá grafu.
            try:
                bar_hi = float(high[entry_bar])
                bar_lo = float(low[entry_bar])
            except Exception:
                bar_hi = float("nan")
                bar_lo = float("nan")
            if not (math.isfinite(bar_hi) and math.isfinite(bar_lo)):
                continue
            if bar_hi < bar_lo:
                bar_lo, bar_hi = bar_hi, bar_lo

            # Overlap bar range with zone band
            zone_lo = min(vl, vh)
            zone_hi = max(vl, vh)
            bar_overlaps_zone = not (bar_hi < zone_lo or bar_lo > zone_hi)
            if not bar_overlaps_zone:
                trades.append(
                    {
                        "zone_id": zid,
                        "zone_name": name,
                        "source_tf": z.get("source_tf"),
                        "touch_index": touch_idx,
                        "skip": True,
                        "skip_reason": "touch_bar_not_in_zone_range",
                        "entry_bar": entry_bar,
                        "entry_price": entry_price,
                        "stop_price": sl_px,
                        "zone_value_low": vl,
                        "zone_value_high": vh,
                        "zone_bar_start": z.get("zone_bar_start"),
                        "zone_bar_end": z.get("zone_bar_end"),
                        "zone_born_bar": z.get("zone_born_bar"),
                        "touch_raw": raw_ev,
                    }
                )
                continue

            # If touch price is outside candle range, clamp to nearest bound (keeps chart consistent)
            # Clamp both the touch-derived price and the chosen entry fill price to the candle.
            orig_touch_price = entry_touch_price
            orig_entry_price = entry_price
            adjusted = False
            if entry_touch_price < bar_lo:
                entry_touch_price = bar_lo
                adjusted = True
            elif entry_touch_price > bar_hi:
                entry_touch_price = bar_hi
                adjusted = True
            if entry_price < bar_lo:
                entry_price = bar_lo
                adjusted = True
            elif entry_price > bar_hi:
                entry_price = bar_hi
                adjusted = True
            if adjusted:
                try:
                    if isinstance(raw_ev, dict):
                        raw_ev = dict(raw_ev)
                        raw_ev["price_original"] = orig_touch_price
                        raw_ev["price_clamped_to_bar"] = entry_touch_price
                        raw_ev["entry_fill_price_original"] = orig_entry_price
                        raw_ev["entry_fill_price_clamped_to_bar"] = entry_price
                except Exception:
                    pass

            r_unit = (entry_price - sl_px) if is_long else (sl_px - entry_price)
            if r_unit <= 0 or not math.isfinite(r_unit):
                trades.append(
                    {
                        "zone_id": zid,
                        "zone_name": name,
                        "source_tf": z.get("source_tf"),
                        "touch_index": touch_idx,
                        "skip": True,
                        "skip_reason": "non_positive_R_distance",
                        "entry_bar": entry_bar,
                        "entry_price": entry_price,
                        "stop_price": sl_px,
                        "zone_value_low": vl,
                        "zone_value_high": vh,
                        "zone_bar_start": z.get("zone_bar_start"),
                        "zone_bar_end": z.get("zone_bar_end"),
                        "zone_born_bar": z.get("zone_born_bar"),
                        "touch_raw": raw_ev,
                    }
                )
                continue

            sl_eps = _stop_touch_price_eps(sl_px, entry_price, r_unit)
            zone_lo = min(float(vl), float(vh))
            zone_hi = max(float(vl), float(vh))

            def first_opposite_bos_bar() -> int | None:
                want = "bear" if is_long else "bull"
                for bi, d in bos_list:
                    if bi > entry_bar and d == want:
                        return bi
                return None

            # Opposite BOS is tracked for ``mfe_before_opposite_bos_R`` only; trade scan runs until
            # SL, ``max_mfe_R`` cap, or end of series (not truncated at BOS).
            bos_cut = first_opposite_bos_bar()
            end_trade = n

            mfe_r = 0.0
            mae_r = 0.0
            mfe_bar = entry_bar
            mae_bar = entry_bar
            sl_hit_bar: int | None = None
            cap_hit_bar: int | None = None
            be_bar: int | None = None

            mfe_before_be_r: float | None = None
            mfe_before_sl_r: float | None = None
            mfe_before_opposite_bos_r: float | None = None
            reached_opposite_bos = False
            thr_r = float(p.winner_rr) if math.isfinite(float(p.winner_rr)) and float(p.winner_rr) > 0 else 1.5
            thr_bar: int | None = None
            # First-hit bars for R targets used by UI stat blocks:
            # - 0.5 steps up to 3R
            # - integers above 3R (up to 10R)
            # Keys are floats; we stringify them in the output dict.
            first_hit_r_bar: dict[float, int] = {}
            targets: list[float] = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0] + [float(k) for k in range(4, 11)]

            def _fmt_target_key(x: float) -> str:
                if abs(x - round(x)) < 1e-9:
                    return str(int(round(x)))
                # Keep one decimal for 0.5 steps (1.5, 2.5, ...)
                return f"{x:.1f}".rstrip("0").rstrip(".")

            use_be_move = (
                p.breakeven_move_r is not None
                and math.isfinite(float(p.breakeven_move_r))
                and float(p.breakeven_move_r) > 0
            )
            be_move_thr = float(p.breakeven_move_r) if use_be_move else None
            be_armed = False

            for i in range(entry_bar, min(end_trade, n)):
                hi = float(high[i])
                lo = float(low[i])
                if is_long:
                    favorable = hi - entry_price
                    adverse = entry_price - lo
                else:
                    favorable = entry_price - lo
                    adverse = hi - entry_price

                fav_r = favorable / r_unit
                adv_r = adverse / r_unit

                if bos_cut is not None and i >= bos_cut:
                    reached_opposite_bos = True

                eff_sl = float(entry_price) if (use_be_move and be_armed) else float(sl_px)
                if is_long:
                    sl_hit_now = lo <= eff_sl + sl_eps
                else:
                    sl_hit_now = hi >= eff_sl - sl_eps

                if sl_hit_now:
                    sl_hit_bar = i
                    mfe_before_sl_r = mfe_r
                    break

                # Touch candle: MFE / BE still need known path order — skip below.
                # MAE may count when H/L proves excursion past zone edge or touch price (real adverse).
                if i == entry_bar:
                    adv_touch = _touch_candle_mae_r_if_proven(
                        is_long=is_long,
                        entry_price=entry_price,
                        hi=hi,
                        lo=lo,
                        zone_lo=zone_lo,
                        zone_hi=zone_hi,
                        touch_px=float(entry_touch_price),
                        r_unit=r_unit,
                        eps_px=sl_eps,
                    )
                    if adv_touch is not None and adv_touch > mae_r:
                        mae_r = adv_touch
                        mae_bar = i
                    continue

                if bos_cut is None or i <= bos_cut:
                    mfe_before_opposite_bos_r = fav_r if mfe_before_opposite_bos_r is None else max(mfe_before_opposite_bos_r, fav_r)

                if fav_r > mfe_r:
                    mfe_r = fav_r
                    mfe_bar = i
                if adv_r > mae_r:
                    mae_r = adv_r
                    mae_bar = i

                # First bar where we reached the configured "winner" R.
                if thr_bar is None and fav_r >= thr_r:
                    thr_bar = i

                # First-hit bars for UI targets (independent from winner_rr).
                if i > entry_bar and fav_r >= 0.5:
                    for tgt in targets:
                        if tgt in first_hit_r_bar:
                            continue
                        if fav_r >= tgt:
                            first_hit_r_bar[tgt] = i

                # NOTE: We intentionally do NOT update MAE semantics inside the scan loop anymore.
                # MAE is finalized after the scan using thr_bar (first hit of `winner_rr`) if the trade is a winner.

                if use_be_move:
                    if not be_armed and fav_r >= float(be_move_thr):
                        be_armed = True
                        be_bar = i
                        mfe_before_be_r = mfe_r
                        # Same bar: if price already trades through entry, BE stop fires immediately.
                        if is_long and lo <= float(entry_price) + sl_eps:
                            sl_hit_bar = i
                            mfe_before_sl_r = mfe_r
                            break
                        if (not is_long) and hi >= float(entry_price) - sl_eps:
                            sl_hit_bar = i
                            mfe_before_sl_r = mfe_r
                            break
                else:
                    if be_bar is None:
                        if is_long and hi >= float(entry_price):
                            be_bar = i
                            mfe_before_be_r = mfe_r
                        elif not is_long and lo <= float(entry_price):
                            be_bar = i
                            mfe_before_be_r = mfe_r

                if mfe_r >= float(p.max_mfe_R):
                    cap_hit_bar = i
                    break

            if sl_hit_bar is None:
                mfe_before_sl_r = mfe_r
            if bos_cut is not None and not reached_opposite_bos:
                mfe_before_opposite_bos_r = None

            # If trade reached winner threshold before SL, MAE should only measure adverse excursion
            # strictly BEFORE the first threshold-hit bar.
            #
            # Why exclude `thr_bar` itself?
            # On a single candle we don't know the intrabar order (low vs high first). If the candle
            # both reaches the profit threshold and makes a deep adverse wick, counting its low/high
            # as "MAE after threshold" is misleading. So we measure MAE on bars < thr_bar.
            # MAE is always measured only BEFORE the winner threshold is reached.
            # If the threshold is never reached, the full-path MAE stands (still "before threshold").
            if thr_bar is not None:
                mae_r = 0.0
                mae_bar = entry_bar
                end_j = max(entry_bar, int(thr_bar) - 1)
                for j in range(entry_bar, end_j + 1):
                    hj = float(high[j])
                    lj = float(low[j])
                    if j == entry_bar:
                        adv_j = _touch_candle_mae_r_if_proven(
                            is_long=is_long,
                            entry_price=entry_price,
                            hi=hj,
                            lo=lj,
                            zone_lo=zone_lo,
                            zone_hi=zone_hi,
                            touch_px=float(entry_touch_price),
                            r_unit=r_unit,
                            eps_px=sl_eps,
                        )
                        if adv_j is None:
                            continue
                    elif is_long:
                        adverse_j = entry_price - lj
                        adv_j = adverse_j / r_unit
                    else:
                        adverse_j = hj - entry_price
                        adv_j = adverse_j / r_unit
                    if adv_j > mae_r:
                        mae_r = adv_j
                        mae_bar = j
                mae_before_thr_r: float | None = float(mae_r)
            else:
                mae_before_thr_r = None

            # MAE semantics:
            # - If threshold was reached: MAE was recomputed above as "adverse before threshold" (bars < thr_bar).
            # - If threshold was NOT reached: treat as a failed attempt (SL or end-of-data) → MAE = 1R.
            #
            # IMPORTANT: we do NOT synthesize `sl_hit_bar` from MAE anymore. That old float-tolerance hack
            # could label a trade as "winner but MAE=1" which is nonsensical under the user's definition.
            if thr_bar is None:
                mae_r = 1.0
                if sl_hit_bar is not None:
                    mae_bar = sl_hit_bar

            # Clamp: MAE is an adverse measure in R relative to the stop (1R). Never exceed 1R.
            if mae_r > 1.0:
                mae_r = 1.0

            row: dict[str, Any] = {
                "zone_id": zid,
                "zone_name": name,
                "source_tf": z.get("source_tf"),
                "touch_index": touch_idx,
                "entry_bar": entry_bar,
                # Entry marker on chart should follow the touch price from S/D artifact (after clamp).
                "entry_touch_price": entry_touch_price,
                # Fill/analysis entry price depends on entry_price_mode.
                "entry_price": entry_price,
                "stop_price": sl_px,
                "R_unit": r_unit,
                "mfe_R": mfe_r,
                "mae_R": mae_r,
                "mae_before_thr_R": mae_before_thr_r,
                "thr_hit_bar": thr_bar,
                "winner_rr_used": thr_r,
                "bars_to_reach_R": {
                    _fmt_target_key(k): int(first_hit_r_bar[k] - entry_bar) for k in sorted(first_hit_r_bar.keys())
                },
                "mfe_bar": mfe_bar,
                "mae_bar": mae_bar,
                "sl_hit_bar": sl_hit_bar,
                "cap_hit_bar": cap_hit_bar,
                "be_bar": be_bar,
                "opposite_bos_bar": bos_cut,
                "mfe_before_be_R": mfe_before_be_r,
                "mfe_before_sl_R": mfe_before_sl_r,
                "mfe_before_opposite_bos_R": mfe_before_opposite_bos_r,
                "touch_raw": raw_ev,
                "zone_value_low": vl,
                "zone_value_high": vh,
                "zone_bar_start": z.get("zone_bar_start"),
                "zone_bar_end": z.get("zone_bar_end"),
                "zone_born_bar": z.get("zone_born_bar"),
            }
            if use_be_move:
                row["breakeven_move_r"] = float(be_move_thr)
                row["be_armed"] = bool(be_armed)
            if notional is not None and math.isfinite(notional):
                row["mfe_usd"] = mfe_r * notional
                row["mae_usd"] = mae_r * notional
                row["notional_risk_usd"] = notional
            trades.append(row)

    executed = [t for t in trades if not t.get("skip")]
    agg: dict[str, Any] = {
        "touch_count": len(executed),
        "avg_mfe_R": None,
        "avg_mae_R": None,
        "sl_rate": None,
    }
    if executed:
        agg["avg_mfe_R"] = sum(float(t["mfe_R"]) for t in executed) / len(executed)
        agg["avg_mae_R"] = sum(float(t["mae_R"]) for t in executed) / len(executed)
        sln = sum(1 for t in executed if t.get("sl_hit_bar") is not None)
        agg["sl_rate"] = sln / len(executed)
    return trades, agg


def zones_from_sd_parquet_rows(
    zones_df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
) -> list[dict[str, Any]]:
    """Řádky zones.parquet → zóny s ``touch_events`` mapovanými přes ISO na index grafu."""
    out: list[dict[str, Any]] = []
    if zones_df is None or zones_df.empty:
        return out
    for _, row in zones_df.iterrows():
        rs = row.get("range_start_at") or row.get("born_at")
        re = row.get("range_end_at") or row.get("born_at")
        if rs is None or re is None:
            continue
        try:
            a, b = pd.Timestamp(rs), pd.Timestamp(re)
            lo_t, hi_t = (a, b) if a <= b else (b, a)
        except Exception:
            continue
        if hi_t < chart_index.min() or lo_t > chart_index.max():
            continue
        kind = str(row.get("kind", "")).strip().lower()
        name = "Demand" if kind == "demand" else "Supply" if kind == "supply" else ""
        if not name:
            continue
        tev = parse_touch_events_from_artifact_row(row)
        if not tev:
            t1 = row.get("touch1_at")
            p1 = row.get("touch1_price")
            if t1 and str(t1).strip() and p1 is not None:
                try:
                    tev = [
                        {
                            "touch_date": str(pd.Timestamp(t1).isoformat()),
                            "price": float(p1),
                        }
                    ]
                except (TypeError, ValueError):
                    tev = []
        if not tev:
            continue
        n_chart = len(chart_index)
        zs = _iso_to_chart_bar_index(chart_index, str(pd.Timestamp(lo_t).isoformat()))
        ze = _iso_to_chart_bar_index(chart_index, str(pd.Timestamp(hi_t).isoformat()))
        zb0: int | None = None
        zb1: int | None = None
        if n_chart > 0:
            if zs is not None and ze is not None:
                lo_i, hi_i = (zs, ze) if zs <= ze else (ze, zs)
                zb0 = max(0, min(lo_i, n_chart - 1))
                zb1 = max(0, min(hi_i, n_chart - 1))
            elif zs is not None:
                zb0 = zb1 = max(0, min(zs, n_chart - 1))
            elif ze is not None:
                zb0 = zb1 = max(0, min(ze, n_chart - 1))
        z_born_bar: int | None = None
        born_raw = row.get("born_at")
        if born_raw is not None and str(born_raw).strip() and n_chart > 0:
            try:
                born_iso = str(pd.Timestamp(born_raw).isoformat())
                bi_b = _iso_to_chart_bar_index(chart_index, born_iso)
            except Exception:
                bi_b = None
            if bi_b is not None:
                z_born_bar = max(0, min(int(bi_b), n_chart - 1))
        z: dict[str, Any] = {
            "zone_id": str(row.get("zone_id", "")),
            "name": name,
            "value_low": float(row.get("price_low", 0)),
            "value_high": float(row.get("price_high", 0)),
            "source_tf": str(row.get("source_tf", "")),
            "touch_events": tev,
            "zone_origin": "artifact",
            "tradable": True,
            "zone_bar_start": zb0,
            "zone_bar_end": zb1,
            "zone_born_bar": z_born_bar,
        }
        out.append(z)
    return out
