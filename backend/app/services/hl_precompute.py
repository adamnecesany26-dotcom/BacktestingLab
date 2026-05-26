"""
H/L precompute (fáze 2): jeden průchod žebříčkem TF, zápis Parquet + manifest pod ``hl/v1/``.
"""

from __future__ import annotations

import hashlib
import importlib.util
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from app.services import artifact_store
from app.services.data_ohlc import fingerprint_dataset_file, resolve_safe_data_path
from app.services.hl_artifact_spec import canonical_precompute_tf, resolve_build_timeframes
from app.services.hl_data_load import load_native_ohlc

_SWING_HL_REL = Path("strategies") / "modules" / "Swing_HL.py"


def swing_hl_module_path() -> Path:
    return artifact_store.repo_root() / _SWING_HL_REL


def compute_hl_module_digest() -> str:
    p = swing_hl_module_path()
    if not p.is_file():
        return ""
    return hashlib.sha256(p.read_bytes()).hexdigest()[:32]


def _load_swing_hl():
    path = swing_hl_module_path()
    if not path.is_file():
        raise FileNotFoundError(f"Swing_HL.py not found: {path}")
    spec = importlib.util.spec_from_file_location("swing_hl_precompute", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Swing_HL")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def get_swing_hl_module():
    """Stejný modul jako při H/L precompute — sdílené s View (parity df_chart)."""
    return _load_swing_hl()


def _tf_skip_reason(
    sh: Any,
    native_inferred: str | None,
    chart_tf: str,
) -> str | None:
    """None = ok; else reason string (output TF jemnější než nativní krok)."""
    inf = native_inferred if (native_inferred and native_inferred in sh.TF_FINE_TO_COARSE) else None
    if not inf:
        return None
    coarse_chart = sh.TF_FINE_TO_COARSE.get(chart_tf)
    coarse_inf = sh.TF_FINE_TO_COARSE.get(inf)
    if coarse_chart is None or coarse_inf is None:
        return None
    if coarse_chart < coarse_inf:
        return f"chart_tf finer than native ({inf})"
    return None


def _swing_rows(items: list[dict], chart_index: pd.DatetimeIndex | None = None) -> list[dict]:
    out: list[dict] = []
    for s in items:
        ts = s.get("timestamp")
        iso = ""
        if ts is not None:
            try:
                iso = pd.Timestamp(ts).isoformat()
            except (TypeError, ValueError, OSError):
                iso = str(ts)
        bi = int(s.get("index", -1))
        if (not iso or not str(iso).strip()) and chart_index is not None and 0 <= bi < len(chart_index):
            try:
                iso = pd.Timestamp(chart_index[bi]).isoformat()
            except (TypeError, ValueError, OSError):
                pass
        out.append({
            "bar_index": bi,
            "iso_time": iso,
            "type": str(s.get("type", "")),
            "price": float(s.get("price", 0.0)),
        })
    return out


def _bos_rows(events: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for ev in events:
        r: dict[str, Any] = {}
        for k, v in ev.items():
            if hasattr(v, "isoformat"):
                r[k] = pd.Timestamp(v).isoformat()
            else:
                r[k] = v
        rows.append(r)
    return rows


def run_hl_precompute(
    *,
    data_dir: Path,
    data_file: str,
    years: float = 0.0,
    start_iso: str | None = None,
    end_iso: str | None = None,
    params_snapshot: dict[str, Any] | None = None,
    timeframes: list[str] | None = None,
    artifacts_base: Path | None = None,
    use_lock: bool = True,
    on_tf_start: Callable[[int, int, str], None] | None = None,
    on_tf_complete: Callable[[int, int, str], None] | None = None,
    on_tf_step: Callable[[int, int, str, str], None] | None = None,
) -> dict[str, Any]:
    """
    Spustí H/L precompute pro jeden dataset; zapíše ``hl/v1/*`` a vrátí metadata včetně ``dataset_id``.

    ``data_dir`` je kořen dat (např. Docker ``DATA_DIR``); ``data_file`` relativní bezpečná cesta.

    ``on_tf_start(idx0, n_total, tf_label)`` — těsně před ``get_swings`` pro daný TF (UI nedlouho čeká bez zprávy).

    ``on_tf_complete(idx0, n_total, tf_label)`` — po zápisu Parquet pro TF
    (``n_total==0`` → jedno ``on_tf_complete(0,0,\"\")``).

    ``on_tf_step(idx0, n_total, tf_label, step)`` — hrubé milníky uvnitř TF
    (např. swings/bos/trend/write) pro lepší UI průběh.
    """
    resolved = resolve_safe_data_path(data_dir, data_file)
    if resolved is None:
        raise ValueError("Invalid or missing data_file")

    fp = fingerprint_dataset_file(resolved)
    y = float(years or 0.0)
    y_store = None if y <= 0 else y
    dataset_id = artifact_store.compute_dataset_id(data_file, fp, years=y_store, start_iso=start_iso, end_iso=end_iso)
    hl_dir = artifact_store.hl_version_dir(artifacts_base, dataset_id)
    lock_path = artifact_store.dataset_dir(artifacts_base, dataset_id) / ".hl_precompute.lock"

    artifact_store.ensure_dir(lock_path.parent)
    if use_lock and not artifact_store.acquire_lock(lock_path):
        # Provide actionable info: pid/age if present.
        pid, created_at = artifact_store._read_lock_file(lock_path)  # type: ignore[attr-defined]
        age_s = None
        try:
            import time as _time

            if created_at is not None:
                age_s = max(0.0, float(_time.time() - float(created_at)))
        except Exception:
            age_s = None
        extra = []
        if pid is not None:
            extra.append(f"pid={pid}")
        if age_s is not None:
            extra.append(f"age_sec={int(age_s)}")
        suffix = f" ({', '.join(extra)})" if extra else ""
        raise RuntimeError(f"H/L precompute lock present: {lock_path}{suffix}")

    try:
        artifact_store.ensure_dir(hl_dir)
        native = load_native_ohlc(data_dir, data_file, y, start_iso, end_iso)
        if native is None or len(native) < 3:
            raise ValueError("Insufficient OHLC rows after load")

        t0 = native.index.min()
        t1 = native.index.max()
        tr_start = pd.Timestamp(t0).isoformat()
        tr_end = pd.Timestamp(t1).isoformat()

        sh = _load_swing_hl()
        digest = compute_hl_module_digest() or "missing"

        merged = dict(getattr(sh, "_VIEW_PARAMS_INTERNAL", {}) or {})
        merged.update(dict(sh.VIEW_PARAMS))
        merged.update(dict(params_snapshot or {}))

        inferred_native: str | None = sh._infer_data_timeframe(native)

        tf_run = resolve_build_timeframes(timeframes)

        manifest = artifact_store.build_hl_manifest_skeleton(
            dataset_id=dataset_id,
            data_file=data_file,
            data_fingerprint=fp,
            time_range_start=tr_start,
            time_range_end=tr_end,
            years=y_store,
            hl_module_digest=digest,
            params_snapshot=dict(merged),
            tf_ladder=list(tf_run),
        )

        artifacts: dict[str, Any] = {}
        skipped: list[dict[str, str]] = []
        quality: dict[str, Any] = {}

        work_items: list[dict[str, Any]] = []
        for raw_tf in tf_run:
            ctf = canonical_precompute_tf(raw_tf) or sh._canonical_chart_tf(raw_tf)
            if not ctf:
                skipped.append({"tf": raw_tf, "reason": "unknown_tf"})
                continue

            reason = _tf_skip_reason(sh, inferred_native, ctf)
            if reason:
                skipped.append({"tf": raw_tf, "reason": reason})
                continue

            df_chart = sh._resample_ohlc(
                native,
                ctf,
                inferred_native,
                source_tf_effective=inferred_native,
            )
            if df_chart is None or len(df_chart) < 3:
                skipped.append({"tf": raw_tf, "reason": "insufficient_bars_after_resample"})
                continue

            p = dict(merged)
            p["timeframe"] = ctf
            p["data_timeframe"] = inferred_native
            p["_view_chart_tf"] = ctf

            tf_key = str(raw_tf).replace("/", "_")
            work_items.append({"raw_tf": raw_tf, "ctf": ctf, "df_chart": df_chart, "p": p, "tf_key": tf_key})

        n_work = len(work_items)
        if n_work == 0 and on_tf_complete is not None:
            on_tf_complete(0, 0, "")

        for idx, item in enumerate(work_items):
            ctf = item["ctf"]
            df_chart = item["df_chart"]
            p = item["p"]
            tf_key = item["tf_key"]

            if on_tf_start is not None:
                on_tf_start(idx, n_work, str(ctf))

            if on_tf_step is not None:
                on_tf_step(idx, n_work, str(ctf), "swings")
            swings = sh.get_swings(df_chart, p)
            if not isinstance(swings, list):
                swings = (swings or {}).get("swings") or []

            if on_tf_step is not None:
                on_tf_step(idx, n_work, str(ctf), "bos")
            bos = sh.get_bos(df_chart, p)
            store_trend = ctf in ("1M", "1d")
            if on_tf_step is not None:
                on_tf_step(idx, n_work, str(ctf), "trend")
            line = sh.get_line(df_chart, p) if store_trend else None

            rel: dict[str, str] = {}

            if on_tf_step is not None:
                on_tf_step(idx, n_work, str(ctf), "write")
            s_df = pd.DataFrame(_swing_rows(swings, df_chart.index))
            path_sw = hl_dir / f"{tf_key}_swings.parquet"
            s_df.to_parquet(path_sw, index=False)
            rel["swings"] = path_sw.name

            path_int = hl_dir / f"{tf_key}_internals.parquet"
            pd.DataFrame(columns=["bar_index", "iso_time", "type", "price"]).to_parquet(path_int, index=False)
            rel["internals"] = path_int.name

            path_maj = hl_dir / f"{tf_key}_majors.parquet"
            pd.DataFrame(columns=["bar_index", "iso_time", "type", "price"]).to_parquet(path_maj, index=False)
            rel["majors"] = path_maj.name

            b_df = pd.DataFrame(_bos_rows(bos))
            path_bos = hl_dir / f"{tf_key}_bos.parquet"
            b_df.to_parquet(path_bos, index=False)
            rel["bos"] = path_bos.name

            trend_rows: list[dict] = []
            if store_trend and line and isinstance(line, dict):
                tdata = (line.get("Trend") or {}).get("data") or []
                for i, row in enumerate(tdata):
                    if not isinstance(row, dict):
                        continue
                    d_cell = row.get("date", "")
                    iso_tr = str(d_cell) if d_cell is not None else ""
                    if (not iso_tr or not iso_tr.strip()) and i < len(df_chart):
                        try:
                            iso_tr = pd.Timestamp(df_chart.index[i]).isoformat()
                        except (TypeError, ValueError, OSError):
                            iso_tr = ""
                    trend_rows.append({
                        "bar_index": i,
                        "iso_time": iso_tr,
                        "line_value": float(row.get("value", 0.0)),
                        "score": float(row.get("score", 0.0)),
                        "state": str(row.get("state", "")),
                    })
            if store_trend:
                t_df = pd.DataFrame(trend_rows)
                path_tr = hl_dir / f"{tf_key}_trend.parquet"
                t_df.to_parquet(path_tr, index=False)
                rel["trend"] = path_tr.name
            rel["bar_count"] = int(len(df_chart))

            # --- Quality diagnostics (sanity gates) ---
            bar_count = int(len(df_chart))
            swing_count = int(len(s_df))
            bos_count = int(len(b_df))
            warn: list[str] = []
            # Heuristic: on long series, a swing detector returning single digits is almost certainly misconfigured.
            # Keep this conservative to avoid noisy warnings on very short series.
            min_swings = int(min(200, max(5, bar_count // 120))) if bar_count >= 60 else 0
            if min_swings > 0 and swing_count < min_swings:
                warn.append(
                    f"too_few_swings: swings={swing_count}, bars={bar_count}, expected>={min_swings}"
                )
            if bar_count >= 300 and bos_count == 0:
                warn.append(f"missing_bos: bos=0 (bars={bar_count})")

            quality[tf_key] = {
                "chart_tf": str(ctf),
                "bar_count": bar_count,
                "swing_count": swing_count,
                "internal_count": 0,
                "major_count": 0,
                "bos_count": bos_count,
                "warnings": warn,
            }

            artifacts[tf_key] = rel
            if on_tf_complete is not None:
                on_tf_complete(idx, n_work, str(ctf))

        manifest["artifacts"] = artifacts
        manifest["skipped_timeframes"] = skipped
        manifest["quality"] = quality
        manifest["native_inferred_tf"] = inferred_native
        manifest["created_at_utc"] = datetime.now(timezone.utc).isoformat()

        artifact_store.write_atomic_json(artifact_store.hl_manifest_path(artifacts_base, dataset_id), manifest)

        return {
            "dataset_id": dataset_id,
            "hl_dir": str(hl_dir),
            "manifest": manifest,
        }
    finally:
        if use_lock:
            artifact_store.release_lock(lock_path)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="H/L precompute → .backtest_artifacts")
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--data-file", type=str, required=True)
    ap.add_argument("--years", type=float, default=0.0)
    ap.add_argument("--start-iso", type=str, default="")
    ap.add_argument("--end-iso", type=str, default="")
    ap.add_argument("--no-lock", action="store_true")
    args = ap.parse_args()

    out = run_hl_precompute(
        data_dir=args.data_dir,
        data_file=args.data_file,
        years=args.years,
        start_iso=args.start_iso or None,
        end_iso=args.end_iso or None,
        use_lock=not args.no_lock,
    )
    print(out["dataset_id"])
    print(out["hl_dir"])


if __name__ == "__main__":
    main()
