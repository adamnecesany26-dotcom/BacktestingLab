# Swing High / Low Detector

Modul pro detekci Swing High, Swing Low, Major Swing H/L a Internal H/L. Určen pro BOS (Break of Structure) strategie, S/D zóny a vizualizaci struktury trhu.

---

## Rozhraní

### Pro View (graf)

```python
detect(ohlc, params=None) -> list[dict]
```

Vrací markery: `[{"date": "YYYY-MM-DD", "type": "high"|"low"|"major_high"|"major_low"|"internal_high"|"internal_low", "value": float}, ...]`

```python
get_line(ohlc, params=None) -> dict
```

Trendová čára: `{"Trend": {"data": [...], "segments": [{"from", "to", "color"}, ...]}}`

```python
get_zones(ohlc, params=None) -> list[dict]
```

BOS čáry (oranžové horizontální linie od swingu k místu BOS).

### Pro strategii / indikátor

```python
get_swings(ohlc, params=None) -> list[dict]
# nebo při include_internals=True:
get_swings(ohlc, params) -> {"swings": [...], "internals": [...]}
```

Každý swing: `{"type": "high"|"low", "price": float, "index": int, "timestamp": ...}`

```python
get_major_swings(ohlc, params=None) -> list[dict]
```

Major swingy na vyšším TF: `[{"type": "major_high"|"major_low", "price", "index", "timestamp"}, ...]`

```python
get_bos(ohlc, params=None) -> list[dict]
```

BOS události: `[{"swing_index","swing_date","bos_index","bos_date","level","type":"bos_bullish"|"bos_bearish"}, ...]`

```python
get_trend(ohlc, params=None) -> {"score": [float,...], "state": [str,...]}
```

Trend -100..+100 (score) a stav (STRONG_BULL, WEAK_BULL, RANGE, WEAK_BEAR, STRONG_BEAR) pro každý bar.

---

## Major Swing H/L

Major swingy jsou swingy na **vyšším timeframe** – důležitější strukturní extrémy.

### Mapování TF

| Aktuální TF | Major TF |
|-------------|----------|
| 1m | 5m |
| 5m | 15m |
| 15m | 1h |
| 30m | 1h |
| 1h | 4h |
| 4h | 1d |
| 1d | 1w |
| 1w | 1M |

### Hierarchie (bez překryvů)

- **Major** > **Swing** > **Internal**
- Swing H/L se **neregistrují** na místech, kde již je Major Swing H/L (tolerance ±3 bary)
- Internal H/L se **neregistrují** na místech Swing H/L ani Major

### Použití

```python
from modules.Swing_HL import get_swings, get_major_swings

swings = get_swings(ohlc, {"timeframe": "15m"})
major = get_major_swings(ohlc, {"timeframe": "15m"})  # Major na 1h

# Filtrování setupů podle Major struktury
for m in major:
    if m["type"] == "major_low" and cena_near(m["price"]):
        # potenciální long u Major support
        pass
```

---

## Timeframe a resampling

Modul podporuje **resampling** – data mohou být jemnější (např. 1m), modul je převede na požadovaný TF.

### Min. TF pro funkce

| Funkce | Min. TF |
|--------|---------|
| Swing H/L | 5m |
| BOS | 1m |
| Trend | 30m |

Při jemnějším TF se data automaticky resamplují.

### Podporované TF

1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M

### Parametr data_timeframe

Pokud znáš TF vstupních dat, předaj `params["data_timeframe"]` – modul pak přesněji rozhoduje o resamplingu. Jinak se TF odhadne z časových rozestupů.

---

## Jak modul funguje

### 1. Swing High / Low – hlavní detekce

Algoritmus: **kandidát → nahrazení → potvrzení (pullback) → uzamčení**

#### Fáze 1: Kandidát

- **Pivot High**: `high[i] > high[i-1]` a `high[i] > high[i+1]` (3-bar pattern)
- **Pivot Low**: `low[i] < low[i-1]` a `low[i] < low[i+1]`
- Drží se vždy jen jeden kandidát na high a jeden na low
- Nový pivot může nahradit starého, pokud je extrémnější

#### Fáze 2: Potvrzení pullbackem

Swing se **potvrdí** až po dostatečném pullbacku:

- **Swing High**: `low[i] <= cand_high - threshold`, kde `threshold = ATR × atr_multiplier / sensitivity`
- **Swing Low**: `high[i] >= cand_low + threshold`

#### Fáze 3: Extrémnost

Kandidát musí být lokální extrém mezi posledním swingem a kandidátem.

#### Fáze 4: HH / LL

Při sledování trendu se přidávají inferred swingy mezi Higher High / Lower Low.

---

## Internal High / Low

Internals jsou **pivot body**, které nejsou na místě swingu ani Major. Slouží k jemnější struktuře.

### Pravidla

