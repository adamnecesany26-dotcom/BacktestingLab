# Strategie RSI (forex / GBP páry)

Jednoduchá strategie podle RSI: koupíš, když trh „vyleze“ z přeprodanosti, prodáš, když „spadne“ z překoupenosti. Výstup z obchodu je buď opačným signálem RSI, nebo pevným ziskem / ztrátou v **dolarech** (ne v procentech).

## Na co si dát pozor

- V aplikaci nastav **Instrument Type = Forex** a u instrumentu správně **lot, pip size, pip value** (např. GBPUSD). Od toho se odvíjí přepočet TP/SL z USD na cenu.
- Strategie **nepotřebuje** žádné moduly z knihovny – jen data OHLC.

## Jak to funguje (lidsky)

1. **Long (nákup)**  
   Na předchozí svíčce byl RSI na nebo pod úrovní „oversold“ (výchozí 30). Na aktuální svíčce je RSI **nad** touto úrovní → vstup do longu.

2. **Short (prodej)**  
   Na předchozí svíčce byl RSI na nebo nad „overbought“ (výchozí 70). Na aktuální svíčce je RSI **pod** touto úrovní → vstup do shortu.

3. **Výstup z pozice**  
   - Cena dosáhne **take profit** v USD (výchozí +400) nebo **stop loss** v USD (výchozí −250),  
   - nebo RSI znovu protne opačné pásmo (např. u longu návrat do překoupenosti).

## Hlavní parametry

| Parametr | Výchozí | Co znamená |
|----------|---------|------------|
| `rsi_period` | 14 | Délka RSI |
| `rsi_os` | 30 | Přeprodanost |
| `rsi_ob` | 70 | Překoupenost |
| `take_profit_usd` | 400 | Cíl zisku v USD na pozici |
| `stop_loss_usd` | 250 | Stop v USD na pozici |
| `lot_size` | 1 | Velikost lotu |
| `pip_size` | 0.0001 | Velikost pipu (u párů s JPY bývá jiná) |
| `pip_value` | 10 | Hodnota jednoho pipu v USD při daném lotu |

## Jak strategii spustit

1. V aplikaci vytvoř nebo otevři strategii a vlož kód z `main.py`.  
2. Nastav forex instrument a broker/lot parametry.  
3. **Moduly nevybírej** (nejsou potřeba).  
4. Spusť backtest.

---

Strategie běží v **[Backtesting_app](../../README.md)**. Uživatelský průvodce: **[READMEADAM.md](../../READMEADAM.md)**.
