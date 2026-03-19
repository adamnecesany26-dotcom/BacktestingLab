# Supply/Demand zóny v-1.0 – kompletní dokumentace

Modul pro detekci Supply a Demand zón na základě BOS (Break of Structure). Zóny reprezentují cenové oblasti, kde došlo k silnému impulznímu pohybu – místa potenciální reakce při návratu ceny.

---

## 1. Nutnosti a závislosti

### Povinná závislost: Swing HL

Modul **vyžaduje** modul **Swing HL** (nebo HL identificator) pro detekci swing bodů a BOS událostí.

- **View**: závislost se načte automaticky díky `# VIEW_DEPENDENCIES: Swing HL` v kódu
- **Strategie / backtest**: musíš přidat **oba** moduly (Swing HL + S/D Zones) do aplikovaných modulů

### OHLC data

- Sloupce: `open`, `high`, `low`, `close` (nebo `Open`, `High`, `Low`, `Close`)
- Datetime index (pandas)
- Min. cca 50+ barů pro smysluplné zóny

---

## 2. Použití

### Ve View (graf)

1. Vytvoř modul **Swing HL** s kódem z `examples/swing_hl_detector.py`
2. Vytvoř modul **S/D Zones** (nebo „SD identificator“) s kódem z `examples/sd_zones.py`
3. Ve View vyber S/D Zones – zobrazí se:
   - **Major Swing H/L** (žluté/oranžové diamanty)
   - **Swing H/L** (zelené/červené kruhy)
   - **Internal H/L** (menší kruhy)
   - **S/D zóny** (zelené Demand, červené Supply rectangles)
4. Ikona parametrů – uprav `timeframe`, prahy pro šířku zóny, atd.

### Ve strategii

```python
from modules.Swing_HL import get_bos
from modules.S_D_Zones import get_zones

# BOS události (break nad swing high / pod swing low)
events = get_bos(ohlc, params)

# S/D zóny – Demand a Supply
zones = get_zones(ohlc, params)

for z in zones:
    if z["name"] == "Demand":
        # long setup – cena v zóně z["value_low"] .. z["value_high"]
        # z["base_length"] – počet svíček doleva
        # z["impulse_score"] – síla momentum 1–4
        pass
    elif z["name"] == "Supply":
        # short setup
        pass
```

---

## 3. Rozhraní

### detect(ohlc, params=None)

Vrací markery pro View: Major Swing H/L, Swing H/L, Internal H/L.

```python
[
    {"date": "YYYY-MM-DD", "type": "major_high", "value": float},
    {"date": "YYYY-MM-DD", "type": "high", "value": float},
    {"date": "YYYY-MM-DD", "type": "internal_low", "value": float},
    ...
]
```

### get_zones(ohlc, params=None)

Vrací S/D zóny (pouze Demand a Supply, ne BOS).

```python
[
    {
        "date_start": "YYYY-MM-DD",
        "date_end": "YYYY-MM-DD",
        "value_low": float,
        "value_high": float,
        "fillcolor": "rgba(34, 197, 94, 0.25)",
        "name": "Demand",
        "base_length": int,      # počet svíček doleva od pivotu
        "impulse_score": int,   # 1–4 síla momentum ze zóny
    },
    {"name": "Supply", ...},
]
```

---

## 4. Pravidla S/D v-1.0

### Demand zóna

- **Vznik**: V místě **bullish BOS** (close nad posledním swing high)
- **Pivot**: Bar s **nejnižším low** v momentum leg (od swing low k BOS) – začátek pohybu
- **Výška**: High–Low pivot svíčky

### Supply zóna

- **Vznik**: V místě **bearish BOS** (close pod posledním swing low)
- **Pivot**: Bar s **nejvyšším high** v momentum leg (od swing high k BOS)
- **Výška**: High–Low pivot svíčky

### Šířka vlevo (base)

Zóna se prodlužuje doleva, dokud předchozí svíčka splňuje **obě** podmínky:

1. **≥ 33 %** celkové délky svíčky (H–L) je v zóně
2. **≥ 10 %** těla svíčky je v zóně

`base_length` = počet svíček doleva od pivotu.

### Šířka vpravo

Zóna se rozšiřuje doprava až do:

- **Zaniknutí**: Demand = close < zone_low; Supply = close > zone_high
- **Dotyk**: cena musí nejdřív opustit zónu (H/L mimo), až poté se počítá dotyk
- **Max 60 barů** (nastavitelné)

### Deduplikace

V podobném místě (cenový overlap ≥ 25 %) a blízkém čase (≤ 7 barů) nesmí vzniknout 2 zóny stejného typu.

---

## 5. Impulse score (1–4)

