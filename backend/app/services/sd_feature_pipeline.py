"""
Supply/Demand feature extraction for fast execution paths + on-disk cache.

Produces compact numpy structures from get_zones() output. Full sd_zone_strategy parity
lives in the Backtrader engine; this bundle feeds Numba / research loops.
"""

from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import os
import pickle
from pathlib import Path
from typing import Any, Callable

import numpy as np

from app.services.data_ohlc import fingerprint_parquet


def _sd_zones_cache_hmac_key() -> bytes:
    k = str(os.environ.get("CACHE_HMAC_KEY", "") or "").strip()
    if k:
        return k.encode("utf-8")
    return b"dev-insecure-sd-zones-cache"


def _sd_zones_sign_pickle(blob: bytes) -> bytes:
    sig = hmac.new(_sd_zones_cache_hmac_key(), blob, hashlib.sha256).hexdigest()
    return sig.encode("ascii") + b"\n" + blob


def _sd_zones_try_load_signed(raw: bytes) -> list | None:
    if len(raw) < 66 or raw[64:65] != b"\n":
        return None
    try:
        sig = raw[:64].decode("ascii")
    except UnicodeDecodeError:
        return None
    if len(sig) != 64 or any(c not in "0123456789abcdef" for c in sig):
        return None
    blob = raw[65:]
    exp = hmac.new(_sd_zones_cache_hmac_key(), blob, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, exp):
        return None
    try:
        obj = pickle.loads(blob)
    except Exception:
        return None
    return obj if isinstance(obj, list) else None


def feature_cache_key(
    *,
    data_fingerprint: str,
    zone_tf: str,
    params_digest: str,
    impl_digest: str = "",
) -> str:
    raw = f"{data_fingerprint}|{zone_tf}|{params_digest}|{impl_digest}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def get_zones_callable_digest(fn: Callable[..., Any]) -> str:
    """Short stable id for the get_zones implementation (invalidates cache when source changes)."""
    try:
        src = inspect.getsource(fn)
    except (OSError, TypeError):
        src = f"{getattr(fn, '__qualname__', '')}|{getattr(fn, '__module__', '')}|{id(fn)}"
    return hashlib.sha256(src.encode("utf-8", errors="replace")).hexdigest()[:16]


def sd_zones_series_tail_hash(n_bars: int, last_index_iso: str) -> str:
    """Short stable id for resampled length + last bar (causal prefix key)."""
    raw = f"{int(n_bars)}\x00{last_index_iso}".encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:20]


def sd_zones_disk_cache_path(
    cache_dir: Path,
    *,
    data_fingerprint: str,
    zone_tf: str,
    params_digest: str,
    impl_digest: str,
    n_bars: int,
    last_index_iso: str,
) -> Path:
    base = feature_cache_key(
        data_fingerprint=data_fingerprint,
        zone_tf=str(zone_tf),
        params_digest=params_digest,
        impl_digest=impl_digest,
    )
    tail = sd_zones_series_tail_hash(n_bars, last_index_iso)
    return cache_dir / "features" / f"sd_zones_{base}_{tail}.pkl"


def get_sd_zones_cached(
    get_zones_fn: Callable[..., list[dict[str, Any]]],
    zone_ohlc,
    module_params: dict[str, Any] | None,
    *,
    zone_tf: str,
    mem_cache: dict[tuple[str, str, int, str], list[dict[str, Any]]] | None,
    cache_dir: Path | None,
    data_fingerprint: str | None,
    disk_enabled: bool = True,
) -> list[dict[str, Any]]:
    """
    Memoize + optional disk cache for get_zones(zone_ohlc, params).

    Key includes zone TF, params digest, get_zones source digest, resampled bar count and last index.
    """
    mp = module_params or {}
    digest = params_digest(mp)
    impl_d = get_zones_callable_digest(get_zones_fn)
    n = len(zone_ohlc) if hasattr(zone_ohlc, "__len__") else 0
    try:
        last_ix = zone_ohlc.index[-1] if n > 0 else None
        last_iso = last_ix.isoformat() if hasattr(last_ix, "isoformat") else str(last_ix or "")
    except Exception:
        last_iso = ""
    mem_k = (str(zone_tf), digest, impl_d, int(n), last_iso)
    if mem_cache is not None and mem_k in mem_cache:
        return mem_cache[mem_k]

    path: Path | None = None
    if (
        disk_enabled
        and cache_dir is not None
        and data_fingerprint
        and str(os.environ.get("SD_ZONE_DISK_CACHE", "1")).strip().lower()
        not in ("0", "false", "no", "off")
    ):
        path = sd_zones_disk_cache_path(
            cache_dir,
            data_fingerprint=data_fingerprint,
            zone_tf=str(zone_tf),
            params_digest=digest,
            impl_digest=impl_d,
            n_bars=int(n),
            last_index_iso=last_iso,
        )
        if path.is_file():
            try:
                raw = path.read_bytes()
                zones = _sd_zones_try_load_signed(raw)
                if zones is None:
                    zones = pickle.loads(raw)
                if isinstance(zones, list) and mem_cache is not None:
                    mem_cache[mem_k] = zones
                return zones if isinstance(zones, list) else []
            except Exception:
                pass

    zones = get_zones_fn(zone_ohlc, mp)
    if not isinstance(zones, list):
        zones = []
    if mem_cache is not None:
        mem_cache[mem_k] = zones
    if path is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            blob = pickle.dumps(zones, protocol=4)
            path.write_bytes(_sd_zones_sign_pickle(blob))
        except Exception:
            pass
    return zones


