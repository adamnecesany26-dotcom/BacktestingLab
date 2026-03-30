"""moduleOutputs S/D zóny pro Detailed graf — flat vs merged (viz docker/engine.py)."""

from __future__ import annotations

import docker.engine as engine_mod


def test_append_sd_chart_zones_from_merge_flat_dedupes_and_serializes() -> None:
    flat = [
        {
            "name": "Demand",
            "value_low": 99.0,
            "value_high": 100.5,
            "date_start": "2024-06-01",
            "date_end": "2024-06-20",
            "start_idx": 0,
            "end_idx": 19,
            "pivot_idx": 2,
            "fillcolor": "rgba(34, 197, 94, 0.35)",
            "_source_tf": "1d",
        },
        {
            "name": "Demand",
            "value_low": 99.0,
            "value_high": 100.5,
            "date_start": "2024-06-01",
            "date_end": "2024-06-20",
            "start_idx": 0,
            "end_idx": 19,
            "pivot_idx": 2,
            "_source_tf": "4h",
        },
    ]
    zones: list = []
    engine_mod._append_sd_chart_zones_from_merge_flat(flat, zones)
    assert len(zones) == 1
    assert zones[0]["name"] == "Demand"
    assert zones[0]["primaryTf"] == "1d"


def test_module_zone_dict_primary_tf_from_source() -> None:
    z = engine_mod._module_zone_dict_for_chart(
        {
            "name": "Supply",
            "value_low": 100.0,
            "value_high": 101.0,
            "date_start": "2024-01-10",
            "date_end": "2024-02-01",
            "_source_tf": "1d",
        }
    )
    assert z is not None
    assert z["primaryTf"] == "1d"
