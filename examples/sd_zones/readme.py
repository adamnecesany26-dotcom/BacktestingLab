# -*- coding: utf-8 -*-
# =============================================================================
# MODUL SUPPLY / DEMAND ZÓN (S_D_Zones / SD_identificator) – dokumentace
# =============================================================================
#
# Zdroj k vložení do aplikace (Moduly → main.py):
#   • examples/sd_zones.py  (reference v repu)
#   • stejný obsah: strategies/sd_zone_strategy/modules/S_D_Zones.py
#   Před kopírováním do UI ověř, že oba soubory v repu sedí (stejná logika).
#
# =============================================================================
# Závislosti (VIEW_DEPENDENCIES v hlavičce .py)
# =============================================================================
#
# Modul potřebuje swing/BOS z jiného modulu v aplikaci:
#   modules.HL_identificator  NEBO  modules.Swing_HL
# (v kódu je priorita HL_identificator, pak Swing_HL – stejně jako strategie.)
#
# =============================================================================
# Hlavní exporty pro View / engine
# =============================================================================
#
# get_zones(ohlc, params) -> list[dict]
#   Zóny Demand / Supply + pomocné typy dle implementace. Pro strategii sd_zone_strategy
#   MUSÍ mít u Demand/Supply pole:
#     start_idx, end_idx, pivot_idx, value_low, value_high, name ("Demand"|"Supply")
#   Bez start_idx/end_idx strategie zónu v next() nezapracuje (viz MODULE_CONTRACT.md v repu).
#
# detect(ohlc, params) -> markery swingů / internalů pro graf
# get_line(ohlc, params) -> trendová čára (delegace na stejný balíček jako swingy)
#
# =============================================================================
# Sladění se strategií sd_zone_strategy („nová logika“)
# =============================================================================
#
# • Strategie při volání modulu předává mimo jiné:
#     timeframe, data_timeframe  (TF zóny = resamplovaný ohlc)
#     zone_extend_right_bars     PŘEPSÁNO z PARAMS strategie zone_max_bars
# • max_base_length a require_inducement jdou ze panelu STRATEGIE, ne z VIEW_PARAMS modulu.
# • Ostatní geometrie / ATR / base prahy / overlap / trend okno u zóny: VIEW_PARAMS modulu S/D
#   a musejí být shodné ve View a v backtestu.
# • trend_filter_enabled ve strategii zapíná get_trend ze SWING modulu; okno a prahy trendu
#   pro filtr zón berou z merge PARAMS (část z VIEW_PARAMS S/D modulu dle engine).
#
# =============================================================================
# VIEW_PARAMS – formát
# =============================================================================
#
# Dict bez komentářů za hodnotami na řádku (viz varování v hlavičce S_D_Zones.py).
# Popisky pro UI: VIEW_PARAMS_META ve stejném souboru.
#
# =============================================================================
# Dokumentace v repozitáři
# =============================================================================
#
# strategies/sd_zone_strategy/MODULE_CONTRACT.md  – přesný kontrakt get_zones
# SD_def.md, SD_de.md                             – pravidla zón a vstupů
#
# =============================================================================

__all__: list[str] = []
