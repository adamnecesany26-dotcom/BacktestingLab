"""
POST /chart endpoint - generates candlestick chart with mplfinance.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional

from app.services.chart import generate_chart

router = APIRouter()


class OhlcBarInput(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float


class TradeInput(BaseModel):
    date: Optional[str] = None
    entryDate: Optional[str] = None
    exitDate: Optional[str] = None
    type: str
    price: float
    size: float
    pnl: Optional[float] = None
    entryPrice: Optional[float] = None
    exitPrice: Optional[float] = None


class ChartRequest(BaseModel):
    ohlc: List[OhlcBarInput]
    trades: List[TradeInput]


@router.post("/chart")
async def create_chart(req: ChartRequest):
    """
    Generate PNG candlestick chart with entry/exit markers and MFE/MAE zones.
    """
    if not req.ohlc:
        raise HTTPException(status_code=400, detail="No OHLC data provided")

    try:
        ohlc_dicts = [b.model_dump() for b in req.ohlc]
        trade_dicts = [t.model_dump() for t in req.trades]
        png_bytes = generate_chart(
            ohlc=ohlc_dicts,
            trades=trade_dicts,
            width=16,
            height=8,
            dpi=120,
        )
        return Response(content=png_bytes, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
