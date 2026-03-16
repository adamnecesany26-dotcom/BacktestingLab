# Swing High / Low Detector

Modul pro detekci Swing High a Swing Low bodů. Určen pro BOS (Break of Structure) strategie a vizualizaci struktury trhu.

---

## Rozhraní

### Pro View (graf)

```python
detect(ohlc, params=None) -> list[dict]
```

Vrací markery ve formátu: `[{"date": "YYYY-MM-DD", "type": "high"|"low"|"internal_high"|"internal_low", "value": float}, ...]`

### Pro strategii / indikátor

```python
get_swings(ohlc, params=None) -> list[dict]
# nebo při include_internals=True:
get_swings(ohlc, params) -> {"swings": [...], "internals": [...]}
```

Každý swing: `{"type": "high"|"low", "price": float, "index": int, "timestamp": ...}`

---

## Jak modul funguje

### 1. Swing High / Low – hlavní detekce

Algoritmus: **kandidát → nahrazení → potvrzení (pullback) → uzamčení**

#### Fáze 1: Kandidát

- **Pivot High**: `high[i] > high[i-1]` a `high[i] > high[i+1]` (3-bar pattern)
- **Pivot Low**: `low[i] < low[i-1]` a `low[i] < low[i+1]`
- Drží se vždy jen jeden kandidát na high a jeden na low
- Nový pivot může nahradit starého, pokud je extrémnější (vyšší high / nižší low)

#### Fáze 2: Potvrzení pullbackem

Swing se **potvrdí** až po dostatečném pullbacku:

- **Swing High**: `low[i] <= cand_high - threshold`, kde `threshold = ATR × atr_multiplier / sensitivity`
- **Swing Low**: `high[i] >= cand_low + threshold`

#### Fáze 3: Extrémnost

Kandidát musí být lokální extrém: mezi posledním swingem a kandidátem nesmí být vyšší high (pro high) ani nižší low (pro low).

#### Fáze 4: HH / LL (Higher High / Lower Low)

Při sledování trendu:
- Po High může následovat **Higher High** – přidá se inferred Low mezi nimi (pokud pullback ≥ min_pullback)
- Po Low může následovat **Lower Low** – přidá se inferred High mezi nimi

---

## Internal High / Low

Internals jsou **pivot body**, které nejsou na místě swingu. Slouží k jemnější struktuře.

### Pravidla pro Internal

1. **3-bar pivot**: stejný pattern jako u swingu (high[i] > high[i±1], low[i] < low[i±1])
2. **Nesmí být na swing bodu**: pivot na indexu swingu se nepočítá jako internal
3. **Potvrzení následující svíčkou**:
   - **Internal High**: následující svíčka musí být **bearish** (close < open) nebo mít **velmi malé tělo** (≤ ATR × 0.15)
   - **Internal Low**: následující svíčka musí být **bullish** (close > open) nebo mít velmi malé tělo

---

## Parametry

### TF_CONFIG (podle timeframe)

| TF  | atr_period | min_bars_between_swings | window_bars | max_bars |
|-----|------------|-------------------------|-------------|----------|
| 1m  | 60         | 12                      | 2000        | 7500     |
| 5m  | 40         | 8                       | 1000        | 1500     |
| 15m | 28         | 6                       | 500         | 500      |
| 1h  | 20         | 5                       | 360         | 360      |
| 4h  | 14         | 4                       | 180         | 90       |
| 1d  | 10         | 4                       | 120         | 180      |

### Hlavní parametry

| Parametr | Popis | Výchozí |
|----------|-------|---------|
| `timeframe` | 1m, 5m, 15m, 1h, 4h, 1d – škáluje ostatní parametry | 1d |
| `atr_period` | Perioda pro ATR | 10 |
| `atr_multiplier` | Násobitel ATR pro threshold pullbacku | 1.2 |
| `min_bars_between_swings` | Min. počet barů mezi swingy | 3–4 |
| `max_bars` | Max. barů v jednom okně (doporučeno ~6M pro 1d) | 180 |
| `sensitivity` | Čím vyšší, tím více swingů (nižší efektivní threshold) | 1.2 |
| `allow_unconfirmed_last_swing` | Přidat nepotvrzené swingy na konci dat | True |
| `min_pullback_atr_ratio` | Min. pullback pro inferred swing (v ATR) | 0.4 |
| `include_internals` | Vrátit i internal H/L | False |

---

## Rolling window (max_bars)

Když `len(ohlc) > max_bars`:

- Data se zpracují v **rolling oknech** po `max_bars` barů
- Každé okno = posledních N barů od dané pozice
- Swingy z oken se sloučí a deduplikují
- Umožňuje spolehlivé zobrazení na dlouhých periodách (View 2Y+)

**Proč**: Modul funguje nejlépe s cca 6 měsíci dat. Na delších datech bez rolling window vznikaly mezery.

---

## Kdy modul funguje správně

### ✅ Vhodné podmínky

1. **Dostatek dat**: min. `atr_period + 2` barů (pro 1d cca 12 barů)
2. **Timeframe**: správně nastavený `timeframe` v params
3. **Objem volatility**: ATR > 0 – modul používá ATR pro threshold
4. **View**: pro 2Y+ dat zapnout `include_internals` pro plné zobrazení struktury

### ⚠️ Omezení

1. **Konec dat**: poslední swingy mohou být nepotvrzené (řeší `allow_unconfirmed_last_swing`)
2. **Choppy trh**: při malé volatilitě nebo sideways může být mnoho swingů
3. **Backtest**: v každém `next()` se volá `get_swings` znovu – modul je bez stavu

---

## Použití ve strategii

```python
import os
from modules.Swing_HL import get_swings, detect

# Ve strategii
def next(self):
    ohlc = self.get_ohlc_to_current()  # data od začátku do aktuálního baru
    params = {"timeframe": os.environ.get("TIMEFRAME", "1d")}
    swings = get_swings(ohlc, params)

    if len(swings) < 2:
        return

    last_high = max(s["price"] for s in swings if s["type"] == "high" and s["index"] < len(self) - 5)
    last_low = min(s["price"] for s in swings if s["type"] == "low" and s["index"] < len(self) - 5)

    if self.data.close[0] > last_high:
        self.buy()   # bullish BOS
    elif self.data.close[0] < last_low:
        self.sell()  # bearish BOS
```

---

## Deduplikace

Swingy stejného typu v toleranci ±2 barů se slučují, pokud rozdíl cen < ATR × 0.5 (ochrana double top/bottom).

---

## Struktura výstupu

### Swing

```python
{"type": "high", "price": 21500.5, "index": 42, "timestamp": Timestamp(...)}
```

### Internal (při include_internals=True)

```python
{"type": "high", "price": 21480.0, "index": 38, "timestamp": Timestamp(...)}
```

### detect() pro View

```python
{"date": "2024-03-12", "type": "high", "value": 21500.5}
{"date": "2024-03-12", "type": "internal_low", "value": 21420.0}
```
