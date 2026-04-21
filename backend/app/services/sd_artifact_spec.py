"""
S/D artifact schema (fáze 3+) — konvence sloupců pro ``zones.parquet``.

Životní cyklus ve v1 vychází z ``examples.sd_zones.get_zones`` (end_idx / invalidace).
``touch2`` může být prázdné dokud nebude doplněna druhá vlna dotyků v modulu.
"""

from __future__ import annotations

# Sloupce jedné řádkové zóny v Parquet (ploché; touch = ISO + cena).
SD_ZONE_PARQUET_COLUMNS: tuple[str, ...] = (
    "zone_id",
    "kind",
    "source_tf",
    "born_at",
    "range_start_at",
    "range_end_at",
    "died_at",
    "price_low",
    "price_high",
    "range_size",
    "base_length",
    "has_inducement",
    "impulse_score",
    "touch1_at",
    "touch1_price",
    "touch2_at",
    "touch2_price",
    "max_age_before_death",
    "with_trend",
    "pivot_idx",
    "start_idx",
    "end_idx",
    "touch_events_json",
)
