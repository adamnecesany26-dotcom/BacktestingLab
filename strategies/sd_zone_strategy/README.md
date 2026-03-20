# Strategie S/D zón (Supply & Demand)

Strategie hledá na grafu **oblasti poptávky (Demand)** a **nabídky (Supply)** podle modulu S/D zón a snaží se u nich **nakoupit** (Demand) nebo **prodat** (Supply) limitem na hraně zóny.

## Co musíš mít v aplikaci

1. Ve strategii vložený kód z tohoto `main.py`.  
2. V pravém panelu v sekci **Moduly** vybrané **oba**:
   - **HL identificator** nebo **Swing HL** (strategie zkouší stejné pořadí jako modul S/D: nejdřív `HL_identificator`, pak `Swing_HL`),
   - **S/D Zones** (název modulu může být třeba `S_D_Zones` nebo `SD_identificator`),
3. Kliknout **Potvrdit**, aby se moduly zkopírovaly do běhu.

Bez obou modulů strategie zóny nedostane a neobchoduje.

## Jak vstup funguje (zjednodušeně)

- U každé platné **Demand** zóny je **limitní nákup** u horní hranice zóny (cena tam „reaguje“).  
- U **Supply** zóny je **limitní prodej** u dolní hranice.  
- Když cena zónu **prakticky znehodnotí** (dle logiky modulu), zóna přestane platit.  
- Zóny se berou z **hrubšího časového rámce** (např. denní), vstupy se řeší na jemnějším (např. 30m) – přesně podle parametrů strategie.

## Stop a cíl (profit)

- **Stop** je u Demand pod zónou, u Supply nad zónou (hrany pivotu).  
- **Cíl** systém hledá nejdřív u **opačné zóny**, pak u **major swingu**; když to nevyjde, použije se fixnější poměr rizika k zisku (RRR).  
- Detaily pravidel a parametrů MTF jsou v **`SD_de.md`** a v hlavičce `main.py`.

## Důležité parametry (náhled)

| Oblast | Příklad | Smysl |
|--------|---------|--------|
| `zone_timeframes` | např. `1d` | Na jakém TF se staví zóny |
| `exec_timeframe` | např. `30m` | Na jakém TF běží vstupy |
| `zone_max_bars` | 60 | Řídí životnost zóny v modulu: při `get_zones` se mapuje na `zone_extend_right_bars` (hodnota z panelu S/D modulu pro tento účel v backtestu neplatí) |
| Filtry zóny | `min_impulse_score`, inducement, touch | Co všechno musí zóna splnit, aby se obchodovala |

Přesný seznam je v `PARAMS` ve zdrojáku a v UI strategie.

**Simulace vs. live:** limitní vstupy bez vlastního spread modelu v kódu strategie (globální slippage/spread z nastavení běhu). Výstup z obchodu z jednoho baru OHLC — při současném průniku cíle a stopu v jedné svíčce nejde o pořadí ticků uvnitř baru. Detaily v hlavičce `main.py` a v [READMEADAM.md](../../READMEADAM.md) (sekce *Strategie sd_zone_strategy*).

## Kroky: spustit backtest

1. Zkopíruj `main.py` do strategie v aplikaci.  
2. Přidej moduly **Swing HL** + **S/D Zones** a potvrď.  
3. Vyber futures instrument (NQ, ES, …) a data.  
4. Nastav parametry (nebo nech výchozí) a spusť **Run**.

---

Platforma: **[Backtesting_app](../../README.md)** · Průvodce UI: **[READMEADAM.md](../../READMEADAM.md)** · Definice zón: **[SD_def.md](../../SD_def.md)** · Obchodní spec: **[SD_de.md](../../SD_de.md)**
