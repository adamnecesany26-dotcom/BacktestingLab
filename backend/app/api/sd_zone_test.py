"""
POST /api/sd-zone-test/run — S/D touch analytics z artefaktů (touch_events), bez engine.
"""

from __future__ import annotations

import math
import statistics
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.view import (
    _apply_view_chart_timeframe,
    _get_data_dir,
    _load_ohlc,
    _normalize_chart_tf_key,
    _series_as_float,
    _to_iso,
)
from app.services import artifact_store, view_artifacts
from app.services.audit import append_audit_event
from app.services.data_ohlc import fingerprint_dataset_file, resolve_safe_data_path
from app.services.hl_artifact_spec import PRECOMPUTE_TF_LADDER, canonical_precompute_tf
from app.services.sd_zone_touch_analytics import (
    SdTouchAnalyticsParams,
    analyze_touch_events_on_ohlc,
    zones_from_sd_parquet_rows,
)
from app.services.view_artifacts import _filter_sd_zones_df_for_chart_tf

router = APIRouter()
MAX_SD_ZONE_TEST_TOUCHES = 25_000

# ``zones.parquet`` má ``source_tf`` jen z S/D precompute žebříčku (viz ``PRECOMPUTE_TF_LADDER``) — bez 30m/15m/5m/1m.
_SD_ZONE_PARQUET_SOURCE_TF: frozenset[str] = frozenset(PRECOMPUTE_TF_LADDER)


def _effective_sd_zone_tf_filter(
    zone_timeframe_req: str | None,
    chart_derived_tf: str | None,
) -> tuple[str | None, str | None]:
    """
    Vrátí (tf pro ``_filter_sd_zones_df_for_chart_tf``, poznámka pro UI).

    Pro graf / odvozený TF jemnější než 1h (např. 30m) v Parquetu **nejsou** řádky se stejným
    ``source_tf`` — filtr None = všechny zóny (stejný model jako View nad jemným OHLC).
    """
    notes: list[str] = []
    if zone_timeframe_req and str(zone_timeframe_req).strip():
        raw = str(zone_timeframe_req).strip()
        c = canonical_precompute_tf(raw)
        if c is not None and c in _SD_ZONE_PARQUET_SOURCE_TF:
            return c, None
        notes.append(f"zone_timeframe „{raw}“ není v S/D Parquet — použity všechny TF z buildu.")
        return None, "; ".join(notes) if notes else None
    if chart_derived_tf and str(chart_derived_tf).strip():
        raw = str(chart_derived_tf).strip()
        c = canonical_precompute_tf(raw)
        if c is not None and c in _SD_ZONE_PARQUET_SOURCE_TF:
            return c, None
        notes.append(
            f"Časový rámec grafu ({raw}) nemá vlastní řádky v zones.parquet — použity všechny TF z buildu."
        )
        return None, "; ".join(notes) if notes else None
    return None, None


