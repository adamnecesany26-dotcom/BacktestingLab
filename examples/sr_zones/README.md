# Support/Resistance zóny v-1.2

Modul pro detekci S/R levelů **pouze z major Swing HL**. Dvě cesty k validní zóně:

- **(A) 2× touch** – cluster major bodů s 2+ validními dotyky (cena odcestovala pryč mezi nimi)
- **(B) Range consolidation** – cena pobývala v rozmezí 2 major swing bodů → oba body jsou S/R

---

## 1. Závislosti

- **Swing HL** nebo **HL identificator** – pro `get_major_swings`
- View načte závislost automaticky díky `# VIEW_DEPENDENCIES: Swing HL, HL identificator`

---

## 2. Použití

### Ve View

1. Vytvoř modul **Swing HL** (nebo HL identificator) s kódem z `examples/swing_hl_detector.py`
2. Vytvoř modul **S/R Zones** s kódem z `examples/sr_zones.py`
3. Ve View vyber S/R Zones – horizontální čáry Support (zelená) a Resistance (červená)
4. Ikona parametrů – uprav `min_consolidation_bars`, `max_range_bars`, atd.

### Ve strategii

```python
from modules.S_R_Zones import get_zones  # název dle Firestore

zones = get_zones(ohlc, params)
for z in zones:
    if z["name"] == "Support":
        # z["value_low"] == value_high
        # z["touches"], z["strength"]
        pass
```

---

## 3. Rozhraní

### detect(ohlc, params=None)

Vrací markery S/R levelů pro View.

### get_zones(ohlc, params=None)

Vrací S/R zóny jako horizontální čáry (value_low == value_high).

---

## 4. VIEW_PARAMS

| Parametr | Výchozí | Popis |
|----------|---------|-------|
| `timeframe` | "1d" | TF pro Swing HL |
| `atr_period` | 10 | Perioda ATR |
| `cluster_atr_threshold` | 0.5 | Max vzdálenost v ATR pro sloučení bodů (path A) |
| `min_travel_atr` | 0.5 | Cena musí odcestovat od zóny před dalším dotykem (path A) |
| `retest_lookback_bars` | 20 | Po barů pro hledání retestu (flip S↔R) |
| `min_consolidation_bars` | 5 | Min. barů, kdy cena pobývá v rozmezí 2 bodů (path B) |
| `max_range_bars` | 120 | Max vzdálenost v barech mezi 2 body pro path B |

---

## 5. Logika (v-1.2)

1. **Pouze major Swing HL** – žádné běžné swingy
2. **Path A: 2× touch** – cluster major bodů, 2+ validní dotyky (travel-away rule)
3. **Path B: Range consolidation** – dvojice major bodů, cena pobývala v jejich rozmezí min. N barů → oba body S/R
4. **Zóna končí** při close pod support / nad resistance. Výjimka: breakout + retest → flip S↔R
