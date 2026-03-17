# -*- coding: utf-8 -*-
"""
================================================================================
SWING HL MODUL – Kompletní dokumentace
================================================================================

Tento soubor slouží jako referenční dokumentace pro developery, klienty a AI asistenty.
Modul detekuje Swing High/Low, Internal H/L, BOS (Break of Structure) a určuje trend.

================================================================================
1. PŘEHLED
================================================================================

Modul Swing HL poskytuje čtyři hlavní funkcionality:

  • SWING H/L      – významné pivot body (Higher High, Higher Low, Lower High, Lower Low)
  • INTERNAL H/L   – vedlejší pivoty pro jemnější strukturu
  • BOS            – Break of Structure (proražení swing úrovně s potvrzením)
  • TREND          – skóre -100 až +100 (EMA-based: Alignment, Slope, Position, Structure)

Vstup: pandas DataFrame s OHLC (sloupce: open, high, low, close), index = datetime.
Výstup: závisí na volané funkci (viz sekce 2).

================================================================================
2. ROZHRANÍ – CO MODUL VRACÍ
================================================================================

2.1 Pro strategii (backtest)

  get_swings(ohlc, params=None)
    → list[dict]  nebo  {"swings": [...], "internals": [...]}  při include_internals=True

    Každý swing: {"type": "high"|"low", "price": float, "index": int, "timestamp": ...}

  get_bos(ohlc, params=None)
    → list[dict]

    Každý BOS: {"swing_index", "swing_date", "bos_index", "bos_date", "level", "type": "bos_bullish"|"bos_bearish"}

  get_trend(ohlc, params=None)
    → {"score": [float,...], "state": [str,...]}

    score: -100 (max bearish) až +100 (max bullish), jeden prvek na bar
    state: "STRONG_BULL" | "WEAK_BULL" | "RANGE" | "WEAK_BEAR" | "STRONG_BEAR"

2.2 Pro View / Results (vizualizace)

  detect(ohlc, params=None)
    → [{"date": "YYYY-MM-DD", "type": "high"|"low"|"internal_high"|"internal_low", "value": float}, ...]

  get_line(ohlc, params=None)
    → {"Trend": {"data": [...], "segments": [{"from": i, "to": j, "color": "..."}, ...]}}

    Trendová čára (EMA 150), barva podle trendu: zelená/červená/šedá

  get_zones(ohlc, params=None)
    → [{"date_start", "date_end", "value_low", "value_high", "fillcolor", "name": "BOS"}, ...]

================================================================================
3. POUŽITÍ VE STRATEGII
================================================================================

  from modules.Swing_HL import get_swings, get_bos, get_trend, TREND_PARAMS

  # Parametry z UI (Parameters panel → záložka modulu)
  mod_params = params.get("module_params", {}).get("Swing HL", {})

  # Swingy
  swings = get_swings(ohlc, mod_params)

  # S internály
  result = get_swings(ohlc, {**mod_params, "include_internals": True})
  swings = result["swings"]
  internals = result["internals"]

  # BOS
  bos_events = get_bos(ohlc, mod_params)

  # Trend filtr
  trend = get_trend(ohlc, mod_params)
  if trend and trend["score"][i] >= params.get("trend_min_long", 30):
      # long setup – trend je bullish
  if trend and trend["score"][i] <= params.get("trend_max_short", -30):
      # short setup – trend je bearish

  # Merge TREND_PARAMS do PARAMS strategie pro doladění po runu
  PARAMS = {**TREND_PARAMS, "swing_tf": "1d", ...}

================================================================================
4. ALGORITMUS SWING H/L
================================================================================

Fáze: kandidát → nahrazení → potvrzení (pullback) → uzamčení

  1. Kandidát: 3-bar pivot (high[i] > high[i±1], low[i] < low[i±1])
  2. Nahrazení: nový pivot může nahradit starého, pokud je extrémnější
  3. Potvrzení: swing se potvrdí po pullbacku ≥ threshold (ATR × atr_multiplier / sensitivity)
  4. Extrémnost: mezi posledním swingem a kandidátem nesmí být vyšší high / nižší low
  5. HH/LL: při Higher High se přidá inferred Low mezi swingy (pokud pullback ≥ min_pullback)

INTERNAL H/L: pivot body, které nejsou na místě swingu. Potvrzení následující svíčkou
  (bearish po internal high, bullish po internal low, nebo velmi malé tělo).

================================================================================
5. BOS (Break of Structure)
================================================================================

BOS = close nad posledním swing high (bullish) nebo pod posledním swing low (bearish).
Následující N svíček (acceptance_bars) nesmí uzavřít zpět pod/přes tuto úroveň.

Výstup get_bos: události s swing_date, bos_date, level, type (bos_bullish/bos_bearish).

================================================================================
6. TREND – EMA-based scoring
================================================================================

Trend není binární. Je to spojité skóre -100 až +100 ze čtyř nezávislých složek:

  • ALIGNMENT (±40)  – zarovnání EMA (fast > med > slow = +40, 2/3 = +25)
  • SLOPE (±20)      – sklon EMA (pohyb trhu)
  • POSITION (±20)   – cena vs EMA (nad/pod equilibrium)
  • STRUCTURE (±20)  – swing struktura (HH/HL vs LL/LH)

Interpretace score:
  +60 až +100  → STRONG_BULL  (zelená)
  +30 až +60   → WEAK_BULL    (světle zelená)
  -30 až +30   → RANGE        (šedá)
  -60 až -30   → WEAK_BEAR    (světle červená)
  -100 až -60  → STRONG_BEAR  (červená)

Skóre se vyhlazuje EMA (trend_score_smooth_period), aby přechody barev byly plynulejší.

================================================================================
7. PARAMETRY (VIEW_PARAMS)
================================================================================

Upravitelné v Parameters panelu (záložka modulu) při backtestu i ve View módu.

  timeframe              "1d"     – škáluje TF_CONFIG (1m, 5m, 15m, 1h, 4h, 1d)
  atr_period             10       – perioda ATR
  atr_multiplier         1.2      – násobitel pro threshold pullbacku
  min_bars_between_swings 3       – min. barů mezi swingy
  max_bars                180     – max. barů v okně (rolling, doporučeno 6M pro 1d)
  sensitivity             1.2    – čím vyšší, tím více swingů
  allow_unconfirmed_last_swing True  – nepotvrzené swingy na konci
  min_pullback_atr_ratio  0.4    – min. pullback pro inferred swing
  include_internals       False   – vrátit i internal H/L
  acceptance_bars         1      – BOS: počet svíček pro potvrzení
  ema_fast                9      – trend: rychlá EMA
  ema_medium              21     – trend: střední EMA
  ema_slow                50     – trend: pomalá EMA
  trend_line_ema_period   150    – perioda trendové čáry (View)
  structure_lookback_swings 4    – počet swingů pro Structure skóre
  trend_score_smooth_period 8    – vyhlazení trend skóre

TREND_PARAMS (pro strategie, merge do PARAMS):
  trend_min_long          30     – min. score pro long
  trend_max_short         -30    – max. score pro short
  trend_filter_enabled     True   – zapnout trend filtr
  trend_require_strong    False  – vyžadovat STRONG místo WEAK
  trend_smooth_period      8     – alias pro trend_score_smooth_period

================================================================================
8. ROLLING WINDOW (max_bars)
================================================================================

Když len(ohlc) > max_bars: data se zpracují v rolling oknech. Swingy z oken se
sloučí a deduplikují. Umožňuje spolehlivé zobrazení na dlouhých periodách (View 2Y+).

Deduplikace: swingy stejného typu v toleranci ±2 barů se slučují, pokud
rozdíl cen < ATR × 0.5 (ochrana double top/bottom).

================================================================================
9. PODMÍNKY A OMEZENÍ
================================================================================

  ✓ Min. atr_period + 2 barů
  ✓ Správně nastavený timeframe v params
  ✓ ATR > 0 (modul používá ATR pro threshold)
  ✓ Strategie předává params z module_params["Swing HL"]

  ⚠ Poslední swingy mohou být nepotvrzené (allow_unconfirmed_last_swing)
  ⚠ Choppy trh → mnoho swingů
  ⚠ Modul je bez stavu – v každém next() se volá get_swings znovu

================================================================================
10. STRUKTURA VÝSTUPŮ
================================================================================

  Swing:     {"type": "high", "price": 21500.5, "index": 42, "timestamp": ...}
  BOS:       {"swing_index": 40, "swing_date": "2024-03-10", "bos_index": 45,
              "bos_date": "2024-03-15", "level": 21480.0, "type": "bos_bullish"}
  Trend:     {"score": [45.2, 48.1, ...], "state": ["WEAK_BULL", "WEAK_BULL", ...]}
  detect:    {"date": "2024-03-12", "type": "high", "value": 21500.5}
  Zone:      {"date_start": "2024-03-10", "date_end": "2024-03-15",
              "value_low": 21480, "value_high": 21480, "name": "BOS"}

================================================================================
Konec dokumentace
================================================================================
"""

__all__: list[str] = []
