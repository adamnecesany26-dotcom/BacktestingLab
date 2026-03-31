"""View API: optional start_iso / end_iso slice after years cutoff."""

from pathlib import Path

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
