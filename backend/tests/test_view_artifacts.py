"""View fáze 5 — sestavení markerů / zón z artefaktů."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from app.services import artifact_store
from app.services.data_ohlc import fingerprint_dataset_file
from app.services.view_artifacts import _hl_row_bar_index, _ts_to_chart_bar_index, build_view_from_artifacts


def _minimal_parquet(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    idx = pd.date_range("2024-06-01", periods=30, freq="1D")
    df = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=idx,
    )
    df.to_parquet(path)


def test_build_view_missing_hl(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=True,
        repo_root_for_artifacts=tmp_path,
    )
    assert out["artifact_status"] == "missing_hl"
    assert out["markers"] == []


def test_build_view_naive_index_tz_aware_swing_iso_no_crash(tmp_path: Path) -> None:
    """TXT-like naive chart index + timezone-aware ISO z Parquet (dříve TypeError → HTTP 500)."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    sw = pd.DataFrame([
        {"bar_index": 5, "iso_time": "2024-06-06T00:00:00+00:00", "type": "high", "price": 105.0},
    ])
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_internals.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_majors.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_bos.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_trend.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert out["artifact_status"] in {"ok", "stale_fingerprint"}
    assert len(out["markers"]) == 1


def test_hl_swing_prefers_bar_index_over_bad_iso_time(tmp_path: Path) -> None:
    """
    Špatné / sdílené iso_time v Parquetu nesmí přebít platný bar_index — jinak spousta swingů
    dostane stejné datum (stejný bar) a „Values“/Graf vypadají rozbitě.
    """
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    bad_iso = "2025-03-17T00:00:00+00:00"
    sw = pd.DataFrame([
        {"bar_index": 5, "iso_time": bad_iso, "type": "high", "price": 105.0},
        {"bar_index": 10, "iso_time": bad_iso, "type": "low", "price": 99.5},
        {"bar_index": 15, "iso_time": bad_iso, "type": "high", "price": 106.0},
    ])
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_internals.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_majors.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_bos.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_trend.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert out["artifact_status"] in {"ok", "stale_fingerprint"}
    marks = [m for m in out["markers"] if m.get("type") in ("high", "low")]
    assert len(marks) == 3
    dates = {m["date"][:10] for m in marks}
    assert len(dates) == 3, dates
    assert "2025-03-17" not in dates


def test_pick_hl_tf_key_missing_30m_falls_back_and_sets_banner(tmp_path: Path) -> None:
    """
    When the chart wants 30m artifacts but the manifest doesn't include them (default ladder),
    we should explicitly disclose the fallback TF in the banner so users don't misdiagnose
    "few swings" as a compute failure.
    """
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    # Provide only 1h artifacts (no 30m).
    sw = pd.DataFrame(
        [{"bar_index": 5, "iso_time": "2024-06-06T00:00:00", "type": "high", "price": 105.0}]
    )
    sw.to_parquet(hl_dir / "1h_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1h_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1h"],
    )
    hl_manifest["artifacts"] = {
        "1h": {
            "swings": "1h_swings.parquet",
            "internals": "1h_internals.parquet",
            "majors": "1h_majors.parquet",
            "bos": "1h_bos.parquet",
            "trend": "1h_trend.parquet",
            "bar_count": 30,
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=0.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="30m",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["artifact_banner"] is not None
    assert "30m" in out["artifact_banner"]
    assert "1h" in out["artifact_banner"]


def test_artifacts_iso_window_maps_by_time_without_suffix_offset(tmp_path: Path) -> None:
    """
    If the client uses an explicit ISO window (start/end), suffix bar-index offset must be disabled
    and mapping should rely on timestamps. This prevents accidental shifting when viewing a mid-series slice.
    """
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "full.parquet"
    full_idx = pd.date_range("2024-06-01", periods=30, freq="1D")
    pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=full_idx,
    ).to_parquet(fpth)
    rel = "t/full.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)

    # Global artifact bar_index=12 (full-series), but we will view a mid-window starting at bar 10.
    iso12 = pd.Timestamp(full_idx[12]).isoformat()
    sw = pd.DataFrame([{"bar_index": 12, "iso_time": iso12, "type": "high", "price": 105.0}])
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(full_idx[0]),
        time_range_end=str(full_idx[-1]),
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
            "bar_count": 30,
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth).iloc[10:20]
    start_iso = pd.Timestamp(chart.index.min()).isoformat()
    end_iso = pd.Timestamp(chart.index.max()).isoformat()
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=0.0,
        start_iso=start_iso,
        end_iso=end_iso,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    # In the 10..19 window, global 12 should map to local index 2 by time mapping.
    assert out["markers"][0]["bar_index"] == 2


