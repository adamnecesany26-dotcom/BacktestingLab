"""
MTF Supply/Demand zone merge — shared by sd_zone_strategy and engine moduleOutputs.

Keeps Detailed chart aligned with strategy when zone_timeframes lists multiple TFs.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from app.services.data_ohlc import parse_iso_timestamp_for_index

_TF_TO_RULE = {
    "1d": "1D",
    "1D": "1D",
    "daily": "1D",
    "4h": "4h",
    "1h": "1h",
    "30m": "30min",
    "15m": "15min",
    "1w": "1W",
    "1W": "1W",
    "weekly": "1W",
    "1m": "1min",
    "1M": "1ME",
    "1mo": "1ME",
    "1MO": "1ME",
    "1month": "1ME",
}

_TF_COARSENESS = {
    "1M": 120,
    "1mo": 120,
    "1month": 120,
    "1w": 100,
    "1W": 100,
    "weekly": 100,
    "1d": 90,
    "1D": 90,
    "daily": 90,
    "4h": 70,
    "1h": 60,
    "30m": 50,
    "30min": 50,
    "15m": 40,
    "15min": 40,
}


def pandas_rule_for_zone_tf(zone_tf: str) -> str:
    z = (zone_tf or "1d").strip()
    return _TF_TO_RULE.get(z, _TF_TO_RULE.get(z.lower(), "1D"))


def tf_coarseness(tf: str) -> int:
    s = (tf or "1d").strip()
    return int(_TF_COARSENESS.get(s, _TF_COARSENESS.get(s.lower(), 50)))


def min_zone_ohlc_bars(zone_tf: str) -> int:
    """Min. počet řádků po resamplu před voláním get_zones (merge).

    Dřív pevných 30 — u ``1w`` to vyžadovalo ~30 týdnů (~7 měsíců) jen na jednom TF;
    s kratším backtestem strategie nikdy nespustila zóny (0 obchodů).

    U ``1d``: 30 blokovalo celou logiku při typickém měsíci 30m dat (~25–27 denních svící po
    resamplu) — strategie vůbec nevolala merge/get_zones. 24 odpovídá ~horní hranici „krátkého“
    měsíce; první D/S pak stejně často vyžadují ještě pár dalších dní dat (viz get_zones).
    """
    z = (zone_tf or "1d").strip().lower()
    if z in ("1w", "weekly"):
        return 12
    if z in ("1d", "daily"):
        return 24
    return 30


def parse_zone_timeframes_dict(strategy_params: dict[str, Any] | None) -> list[str]:
    """Parse zone_timeframes from flat strategy_params dict (engine / JSON). Missing → []."""
    if not strategy_params or not isinstance(strategy_params, dict):
        return []
    ts = strategy_params.get("zone_timeframes")
    if isinstance(ts, list):
        out = [str(x).strip() for x in ts if str(x).strip()]
        if out:
            return out
    if ts is not None and str(ts).strip():
        s = str(ts).strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                parsed = json.loads(s.replace("'", '"'))
                if isinstance(parsed, list):
                    out = [str(x).strip() for x in parsed if str(x).strip()]
                    if out:
                        return out
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        parts = [p.strip() for p in s.split(",") if p.strip()]
        if parts:
            return parts
    zt = strategy_params.get("zone_timeframe")
    if zt is not None and str(zt).strip():
        return [str(zt).strip()]
    return []


def resample_to_zone_tf(exec_df: pd.DataFrame, zone_tf: str) -> pd.DataFrame:
    if exec_df.empty:
        return exec_df
    rule = pandas_rule_for_zone_tf(zone_tf)
    agg = {
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
    }
    out = exec_df.resample(rule, label="left", closed="left").agg(agg).dropna(how="any")
    return out


def merged_zone_key(z: dict, primary_tf: str, merged_tfs: list[str]) -> str:
    zl, zh = float(z["value_low"]), float(z["value_high"])
    nm = z.get("name", "")
    tfs = ",".join(sorted(merged_tfs))
    return f"{nm}|{primary_tf}|{tfs}|{zl:.6g}|{zh:.6g}"


def zones_price_overlap_ratio(z1: dict, z2: dict) -> float:
    zl1, zh1 = float(z1["value_low"]), float(z1["value_high"])
    zl2, zh2 = float(z2["value_low"]), float(z2["value_high"])
    w1, w2 = zh1 - zl1, zh2 - zl2
    if w1 <= 0 or w2 <= 0:
        return 0.0
    ov = max(0.0, min(zh1, zh2) - max(zl1, zl2))
    return ov / min(w1, w2)


def cluster_tagged_zones(
    tagged: list[tuple[dict, str, int]], name: str, overlap_threshold: float
) -> list[list[tuple[dict, str, int]]]:
    same = [(z, tf, d) for z, tf, d in tagged if z.get("name") == name]
    clusters: list[list[tuple[dict, str, int]]] = []
    used: set[int] = set()
    for i, item in enumerate(same):
        if i in used:
            continue
        cl = [item]
        used.add(i)
        growing = True
        while growing:
            growing = False
            for j, item2 in enumerate(same):
                if j in used:
                    continue
                z2 = item2[0]
                for zc, _, _ in cl:
                    if zones_price_overlap_ratio(zc, z2) >= overlap_threshold:
                        cl.append(item2)
                        used.add(j)
                        growing = True
                        break
        clusters.append(cl)
    return clusters


def pick_cluster_representative(
    cluster: list[tuple[dict, str, int]], prefer_higher_tf: bool
) -> tuple[dict, str, int]:
    def key(item: tuple[dict, str, int]) -> int:
        c = tf_coarseness(item[1])
        return -c if prefer_higher_tf else c

    best = min(cluster, key=key)
    return best


def build_merged_sd_zones(
    exec_df: pd.DataFrame,
    timeframes: list[str],
    get_zones_fn: Callable[..., list[dict[str, Any]]],
    module_params_fn: Callable[[str], dict[str, Any]],
    prefer_higher_tf: bool,
    overlap_threshold: float,
    *,
    get_zones_cached: Any | None = None,
    sd_cache: dict | None = None,
    cache_dir: Path | None = None,
    data_fingerprint: str | None = None,
    disk_cache_enabled: bool = True,
) -> tuple[list[dict], list[dict]]:
    """
    Same contract sd_zone_strategy._build_merged_sd_zones.
    If get_zones_cached is provided (e.g. get_sd_zones_cached), it is invoked with zone_tf, mem_cache, etc.
    """
    tagged: list[tuple[dict, str, int]] = []
    flat_sd: list[dict] = []
    for tf in timeframes:
        zoh = resample_to_zone_tf(exec_df, tf)
        need = min_zone_ohlc_bars(tf)
        if zoh.empty or len(zoh) < need:
            continue
        mp = module_params_fn(tf)
        if get_zones_cached is not None:
            mem = sd_cache if sd_cache is not None else {}
            zones = get_zones_cached(
                get_zones_fn,
                zoh,
                mp,
                zone_tf=tf,
                mem_cache=mem,
                cache_dir=cache_dir,
                data_fingerprint=data_fingerprint,
                disk_enabled=disk_cache_enabled,
            )
        else:
            zones = get_zones_fn(zoh, mp)
        d_idx = len(zoh) - 1
        for z in zones:
            if z.get("name") not in ("Demand", "Supply"):
                continue
            zf = dict(z)
            zf["_source_tf"] = tf
            flat_sd.append(zf)
            si, ei = z.get("start_idx"), z.get("end_idx")
            if si is None or ei is None:
                continue
            if int(si) <= d_idx <= int(ei):
                zc = dict(z)
                zc["_source_tf"] = tf
                tagged.append((zc, tf, d_idx))

    merged: list[dict] = []
    for nm in ("Demand", "Supply"):
        for cluster in cluster_tagged_zones(tagged, nm, overlap_threshold):
            rep_z, rep_tf, rep_d = pick_cluster_representative(cluster, prefer_higher_tf)
            merged_tfs = sorted({t for _, t, _ in cluster})
            out = dict(rep_z)
            out["_primary_tf"] = rep_tf
            out["_merged_tfs"] = merged_tfs
            out["_d_idx"] = rep_d
            merged.append(out)
    return merged, flat_sd


def coarsest_zone_tf(timeframes: list[str]) -> str | None:
    if not timeframes:
        return None
    return max(timeframes, key=tf_coarseness)


def _artifact_iso_to_zoh_idx(zoh: pd.DataFrame, iso_val: Any) -> int | None:
    if zoh is None or zoh.empty:
        return None
    if iso_val is None or (isinstance(iso_val, float) and pd.isna(iso_val)):
        return None
    s = str(iso_val).strip()
    if not s:
        return None
    idx = zoh.index
    if not isinstance(idx, pd.DatetimeIndex):
        return None
    ts = parse_iso_timestamp_for_index(idx, s)
    if ts is None:
        return None
    try:
        pos = int(idx.searchsorted(ts, side="left"))
        return int(min(max(0, pos), len(idx) - 1))
    except Exception:
        return None


def zone_dict_from_artifact_row(zoh: pd.DataFrame, row: Any) -> dict[str, Any] | None:
    """
    Řádek z ``zones.parquet`` → tvar očekávaný ``sd_zone_strategy`` / ``cluster_tagged_zones``.
    Indexy jsou vůči aktuálnímu ``zoh`` (prefix ``exec_df``), remap přes ISO časy.
    """
    kind = str(row.get("kind", "")).strip().lower()
    name = "Demand" if kind == "demand" else "Supply" if kind == "supply" else ""
    if not name:
        return None

    born = row.get("born_at")
    rs = row.get("range_start_at") or born
    re = row.get("range_end_at") or born
    if (not rs or str(rs).strip() == "") and born:
        rs = born
    if (not re or str(re).strip() == "") and born:
        re = born

    piv = _artifact_iso_to_zoh_idx(zoh, born)
    si = _artifact_iso_to_zoh_idx(zoh, rs)
    ei = _artifact_iso_to_zoh_idx(zoh, re)
    if piv is None or si is None or ei is None:
        return None
    if si > ei:
        si, ei = ei, si

    vl = float(row.get("price_low", 0.0))
    vh = float(row.get("price_high", 0.0))
    touch1 = row.get("touch1_at")
    has_touch = bool(touch1 and str(touch1).strip())
    touch2_raw = row.get("touch2_at")
    has_touch2 = bool(touch2_raw and str(touch2_raw).strip())
    has_ind = bool(row.get("has_inducement", False))
    try:
        impulse_score = float(row.get("impulse_score", 0) or 0.0)
    except (TypeError, ValueError):
        impulse_score = 0.0
    try:
        base_length = int(row.get("base_length", 0) or 0)
    except (TypeError, ValueError):
        base_length = 0

    ip_inline = row.get("inducement_points")
    try:
        inducement_points = int(ip_inline) if ip_inline is not None and str(ip_inline).strip() != "" else (2 if has_ind else 0)
    except (TypeError, ValueError):
        inducement_points = 2 if has_ind else 0

    fill = "rgba(34, 197, 94, 0.25)" if name == "Demand" else "rgba(239, 68, 68, 0.25)"
    try:
        ds = str(pd.Timestamp(rs).date())
        de = str(pd.Timestamp(re).date())
    except Exception:
        ds, de = "", ""

    zd: dict[str, Any] = {
        "name": name,
        "value_low": vl,
        "value_high": vh,
        "start_idx": si,
        "end_idx": ei,
        "pivot_idx": piv,
        "fillcolor": fill,
        "base_length": base_length,
        "impulse_score": int(round(impulse_score)) if math.isfinite(impulse_score) else 0,
        "has_touch": has_touch,
        "has_touch2": has_touch2,
        "bos_origin": "artifact",
        "zone_origin": "artifact",
        "inducement_count": 1 if has_ind else 0,
        "inducement_points": inducement_points,
        "inducements": [],
        "date_start": ds,
        "date_end": de,
    }
    if has_touch and row.get("touch1_price") is not None:
        try:
            zd["touch_marker_price"] = float(row.get("touch1_price"))
        except (TypeError, ValueError):
            pass
    if row.get("with_trend") is True:
        zd["_artifact_with_trend"] = True
    return zd


def build_merged_sd_zones_from_artifact(
    exec_df: pd.DataFrame,
    timeframes: list[str],
    zones_df: pd.DataFrame,
    prefer_higher_tf: bool,
    overlap_threshold: float,
    *,
    only_with_trend: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Stejné API jako ``build_merged_sd_zones``, ale vstup = předpočítané zóny (Parquet z fáze 3).
    """
    from app.services.hl_artifact_spec import canonical_precompute_tf as _can_tf

    if zones_df is None or zones_df.empty:
        return [], []
    tagged: list[tuple[dict[str, Any], str, int]] = []
    flat_sd: list[dict[str, Any]] = []
    for tf in timeframes:
        zoh = resample_to_zone_tf(exec_df, tf)
        need = min_zone_ohlc_bars(tf)
        if zoh.empty or len(zoh) < need:
            continue
        ctf = _can_tf(tf) or str(tf).strip()
        d_idx = len(zoh) - 1
        for _, row in zones_df.iterrows():
            if bool(only_with_trend) and not bool(row.get("with_trend", False)):
                continue
            stf = _can_tf(str(row.get("source_tf", ""))) or str(row.get("source_tf", "")).strip()
            if stf != ctf:
                continue
            zd = zone_dict_from_artifact_row(zoh, row)
            if zd is None:
                continue
            zcopy = dict(zd)
            zcopy["_source_tf"] = str(tf)
            flat_sd.append(zcopy)
            si, ei = zcopy.get("start_idx"), zcopy.get("end_idx")
            if si is None or ei is None:
                continue
            if int(si) <= d_idx <= int(ei):
                zc = dict(zcopy)
                zc["_source_tf"] = str(tf)
                tagged.append((zc, str(tf), d_idx))

    merged: list[dict[str, Any]] = []
    for nm in ("Demand", "Supply"):
        for cluster in cluster_tagged_zones(tagged, nm, overlap_threshold):
            rep_z, rep_tf, rep_d = pick_cluster_representative(cluster, prefer_higher_tf)
            merged_tfs = sorted({str(t) for _, t, _ in cluster})
            out = dict(rep_z)
            out["_primary_tf"] = rep_tf
            out["_merged_tfs"] = merged_tfs
            out["_d_idx"] = rep_d
            merged.append(out)
    return merged, flat_sd
