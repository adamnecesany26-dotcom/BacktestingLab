"""
API pro uložené S/D zone test běhy a anotace.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import sd_zone_saved_runs as saved_runs

router = APIRouter()


class ResolveBody(BaseModel):
    request: dict[str, Any]


class ResolveResponse(BaseModel):
    fingerprint: str
    existing_run_id: str | None = None


class SaveBody(BaseModel):
    request: dict[str, Any]
    response: dict[str, Any]


class SaveResponse(BaseModel):
    run_id: str
    fingerprint: str
    created_at: str | None = None
    reused: bool = False


class AnnotationItem(BaseModel):
    id: str
    label: str = ""
    checked: bool = False


class PatchAnnotationsBody(BaseModel):
    zone_id: str
    zone_name: str | None = None
    source_tf: str
    trade_id: str
    trade_index: int | None = None
    entry_bar: int | None = None
    touch_index: int | None = None
    # Legacy (checkboxy) - optional for backward compatibility
    items: list[AnnotationItem] = Field(default_factory=list)
    # New: tag multi-select
    tags: list[str] = Field(default_factory=list)
    comment: str = ""


class SavedRunListItem(BaseModel):
    run_id: str
    fingerprint: str | None = None
    data_file: str | None = None
    zone_tf: str | None = None
    chart_timeframe: str | None = None
    created_at: str | None = None
    years: float | None = None
    aggregate_summary: dict[str, Any] = Field(default_factory=dict)


class TagPresetResponse(BaseModel):
    version: int = 1
    updated_at: str | None = None
    tags: list[str] = Field(default_factory=list)


class TagPresetSaveBody(BaseModel):
    tags: list[str] = Field(default_factory=list)


class DeleteAnnotationBody(BaseModel):
    zone_id: str
    source_tf: str
    trade_id: str


class DeleteSavedRunResponse(BaseModel):
    ok: bool = True
    deleted: bool = True
    run_id: str
    data_file: str
    fingerprint: str | None = None
    removed_from_index: bool = False


class DeleteAllSavedRunsResponse(BaseModel):
    ok: bool = True
    runs_deleted: int = 0
    buckets_touched: int = 0


@router.post("/sd-zone-test/saved-runs/resolve", response_model=ResolveResponse)
async def resolve_saved_run(body: ResolveBody) -> ResolveResponse:
    fp, rid = saved_runs.resolve_existing_run_id(None, body.request)
    return ResolveResponse(fingerprint=fp, existing_run_id=rid)


@router.post("/sd-zone-test/saved-runs", response_model=SaveResponse)
async def save_run(body: SaveBody) -> SaveResponse:
    try:
        out = saved_runs.save_run(None, body.request, body.response)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return SaveResponse(
        run_id=out["run_id"],
        fingerprint=out["fingerprint"],
        created_at=out.get("created_at"),
        reused=bool(out.get("reused")),
    )


@router.get("/sd-zone-test/saved-runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    doc = saved_runs.get_run_document(None, run_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Run nenalezen")
    return doc


@router.get("/sd-zone-test/saved-runs", response_model=list[SavedRunListItem])
async def list_runs() -> list[SavedRunListItem]:
    rows = saved_runs.list_saved_runs(None)
    return [SavedRunListItem(**r) for r in rows]


@router.get("/sd-zone-test/journal")
async def get_journal() -> dict[str, Any]:
    return {"items": saved_runs.list_journal_entries(None)}


@router.delete("/sd-zone-test/journal")
async def delete_journal() -> dict[str, Any]:
    return saved_runs.delete_all_annotations(None)


@router.get("/sd-zone-test/presets/tags", response_model=TagPresetResponse)
async def get_tag_presets() -> TagPresetResponse:
    raw = saved_runs.get_tag_preset(None)
    tags_raw = raw.get("tags") if isinstance(raw, dict) else None
    tags: list[str] = []
    if isinstance(tags_raw, list):
        for t in tags_raw:
            s = str(t).strip()
            if s:
                tags.append(s)
    return TagPresetResponse(version=int(raw.get("version") or 1), updated_at=raw.get("updated_at"), tags=tags)


@router.put("/sd-zone-test/presets/tags", response_model=TagPresetResponse)
async def save_tag_presets(body: TagPresetSaveBody) -> TagPresetResponse:
    out = saved_runs.save_tag_preset(None, body.tags)
    tags_out = out.get("tags") if isinstance(out, dict) else []
    tags: list[str] = []
    if isinstance(tags_out, list):
        tags = [str(t).strip() for t in tags_out if str(t).strip()]
    return TagPresetResponse(version=int(out.get("version") or 1), updated_at=out.get("updated_at"), tags=tags)


@router.patch("/sd-zone-test/saved-runs/{run_id}/annotations")
async def patch_annotations(run_id: str, body: PatchAnnotationsBody) -> dict[str, Any]:
    try:
        items = [x.model_dump() for x in body.items]
        return saved_runs.patch_annotation(
            None,
            run_id,
            body.zone_id,
            body.zone_name,
            body.source_tf,
            body.trade_id,
            body.trade_index,
            body.entry_bar,
            body.touch_index,
            items,
            body.tags,
            body.comment,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/sd-zone-test/saved-runs/{run_id}/annotations")
async def delete_annotation(run_id: str, body: DeleteAnnotationBody) -> dict[str, Any]:
    try:
        return saved_runs.delete_annotation(None, run_id, body.zone_id, body.source_tf, body.trade_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/sd-zone-test/saved-runs/{run_id}", response_model=DeleteSavedRunResponse)
async def delete_saved_run(run_id: str) -> DeleteSavedRunResponse:
    try:
        out = saved_runs.delete_saved_run(None, run_id)
        return DeleteSavedRunResponse(
            ok=bool(out.get("ok", True)),
            deleted=bool(out.get("deleted", True)),
            run_id=str(out.get("run_id") or run_id),
            data_file=str(out.get("data_file") or ""),
            fingerprint=out.get("fingerprint"),
            removed_from_index=bool(out.get("removed_from_index", False)),
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/sd-zone-test/saved-runs", response_model=DeleteAllSavedRunsResponse)
async def delete_all_saved_runs() -> DeleteAllSavedRunsResponse:
    out = saved_runs.delete_all_saved_runs(None)
    return DeleteAllSavedRunsResponse(
        ok=bool(out.get("ok", True)),
        runs_deleted=int(out.get("runs_deleted") or 0),
        buckets_touched=int(out.get("buckets_touched") or 0),
    )