def test_hl_markers_suffix_offset_truncated_chart(tmp_path: Path) -> None:
    """Artefakt na plné řadě (bar_count=30); View jen tail 10 barů — globální bar_index musí přemapovat."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "full.parquet"
    full_idx = pd.date_range("2024-06-01", periods=30, freq="1D")
    pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=full_idx,
    ).to_parquet(fpth)
    rel = "t/full.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    iso25 = pd.Timestamp(full_idx[25]).isoformat()
    sw = pd.DataFrame(
        [{"bar_index": 25, "iso_time": iso25, "type": "high", "price": 105.0}]
    )
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(full_idx[0]),
        time_range_end=str(full_idx[-1]),
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
            "bar_count": 30,
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth).iloc[-10:]
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["markers"][0]["bar_index"] == 5
    assert abs(out["markers"][0]["value"] - 101.0) < 1e-6


def test_hl_markers_suffix_offset_legacy_trend_row_count(tmp_path: Path) -> None:
    """Stejné jako ``bar_count`` v manifestu, ale odvozeno z délky ``1d_trend.parquet``."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "full.parquet"
    full_idx = pd.date_range("2024-06-01", periods=30, freq="1D")
    pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=full_idx,
    ).to_parquet(fpth)
    rel = "t/full.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    iso25 = pd.Timestamp(full_idx[25]).isoformat()
    sw = pd.DataFrame(
        [{"bar_index": 25, "iso_time": iso25, "type": "high", "price": 105.0}]
    )
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)
    trend_rows = []
    for i in range(30):
        trend_rows.append(
            {
                "bar_index": i,
                "iso_time": str(pd.Timestamp(full_idx[i]).date()),
                "line_value": 100.0,
                "score": 0.0,
                "state": "RANGE",
            }
        )
    pd.DataFrame(trend_rows).to_parquet(hl_dir / "1d_trend.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(full_idx[0]),
        time_range_end=str(full_idx[-1]),
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth).iloc[-10:]
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["markers"][0]["bar_index"] == 5


def test_hl_markers_iso_slightly_before_chart_clamped(tmp_path: Path) -> None:
    """iso_time pár hodin před první svíčkou grafu — přitáhnout na okraj (TZ / session)."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "full.parquet"
    full_idx = pd.date_range("2024-06-03", periods=10, freq="1D")
    pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=full_idx,
    ).to_parquet(fpth)
    rel = "t/full.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    sw = pd.DataFrame(
        [
            {
                "bar_index": 0,
                "iso_time": "2024-06-02T12:00:00",
                "type": "high",
                "price": 105.0,
            }
        ]
    )
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(full_idx[0]),
        time_range_end=str(full_idx[-1]),
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
            "bar_count": 10,
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["markers"][0]["bar_index"] == 0


def test_hl_markers_use_bar_index_when_iso_unusable(tmp_path: Path) -> None:
    """Parquet může mít platný bar_index; iso_time po exportu/importu nesedí s porovnáním -- musí se stejně vykreslit."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    sw = pd.DataFrame(
        [
            {
                "bar_index": 5,
                "iso_time": "1900-01-01T00:00:00",
                "type": "high",
                "price": 105.0,
            },
            {
                "bar_index": 8,
                "iso_time": "invalid-iso-!!!",
                "type": "low",
                "price": 98.0,
            },
        ]
    )
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 2
    assert {m["value"] for m in out["markers"]} == {101.0, 99.0}


