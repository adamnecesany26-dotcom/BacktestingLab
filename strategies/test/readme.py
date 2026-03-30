# =============================================================================
# TUTORIÁL: Jak psát strategie pro Backtesting aplikaci
# =============================================================================
#
# Tento soubor slouží jako kompletní průvodce pro vývojáře, kteří přicházejí
# k aplikaci a chtějí psát obchodní strategie. Vše je napsáno jako komentáře.
#
# =============================================================================
# 1. JAK APLIKACE FUNGUJE
# =============================================================================
#
# Frontend (Next.js) posílá kód strategie na backend (FastAPI). Backend zapíše
# kód do souboru strategy.py, spustí hostovský subprocess s Backtrader engine,
# který:
#   1. Načte strategii dynamicky (import)
#   2. Načte OHLCV data (CSV/parquet) podle zvoleného instrumentu
#   3. Spustí backtest
#   4. Vrátí JSON: equity, metriky, obchody, OHLC pro grafy
#
# Engine hledá v souboru JEDNU třídu, která dědí z bt.Strategy.
# Název třídy může být libovolný (Strategy, MyStrategy, ...).
#
# =============================================================================
# 2. POVINNÁ STRUKTURA
# =============================================================================
#
# import backtrader as bt
#
#
# class Strategy(bt.Strategy):   # Název třídy libovolný, MUSÍ dědit z bt.Strategy
#     def __init__(self):
#         # Inicializace - indikátory, proměnné
#         pass
#
#     def next(self):
#         # Hlavní logika - volá se na každý nový bar
#         pass
#
# =============================================================================
# 3. ŽIVOTNÍ CYKLUS STRATEGIE
# =============================================================================
#
# __init__(self)
#   - Volá se jednou na začátku.
#   - Vytvoř zde indikátory (EMA, RSI, ...), inicializuj proměnné.
#   - self.data = OHLCV data feed (obvykle jeden).
#
# next(self)
#   - Volá se na KAŽDÝ nový bar (den, hodina, ... podle timeframe).
#   - Index [0] = aktuální bar, [-1] = předchozí bar.
#   - Zde implementuj vstupní/výstupní logiku.
#
# notify_order(self, order)
#   - Volá se při změně stavu objednávky (Submitted, Completed, Canceled, ...).
#   - Nepovinné, ale užitečné pro logování nebo reakci na selhání.
#
# notify_trade(self, trade)
#   - Volá se při otevření/zavření obchodu.
#   - Nepovinné. Engine automaticky zaznamenává obchody.
#
# =============================================================================
# 4. PŘÍSTUP K DATŮM
# =============================================================================
#
# self.data.close[0]   - close aktuálního baru
# self.data.close[-1]  - close předchozího baru
# self.data.open[0]    - open
# self.data.high[0]    - high
# self.data.low[0]     - low
# self.data.volume[0]  - volume
#
# self.data.close.get(0, 10)  - posledních 10 hodnot close (pro indikátory)
#
# len(self)  - počet zpracovaných barů (index aktuálního baru)
#
# =============================================================================
# 5. VYKONÁVÁNÍ OBCHODŮ
# =============================================================================
#
# self.buy(size=1)     - nákup (long), size = počet kontraktů/jednotek
# self.sell(size=1)    - prodej (short)
#
# Při otevřené pozici:
#   - buy() při long přidá, při short zavře short a otevře long
#   - sell() při short přidá, při long zavře long a otevře short
#
# self.close()        - zavře celou pozici
#
# self.position.size   - aktuální velikost pozice
#   - > 0 = long, < 0 = short, == 0 = flat
#
# self.position.price  - průměrná cena vstupu
#
# =============================================================================
# 6. PARAMETRY (params)
# =============================================================================
#
# params = (
#     ("ema_period", 15),
#     ("risk_pct", 0.02),
# )
#
# Přístup: self.params.ema_period, self.params.risk_pct
#
# Pro STOCKS: přidej share_size do params a používej self.buy(size=self.params.share_size).
# Hodnota share_size se předává z UI (Position Size) automaticky.
#
# =============================================================================
# 7. INDIKÁTORY
# =============================================================================
#
# bt.indicators.EMA(self.data.close, period=15)
# bt.indicators.SMA(self.data.close, period=20)
# bt.indicators.RSI(self.data.close, period=14)
# bt.indicators.ATR(self.data, period=14)
# bt.indicators.MACD(self.data.close, ...)
#
# Indikátor vrací linii - přístup: self.ema[0], self.ema[-1]
#
# =============================================================================
# 8. PROSTŘEDÍ BACKTESTU
# =============================================================================
#
# - Počáteční kapitál: 100 000 USD (konfigurovatelné)
# - Komise: 0 (vypnuto)
# - Slippage: 0.1 % (konfigurovatelné)
# - Data: OHLCV z /app/data (instrument, timeframe, years)
#
# =============================================================================
# 9. PRAVIDLA A DOPORUČENÍ
# =============================================================================
#
# - Kontroluj len(self) nebo self.data.buflen() před přístupem k minulým barům.
#   Indikátory potřebují "warmup" - např. EMA(15) až od 15. baru.
#
# - Před self.buy()/self.sell() zkontroluj self.position, aby ses vyhnul
#   duplicitním vstupům na stejném signálu.
#
# - Nepoužívej externí knihovny kromě backtrader - engine má jen bt, pandas.
#
# - Strategie běží jako subprocess na hostu (stejné oprávnění jako backend).
#
# - Engine automaticky zaznamenává obchody (entry/exit, PnL). Nemusíš nic
#   speciálního dělat - stačí volat buy/sell.
#
# =============================================================================
# 10. IMPORT Z INDIKÁTORŮ A MODULŮ
# =============================================================================
#
# Při spuštění backtestu vyber v pravém panelu indikátory a moduly, které
# chceš použít. Klikni na "Potvrdit → zobrazit v menu" - vybrané položky
# se pak zobrazí v levém menu pod soubory strategie (Importované indikátory,
# Importované moduly). Kliknutím na ně můžeš zobrazit a upravit jejich kód.
# Názvy se normalizují (mezery -> _, speciální znaky -> _).
#
# PŘÍKLAD WORKFLOW - Breakout strategie s vlastním indikátorem a modulem:
#
# 1. Vytvoř indikátor "Significant H/L" (bt.Indicator pro significant high/low)
# 2. Vytvoř modul "Break of structure" (funkce nebo třída pro BOS detekci)
# 3. Vytvoř strategii "Breakout Strategy"
# 4. V main.py strategie vyber v panelu: Significant H/L + Break of structure
# 5. Import v main.py:
#
#   from indicators.Significant_H_L import SignificantHL    # indikátor
#   from modules.Break_Of_Structure import break_of_structure  # modul
#
#   class Strategy(bt.Strategy):
#       def __init__(self):
#           self.sig_hl = SignificantHL(...)  # tvůj indikátor
#
#       def next(self):
#           bos = break_of_structure(...)  # tvá funkce z modulu
#           if bos and self.sig_hl[0] > ...:
#               self.buy(size=1)
#
# =============================================================================
# 11. VÍCE SOUBORŮ V STRATEGII
# =============================================================================
#
# Strategie může mít více souborů (main.py, utils.py, signals.py, ...).
# V main.py importuj: from utils import helper
#
# Všechny soubory se při spuštění nahrají do stejného adresáře. Engine načte
# main.py jako vstupní bod (musí obsahovat třídu dědící z bt.Strategy).
#
# =============================================================================
# 12. PŘÍKLAD MINIMÁLNÍ STRATEGIE
# =============================================================================
#
# import backtrader as bt
#
#
# class Strategy(bt.Strategy):
#     def __init__(self):
#         self.ema = bt.indicators.EMA(self.data.close, period=15)
#
#     def next(self):
#         if len(self) < 2:
#             return
#         # Long když cena překročí EMA nahoru
#         if self.data.close[-1] <= self.ema[-1] and self.data.close[0] > self.ema[0]:
#             if self.position.size <= 0:
#                 self.buy(size=1)
#         # Short když cena překročí EMA dolů
#         elif self.data.close[-1] >= self.ema[-1] and self.data.close[0] < self.ema[0]:
#             if self.position.size >= 0:
#                 self.sell(size=1)
#
# =============================================================================