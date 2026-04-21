"""
Per-user uložené S/D zone test běhy (.sd_zone_saved_runs).

Fingerprint je jediný zdroj pravdy na serveru — normalizovaný JSON requestu.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import math

from app.services.artifact_store import normalize_dataset_relative_path, repo_root

SAVED_RUNS_DIRNAME = ".sd_zone_saved_runs"


def saved_runs_root(base: Path | None = None) -> Path:
    return (base or repo_root()).resolve() / SAVED_RUNS_DIRNAME


def _bucket_for_data_file(data_file: str) -> str:
    rel = normalize_dataset_relative_path(data_file)
    raw = rel.encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:16]


def _canonical_json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def normalize_sd_request_for_fingerprint(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Rekurzivně seřadí klíče, odstraní None, sjednotí zone TF do jednoho seznamu.
    """
    ztf = raw.get("zone_timeframes")
    z1 = raw.get("zone_timeframe")
    zone_list: list[str] = []
    if isinstance(ztf, list):
        zone_list = [str(x).strip() for x in ztf if str(x).strip()]
    elif z1 is not None and str(z1).strip():
        zone_list = [str(z1).strip()]
    zone_list = sorted(set(zone_list))

    def walk(x: Any) -> Any:
        if x is None:
            return None
        if isinstance(x, dict):
            out: dict[str, Any] = {}
            for k in sorted(x.keys()):
                v = walk(x[k])
                if v is not None:
                    out[str(k)] = v
            return out
        if isinstance(x, list):
            return [walk(i) for i in x]
        if isinstance(x, bool):
            return x
        if isinstance(x, int):
            return x
        if isinstance(x, float):
            return x
        if isinstance(x, str):
            return x
        return x

    base = walk({k: v for k, v in raw.items() if k not in ("zone_timeframe", "zone_timeframes")})
    if not isinstance(base, dict):
        base = {}
    base["zone_timeframes"] = zone_list
    base.pop("zone_timeframe", None)
    return base


def compute_request_fingerprint(raw: dict[str, Any]) -> str:
    norm = normalize_sd_request_for_fingerprint(raw)
    h = hashlib.sha256(_canonical_json_bytes(norm)).hexdigest()
    return h


def validate_single_zone_timeframe(raw: dict[str, Any]) -> tuple[bool, str | None]:
    norm = normalize_sd_request_for_fingerprint(raw)
    zfs = norm.get("zone_timeframes") or []
    if len(zfs) != 1:
        return False, "Uložit lze jen při právě jednom Zone TF."
    return True, str(zfs[0])


def _runs_dir(base: Path | None, data_file: str) -> Path:
    b = _bucket_for_data_file(data_file)
    return saved_runs_root(base) / b / "runs"


def _index_path(base: Path | None, data_file: str) -> Path:
    b = _bucket_for_data_file(data_file)
    return saved_runs_root(base) / b / "index.json"


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        os.replace(str(tmp), str(path))
    except Exception:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise


def _load_json(path: Path) -> Any:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_fingerprint_index(base: Path | None, data_file: str) -> dict[str, str]:
    p = _index_path(base, data_file)
    raw = _load_json(p)
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        if isinstance(k, str) and isinstance(v, str):
            out[k] = v
    return out


def _save_fingerprint_index(base: Path | None, data_file: str, idx: dict[str, str]) -> None:
    p = _index_path(base, data_file)
    data = _canonical_json_bytes(idx)
    _atomic_write_bytes(p, data)


def lookup_run_id(base: Path | None, data_file: str, fingerprint: str) -> str | None:
    idx = load_fingerprint_index(base, data_file)
    return idx.get(fingerprint)


def resolve_existing_run_id(base: Path | None, request: dict[str, Any]) -> tuple[str, str | None]:
    fp = compute_request_fingerprint(request)
    df = str(request.get("data_file") or "").strip()
    if not df:
        return fp, None
    rid = lookup_run_id(base, df, fp)
    return fp, rid


def get_run_document(base: Path | None, run_id: str) -> dict[str, Any] | None:
    rid = str(run_id or "").strip()
    try:
        uuid.UUID(rid)
    except ValueError:
        return None
    root = saved_runs_root(base)
    # run_id is uuid string; search buckets (bounded — only our buckets)
    for bucket in root.iterdir():
        if not bucket.is_dir():
            continue
        p = bucket / "runs" / f"{rid}.json"
        if p.is_file():
            doc = _load_json(p)
            return doc if isinstance(doc, dict) else None
    return None