def params_digest(params: dict[str, Any] | None) -> str:
    p = params or {}
    blob = json.dumps(p, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def zones_to_interval_arrays(
    zones: list[dict[str, Any]],
    n_exec_bars: int,
) -> dict[str, np.ndarray]:
    """
    Convert module zone dicts to parallel arrays (indices in exec-bar space when
    start_idx/end_idx refer to the same frame as n_exec_bars).
    """
    if not zones:
        return {
            "start_idx": np.zeros(0, dtype=np.int32),
            "end_idx": np.zeros(0, dtype=np.int32),
            "pivot_idx": np.zeros(0, dtype=np.int32),
            "low": np.zeros(0, dtype=np.float64),
            "high": np.zeros(0, dtype=np.float64),
            "is_demand": np.zeros(0, dtype=np.int8),
        }
    starts: list[int] = []
    ends: list[int] = []
    pivots: list[int] = []
    lows: list[float] = []
    highs: list[float] = []
    dem: list[int] = []
    for z in zones:
        nm = str(z.get("name", ""))
        if nm not in ("Demand", "Supply"):
            continue
        si = z.get("start_idx")
        ei = z.get("end_idx")
        if si is None or ei is None:
            continue
        starts.append(int(si))
        ends.append(int(ei))
        pivots.append(int(z.get("pivot_idx", z.get("end_idx", ei))))
        lows.append(float(z.get("value_low", z.get("low", 0.0))))
        highs.append(float(z.get("value_high", z.get("high", 0.0))))
        dem.append(1 if nm == "Demand" else 0)
    return {
        "start_idx": np.asarray(starts, dtype=np.int32),
        "end_idx": np.asarray(ends, dtype=np.int32),
        "pivot_idx": np.asarray(pivots, dtype=np.int32),
        "low": np.asarray(lows, dtype=np.float64),
        "high": np.asarray(highs, dtype=np.float64),
        "is_demand": np.asarray(dem, dtype=np.int8),
    }


def save_feature_bundle(path: Path, **arrays: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **arrays)


def load_feature_bundle(path: Path) -> dict[str, np.ndarray] | None:
    if not path.is_file():
        return None
    try:
        with np.load(path, allow_pickle=False) as z:
            return {k: np.array(z[k]) for k in z.files}
    except Exception:
        return None


def load_or_compute_sd_zone_arrays(
    *,
    cache_dir: Path,
    data_path: Path,
    zone_tf: str,
    module_params: dict[str, Any] | None,
    get_zones_fn: Callable[..., list[dict[str, Any]]],
    zone_ohlc,  # pandas DataFrame
) -> dict[str, np.ndarray]:
    """
    Return interval arrays; use disk cache when key matches.
    """
    fp = fingerprint_parquet(data_path)
    digest = params_digest(module_params)
    impl_d = get_zones_callable_digest(get_zones_fn)
    key = feature_cache_key(data_fingerprint=fp, zone_tf=zone_tf, params_digest=digest, impl_digest=impl_d)
    cache_file = cache_dir / "features" / f"sd_zones_{key}.npz"
    cached = load_feature_bundle(cache_file)
    if cached is not None and "low" in cached:
        return cached
    zones = get_zones_fn(zone_ohlc, module_params)
    if not isinstance(zones, list):
        zones = []
    n = len(zone_ohlc) if hasattr(zone_ohlc, "__len__") else 0
    bundle = zones_to_interval_arrays(zones, int(n))
    save_feature_bundle(cache_file, **bundle)
    return bundle
