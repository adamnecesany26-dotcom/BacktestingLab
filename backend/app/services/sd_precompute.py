"""
S/D precompute (fáze 3): závisí na H/L manifestu v ``hl/v1/``, výstup ``sd/v1/zones.parquet`` + manifest.

Logika zón = ``examples.sd_zones.get_zones`` (BOS/Swing H/L uvnitř modulu). Artefakty H/L slouží
jako gate (manifest musí existovat, volitelně shoda ``hl_module_digest``) a pro ``with_trend``
z předpočítaného ``{tf}_trend.parquet``.
"""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from app.services import artifact_store
from app.services.data_ohlc import fingerprint_dataset_file, resolve_safe_data_path
from app.services.hl_artifact_spec import canonical_precompute_tf
from app.services.hl_data_load import load_native_ohlc
from app.services.hl_precompute import _load_swing_hl, compute_hl_module_digest
from app.services.sd_artifact_spec import SD_ZONE_PARQUET_COLUMNS
from app.services.sd_zone_merge import min_zone_ohlc_bars, resample_to_zone_tf

_REPO_ROOT = artifact_store.repo_root()


def sd_zones_module_path() -> Path:
    return _REPO_ROOT / "examples" / "sd_zones.py"


def compute_sd_module_digest() -> str:
    p = sd_zones_module_path()
    if not p.is_file():
        return ""
    return hashlib.sha256(p.read_bytes()).hexdigest()[:32]


def _import_sd_zones():
    r = str(_REPO_ROOT)
    if r not in sys.path:
        sys.path.insert(0, r)
    try:
        import examples.sd_zones as m  # noqa: PLC0415 — runtime path
    except ImportError as e:
        raise ImportError(
            "Nelze importovat examples.sd_zones — S/D precompute vyžaduje kořen repozitáře na PYTHONPATH."
        ) from e
    return m


