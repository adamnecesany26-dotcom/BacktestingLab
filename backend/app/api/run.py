"""
POST /run endpoint - executes strategy in Docker sandbox and returns backtest results.
Supports streaming via ?stream=1
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import json
import os

from app.models.run import RunRequest, RunResponse
from app.services.runner import run_strategy, run_strategy_streaming
from app.services.audit import append_audit_event

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
    actor_id = getattr(req.state, "actor_id", "unknown")
    append_audit_event(
        action="run.request",
        actor_id=actor_id,
        entity="run",
        entity_id=request.run_id,
        status="received",
        details={"stream": stream_mode, "instrument": request.instrument, "timeframe": request.timeframe},
    )

    if stream_mode:
        async def is_connected():
            return not await req.is_disconnected()

        _debug_log = []
        debug_enabled = os.environ.get("API_RUN_DEBUG_LOG", "").strip().lower() in ("1", "true", "yes", "on")

        async def generate():
            from pathlib import Path
            log_path = None
            if debug_enabled:
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
                    commission_perc=request.commission_perc,
                    instrument_type=request.instrument_type,
                    tick_size=request.tick_size,
                    value_per_tick=request.value_per_tick,
                    share_size=request.share_size,
                    lot_size=request.lot_size,
                    pip_size=request.pip_size,
                    pip_value=request.pip_value,
                    strategy_params=request.params,
                    applied_modules=request.applied_modules,
                    run_id=request.run_id,
                    validation_mode=request.validation_mode,
                    validation_config=request.validation_config,
                    quality_gates=request.quality_gates,
                    sweep_mode=request.sweep_mode,
                    sweep_config=request.sweep_config,
                    monte_carlo=request.monte_carlo,
                    regime_config=request.regime_config,
                    portfolio_config=request.portfolio_config,
                    execution_model=request.execution_model,
                    experiment=request.experiment,
                    actor_id=actor_id,
                    is_client_connected=is_connected,
                ):
                    if debug_enabled:
                        _debug_log.append(f"{ev.get('type')}: {str(ev)[:300]}")
                    if debug_enabled and ev.get("type") == "error" and log_path is not None:
                        log_path.write_text("\n".join(_debug_log) + f"\n\nERROR: {ev.get('message', '')[:2000]}", encoding="utf-8")
                    if debug_enabled and ev.get("type") == "result" and log_path is not None:
                        log_path.write_text("SUCCESS\n" + "\n".join(_debug_log[-3:]), encoding="utf-8")
                    yield _sse_format(ev)
            except Exception as e:
                msg = str(e) or f"{type(e).__name__}"
                append_audit_event(
                    action="run.stream",
                    actor_id=actor_id,
                    entity="run",
                    entity_id=request.run_id,
                    status="error",
                    details={"error": msg[:400]},
                )
                if debug_enabled and log_path is not None:
                    import traceback
                    tb = traceback.format_exc()
                    log_path.write_text(f"EXCEPTION: {msg}\n\n{tb}\n\nEvents: {_debug_log}", encoding="utf-8")
                yield _sse_format({"type": "error", "message": msg})

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

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
            commission_perc=request.commission_perc,
            instrument_type=request.instrument_type,
            tick_size=request.tick_size,
            value_per_tick=request.value_per_tick,
            share_size=request.share_size,
            lot_size=request.lot_size,
            pip_size=request.pip_size,
            pip_value=request.pip_value,
            strategy_params=request.params,
            applied_modules=request.applied_modules,
            run_id=request.run_id,
            validation_mode=request.validation_mode,
            validation_config=request.validation_config,
            quality_gates=request.quality_gates,
            sweep_mode=request.sweep_mode,
            sweep_config=request.sweep_config,
            monte_carlo=request.monte_carlo,
            regime_config=request.regime_config,
            portfolio_config=request.portfolio_config,
            execution_model=request.execution_model,
            experiment=request.experiment,
            actor_id=actor_id,
        )
        append_audit_event(
            action="run.complete",
            actor_id=actor_id,
            entity="run",
            entity_id=request.run_id,
            status="ok",
            details={"instrument": request.instrument, "timeframe": request.timeframe},
        )
        return result
    except ValueError as e:
        append_audit_event(
            action="run.complete",
            actor_id=actor_id,
            entity="run",
            entity_id=request.run_id,
            status="error",
            details={"error": str(e)[:400]},
        )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        append_audit_event(
            action="run.complete",
            actor_id=actor_id,
            entity="run",
            entity_id=request.run_id,
            status="error",
            details={"error": str(e)[:400]},
        )
        raise HTTPException(status_code=500, detail="Internal backtest error.")
