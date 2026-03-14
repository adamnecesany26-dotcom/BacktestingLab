"""
Backtest engine - executed inside Docker container.
1. Loads strategy dynamically from mounted /app/strategy
2. Loads dataset from parquet
3. Initializes Backtrader
4. Runs strategy
5. Computes metrics
6. Outputs JSON to stdout
"""

import importlib.util
import json
import os
import sys
from pathlib import Path

import backtrader as bt
import pandas as pd


def load_strategy(strategy_path: str):
    """Dynamically load strategy module from path."""
    path = Path(strategy_path)
    if not path.exists():
        raise FileNotFoundError(f"Strategy not found: {strategy_path}")

    spec = importlib.util.spec_from_file_location("strategy_module", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["strategy_module"] = module
    spec.loader.exec_module(module)

    # Find Strategy class (first bt.Strategy subclass)
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, type) and issubclass(obj, bt.Strategy):
            return obj
    raise ValueError("No bt.Strategy subclass found in strategy file")


def load_data(
    data_path: str,
    instrument: str,
    timeframe: str,
    years: float = 1.0,
    data_file: str = "",
) -> pd.DataFrame:
    """Load OHLCV data from CSV or parquet."""
    base = Path(data_path)

    # Explicit file path (e.g. mock/NQ_5Y.csv)
    if data_file:
        p = base / data_file
        if p.exists():
            return _load_file(p, years)

    # Try common naming
    candidates = [
        base / "mock" / f"{instrument}_5Y.csv",
        base / "mock" / f"{instrument}.csv",
        base / f"{instrument}_{timeframe}.parquet",
        base / f"{instrument}.parquet",
    ]
    for p in candidates:
        if p.exists():
            return _load_file(p, years)

    raise FileNotFoundError(f"No data found for {instrument} in {base}")


def _load_file(path: Path, years: float) -> pd.DataFrame:
    """Load and normalize OHLCV from CSV or parquet."""
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
        # Normalize columns (e.g. Close/Last -> close)
        col_map = {}
        for c in df.columns:
            l = c.lower()
            if "close" in l or "last" in l:
                col_map[c] = "close"
            elif "open" in l:
                col_map[c] = "open"
            elif "high" in l:
                col_map[c] = "high"
            elif "low" in l:
                col_map[c] = "low"
            elif "date" in l:
                col_map[c] = "datetime"
            elif "volume" in l:
                col_map[c] = "volume"
        df = df.rename(columns=col_map)
        if "datetime" in df.columns:
            df["datetime"] = pd.to_datetime(df["datetime"])
            df = df.set_index("datetime").sort_index()
        else:
            for dc in ["Date", "date"]:
                if dc in df.columns:
                    df["datetime"] = pd.to_datetime(df[dc])
                    df = df.set_index("datetime").sort_index()
                    break
        if "volume" not in df.columns:
            df["volume"] = 1000
        # Filter by years (most recent)
        if years > 0 and len(df) > 0:
            cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
            df = df[df.index >= cutoff]
    else:
        df = pd.read_parquet(path)
        if years > 0 and len(df) > 0:
            if hasattr(df.index, "max"):
                cutoff = df.index.max() - pd.Timedelta(days=years * 365.25)
                df = df[df.index >= cutoff]

    return df


def _load_broker_config(data_path: str, instrument: str) -> dict | None:
    """Load broker config for instrument from data/broker_config.json."""
    config_path = Path(data_path) / "broker_config.json"
    if not config_path.exists():
        return None
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
        return config.get(instrument)
    except Exception:
        return None