def save_run(
    base: Path | None,
    request: dict[str, Any],
    response: dict[str, Any],
) -> dict[str, Any]:
    ok, zone_tf_or_err = validate_single_zone_timeframe(request)
    if not ok:
        raise ValueError(zone_tf_or_err or "Neplatný Zone TF")

    data_file = str(request.get("data_file") or "").strip()
    if not data_file:
        raise ValueError("Chybí data_file")

    fp = compute_request_fingerprint(request)
    existing = lookup_run_id(base, data_file, fp)
    if existing:
        p = _runs_dir(base, data_file) / f"{existing}.json"
        if p.is_file():
            doc = _load_json(p)
            if isinstance(doc, dict):
                return {
                    "run_id": existing,
                    "fingerprint": fp,
                    "created_at": doc.get("created_at"),
                    "reused": True,
                }

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    req_ct = request.get("chart_timeframe") if isinstance(request, dict) else None
    chart_tf_top: str | None = None
    if req_ct is not None and str(req_ct).strip():
        chart_tf_top = str(req_ct).strip()
    doc: dict[str, Any] = {
        "run_id": run_id,
        "fingerprint": fp,
        "data_file": data_file,
        "zone_tf": zone_tf_or_err,
        "chart_timeframe": chart_tf_top,
        "created_at": now,
        "request": request,
        "response": response,
        "annotations": {},
    }

    path = _runs_dir(base, data_file) / f"{run_id}.json"
    _atomic_write_bytes(path, _canonical_json_bytes(doc))

    idx = load_fingerprint_index(base, data_file)
    idx[fp] = run_id
    _save_fingerprint_index(base, data_file, idx)

    return {"run_id": run_id, "fingerprint": fp, "created_at": now, "reused": False}


def annotation_key(zone_id: str, source_tf: str, trade_id: str) -> str:
    raw = f"{zone_id}\x00{source_tf}\x00{trade_id}".encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()


