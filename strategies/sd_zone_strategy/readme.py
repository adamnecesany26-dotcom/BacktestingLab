# -*- coding: utf-8 -*-
# =============================================================================
# STRATEGIE: S/D ZONE (sd_zone_strategy) – readme.py (pouze komentáře)
# =============================================================================
#
# Kód strategie k vložení do aplikace: main.py v tomto adresáři.
# Doplňující Markdown: README.md, MODULE_CONTRACT.md, SD_def.md / SD_de.md v kořeni repa.
#
# =============================================================================
# Požadavky v aplikaci
# =============================================================================
#
# 1) Modul S/D s get_zones (název souboru v Moduly typicky S_D_Zones nebo SD_identificator).
# 2) Volitelně Swing HL nebo HL_identificator pokud trend_filter_enabled=True (get_trend odtud).
# 3) PARAM_MODULE_CHAIN = "HL_identificator" (přesný název položky v Moduly, např. i "Swing HL") aby se přibalil swing modul a jeho
#    VIEW_PARAMS šly do záložky Moduly spolu se strategií.
#
# =============================================================================
# Logika (stručně, „nová logika“)
# =============================================================================
#
# • Zóny z MTF (zone_timeframes), merge překryvů, prefer_higher_tf.
# • Exekuce na TF datového feedu; exec_timeframe je záměr (varování při nesouladu).
# • Vstup po opuštění zóny: entry_model limit vs market_momentum; OCO TP/SL po fillu.
# • zone_max_bars strategie přepisuje zone_extend_right_bars při volání modulu.
# • max_base_length, require_inducement: panel strategie.
# • Trend filtr: get_trend na _effective_trend_tf (primární TF zóny vs trend_chart_timeframe).
#
# =============================================================================
# Parametry
# =============================================================================
#
# PARAMS + PARAMS_META: jádro v main.py (co vidí panel Parametry strategie).
# Detaily modulů: VIEW_PARAMS v jednotlivých modulech (S/D, Swing HL) – musí souhlasit s View.
#
# =============================================================================
# Kontrola před nasazením
# =============================================================================
#
# • Shoda get_zones kontraktu: MODULE_CONTRACT.md
# • Žádné inline # v VIEW_PARAMS modulech
# • V Moduly potvrzené závislosti ve stejném pořadí jako očekává import v main.py
#
# =============================================================================

__all__: list[str] = []
