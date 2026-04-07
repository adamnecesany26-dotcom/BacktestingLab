"""
Fáze 6: stav artefaktů a synchronní build (H/L + S/D) pro UI.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.services import artifact_store
from app.services.data_ohlc import fingerprint_dataset_file, resolve_safe_data_path
from app.services.hl_artifact_spec import resolve_build_timeframes
from app.services.hl_precompute import compute_hl_module_digest, run_hl_precompute
from app.services.sd_precompute import compute_sd_module_digest, run_sd_precompute


def api_data_dir() -> Path:
    """Stejný kořen dat jako /api/view a precompute CLI."""
    from app.api.view import _get_data_dir

    return _get_data_dir()


def artifact_dataset_id(
    *,
    data_dir: Path,
    data_file: str,
    years: float,
    start_iso: str | None,
    end_iso: str | None,
) -> tuple[str | None, str | None, str | None]:
    """
    Vrátí (dataset_id, fingerprint, error).
    ID artefaktů je vždy pro celý soubor (years/start_iso/end_iso v requestu se pro klíč ignorují).
    """
    _ = (years, start_iso, end_iso)  # API kompatibilita
    resolved = resolve_safe_data_path(data_dir, data_file)
    if resolved is None:
        return None, None, "Neplatný nebo chybějící data_file (traverzal / soubor)."
    fp = fingerprint_dataset_file(resolved)
    did = artifact_store.compute_dataset_id(data_file, fp, years=None, start_iso=None, end_iso=None)
    return did, fp, None


def artifact_status_payload(
    *,
    data_file: str,
    years: float,
    start_iso: str | None = None,
    end_iso: str | None = None,
    data_dir: Path | None = None,
) -> dict[str, Any]:
    """
    Stav H/L a S/D manifestů pro aktuální dataset key — pro badge ve View / Backtest UI.
    """
    root = data_dir or api_data_dir()
    did, fp, err = artifact_dataset_id(
        data_dir=root, data_file=data_file, years=years, start_iso=start_iso, end_iso=end_iso
    )
    if err or not did:
        return {
            "ok": False,
            "error": err or "dataset_id",
            "dataset_id": None,
            "data_fingerprint": None,
            "hl": {"state": "error", "detail": err},
            "sd": {"state": "error", "detail": err},
            "overall": "error",
        }

    hl_m = artifact_store.read_json_if_exists(artifact_store.hl_manifest_path(None, did))
    sd_m = artifact_store.read_json_if_exists(artifact_store.sd_manifest_path(None, did))
    cur_hl = compute_hl_module_digest()
    cur_sd = compute_sd_module_digest()

    hl_detail: str | None = None
    if not hl_m or str(hl_m.get("kind")) != "hl":
        hl_state = "missing"
    elif artifact_store.manifest_is_stale_fingerprint(hl_m, fp):
        hl_state = "stale_data"
        hl_detail = "Soubor dat změněn (jiný fingerprint) — přepočti artefakty."
    elif artifact_store.manifest_is_stale_module_digest(hl_m, kind="hl", current_digest=cur_hl):
        hl_state = "stale_code"
        hl_detail = "Kód Swing_HL se změnil — přepočti H/L."
    else:
        hl_state = "fresh"

    sd_detail: str | None = None
    if not sd_m or str(sd_m.get("kind")) != "sd":
        sd_state = "missing"
        if hl_state == "fresh":
            sd_detail = "S/D artefakt zatím neexistuje — spusť Build po H/L."
    elif artifact_store.manifest_is_stale_fingerprint(sd_m, fp):
        sd_state = "stale_data"
        sd_detail = "S/D: data se neshodují s manifestem."
    elif artifact_store.manifest_is_stale_module_digest(sd_m, kind="sd", current_digest=cur_sd):
        sd_state = "stale_code"
        sd_detail = "Kód S/D modulu se změnil — přepočti S/D."
    else:
        old_hl_sd = str((sd_m or {}).get("hl_module_digest") or "").strip()
        if old_hl_sd and cur_hl and old_hl_sd != cur_hl:
            sd_state = "stale_code"
            sd_detail = "H/L digest se změnil po S/D buildu — znovu spusť Build (S/D)."
        else:
            sd_state = "fresh"

    overall = "fresh"
    if hl_state == "missing":
        overall = "missing_hl"
    elif hl_state == "stale_data":
        overall = "stale_data"
    elif hl_state == "stale_code":
        overall = "stale_code"
    elif sd_state == "missing":
        overall = "missing_sd"
    elif sd_state == "stale_data":
        overall = "stale_data"
    elif sd_state == "stale_code":
        overall = "stale_code"

    return {
        "ok": True,
        "error": None,
        "dataset_id": did,
        "data_fingerprint": fp,
        "hl": {"state": hl_state, "detail": hl_detail},
        "sd": {"state": sd_state, "detail": sd_detail},
        "overall": overall,
    }


def _emit_progress(
    progress: Callable[[dict[str, Any]], None] | None,
    ev: dict[str, Any],
) -> None:
    if progress is None:
        return
    try:
        progress(dict(ev))
    except Exception:
        pass


# Rozsah % pro UI během dlouhého H/L resp. S/D (mezi init a dokončení buildu).
_ARTIFACT_BUILD_HL_PCT_LO = 8.0
_ARTIFACT_BUILD_HL_PCT_HI = 80.0
_ARTIFACT_BUILD_SD_PCT_LO = 80.0
_ARTIFACT_BUILD_SD_PCT_HI = 94.0


def run_artifact_build(
    *,
    data_file: str,
    years: float,
    start_iso: str | None = None,
    end_iso: str | None = None,
    zone_timeframes: list[str] | None = None,
    precompute_timeframes: list[str] | None = None,
    hl_params: dict[str, Any] | None = None,
    sd_params: dict[str, Any] | None = None,
    skip_hl: bool = False,
    skip_sd: bool = False,
    data_dir: Path | None = None,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """
    Pořadí: H/L (pokud ne skip), pak S/D. Sync MVP — může trvat dlouho.

    Vždy načte celý soubor (years/okno z requestu se ignorují). H/L a S/D přepočítá jen pro TF
    určené ``precompute_timeframes`` (prázdné = celý ``PRECOMPUTE_TF_LADDER``).
    Pole ``zone_timeframes`` je legacy u buildu. Strategie si TF zón vybírá v PARAMS při běhu enginu.
    """
    if skip_hl and skip_sd:
        raise ValueError("Nelze přeskočit H/L i S/D současně.")

    _ = (years, start_iso, end_iso, zone_timeframes)  # Build = vždy celý soubor
    build_tfs = list(resolve_build_timeframes(precompute_timeframes))
    root = data_dir or api_data_dir()
    out: dict[str, Any] = {"hl": None, "sd": None, "dataset_id": None}

    tf_label = ", ".join(build_tfs) if build_tfs else "—"
    _emit_progress(
        progress,
        {
            "type": "phase",
            "phase": "init",
            "message": f"Start buildu · TF: {tf_label}",
            "pct": 2,
        },
    )

    if skip_hl:
        _emit_progress(
            progress,
            {"type": "phase", "phase": "hl_skipped", "message": "H/L přeskočeno (skip_hl).", "pct": 6},
        )

    if not skip_hl:
        _emit_progress(
            progress,
            {"type": "phase", "phase": "hl", "message": "H/L precompute (swing highs/lows)…", "pct": 8},
        )

        def _on_hl_tf_start(idx: int, n: int, label: str) -> None:
            if n <= 0:
                return
            span = _ARTIFACT_BUILD_HL_PCT_HI - _ARTIFACT_BUILD_HL_PCT_LO
            frac = (idx + 0.1) / n
            pct = _ARTIFACT_BUILD_HL_PCT_LO + frac * span
            _emit_progress(
                progress,
                {
                    "type": "phase",
                    "phase": "hl",
                    "message": f"H/L · {label} ({idx + 1}/{n}) — výpočet swingů/BOS…",
                    "pct": round(pct, 1),
                },
            )

        def _on_hl_tf(idx: int, n: int, label: str) -> None:
            if n <= 0:
                _emit_progress(
                    progress,
                    {
                        "type": "phase",
                        "phase": "hl",
                        "message": "H/L · žádný timeframe k výpočtu (vše přeskočeno)",
                        "pct": _ARTIFACT_BUILD_HL_PCT_HI,
                    },
                )
                return
            span = _ARTIFACT_BUILD_HL_PCT_HI - _ARTIFACT_BUILD_HL_PCT_LO
            pct = _ARTIFACT_BUILD_HL_PCT_LO + (idx + 1) / n * span
            _emit_progress(
                progress,
                {
                    "type": "phase",
                    "phase": "hl",
                    "message": f"H/L · {label} ({idx + 1}/{n}) hotovo",
                    "pct": round(pct, 1),
                },
            )

        out["hl"] = run_hl_precompute(
            data_dir=root,
            data_file=data_file,
            years=0.0,
            start_iso=None,
            end_iso=None,
            params_snapshot=hl_params,
            timeframes=build_tfs,
            artifacts_base=None,
            use_lock=True,
            on_tf_start=_on_hl_tf_start,
            on_tf_complete=_on_hl_tf,
        )
        out["dataset_id"] = (out["hl"] or {}).get("dataset_id")

    if skip_sd:
        if out["dataset_id"] is None:
            did, _, err = artifact_dataset_id(
                data_dir=root, data_file=data_file, years=0.0, start_iso=None, end_iso=None
            )
            if err:
                raise ValueError(err)
            out["dataset_id"] = did
        _emit_progress(
            progress,
            {"type": "phase", "phase": "sd_skipped", "message": "S/D přeskočeno (skip_sd).", "pct": 92},
        )
        _emit_progress(progress, {"type": "phase", "phase": "done", "message": "Build dokončen.", "pct": 100})
        return out

    if skip_hl and out["dataset_id"] is None:
        did, _, err = artifact_dataset_id(
            data_dir=root, data_file=data_file, years=0.0, start_iso=None, end_iso=None
        )
        if err:
            raise ValueError(err)
        out["dataset_id"] = did

    merged_sd = dict(sd_params or {})
    merged_sd["zone_timeframes"] = build_tfs

    def _on_sd_tf_start(idx: int, n: int, label: str) -> None:
        if n <= 0:
            return
        span = _ARTIFACT_BUILD_SD_PCT_HI - _ARTIFACT_BUILD_SD_PCT_LO
        frac = (idx + 0.1) / n
        pct = _ARTIFACT_BUILD_SD_PCT_LO + frac * span
        _emit_progress(
            progress,
            {
                "type": "phase",
                "phase": "sd",
                "message": f"S/D · {label} ({idx + 1}/{n}) — výpočet zón…",
                "pct": round(pct, 1),
            },
        )

    def _on_sd_tf(idx: int, n: int, label: str) -> None:
        if n <= 0:
            _emit_progress(
                progress,
                {
                    "type": "phase",
                    "phase": "sd",
                    "message": "S/D · žádný platný TF pro zóny",
                    "pct": _ARTIFACT_BUILD_SD_PCT_HI,
                },
            )
            return
        span = _ARTIFACT_BUILD_SD_PCT_HI - _ARTIFACT_BUILD_SD_PCT_LO
        pct = _ARTIFACT_BUILD_SD_PCT_LO + (idx + 1) / n * span
        _emit_progress(
            progress,
            {
                "type": "phase",
                "phase": "sd",
                "message": f"S/D · {label} ({idx + 1}/{n}) hotovo",
                "pct": round(pct, 1),
            },
        )

    _emit_progress(
        progress,
        {"type": "phase", "phase": "sd", "message": "S/D precompute (zóny)…", "pct": _ARTIFACT_BUILD_SD_PCT_LO},
    )
    out["sd"] = run_sd_precompute(
        data_dir=root,
        data_file=data_file,
        years=0.0,
        start_iso=None,
        end_iso=None,
        params_snapshot=merged_sd,
        zone_timeframes=build_tfs,
        artifacts_base=None,
        use_lock=True,
        require_hl_manifest=True,
        require_matching_hl_digest=True,
        on_zone_tf_start=_on_sd_tf_start,
        on_zone_tf_complete=_on_sd_tf,
    )
    out["dataset_id"] = (out["sd"] or {}).get("dataset_id") or out["dataset_id"]
    _emit_progress(
        progress,
        {"type": "phase", "phase": "sd_done", "message": "S/D dokončeno.", "pct": 96},
    )
    _emit_progress(progress, {"type": "phase", "phase": "done", "message": "Vše hotovo.", "pct": 100})
    return out
