# -*- coding: utf-8 -*-
# =============================================================================
# INDIKÁTOR „REGIME“ / HMM-STYLE HISTOGRAM – dokumentace
# =============================================================================
#
# Implementace:
#   examples/hmm_regime_indicator.py
#
# Poznámka: soubor je záměrně označen jako demo / proxy model (rolling volatilita +
# směr návratů → softmax). Není to plnohodnotný HMM fit (např. hmmlearn); nahraď vlastní
# metodikou, pokud potřebuješ skutečný HMM.
#
# =============================================================================
# Účel ve View
# =============================================================================
#
# get_line(ohlc, params) musí vrátit dict s řadou vhodnou pro spodní histogram
# ve StrategyViewChart, typicky:
#   { "Regime": { "kind": "regime_histogram", "data": [ { "date", "trend", "chop", "high_vol" }, ... ] } }
# Pravděpodobnosti 0–1; backend může normalizovat na součet 1.
#
# =============================================================================
# Parametry
# =============================================================================
#
# VIEW_PARAMS: lookback, vol_window (bez inline komentářů v dictu).
# VIEW_PARAMS_META: titulky pro UI (whatItMeans).
#
# =============================================================================
# Kopírování do aplikace
# =============================================================================
#
# Vytvoř modul typu indikátor / view helper, vlož obsah hmm_regime_indicator.py,
# zkontroluj název řady v get_line (klíč nahoře) vůči tomu, co graf očekává.
#
# =============================================================================

__all__: list[str] = []
