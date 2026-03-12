"""
POST /run endpoint - executes strategy in Docker sandbox and returns backtest results.
"""

from fastapi import APIRouter, HTTPException

from app.models.run import RunRequest, RunResponse
from app.services.runner import run_strategy

router = APIRouter()


@router.post("/run", response_model=RunResponse)
async def run_backtest(request: RunRequest):
    """
    Runs a strategy:
    1. Creates temporary run directory
    2. Writes strategy.py
    3. Executes Docker container
    4. Container runs engine.py with Backtrader
    5. Returns equity curve, metrics, and trades
    """
    try:
        result = await run_strategy(
            code=request.code,
            instrument=request.instrument,
            timeframe=request.timeframe,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
