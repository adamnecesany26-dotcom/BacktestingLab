"""Tests for S/D zone saved backtest storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services import sd_zone_saved_runs as s


@pytest.fixture()
def tmp_repo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(s, "repo_root", lambda: tmp_path)
    return tmp_path


def test_fingerprint_stable_key_order(tmp_repo: Path) -> None:
    a = {"data_file": "x.csv", "years": 1, "zone_timeframes": ["1D"]}
    b = {"zone_timeframes": ["1D"], "data_file": "x.csv", "years": 1}
    assert s.compute_request_fingerprint(a) == s.compute_request_fingerprint(b)


def test_fingerprint_zone_timeframe_legacy_merges(tmp_repo: Path) -> None:
    a = {"data_file": "x.csv", "zone_timeframe": "1D", "zone_timeframes": None}
    b = {"data_file": "x.csv", "zone_timeframes": ["1D"]}
    assert s.compute_request_fingerprint(a) == s.compute_request_fingerprint(b)


def test_validate_single_zone_tf(tmp_repo: Path) -> None:
    ok, _ = s.validate_single_zone_timeframe({"data_file": "a.csv", "zone_timeframes": ["1h"]})
    assert ok is True
    ok2, msg = s.validate_single_zone_timeframe({"data_file": "a.csv", "zone_timeframes": ["1h", "4h"]})
    assert ok2 is False
    assert msg


def test_save_get_patch_roundtrip(tmp_repo: Path) -> None:
    req = {
        "data_file": "folder/instr.txt",
        "years": 2,
        "chart_timeframe": "4h",
        "zone_timeframes": ["1D"],
        "winner_rr": 1.5,
    }
    resp = {
        "ok": True,
        "ohlc": [{"date": "2026-01-01T00:00:00", "open": 1, "high": 2, "low": 0.5, "close": 1.5}],
        "trades": [
            {
                "zone_id": "z1",
                "zone_name": "Demand",
                "source_tf": "1D",
                "touch_index": 0,
                "entry_bar": 0,
                "mfe_R": 2.0,
                "mfe_before_sl_R": 1.8,
                "mae_R": 0.4,
                "duration_bars": 12,
                "sl_hit_bar": None,
            }
        ],
    }
    out = s.save_run(tmp_repo, req, resp)
    run_id = out["run_id"]
    doc = s.get_run_document(tmp_repo, run_id)
    assert doc is not None
    assert doc.get("chart_timeframe") == "4h"
    assert doc["response"] == resp
    fp, rid = s.resolve_existing_run_id(tmp_repo, req)
    assert rid == run_id
    assert fp == out["fingerprint"]

    s.patch_annotation(
        tmp_repo,
        run_id,
        "z1",
        "Demand",
        "1D",
        "tk-1",
        0,
        0,
        0,
        [{"id": "a", "label": "legacy", "checked": True}],
        ["tagA", "tagB"],
        "hi",
    )
    doc2 = s.get_run_document(tmp_repo, run_id)
    assert doc2 is not None
    anns = doc2.get("annotations") or {}
    assert len(anns) == 1
    j = s.list_journal_entries(tmp_repo)
    assert len(j) == 1
    assert j[0].get("zone_name") == "Demand"
    assert j[0].get("source_tf") == "1D"
    assert j[0].get("r_for_sort") is not None
    assert "tagA" in (j[0].get("tags") or [])

    out_del = s.delete_annotation(tmp_repo, run_id, "z1", "1D", "tk-1")
    assert out_del.get("ok") is True
    j2 = s.list_journal_entries(tmp_repo)
    assert len(j2) == 0


def test_save_requires_single_zone_tf(tmp_repo: Path) -> None:
    req = {"data_file": "a.csv", "zone_timeframes": ["1h", "4h"]}
    with pytest.raises(ValueError):
        s.save_run(tmp_repo, req, {})


def test_list_runs(tmp_repo: Path) -> None:
    out1 = s.save_run(
        tmp_repo,
        {"data_file": "a.csv", "zone_timeframes": ["1D"], "chart_timeframe": "1h"},
        {"ok": True, "trades": [], "ohlc": [], "aggregates": {"touch_count": 3, "win_rate_by_rr": 0.4}},
    )
    out2 = s.save_run(tmp_repo, {"data_file": "b.csv", "zone_timeframes": ["1D"]}, {"ok": True, "trades": [], "ohlc": []})
    rows = s.list_saved_runs(tmp_repo)
    ids = {r.get("run_id") for r in rows}
    assert out1["run_id"] in ids
    assert out2["run_id"] in ids
    a_row = next(x for x in rows if x.get("run_id") == out1["run_id"])
    assert a_row.get("chart_timeframe") == "1h"
    summ = a_row.get("aggregate_summary") or {}
    assert summ.get("touch_count") == 3
    assert summ.get("win_rate_by_rr") == 0.4


def test_tag_preset_roundtrip(tmp_repo: Path) -> None:
    p0 = s.get_tag_preset(tmp_repo)
    assert isinstance(p0.get("tags"), list)
    out = s.save_tag_preset(tmp_repo, ["A", "B", "A", " ", "C"])
    assert out["tags"] == ["A", "B", "C"]
    p1 = s.get_tag_preset(tmp_repo)
    assert len(p1.get("tags") or []) == 3


def test_delete_all_annotations(tmp_repo: Path) -> None:
    req = {"data_file": "a.csv", "zone_timeframes": ["1D"]}
    out = s.save_run(tmp_repo, req, {"ok": True, "trades": [], "ohlc": []})
    rid = out["run_id"]
    s.patch_annotation(tmp_repo, rid, "z1", "Demand", "1D", "tk-1", 0, 0, 0, [], ["t1"], "x")
    s.patch_annotation(tmp_repo, rid, "z2", "Supply", "1D", "tk-2", 1, 0, 0, [], ["t2"], "y")
    assert len(s.list_journal_entries(tmp_repo)) == 2
    out2 = s.delete_all_annotations(tmp_repo)
    assert out2.get("annotations_deleted") == 2
    assert len(s.list_journal_entries(tmp_repo)) == 0
