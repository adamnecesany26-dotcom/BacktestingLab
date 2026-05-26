"""
POST /run endpoint - executes strategy via host backtest engine subprocess.
Supports streaming via ?stream=1
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any, AsyncIterator, Callable, Union, Awaitable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.run import RunRequest, RunResponse
from app.services.runner import log_batch_dataset_reuse, run_strategy, run_strategy_streaming
from app.services.audit import append_audit_event

router = APIRouter()


def _sse_format(event: dict) -> str:
    """Format event as SSE line."""
    return f"data: {json.dumps(event)}\n\n"


def _enforce_strict_governance(request: Request, experiment: dict[str, Any] | None) -> None:
    """Optional: reject sensitive experiment mutations from weakly authenticated clients."""
    raw = os.environ.get("API_STRICT_GOVERNANCE", "")
    if str(raw).strip().lower() not in ("1", "true", "yes", "on"):
        return
    auth = getattr(request.state, "auth_method", "") or ""
    if auth in ("api_key", "bearer"):
        return
    exp = experiment or {}
    lifecycle = str(exp.get("lifecycleStatus") or "").lower()
    if lifecycle in ("approved", "promoted"):
        raise HTTPException(
            status_code=400,
            detail="experiment.lifecycleStatus approved/promoted requires API key when API_STRICT_GOVERNANCE is enabled.",
        )
    if exp.get("reviewerApproved") is True:
        raise HTTPException(
            status_code=400,
            detail="experiment.reviewerApproved=true requires API key when API_STRICT_GOVERNANCE is enabled.",
        )
    if exp.get("promotedAt"):
        raise HTTPException(
            status_code=400,
            detail="experiment.promotedAt requires API key when API_STRICT_GOVERNANCE is enabled.",
        )


def _streaming_kwargs(
    r: RunRequest,
    actor_id: str,
    run_id: str | None,
    is_client_connected: Callable[[], Union[bool, Awaitable[bool]]],
    *,
    disallow_inprocess_engine: bool = False,
    sse_stream: bool = False,
) -> dict[str, Any]:
    return {
        "code": r.code,
        "files": r.files,
        "instrument": r.instrument,
        "timeframe": r.timeframe,
        "years": r.years,
        "data_file": r.data_file or "",
        "initial_capital": r.initial_capital,
        "slippage_perc": r.slippage_perc,
        "commission_perc": r.commission_perc,
        "instrument_type": r.instrument_type,
        "tick_size": r.tick_size,
        "value_per_tick": r.value_per_tick,
        "strategy_params": r.params,
        "applied_modules": r.applied_modules,
        "run_id": run_id,
        "validation_mode": r.validation_mode,
        "validation_config": r.validation_config,
        "quality_gates": r.quality_gates,
        "sweep_mode": r.sweep_mode,
        "sweep_config": r.sweep_config,
        "monte_carlo": r.monte_carlo,
        "regime_config": r.regime_config,
        "portfolio_config": r.portfolio_config,
        "execution_model": r.execution_model,
        "experiment": r.experiment,
        "actor_id": actor_id,
        "is_client_connected": is_client_connected,
        "run_timeout_sec": r.run_timeout_sec,
        "stream_idle_timeout_sec": r.stream_idle_timeout_sec,
        "prop_firm_backtest": r.prop_firm_backtest,
        "disallow_inprocess_engine": disallow_inprocess_engine,
        "sse_stream": sse_stream,
    }


def _merge_batch_sub_request(base: RunRequest, overrides: dict[str, Any], batch_id: str, index: int) -> RunRequest:
    bd = base.model_dump()
    od = dict(overrides or {})
    od.pop("batch_config", None)
    merged: dict[str, Any] = {**bd, **od}
    if isinstance(od.get("params"), dict):
        merged["params"] = {**(bd.get("params") or {}), **od["params"]}
    if isinstance(od.get("experiment"), dict):
        merged["experiment"] = {**(bd.get("experiment") or {}), **od["experiment"]}
    if isinstance(od.get("validation_config"), dict):
        merged["validation_config"] = {**(bd.get("validation_config") or {}), **od["validation_config"]}
    merged["batch_config"] = None
    exp = dict(merged.get("experiment") or {})
    exp["batch_id"] = batch_id
    exp["batch_index"] = index
    merged["experiment"] = exp
    root = (base.run_id or "run").strip()[:36] or "run"
    merged["run_id"] = f"{root}_b{index}"[:80]
    return RunRequest(**merged)


def _summarize_batch_row(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return {}
    m = data.get("metrics") or {}
    return {
        "runId": data.get("runId"),
        "instrument": (data.get("manifest") or {}).get("instrument"),
        "timeframe": (data.get("manifest") or {}).get("timeframe"),
        "dataFile": (data.get("manifest") or {}).get("dataFile"),
        "totalReturnUsd": m.get("totalReturnUsd"),
        "profitFactor": m.get("profitFactor"),
        "profitFactorStatus": m.get("profitFactorStatus"),
        "tradeCount": m.get("tradeCount"),
        "maxDrawdownPct": m.get("maxDrawdownPct"),
        "finalEquity": m.get("finalEquity"),
        "winRate": m.get("winRate"),
        "sharpeRatio": m.get("sharpeRatio"),
        "sortinoRatio": m.get("sortinoRatio"),
        "totalReturn": m.get("totalReturn"),
    }


def _batch_aggregates(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Souhrn přes řádky batch tabulky (ne vážené podle objemu)."""
    if not rows:
        return {}
    ok_rows = [r for r in rows if not r.get("error")]
    failed = sum(1 for r in rows if r.get("error"))
    if not ok_rows:
        return {"runCount": len(rows), "failedRunCount": failed}
    rows = ok_rows
    tc = sum(int(r.get("tradeCount") or 0) for r in rows)
    usd_vals = [float(r["totalReturnUsd"]) for r in rows if r.get("totalReturnUsd") is not None]
    pf_vals: list[float] = []
    for r in rows:
        raw = r.get("profitFactor")
        if raw is None:
            continue
        try:
            pf_vals.append(float(raw))
        except (TypeError, ValueError):
            continue
    wr_vals = [float(r["winRate"]) for r in rows if r.get("winRate") is not None]
    dd_vals = [float(r["maxDrawdownPct"]) for r in rows if r.get("maxDrawdownPct") is not None]
    out: dict[str, Any] = {
        "runCount": len(rows),
        "failedRunCount": int(failed),
        "totalTrades": tc,
    }
    if usd_vals:
        out["sumTotalReturnUsd"] = round(sum(usd_vals), 2)
        out["meanTotalReturnUsd"] = round(sum(usd_vals) / len(usd_vals), 2)
    if pf_vals:
        out["meanProfitFactor"] = round(sum(pf_vals) / len(pf_vals), 4)
    if wr_vals:
        out["meanWinRate"] = round(sum(wr_vals) / len(wr_vals), 2)
    if dd_vals:
        out["meanMaxDrawdownPct"] = round(sum(dd_vals) / len(dd_vals), 2)
    return out