**Síla pohybu ze zóny**:

- **4** = velmi silný pohyb
- **3** = silný pohyb
- **2** = průměrný pohyb
- **1** = slabý pohyb

- **agg** = `move / (ATR × √bars)` – rychlost pohybu
- **direction_factor** = 0.3 + 0.7 × (svíčky ve směru / celkem)
- **agg_adj** = agg × direction_factor → prahy 0.5 / 0.28 / 0.12 pro 4 / 3 / 2

---

## 6. Parametry (VIEW_PARAMS)

| Parametr | Default | Popis |
|----------|---------|-------|
| timeframe | 1d | Časový rámec (předáváno do Swing HL) |
| atr_period | 10 | ATR perioda pro Swing HL |
| atr_multiplier | 1.2 | ATR multiplikátor |
| min_bars_between_swings | 3 | Min. bary mezi swingly |
| max_bars | 180 | Max. bary pro zpracování |
| acceptance_bars | 1 | Bary pro potvrzení BOS |
| zone_overlap_threshold | 0.33 | Prah pro šířku vlevo (33 % H–L v zóně) |
| zone_body_overlap_threshold | 0.10 | Min. 10 % těla svíčky v zóně |
| zone_extend_right_bars | 60 | Max. barů rozšíření doprava |
| zone_min_bars_between_same | 7 | Min. barů mezi zónami stejného typu |
| zone_price_overlap_threshold | 0.25 | Cenový overlap pro deduplikaci (0–1) |

---

## 7. Možné chyby a řešení

### Žádné zóny se nezobrazují

- **Příčina**: Chybí modul Swing HL nebo není v závislostech
- **Řešení**: Vytvoř modul Swing HL, zkopíruj kód z `swing_hl_detector.py`. Ve View se načte automaticky. Ve strategii přidej oba moduly do aplikovaných.

### ImportError: cannot import get_bos / get_swings

- **Příčina**: Modul Swing HL není v aplikovaných modulech nebo má jiný název
- **Řešení**: Název modulu v aplikaci musí odpovídat `Swing_HL` nebo `HL_identificator` (podle toho, jak je v kódu import). Zkontroluj sekci Moduly před Run.

### Zóny jsou příliš malé / velké

- **Příčina**: Parametry `zone_overlap_threshold`, `zone_body_overlap_threshold`
- **Řešení**: Sniž prah (např. 0.25) pro širší zóny; zvyš (0.40) pro užší. `zone_body_overlap_threshold` ovlivňuje rozšíření doleva.

### Příliš mnoho / málo zón

- **Příčina**: Parametry Swing HL (`min_bars_between_swings`, `sensitivity`), nebo `zone_min_bars_between_same`
- **Řešení**: Uprav `min_bars_between_swings` v params (vyšší = méně swingů = méně zón). `zone_min_bars_between_same` ovlivňuje deduplikaci.

### KeyError: 'high' / 'low' / 'open' / 'close'

- **Příčina**: OHLC data mají jiné názvy sloupců (např. jen velká písmena)
- **Řešení**: Modul podporuje `high`/`High`, `low`/`Low`, `open`/`Open`, `close`/`Close`. Zkontroluj, že data mají alespoň jednu z variant.

### Prázdný výstup get_zones při dostatku dat

- **Příčina**: Žádné BOS události – Swing HL nenašel breaky struktury
- **Řešení**: Zkontroluj `timeframe` – na 1d může být málo BOS. Zkus 1h nebo 4h. Zkontroluj `acceptance_bars` (1 = standardní).

### Impulse score je vždy nízký

- **Příčina**: Malý pohyb (move/ATR) nebo pomalý pohyb (mnoho barů na krátkou vzdálenost)
- **Řešení**: Očekávané u choppy trhu. Pro filtraci setupů použij např. `impulse_score >= 3`.

---

## 8. Vizualizace

- **Demand**: zelený rectangle (`rgba(34, 197, 94, 0.25)`), popisek „D“
- **Supply**: červený rectangle (`rgba(239, 68, 68, 0.25)`), popisek „S“
- Zóny se zobrazují jako lehce zabarvené rectangles pod svíčkami
- Popisky „D“ a „S“ jsou vystředěné uvnitř zóny

---

## 9. Odkazy

- **SD_def.md** – formální definice S/D zón
- **swing_hl_detector.py** – závislý modul pro BOS a swingy

---

## Platforma Backtesting App

Modul je určen pro **[Backtesting_app](../../README.md)**. Přehled UI: **[READMEADAM.md](../../READMEADAM.md)**; spuštění lokálně: **[SCRIPTS.md](../../SCRIPTS.md)**; kontrakty API: **[READMEAI.md](../../READMEAI.md)**.