def test_native_chart_tf_picks_matching_hl_artifact_not_coarsest(tmp_path: Path) -> None:
    """
    UI „Původní“ posílá chart_timeframe=null — dříve se bral první klíč (1M) místo odhadnutého 1d z indexu.
    """
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)

    def _empty_hl_tf(tf: str) -> None:
        pd.DataFrame([]).to_parquet(hl_dir / f"{tf}_swings.parquet", index=False)
        pd.DataFrame([]).to_parquet(hl_dir / f"{tf}_internals.parquet", index=False)
        pd.DataFrame([]).to_parquet(hl_dir / f"{tf}_majors.parquet", index=False)
        pd.DataFrame([]).to_parquet(hl_dir / f"{tf}_bos.parquet", index=False)
        pd.DataFrame([]).to_parquet(hl_dir / f"{tf}_trend.parquet", index=False)

    _empty_hl_tf("1M")
    sw = pd.DataFrame(
        [{"bar_index": 5, "iso_time": "2024-06-06T00:00:00", "type": "high", "price": 105.0}]
    )
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_internals.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_majors.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_bos.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_trend.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1M", "1d"],
    )
    art_m = {
        "swings": "1M_swings.parquet",
        "internals": "1M_internals.parquet",
        "majors": "1M_majors.parquet",
        "bos": "1M_bos.parquet",
        "trend": "1M_trend.parquet",
    }
    art_d = {
        "swings": "1d_swings.parquet",
        "internals": "1d_internals.parquet",
        "majors": "1d_majors.parquet",
        "bos": "1d_bos.parquet",
        "trend": "1d_trend.parquet",
    }
    hl_manifest["artifacts"] = {"1M": art_m, "1d": art_d}
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized=None,
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["markers"][0]["value"] == 101.0


def test_build_view_hl_swings_and_sd_zone(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    sw = pd.DataFrame([
        {"bar_index": 5, "iso_time": "2024-06-06T00:00:00", "type": "high", "price": 105.0},
        {"bar_index": 8, "iso_time": "2024-06-09T00:00:00", "type": "low", "price": 98.0},
    ])
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_internals.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_majors.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_bos.parquet", index=False)
    pd.DataFrame([]).to_parquet(hl_dir / "1d_trend.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    sd_dir = artifact_store.sd_version_dir(tmp_path, did)
    sd_dir.mkdir(parents=True, exist_ok=True)
    zrows = [
        {
            "zone_id": "z1",
            "kind": "demand",
            "source_tf": "1d",
            "born_at": "2024-06-10T00:00:00",
            "range_start_at": "2024-06-08T00:00:00",
            "range_end_at": "2024-06-20T00:00:00",
            "died_at": None,
            "price_low": 97.0,
            "price_high": 99.0,
            "range_size": 2.0,
            "base_length": 2,
            "has_inducement": False,
            "impulse_score": 2.0,
            "touch1_at": "2024-06-12T00:00:00",
            "touch1_price": 98.5,
            "touch2_at": None,
            "touch2_price": None,
            "max_age_before_death": None,
            "with_trend": False,
            "pivot_idx": 0,
            "start_idx": 0,
            "end_idx": 0,
        }
    ]
    pd.DataFrame(zrows).to_parquet(sd_dir / "zones.parquet", index=False)
    sd_m = artifact_store.build_sd_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start="2024-06-01T00:00:00",
        time_range_end="2024-06-30T00:00:00",
        years=1.0,
        hl_module_digest="test",
        sd_module_digest="test",
        params_snapshot={},
        hl_manifest_path_rel=f"{did}/hl/v1/manifest.json",
    )
    sd_m["artifacts"] = {"zones": "zones.parquet", "rows": 1}
    (sd_dir / "manifest.json").write_text(json.dumps(sd_m), encoding="utf-8")

    chart = pd.read_parquet(fpth)
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=True,
        repo_root_for_artifacts=tmp_path,
    )
    assert out["artifact_status"] == "ok"
    assert len(out["markers"]) == 2
    assert {m["type"] for m in out["markers"]} == {"high", "low"}
    assert len(out["zones"]) == 1
    assert out["zones"][0]["name"] == "Demand"
    assert out["zones"][0].get("touch_bar_index") is not None


