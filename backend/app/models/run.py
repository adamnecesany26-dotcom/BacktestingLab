"""
Request/response models for the /run endpoint.
"""

from typing import List, Optional

from pydantic import BaseModel


class RunRequest(BaseModel):
    """Request payload for POST /run."""
    code: str
    instrument: str
    timeframe: str
    years: float = 1.0
    data_file: str = ""
    initial_capital: float = 100000.0
    commission_perc: float = 0.001  # 0.1%
    slippage_perc: float = 0.001  # 0.1%


class Trade(BaseModel):
    """Single trade record."""
    date: Optional[str] = None
    entryDate: Optional[str] = None
    exitDate: Optional[str] = None
    type: str  # 'buy' | 'sell'
    price: float
    size: float
    pnl: Optional[float] = None


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


class RunResponse(BaseModel):
    """Response payload from POST /run."""
    equity: List[float]
    metrics: BacktestMetrics
    trades: List[Trade]
    ohlc: Optional[List[OhlcBar]] = None
