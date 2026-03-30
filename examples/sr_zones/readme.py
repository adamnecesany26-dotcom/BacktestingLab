# -*- coding: utf-8 -*-
# =============================================================================
# MODUL SUPPORT / RESISTANCE (major swing) – dokumentace
# =============================================================================
#
# Implementace k vložení do aplikace:
#   examples/sr_zones.py   (soubor v nadřazeném adresáři examples/)
#
# Tento readme.py je ve složce examples/sr_zones/ vedle README.md (přehledová dokumentace).
#
# =============================================================================
# Závislosti
# =============================================================================
#
# V hlavičce sr_zones.py: VIEW_DEPENDENCIES: Swing HL, HL identificator
# Kód volá get_major_swings z modules.Swing_HL nebo modules.HL_identificator.
# Bez jednoho z těchto modulů nebudou body pro S/R.
#
# =============================================================================
# Exporty
# =============================================================================
#
# get_zones(ohlc, params) -> list zón:
#   date_start, date_end, value_low, value_high, fillcolor, name (Support|Resistance),
#   touches, strength, source ("cluster_2touch" | "range_consolidation")
#
# detect(ohlc, params) -> zjednodušené body z get_zones pro markery
#
# =============================================================================
# Logika (stručně)
# =============================================================================
#
# Pouze major swing high/low. Platná zóna:
#   (A) dva validní dotyky úrovně (cena mezitím „odjela“ od úrovně), nebo
#   (B) konsolidace mezi dvěma major body (parametry min_consolidation_bars, max_range_bars).
#
# =============================================================================
# VIEW_PARAMS (klíče ve sr_zones.py)
# =============================================================================
#
# timeframe, atr_period, min_bars_between_swings, max_bars, acceptance_bars,
# cluster_atr_threshold, min_travel_atr, retest_lookback_bars,
# min_consolidation_bars, max_range_bars
#
# Stejně jako u ostatních modulů: žádné inline komentáře uvnitř dict hodnot na řádku.
#
# =============================================================================

__all__: list[str] = []