def patch_annotation(
    base: Path | None,
    run_id: str,
    zone_id: str,
    zone_name: str | None,
    source_tf: str,
    trade_id: str,
    trade_index: int | None,
    entry_bar: int | None,
    touch_index: int | None,
    items: list[dict[str, Any]],
    tags: list[str] | None,
    comment: str,
) -> dict[str, Any]:
    doc = get_run_document(base, run_id)
    if not doc:
        raise FileNotFoundError("Run nenalezen")

    path_str = doc.get("data_file")
    if not isinstance(path_str, str) or not path_str.strip():
        raise ValueError("Neplatný dokument runu")

    path = _runs_dir(base, path_str) / f"{str(run_id).strip()}.json"
    if not path.is_file():
        raise FileNotFoundError("Soubor runu nenalezen")

    key = annotation_key(zone_id, source_tf, trade_id)
    ann: dict[str, Any] = doc.get("annotations") if isinstance(doc.get("annotations"), dict) else {}
    tag_list: list[str] = []
    if isinstance(tags, list):
        for t in tags:
            s = str(t).strip()
            if s:
                tag_list.append(s)
    # Backward-compatible: if tags omitted, derive from checked legacy items.
    if not tag_list and isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            if not bool(it.get("checked")):
                continue
            lab = str(it.get("label") or "").strip()
            if lab:
                tag_list.append(lab)
    # normalize unique + stable order
    seen: set[str] = set()
    tag_norm: list[str] = []
    for t in tag_list:
        if t in seen:
            continue
        seen.add(t)
        tag_norm.append(t)
    ann[key] = {
        "zone_id": zone_id,
        "zone_name": zone_name,
        "source_tf": source_tf,
        "trade_id": trade_id,
        "trade_index": trade_index,
        "entry_bar": entry_bar,
        "touch_index": touch_index,
        "items": items,
        "tags": tag_norm,
        "comment": comment,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    doc["annotations"] = ann
    _atomic_write_bytes(path, _canonical_json_bytes(doc))
    return ann[key]


def _safe_int(x: Any) -> int | None:
    try:
        if x is None:
            return None
        v = int(x)
        return v
    except Exception:
        return None


def _chart_timeframe_from_doc(doc: dict[str, Any]) -> str | None:
    top = doc.get("chart_timeframe")
    if top is not None and str(top).strip():
        return str(top).strip()
    req = doc.get("request")
    if isinstance(req, dict):
        ct = req.get("chart_timeframe")
        if ct is not None and str(ct).strip():
            return str(ct).strip()
    return None


def _aggregate_summary_from_response(resp: Any) -> dict[str, Any]:
    if not isinstance(resp, dict):
        return {}
    agg = resp.get("aggregates")
    if not isinstance(agg, dict):
        return {}
    keys = (
        "touch_count",
        "win_rate_by_rr",
        "avg_mfe_R",
        "median_mfe_R",
        "avg_mae_R",
        "avg_mae_winners_R",
        "profit_factor_by_rr",
        "expectancy_r_by_rr",
        "winner_rr",
        "num_winners_by_rr",
        "num_losers_by_rr",
    )
    return {k: agg.get(k) for k in keys}


def list_saved_runs(base: Path | None) -> list[dict[str, Any]]:
    """
    Vrátí metadata uložených běhů včetně chart TF a krátkého souhrnu z ``response.aggregates``.
    Seřazeno: data_file → chart_timeframe → zone_tf → nejnovější ``created_at``.
    """
    root = saved_runs_root(base)
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for bucket in sorted(root.iterdir(), key=lambda p: p.name):
        runs_dir = bucket / "runs"
        if not runs_dir.is_dir():
            continue
        for p in sorted(runs_dir.glob("*.json"), key=lambda x: x.name):
            doc = _load_json(p)
            if not isinstance(doc, dict):
                continue
            rid = str(doc.get("run_id") or "").strip()
            if not rid:
                continue
            ct = _chart_timeframe_from_doc(doc)
            resp = doc.get("response")
            summary = _aggregate_summary_from_response(resp)
            req = doc.get("request") if isinstance(doc.get("request"), dict) else {}
            years = None
            if isinstance(req, dict):
                y = req.get("years")
                try:
                    yf = float(y) if y is not None else float("nan")
                except Exception:
                    yf = float("nan")
                if years is not None:
                    years = None
                if yf is not None and yf == yf and math.isfinite(yf) and yf >= 0:
                    years = float(yf)
            out.append(
                {
                    "run_id": rid,
                    "fingerprint": doc.get("fingerprint"),
                    "data_file": doc.get("data_file"),
                    "zone_tf": doc.get("zone_tf"),
                    "chart_timeframe": ct,
                    "created_at": doc.get("created_at"),
                    "years": years,
                    "aggregate_summary": summary,
                }
            )

    def _created_ts_for_sort(iso: str) -> float:
        s = (iso or "").strip()
        if not s:
            return 0.0
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    out.sort(
        key=lambda d: (
            str(d.get("data_file") or "").casefold(),
            str(d.get("chart_timeframe") or "").casefold(),
            str(d.get("zone_tf") or "").casefold(),
            -_created_ts_for_sort(str(d.get("created_at") or "")),
        ),
    )
    return out


def _extract_trade_metrics(doc: dict[str, Any], ann: dict[str, Any]) -> dict[str, Any]:
    resp = doc.get("response")
    if not isinstance(resp, dict):
        return {}
    trades = resp.get("trades")
    if not isinstance(trades, list) or not trades:
        return {}
    ohlc = resp.get("ohlc")
    if not isinstance(ohlc, list):
        ohlc = []

    ti = _safe_int(ann.get("trade_index"))
    eb = _safe_int(ann.get("entry_bar"))
    tx = _safe_int(ann.get("touch_index"))
    zid = str(ann.get("zone_id") or "").strip()
    stf = str(ann.get("source_tf") or "").strip()

    trade: dict[str, Any] | None = None
    if ti is not None and 0 <= ti < len(trades) and isinstance(trades[ti], dict):
        trade = trades[ti]
    else:
        # Fallback: match by composite keys from stored annotation.
        for t in trades:
            if not isinstance(t, dict):
                continue
            if zid and str(t.get("zone_id") or "").strip() != zid:
                continue
            if stf and str(t.get("source_tf") or "").strip() != stf:
                continue
            if eb is not None and _safe_int(t.get("entry_bar")) != eb:
                continue
            if tx is not None and _safe_int(t.get("touch_index")) != tx:
                continue
            trade = t
            break

    if trade is None:
        return {}

    mfe = trade.get("mfe_before_sl_R")
    if mfe is None:
        mfe = trade.get("mfe_R")
    dur = trade.get("duration_bars")
    entry_date = None
    if eb is not None and 0 <= eb < len(ohlc):
        ob = ohlc[eb]
        if isinstance(ob, dict):
            entry_date = ob.get("date")

    return {
        "mfe_before_sl_R": trade.get("mfe_before_sl_R"),
        "mfe_R": trade.get("mfe_R"),
        "mae_R": trade.get("mae_R"),
        "duration_bars": dur,
        "entry_bar": trade.get("entry_bar"),
        "entry_date": entry_date,
        "r_for_sort": mfe,
        "is_loser": trade.get("sl_hit_bar") is not None,
    }


def list_journal_entries(base: Path | None) -> list[dict[str, Any]]:
    """
    Flatten všech anotací napříč uloženými běhy pro Journal UI.
    """
    root = saved_runs_root(base)
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for bucket in root.iterdir():
        runs_dir = bucket / "runs"
        if not runs_dir.is_dir():
            continue
        for p in runs_dir.glob("*.json"):
            doc = _load_json(p)
            if not isinstance(doc, dict):
                continue
            anns = doc.get("annotations")
            if not isinstance(anns, dict) or not anns:
                continue
            for _k, ann in anns.items():
                if not isinstance(ann, dict):
                    continue
                row: dict[str, Any] = {
                    "run_id": doc.get("run_id"),
                    "data_file": doc.get("data_file"),
                    "zone_tf": doc.get("zone_tf"),
                    "fingerprint": doc.get("fingerprint"),
                    "zone_id": ann.get("zone_id"),
                    "zone_name": ann.get("zone_name"),
                    "source_tf": ann.get("source_tf"),
                    "trade_id": ann.get("trade_id"),
                    "trade_index": ann.get("trade_index"),
                    "entry_bar": ann.get("entry_bar"),
                    "touch_index": ann.get("touch_index"),
                    "items": ann.get("items") if isinstance(ann.get("items"), list) else [],
                    "tags": ann.get("tags") if isinstance(ann.get("tags"), list) else None,
                    "comment": ann.get("comment") if isinstance(ann.get("comment"), str) else "",
                    "updated_at": ann.get("updated_at"),
                }
                if row.get("tags") is None:
                    # Legacy: derive tags from checked items
                    tags_legacy: list[str] = []
                    for it in row.get("items") or []:
                        if not isinstance(it, dict):
                            continue
                        if not bool(it.get("checked")):
                            continue
                        lab = str(it.get("label") or "").strip()
                        if lab:
                            tags_legacy.append(lab)
                    row["tags"] = sorted(set(tags_legacy)) if tags_legacy else []
                row.update(_extract_trade_metrics(doc, ann))
                out.append(row)
    out.sort(key=lambda d: str(d.get("updated_at") or ""), reverse=True)
    return out


def _tag_preset_path(base: Path | None) -> Path:
    return saved_runs_root(base) / "tag_presets.json"


def get_tag_preset(base: Path | None) -> dict[str, Any]:
    p = _tag_preset_path(base)
    raw = _load_json(p)
    if isinstance(raw, dict) and isinstance(raw.get("tags"), list):
        return raw
    return {"version": 1, "tags": [], "updated_at": None}


def save_tag_preset(base: Path | None, tags: list[str]) -> dict[str, Any]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for t in tags or []:
        s = str(t).strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        cleaned.append(s)
    doc = {"version": 1, "tags": cleaned, "updated_at": datetime.now(timezone.utc).isoformat()}
    _atomic_write_bytes(_tag_preset_path(base), _canonical_json_bytes(doc))
    return doc


def delete_annotation(
    base: Path | None,
    run_id: str,
    zone_id: str,
    source_tf: str,
    trade_id: str,
) -> dict[str, Any]:
    """
    Smaže jednu anotaci v rámci uloženého runu (podle stejného klíče jako patch).
    """
    doc = get_run_document(base, run_id)
    if not doc:
        raise FileNotFoundError("Run nenalezen")
    path_str = doc.get("data_file")
    if not isinstance(path_str, str) or not path_str.strip():
        raise ValueError("Neplatný dokument runu")
    path = _runs_dir(base, path_str) / f"{str(run_id).strip()}.json"
    if not path.is_file():
        raise FileNotFoundError("Soubor runu nenalezen")

    key = annotation_key(zone_id, source_tf, trade_id)
    ann: dict[str, Any] = doc.get("annotations") if isinstance(doc.get("annotations"), dict) else {}
    if key in ann:
        del ann[key]
    doc["annotations"] = ann
    _atomic_write_bytes(path, _canonical_json_bytes(doc))
    return {"ok": True, "deleted": True, "remaining": len(ann)}


def delete_all_annotations(base: Path | None) -> dict[str, Any]:
    """
    Smaže všechny anotace napříč všemi uloženými běhy.
    """
    root = saved_runs_root(base)
    if not root.is_dir():
        return {"ok": True, "runs_touched": 0, "annotations_deleted": 0}
    runs_touched = 0
    annotations_deleted = 0
    for bucket in root.iterdir():
        runs_dir = bucket / "runs"
        if not runs_dir.is_dir():
            continue
        for p in runs_dir.glob("*.json"):
            doc = _load_json(p)
            if not isinstance(doc, dict):
                continue
            anns = doc.get("annotations")
            if not isinstance(anns, dict) or not anns:
                continue
            annotations_deleted += len(anns)
            doc["annotations"] = {}
            _atomic_write_bytes(p, _canonical_json_bytes(doc))
            runs_touched += 1
    return {"ok": True, "runs_touched": runs_touched, "annotations_deleted": annotations_deleted}


def delete_saved_run(base: Path | None, run_id: str) -> dict[str, Any]:
    """
    Hard-delete jednoho uloženého runu (JSON soubor) + odstraní fingerprint mapování v index.json.
    """
    doc = get_run_document(base, run_id)
    if not doc:
        raise FileNotFoundError("Run nenalezen")
    data_file = doc.get("data_file")
    if not isinstance(data_file, str) or not data_file.strip():
        raise ValueError("Neplatný dokument runu")
    rid = str(run_id or "").strip()
    fp = str(doc.get("fingerprint") or "").strip()
    if not rid:
        raise ValueError("Neplatné run_id")

    path = _runs_dir(base, data_file) / f"{rid}.json"
    if not path.is_file():
        raise FileNotFoundError("Soubor runu nenalezen")

    # Delete run file first.
    try:
        path.unlink()
    except OSError as e:
        raise ValueError(f"Nelze smazat soubor runu: {e}") from e

    # Best-effort: remove from fingerprint index for this data_file.
    removed_from_index = False
    if fp:
        idx = load_fingerprint_index(base, data_file)
        if idx.get(fp) == rid:
            del idx[fp]
            _save_fingerprint_index(base, data_file, idx)
            removed_from_index = True

    return {"ok": True, "deleted": True, "run_id": rid, "data_file": data_file, "fingerprint": fp or None, "removed_from_index": removed_from_index}


def delete_all_saved_runs(base: Path | None) -> dict[str, Any]:
    """
    Hard-delete všech uložených S/D runů (runs/*.json) napříč všemi buckety.
    Nezasahuje do ``tag_presets.json``.
    """
    root = saved_runs_root(base)
    if not root.is_dir():
        return {"ok": True, "runs_deleted": 0, "buckets_touched": 0}

    runs_deleted = 0
    buckets_touched = 0
    for bucket in root.iterdir():
        if not bucket.is_dir():
            continue
        runs_dir = bucket / "runs"
        if not runs_dir.is_dir():
            continue
        touched_this_bucket = False
        for p in list(runs_dir.glob("*.json")):
            try:
                p.unlink()
                runs_deleted += 1
                touched_this_bucket = True
            except OSError:
                # keep going; report partial success via counters
                continue
        # Reset index.json for the bucket if it exists or if we deleted something.
        if touched_this_bucket:
            buckets_touched += 1
            try:
                idx_path = bucket / "index.json"
                if idx_path.exists():
                    _atomic_write_bytes(idx_path, _canonical_json_bytes({}))
            except OSError:
                pass
    return {"ok": True, "runs_deleted": runs_deleted, "buckets_touched": buckets_touched}

