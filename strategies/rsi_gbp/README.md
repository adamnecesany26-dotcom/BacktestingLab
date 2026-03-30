# Z-score mean reversion — swing (30m a jemnější TF)

Strategie vychází z myšlenky [Mean Reversion se z-score](https://machinelearning-basics.com/mean-reversion-trading-strategy-using-python/), ale **není 1:1** s článkem: ten počítá na **denních** datech a jednoduchý signál; na **30m** by stejné parametry (krátké okno, úzké pásmo, výstup u okraje pásma) generovaly stovky až tisíce obchodů ročně.

Tato verze je nastavená jako **swing**: delší okno σ, vyšší práh vstupu, výstup až u **návratu k průměru** (`exit_neutral_z`), zpřísněné vstupy a cooldown.

> Složka `rsi_gbp` je historický název — jádrem je SMA + z-score, ne RSI.

## Logika (zkráceně)

1. **SMA** a **StdDev** na `close`, stejné období `mr_window`.
2. **z** = `(close - SMA) / StdDev`.
3. **Long** pod `−n_std`, **short** nad `+n_std` (stejně jako v článku), ale:
   - **vstup** jen na náběžnou hranu (`entry_edge_only`) a/nebo **N barů po sobě** v extrému (`min_extreme_bars` > 1),
   - po výstupu **cooldown** v počtu barů (`cooldown_bars`),
   - **výstup** z longu když `z >= exit_neutral_z` (výchozí **0** = návrat k průměru), ne když `z` jen dojede k **−n_std**,
   - ze shortu symetricky: `z <= exit_neutral_z`, plus **SL/TP USD**, plus opačný extrém (`z > n_std` u longu, `z < −n_std` u shortu).

## Parametry (`PARAMS`)

| Parametr | Výchozí (swing 30m) | Poznámka |
|----------|---------------------|----------|
| `mr_window` | 96 | ~2–3 obchodní dny při 30m (16 barů/den). Rozsah typicky **48–240**. |
| `n_std` | 2.0 | Vyšší = méně, ostřejší signály. Článek na dailies často **1.25**; na 30m často **2–2.5**. |
| `exit_neutral_z` | 0.0 | Long končí při `z ≥` této hodnoty, short při `z ≤`. **0** = až u „středu“ v jednotkách σ. |
| `entry_edge_only` | True | Long: předchozí bar `z ≥ −n_std`, aktuální `z < −n_std`. `min_extreme_bars > 1` toto přebíjí. |
| `min_extreme_bars` | 1 | Pokud **> 1**: vyžaduje **N** po sobě jdoucích barů v extrému (bez podmínky hrany). |
| `cooldown_bars` | 4 | Minimální počet barů po uzavření před novým vstupem (~2 h při 30m). **0** = vypnuto. |
| `stop_loss_usd` / `take_profit_usd` | 250 / 500 | Přepočet přes pip × lot. |
| `lot_size`, `pip_size`, `pip_value` | — | Forex / instrument |
| `smoke_trade_every_bars` | 0 | Test engineu |

### Interakce `entry_edge_only` vs `min_extreme_bars`

- **`min_extreme_bars` > 1**: platí jen **N po sobě** barů s `z < −n_std` (long) / `z > n_std` (short); hrana se **nepoužije** (aby nevznikl rozpor s požadavkem na hloubku).
- **`min_extreme_bars` == 1** a **`entry_edge_only` == True**: klasický **průnik** do pásma.
- Oba **False** u hraně typicky nedává smysl — zůstává prosté `z` v extrému každý bar (časté obchody).

## Budoucí rozšíření (není v kódu)

- **Vyšší timeframe:** z-score z 4h/dnů, exekuce na 30m (vyžaduje multi-data v Backtraderu / runneru).
- **HTF filtr** (např. trendová MA na agregátu) — až bude jasné, jak aplikace předává `data0` / `data1`.

---

[Backtesting_app](../../README.md) · [READMEADAM.md](../../READMEADAM.md)