1. **3-bar pivot**: stejný pattern jako u swingu
2. **Nesmí být na swing ani Major bodu**
3. **Potvrzení následující svíčkou**:
   - Internal High: následující svíčka bearish nebo velmi malé tělo
   - Internal Low: následující svíčka bullish nebo velmi malé tělo

---

## BOS (Break of Structure)

- **Bullish BOS**: close nad posledním swing high, následující `acceptance_bars` svíček nesmí uzavřít zpět pod úroveň
- **Bearish BOS**: close pod posledním swing low, analogicky

---

## Parametry

### TF_CONFIG (podle timeframe)

| TF | atr_period | min_bars_between_swings | window_bars | max_bars |
|----|------------|-------------------------|-------------|----------|
| 1m | 60 | 12 | 2000 | 7500 |
| 5m | 40 | 8 | 1000 | 1500 |
| 15m | 28 | 6 | 500 | 500 |
| 30m | 24 | 6 | 360 | 360 |
| 1h | 20 | 5 | 360 | 360 |
| 4h | 14 | 4 | 180 | 90 |
| 1d | 10 | 4 | 120 | 180 |
| 1w | 8 | 4 | 80 | 52 |
| 1M | 6 | 3 | 48 | 24 |

### Hlavní parametry

| Parametr | Popis | Výchozí |
|----------|-------|---------|
| timeframe | 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M | 1d |
| atr_period | Perioda pro ATR | 10 |
| atr_multiplier | Násobitel ATR pro threshold pullbacku | 1.2 |
| min_bars_between_swings | Min. počet barů mezi swingy | 3–4 |
| max_bars | Max. barů v jednom okně | 180 |
| sensitivity | Čím vyšší, tím více swingů | 1.2 |
| allow_unconfirmed_last_swing | Přidat nepotvrzené swingy na konci | True |
| min_pullback_atr_ratio | Min. pullback pro inferred swing | 0.4 |
| include_internals | Vrátit i internal H/L | False |
| acceptance_bars | Bary pro potvrzení BOS | 1 |
| data_timeframe | TF vstupních dat (volitelné) | odhad z dat |

### TREND_PARAMS (pro strategie)

| Parametr | Default | Popis |
|----------|---------|-------|
| trend_min_long | 30 | Min. score pro long |
| trend_max_short | -30 | Max. score pro short |
| trend_filter_enabled | True | Zapnout trend filtr |
| trend_require_strong | False | Vyžadovat STRONG_BULL/BEAR |
| trend_smooth_period | 8 | Vyhlazení score |

---

## Rolling window (max_bars)

Když `len(ohlc) > max_bars`:

- Data se zpracují v **rolling oknech** po `max_bars` barů
- Swingy z oken se sloučí a deduplikují
- Umožňuje spolehlivé zobrazení na dlouhých periodách (View 2Y+)

---

## Deduplikace

- Swingy stejného typu v toleranci ±2 barů se slučují, pokud rozdíl cen < ATR × 0.5
- Ochrana proti double top/bottom

---

## Struktura výstupu

### Swing

```python
{"type": "high", "price": 21500.5, "index": 42, "timestamp": Timestamp(...)}
```

### Major Swing

```python
{"type": "major_high", "price": 21520.0, "index": 38, "timestamp": Timestamp(...)}
```

### Internal (při include_internals=True)

```python
{"type": "high", "price": 21480.0, "index": 38, "timestamp": Timestamp(...)}
```

### detect() pro View

```python
{"date": "2024-03-12", "type": "major_high", "value": 21520.0}
{"date": "2024-03-12", "type": "high", "value": 21500.5}
{"date": "2024-03-12", "type": "internal_low", "value": 21420.0}
```

---

## Použití ve strategii

```python
from modules.Swing_HL import get_swings, get_bos, get_trend, TREND_PARAMS

def next(self):
    ohlc = self.get_ohlc_to_current()
    params = {"timeframe": "1d", **TREND_PARAMS}

    swings = get_swings(ohlc, params)
    if len(swings) < 2:
        return

    trend = get_trend(ohlc, params)
    if trend and trend["score"][-1] < params.get("trend_min_long", 30):
        return  # filtr – jen v uptrendu

    events = get_bos(ohlc, params)
    for ev in events:
        if ev["type"] == "bos_bullish":
            self.buy()
        elif ev["type"] == "bos_bearish":
            self.sell()
```

---

## Možné chyby

- **Žádné swingy**: málo dat (min. atr_period + 2 barů), špatný timeframe
- **Příliš mnoho swingů**: choppy trh, zkus zvýšit `min_bars_between_swings` nebo snížit `sensitivity`
- **KeyError na sloupcích**: data musí mít `open`, `high`, `low`, `close` (nebo velká písmena)
- **Major swingy prázdné**: TF již na maximu (1M) nebo málo dat po resamplingu
