"""View API: optional start_iso / end_iso slice after years cutoff."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.api import view as view_mod
from app.api.view import ViewRequest


@pytest.fixture
def tiny_parquet(tmp_path: Path) -> Path:
    idx = pd.date_range("2024-06-01", periods=5, freq="1D", tz=None)
    df = pd.DataFrame(
        {"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100.0},
        index=idx,
    )
    p = tmp_path / "slice_test.parquet"
    df.to_parquet(p, index=True)
    return p


def test_load_ohlc_slice_inclusive(monkeypatch: pytest.MonkeyPatch, tiny_parquet: Path):
    data_dir = tiny_parquet.parent

    def fake_get_data_dir() -> Path:
        return data_dir

    monkeypatch.setattr(view_mod, "_get_data_dir", fake_get_data_dir)
    rel = tiny_parquet.name
    full = view_mod._load_ohlc(rel, 0.0, None, None)
    assert len(full) == 5

    cut = view_mod._load_ohlc(rel, 0.0, "2024-06-02", "2024-06-04")
    assert len(cut) == 3
    assert cut.index.min() == pd.Timestamp("2024-06-02")
    assert cut.index.max() == pd.Timestamp("2024-06-04")

def test_load_ohlc_slice_accepts_tz_aware_bounds_on_naive_index(
    monkeypatch: pytest.MonkeyPatch, tiny_parquet: Path
):
    """
    Regression guard: tz-aware ISO bounds (e.g. trailing 'Z') must not raise TypeError
    when the OHLC index is tz-naive; the API should slice deterministically.
    """
    data_dir = tiny_parquet.parent

    def fake_get_data_dir() -> Path:
        return data_dir

    monkeypatch.setattr(view_mod, "_get_data_dir", fake_get_data_dir)
    rel = tiny_parquet.name

    # tz-aware bounds should be accepted and interpreted in tz-naive space for tz-naive index.
    cut = view_mod._load_ohlc(rel, 0.0, "2024-06-02T00:00:00Z", "2024-06-04T00:00:00Z")
    assert len(cut) == 3
    assert cut.index.min() == pd.Timestamp("2024-06-02")
    assert cut.index.max() == pd.Timestamp("2024-06-04")


def test_view_request_has_start_end_iso():
    """Regression: handler uses req.start_iso / req.end_iso — model must define them (no AttributeError)."""
    r = ViewRequest(
        data_file="futures_30m/nq_view_demo_2025.parquet",
        years=0.0,
        start_iso="2025-06-01T00:00:00",
        end_iso="2025-06-30T23:59:59",
    )
    assert r.start_iso == "2025-06-01T00:00:00"
    assert r.end_iso == "2025-06-30T23:59:59"
    parsed = ViewRequest.model_validate(
        {"data_file": "mock/x.csv", "years": 0.25, "start_iso": "2024-01-01", "end_iso": None}
    )
    assert parsed.start_iso == "2024-01-01"
    assert parsed.end_iso is None


def test_sanitize_for_json_replaces_nan_in_markers():
    raw = {
        "ohlc": [],
        "markers": [
            {"date": "2024-01-01", "value": float("nan"), "type": "high"},
            {"date": "2024-01-02", "value": np.float64(np.nan), "type": "low"},
        ],
        "zones": [{"value_low": float("inf")}],
    }
    out = view_mod._sanitize_for_json(raw)
    json.dumps(out)
    assert out["markers"][0]["value"] is None
    assert out["markers"][1]["value"] is None
    assert out["zones"][0]["value_low"] is None
