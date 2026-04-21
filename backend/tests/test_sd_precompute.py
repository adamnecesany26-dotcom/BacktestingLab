"""S/D precompute (fáze 3) — závislost na H/L manifestu."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.services.artifact_store import hl_manifest_path, read_json_if_exists, sd_manifest_path
from app.services.hl_precompute import run_hl_precompute
from app.services.sd_precompute import compute_sd_module_digest, run_sd_precompute


def test_sd_precompute_requires_hl_manifest():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        idx = pd.date_range("2021-01-01", periods=120, freq="1D", tz="UTC")
        df = pd.DataFrame(
            {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
            index=idx,
        )
        df.to_parquet(data_dir / "x.parquet")
        with pytest.raises(ValueError, match="H/L artefakt"):
            run_sd_precompute(
                data_dir=data_dir,
                data_file="x.parquet",
                artifacts_base=root,
                use_lock=False,
            )


def test_sd_precompute_after_hl_smoke():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        data_dir = root / "data"
        data_dir.mkdir()
        rng = np.random.default_rng(99)
        idx = pd.date_range("2019-06-01", periods=450, freq="1D", tz="UTC")
        close = 100.0 + np.cumsum(rng.normal(0, 0.9, size=len(idx)))
        df = pd.DataFrame(
            {
                "open": np.roll(close, 1),
                "high": close + rng.uniform(0.2, 1.2, size=len(idx)),
                "low": close - rng.uniform(0.2, 1.2, size=len(idx)),
                "close": close,
                "volume": 1.0,
            },
            index=idx,
        )
        df.iloc[0, df.columns.get_loc("open")] = close[0]
        df.to_parquet(data_dir / "daily.parquet")

        hl = run_hl_precompute(
            data_dir=data_dir,
            data_file="daily.parquet",
            artifacts_base=root,
            use_lock=False,
        )
        assert read_json_if_exists(hl_manifest_path(root, hl["dataset_id"]))

        sd = run_sd_precompute(
            data_dir=data_dir,
            data_file="daily.parquet",
            artifacts_base=root,
            use_lock=False,
            zone_timeframes=["1d"],
        )
        assert sd["dataset_id"] == hl["dataset_id"]
        zp = Path(sd["zones_path"])
        assert zp.is_file()
        zdf = pd.read_parquet(zp)
        assert list(zdf.columns)
        assert "range_start_at" in zdf.columns and "range_end_at" in zdf.columns
        assert len(zdf) > 0, (
            "S/D precompute musí načíst Swing_HL (strategies/sd_zone_strategy na sys.path); "
            "jinak get_zones vrací prázdný výsledek a Parquet má 0 řádků."
        )
        assert compute_sd_module_digest()

        sm = read_json_if_exists(sd_manifest_path(root, sd["dataset_id"]))
        assert sm and sm.get("kind") == "sd"
        assert sm.get("hl_manifest_path_rel")
