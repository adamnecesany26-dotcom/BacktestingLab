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


class Trade(BaseModel):
    """Single trade record."""
    date: str
    type: str  # 'buy' | 'sell'
    price: float
    size: float
    pnl: Optional[float] = None


class BacktestMetrics(BaseModel):
    """Backtest performance metrics."""
    finalEquity: float
    sharpeRatio: float
    maxDrawdown: float
    tradeCount: int
    winRate: Optional[float] = None
    totalReturn: Optional[float] = None


class RunResponse(BaseModel):
    """Response payload from POST /run."""
    equity: List[float]
    metrics: BacktestMetrics
    trades: List[Trade]
