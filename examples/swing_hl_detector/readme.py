# -*- coding: utf-8 -*-
# ================================================================================
# SWING HL MODUL – Kompletní dokumentace (pouze komentáře; žádná logika)
# ================================================================================
#
# Tento soubor slouží jako referenční dokumentace. Implementace: swing_hl_detector.py
# (v tomto adresáři) nebo strategies/sd_zone_strategy/modules/Swing_HL.py v repu.
#
# ================================================================================
# 1. PŘEHLED
# ================================================================================
#
# Modul detekuje Swing High/Low, Internal H/L, BOS (Break of Structure) a trend.
#
# Vstup: pandas DataFrame OHLC (open, high, low, close), index = datetime.
#
# ================================================================================
# 2. ROZHRANÍ
# ================================================================================
#
# Strategie / engine:
#   get_swings(ohlc, params) -> list[dict] | {"swings","internals"} při include_internals
#   get_major_swings(ohlc, params) -> major_high / major_low body
#   get_bos(ohlc, params) -> bos_bullish / bos_bearish události
#   get_trend(ohlc, params) -> {"score": [...], "state": [...]}  (-100 až +100)
#
# View:
#   detect(ohlc, params) -> markery
#   get_line(ohlc, params) -> Trend segmenty
#   get_zones(ohlc, params) -> BOS zóny
#
# ================================================================================
# 3. KONTRAKT S APLIKACÍ
# ================================================================================
#
# - V modulu v UI musí být VIEW_PARAMS jako čistý dict: BEZ inline komentářů za čárkou
#   na řádku hodnoty (parser View může rozbít JSON-like výřezy).
# - PARAM_MODULE_CHAIN ve strategii: přesný název položky v Moduly (např. "Swing HL"),
#   aby se main.py modulu přibalil a VIEW_PARAMS šly do záložky Moduly.
# - S/D modul a strategie sd_zone_strategy importují get_trend / swingy z
#   modules.HL_identificator nebo modules.Swing_HL (priorita HL_identificator).
#
# ================================================================================
# 4. PARAMETRY
# ================================================================================
#
# Konkrétní čísla viz VIEW_PARAMS ve zdrojovém .py (timeframe, ATR, EMA, max_bars, …).
# TREND_PARAMS lze mergovat do PARAMS strategie pro prahy trend_min_long / trend_max_short.
#
# ================================================================================
# 5. ALGORITMUS (stručně)
# ================================================================================
#
# Swing: kandidát -> nahrazení -> potvrzení (ATR) -> uzamčení.
# BOS: close přes úroveň + acceptance_bars bez návratu.
# Trend: Alignment, Slope, Position, Structure -> skóre a state řetězce.
#
# ================================================================================

__all__: list[str] = []
