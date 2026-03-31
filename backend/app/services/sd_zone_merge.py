"""
MTF Supply/Demand zone merge — shared by sd_zone_strategy and engine moduleOutputs.

Keeps Detailed chart aligned with strategy when zone_timeframes lists multiple TFs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import pandas as pd

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
}

_TF_COARSENESS = {
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