def _sanitize_float_json(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sanitize_float_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_float_json(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj


def sd_zone_trade_is_winner(
    t: dict[str, Any],
    winner_rr: float,
    breakeven_move_r: float | None,
) -> bool:
    """
    Winner = reached ``winner_rr`` before SL under path semantics.

    When ``breakeven_move_r`` is set and ``be_bar`` is present (BE armed), a win requires
    ``thr_hit_bar`` on or after the BE arm bar and strictly before ``sl_hit_bar`` when SL fired.
    """

    def _by_mfe_before_sl() -> bool:
        mbs = t.get("mfe_before_sl_R")
        if mbs is None:
            mbs = t.get("mfe_R")
        try:
            mbs_f = float(mbs) if mbs is not None else float("nan")
        except Exception:
            mbs_f = float("nan")
        return math.isfinite(mbs_f) and mbs_f >= float(winner_rr)

    use_be = (
        breakeven_move_r is not None
        and math.isfinite(float(breakeven_move_r))
        and float(breakeven_move_r) > 0
    )
    if not use_be:
        return _by_mfe_before_sl()

    be_b = t.get("be_bar")
    if be_b is None:
        return _by_mfe_before_sl()

    th_b = t.get("thr_hit_bar")
    sl_b = t.get("sl_hit_bar")
    try:
        ibe = int(be_b)
    except Exception:
        return False
    if th_b is None:
        return False
    try:
        ith = int(th_b)
    except Exception:
        return False
    if ith < ibe:
        return False
    if sl_b is None:
        return True
    try:
        isl = int(sl_b)
    except Exception:
        return True
    return ith < isl


class RiskPctRange(BaseModel):
    min: float = Field(..., ge=0.0, le=1.0)
    max: float = Field(..., ge=0.0, le=1.0)


class SlMultRange(BaseModel):
    min: float = Field(..., ge=0.05, le=10.0)
    max: float = Field(..., ge=0.05, le=10.0)


class SdZoneTestRequest(BaseModel):
    data_file: str
    years: float = 0.0
    start_iso: str | None = None
    end_iso: str | None = None
    chart_timeframe: str | None = None
    """Primary S/D zone TF (``source_tf`` v Parquet). Prázdné = stejná heuristika jako View (podle grafu)."""
    zone_timeframe: str | None = None
    zone_timeframes: list[str] | None = None
    entry_price_mode: str = "touch_price"
    sl_zone_height_mult: float = 1.25
    sl_zone_height_mult_range: SlMultRange | None = None
    max_mfe_R: float = 10.0
    winner_rr: float = 1.5
    breakeven_move_r: float | None = Field(
        default=None,
        description="Po dosažení tohoto R (na svíčkách po entry) se SL přesune na entry; dál jen winner / BE / cap.",
    )
    tradable_only: bool = False
    zone_origins: list[str] | None = None
    risk_display: str = "r"
    equity: float = 100_000.0
    risk_pct: float = 0.01
    risk_pct_range: RiskPctRange | None = None
    risk_seed: int | None = None
    dataset_id: str | None = None


@router.post("/sd-zone-test/run")
async def run_sd_zone_test(req: SdZoneTestRequest, request: Request) -> dict[str, Any]:
    actor_id = getattr(request.state, "actor_id", "unknown")
    try:
        df = _load_ohlc(req.data_file, req.years, req.start_iso, req.end_iso)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        df_chart = _apply_view_chart_timeframe(df, req.chart_timeframe)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chart timeframe: {e}") from e

    data_dir = _get_data_dir()
    resolved = resolve_safe_data_path(data_dir, req.data_file)
    if resolved is None:
        raise HTTPException(status_code=400, detail="Invalid data_file")
    fp = fingerprint_dataset_file(resolved)
    dataset_id = (req.dataset_id or "").strip() or artifact_store.compute_dataset_id(
        req.data_file, fp, years=None, start_iso=None, end_iso=None
    )

    sd_mpath = artifact_store.sd_manifest_path(None, dataset_id)
    sd_manifest = artifact_store.read_json_if_exists(sd_mpath)
    if not sd_manifest or str(sd_manifest.get("kind")) != "sd":
        raise HTTPException(
            status_code=400,
            detail="Chybí S/D artefakt — spusťte S/D precompute (Build features) pro tento dataset.",
        )

    hl_mpath = artifact_store.hl_manifest_path(None, dataset_id)
    hl_manifest = artifact_store.read_json_if_exists(hl_mpath)
    if not hl_manifest or str(hl_manifest.get("kind")) != "hl":
        raise HTTPException(
            status_code=400,
            detail="Chybí H/L manifest — nejdřív H/L precompute (potřebné pro BOS vrstvu).",
        )

    if artifact_store.manifest_is_stale_fingerprint(hl_manifest, fp):
        raise HTTPException(
            status_code=400,
            detail="Artefakt neodpovídá aktuálnímu souboru dat — přepočti Build features.",
        )

    sd_dir = sd_mpath.parent
    z_files = (sd_manifest.get("artifacts") or {}).get("zones")
    zname = None
    if isinstance(z_files, str):
        zname = z_files
    elif isinstance(z_files, dict):
        zname = z_files.get("path") or z_files.get("parquet")
    zp = sd_dir / zname if zname else sd_dir / "zones.parquet"
    if not zp.is_file():
        raise HTTPException(status_code=400, detail="V S/D manifestu chybí soubor zones.parquet.")

    zdf_all = pd.read_parquet(zp)
    if zdf_all is None or zdf_all.empty:
        art_z = sd_manifest.get("artifacts") or {}
        rows_meta = art_z.get("rows") if isinstance(art_z, dict) else None
        rows_hint = (
            f" V manifestu S/D je u zón uvedeno rows={rows_meta!r}."
            if rows_meta is not None
            else ""
        )
        rel_zp = str(zp.resolve())
        try:
            rel_zp = str(zp.resolve().relative_to(artifact_store.repo_root()))
        except ValueError:
            pass
        raise HTTPException(
            status_code=400,
            detail=(
                "Soubor zones.parquet existuje, ale má 0 řádků — při posledním S/D precomputu modul get_zones "
                "nenašel žádné Demand/Supply zóny (typicky málo dat po agregaci na zvolené zone TF v buildu, "
                "nebo parametry / digest modulu).{rows} "
                "Zkontroluj v Build features zaškrtnuté TF zón a délku dat; případně změň parametry S/D a znovu Build. "
                "(dataset_id={did}, soubor={zp})"
            ).format(rows=rows_hint, did=dataset_id, zp=rel_zp),
        )

    chart_tf_n = _normalize_chart_tf_key(req.chart_timeframe)
    want_tf = view_artifacts._resolve_want_hl_artifact_tf_key(chart_tf_n, df_chart.index)
    want_zone_filter: str | None = None
    req_zone_list = [str(x).strip() for x in (req.zone_timeframes or []) if x is not None and str(x).strip()]
    if req_zone_list:
        want_set: set[str] = set()
        for raw in req_zone_list:
            c = canonical_precompute_tf(raw)
            if c is not None and c in _SD_ZONE_PARQUET_SOURCE_TF:
                want_set.add(c)
        if want_set:
            # IMPORTANT: keep filtering semantics identical to single-TF runs by reusing
            # `_filter_sd_zones_df_for_chart_tf` per TF and then unioning results.
            frames: list[pd.DataFrame] = []
            used_each: list[str] = []
            for tf in sorted(want_set):
                df_i, _, used_i = _filter_sd_zones_df_for_chart_tf(zdf_all, tf)
                if df_i is not None and not df_i.empty:
                    frames.append(df_i)
                    if used_i:
                        used_each.append(str(used_i))
                    else:
                        used_each.append(str(tf))
            if frames:
                zdf_use = pd.concat(frames, axis=0, ignore_index=False)
                # Deduplicate by zone id when present; otherwise drop exact row dups.
                if "zone_id" in zdf_use.columns:
                    zdf_use = zdf_use.drop_duplicates(subset=["zone_id"])
                else:
                    zdf_use = zdf_use.drop_duplicates()
            else:
                zdf_use = zdf_all.copy()
            used_sd_c = ",".join(sorted(set(used_each or list(want_set))))
            zone_tf_note = None
            want_zone_label = used_sd_c
            want_zone_filter = used_sd_c
        else:
            # Invalid list → fall back to all TFs like View.
            zdf_use = zdf_all.copy()
            used_sd_c = None
            zone_tf_note = "zone_timeframes neobsahuje žádný TF dostupný v zones.parquet — použity všechny TF z buildu."
            want_zone_label = "všechny TF z buildu"
            want_zone_filter = None
    else:
        req_zone = (req.zone_timeframe or "").strip() or None
        want_zone_filter, zone_tf_note = _effective_sd_zone_tf_filter(req_zone, want_tf)
        want_zone_label = req_zone or want_tf or "všechny TF z buildu"

        zdf_use, _, used_sd_c = _filter_sd_zones_df_for_chart_tf(zdf_all, want_zone_filter)
        if zdf_use is None or zdf_use.empty:
            zdf_use, _, used_sd_c = _filter_sd_zones_df_for_chart_tf(zdf_all, None)
    if zdf_use is None or zdf_use.empty:
        src_tfs = sorted(
            {
                str(x).strip()
                for x in zdf_all["source_tf"].tolist()
                if x is not None and str(x).strip() and str(x).lower() != "nan"
            }
        )
        if "source_tf" not in zdf_all.columns:
            src_tfs = []
        extra = f" Dostupné source_tf: {', '.join(src_tfs)}." if src_tfs else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"Žádné zóny k analýze (požadavek TF „{want_zone_label}“).{extra} "
                "Zkus zone_timeframe z buildu (1M, 1w, 1d, 4h, 1h) nebo přepočti S/D."
            ),
        )

    zones_by_tf: dict[str, list[dict[str, Any]]] | None = None
    zones: list[dict[str, Any]] = []
    if req_zone_list and isinstance(req.zone_timeframes, list) and len(req.zone_timeframes) > 0:
        # Multi-select semantics: run the backtest per TF independently (same as user running each TF separately),
        # then concatenate results. This avoids cross-TF mixing that can skew win/lose rates.
        zones_by_tf = {}
        for raw in req_zone_list:
            c = canonical_precompute_tf(raw)
            if c is None or c not in _SD_ZONE_PARQUET_SOURCE_TF:
                continue
            zdf_i, _, _used_i = _filter_sd_zones_df_for_chart_tf(zdf_all, c)
            if zdf_i is None or zdf_i.empty:
                continue
            zs_i = zones_from_sd_parquet_rows(zdf_i, df_chart.index)
            if zs_i:
                zones_by_tf[c] = zs_i
        # For UI overlays we still keep a union of zones (dedup by zone_id when possible).
        for _tf, zs in (zones_by_tf or {}).items():
            zones.extend(zs)
        if zones:
            seen: set[str] = set()
            dedup: list[dict[str, Any]] = []
            for z in zones:
                zid = str(z.get("zone_id") or "")
                if zid and zid in seen:
                    continue
                if zid:
                    seen.add(zid)
                dedup.append(z)
            zones = dedup
    else:
        zones = zones_from_sd_parquet_rows(zdf_use, df_chart.index)
    if len(zones) > MAX_SD_ZONE_TEST_TOUCHES:
        zones = zones[:MAX_SD_ZONE_TEST_TOUCHES]

    art_hl = view_artifacts.build_view_from_artifacts(
        data_dir=data_dir,
        data_file=req.data_file,
        years=req.years,
        start_iso=req.start_iso,
        end_iso=req.end_iso,
        df_chart=df_chart,
        chart_tf_normalized=chart_tf_n,
        include_hl=True,
        include_sd=True,
        dataset_id_override=dataset_id,
    )
    bos_markers = [m for m in art_hl.get("markers", []) if str(m.get("type", "")).lower().startswith("bos_")]

    zo_set = set(req.zone_origins) if req.zone_origins else None
    rp_lo = req.risk_pct_range.min if req.risk_pct_range else None
    rp_hi = req.risk_pct_range.max if req.risk_pct_range else None
    be_move: float | None = None
    if req.breakeven_move_r is not None:
        try:
            be_x = float(req.breakeven_move_r)
        except Exception:
            be_x = float("nan")
        if math.isfinite(be_x) and 0 < be_x <= 50.0:
            be_move = be_x

    def _params_for_sl(sl_mult: float) -> SdTouchAnalyticsParams:
        return SdTouchAnalyticsParams(
            sl_zone_height_mult=float(sl_mult),
            max_mfe_R=req.max_mfe_R,
            winner_rr=req.winner_rr,
            breakeven_move_r=be_move,
            tradable_only=req.tradable_only,
            zone_origins=zo_set,
            entry_price_mode=str(req.entry_price_mode or "touch_price"),
            risk_display=str(req.risk_display or "r").lower(),
            equity=float(req.equity),
            risk_pct=float(req.risk_pct),
            risk_pct_min=rp_lo,
            risk_pct_max=rp_hi,
            risk_seed=req.risk_seed,
        )

    params = _params_for_sl(req.sl_zone_height_mult)

    if zones_by_tf:
        trades = []
        aggregates = {}
        # Hard cap total touches across all TFs to keep response bounded.
        total_seen = 0
        for tf in sorted(zones_by_tf.keys()):
            zs_i = zones_by_tf[tf]
            if not zs_i:
                continue
            if total_seen >= MAX_SD_ZONE_TEST_TOUCHES:
                break
            # Analyze just this TF.
            tr_i, _agg_i = analyze_touch_events_on_ohlc(df_chart, zs_i, bos_markers, params)
            trades.extend(tr_i)
            total_seen += len(zs_i)
    else:
        trades, aggregates = analyze_touch_events_on_ohlc(df_chart, zones, bos_markers, params)

    # --- Optional SL sweep (range, fixed 5% steps) ---
    sl_sweep: dict[str, Any] | None = None
    if req.sl_zone_height_mult_range is not None:
        try:
            a = float(req.sl_zone_height_mult_range.min)
            b = float(req.sl_zone_height_mult_range.max)
        except Exception:
            a, b = float("nan"), float("nan")
        if math.isfinite(a) and math.isfinite(b) and a > 0 and b > 0:
            lo_s, hi_s = (a, b) if a <= b else (b, a)
            step = 0.05
            # Guardrail: max 200 steps.
            max_steps = 200
            items: list[dict[str, Any]] = []
            k = 0
            x = lo_s
            while x <= hi_s + 1e-12 and k < max_steps:
                sl_mult = round(x, 4)
                tr_i, _agg_i = analyze_touch_events_on_ohlc(df_chart, zones, bos_markers, _params_for_sl(sl_mult))
                executed_i = [t for t in tr_i if not t.get("skip")]
                n_i = len(executed_i)
                wins = 0
                sum_r = 0.0
                ttb: list[int] = []
                for t in executed_i:
                    is_win = sd_zone_trade_is_winner(t, float(req.winner_rr), be_move)
                    if is_win:
                        wins += 1
                        sum_r += float(req.winner_rr)
                        thb = t.get("thr_hit_bar")
                        eb = t.get("entry_bar")
                        try:
                            if thb is not None and eb is not None:
                                ttb.append(max(0, int(thb) - int(eb)))
                        except Exception:
                            pass
                    else:
                        sum_r += -1.0
                expectancy = (sum_r / n_i) if n_i else None
                win_rate = (wins / n_i) if n_i else None
                avg_ttb = (sum(ttb) / len(ttb)) if ttb else None
                avg_mfe = (sum(float(t.get("mfe_R") or 0.0) for t in executed_i) / n_i) if n_i else None
                avg_mae = (sum(float(t.get("mae_R") or 0.0) for t in executed_i) / n_i) if n_i else None
                items.append(
                    {
                        "sl_mult": sl_mult,
                        "touch_count": n_i,
                        "win_rate": win_rate,
                        "expectancy_r": expectancy,
                        "avg_bars_to_target": avg_ttb,
                        "avg_mfe_r": avg_mfe,
                        "avg_mae_r": avg_mae,
                    }
                )
                k += 1
                x += step
            best = None
            for it in items:
                v = it.get("expectancy_r")
                if v is None:
                    continue
                if best is None or float(v) > float(best.get("expectancy_r") or -1e18):
                    best = it
            sl_sweep = {
                "enabled": True,
                "step": step,
                "min": lo_s,
                "max": hi_s,
                "winner_rr": float(req.winner_rr),
                "items": items,
                "best": best,
            }

    n = len(df_chart)
    # Extra bars to the left: zone birth (born_at), zone span on chart, then buffer before events.
    pad_left = 140
    pad_right = 40
    cap = 1400
    enriched: list[dict[str, Any]] = []
    for t in trades:
        if t.get("skip"):
            enriched.append(t)
            continue
        eb = int(t["entry_bar"])
        bars = [eb, t.get("mfe_bar"), t.get("mae_bar"), t.get("sl_hit_bar"), t.get("cap_hit_bar"), t.get("opposite_bos_bar")]
        xs = [int(x) for x in bars if x is not None and isinstance(x, int)]
        anchor_lo = min(xs)
        for _k in ("zone_bar_start", "zone_bar_end", "zone_born_bar"):
            _v = t.get(_k)
            if isinstance(_v, int) and 0 <= _v < n:
                anchor_lo = min(anchor_lo, _v)
        lo = max(0, anchor_lo - pad_left)
        hi = min(n - 1, max(xs) + pad_right)
        # Prefer keeping left context (origin / zone); trim from the right if over cap.
        if hi - lo + 1 > cap:
            hi = min(n - 1, lo + cap - 1)
            if hi - lo + 1 < cap:
                lo = max(0, hi - (cap - 1))
        tw = dict(t)
        tw["chart_window"] = {"from_bar": lo, "to_bar": hi}
        # Path-only duration: from entry to last observed event bar in scan.
        event_bars = [
            tw.get("mfe_bar"),
            tw.get("mae_bar"),
            tw.get("sl_hit_bar"),
            tw.get("cap_hit_bar"),
            tw.get("opposite_bos_bar"),
            tw.get("be_bar"),
        ]
        xs2: list[int] = []
        for x in event_bars:
            if x is None:
                continue
            try:
                xi = int(x)
            except Exception:
                continue
            if 0 <= xi < n:
                xs2.append(xi)
        end_bar = max(xs2) if xs2 else eb
        tw["duration_bars"] = max(0, int(end_bar) - int(eb))
        # Bars from entry until whichever comes first: peak MFE bar or first SL (for UI stats).
        mfe_b = tw.get("mfe_bar")
        sl_b = tw.get("sl_hit_bar")
        try:
            mfe_i = int(mfe_b) if mfe_b is not None else None
        except Exception:
            mfe_i = None
        try:
            sl_i = int(sl_b) if sl_b is not None else None
        except Exception:
            sl_i = None
        if mfe_i is None and sl_i is None:
            tw["duration_to_mfe_or_sl_bars"] = None
        elif mfe_i is None:
            tw["duration_to_mfe_or_sl_bars"] = max(0, sl_i - eb)  # type: ignore[arg-type]
        elif sl_i is None:
            tw["duration_to_mfe_or_sl_bars"] = max(0, mfe_i - eb)
        else:
            tw["duration_to_mfe_or_sl_bars"] = max(0, min(mfe_i, sl_i) - eb)
        enriched.append(tw)

    # --- Aggregates for UI (path-only metrics; no explicit exit fill) ---
    executed = [t for t in enriched if not t.get("skip")]
    mfe_vals: list[float] = []
    mae_vals: list[float] = []
    dur_vals: list[float] = []
    losers = 0
    for t in executed:
        v = t.get("mfe_R")
        if v is not None:
            try:
                f = float(v)
            except Exception:
                f = float("nan")
            if math.isfinite(f):
                mfe_vals.append(f)
        v = t.get("mae_R")
        if v is not None:
            try:
                f = float(v)
            except Exception:
                f = float("nan")
            if math.isfinite(f):
                mae_vals.append(f)
        d = t.get("duration_bars")
        if d is not None:
            try:
                di = int(d)
            except Exception:
                di = -1
            if di >= 0:
                dur_vals.append(float(di))
        if t.get("sl_hit_bar") is not None:
            losers += 1
    winners_no_sl = len(executed) - losers

    # Winner/loser definition for the S/D test:
    # Winner = reached configured R threshold BEFORE SL; loser otherwise.
    # We use `mfe_before_sl_R` which is measured only up to the first SL touch.
    try:
        winner_rr = float(req.winner_rr)
    except Exception:
        winner_rr = 1.5
    if not math.isfinite(winner_rr) or winner_rr <= 0:
        winner_rr = 1.5
    winners_by_rr = 0
    for t in executed:
        is_winner = sd_zone_trade_is_winner(t, winner_rr, be_move)
        t["winner_rr"] = winner_rr
        t["is_winner"] = bool(is_winner)
        if is_winner:
            winners_by_rr += 1
    losers_by_rr = len(executed) - winners_by_rr

    def _avg(xs: list[float]) -> float | None:
        return (sum(xs) / len(xs)) if xs else None

    def _median(xs: list[float]) -> float | None:
        if not xs:
            return None
        try:
            return float(statistics.median(xs))
        except Exception:
            return None

    def _thr_counts(th: float) -> tuple[int, float | None]:
        if not mfe_vals:
            return 0, None
        c = sum(1 for x in mfe_vals if x >= th)
        return c, c / len(mfe_vals)

    def _avg_field(field: str) -> float | None:
        xs: list[float] = []
        for t in executed:
            v = t.get(field)
            if v is None:
                continue
            try:
                f = float(v)
            except Exception:
                continue
            if math.isfinite(f):
                xs.append(f)
        return _avg(xs)

    aggregates = dict(aggregates or {})
    c1, p1 = _thr_counts(1.0)
    c15, p15 = _thr_counts(1.5)
    c2, p2 = _thr_counts(2.0)
    c3, p3 = _thr_counts(3.0)

    mae_winners: list[float] = []
    for t in executed:
        if not bool(t.get("is_winner")):
            continue
        v = t.get("mae_before_thr_R")
        if v is None:
            v = t.get("mae_R")
        try:
            f = float(v) if v is not None else float("nan")
        except Exception:
            f = float("nan")
        if math.isfinite(f):
            mae_winners.append(f)

    total_gain_r = float(winners_by_rr) * float(winner_rr)
    total_loss_r = float(losers_by_rr) * 1.0
    profit_factor_by_rr = (total_gain_r / total_loss_r) if losers_by_rr > 0 else None
    expectancy_r_by_rr = ((total_gain_r - total_loss_r) / len(executed)) if executed else None

    by_zone_type: dict[str, dict[str, Any]] = {}
    for t in executed:
        zt = str(t.get("zone_name") or "").strip()
        if not zt:
            continue
        e = by_zone_type.get(zt)
        if e is None:
            e = {"touch_count": 0, "winners": 0, "losers": 0, "total_gain_r": 0.0, "total_loss_r": 0.0}
            by_zone_type[zt] = e
        e["touch_count"] = int(e["touch_count"]) + 1
        if bool(t.get("is_winner")):
            e["winners"] = int(e["winners"]) + 1
            e["total_gain_r"] = float(e["total_gain_r"]) + float(winner_rr)
        else:
            e["losers"] = int(e["losers"]) + 1
            e["total_loss_r"] = float(e["total_loss_r"]) + 1.0
    for _zt, e in by_zone_type.items():
        n_zt = int(e.get("touch_count") or 0)
        w_zt = int(e.get("winners") or 0)
        l_zt = int(e.get("losers") or 0)
        e["win_rate_by_rr"] = (w_zt / n_zt) if n_zt > 0 else None
        e["profit_factor_by_rr"] = (float(e.get("total_gain_r") or 0.0) / float(e.get("total_loss_r") or 0.0)) if l_zt > 0 else None
        e["expectancy_r_by_rr"] = ((float(e.get("total_gain_r") or 0.0) - float(e.get("total_loss_r") or 0.0)) / n_zt) if n_zt > 0 else None
    aggregates.update(
        {
            "touch_count": len(executed),
            "avg_mfe_R": _avg(mfe_vals),
            "median_mfe_R": _median(mfe_vals),
            "avg_mae_R": _avg(mae_vals),
            "median_mae_R": _median(mae_vals),
            "avg_mae_winners_R": _avg(mae_winners),
            "num_losers": losers,
            "num_winners_no_sl": winners_no_sl,
            "winner_rr": winner_rr,
            "num_winners_by_rr": winners_by_rr,
            "num_losers_by_rr": losers_by_rr,
            "win_rate_by_rr": (winners_by_rr / len(executed)) if executed else None,
            "profit_factor_by_rr": profit_factor_by_rr,
            "expectancy_r_by_rr": expectancy_r_by_rr,
            "ge_1R": c1,
            "ge_1R_pct": p1,
            "ge_1_5R": c15,
            "ge_1_5R_pct": p15,
            "ge_2R": c2,
            "ge_2R_pct": p2,
            "ge_3R": c3,
            "ge_3R_pct": p3,
            "avg_mfe_until_opposite_bos_R": _avg_field("mfe_before_opposite_bos_R"),
            "avg_mfe_until_breakeven_or_cap_R": _avg_field("mfe_before_be_R"),
            "avg_mfe_until_loss_or_cap_R": _avg_field("mfe_before_sl_R"),
            "avg_duration_bars": _avg(dur_vals),
            "duration_timeframe": req.chart_timeframe or "native",
            "by_zone_type": by_zone_type,
        }
    )

    ohlc_df = pd.DataFrame(
        {
            "date": [_to_iso(ts) for ts in df_chart.index],
            "open": _series_as_float(df_chart, "open", "Open"),
            "high": _series_as_float(df_chart, "high", "High"),
            "low": _series_as_float(df_chart, "low", "Low"),
            "close": _series_as_float(df_chart, "close", "Close"),
        }
    )
    ohlc = ohlc_df.to_dict(orient="records")

    banner_parts = [str(x) for x in (art_hl.get("artifact_banner"), zone_tf_note) if x]
    chart_hints: dict[str, Any] = {
        "windowPadLeftBars": pad_left,
        "windowPadRightBars": pad_right,
        "windowBarCap": cap,
        "chart_timeframe": req.chart_timeframe,
        "zone_timeframe_requested": want_zone_label,
        "zone_timeframe_filter": want_zone_filter,
        "zone_timeframe_used": used_sd_c or want_zone_filter,
        "zone_tf_note": zone_tf_note,
        "artifact_banner": "; ".join(banner_parts) if banner_parts else None,
        "hl_artifact_status": art_hl.get("artifact_status"),
    }

    append_audit_event(
        action="sd_zone_test.run",
        actor_id=actor_id,
        entity="sd_zone_test",
        status="ok",
        details={"data_file": req.data_file, "trades": len(enriched), "dataset_id": dataset_id},
    )

    return _sanitize_float_json(
        {
            "ok": True,
            "dataset_id": dataset_id,
            "data_fingerprint": fp,
            # View-like payload (same semantics as /api/view)
            "markers_view": art_hl.get("markers", []),
            "lines_view": art_hl.get("lines", []),
            "zones_view": art_hl.get("zones", []),
            "ohlc": ohlc,
            # Backwards-compatible keys (older UI)
            "markers_hl": art_hl.get("markers", []),
            "lines_hl": art_hl.get("lines", []),
            "trades": enriched,
            "aggregates": aggregates,
            "chartHints": chart_hints,
            "sl_sweep": sl_sweep,
            "params_used": {
                "sl_zone_height_mult": req.sl_zone_height_mult,
                "max_mfe_R": req.max_mfe_R,
                "winner_rr": winner_rr,
                "breakeven_move_r": be_move,
                "risk_display": params.risk_display,
                "entry_price_mode": req.entry_price_mode,
            },
        }
    )