# Kolik dílčích runů poslat v plné podobě (OHLC, obchody, …) — větší dávky = riziko obřího JSON
_BATCH_FULL_RUNS_CAP = 12


def _run_engine_kwargs(r: RunRequest, actor_id: str, run_id: str | None) -> dict[str, Any]:
    """Arguments for run_strategy (non-streaming) — no is_client_connected."""
    kw = _streaming_kwargs(r, actor_id, run_id, lambda: True)
    kw.pop("is_client_connected", None)
    return kw


def _build_batch_summary(
    rows: list[dict[str, Any]],
    n_tests: int,
    batch_id: str,
    *,
    full_runs_attached: bool,
    full_runs_cap: int = _BATCH_FULL_RUNS_CAP,
    batch_errors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "batchId": batch_id,
        "runCount": len(rows),
        "succeededRunCount": sum(1 for r in rows if not r.get("error")),
        "failedRunCount": sum(1 for r in rows if r.get("error")),
        "runs": rows,
        "aggregates": _batch_aggregates(rows),
        "multipleTestingWarning": (
            f"Počet testů v dávce = {n_tests}. "
            "Vícenásobné testování zvyšuje riziko falešných pozitiv — interpretuj výsledky opatrně."
        ),
    }
    if not full_runs_attached and n_tests > full_runs_cap:
        summary["batchRunsOmitted"] = True
        summary["batchRunsOmittedReason"] = (
            f"Více než {full_runs_cap} dílčích runů — v odpovědi není pole batchRuns (jen poslední run + tabulka řádků)."
        )
    if batch_errors:
        summary["batchErrors"] = batch_errors
    return summary


def _batch_parallel_workers() -> int:
    raw = os.environ.get("BATCH_PARALLEL_WORKERS", "1")
    try:
        n = int(float(raw))
    except ValueError:
        return 1
    return max(1, min(n, 8))