def test_hl_manifest_tf_key_legacy_1D_capital(tmp_path: Path) -> None:
    """Manifest klíč ``1D`` (legacy) musí sedět s požadavkem na denní TF."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "x.parquet"
    _minimal_parquet(fpth)
    rel = "t/x.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    chart = pd.read_parquet(fpth)
    idx = chart.index
    iso5 = pd.Timestamp(idx[5]).isoformat()
    sw = pd.DataFrame([{"bar_index": 5, "iso_time": iso5, "type": "high", "price": 105.0}])
    sw.to_parquet(hl_dir / "swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(idx[0]),
        time_range_end=str(idx[-1]),
        years=1.0,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1D": {
            "swings": "swings.parquet",
            "internals": "internals.parquet",
            "majors": "majors.parquet",
            "bos": "bos.parquet",
            "trend": "trend.parquet",
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert out["artifact_status"] in {"ok", "stale_fingerprint"}
    assert len(out["markers"]) == 1


def test_hl_markers_prefer_iso_over_misleading_bar_index(tmp_path: Path) -> None:
    """Špatný bar_index + správné iso_time → pozice podle času (offset nesedí)."""
    data_dir = tmp_path / "data"
    (data_dir / "t").mkdir(parents=True)
    fpth = data_dir / "t" / "full.parquet"
    full_idx = pd.date_range("2024-06-01", periods=30, freq="1D")
    pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
        index=full_idx,
    ).to_parquet(fpth)
    rel = "t/full.parquet"
    fp = fingerprint_dataset_file(fpth)
    did = artifact_store.compute_dataset_id(rel, fp, years=None, start_iso=None, end_iso=None)

    hl_dir = artifact_store.hl_version_dir(tmp_path, did)
    hl_dir.mkdir(parents=True, exist_ok=True)
    iso25 = pd.Timestamp(full_idx[25]).isoformat()
    sw = pd.DataFrame([{"bar_index": 0, "iso_time": iso25, "type": "high", "price": 105.0}])
    sw.to_parquet(hl_dir / "1d_swings.parquet", index=False)
    for name in ("internals", "majors", "bos", "trend"):
        pd.DataFrame([]).to_parquet(hl_dir / f"1d_{name}.parquet", index=False)

    hl_manifest = artifact_store.build_hl_manifest_skeleton(
        dataset_id=did,
        data_file=rel,
        data_fingerprint=fp,
        time_range_start=str(full_idx[0]),
        time_range_end=str(full_idx[-1]),
        years=None,
        hl_module_digest="test",
        params_snapshot={},
        tf_ladder=["1d"],
    )
    hl_manifest["artifacts"] = {
        "1d": {
            "swings": "1d_swings.parquet",
            "internals": "1d_internals.parquet",
            "majors": "1d_majors.parquet",
            "bos": "1d_bos.parquet",
            "trend": "1d_trend.parquet",
            "bar_count": 30,
        }
    }
    (hl_dir / "manifest.json").write_text(json.dumps(hl_manifest), encoding="utf-8")

    chart = pd.read_parquet(fpth).iloc[-10:]
    out = build_view_from_artifacts(
        data_dir=data_dir,
        data_file=rel,
        years=1.0,
        start_iso=None,
        end_iso=None,
        df_chart=chart,
        chart_tf_normalized="1D",
        include_sd=False,
        repo_root_for_artifacts=tmp_path,
    )
    assert len(out["markers"]) == 1
    assert out["markers"][0]["bar_index"] == 5


def test_ts_to_chart_bar_index_exact_timestamp_in_index() -> None:
    """Přesná shoda času s indexem → řádek podle get_indexer, ne jen searchsorted slepě."""
    idx = pd.DatetimeIndex(
        [
            pd.Timestamp("2024-06-01 00:00:00", tz="UTC"),
            pd.Timestamp("2024-06-02 00:00:00", tz="UTC"),
        ]
    )
    bi = _ts_to_chart_bar_index(idx, pd.Timestamp("2024-06-02 00:00:00", tz="UTC"))
    assert bi == 1


def test_hl_row_bar_index_coarse_daily_uses_calendar_day() -> None:
    """Hrubá denní řada: ISO o půlnoci sedí na správný kalendářní den i při ne-00:00 štítcích svíček."""
    idx = pd.DatetimeIndex(
        [
            pd.Timestamp("2024-06-01 18:00:00", tz="UTC"),
            pd.Timestamp("2024-06-02 18:00:00", tz="UTC"),
            pd.Timestamp("2024-06-03 18:00:00", tz="UTC"),
        ]
    )
    iso = "2024-06-02T00:00:00+00:00"
    bi = _hl_row_bar_index(idx, iso, None, len(idx))
    assert bi == 1


def test_swing_hl_rolling_carry_roundtrip_index_translation() -> None:
    """Sanity: přenos stavu rollujících oken překládá absolutní bar na lokální offset okna."""
    import importlib.util
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    path = root / "strategies" / "sd_zone_strategy" / "modules" / "Swing_HL.py"
    spec = importlib.util.spec_from_file_location("swing_hl_carry_test", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    carry = {"last_swing_type": "high", "last_swing_price": 101.0, "last_swing_abs": 145}
    init = mod._rolling_carry_to_initial_state(carry, window_abs_start=100)
    assert init is not None
    assert init["last_swing_idx"] == 45
    back = mod._rolling_final_to_carry(
        {"last_swing_type": "low", "last_swing_idx": 10, "last_swing_price": 99.0},
        window_abs_start=100,
    )
    assert back["last_swing_abs"] == 110
