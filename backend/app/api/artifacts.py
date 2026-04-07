"""
POST /api/artifacts/status | /api/artifacts/build — fáze 6 (Build features, stav cache).
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue as sync_queue
import os
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.audit import append_audit_event
from app.services.artifact_api_service import artifact_status_payload, run_artifact_build

router = APIRouter()
_log = logging.getLogger(__name__)


def _resolve_artifact_build_stream_idle_timeout_sec() -> int:
    """
    Max seconds without any *real* progress event (not pulse) while build thread is alive.
    If exceeded, SSE returns an error so UI doesn't look "stuck forever".
    """
    raw = os.environ.get("ARTIFACT_BUILD_STREAM_IDLE_TIMEOUT_SEC")
    if raw is None or str(raw).strip() == "":
        return 1800  # 30 min default
    try:
        v = int(float(raw))
    except ValueError:
        return 1800
    return max(0, v)


class ArtifactCommon(BaseModel):
    data_file: str
    years: float = 0.0
    start_iso: str | None = None
    end_iso: str | None = None


class ArtifactStatusRequest(ArtifactCommon):
    pass


class ArtifactBuildRequest(ArtifactCommon):
    # Legacy pole z klienta — u buildu se ignoruje; TF určuje ``precompute_timeframes``.
    zone_timeframes: list[str] | None = None
    precompute_timeframes: list[str] | None = None
    hl_params: dict[str, Any] | None = None
    sd_params: dict[str, Any] | None = None
    skip_hl: bool = False
    skip_sd: bool = False


def _overall_label_overall(overall: str) -> str:
    return {
        "fresh": "Fresh",
        "missing_hl": "Chybí H/L",
        "missing_sd": "Chybí S/D",
        "stale_data": "Stale (data)",
        "stale_code": "Stale (code)",
        "error": "Error",
    }.get(overall, overall)


def _artifact_build_ok_payload(req: ArtifactBuildRequest, result: dict[str, Any]) -> dict[str, Any]:
    st = artifact_status_payload(
        data_file=req.data_file,
        years=req.years,
        start_iso=req.start_iso,
        end_iso=req.end_iso,
    )
    return {
        "ok": True,
        "dataset_id": result.get("dataset_id"),
        "hl": result.get("hl"),
        "sd": result.get("sd"),
        "status": st,
        "overall_label": _overall_label_overall(str((st or {}).get("overall") or "fresh")),
    }


@router.post("/artifacts/status")
async def post_artifact_status(req: ArtifactStatusRequest, request: Request):
    actor_id = getattr(request.state, "actor_id", "unknown")
    payload = artifact_status_payload(
        data_file=req.data_file,
        years=req.years,
        start_iso=req.start_iso,
        end_iso=req.end_iso,
    )
    append_audit_event(
        action="artifacts.status",
        actor_id=actor_id,
        entity="artifacts",
        status="ok" if payload.get("ok") else "error",
        details={
            "data_file": req.data_file,
            "years": req.years,
            "overall": payload.get("overall"),
            "dataset_id": payload.get("dataset_id"),
        },
    )
    out = dict(payload)
    out["overall_label"] = _overall_label_overall(str(payload.get("overall") or "error"))
    return out


@router.post("/artifacts/build")
async def post_artifact_build(
    req: ArtifactBuildRequest,
    request: Request,
    stream: int = Query(0, description="1 = SSE průběh (data: JSON lines)"),
):
    actor_id = getattr(request.state, "actor_id", "unknown")

    if stream:
        holder: dict[str, Any] = {}
        sync_q: sync_queue.Queue[dict[str, Any]] = sync_queue.Queue()

        def worker() -> None:
            try:
                holder["result"] = run_artifact_build(
                    data_file=req.data_file,
                    years=req.years,
                    start_iso=req.start_iso,
                    end_iso=req.end_iso,
                    zone_timeframes=req.zone_timeframes,
                    precompute_timeframes=req.precompute_timeframes,
                    hl_params=req.hl_params,
                    sd_params=req.sd_params,
                    skip_hl=req.skip_hl,
                    skip_sd=req.skip_sd,
                    progress=lambda ev: sync_q.put(ev),
                )
            except BaseException as e:  # noqa: BLE001
                holder["exc"] = e

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        def _get_ev(timeout: float) -> dict[str, Any] | None:
            try:
                return sync_q.get(timeout=timeout)
            except sync_queue.Empty:
                return None

        async def event_gen():
            # Po „hl“/„sd“ může být hodiny ticho — bez chunků proxy/prohlížeč nemusí nic vykreslit.
            # Každých ~12 s pošleme pulz, aby UI i spojení žily.
            last_chunk_at = time.monotonic()
            pulse_sec = 12.0
            idle_timeout_sec = _resolve_artifact_build_stream_idle_timeout_sec()
            last_real_ev_at = time.monotonic()
            last_real_phase: str | None = None
            last_real_msg: str | None = None
            while True:
                item_dict = await asyncio.to_thread(_get_ev, 1.0)
                if item_dict is not None:
                    yield f"data: {json.dumps(item_dict)}\n\n"
                    last_chunk_at = time.monotonic()
                    last_real_ev_at = last_chunk_at
                    if isinstance(item_dict, dict) and item_dict.get("type") == "phase":
                        ph = item_dict.get("phase")
                        if ph and ph != "pulse":
                            last_real_phase = str(ph)
                            msg = item_dict.get("message")
                            last_real_msg = str(msg) if msg is not None else None
                elif t.is_alive() and (time.monotonic() - last_chunk_at) >= pulse_sec:
                    yield f"data: {json.dumps({'type': 'phase', 'phase': 'pulse', 'message': 'Probíhá výpočet na serveru (H/L nebo S/D může trvat dlouho)…'})}\n\n"
                    last_chunk_at = time.monotonic()
                # True stall detection: no real events for too long (pulse doesn't reset this timer).
                if t.is_alive() and idle_timeout_sec > 0 and (time.monotonic() - last_real_ev_at) >= idle_timeout_sec:
                    stall_msg = (
                        f"Build artefaktů se jeví jako zaseklý (bez progress eventu {idle_timeout_sec}s)."
                    )
                    if last_real_phase or last_real_msg:
                        stall_msg += f" Poslední fáze: {last_real_phase or 'phase'}"
                        if last_real_msg:
                            stall_msg += f" · {last_real_msg}"
                    append_audit_event(
                        action="artifacts.build",
                        actor_id=actor_id,
                        entity="artifacts",
                        status="error",
                        details={
                            "data_file": req.data_file,
                            "error": stall_msg[:400],
                            "stream": True,
                            "stall": True,
                            "idle_timeout_sec": idle_timeout_sec,
                            "last_phase": last_real_phase,
                        },
                    )
                    yield f"data: {json.dumps({'type': 'error', 'message': stall_msg})}\n\n"
                    return
                if not t.is_alive():
                    break
            while True:
                try:
                    extra = sync_q.get_nowait()
                    yield f"data: {json.dumps(extra)}\n\n"
                except sync_queue.Empty:
                    break
            t.join(timeout=48 * 3600)
            exc = holder.get("exc")
            if exc is not None:
                if isinstance(exc, ValueError):
                    msg = str(exc)
                    append_audit_event(
                        action="artifacts.build",
                        actor_id=actor_id,
                        entity="artifacts",
                        status="error",
                        details={"data_file": req.data_file, "error": msg[:400], "stream": True},
                    )
                elif isinstance(exc, RuntimeError):
                    msg = str(exc).strip() or "Precompute zamčeno nebo selhalo."
                    append_audit_event(
                        action="artifacts.build",
                        actor_id=actor_id,
                        entity="artifacts",
                        status="error",
                        details={"data_file": req.data_file, "error": msg[:400], "stream": True},
                    )
                else:
                    _log.exception(
                        "artifacts.build stream failed data_file=%s years=%s",
                        req.data_file,
                        req.years,
                    )
                    msg = str(exc)[:500]
                    append_audit_event(
                        action="artifacts.build",
                        actor_id=actor_id,
                        entity="artifacts",
                        status="error",
                        details={"data_file": req.data_file, "error": msg[:400], "stream": True},
                    )
                yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
                return

            result = holder.get("result")
            if result is None:
                append_audit_event(
                    action="artifacts.build",
                    actor_id=actor_id,
                    entity="artifacts",
                    status="error",
                    details={"data_file": req.data_file, "error": "no_result", "stream": True},
                )
                yield f"data: {json.dumps({'type': 'error', 'message': 'Build skončil bez výsledku.'})}\n\n"
                return

            append_audit_event(
                action="artifacts.build",
                actor_id=actor_id,
                entity="artifacts",
                status="ok",
                details={
                    "data_file": req.data_file,
                    "years": req.years,
                    "dataset_id": result.get("dataset_id"),
                    "skip_hl": req.skip_hl,
                    "skip_sd": req.skip_sd,
                    "stream": True,
                },
            )
            payload = _artifact_build_ok_payload(req, result)
            yield f"data: {json.dumps({'type': 'result', 'data': payload})}\n\n"

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        result = run_artifact_build(
            data_file=req.data_file,
            years=req.years,
            start_iso=req.start_iso,
            end_iso=req.end_iso,
            zone_timeframes=req.zone_timeframes,
            precompute_timeframes=req.precompute_timeframes,
            hl_params=req.hl_params,
            sd_params=req.sd_params,
            skip_hl=req.skip_hl,
            skip_sd=req.skip_sd,
        )
    except ValueError as e:
        append_audit_event(
            action="artifacts.build",
            actor_id=actor_id,
            entity="artifacts",
            status="error",
            details={"data_file": req.data_file, "error": str(e)[:400]},
        )
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        msg = str(e).strip() or "Precompute zamčeno nebo selhalo."
        append_audit_event(
            action="artifacts.build",
            actor_id=actor_id,
            entity="artifacts",
            status="error",
            details={"data_file": req.data_file, "error": msg[:400]},
        )
        raise HTTPException(status_code=409, detail=msg) from e
    except Exception as e:
        _log.exception(
            "artifacts.build failed data_file=%s years=%s",
            req.data_file,
            req.years,
        )
        append_audit_event(
            action="artifacts.build",
            actor_id=actor_id,
            entity="artifacts",
            status="error",
            details={"data_file": req.data_file, "error": str(e)[:400]},
        )
        raise HTTPException(status_code=500, detail=str(e)[:500]) from e

    append_audit_event(
        action="artifacts.build",
        actor_id=actor_id,
        entity="artifacts",
        status="ok",
        details={
            "data_file": req.data_file,
            "years": req.years,
            "dataset_id": result.get("dataset_id"),
            "skip_hl": req.skip_hl,
            "skip_sd": req.skip_sd,
        },
    )
    return _artifact_build_ok_payload(req, result)
