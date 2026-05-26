"""
Sequential prop-firm challenge simulation on chronological closed trades from a standard backtest.

Supports intraday trailing drawdown (Apex-style), EOD trailing (Topstep / MFF-style),
optional static loss floor, daily loss / daily drawdown %, min trading days, and
consistency (best day vs total profit). Challenge + performance account continues
with a separate balance after a passed evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Fail = Literal["max_drawdown", "daily_drawdown", "daily_loss_usd", "consistency"]
DdModel = Literal["intraday_trailing", "eod_trailing", "static_floor"]
Mode = Literal["challenges_only", "challenge_then_pa"]


@dataclass
class PropFirmRules:
    mode: Mode
    account_size: float
    profit_target_usd: float
    max_drawdown_usd: float
    dd_model: DdModel
    daily_loss_limit_usd: float
    daily_drawdown_pct: float
    min_trading_days: int
    consistency_best_day_max_pct: float
    performance_starting_balance: float
    performance_max_drawdown_usd: float | None
    preset_id: str = "custom"


def _f(x: Any, default: float = 0.0) -> float:
    try:
        if x is None:
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def _i(x: Any, default: int = 0) -> int:
    try:
        if x is None:
            return default
        return int(float(x))
    except (TypeError, ValueError):
        return default


def rules_from_payload(raw: dict[str, Any] | None, initial_capital: float) -> PropFirmRules | None:
    if not raw or not raw.get("enabled"):
        return None
    mode_raw = str(raw.get("mode") or "challenges_only")
    mode: Mode = "challenge_then_pa" if mode_raw == "challenge_then_pa" else "challenges_only"
    acct = _f(raw.get("account_size"), initial_capital)
    if acct <= 0:
        acct = max(initial_capital, 1.0)
    dd_model_raw = str(raw.get("drawdown_model") or "intraday_trailing")
    if dd_model_raw == "eod_trailing":
        dd_model: DdModel = "eod_trailing"
    elif dd_model_raw == "static_floor":
        dd_model = "static_floor"
    else:
        dd_model = "intraday_trailing"

    pmd_raw = raw.get("performance_max_drawdown_usd")
    pmd: float | None
    try:
        pmd = float(pmd_raw) if pmd_raw is not None and str(pmd_raw) != "" else None
    except (TypeError, ValueError):
        pmd = None

    return PropFirmRules(
        mode=mode,
        account_size=acct,
        profit_target_usd=max(0.0, _f(raw.get("profit_target_usd"), 3000.0)),
        max_drawdown_usd=max(0.0, _f(raw.get("max_drawdown_usd"), 2500.0)),
        dd_model=dd_model,
        daily_loss_limit_usd=max(0.0, _f(raw.get("daily_loss_limit_usd"), 0.0)),
        daily_drawdown_pct=max(0.0, _f(raw.get("daily_drawdown_pct"), 0.0)),
        min_trading_days=max(0, _i(raw.get("min_trading_days"), 0)),
        consistency_best_day_max_pct=max(0.0, _f(raw.get("consistency_best_day_max_pct"), 0.0)),
        performance_starting_balance=max(1.0, _f(raw.get("performance_starting_balance"), acct)),
        performance_max_drawdown_usd=pmd,
        preset_id=str(raw.get("preset_id") or raw.get("presetId") or "custom"),
    )


def _exit_day(tr: dict[str, Any]) -> str:
    raw = tr.get("exitDate") or tr.get("date") or ""
    s = str(raw)
    if "T" in s:
        return s.split("T", 1)[0][:10]
    return s[:10] if len(s) >= 10 else s


def _sort_trades_chronological(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def k(t: dict[str, Any]) -> str:
        return str(t.get("exitDate") or t.get("date") or "")

    return sorted(trades, key=k)


def _intra_trade_equity_steps(
    entry_equity: float,
    pnl: float,
    mfe_usd: float | None,
    mae_usd: float | None,
) -> list[float]:
    pnl = float(pnl or 0.0)
    adverse = 0.0
    if mae_usd is not None and float(mae_usd) > 0:
        adverse = float(mae_usd)
    elif pnl < 0:
        adverse = abs(pnl)
    favorable = float(mfe_usd) if mfe_usd is not None and float(mfe_usd) > 0 else 0.0

    pts: list[float] = [float(entry_equity)]
    low = entry_equity - adverse
    if low < entry_equity - 1e-9:
        pts.append(low)
    if favorable > 0:
        hi = entry_equity + favorable
        if hi > pts[-1] + 1e-9:
            pts.append(hi)
    close = entry_equity + pnl
    if abs(close - pts[-1]) > 1e-9:
        pts.append(close)
    return pts


def _apply_steps(
    *,
    steps: list[float],
    start_equity: float,
    rules: PropFirmRules,
    phase_initial: float,
    peak_intra: float,
    eod_peak: float,
    current_day: str | None,
    day_high: float,
    day_start_equity: float,
    day_pnl: dict[str, float],
    day_keys_order: list[str],
    equity_path: list[float],
) -> tuple[float, float, float, float, str | None, float, float, bool, Fail | None]:
    """
    Apply equity steps for one trade. Returns:
      equity, peak_intra, eod_peak, day_high, current_day, day_start_equity, ok, fail_reason
    """
    equity = start_equity
    fail_reason: Fail | None = None
    ok = True

    for s in range(1, len(steps)):
        eq = float(steps[s])
        equity_path.append(round(eq, 2))

        if rules.dd_model == "intraday_trailing":
            peak_intra = max(peak_intra, eq)
            if (peak_intra - eq) > rules.max_drawdown_usd + 1e-6:
                ok = False
                fail_reason = "max_drawdown"
                break
        elif rules.dd_model == "eod_trailing":
            if (eod_peak - eq) > rules.max_drawdown_usd + 1e-6:
                ok = False
                fail_reason = "max_drawdown"
                break
        else:  # static_floor
            if eq < phase_initial - rules.max_drawdown_usd - 1e-6:
                ok = False
                fail_reason = "max_drawdown"
                break

        if eq > day_high:
            day_high = eq
        if rules.daily_drawdown_pct > 0 and day_high > 0:
            day_dd_pct = ((day_high - eq) / day_high) * 100.0
            if day_dd_pct > rules.daily_drawdown_pct + 1e-6:
                ok = False
                fail_reason = "daily_drawdown"
                break
        if rules.daily_loss_limit_usd > 0 and day_start_equity - eq > rules.daily_loss_limit_usd + 1e-6:
            ok = False
            fail_reason = "daily_loss_usd"
            break

    if not ok:
        return equity, peak_intra, eod_peak, day_high, current_day, day_start_equity, ok, fail_reason

    # closed trade pnl for day stats
    pnl = float(steps[-1]) - float(steps[0])
    d = day_keys_order[-1] if day_keys_order else ""
    if d:
        day_pnl[d] = day_pnl.get(d, 0.0) + pnl
    return float(steps[-1]), peak_intra, eod_peak, day_high, current_day, day_start_equity, True, None


def _close_day_eod(
    equity: float,
    rules: PropFirmRules,
    eod_peak: float,
    peak_intra: float,
) -> tuple[float, bool]:
    """EOD: ratchet eod_peak from settled equity; optional trailing check. Returns (new_eod_peak, ok)."""
    if rules.dd_model != "eod_trailing":
        return max(eod_peak, equity), True
    if (eod_peak - equity) > rules.max_drawdown_usd + 1e-6:
        return eod_peak, False
    return max(eod_peak, equity), True


def run_evaluation_phase(
    trades: list[dict[str, Any]],
    start_idx: int,
    rules: PropFirmRules,
) -> dict[str, Any]:
    initial = rules.account_size
    target_eq = initial + rules.profit_target_usd
    equity = float(initial)
    equity_path: list[float] = [round(equity, 2)]
    peak_intra = equity
    eod_peak = equity
    current_day: str | None = None
    day_high = equity
    day_start_equity = equity
    day_pnl: dict[str, float] = {}
    day_keys_order: list[str] = []
    k = start_idx

    while k < len(trades):
        tr = trades[k]
        day = _exit_day(tr)
        if day != current_day:
            if current_day is not None and rules.dd_model == "eod_trailing":
                eod_peak, eod_ok = _close_day_eod(equity, rules, eod_peak, peak_intra)
                if not eod_ok:
                    return {
                        "phase": "evaluation",
                        "outcome": "failed",
                        "failReason": "max_drawdown",
                        "startTradeIndex": start_idx,
                        "endTradeIndex": k - 1 if k > start_idx else start_idx - 1,
                        "nextTradeIndex": k,
                        "initialEquity": initial,
                        "finalEquity": equity,
                        "targetEquity": target_eq,
                        "tradesUsed": max(0, k - start_idx),
                        "equityPath": equity_path,
                        "uniqueDays": len(day_keys_order),
                    }
            current_day = day
            day_high = equity
            day_start_equity = equity
            if day and day not in day_keys_order:
                day_keys_order.append(day)

        pnl = float(tr.get("pnl") or 0.0)
        mfe = tr.get("mfeUsd")
        mae = tr.get("maeUsd")
        if mfe is None and tr.get("mfe") is not None:
            mfe = tr.get("mfe")
        if mae is None and tr.get("mae") is not None:
            mae = tr.get("mae")

        steps = _intra_trade_equity_steps(equity, pnl, mfe, mae)
        equity, peak_intra, eod_peak, day_high, current_day, day_start_equity, ok, fr = _apply_steps(
            steps=steps,
            start_equity=equity,
            rules=rules,
            phase_initial=initial,
            peak_intra=peak_intra,
            eod_peak=eod_peak,
            current_day=current_day,
            day_high=day_high,
            day_start_equity=day_start_equity,
            day_pnl=day_pnl,
            day_keys_order=day_keys_order,
            equity_path=equity_path,
        )
        if not ok:
            fail_reason = fr
            k += 1
            return {
                "phase": "evaluation",
                "outcome": "failed",
                "failReason": fail_reason,
                "startTradeIndex": start_idx,
                "endTradeIndex": k - 1,
                "nextTradeIndex": k,
                "initialEquity": initial,
                "finalEquity": equity,
                "targetEquity": target_eq,
                "tradesUsed": k - start_idx,
                "equityPath": equity_path,
                "uniqueDays": len(day_keys_order),
            }

        unique_days_with_pnl = len([d for d, v in day_pnl.items() if abs(v) > 1e-9])
        if equity >= target_eq - 1e-6:
            if rules.dd_model == "eod_trailing" and (eod_peak - equity) > rules.max_drawdown_usd + 1e-6:
                fail_reason = "max_drawdown"
                k += 1
                return {
                    "phase": "evaluation",
                    "outcome": "failed",
                    "failReason": fail_reason,
                    "startTradeIndex": start_idx,
                    "endTradeIndex": k - 1,
                    "nextTradeIndex": k,
                    "initialEquity": initial,
                    "finalEquity": equity,
                    "targetEquity": target_eq,
                    "tradesUsed": k - start_idx + 1,
                    "equityPath": equity_path,
                    "uniqueDays": unique_days_with_pnl,
                }
            if unique_days_with_pnl < rules.min_trading_days:
                k += 1
                continue

            total_profit = equity - initial
            if rules.consistency_best_day_max_pct > 0 and total_profit > 1e-6:
                lim = rules.consistency_best_day_max_pct / 100.0
                max_day = max(day_pnl.values()) if day_pnl else 0.0
                if max_day / total_profit > lim + 1e-6:
                    fail_reason = "consistency"
                    k += 1
                    return {
                        "phase": "evaluation",
                        "outcome": "failed",
                        "failReason": fail_reason,
                        "startTradeIndex": start_idx,
                        "endTradeIndex": k - 1,
                        "nextTradeIndex": k,
                        "initialEquity": initial,
                        "finalEquity": equity,
                        "targetEquity": target_eq,
                        "tradesUsed": k - start_idx + 1,
                        "equityPath": equity_path,
                        "uniqueDays": unique_days_with_pnl,
                    }

            k += 1
            return {
                "phase": "evaluation",
                "outcome": "passed",
                "failReason": None,
                "startTradeIndex": start_idx,
                "endTradeIndex": k - 1,
                "nextTradeIndex": k,
                "initialEquity": initial,
                "finalEquity": equity,
                "targetEquity": target_eq,
                "tradesUsed": k - start_idx,
                "equityPath": equity_path,
                "uniqueDays": unique_days_with_pnl,
            }

        k += 1

    if current_day is not None and rules.dd_model == "eod_trailing":
        _, eod_ok = _close_day_eod(equity, rules, eod_peak, peak_intra)
        if not eod_ok:
            return {
                "phase": "evaluation",
                "outcome": "failed",
                "failReason": "max_drawdown",
                "startTradeIndex": start_idx,
                "endTradeIndex": len(trades) - 1,
                "nextTradeIndex": len(trades),
                "initialEquity": initial,
                "finalEquity": equity,
                "targetEquity": target_eq,
                "tradesUsed": len(trades) - start_idx,
                "equityPath": equity_path,
                "uniqueDays": len(day_keys_order),
            }

    return {
        "phase": "evaluation",
        "outcome": "incomplete",
        "failReason": None,
        "startTradeIndex": start_idx,
        "endTradeIndex": len(trades) - 1 if trades else start_idx - 1,
        "nextTradeIndex": len(trades),
        "initialEquity": initial,
        "finalEquity": equity,
        "targetEquity": target_eq,
        "tradesUsed": max(0, len(trades) - start_idx),
        "equityPath": equity_path,
        "uniqueDays": len(day_keys_order),
    }


def run_performance_phase(
    trades: list[dict[str, Any]],
    start_idx: int,
    rules: PropFirmRules,
) -> dict[str, Any]:
    initial = rules.performance_starting_balance
    max_dd = rules.performance_max_drawdown_usd
    if max_dd is None:
        max_dd = rules.max_drawdown_usd
    eff_rules = PropFirmRules(
        mode=rules.mode,
        account_size=initial,
        profit_target_usd=1e18,
        max_drawdown_usd=max_dd,
        dd_model=rules.dd_model,
        daily_loss_limit_usd=rules.daily_loss_limit_usd,
        daily_drawdown_pct=rules.daily_drawdown_pct,
        min_trading_days=0,
        consistency_best_day_max_pct=0.0,
        performance_starting_balance=initial,
        performance_max_drawdown_usd=max_dd,
        preset_id=rules.preset_id,
    )

    equity = float(initial)
    equity_path: list[float] = [round(equity, 2)]
    peak_intra = equity
    eod_peak = equity
    current_day: str | None = None
    day_high = equity
    day_start_equity = equity
    k = start_idx
    fail_reason: Fail | None = None

    while k < len(trades):
        tr = trades[k]
        day = _exit_day(tr)
        if day != current_day:
            if current_day is not None and eff_rules.dd_model == "eod_trailing":
                eod_peak, eod_ok = _close_day_eod(equity, eff_rules, eod_peak, peak_intra)
                if not eod_ok:
                    fail_reason = "max_drawdown"
                    k += 1
                    break
            current_day = day
            day_high = equity
            day_start_equity = equity

        pnl = float(tr.get("pnl") or 0.0)
        mfe = tr.get("mfeUsd")
        mae = tr.get("maeUsd")
        steps = _intra_trade_equity_steps(equity, pnl, mfe, mae)
        day_pnl_tmp: dict[str, float] = {}
        day_keys_tmp: list[str] = [day] if day else []
        equity, peak_intra, eod_peak, day_high, current_day, day_start_equity, ok, fr = _apply_steps(
            steps=steps,
            start_equity=equity,
            rules=eff_rules,
            phase_initial=initial,
            peak_intra=peak_intra,
            eod_peak=eod_peak,
            current_day=current_day,
            day_high=day_high,
            day_start_equity=day_start_equity,
            day_pnl=day_pnl_tmp,
            day_keys_order=day_keys_tmp,
            equity_path=equity_path,
        )
        if not ok:
            fail_reason = fr
            k += 1
            return {
                "phase": "performance",
                "outcome": "failed",
                "failReason": fail_reason,
                "startTradeIndex": start_idx,
                "endTradeIndex": k - 1,
                "nextTradeIndex": k,
                "initialEquity": initial,
                "finalEquity": equity,
                "tradesUsed": k - start_idx,
                "equityPath": equity_path,
            }
        k += 1

    if current_day is not None and eff_rules.dd_model == "eod_trailing":
        _, eod_ok = _close_day_eod(equity, eff_rules, eod_peak, peak_intra)
        if not eod_ok:
            fail_reason = "max_drawdown"

    if fail_reason:
        return {
            "phase": "performance",
            "outcome": "failed",
            "failReason": fail_reason,
            "startTradeIndex": start_idx,
            "endTradeIndex": len(trades) - 1,
            "nextTradeIndex": len(trades),
            "initialEquity": initial,
            "finalEquity": equity,
            "tradesUsed": len(trades) - start_idx,
            "equityPath": equity_path,
        }

    return {
        "phase": "performance",
        "outcome": "completed_to_data_end",
        "failReason": None,
        "startTradeIndex": start_idx,
        "endTradeIndex": len(trades) - 1 if trades else start_idx - 1,
        "nextTradeIndex": len(trades),
        "initialEquity": initial,
        "finalEquity": equity,
        "tradesUsed": max(0, len(trades) - start_idx),
        "equityPath": equity_path,
    }


def simulate_prop_firm_sequential(trades: list[dict[str, Any]], rules: PropFirmRules) -> dict[str, Any]:
    ordered = _sort_trades_chronological([t for t in trades if isinstance(t, dict)])
    segments: list[dict[str, Any]] = []
    i = 0
    eval_passed = 0
    eval_failed = 0
    eval_incomplete = 0
    streak_pass = 0
    streak_fail = 0
    max_streak_pass = 0
    max_streak_fail = 0
    pa_total_return_pct_sum = 0.0
    pa_segments = 0

    while i < len(ordered):
        ev = run_evaluation_phase(ordered, i, rules)
        segments.append(ev)
        outcome = str(ev.get("outcome"))
        i = int(ev["nextTradeIndex"])

        if outcome == "passed":
            eval_passed += 1
            streak_pass += 1
            streak_fail = 0
            max_streak_pass = max(max_streak_pass, streak_pass)
            if rules.mode == "challenge_then_pa" and i < len(ordered):
                pa = run_performance_phase(ordered, i, rules)
                segments.append(pa)
                pa_segments += 1
                pa_init = float(pa.get("initialEquity") or 0.0)
                pa_fin = float(pa.get("finalEquity") or pa_init)
                if pa_init > 0:
                    pa_total_return_pct_sum += (pa_fin - pa_init) / pa_init * 100.0
                i = int(pa["nextTradeIndex"])
        elif outcome == "failed":
            eval_failed += 1
            streak_fail += 1
            streak_pass = 0
            max_streak_fail = max(max_streak_fail, streak_fail)
        else:
            eval_incomplete += 1
            streak_pass = 0
            streak_fail = 0
            break

    attempts = eval_passed + eval_failed + eval_incomplete
    denom = eval_passed + eval_failed
    pass_rate = (eval_passed / denom) if denom > 0 else None

    return {
        "presetId": rules.preset_id,
        "mode": rules.mode,
        "accountSize": rules.account_size,
        "rules": {
            "profitTargetUsd": rules.profit_target_usd,
            "maxDrawdownUsd": rules.max_drawdown_usd,
            "drawdownModel": rules.dd_model,
            "dailyLossLimitUsd": rules.daily_loss_limit_usd,
            "dailyDrawdownPct": rules.daily_drawdown_pct,
            "minTradingDays": rules.min_trading_days,
            "consistencyBestDayMaxPct": rules.consistency_best_day_max_pct,
            "performanceStartingBalance": rules.performance_starting_balance,
            "performanceMaxDrawdownUsd": rules.performance_max_drawdown_usd,
        },
        "summary": {
            "evaluationAttempts": attempts,
            "evaluationPassed": eval_passed,
            "evaluationFailed": eval_failed,
            "evaluationIncomplete": eval_incomplete,
            "evaluationPassRate": round(pass_rate, 4) if pass_rate is not None else None,
            "maxConsecutiveEvaluationPasses": max_streak_pass,
            "maxConsecutiveEvaluationFails": max_streak_fail,
            "performanceSegments": pa_segments,
            "meanPerformanceReturnPct": round(pa_total_return_pct_sum / pa_segments, 4) if pa_segments > 0 else None,
        },
        "segments": segments,
    }


def attach_prop_firm_to_normalized_result(
    normalized: dict[str, Any],
    *,
    prop_firm_raw: dict[str, Any] | None,
    initial_capital: float,
    validation_mode: str,
    sweep_mode: str | None,
) -> None:
    if not prop_firm_raw or not prop_firm_raw.get("enabled"):
        return
    if validation_mode != "single":
        normalized["propFirmBacktest"] = {
            "skipped": True,
            "reason": "Prop firm simulace je podporovaná jen pro validation_mode=single.",
        }
        return
    if sweep_mode and sweep_mode != "none" and str(sweep_mode).strip() != "":
        normalized["propFirmBacktest"] = {
            "skipped": True,
            "reason": "Vypni sweep (grid/random) pro prop firm backtest.",
        }
        return

    rules = rules_from_payload(prop_firm_raw, initial_capital)
    if rules is None:
        return
    try:
        trades = normalized.get("trades") or []
        if not isinstance(trades, list):
            trades = []
        normalized["propFirmBacktest"] = simulate_prop_firm_sequential(trades, rules)
    except Exception as e:
        normalized["propFirmBacktest"] = {"error": str(e), "errorType": type(e).__name__}