async def _run_batch_non_stream(request: RunRequest, actor_id: str) -> RunResponse:
    cfg = request.batch_config or {}
    items = cfg.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("batch_config.items must be a non-empty list")
    max_runs = min(max(1, int(cfg.get("max_runs", 24))), 48)
    items = items[:max_runs]
    valid_items = [x for x in items if isinstance(x, dict)]
    if not valid_items:
        raise ValueError("batch_config.items must contain at least one object")
    batch_id = str(cfg.get("batch_id") or f"batch_{uuid.uuid4().hex[:12]}")
    append_audit_event(
        action="run.batch",
        actor_id=actor_id,
        entity="batch",
        entity_id=batch_id,
        status="started",
        details={"plannedRuns": len(valid_items), "parallel": _batch_parallel_workers()},
    )
    summaries: list[dict[str, Any]] = []
    full_runs: list[dict[str, Any]] = []
    batch_errors: list[dict[str, Any]] = []
    last: RunResponse | None = None
    workers = _batch_parallel_workers()

    async def _one(i: int, ov: dict[str, Any]) -> RunResponse:
        sub = _merge_batch_sub_request(request, ov, batch_id, i)
        log_batch_dataset_reuse(sub.data_file or "", sub.instrument, sub.timeframe, sub.years)
        # Parallel batch: subprocess per worker — avoids in-process lock + sys.modules races (fáze 3).
        return await run_strategy(
            **_streaming_kwargs(
                sub,
                actor_id,
                sub.run_id,
                lambda: True,
                disallow_inprocess_engine=(workers > 1),
            )
        )

    if workers == 1:
        for i, ov in enumerate(valid_items):
            try:
                r = await _one(i, ov)
            except Exception as e:
                msg = str(e).strip() or type(e).__name__
                batch_errors.append({"index": i, "message": msg})
                summaries.append({"batchIndex": i, "error": msg})
                full_runs.append({"batchIndex": i, "error": msg})
                continue
            last = r
            dumped = r.model_dump()
            summaries.append(_summarize_batch_row(dumped))
            full_runs.append(dict(dumped))
    else:
        sem = asyncio.Semaphore(workers)

        async def _guarded(i: int, ov: dict[str, Any]) -> RunResponse:
            async with sem:
                return await _one(i, ov)

        results = await asyncio.gather(
            *[_guarded(i, ov) for i, ov in enumerate(valid_items)],
            return_exceptions=True,
        )
        for i, r in enumerate(results):
            if isinstance(r, BaseException):
                msg = str(r).strip() or type(r).__name__
                batch_errors.append({"index": i, "message": msg})
                summaries.append({"batchIndex": i, "error": msg})
                full_runs.append({"batchIndex": i, "error": msg})
                continue
            last = r
            dumped = r.model_dump()
            summaries.append(_summarize_batch_row(dumped))
            full_runs.append(dict(dumped))
    if last is None:
        detail = batch_errors[0]["message"] if batch_errors else "unknown"
        raise RuntimeError(f"Batch produced no successful runs: {detail}")
    payload = last.model_dump()
    attach_full = len(full_runs) <= _BATCH_FULL_RUNS_CAP
    payload["batchSummary"] = _build_batch_summary(
        summaries,
        len(valid_items),
        batch_id,
        full_runs_attached=attach_full,
        batch_errors=batch_errors or None,
    )
    payload["batchRuns"] = full_runs if attach_full else None
    append_audit_event(
        action="run.batch",
        actor_id=actor_id,
        entity="batch",
        entity_id=batch_id,
        status="ok",
        details={"completedRuns": len(summaries), "errors": len(batch_errors)},
    )
    return RunResponse(**payload)


