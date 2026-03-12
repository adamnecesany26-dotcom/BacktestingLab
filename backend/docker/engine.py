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


def load_data(data_path: str, instrument: str, timeframe: str) -> pd.DataFrame:
    """Load OHLCV data from parquet. Falls back to sample data if missing."""
    base = Path(data_path)
    # Try common naming: {instrument}_{timeframe}.parquet
    candidates = [
        base / f"{instrument}_{timeframe}.parquet",
        base / f"{instrument}.parquet",
        base / "sample.parquet",
    ]
    for p in candidates:
        if p.exists():
            df = pd.read_parquet(p)
            return df

    # Generate minimal sample data for demo
    import numpy as np
    dates = pd.date_range(start="2020-01-01", periods=252, freq="B")
    np.random.seed(42)
    close = 100 + np.cumsum(np.random.randn(252) * 0.5)
    df = pd.DataFrame({
        "open": close - 0.2,
        "high": close + 0.5,
        "low": close - 0.5,
        "close": close,
        "volume": np.random.randint(1000, 10000, 252),
    }, index=dates)
    df.index.name = "datetime"
    return df


def run_backtest(strategy_cls, data: pd.DataFrame) -> dict:
    """Run Backtrader backtest and return results dict."""
    equity_list = []

    class EquityRecorder(bt.Strategy):
        """Records broker value at each bar."""

        def next(self):
            equity_list.append(self.broker.getvalue())

    cerebro = bt.Cerebro()

    # Ensure datetime index
    if not isinstance(data.index, pd.DatetimeIndex):
        data = data.reset_index()
        if "datetime" in data.columns:
            data = data.set_index("datetime")
        elif "date" in data.columns:
            data = data.set_index("date")

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
    cerebro.addstrategy(EquityRecorder)
    cerebro.addstrategy(strategy_cls)
    cerebro.broker.setcash(100000.0)
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name="sharpe")
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name="drawdown")
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")

    results = cerebro.run()
    strat = results[1]  # User strategy (0=EquityRecorder)

    # Equity curve - include initial value
    equity_curve = [100000.0] + equity_list

    # Metrics
    sharpe = strat.analyzers.sharpe.get_analysis()
    dd = strat.analyzers.drawdown.get_analysis()
    ta = strat.analyzers.trades.get_analysis()

    total_trades = ta.get("total", {}).get("closed", 0) or 0
    won = ta.get("won", {}).get("total", 0) or 0
    win_rate = (won / total_trades * 100) if total_trades else 0

    metrics = {
        "finalEquity": cerebro.broker.getvalue(),
        "sharpeRatio": sharpe.get("sharperatio", 0) or 0,
        "maxDrawdown": dd.get("max", {}).get("drawdown", 0) or 0,
        "tradeCount": total_trades,
        "winRate": round(win_rate, 2),
        "totalReturn": round((cerebro.broker.getvalue() - 100000) / 100000 * 100, 2),
    }

    # Trades (simplified - Backtrader trade list is complex)
    trades = []

    return {
        "equity": equity_curve,
        "metrics": metrics,
        "trades": trades,
    }


def main():
    strategy_path = os.environ.get("STRATEGY_PATH", "/app/strategy/strategy.py")
    data_path = os.environ.get("DATA_PATH", "/app/data")
    instrument = os.environ.get("INSTRUMENT", "BTCUSD")
    timeframe = os.environ.get("TIMEFRAME", "1d")

    try:
        strategy_cls = load_strategy(strategy_path)
        data = load_data(data_path, instrument, timeframe)
        result = run_backtest(strategy_cls, data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
