# Test strategie (EMA křížení)

Tahle strategie **neslouží k hledání výhody na trhu**. Je tu proto, aby šlo rychle ověřit, že engine, objednávky a zobrazování obchodů fungují správně.

## Co dělá

- Počítá **dvě exponenciální průměry** (EMA) z uzavírací ceny – jednu rychlejší, jednu pomalejší.
- **Long:** rychlá EMA se zespodu **protne nahoru** přes pomalou.  
- **Short:** rychlá EMA se shora **protne dolů** přes pomalou.
- Velikost pozice je **počet kontraktů / akcií** (`stake`), ne procenta účtu.
- Volitelně můžeš zapnout **stop loss a take profit v procentech** od vstupní ceny (výchozí −1 % / +2 % u longu).

## Moduly

**Nepotřebuje žádné moduly** – jen vestavěné indikátory Backtraderu.

## Parametry (stručně)

| Parametr | Výchozí |
|----------|---------|
| `ema_fast` | 20 |
| `ema_slow` | 50 |
| `stake` | 1 |
| `use_stops` | True |
| `stop_loss_pct` | 0.01 (1 %) |
| `take_profit_pct` | 0.02 (2 %) |

## Kdy ji použít

- Po nasazení nové verze enginu.  
- Když řešíš chyby s `buy` / `sell` / velikostí pozice.  
- Jako nejjednodušší „kouřový“ test s futures nebo akciemi.

---

**[README.md](../../README.md)** · **[READMEADAM.md](../../READMEADAM.md)**
