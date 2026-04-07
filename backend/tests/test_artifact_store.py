"""Úložiště artefaktů fáze 1."""

import json
import tempfile
from pathlib import Path

from app.services import artifact_store as store
from app.services.artifact_store import (
    build_hl_manifest_skeleton,
    compute_dataset_id,
    dataset_dir,
    hl_manifest_path,
    hl_version_dir,
    manifest_is_stale_fingerprint,
    read_json_if_exists,
    write_atomic_json,
)


def test_compute_dataset_id_stable():
    a = compute_dataset_id("futures/NQ.txt", "abc123", years=1.0)
    b = compute_dataset_id("futures/NQ.txt", "abc123", years=1.0)
    assert a == b
    assert len(a) == 20


def test_compute_dataset_id_years_full_vs_numeric():
    a = compute_dataset_id("futures/NQ.txt", "fp", years=None)
    b = compute_dataset_id("futures/NQ.txt", "fp", years=0.0)
    assert a == b


def test_path_layout_and_manifest_roundtrip():
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        did = compute_dataset_id("data/x.csv", "fp9", years=2.0)
        mp = hl_manifest_path(base, did)
        assert mp == base / ".backtest_artifacts" / did / "hl" / "v1" / "manifest.json"
        assert hl_version_dir(base, did) == dataset_dir(base, did) / "hl" / "v1"

        man = build_hl_manifest_skeleton(
            dataset_id=did,
            data_file="data/x.csv",
            data_fingerprint="fp9",
            time_range_start="2020-01-01",
            time_range_end="2022-01-01",
            years=2.0,
            hl_module_digest="deadbeef",
            params_snapshot={"x": 1},
            tf_ladder=["1M", "1w", "1d"],
        )
        write_atomic_json(mp, man)
        loaded = read_json_if_exists(mp)
        assert loaded is not None
        assert loaded["dataset_id"] == did
        assert loaded["kind"] == "hl"
        raw = mp.read_text(encoding="utf-8")
        json.loads(raw)


def test_manifest_stale_fingerprint():
    m = {"host_dataset_fingerprint": "old"}
    assert manifest_is_stale_fingerprint(m, "new") is True
    assert manifest_is_stale_fingerprint(m, "old") is False
