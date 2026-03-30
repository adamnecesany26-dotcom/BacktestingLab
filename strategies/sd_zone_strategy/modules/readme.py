# -*- coding: utf-8 -*-
# =============================================================================
# MODULY VE SLOŽCE modules/ – jeden readme.py, dvě logické jednotky
# =============================================================================
#
# V aplikaci má každý modul vlastní položku a vlastní main.py. Zde jsou dva zdrojové
# soubory vedle sebe jen pro vývoj v gitu; při kopírování vlož KAŽDÝ zvlášť jako samostatný modul.
#
# =============================================================================
# ČÁST A – S_D_Zones.py  (Supply/Demand)
# =============================================================================
#
# Viz také: examples/sd_zones/readme.py a strategies/sd_zone_strategy/MODULE_CONTRACT.md
#
# - get_zones, detect, get_line; závislost na HL_identificator / Swing_HL.
# - Strategie předává zone_extend_right_bars = zone_max_bars ze strategie.
# - Povinná pole Demand/Supply pro strategii: start_idx, end_idx, pivot_idx, value_*, name.
#
# =============================================================================
# ČÁST B – Swing_HL.py  (Swing High/Low, BOS, trend)
# =============================================================================
#
# Viz také: examples/swing_hl_detector/readme.py
#
# - get_swings, get_major_swings, get_bos, get_trend, detect, get_line, get_zones
# - Pro sd_zone_strategy: zdroj get_trend a konzistence s S/D view.
# - VIEW_PARAMS bez čárka+komentář na řádku hodnoty (opraveno v repu).
#
# =============================================================================
# Názvy souborů v UI
# =============================================================================
#
# Modul se jmenuje podle tebe; strategie hledá balíčky modules.S_D_Zones / SD_identificator
# a modules.HL_identificator / Swing_HL. Názvy souborů (.py) v aplikaci by měly odpovídat
# importům (bez mezer, typicky Swing_HL, S_D_Zones).
#
# =============================================================================

__all__: list[str] = []