def run_backtest(
    strategy_cls,
    data: pd.DataFrame,
    data_path: str = "",
    instrument: str = "",
    strategy_params: dict | None = None,
) -> dict:
    """Run Backtrader backtest and return results dict."""
    equity_list = []
    trades_list = []
    total_bars = len(data)

    class EquityRecorder(bt.Strategy):
        """Records broker value at each bar, reports progress to stderr."""

        params = (("total_bars", 0),)

        def __init__(self):
            self._last_pct = -1

        def next(self):
            equity_list.append(self.broker.getvalue())
            if self.params.total_bars > 0:
                pct = min(99, int((len(self) / self.params.total_bars) * 100))
                if pct != self._last_pct and pct % 10 == 0:
                    print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)
                    self._last_pct = pct

    class TradeRecordingStrategy(strategy_cls):
        """Wraps user strategy to record closed trades via notify_trade and notify_order."""

        def notify_trade(self, trade):
            super().notify_trade(trade)
            _record_trade(trade)

        def notify_order(self, order):
            super().notify_order(order)
            if getattr(order, "trade", None) and order.trade.isclosed:
                _record_trade(order.trade)

    def _record_trade(trade):
        """Record a closed trade to trades_list."""
        if not trade.isclosed:
            return
        try:
            dt_open = trade.open_datetime() if hasattr(trade, "open_datetime") else None
            dt_close = trade.close_datetime() if hasattr(trade, "close_datetime") else None
            size, is_long = 1, True
            entry_price = trade.price
            exit_price = trade.price
            if hasattr(trade, "history") and trade.history:
                op = trade.history[0]
                size = abs(getattr(op, "size", 1)) or 1
                is_long = getattr(op, "size", 1) > 0
                entry_price = float(getattr(op, "price", trade.price))
                exit_price = float(getattr(trade.history[-1], "price", trade.price))
            trades_list.append({
                "date": dt_close.isoformat() if dt_close else "",
                "entryDate": dt_open.isoformat() if dt_open else "",
                "exitDate": dt_close.isoformat() if dt_close else "",
                "type": "buy" if is_long else "sell",
                "size": size,
                "pnl": round(trade.pnlcomm, 2),
                "price": exit_price,
                "entryPrice": round(entry_price, 2),
                "exitPrice": round(exit_price, 2),
            })
        except Exception:
            pass

    cerebro = bt.Cerebro()

    # Ensure datetime index
    if not isinstance(data.index, pd.DatetimeIndex):
        data = data.reset_index()
        if "datetime" in data.columns:
            data = data.set_index("datetime")
        elif "date" in data.columns:
            data = data.set_index("date")

    # Broker config: futures (mult, margin, commission) or stocks (commission %)
    broker_cfg = _load_broker_config(data_path, instrument)
    instrument_type = os.environ.get("INSTRUMENT_TYPE", "futures")

    if broker_cfg and instrument_type == "futures" and broker_cfg.get("margin") is not None:
        # Futures: commission per contract, margin, mult for PnL
        commission = float(broker_cfg.get("commission_per_contract", 0) or 0)
        margin = float(broker_cfg.get("margin", 0) or 0)
        mult = float(broker_cfg.get("mult", 1) or 1)
        cerebro.broker.setcommission(commission=commission, margin=margin, mult=mult)
    else:
        # Stocks / Forex / no config: percentage commission or zero
        default_cfg = None
        try:
            cfg_path = Path(data_path) / "broker_config.json"
            if cfg_path.exists():
                with open(cfg_path, encoding="utf-8") as f:
                    full_cfg = json.load(f)
                default_cfg = full_cfg.get("default", {})
        except Exception:
            pass
        commission_pct = 0.0
        if default_cfg and default_cfg.get("commission_perc") is not None:
            commission_pct = float(default_cfg.get("commission_perc", 0) or 0)
        cerebro.broker.setcommission(commission=commission_pct, margin=None, mult=1.0)

    data_bt = bt.feeds.PandasData(
        dataname=data,
        datetime=None,
        open="open",
        high="high",
        low="low",
        close="close",
        volume="volume",
        openinterest=-1,
    )
    cerebro.adddata(data_bt)
    cerebro.addstrategy(EquityRecorder, total_bars=total_bars)
    params = strategy_params or {}
    cerebro.addstrategy(TradeRecordingStrategy, **params)

    initial_capital = float(os.environ.get("INITIAL_CAPITAL", "100000"))
    slippage_perc = float(os.environ.get("SLIPPAGE_PERC", "0.001"))

    cerebro.broker.setcash(initial_capital)
    cerebro.broker.set_slippage_perc(slippage_perc)
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name="sharpe")
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name="drawdown")
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")

    results = cerebro.run()
    strat = results[1]  # User strategy (0=EquityRecorder)

    # Fallback: if notify_trade/notify_order didn't capture trades, try strategy's _trades
    if not trades_list and hasattr(strat, "_trades"):
        for data, trades in strat._trades.items():
            for t in trades:
                if getattr(t, "isclosed", False):
                    _record_trade(t)

    print("PROGRESS:100", file=sys.stderr, flush=True)

    # Equity curve - include initial value
    equity_curve = [initial_capital] + equity_list

    # Equity curve with dates (for export/save)
    equity_curve_with_dates = []
    if isinstance(data.index, pd.DatetimeIndex) and len(data.index) > 0:
        first_ts = data.index[0]
        day_before = (first_ts - pd.Timedelta(days=1)).strftime("%Y-%m-%d") if hasattr(first_ts, "strftime") else ""
        equity_curve_with_dates.append({"date": day_before, "value": round(equity_curve[0], 2)})
        for i, ts in enumerate(data.index):
            if i + 1 < len(equity_curve):
                date_str = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
                equity_curve_with_dates.append({"date": date_str, "value": round(equity_curve[i + 1], 2)})
    else:
        for i, v in enumerate(equity_curve):
            equity_curve_with_dates.append({"date": str(i), "value": round(v, 2)})

    # Metrics
    sharpe = strat.analyzers.sharpe.get_analysis()
    dd = strat.analyzers.drawdown.get_analysis()
    ta = strat.analyzers.trades.get_analysis()

    total_trades = ta.get("total", {}).get("closed", 0) or 0
    won = ta.get("won", {}).get("total", 0) or 0
    win_rate = (won / total_trades * 100) if total_trades else 0
    final_equity = cerebro.broker.getvalue()
    total_return_usd = final_equity - initial_capital
    total_return_pct = round((total_return_usd / initial_capital) * 100, 2)

    losing = [t for t in trades_list if t["pnl"] < 0]
    gross_profit = sum(t["pnl"] for t in trades_list if t["pnl"] > 0)
    gross_loss = abs(sum(t["pnl"] for t in losing))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    expectancy_usd = round(sum(t["pnl"] for t in trades_list) / len(trades_list), 2) if trades_list else 0.0
    avg_loss = abs(sum(t["pnl"] for t in losing) / len(losing)) if losing else 1.0
    expectancy_r = round(expectancy_usd / avg_loss, 2) if avg_loss else 0.0
    long_count = sum(1 for t in trades_list if t["type"] == "buy")
    short_count = sum(1 for t in trades_list if t["type"] == "sell")

    metrics = {
        "finalEquity": float(final_equity),
        "sharpeRatio": float(sharpe.get("sharperatio", 0) or 0),
        "maxDrawdown": float(dd.get("max", {}).get("drawdown", 0) or 0),
        "tradeCount": int(total_trades),
        "longCount": int(long_count),
        "shortCount": int(short_count),
        "winRate": float(round(win_rate, 2)),
        "totalReturn": float(total_return_pct),
        "totalReturnUsd": float(round(total_return_usd, 2)),
        "profitFactor": float(profit_factor),
        "expectancyUsd": float(expectancy_usd),
        "expectancyR": float(expectancy_r),
        "rMultiple": float(expectancy_r),  # expectancy in R = avg R-multiple per trade
    }

    # OHLC for chart (date, open, high, low, close)
    ohlc = []
    if isinstance(data.index, pd.DatetimeIndex):
        for i, ts in enumerate(data.index):
            if i < len(data):
                row = data.iloc[i]
                ohlc.append({
                    "date": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "open": float(row.get("open", row.get("Open", 0))),
                    "high": float(row.get("high", row.get("High", 0))),
                    "low": float(row.get("low", row.get("Low", 0))),
                    "close": float(row.get("close", row.get("Close", 0))),
                })

    return {
        "equity": equity_curve,
        "equityCurve": equity_curve_with_dates,
        "metrics": metrics,
        "trades": trades_list,
        "ohlc": ohlc,
    }


