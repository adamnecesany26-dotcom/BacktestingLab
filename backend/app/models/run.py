"""
Request/response models for the /run endpoint.
"""

import re
from typing import Any, List, Optional, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class AppliedModule(BaseModel):
    """Module applied to backtest - for running detect/get_line after run."""
    id: str
    name: str
    params: Optional[dict[str, Any]] = None


class RunRequest(BaseModel):
    """Request payload for POST /run."""
    code: Optional[str] = None  # Single-file: main.py content
    files: Optional[dict[str, str]] = None  # Multi-file: {"main.py": "...", "utils.py": "..."}
    instrument: str = Field(min_length=1, max_length=64)
    timeframe: str = Field(min_length=1, max_length=32)
    years: float = Field(default=1.0, gt=0, le=50)
    data_file: str = ""
    initial_capital: float = Field(default=100000.0, gt=0)
    slippage_perc: float = Field(default=0.001, ge=0, le=1)  # 0.1%
    commission_perc: float = Field(default=0.0, ge=0, le=1)  # 0.0% default
    # Instrument type: futures | stocks | forex
    instrument_type: Literal["futures", "stocks", "forex"] = "futures"
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
    run_id: Optional[str] = None
    # Edge-finding / validation modes
    validation_mode: Literal["single", "oos_split", "walk_forward"] = "single"
    validation_config: Optional[dict[str, Any]] = None
    quality_gates: Optional[dict[str, Any]] = None
    sweep_mode: Optional[Literal["grid", "random"]] = None
    sweep_config: Optional[dict[str, Any]] = None
    monte_carlo: Optional[dict[str, Any]] = None
    regime_config: Optional[dict[str, Any]] = None
    portfolio_config: Optional[dict[str, Any]] = None
    execution_model: Optional[dict[str, Any]] = None
    experiment: Optional[dict[str, Any]] = None
    # Sequential matrix runs: { "batch_id"?: str, "max_runs"?: int (cap 48), "items": [ { partial RunRequest fields } ] }
    batch_config: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_source(self):
        if not self.code and not self.files:
            raise ValueError("Either code or files must be provided")
        if self.files and len(self.files) > 250:
            raise ValueError("Too many files in payload (max 250)")
        if self.files:
            for path, content in self.files.items():
                if len(path) > 260:
                    raise ValueError("File path too long")
                if content and len(content) > 500_000:
                    raise ValueError(f"File '{path}' exceeds max size (500k chars)")
        if self.batch_config and isinstance(self.batch_config, dict):
            items = self.batch_config.get("items")
            if isinstance(items, list) and len(items) > 48:
                raise ValueError("batch_config.items exceeds maximum of 48")
        return self

    @field_validator("run_id")
    @classmethod
    def validate_run_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        run_id = value.strip()
        if not run_id:
            return None
        if len(run_id) > 80:
            raise ValueError("run_id is too long (max 80 chars)")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", run_id):
            raise ValueError("run_id may contain only letters, numbers, '_' and '-'")
        return run_id


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
    mfe: Optional[float] = None
    mae: Optional[float] = None
    mfePct: Optional[float] = None
    maePct: Optional[float] = None
    fees: Optional[float] = None
    slippageCost: Optional[float] = None
    barsHeld: Optional[int] = None
    holdingMinutes: Optional[float] = None
    entryReason: Optional[str] = None
    exitReason: Optional[str] = None


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
    maxEquity: Optional[float] = None
    sharpeRatio: float
    maxDrawdown: float
    maxDrawdownPct: Optional[float] = None
    maxDrawdownUsd: Optional[float] = None
    commissionPerc: Optional[float] = None
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
    sortinoRatio: Optional[float] = None
    calmarRatio: Optional[float] = None
    marRatio: Optional[float] = None
    ulcerIndex: Optional[float] = None
    cagr: Optional[float] = None


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
    runId: Optional[str] = None
    manifest: Optional[dict[str, Any]] = None
    validation: Optional[dict[str, Any]] = None
    robustness: Optional[dict[str, Any]] = None
    monteCarlo: Optional[dict[str, Any]] = None
    regimeAnalysis: Optional[dict[str, Any]] = None
    portfolio: Optional[dict[str, Any]] = None
    executionSummary: Optional[dict[str, Any]] = None
    qualityGate: Optional[dict[str, Any]] = None
    experiment: Optional[dict[str, Any]] = None
    batchSummary: Optional[dict[str, Any]] = None
