"""
Unit testy pomocných funkcí sd_zone_strategy (bez Backtrader běhu).
Spuštění z kořene repa:
  python strategies/sd_zone_strategy/test_sd_zone_strategy.py
nebo:
  python -m unittest strategies.sd_zone_strategy.test_sd_zone_strategy -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

# Dovolit import main.py jako modul vedle tohoto souboru
_PKG_DIR = Path(__file__).resolve().parent
if str(_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(_PKG_DIR))

import main as sd  # noqa: E402
from types import SimpleNamespace


class TestParseZoneTimeframes(unittest.TestCase):
    def test_csv(self):
        p = SimpleNamespace(zone_timeframes="4h,1d", zone_timeframe="1d")
        self.assertEqual(sd._parse_zone_timeframes(p), ["4h", "1d"])

    def test_list_json_from_api(self):
        p = SimpleNamespace(zone_timeframes=["4h"], zone_timeframe="1d")
        self.assertEqual(sd._parse_zone_timeframes(p), ["4h"])


class TestTrendTf(unittest.TestCase):
    def test_effective_trend_tf_coarser_zone(self):
        self.assertEqual(sd._effective_trend_tf("1d", "4h"), "1d")

    def test_effective_trend_tf_finer_zone(self):
        self.assertEqual(sd._effective_trend_tf("1h", "4h"), "4h")

    def test_effective_trend_tf_empty_min_uses_zone(self):
        self.assertEqual(sd._effective_trend_tf("4h", ""), "4h")


class TestExecTfMinutes(unittest.TestCase):
    def test_expected_30m(self):
        self.assertEqual(sd._exec_timeframe_expected_minutes("30m"), 30.0)

    def test_expected_2h(self):
        self.assertEqual(sd._exec_timeframe_expected_minutes("2h"), 120.0)

    def test_infer_median(self):
        idx = pd.date_range("2025-01-01", periods=5, freq="30min", tz="UTC")
        df = pd.DataFrame({"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5}, index=idx)
        m = sd._infer_median_bar_minutes(df)
        self.assertIsNotNone(m)
        assert m is not None
        self.assertAlmostEqual(m, 30.0, places=3)


class TestResolveEntryStyle(unittest.TestCase):
    def test_legacy_entry_style_momentum(self):
        self.assertEqual(
            sd._resolve_effective_entry_style("limit", "market_momentum", "edge"),
            "market_momentum",
        )

    def test_entry_model_momentum(self):
        self.assertEqual(
            sd._resolve_effective_entry_style("market_momentum", "", "edge"),
            "market_momentum",
        )

    def test_limit_mid(self):
        self.assertEqual(
            sd._resolve_effective_entry_style("limit", "", "mid"),
            "limit_mid",
        )

    def test_limit_edge_and_pct(self):
        self.assertEqual(
            sd._resolve_effective_entry_style("limit", "", "edge"),
            "limit_edge",
        )
        self.assertEqual(
            sd._resolve_effective_entry_style("limit", "", "pct"),
            "limit_pct",
        )


class TestBuildMergedZones(unittest.TestCase):
    def test_merge_demand_overlap(self):
        idx = pd.date_range("2025-01-01", periods=50, freq="1h", tz="UTC")
        exec_df = pd.DataFrame(
            {
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
            },
            index=idx,
        )

        def fake_get_zones(zoh, mp):
            n = len(zoh)
            return [
                {
                    "name": "Demand",
                    "value_low": 99.5,
                    "value_high": 100.5,
                    "start_idx": n - 5,
                    "end_idx": n - 1,
                    "pivot_idx": n - 3,
                }
            ]

        def module_params_fn(tf: str) -> dict:
            return {"timeframe": tf}

        merged, flat = sd._build_merged_sd_zones(
            exec_df,
            ["1h"],
            fake_get_zones,
            module_params_fn,
            prefer_higher_tf=True,
            overlap_threshold=0.25,
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].get("name"), "Demand")
        self.assertIn("_primary_tf", merged[0])


class TestMapPivotTrend(unittest.TestCase):
    def test_map_same_tf(self):
        idx = pd.date_range("2025-01-01", periods=40, freq="4h", tz="UTC")
        exec_df = pd.DataFrame(
            {"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5},
            index=idx,
        )
        tp = {"timeframe": "4h"}
        j = sd._map_zone_pivot_to_trend_score_index(exec_df, "4h", "4h", 10, tp)
        self.assertGreaterEqual(j, 0)


if __name__ == "__main__":
    unittest.main()