def main():
    strategy_path = os.environ.get("STRATEGY_PATH", "/app/strategy/strategy.py")
    data_path = os.environ.get("DATA_PATH", "/app/data")
    instrument = os.environ.get("INSTRUMENT", "NQ")
    timeframe = os.environ.get("TIMEFRAME", "1d")
    years = float(os.environ.get("YEARS", "1"))
    data_file = os.environ.get("DATA_FILE", "")
    strategy_params_raw = os.environ.get("STRATEGY_PARAMS", "{}")
    try:
        strategy_params = json.loads(strategy_params_raw) if strategy_params_raw else {}
    except json.JSONDecodeError:
        strategy_params = {}

    try:
        print("[engine] Loading strategy...", file=sys.stderr, flush=True)
        strategy_cls = load_strategy(strategy_path)
        print("[engine] Loading data...", file=sys.stderr, flush=True)
        data = load_data(data_path, instrument, timeframe, years, data_file)
        print(f"[engine] Running backtest ({len(data)} bars)...", file=sys.stderr, flush=True)
        result = run_backtest(
            strategy_cls,
            data,
            data_path=str(data_path),
            instrument=instrument,
            strategy_params=strategy_params,
        )
        print(json.dumps(result))
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        msg = str(e) or f"{type(e).__name__}"
        full = f"{msg}\n\n{tb}"
        print(json.dumps({"error": full}), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
