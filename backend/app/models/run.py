"""
Request/response models for the /run endpoint.
"""

from typing import Any, List, Optional

from pydantic import BaseModel


class AppliedModule(BaseModel):
    """Module applied to backtest - for running detect/get_line after run."""
    id: str
    name: str
    params: Optional[dict[str, Any]] = None


class RunRequest(BaseModel):
    """Request payload for POST /run."""
    code: Optional[str] = None  # Single-file: main.py content
    files: Optional[dict[str, str]] = None  # Multi-file: {"main.py": "...", "utils.py": "..."}
    instrument: str
    timeframe: str
    years: float = 1.0
    data_file: str = ""
    initial_capital: float = 100000.0
    slippage_perc: float = 0.001  # 0.1%
    # Instrument type: futures | stocks | forex
    instrument_type: str = "futures"
    # Futures
    tick_size: Optional[float] = None
    value_per_tick: Optional[float] = None
    # Stocks
    share_size: Optional[int] = None
    # Forex
    lot_size: Optional[float] = None
    pip_size: Optional[float] = None
    pip_value: Optional[float] = None
    # Strategy parameters (from PARAMS dict)
    params: Optional[dict] = None
    # Applied modules for module outputs (markers, lines) after backtest
    applied_modules: Optional[List[AppliedModule]] = None


class Trade(BaseModel):
    """Single trade record."""
    date: Optional[str] = None
    entryDate: Optional[str] = None
    exitDate: Optional[str] = None
    type: str  # 'buy' | 'sell'
    price: float
    size: float
    pnl: Optional[float] = None
    entryPrice: Optional[float] = None
    exitPrice: Optional[float] = None


class EquityPoint(BaseModel):
    """Equity point with date."""
    date: str
    value: float


class OhlcBar(BaseModel):
    """OHLC bar for chart."""
    date: str
    open: float
    high: float
    low: float
    close: float


class BacktestMetrics(BaseModel):
    """Backtest performance metrics."""
    finalEquity: float
    sharpeRatio: float
    maxDrawdown: float
    tradeCount: int
    longCount: Optional[int] = None
    shortCount: Optional[int] = None
    winRate: Optional[float] = None
    totalReturn: Optional[float] = None
    totalReturnUsd: Optional[float] = None
    profitFactor: Optional[float] = None
    expectancyUsd: Optional[float] = None
    expectancyR: Optional[float] = None
    rMultiple: Optional[float] = None


class ModuleOutput(BaseModel):
    """Output from module detect/get_line/get_zones."""
    markers: Optional[List[dict]] = None
    lines: Optional[List[dict]] = None
    zones: Optional[List[dict]] = None


class RunResponse(BaseModel):
    """Response payload from POST /run."""
    equity: List[float]
    equityCurve: Optional[List[EquityPoint]] = None
    metrics: BacktestMetrics
    trades: List[Trade]
    ohlc: Optional[List[OhlcBar]] = None
    moduleOutputs: Optional[dict[str, ModuleOutput]] = None
