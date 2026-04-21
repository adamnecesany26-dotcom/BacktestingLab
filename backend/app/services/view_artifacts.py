"""
View fáze 5: H/L + S/D vrstvy z lokálních artefaktů (.backtest_artifacts) bez přepočtu modulů.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.services import artifact_store
from app.services.data_ohlc import (
    fingerprint_dataset_file,
    parse_iso_timestamp_for_index,
    resolve_safe_data_path,
)
from app.services.hl_artifact_spec import canonical_precompute_tf
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


def _htf_trend_source_tf_key(chart_artifact_tf: str | None) -> str:
    """Shodně se Swing_HL._htf_trend_source_tf: měsíc a týden → 1M artefakt, jinak 1d."""
    if not chart_artifact_tf:
        return "1d"
    s = str(chart_artifact_tf).strip().replace("/", "_")
    if s == "1M" or s.upper() in ("1MO", "1ME"):
        return "1M"
    if s.lower() == "1w":
        return "1M"
    return "1d"


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
        if idx is not None and not idx.empty:
            loc = idx.get_indexer([pd.Timestamp(ts)], method=None)
            if len(loc) and int(loc[0]) >= 0:
                return int(loc[0])
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


def _bar_index_from_calendar_date(chart_index: pd.DatetimeIndex, iso_cell: Any) -> int | None:
    """Denní / týdenní graf: najdi první bar se stejným kalendářním datem jako iso (TZ odolné)."""
    ts = _coerce_ts_for_chart_index(chart_index, iso_cell)
    if ts is None:
        try:
            ts = pd.Timestamp(str(iso_cell).strip())
        except Exception:
            return None
    if ts is None or pd.isna(ts):
        return None
    try:
        d = pd.Timestamp(ts).date()
    except Exception:
        return None
    try:
        t0d = pd.Timestamp(chart_index.min()).date()
        t1d = pd.Timestamp(chart_index.max()).date()
    except Exception:
        return None
    if d < t0d or d > t1d:
        return None
    for i in range(len(chart_index)):
        try:
            if pd.Timestamp(chart_index[i]).date() == d:
                return int(i)
        except Exception:
            continue
    return None


def _hl_row_bar_index(
    chart_index: pd.DatetimeIndex,
    iso_cell: Any,
    bi_adj: int | None,
    chart_len: int,
) -> int | None:
    """
    Swing/BOS/trend řádek → index baru na aktuálním df_chart.

    1) ``iso_time`` **uvnitř** [min,max] grafu → pozice podle času (správně při suffix okně / špatném offsetu).
    2) Platný ``bar_index`` po offsetu (spolehlivé při sdíleném špatném ISO mimo rozsah grafu).
    3) Slack na okrajích (_artifact_ts_usable_on_chart).
    4) Kalendářní shoda data při řadách hrubších než intradenní.
    """
    if chart_len <= 0 or chart_index is None or chart_index.empty:
        return None

    gap_med = _median_bar_gap_minutes(chart_index)
    coarse_series = gap_med is not None and float(gap_med) >= 12.0 * 60.0

    if iso_cell is not None:
        # U denních/týdenních řad ISO často drží půlnoc, index grafu může být session offset —
        # searchsorted dřív mapoval na „špatnou“ svíčku; kalendářní den první.
        if coarse_series:
            bi_cal = _bar_index_from_calendar_date(chart_index, iso_cell)
            if bi_cal is not None:
                return bi_cal
        ts_in = parse_iso_timestamp_for_index(chart_index, iso_cell)
        if ts_in is not None and _ts_within_index(chart_index, ts_in):
            pos = _ts_to_chart_bar_index(chart_index, ts_in)
            if pos is not None:
                return pos

    bi_cand = _safe_bar_index_for_chart(bi_adj, chart_len) if bi_adj is not None else None
    if bi_cand is not None:
        return bi_cand

    ts_use = _artifact_ts_usable_on_chart(chart_index, iso_cell)
    if ts_use is not None:
        return _ts_to_chart_bar_index(chart_index, ts_use)

    if coarse_series and iso_cell is not None:
        bi_cal = _bar_index_from_calendar_date(chart_index, iso_cell)
        if bi_cal is not None:
            return bi_cal
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


def _infer_artifact_bar_count_from_parquet(df: pd.DataFrame | None) -> int | None:
    """
    Když je manifest ``bar_count`` chybný/legacy, dokážeme odhadnout délku precompute řady
    z Parquetu: max(bar_index)+1. To je robustnější než spoléhat na iso_time.
    """
    if df is None or df.empty or "bar_index" not in df.columns:
        return None
    try:
        s = pd.to_numeric(df["bar_index"], errors="coerce")
        s = s[pd.notna(s)]
        if len(s) == 0:
            return None
        mx = int(s.max())
        # Heuristic: artifact bar_count should never be smaller than the currently loaded chart window.
        # If Parquet contains a single bogus/zero index, don't treat it as a reliable bar_count.
        return mx + 1 if mx >= 0 else None
    except Exception:
        return None


def _best_suffix_bar_index_offset(
    *,
    df_hint: pd.DataFrame | None,
    manifest_bar_count: int | None,
    chart_len: int,
    start_iso: str | None,
    end_iso: str | None,
) -> int:
    """
    Vybere offset, který dá nejvíc platných indexů v aktuálním ``df_chart``.
    Priorita: manifest offset, ale pokud je zjevně špatný (mapuje téměř nic),
    zkusíme odhad z Parquetu.
    """
    if start_iso and str(start_iso).strip():
        return 0
    if end_iso and str(end_iso).strip():
        return 0
    cand: list[int] = []
    cand.append(_suffix_bar_index_offset(manifest_bar_count, chart_len, start_iso, end_iso))
    inferred = _infer_artifact_bar_count_from_parquet(df_hint)
    if inferred is not None and inferred >= int(chart_len):
        cand.append(_suffix_bar_index_offset(inferred, chart_len, start_iso, end_iso))
    cand.append(0)
    # uniq preserve order
    seen: set[int] = set()
    cand2: list[int] = []
    for c in cand:
        if c in seen:
            continue
        seen.add(c)
        cand2.append(c)

    def _score(off: int) -> int:
        if df_hint is None or df_hint.empty or "bar_index" not in df_hint.columns:
            return 0
        try:
            s = pd.to_numeric(df_hint["bar_index"], errors="coerce")
            s = s[pd.notna(s)]
            if len(s) == 0:
                return 0
            # count in-range after offset
            adj = s.astype("int64") - int(off)
            return int(((adj >= 0) & (adj < int(chart_len))).sum())
        except Exception:
            return 0

    if not cand2:
        return 0

    baseline = cand2[0]
    baseline_score = _score(baseline)

    best = baseline
    best_score = baseline_score
    for c in cand2[1:]:
        sc = _score(c)
        if sc > best_score:
            best, best_score = c, sc

    # If manifest provides bar_count, prefer its offset unless the alternative is a *clear* win.
    # This protects against cases where Parquet has a misleading/small bar_index column but correct iso_time.
    if manifest_bar_count is not None and best != baseline:
        try:
            total = int(len(df_hint)) if (df_hint is not None and not df_hint.empty) else 0
        except Exception:
            total = 0
        # Require a meaningful absolute improvement (at least 20 rows or 10% of file) to override manifest.
        min_abs = 20
        min_rel = int(max(0, total) * 0.10)
        if (best_score - baseline_score) < max(min_abs, min_rel):
            return int(baseline)

    return int(best)


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


def _count_swings_rows_mappable_to_chart(
    sw_df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
    bar_index_offset: int,
) -> int:
    """
    Počet řádků swings Parquet, u kterých známe cílový bar v ``chart_index`` (stejná logika jako u
    mapování, jen bez kontroly / synchronizace ceny). Pro heuristiku banneru při oříznutém View —
    nelze porovnávat ``len(sw_marks)`` s ``len(sw_df)`` z celého datasetu.
    """
    sw_df = _normalize_hl_parquet_df(sw_df)
    if sw_df is None or sw_df.empty or chart_index.empty:
        return 0
    n = len(chart_index)
    off = max(0, int(bar_index_offset))
    cnt = 0
    for _, row in sw_df.iterrows():
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
        if _hl_row_bar_index(chart_index, iso_cell, bi_adj, n) is not None:
            cnt += 1
    return int(cnt)


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


def _trend_line_merge_htf_to_chart(
    htf_df: pd.DataFrame,
    chart_index: pd.DatetimeIndex,
) -> dict[str, Any] | None:
    """
    HTF trend parquet (1M nebo 1d) → řada ``data[]`` se stejnou délkou jako ``chart_index``
    (merge_asof backward + ffill), aby View nemusel přepočítávat modul.
    """
    df = _normalize_hl_parquet_df(htf_df)
    if df is None or df.empty or chart_index.empty:
        return None
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rs = row if isinstance(row, pd.Series) else pd.Series(row)
        iso_cell = _row_iso_like(rs)
        ts = _coerce_ts_for_chart_index(chart_index, iso_cell)
        if ts is None:
            continue
        val = _float_or_none(rs.get("line_value", rs.get("value")))
        if val is None:
            continue
        sc = _float_or_none(rs.get("score"))
        st = rs.get("state")
        rows.append({
            "ts": pd.Timestamp(ts),
            "value": val,
            "score": 0.0 if sc is None else sc,
            "state": str(st) if st is not None and str(st).strip() else "RANGE",
        })
    if not rows:
        return None
    r = pd.DataFrame(rows).sort_values("ts").drop_duplicates(subset=["ts"], keep="last")
    l_df = pd.DataFrame({"ord": np.arange(len(chart_index)), "ts": chart_index})
    l_sorted = l_df.sort_values("ts")
    m = pd.merge_asof(l_sorted, r, on="ts", direction="backward")
    m = m.sort_values("ord")
    m["value"] = pd.to_numeric(m["value"], errors="coerce").ffill().bfill()
    m["score"] = pd.to_numeric(m["score"], errors="coerce").ffill().bfill()
    m["state"] = m["state"].ffill().bfill().fillna("RANGE")
    pts: list[dict[str, Any]] = []
    for i in range(len(m)):
        bi = int(m["ord"].iloc[i])
        sc_f = float(m["score"].iloc[i]) if pd.notna(m["score"].iloc[i]) else 0.0
        pts.append({
            "date": _to_iso(chart_index[bi]),
            "value": float(m["value"].iloc[i]),
            "score": sc_f,
            "state": str(m["state"].iloc[i]),
        })
    return {"name": "HL trend", "data": pts}


def _touch_tier_from_row(row: Any) -> int:
    if row.get("touch2_at") is not None and str(row.get("touch2_at")).strip():
        return 2
    if row.get("touch1_at") is not None and str(row.get("touch1_at")).strip():
        return 1
    return 0


def _zone_fill_for_touch(kind: str, tier: int) -> str:
    """
    Demand / Supply jen v zelené / červené — žádná sdílená „výstražná“ oranžová pro dotčené zóny.
    Vyšší tier = o něco sytější stejný odstín, stále nízká kryvost (lehká výplň).
    """
    k = kind.strip().lower()
    is_demand = k == "demand"
    if is_demand:
        if tier >= 2:
            return "rgba(21, 128, 61, 0.26)"
        if tier == 1:
            return "rgba(34, 197, 94, 0.18)"
        return "rgba(34, 197, 94, 0.12)"
    if tier >= 2:
        return "rgba(185, 28, 28, 0.26)"
    if tier == 1:
        return "rgba(239, 68, 68, 0.18)"
    return "rgba(239, 68, 68, 0.12)"


def _sd_zone_row_tf_key(raw: Any) -> str:
    s = str(raw or "").strip()
    return (canonical_precompute_tf(s) or s.replace("/", "_")).strip()


def _filter_sd_zones_df_for_chart_tf(
    zones_df: pd.DataFrame,
    want_tf: str | None,
) -> tuple[pd.DataFrame, str | None, str | None]:
    """
    Stejná logika výběru TF jako u H/L vrstvy: zobrazit jen zóny z ``source_tf`` odpovídajícího grafu.

    Vrací (filtrovaný DataFrame, kanonický TF požadovaný grafem, skutečně použitý klíč po případném fallbacku).
    Druhý a třetí prvek jsou None, pokud se nefiltruje (neznámý want_tf nebo chybí sloupec).
    """
    if zones_df is None or zones_df.empty:
        return zones_df, None, None
    if want_tf is None or not str(want_tf).strip():
        return zones_df, None, None
    if "source_tf" not in zones_df.columns:
        return zones_df, None, None

    keys_series = zones_df["source_tf"].map(_sd_zone_row_tf_key)
    unique_keys = sorted({k for k in keys_series.tolist() if k})
    if not unique_keys:
        return zones_df, None, None

    want_canon = (canonical_precompute_tf(str(want_tf).strip()) or str(want_tf).strip()).strip()
    if want_canon in unique_keys:
        return zones_df.loc[keys_series == want_canon].copy(), want_canon, want_canon

    fake_manifest: dict[str, Any] = {"artifacts": {k: {} for k in unique_keys}}
    picked = _pick_hl_tf_key(fake_manifest, want_canon)
    if picked and picked in unique_keys:
        return zones_df.loc[keys_series == picked].copy(), want_canon, picked
    return zones_df.copy(), want_canon, None


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
    include_hl: bool = True,
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
    markers: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []

    if include_hl:
        if not hl_manifest:
            status = "missing_hl"
            banner = "Chybí H/L artefakt (Build features). Graf ukazuje jen OHLC."
            if not include_sd:
                return {
                    "markers": [],
                    "lines": [],
                    "zones": [],
                    "artifact_status": status,
                    "artifact_banner": banner,
                    "dataset_id": dataset_id,
                }
        elif artifact_store.manifest_is_stale_fingerprint(hl_manifest, fp):
            status = "stale_fingerprint"
            banner = "Artefakt neodpovídá aktuálnímu souboru dat (přepočti Build features)."
    else:
        if not hl_manifest and include_sd:
            note = (
                "H/L vrstva vypnutá (zvolen S/D modul ve View). "
                "Zóny se berou z S/D artefaktu, pokud existuje — stav „Fresh“ může odkazovat na dřívější H/L build."
            )
            banner = note
        elif hl_manifest and artifact_store.manifest_is_stale_fingerprint(hl_manifest, fp):
            status = "stale_fingerprint"
            banner = "Artefakt neodpovídá aktuálnímu souboru dat (přepočti Build features)."

    hl_dir = hl_mpath.parent
    chart_index = df_chart.index
    want_tf = _resolve_want_hl_artifact_tf_key(chart_tf_normalized, chart_index)
    tf_key = _pick_hl_tf_key(hl_manifest, want_tf) if (include_hl and hl_manifest) else None

    if include_hl and hl_manifest and tf_key:
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
                bi_off = _best_suffix_bar_index_offset(
                    df_hint=sw_df,
                    manifest_bar_count=artifact_bar_count,
                    chart_len=len(chart_index),
                    start_iso=start_iso,
                    end_iso=end_iso,
                )
                sw_marks = _markers_from_hl_parquet(
                    sw_df,
                    chart_index,
                    "swing",
                    bar_index_offset=bi_off,
                    ohlc_df=df_chart,
                )
                in_window = _count_swings_rows_mappable_to_chart(sw_df, chart_index, bi_off)
                min_mapped = max(8, int(in_window * 0.22))
                if (
                    sw_df is not None
                    and not sw_df.empty
                    and in_window > 80
                    and len(sw_marks) < min_mapped
                ):
                    warn = (
                        f"Swings ({tf_key}): v čase grafu je ~{in_window} swingů z artefaktu, "
                        f"namapovalo se jen {len(sw_marks)} (cena/typ?) — zkontroluj data/TF, popř. Build znovu."
                    )
                    banner = f"{banner}; {warn}" if banner else warn
                markers.extend(sw_marks)
        bos_name = arts.get("bos")
        if bos_name:
            p = hl_dir / bos_name
            if p.is_file():
                markers.extend(_markers_from_bos_df(pd.read_parquet(p), chart_index, bar_index_offset=bi_off))

        trend_src_tf = _htf_trend_source_tf_key(want_tf or tf_key)
        trend_pkg = (hl_manifest.get("artifacts") or {}).get(trend_src_tf) or {}
        tr_name = trend_pkg.get("trend") if isinstance(trend_pkg, dict) else None
        if not tr_name:
            tr_name = arts.get("trend")
        if tr_name:
            p = hl_dir / tr_name
            if p.is_file():
                tl = _trend_line_merge_htf_to_chart(pd.read_parquet(p), chart_index)
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
                    zdf_all = pd.read_parquet(zp)
                    zdf_use, want_sd_c, used_sd_c = _filter_sd_zones_df_for_chart_tf(zdf_all, want_tf)
                    if want_sd_c and used_sd_c and want_sd_c != used_sd_c:
                        warn_sd = f"S/D zóny: přesný TF ({want_sd_c}) není v cache; zobrazuji {used_sd_c}."
                        banner = f"{banner}; {warn_sd}" if banner else warn_sd
                    zones = _view_zones_from_sd_parquet(zdf_use, df_chart)
                else:
                    if status == "ok":
                        status = "missing_sd"
                    if banner is None:
                        banner = "S/D manifest existuje, ale chybí soubor zón."
            else:
                cand = sd_dir / "zones.parquet"
                if cand.is_file():
                    zdf_all = pd.read_parquet(cand)
                    zdf_use, want_sd_c, used_sd_c = _filter_sd_zones_df_for_chart_tf(zdf_all, want_tf)
                    if want_sd_c and used_sd_c and want_sd_c != used_sd_c:
                        warn_sd = f"S/D zóny: přesný TF ({want_sd_c}) není v cache; zobrazuji {used_sd_c}."
                        banner = f"{banner}; {warn_sd}" if banner else warn_sd
                    zones = _view_zones_from_sd_parquet(zdf_use, df_chart)
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
