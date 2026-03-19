# S/D Zone Strategy

Strategie obchodující Supply/Demand zóny – Long na Demand, Short na Supply.

## Požadavky

- **Moduly**: Swing HL, S/D Zones (oba musí být vybrány v panelu Moduly)
- **Data**: OHLC s datetime indexem
- **Instrument**: Futures (1 kontrakt, tick dle broker_config)

## Logika

### Vstup
- **Každá aktivní zóna** má limit order na hranici (Demand: horní, Supply: dolní)
- Limit order se vyplní když cena **jakkoliv překryje** tuto úroveň (bar high/low)
- Zóna končí při dotyku ceny (+ 3 bary rezerva pro entry)

### Stop loss
- **Demand**: dolní hranice zóny (`zone_low`) – trigger když cena navštíví tuto úroveň
- **Supply**: horní hranice zóny (`zone_high`) – trigger když cena navštíví tuto úroveň

### Profit target (priorita)
1. **Opposing zóna** – Demand → nejbližší Supply nad, Supply → nejbližší Demand pod (R:R ≥ 1.5)
2. **Major swing H/L** – Demand → nejbližší major_high, Supply → nejbližší major_low (R:R ≥ 1.5)
3. **Fallback**: fixní 2.0 RRR
4. **Max. RRR**: 4.0 – target se ořízne, pokud by RRR přesáhlo 4.0

## Parametry

| Parametr | Výchozí | Popis |
|----------|---------|-------|
| timeframe | 1d | Timeframe pro Swing HL a S/D |
| min_rr_zone | 1.5 | Min. R:R pro target na opposing zónu |
| min_rr_swing | 1.5 | Min. R:R pro target na major swing |
| fallback_rr | 2.0 | Fixní RRR pokud ani zóna ani swing nesplní |
| max_rr | 4.0 | Maximální RRR – target se ořízne na 4.0 R |
| zone_max_bars | 60 | Max. stáří zóny v barech |

## Použití

1. Vytvoř strategii v aplikaci
2. Zkopíruj kód z `main.py`
3. V panelu Moduly vyber **Swing HL** a **S/D Zones**, klikni Potvrdit
4. Nastav instrument (NQ, ES, …) a data
5. Spusť backtest

---

## Platforma Backtesting App

Strategie běží v **[Backtesting_app](../../README.md)**. Uživatelská mapa aplikace: **[READMEADAM.md](../../READMEADAM.md)**; příkazy: **[SCRIPTS.md](../../SCRIPTS.md)**; vývojová reference: **[READMEAI.md](../../READMEAI.md)**.
