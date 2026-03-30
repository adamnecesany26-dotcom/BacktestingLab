# Strategie S/D zón (Supply & Demand)

Strategie hledá na grafu **oblasti poptávky (Demand)** a **nabídky (Supply)** podle modulu S/D zón a po **odchodu ceny od zóny** vstupuje **limitem** (hranice/střed/vlastní %) nebo **marketem** po signálu momentum — podle **`entry_model`** (`limit` | `market_momentum`) a `entry_mode` / `entry_pct`.

## Co musíš mít v aplikaci

1. Ve strategii vložený kód z tohoto `main.py`.  
2. V pravém panelu v sekci **Moduly** vybraný modul **S/D Zones** (`get_zones`, např. `S_D_Zones` / `SD_identificator`) a **Potvrdit**.  
3. Volitelně **HL identificator** nebo **Swing HL** — potřeba jen pokud používáš **filtr trendu** (`trend_filter_enabled`), protože strategie volá `get_trend` ze stejného modulu jako S/D view.

Bez modulu S/D zón strategie neobchoduje.

## Jak vstup funguje (zjednodušeně)

- Nejdřív musí cena **opustit** zónu (Demand: low nad horní hranicí; Supply: high pod spodní).  
- Pak podle **`entry_model`**: **limit** (odvozeně limit_edge / limit_mid + `entry_pct` u režimu pct) nebo **market_momentum** (čekání na bull/bear bar + close za zónou). Legacy pole `entry_style` v JSON má přednost, pokud je vyplněné.  
- Když cena zónu **invaliduje** (close na TF zóny), zóna přestane platit.  
- Zóny se berou z **hrubšího TF** (např. denní), vstupy na **exekučním TF** dat — viz parametry.

## Stop a cíl (profit)

- **Stop**: vzdálenost **`stop_offset_pct` × výška zóny** od protilehlé hrany (Demand pod `value_low`, Supply nad `value_high`); záporný offset posouvá stop **dovnitř** zóny.  
- **Cíl** je vždy **`target_rr` × riziko** (vzdálenost entry ↔ stop).  
- Detaily: **`SD_de.md`** a hlavička `main.py`.

## Důležité parametry (náhled)

Panel **Parametry strategie** ukazuje jen slovník `PARAMS`: MTF zón, exekuční TF, model vstupu (limit / momentum), RR, životnost zóny, inducement, stop offset, filtr trendu (přepínač), max. délka base.

| Oblast | Příklad | Smysl |
|--------|---------|--------|
| `zone_timeframes` | např. `1d,4h` | Na jakých TF se staví zóny (MTF merge) |
| `exec_timeframe` | např. `30m` | Záměr TF vstupů (skutečný krok = data) |
| `zone_max_bars` | 60 | Životnost zóny vpravo v `get_zones` |
| `entry_model` / `entry_mode` / `entry_pct` | limit + edge/mid/pct | Vstup |
| `require_inducement` / `max_base_length` | — | Filtry zóny (strategie) |
| `target_rr` / `stop_offset_pct` | — | Cíl a stop (stop může být i záporný offset = uvnitř zóny) |
| `trend_filter_enabled` | bool | Zapne filtr podle `get_trend` |
| Modul S/D | `VIEW_PARAMS` | ATR, base prahy, overlap, **trend okno a prahy**, … |
| Swing HL | `VIEW_PARAMS` | **EMA, smooth, lookback** pro trend skóre |

Další hodnoty (max hold, čekání na limit, momentum detaily, práh merge MTF, `trend_chart_timeframe`, …) jsou jen ve **`Strategy.params`** v kódu s výchozími hodnotami.

**View:** náhled zón a trend drž v shodě přes `VIEW_PARAMS` modulů S/D a Swing HL.

**Detailed (Results):** obchody jsou ze simulace; zóny z `moduleOutputs` musí používat stejný TF jako strategie (v `VIEW_PARAMS` modulu S/D pole `timeframe` = např. `1d`). Na intraday grafu frontend zarovná období zóny z čistého data `YYYY-MM-DD` na první/poslední svíčku v těchto dnech. Volitelně lze v Detailed zvolit hrubší **TF grafu** (agregace svíček).

Kontrakt polí z `get_zones`: viz **[MODULE_CONTRACT.md](MODULE_CONTRACT.md)**.

**Simulace vs. live:** limitní vstupy bez vlastního spread modelu v kódu strategie (globální slippage/spread z nastavení běhu). Výstup z obchodu z jednoho baru OHLC — při současném průniku cíle a stopu v jedné svíčce nejde o pořadí ticků uvnitř baru. Detaily v hlavičce `main.py` a v [READMEADAM.md](../../READMEADAM.md) (sekce *Strategie sd_zone_strategy*).

## Kroky: spustit backtest

1. Zkopíruj `main.py` do strategie v aplikaci.  
2. Přidej modul **S/D Zones** (a při trend filtru i **Swing HL**) a potvrď.  
3. Vyber futures instrument (NQ, ES, …) a data.  
4. Nastav parametry (nebo nech výchozí) a spusť **Run**.

---

Platforma: **[Backtesting_app](../../README.md)** · Průvodce UI: **[READMEADAM.md](../../READMEADAM.md)** · Kontrakt `get_zones`: **[MODULE_CONTRACT.md](MODULE_CONTRACT.md)** · Definice zón: **[SD_def.md](../../SD_def.md)** · Obchodní spec: **[SD_de.md](../../SD_de.md)**
