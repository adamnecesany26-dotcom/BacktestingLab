"""
View fáze 5: H/L + S/D vrstvy z lokálních artefaktů (.backtest_artifacts) bez přepočtu modulů.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import pandas as pd

from app.services import artifact_store
from app.services.data_ohlc import (
    fingerprint_dataset_file,
    parse_iso_timestamp_for_index,
    resolve_safe_data_path,
)
from app.services.sd_zone_merge import zone_dict_from_artifact_row

# Minuty řady TF — výběr artefaktu při nativním grafu a fallbacku (sjednoceno se Swing_HL._infer_data_timeframe).
_ARTIFACT_TF_MINUTES: dict[str, float] = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
    "1w": 10080,
    "1M": 43200,
}


def _float_or_none(x: Any) -> float | None:
    """Konečné číslo vhodné do JSON (žádné nan/inf). Jinak None → řádek přeskočit."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return v


def _json_safe_float(x: Any, default: float = 0.0) -> float:
    v = _float_or_none(x)
    return v if v is not None else default


def _impulse_score_as_int(zd: dict[str, Any]) -> int:
    """Artefakt může mít nan — JSON nesmí."""
    raw = zd.get("impulse_score")
    if raw is None:
        return 0
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    f = _float_or_none(raw)
    return int(round(f)) if f is not None else 0