async def _iter_batch_stream(
    request: RunRequest,
    actor_id: str,
    is_client_connected: Callable[[], Union[bool, Awaitable[bool]]],
) -> AsyncIterator[dict[str, Any]]:
    cfg = request.batch_config or {}
    items = cfg.get("items")
    if not isinstance(items, list) or not items:
        yield {"type": "error", "message": "batch_config.items must be a non-empty list"}
        return
    max_runs = min(max(1, int(cfg.get("max_runs", 24))), 48)
    items = items[:max_runs]
    valid_items = [x for x in items if isinstance(x, dict)]
    if not valid_items:
        yield {"type": "error", "message": "batch_config.items must contain at least one object"}
        return
    batch_id = str(cfg.get("batch_id") or f"batch_{uuid.uuid4().hex[:12]}")
    append_audit_event(
        action="run.batch",
        actor_id=actor_id,
        entity="batch",
        entity_id=batch_id,
        status="started",
        details={"plannedRuns": len(valid_items), "stream": True},
    )
    summaries: list[dict[str, Any]] = []
    full_runs: list[dict[str, Any]] = []
    batch_errors: list[dict[str, Any]] = []
    last_data: dict[str, Any] | None = None
    for i, ov in enumerate(valid_items):
        sub = _merge_batch_sub_request(request, ov, batch_id, i)
        log_batch_dataset_reuse(sub.data_file or "", sub.instrument, sub.timeframe, sub.years)
        yield {"type": "log", "line": f"[batch] Starting run {i + 1}/{len(valid_items)} ({sub.instrument} {sub.timeframe})"}
        kwargs = _streaming_kwargs(
            sub,
            actor_id,
            sub.run_id,
            is_client_connected,
            disallow_inprocess_engine=True,
            sse_stream=True,
        )
        async for ev in run_strategy_streaming(**kwargs):
            if ev.get("type") in ("log", "progress"):
                yield ev
            elif ev.get("type") == "result":
                last_data = ev.get("data")
                if isinstance(last_data, dict):
                    ld = dict(last_data)
                    summaries.append(_summarize_batch_row(ld))
                    full_runs.append(ld)
                yield {"type": "log", "line": f"[batch] Completed run {i + 1}/{len(valid_items)}"}
                break
            elif ev.get("type") == "error":
                msg = str(ev.get("message") or "error").strip()
                batch_errors.append({"index": i, "message": msg})
                summaries.append({"batchIndex": i, "error": msg})
                full_runs.append({"batchIndex": i, "error": msg})
                yield {"type": "log", "line": f"[batch] Run {i + 1}/{len(valid_items)} failed: {msg[:200]}"}
                break
    if last_data is not None:
        last_data = dict(last_data)
        attach_full = len(full_runs) <= _BATCH_FULL_RUNS_CAP
        last_data["batchSummary"] = _build_batch_summary(
            summaries,
            len(valid_items),
            batch_id,
            full_runs_attached=attach_full,
            batch_errors=batch_errors or None,
        )
        last_data["batchRuns"] = full_runs if attach_full else None
        append_audit_event(
            action="run.batch",
            actor_id=actor_id,
            entity="batch",
            entity_id=batch_id,
            status="ok",
            details={"completedRuns": len(summaries), "stream": True, "errors": len(batch_errors)},
        )
        yield {"type": "result", "data": last_data}
    elif summaries:
        attach_full = len(full_runs) <= _BATCH_FULL_RUNS_CAP
        partial_payload: dict[str, Any] = {
            "runId": f"{batch_id}_partial",
            "metrics": {},
            "manifest": {},
            "trades": [],
            "equity": [],
            "ohlc": [],
            "batchSummary": _build_batch_summary(
                summaries,
                len(valid_items),
                batch_id,
                full_runs_attached=attach_full,
                batch_errors=batch_errors or None,
            ),
            "batchRuns": full_runs if attach_full else None,
        }
        append_audit_event(
            action="run.batch",
            actor_id=actor_id,
            entity="batch",
            entity_id=batch_id,
            status="ok",
            details={"completedRuns": len(summaries), "stream": True, "errors": len(batch_errors), "partialOnly": True},
        )
        yield {"type": "result", "data": partial_payload}
    else:
        yield {"type": "error", "message": "Batch produced no results"}


@router.post("/run")
async def run_backtest(request: RunRequest, req: Request):
    """
    Runs a strategy. Use ?stream=1 for streaming (logs, progress, result).
    """
    stream_mode = req.query_params.get("stream") == "1"
    actor_id = getattr(req.state, "actor_id", "unknown")
    _enforce_strict_governance(req, request.experiment)

    batch_active = bool(
        request.batch_config
        and isinstance(request.batch_config, dict)
        and request.batch_config.get("items")
    )

    append_audit_event(
        action="run.request",
        actor_id=actor_id,
        entity="run",
        entity_id=request.run_id,
        status="received",
        details={
            "stream": stream_mode,
            "instrument": request.instrument,
            "timeframe": request.timeframe,
            "batch": batch_active,
        },
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
                if batch_active:
                    async for ev in _iter_batch_stream(request, actor_id, is_connected):
                        if debug_enabled:
                            _debug_log.append(f"{ev.get('type')}: {str(ev)[:300]}")
                        yield _sse_format(ev)
                    return

                async for ev in run_strategy_streaming(
                    **_streaming_kwargs(
                        request,
                        actor_id,
                        request.run_id,
                        is_connected,
                        disallow_inprocess_engine=True,
                        sse_stream=True,
                    )
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
        if batch_active:
            result = await _run_batch_non_stream(request, actor_id)
        else:
            result = await run_strategy(**_run_engine_kwargs(request, actor_id, request.run_id))
        append_audit_event(
            action="run.complete",
            actor_id=actor_id,
            entity="run",
            entity_id=request.run_id,
            status="ok",
            details={"instrument": request.instrument, "timeframe": request.timeframe, "batch": batch_active},
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
