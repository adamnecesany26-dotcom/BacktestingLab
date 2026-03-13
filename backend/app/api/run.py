"""
POST /run endpoint - executes strategy in Docker sandbox and returns backtest results.
Supports streaming via ?stream=1
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import json

from app.models.run import RunRequest, RunResponse
from app.services.runner import run_strategy, run_strategy_streaming

router = APIRouter()


def _sse_format(event: dict) -> str:
    """Format event as SSE line."""
    return f"data: {json.dumps(event)}\n\n"


@router.post("/run")
async def run_backtest(request: RunRequest, req: Request):
    """
    Runs a strategy. Use ?stream=1 for streaming (logs, progress, result).
    """
    stream_mode = req.query_params.get("stream") == "1"

    if stream_mode:
        async def is_connected():
            return not await req.is_disconnected()

        _debug_log = []

        async def generate():
            from pathlib import Path
            log_path = Path(__file__).resolve().parent.parent.parent.parent / ".backtest_run" / "api_debug.log"
            log_path.parent.mkdir(exist_ok=True)
            try:
                async for ev in run_strategy_streaming(
                    code=request.code,
                    files=request.files,
                    instrument=request.instrument,
                    timeframe=request.timeframe,
                    years=request.years,
                    data_file=request.data_file or "",
                    initial_capital=request.initial_capital,
                    slippage_perc=request.slippage_perc,
                    instrument_type=request.instrument_type,
                    tick_size=request.tick_size,
                    value_per_tick=request.value_per_tick,
                    share_size=request.share_size,
                    lot_size=request.lot_size,
                    pip_size=request.pip_size,
                    pip_value=request.pip_value,
                    is_client_connected=is_connected,
                ):
                    _debug_log.append(f"{ev.get('type')}: {str(ev)[:300]}")
                    if ev.get("type") == "error":
                        log_path.write_text("\n".join(_debug_log) + f"\n\nERROR: {ev.get('message', '')[:2000]}", encoding="utf-8")
                    if ev.get("type") == "result":
                        log_path.write_text("SUCCESS\n" + "\n".join(_debug_log[-3:]), encoding="utf-8")
                    yield _sse_format(ev)
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                msg = str(e) or f"{type(e).__name__}"
                log_path.write_text(f"EXCEPTION: {msg}\n\n{tb}\n\nEvents: {_debug_log}", encoding="utf-8")
                yield _sse_format({"type": "error", "message": msg})

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    if not request.code and not request.files:
        raise HTTPException(status_code=400, detail="Either code or files must be provided")

    try:
        result = await run_strategy(
            code=request.code,
            files=request.files,
            instrument=request.instrument,
            timeframe=request.timeframe,
            years=request.years,
            data_file=request.data_file or "",
            initial_capital=request.initial_capital,
            slippage_perc=request.slippage_perc,
            instrument_type=request.instrument_type,
            tick_size=request.tick_size,
            value_per_tick=request.value_per_tick,
            share_size=request.share_size,
            lot_size=request.lot_size,
            pip_size=request.pip_size,
            pip_value=request.pip_value,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