def _to_iso(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    try:
        return pd.Timestamp(value).isoformat()
    except Exception:
        return str(value)


def _view_chart_tf_to_artifact_tf_key(chart_tf_normalized: str | None) -> str | None:
    """View klíče (1Mo, 1W, 1D, …) -> klíče adresářů precomputu (1M, 1w, 1d, …)."""
    if not chart_tf_normalized:
        return None
    s = str(chart_tf_normalized).strip()
    if s == "1Mo":
        return "1M"
    if s == "1W":
        return "1w"
    if s == "1D":
        return "1d"
    low = s.lower()
    if low in ("1m", "5m", "15m", "30m", "4h", "1h"):
        return low
    return s.replace("/", "_")


def _median_bar_gap_minutes(idx: pd.DatetimeIndex) -> float | None:
    if idx is None or len(idx) < 2:
        return None
    delta_min = pd.Series(idx).diff().dt.total_seconds() / 60.0
    valid = delta_min[(delta_min > 0) & (delta_min < 60 * 48)]
    if len(valid) > 0:
        return float(valid.median())
    pos = delta_min[delta_min > 0]
    if len(pos) == 0:
        return None
    return float(pos.median())


def _infer_native_tf_key_from_chart_index(chart_index: pd.DatetimeIndex) -> str | None:
    """Když View pošle chart_timeframe=null (nativní svíčky), odvodit odpovídající klíč artefaktu."""
    minutes = _median_bar_gap_minutes(chart_index)
    if minutes is None:
        return None
    if minutes <= 1.5:
        return "1m"
    if minutes <= 7:
        return "5m"
    if minutes <= 22:
        return "15m"
    if minutes <= 45:
        return "30m"
    if minutes <= 90:
        return "1h"
    if minutes <= 720:
        return "4h"
    if minutes <= 4320:
        return "1d"
    if minutes <= 20160:
        return "1w"
    return "1M"


def _resolve_want_hl_artifact_tf_key(
    chart_tf_normalized: str | None, chart_index: pd.DatetimeIndex
) -> str | None:
    mapped = _view_chart_tf_to_artifact_tf_key(chart_tf_normalized)
    if mapped is not None:
        return mapped
    return _infer_native_tf_key_from_chart_index(chart_index)


def _pick_hl_tf_key(manifest: dict[str, Any], want_key: str | None) -> str | None:
    """
    Vybere klíč TF v H/L manifestu.

    Dříve při ``chart_tf_normalized is None`` (nativní graf) nebo chybějícím přesném klíči (např. 30m v manifestu)
    stačilo vzít **první** položku žebříčku → typicky ``1M``, takže na denním grafu skoro žádné swiny / špatné ceny.
    """
    arts: dict[str, Any] = manifest.get("artifacts") or {}
    if not arts:
        return None
    if want_key and want_key in arts:
        return want_key
    # Zastaralé / ruční manifesty mohly použít klíče ve stylu View (1D, 1W) místo precompute (1d, 1w).
    if want_key:
        for rel in (
            want_key.upper(),
            want_key.lower(),
            "1D" if want_key == "1d" else None,
            "1W" if want_key == "1w" else None,
            "1H" if want_key == "1h" else None,
            "4H" if want_key == "4h" else None,
        ):
            if rel and rel in arts:
                return str(rel)

    want_min = float(_ARTIFACT_TF_MINUTES.get(want_key, 0) or 0) if want_key else 0.0
    with_minutes = [
        (k, float(_ARTIFACT_TF_MINUTES[k])) for k in arts if k in _ARTIFACT_TF_MINUTES
    ]
    with_minutes.sort(key=lambda t: t[1])
    candidates = [k for k, _ in with_minutes]
    if not candidates:
        return str(next(iter(arts.keys())))
    if want_min <= 0:
        return candidates[0]
    for c in candidates:
        if _ARTIFACT_TF_MINUTES[c] >= want_min - 1e-6:
            return c
    return candidates[-1]


def _coerce_ts_for_chart_index(idx: pd.DatetimeIndex, cell: Any) -> pd.Timestamp | None:
    """
    Hodnota ``iso_time`` z Parquetu může být str, datetime64, Timestamp; špatný převod na str
    dříve rozbil ``_iso_within_index`` → téměř žádné markery při shodné délce řady jako při precomputu.
    """
    if cell is None:
        return None
    if isinstance(cell, float) and (math.isnan(cell) or not math.isfinite(cell)):
        return None
    try:
        if isinstance(cell, str):
            raw = cell.strip()
            if not raw or raw.lower() in ("nat", "none"):
                return None
            iso_s = raw
        else:
            t0 = pd.Timestamp(cell)
            if pd.isna(t0):
                return None
            iso_s = t0.isoformat()
    except (TypeError, ValueError, OSError):
        return None
    return parse_iso_timestamp_for_index(idx, iso_s)


def _slack_seconds_for_chart_index(idx: pd.DatetimeIndex) -> float:
    """Povolený posun času oproti min/max grafu (TZ / session / víkendové mezery u denních dat)."""
    gap_min = float(_median_bar_gap_minutes(idx) or 1440.0)
    # Min. ~45 dní: jinak u reálných futures (posun vs. label svíčky) vypadne téměř všechen obsah swings.
    return max(4.0 * 3600.0, 2.0 * gap_min * 60.0, 45.0 * 86400.0)


def _artifact_ts_usable_on_chart(idx: pd.DatetimeIndex, cell: Any) -> pd.Timestamp | None:
    """
    Parsovat čas z artefaktu a pokud leží těsně před první / za poslední svíčkou, přitáhnout na okraj.
    Jinak markery často vypadnou všechny kromě jednoho „náhodného“ zásahu.
    """
    ts = _coerce_ts_for_chart_index(idx, cell)
    if ts is None or idx is None or idx.empty:
        return None
    try:
        t0, t1 = idx.min(), idx.max()
        slack = _slack_seconds_for_chart_index(idx)
        if t0 <= ts <= t1:
            return ts
        if ts < t0:
            if (t0 - ts).total_seconds() <= slack:
                return pd.Timestamp(t0)
            return None
        if (ts - t1).total_seconds() <= slack:
            return pd.Timestamp(t1)
        return None
    except Exception:
        return None


def _ts_within_index(idx: pd.DatetimeIndex, ts: pd.Timestamp | None) -> bool:
    if ts is None or idx is None or idx.empty:
        return False
    try:
        return bool(idx.min() <= ts <= idx.max())
    except Exception:
        return False


def _iso_within_index(idx: pd.DatetimeIndex, iso_s: str) -> bool:
    ts = parse_iso_timestamp_for_index(idx, iso_s)
    return _ts_within_index(idx, ts)


def _ts_to_chart_bar_index(idx: pd.DatetimeIndex, ts: pd.Timestamp) -> int | None:
    try:
        pos = int(idx.searchsorted(ts, side="left"))
        return int(min(max(0, pos), len(idx) - 1))
    except Exception:
        return None


def _iso_to_chart_bar_index(idx: pd.DatetimeIndex, iso_s: str) -> int | None:
    ts = parse_iso_timestamp_for_index(idx, iso_s)
    if ts is None:
        return None
    return _ts_to_chart_bar_index(idx, ts)


def _safe_bar_index_for_chart(raw: Any, chart_len: int) -> int | None:
    if chart_len <= 0:
        return None
    if raw is None:
        return None
    try:
        if isinstance(raw, float) and pd.isna(raw):
            return None
        b = int(raw)
    except (TypeError, ValueError):
        return None
    if 0 <= b < chart_len:
        return b
    return None


def _normalize_hl_parquet_df(df: pd.DataFrame | None) -> pd.DataFrame | None:
    """Odstraní BOM / mezery v názvech sloupců z externích Parquet."""
    if df is None or df.empty:
        return df
    out = df.copy()
    out.columns = [str(c).strip().lstrip("\ufeff").strip('"').strip() for c in out.columns]
    return out


def _row_iso_like(row: pd.Series) -> Any:
    for k in ("iso_time", "iso", "timestamp", "time", "date", "Date"):
        if k not in row.index:
            continue
        v = row[k]
        if v is None:
            continue
        if isinstance(v, float) and pd.isna(v):
            continue
        if isinstance(v, str) and not str(v).strip():
            continue
        return v
    return None


def _row_price_like(row: pd.Series) -> Any:
    for k in ("price", "Price", "px", "value"):
        if k not in row.index:
            continue
        v = row[k]
        if v is None:
            continue
        if isinstance(v, float) and pd.isna(v):
            continue
        return v
    return None


def _row_bos_time(row: pd.Series) -> Any:
    for k in ("bos_date", "date", "bos_time", "iso_time", "timestamp"):
        if k not in row.index:
            continue
        v = row[k]
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if isinstance(v, str) and not str(v).strip():
            continue
        return v
    return None


def _hl_row_bar_index(
    chart_index: pd.DatetimeIndex,
    iso_cell: Any,
    bi_adj: int | None,
    chart_len: int,
) -> int | None:
    """
    Swing/BOS/trend řádek → index baru na aktuálním df_chart.
    Pořadí: **platný bar_index (po offsetu)** → čas ze souboru → syrový čas oříznutý do [min,max].

    Dříve měl čas přednost — špatně parsované / nesouvisející `iso_time` z Parquetu pak uměly
    `searchsorted` shodit tisíce řádků na jeden bar (stejné datum na grafu i v „Values“).
    """
    bi_cand = _safe_bar_index_for_chart(bi_adj, chart_len) if bi_adj is not None else None
    if bi_cand is not None:
        return bi_cand
    ts_use = _artifact_ts_usable_on_chart(chart_index, iso_cell)
    if ts_use is not None:
        return _ts_to_chart_bar_index(chart_index, ts_use)
    # Dříve zde běžel fallback: tclip = clamp(ts_raw, t0, t1) → searchsorted. Časy z artefaktu
    # **před** začátkem viditelného okna pak vždy skončily na t0 → jeden bar (první svíčka),
    # stejné datum u stovek markerů ve Values i na grafu.
    return None


def _legacy_bar_count_from_trend_parquet(hl_dir: Path, arts: dict[str, Any]) -> int | None:
    """
    Starší manifesty bez ``bar_count``: trend Parquet má při precomputu jeden řádek na svíčku TF
    → ``len(df)`` odpovídá délce řady použité pro swingy.
    """
    tr = arts.get("trend")
    if not tr:
        return None
    p = hl_dir / str(tr)
    if not p.is_file():
        return None
    try:
        tdf = pd.read_parquet(p)
        n = int(len(tdf))
        return n if n > 0 else None
    except Exception:
        return None


def _suffix_bar_index_offset(
    artifact_bar_count: int | None,
    chart_len: int,
    start_iso: str | None,
    end_iso: str | None,
) -> int:
    """
    Precompute běží na celé sérii → ``bar_index`` v Parquetu je globální od 0.
    View často načte jen posledních N let (řez od konce jako ``_load_ohlc``).
    Offset = počet barů „useknutých“ zleva, aby globální index šel přemapovat na aktuální ``df_chart``.

    Při vlastním ISO okně (start/end) offset neaplikujeme — spoléháme na časovou mapu.
    """
    if start_iso and str(start_iso).strip():
        return 0
    if end_iso and str(end_iso).strip():
        return 0
    if not artifact_bar_count or chart_len <= 0:
        return 0
    if chart_len > int(artifact_bar_count):
        return 0
    return max(0, int(artifact_bar_count) - chart_len)


def _normalize_hl_marker_type(raw: str, role: str) -> str:
    t = str(raw or "").strip().lower()
    if role == "internal" and t in ("high", "low"):
        return f"internal_{t}"
    if role == "major" and t in ("high", "low"):
        return f"major_{t}"
    return t


def _ohlc_high_low_at_i(df: pd.DataFrame, i: int) -> tuple[float | None, float | None]:
    """Vrátí (high, low) i-tého řádku ``df_chart`` jako finitní floaty nebo (None, None)."""
    if df is None or i < 0 or i >= len(df):
        return None, None
    try:
        row = df.iloc[i]
    except Exception:
        return None, None
    hi: float | None = None
    lo: float | None = None
    for hk in ("high", "High"):
        if hk in row.index:
            hi = _float_or_none(row[hk])
            break
    for lk in ("low", "Low"):
        if lk in row.index:
            lo = _float_or_none(row[lk])
            break
    return hi, lo


def _sync_hl_marker_price_to_ohlc_bar(
    ohlc_df: pd.DataFrame | None,
    bi: int,
    marker_type: str,
    price: float,
) -> float:
    """
    Cena z Parquet může být z jiného měřítka / starší série než aktuální ``df_chart`` v View
    (uživatel viděl swingy „u levé osy“ ve špatné výšce při správném X). Pro H/L rodiny
    vezmeme extrém přímo z načteného OHLC na namapovaném baru.
    """
    if ohlc_df is None:
        return price
    hi, lo = _ohlc_high_low_at_i(ohlc_df, bi)
    t = str(marker_type).lower()
    if t in ("high", "major_high", "internal_high") and hi is not None:
        return hi
    if t in ("low", "major_low", "internal_low") and lo is not None:
        return lo
    return price


def _markers_from_hl_parquet(
    df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
    role: str,
    *,
    bar_index_offset: int = 0,
    ohlc_df: pd.DataFrame | None = None,
) -> list[dict[str, Any]]:
    df = _normalize_hl_parquet_df(df)
    if df is None or df.empty or chart_index.empty:
        return []
    n = len(chart_index)
    off = max(0, int(bar_index_offset))
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rs = row if isinstance(row, pd.Series) else pd.Series(row)
        iso_cell = _row_iso_like(rs)
        bi_raw = rs.get("bar_index")
        bi_adj: int | None = None
        if bi_raw is not None:
            try:
                if not (isinstance(bi_raw, float) and pd.isna(bi_raw)):
                    bi_adj = int(bi_raw) - off
            except (TypeError, ValueError):
                bi_adj = None

        bi_final = _hl_row_bar_index(chart_index, iso_cell, bi_adj, n)

        if bi_final is None:
            continue

        t = _normalize_hl_marker_type(str(rs.get("type") or ""), role)
        price = _float_or_none(_row_price_like(rs))
        if price is None:
            continue
        price = _sync_hl_marker_price_to_ohlc_bar(ohlc_df, bi_final, t, price)
        mk = {"date": _to_iso(chart_index[bi_final]), "type": t, "value": price, "bar_index": bi_final}
        out.append(mk)
    return out


def _markers_from_bos_df(
    df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
    *,
    bar_index_offset: int = 0,
) -> list[dict[str, Any]]:
    df = _normalize_hl_parquet_df(df)
    if df is None or df.empty or chart_index.empty:
        return []
    n = len(chart_index)
    off = max(0, int(bar_index_offset))
    out: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rs = row if isinstance(row, pd.Series) else pd.Series(row)
        iso_cell = _row_bos_time(rs)
        bi_raw = rs.get("bos_index")
        if bi_raw is None:
            bi_raw = rs.get("swing_index")
        bi_adj: int | None = None
        if bi_raw is not None:
            try:
                if not (isinstance(bi_raw, float) and pd.isna(bi_raw)):
                    bi_adj = int(bi_raw) - off
            except (TypeError, ValueError):
                bi_adj = None

        bi = _hl_row_bar_index(chart_index, iso_cell, bi_adj, n)
        if bi is None:
            continue

        t = str(rs.get("type") or "bos_bullish").strip().lower()
        if t not in ("bos_bullish", "bos_bearish"):
            t = "bos_bullish"
        level = _float_or_none(rs.get("level"))
        if level is None:
            continue
        out.append({"date": _to_iso(chart_index[bi]), "type": t, "value": level, "bar_index": bi})
    return out


def _trend_line_from_df(
    df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
    *,
    bar_index_offset: int = 0,
) -> dict[str, Any] | None:
    df = _normalize_hl_parquet_df(df)
    if df is None or df.empty or chart_index.empty:
        return None
    n = len(chart_index)
    off = max(0, int(bar_index_offset))
    pts: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rs = row if isinstance(row, pd.Series) else pd.Series(row)
        iso_cell = _row_iso_like(rs)
        bi_raw = rs.get("bar_index")
        bi_adj: int | None = None
        if bi_raw is not None:
            try:
                if not (isinstance(bi_raw, float) and pd.isna(bi_raw)):
                    bi_adj = int(bi_raw) - off
            except (TypeError, ValueError):
                bi_adj = None

        _bi = _hl_row_bar_index(chart_index, iso_cell, bi_adj, n)
        if _bi is None:
            continue
        val = _float_or_none(rs.get("line_value", rs.get("value")))
        if val is None:
            continue
        sc = rs.get("score")
        st = rs.get("state")
        p: dict[str, Any] = {"date": _to_iso(chart_index[_bi]), "value": val}
        if sc is not None:
            sc_f = _float_or_none(sc)
            if sc_f is not None:
                p["score"] = sc_f
        if st is not None and str(st).strip():
            p["state"] = str(st)
        pts.append(p)
    if not pts:
        return None
    return {"name": "HL trend", "data": pts}


def _touch_tier_from_row(row: Any) -> int:
    if row.get("touch2_at") is not None and str(row.get("touch2_at")).strip():
        return 2
    if row.get("touch1_at") is not None and str(row.get("touch1_at")).strip():
        return 1
    return 0


def _zone_fill_for_touch(kind: str, tier: int) -> str:
    k = kind.strip().lower()
    if tier >= 2:
        return "rgba(220, 38, 38, 0.42)"
    if tier == 1:
        return "rgba(249, 115, 22, 0.38)"
    if k == "demand":
        return "rgba(34, 197, 94, 0.25)"
    return "rgba(239, 68, 68, 0.25)"


def _view_zones_from_sd_parquet(zones_df: pd.DataFrame, zoh: pd.DataFrame) -> list[dict[str, Any]]:
    if zones_df is None or zones_df.empty or zoh is None or zoh.empty:
        return []
    t_min, t_max = zoh.index.min(), zoh.index.max()
    out: list[dict[str, Any]] = []
    for _, row in zones_df.iterrows():
        rs = row.get("range_start_at") or row.get("born_at")
        re = row.get("range_end_at") or row.get("born_at")
        try:
            if rs is None or re is None:
                continue
            a, b = pd.Timestamp(rs), pd.Timestamp(re)
            lo, hi = (a, b) if a <= b else (b, a)
        except Exception:
            continue
        if hi < t_min or lo > t_max:
            continue
        zd = zone_dict_from_artifact_row(zoh, row)
        if not zd:
            continue
        si = int(zd["start_idx"])
        ei = int(zd["end_idx"])
        si = min(max(0, si), len(zoh) - 1)
        ei = min(max(0, ei), len(zoh) - 1)
        kind = str(row.get("kind", "")).strip()
        tier = _touch_tier_from_row(row)
        fill = _zone_fill_for_touch(kind, tier)
        vl = _float_or_none(zd.get("value_low"))
        vh = _float_or_none(zd.get("value_high"))
        if vl is None or vh is None:
            continue
        zone: dict[str, Any] = {
            "date_start": _to_iso(zoh.index[si]),
            "date_end": _to_iso(zoh.index[ei]),
            "value_low": vl,
            "value_high": vh,
            "fillcolor": fill,
            "name": zd.get("name"),
            "base_length": zd.get("base_length"),
            "impulse_score": _impulse_score_as_int(zd),
            "has_touch": bool(zd.get("has_touch")),
            "inducement_count": zd.get("inducement_count"),
            "inducement_points": zd.get("inducement_points"),
        }
        if row.get("touch1_at"):
            t1 = row.get("touch1_at")
            ti = _iso_to_chart_bar_index(zoh.index, _to_iso(t1))
            if ti is not None:
                zone["touch_bar_index"] = ti
            t1p = _float_or_none(row.get("touch1_price"))
            if t1p is not None:
                zone["touch_marker_price"] = t1p
            zone["touch_date"] = _to_iso(t1)
        if tier >= 2 and row.get("touch2_at"):
            zone["touch2_date"] = _to_iso(row.get("touch2_at"))
        if row.get("with_trend") is True:
            zone["_artifact_with_trend"] = True
        out.append(zone)
    return out


def build_view_from_artifacts(
    *,
    data_dir: Path,
    data_file: str,
    years: float,
    start_iso: str | None,
    end_iso: str | None,
    df_chart: pd.DataFrame,
    chart_tf_normalized: str | None,
    include_sd: bool = True,
    dataset_id_override: str | None = None,
    repo_root_for_artifacts: Path | None = None,
) -> dict[str, Any]:
    """
    Vrátí markery, čáry, zóny a stav artefaktů pro View (standardní řez df_chart).

    ``dataset_id`` odpovídá buildu (typicky celý soubor, years=None v hash).
    ``start_iso``/``end_iso`` ovlivní jen přemapování ``bar_index`` (suffix offset se vypne).
    """
    _ = years
    resolved = resolve_safe_data_path(data_dir, data_file)
    if resolved is None:
        return {
            "markers": [],
            "lines": [],
            "zones": [],
            "artifact_status": "missing_data",
            "artifact_banner": "Datový soubor není k dispozici pro artefakty.",
            "dataset_id": None,
        }

    fp = fingerprint_dataset_file(resolved)
    dataset_id = (dataset_id_override or "").strip() or artifact_store.compute_dataset_id(
        data_file, fp, years=None, start_iso=None, end_iso=None
    )

    _art_base = repo_root_for_artifacts
    hl_mpath = artifact_store.hl_manifest_path(_art_base, dataset_id)
    hl_manifest = artifact_store.read_json_if_exists(hl_mpath)
    banner: str | None = None
    status = "ok"

    if not hl_manifest:
        status = "missing_hl"
        banner = "Chybí H/L artefakt (Build features). Graf ukazuje jen OHLC."
        return {
            "markers": [],
            "lines": [],
            "zones": [],
            "artifact_status": status,
            "artifact_banner": banner,
            "dataset_id": dataset_id,
        }

    if artifact_store.manifest_is_stale_fingerprint(hl_manifest, fp):
        status = "stale_fingerprint"
        banner = "Artefakt neodpovídá aktuálnímu souboru dat (přepočti Build features)."

    hl_dir = hl_mpath.parent
    chart_index = df_chart.index
    want_tf = _resolve_want_hl_artifact_tf_key(chart_tf_normalized, chart_index)
    tf_key = _pick_hl_tf_key(hl_manifest, want_tf)
    markers: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []

    if tf_key:
        if want_tf and tf_key != want_tf:
            # Make TF fallback explicit (common confusion on intraday: native 30m requested but ladder built only to 1h).
            warn_tf = (
                f"H/L artefakty: pro graf ({want_tf}) není k dispozici přesný TF v cache; "
                f"zobrazuji nejbližší dostupný ({tf_key})."
            )
            banner = f"{banner}; {warn_tf}" if banner else warn_tf
        # If precompute produced quality diagnostics, surface warnings for the selected TF.
        try:
            q = (hl_manifest.get("quality") or {}).get(tf_key) or {}
            warns = q.get("warnings") if isinstance(q, dict) else None
            if isinstance(warns, list) and len(warns) > 0:
                qmsg = f"H/L quality ({tf_key}): " + "; ".join(str(w) for w in warns[:4])
                banner = f"{banner}; {qmsg}" if banner else qmsg
        except Exception:
            pass
        arts = (hl_manifest.get("artifacts") or {}).get(tf_key) or {}
        bar_count_raw = arts.get("bar_count")
        artifact_bar_count: int | None
        try:
            artifact_bar_count = int(bar_count_raw) if bar_count_raw is not None else None
        except (TypeError, ValueError):
            artifact_bar_count = None
        if artifact_bar_count is None:
            artifact_bar_count = _legacy_bar_count_from_trend_parquet(hl_dir, arts)
        bi_off = _suffix_bar_index_offset(artifact_bar_count, len(chart_index), start_iso, end_iso)
        sw_name = arts.get("swings")
        if sw_name:
            p = hl_dir / sw_name
            if p.is_file():
                sw_df = _normalize_hl_parquet_df(pd.read_parquet(p))
                sw_marks = _markers_from_hl_parquet(
                    sw_df,
                    chart_index,
                    "swing",
                    bar_index_offset=bi_off,
                    ohlc_df=df_chart,
                )
                if (
                    sw_df is not None
                    and not sw_df.empty
                    and len(sw_df) > 80
                    and len(sw_marks) < max(8, len(sw_df) // 25)
                ):
                    warn = (
                        f"Swings ({tf_key}): v Parquet je {len(sw_df)} řádků, na graf se podařilo "
                        f"namapovat jen {len(sw_marks)} — zkontroluj data/TF, popř. Build znovu."
                    )
                    banner = f"{banner}; {warn}" if banner else warn
                markers.extend(sw_marks)
        int_name = arts.get("internals")
        if int_name:
            p = hl_dir / int_name
            if p.is_file():
                markers.extend(
                    _markers_from_hl_parquet(
                        pd.read_parquet(p),
                        chart_index,
                        "internal",
                        bar_index_offset=bi_off,
                        ohlc_df=df_chart,
                    )
                )
        maj_name = arts.get("majors")
        if maj_name:
            p = hl_dir / maj_name
            if p.is_file():
                markers.extend(
                    _markers_from_hl_parquet(
                        pd.read_parquet(p),
                        chart_index,
                        "major",
                        bar_index_offset=bi_off,
                        ohlc_df=df_chart,
                    )
                )
        bos_name = arts.get("bos")
        if bos_name:
            p = hl_dir / bos_name
            if p.is_file():
                markers.extend(_markers_from_bos_df(pd.read_parquet(p), chart_index, bar_index_offset=bi_off))
        tr_name = arts.get("trend")
        if tr_name:
            p = hl_dir / tr_name
            if p.is_file():
                tl = _trend_line_from_df(pd.read_parquet(p), chart_index, bar_index_offset=bi_off)
                if tl:
                    lines.append(tl)

    zones: list[dict[str, Any]] = []
    if include_sd:
        sd_mpath = artifact_store.sd_manifest_path(_art_base, dataset_id)
        sd_manifest = artifact_store.read_json_if_exists(sd_mpath)
        if not sd_manifest:
            if status == "ok":
                status = "missing_sd"
            if banner is None:
                banner = "Chybí S/D artefakt — zóny nejsou zobrazeny (spusť Build po H/L)."
        else:
            sd_dir = sd_mpath.parent
            z_files = (sd_manifest.get("artifacts") or {}).get("zones")
            zname = None
            if isinstance(z_files, str):
                zname = z_files
            elif isinstance(z_files, dict):
                zname = z_files.get("path") or z_files.get("parquet")
            if zname:
                zp = sd_dir / zname
                if zp.is_file():
                    zones = _view_zones_from_sd_parquet(pd.read_parquet(zp), df_chart)
                else:
                    if status == "ok":
                        status = "missing_sd"
                    if banner is None:
                        banner = "S/D manifest existuje, ale chybí soubor zón."
            else:
                cand = sd_dir / "zones.parquet"
                if cand.is_file():
                    zones = _view_zones_from_sd_parquet(pd.read_parquet(cand), df_chart)
                elif status == "ok":
                    status = "missing_sd"
                    if banner is None:
                        banner = "V manifestu S/D chybí odkaz na zones.parquet."

    return {
        "markers": markers,
        "lines": lines,
        "zones": zones,
        "artifact_status": status,
        "artifact_banner": banner,
        "dataset_id": dataset_id,
    }