def _stable_zone_id(
    *,
    dataset_id: str,
    source_tf: str,
    kind: str,
    pivot_idx: int,
    price_low: float,
    price_high: float,
    born_iso: str,
) -> str:
    raw = (
        f"{dataset_id}\x00{source_tf}\x00{kind}\x00{pivot_idx}\x00"
        f"{price_low:.12g}\x00{price_high:.12g}\x00{born_iso}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _trend_score_at_bar(hl_dir: Path, tf_key: str, bar_index: int) -> float | None:
    path = hl_dir / f"{tf_key}_trend.parquet"
    if not path.is_file():
        return None
    df = pd.read_parquet(path)
    if df.empty or "score" not in df.columns:
        return None
    if bar_index < 0 or bar_index >= len(df):
        return None
    try:
        return float(df.iloc[int(bar_index)]["score"])
    except (TypeError, ValueError):
        return None


def _with_trend_for_zone(
    *,
    kind: str,
    pivot_idx: int,
    hl_dir: Path,
    tf_key: str,
    params: dict[str, Any],
) -> bool:
    score = _trend_score_at_bar(hl_dir, tf_key, pivot_idx)
    if score is None:
        return False
    min_d = float(params.get("trend_min_score_demand", 25.0))
    max_s = float(params.get("trend_max_score_supply", -25.0))
    if kind == "demand":
        return score >= min_d
    if kind == "supply":
        return score <= max_s
    return False


def _zone_row_from_module_dict(
    z: dict[str, Any],
    *,
    dataset_id: str,
    source_tf: str,
    zoh: pd.DataFrame,
    hl_dir: Path,
    tf_key: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    name = str(z.get("name", ""))
    kind = "demand" if name == "Demand" else "supply" if name == "Supply" else ""
    pivot_idx = int(z.get("pivot_idx", -1))
    vl = float(z.get("value_low", 0.0))
    vh = float(z.get("value_high", 0.0))
    born_at = ""
    if pivot_idx >= 0 and pivot_idx < len(zoh):
        born_at = pd.Timestamp(zoh.index[pivot_idx]).isoformat()
    si0 = int(z.get("start_idx", pivot_idx))
    ei0 = int(z.get("end_idx", pivot_idx))
    range_start_at = ""
    range_end_at = ""
    if 0 <= si0 < len(zoh):
        range_start_at = pd.Timestamp(zoh.index[si0]).isoformat()
    if 0 <= ei0 < len(zoh):
        range_end_at = pd.Timestamp(zoh.index[ei0]).isoformat()

    n = len(zoh)
    end_idx = int(z.get("end_idx", pivot_idx))
    died_at: str | None = None
    if end_idx < n - 1:
        di = min(end_idx + 1, n - 1)
        died_at = pd.Timestamp(zoh.index[di]).isoformat()

    touch1_at = str(z.get("touch_date") or "").strip() or None
    touch1_price = z.get("touch_marker_price")
    touch1_price_f = float(touch1_price) if touch1_price is not None else None

    inducement_count = int(z.get("inducement_count", 0) or 0)
    base_length = int(z.get("base_length", 0) or 0)
    impulse = z.get("impulse_score", 0)
    try:
        impulse_score = float(impulse)
    except (TypeError, ValueError):
        impulse_score = 0.0

    max_age = max(0, end_idx - pivot_idx + 1) if pivot_idx >= 0 else 0

    with_tr = _with_trend_for_zone(
        kind=kind, pivot_idx=pivot_idx, hl_dir=hl_dir, tf_key=tf_key, params=params
    )

    zid = _stable_zone_id(
        dataset_id=dataset_id,
        source_tf=source_tf,
        kind=kind,
        pivot_idx=pivot_idx,
        price_low=vl,
        price_high=vh,
        born_iso=born_at,
    )

    return {
        "zone_id": zid,
        "kind": kind,
        "source_tf": source_tf,
        "born_at": born_at,
        "range_start_at": range_start_at,
        "range_end_at": range_end_at,
        "died_at": died_at,
        "price_low": vl,
        "price_high": vh,
        "range_size": float(vh - vl),
        "base_length": base_length,
        "has_inducement": bool(inducement_count > 0),
        "impulse_score": impulse_score,
        "touch1_at": touch1_at,
        "touch1_price": touch1_price_f,
        "touch2_at": None,
        "touch2_price": None,
        "max_age_before_death": int(max_age),
        "with_trend": bool(with_tr),
        "pivot_idx": pivot_idx,
        "start_idx": int(z.get("start_idx", pivot_idx)),
        "end_idx": end_idx,
    }


def run_sd_precompute(
    *,
    data_dir: Path,
    data_file: str,
    years: float = 0.0,
    start_iso: str | None = None,
    end_iso: str | None = None,
    params_snapshot: dict[str, Any] | None = None,
    zone_timeframes: list[str] | None = None,
    artifacts_base: Path | None = None,
    use_lock: bool = True,
    require_hl_manifest: bool = True,
    require_matching_hl_digest: bool = True,
    on_zone_tf_start: Callable[[int, int, str], None] | None = None,
    on_zone_tf_complete: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    """
    Vyžaduje existující ``hl/v1/manifest.json`` pro stejný ``dataset_id`` (po spuštění H/L precomputu).

    ``on_zone_tf_start`` — před ``get_zones`` pro TF.

    ``on_zone_tf_complete`` — po zpracování TF; při ``n_total==0`` jedno ``(0, 0, \"\")``.
    """
    resolved = resolve_safe_data_path(data_dir, data_file)
    if resolved is None:
        raise ValueError("Invalid or missing data_file")

    fp = fingerprint_dataset_file(resolved)
    y = float(years or 0.0)
    y_store = None if y <= 0 else y
    dataset_id = artifact_store.compute_dataset_id(data_file, fp, years=y_store, start_iso=start_iso, end_iso=end_iso)

    hl_man_path = artifact_store.hl_manifest_path(artifacts_base, dataset_id)
    hl_manifest = artifact_store.read_json_if_exists(hl_man_path)
    if require_hl_manifest:
        if not hl_manifest or str(hl_manifest.get("kind")) != "hl":
            raise ValueError(
                "Chybí H/L artefakt — nejdřív spusť H/L precompute (hl/v1/manifest) pro stejný dataset."
            )
    if require_matching_hl_digest and hl_manifest:
        cur = compute_hl_module_digest()
        old = str(hl_manifest.get("hl_module_digest") or "").strip()
        if old and cur and old != cur:
            raise ValueError(
                f"H/L modul se změnil (digest cache {old[:8]}… vs aktuální {cur[:8]}…). Přepočti H/L artefakt."
            )

    sd_dir = artifact_store.sd_version_dir(artifacts_base, dataset_id)
    lock_path = artifact_store.dataset_dir(artifacts_base, dataset_id) / ".sd_precompute.lock"
    artifact_store.ensure_dir(lock_path.parent)
    if use_lock and not artifact_store.acquire_lock(lock_path):
        raise RuntimeError(f"S/D precompute already running or stale lock: {lock_path}")

    try:
        artifact_store.ensure_dir(sd_dir)
        native = load_native_ohlc(data_dir, data_file, y, start_iso, end_iso)
        if native is None or len(native) < 3:
            raise ValueError("Insufficient OHLC rows after load")

        sd_mod = _import_sd_zones()
        merged = dict(getattr(sd_mod, "_VIEW_PARAMS_INTERNAL", {}) or {})
        merged.update(dict(getattr(sd_mod, "VIEW_PARAMS", {}) or {}))
        merged.update(dict(params_snapshot or {}))

        t0 = native.index.min()
        t1 = native.index.max()
        tr_start = pd.Timestamp(t0).isoformat()
        tr_end = pd.Timestamp(t1).isoformat()

        try:
            sh = _load_swing_hl()
            inferred = sh._infer_data_timeframe(native)
        except Exception:
            inferred = None

        tfs = list(zone_timeframes or ["1d"])
        hl_dir = artifact_store.hl_version_dir(artifacts_base, dataset_id)

        hl_digest = str((hl_manifest or {}).get("hl_module_digest") or compute_hl_module_digest())
        sd_digest = compute_sd_module_digest() or "missing"
        hl_rel = f"{dataset_id}/hl/v1/manifest.json"

        manifest = artifact_store.build_sd_manifest_skeleton(
            dataset_id=dataset_id,
            data_file=data_file,
            data_fingerprint=fp,
            time_range_start=tr_start,
            time_range_end=tr_end,
            years=y_store,
            hl_module_digest=hl_digest,
            sd_module_digest=sd_digest,
            params_snapshot={**dict(merged), "zone_timeframes": tfs},
            hl_manifest_path_rel=hl_rel,
        )

        work_sd: list[dict[str, Any]] = []
        for raw_tf in tfs:
            ctf = canonical_precompute_tf(raw_tf) or str(raw_tf).strip()
            tf_hl = str(ctf).replace("/", "_")
            zoh = resample_to_zone_tf(native, ctf)
            need = min_zone_ohlc_bars(ctf)
            if zoh.empty or len(zoh) < need:
                continue

            mp = dict(merged)
            mp["timeframe"] = ctf
            if inferred:
                mp["data_timeframe"] = inferred
            work_sd.append({"ctf": ctf, "tf_hl": tf_hl, "zoh": zoh, "mp": mp})

        n_sd = len(work_sd)
        if n_sd == 0 and on_zone_tf_complete is not None:
            on_zone_tf_complete(0, 0, "")

        rows: list[dict[str, Any]] = []
        for idx, w in enumerate(work_sd):
            ctf = w["ctf"]
            tf_hl = w["tf_hl"]
            zoh = w["zoh"]
            mp = w["mp"]

            if on_zone_tf_start is not None:
                on_zone_tf_start(idx, n_sd, str(ctf))

            zones = sd_mod.get_zones(zoh, mp)
            for z in zones:
                if str(z.get("name", "")) not in ("Demand", "Supply"):
                    continue
                rows.append(
                    _zone_row_from_module_dict(
                        z,
                        dataset_id=dataset_id,
                        source_tf=str(ctf),
                        zoh=zoh,
                        hl_dir=hl_dir,
                        tf_key=tf_hl,
                        params=mp,
                    )
                )
            if on_zone_tf_complete is not None:
                on_zone_tf_complete(idx, n_sd, str(ctf))

        if not rows:
            zones_df = pd.DataFrame(columns=list(SD_ZONE_PARQUET_COLUMNS))
        else:
            zones_df = pd.DataFrame(rows)
            for col in SD_ZONE_PARQUET_COLUMNS:
                if col not in zones_df.columns:
                    zones_df[col] = None
            zones_df = zones_df[list(SD_ZONE_PARQUET_COLUMNS)]

        zones_path = sd_dir / "zones.parquet"
        zones_df.to_parquet(zones_path, index=False)

        manifest["artifacts"] = {"zones": zones_path.name, "rows": int(len(zones_df))}
        manifest["created_at_utc"] = datetime.now(timezone.utc).isoformat()

        artifact_store.write_atomic_json(artifact_store.sd_manifest_path(artifacts_base, dataset_id), manifest)

        return {
            "dataset_id": dataset_id,
            "sd_dir": str(sd_dir),
            "manifest": manifest,
            "zones_path": str(zones_path),
        }
    finally:
        if use_lock:
            artifact_store.release_lock(lock_path)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="S/D precompute → .backtest_artifacts/sd/v1")
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--data-file", type=str, required=True)
    ap.add_argument("--years", type=float, default=0.0)
    ap.add_argument("--start-iso", type=str, default="")
    ap.add_argument("--end-iso", type=str, default="")
    ap.add_argument("--zone-tf", type=str, action="append", dest="zone_tfs", help="Repeat for multiple TFs (default 1d)")
    ap.add_argument("--no-lock", action="store_true")
    ap.add_argument("--allow-stale-hl-digest", action="store_true")
    args = ap.parse_args()
    tfs = args.zone_tfs if args.zone_tfs else None
    out = run_sd_precompute(
        data_dir=args.data_dir,
        data_file=args.data_file,
        years=args.years,
        start_iso=args.start_iso or None,
        end_iso=args.end_iso or None,
        zone_timeframes=tfs,
        use_lock=not args.no_lock,
        require_matching_hl_digest=not args.allow_stale_hl_digest,
    )
    print(out["dataset_id"])
    print(out["sd_dir"])


if __name__ == "__main__":
    main()
