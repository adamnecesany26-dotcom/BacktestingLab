import pytest

from app.services.prop_firm_backtest import (
    PropFirmRules,
    run_evaluation_phase,
    simulate_prop_firm_sequential,
)


def _t(pnl: float, day: str) -> dict:
    return {"pnl": pnl, "exitDate": f"{day}T16:00:00", "mfeUsd": None, "maeUsd": None}


def test_eval_pass_one_trade_static_floor():
    rules = PropFirmRules(
        mode="challenges_only",
        account_size=50_000,
        profit_target_usd=3_000,
        max_drawdown_usd=5_000,
        dd_model="static_floor",
        daily_loss_limit_usd=0,
        daily_drawdown_pct=0,
        min_trading_days=0,
        consistency_best_day_max_pct=0,
        performance_starting_balance=50_000,
        performance_max_drawdown_usd=None,
        preset_id="test",
    )
    trades = [_t(3500, "2024-01-02")]
    r = run_evaluation_phase(trades, 0, rules)
    assert r["outcome"] == "passed"
    assert r["finalEquity"] == pytest.approx(53_500)


def test_eval_fail_max_dd_trailing():
    rules = PropFirmRules(
        mode="challenges_only",
        account_size=50_000,
        profit_target_usd=50_000,
        max_drawdown_usd=1_000,
        dd_model="intraday_trailing",
        daily_loss_limit_usd=0,
        daily_drawdown_pct=0,
        min_trading_days=0,
        consistency_best_day_max_pct=0,
        performance_starting_balance=50_000,
        performance_max_drawdown_usd=None,
        preset_id="test",
    )
    trades = [_t(-1500, "2024-01-02")]
    r = run_evaluation_phase(trades, 0, rules)
    assert r["outcome"] == "failed"
    assert r["failReason"] == "max_drawdown"


def test_min_trading_days_delays_pass():
    rules = PropFirmRules(
        mode="challenges_only",
        account_size=50_000,
        profit_target_usd=100,
        max_drawdown_usd=10_000,
        dd_model="static_floor",
        daily_loss_limit_usd=0,
        daily_drawdown_pct=0,
        min_trading_days=2,
        consistency_best_day_max_pct=0,
        performance_starting_balance=50_000,
        performance_max_drawdown_usd=None,
        preset_id="test",
    )
    trades = [_t(200, "2024-01-02"), _t(1, "2024-01-03")]
    r = run_evaluation_phase(trades, 0, rules)
    assert r["outcome"] == "passed"


def test_sequential_two_challenges():
    rules = PropFirmRules(
        mode="challenges_only",
        account_size=50_000,
        profit_target_usd=200,
        max_drawdown_usd=10_000,
        dd_model="static_floor",
        daily_loss_limit_usd=0,
        daily_drawdown_pct=0,
        min_trading_days=0,
        consistency_best_day_max_pct=0,
        performance_starting_balance=50_000,
        performance_max_drawdown_usd=None,
        preset_id="test",
    )
    trades = [_t(300, "2024-01-02"), _t(-12_000, "2024-01-03"), _t(250, "2024-01-04")]
    out = simulate_prop_firm_sequential(trades, rules)
    assert out["summary"]["evaluationPassed"] >= 1
    assert out["summary"]["evaluationFailed"] >= 1
