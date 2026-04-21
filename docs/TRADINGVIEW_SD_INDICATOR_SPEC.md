# TradingView S/D + Swing HL indikátor — spec (fáze 0)

Tento dokument uzavírá přípravnou fázi: logika oproti Pythonu, vizuál (Plotly), timeframe, multi-instrument, limity Pine a alerty.

**Reference kód:** `strategies/sd_zone_strategy/modules/Swing_HL.py`, `examples/sd_zones.py`, `frontend/components/charts/ModuleOutputChart.tsx`.

---

## 1. Touch a departure (mapování na Python)

Zdroj: `examples/sd_zones.py` → `_compute_zone_width_right`.

| Událost | Demand | Supply | Python poznámka |
|---------|--------|--------|------------------|
| **Departure (seen_outside)** | první svíčka **celá nad** zónou: `low > zone_high` | první svíčka **celá pod** zónou: `high < zone_low` | „Celá mimo“ = mezery mezi high/low a pásmem zóny |
| **Touch (po departure)** | překryv s pásmem + směrový dotyk k horní hraně | symetricky k dolní hraně | `_sd_directional_touch_at_edge` + `after_departure` |
| **Invalidace close** | `close < zone_low` | `close > zone_high` | končí zónu, zapisuje se jako touch s cenou invalidate |

**Alerty:** `touch` = nový touch záznam (retest po departure nebo invalidace dle logiky); `departure` = první bar splňující `seen_outside` (volitelně jen jednou na zónu).

---

## 2. Časové rámce (oficiální)

30m, 1h, 2h, 4h, 1D, 1W, 1M — stejná logika; u nižších TF hlídat výkon (`max_bars_back`, počet boxů).

---

## 3. Multi-instrument (futures + forex)

- ATR a prahy v **cenových bodech** instrumentu (`ta.atr`), žádné fixní pip konstanty v logice.
- Popisky / zaokrouhlení: `syminfo.mintick` (volitelně v UI).

---

## 4. Vizuál (zamčeno — kopie z plánu + Plotly)

### Swing H/L

- Kruh: high = zelená, low = modrá (výchozí), nastavitelná opacity a velikost.

### BOS

- Přerušovaná červená čára od swing úrovně k baru BOS, nastavitelná opacity.

### Zóny Demand / Supply (jako `ModuleOutputChart.tsx`)

| Prvek | Demand | Supply |
|-------|--------|--------|
| Výplň | `rgba(34, 197, 94, 0.14)` | `rgba(239, 68, 68, 0.14)` |
| Obrys | `rgba(250, 204, 21, 0.95)`, šířka 2.5, dashed | stejně |

### Touch

- Žlutý kruh.

### Departure

- Kosočtverec / diamond, cyan `#22d3ee`, výrazná opacity; volitelná svislá čárka.

---

## 5. Tři vstupy „četnost swingů“

1. **Sensitivity** (výchozí ~0.93)  
2. **ATR multiplier** (výchozí ~1.44)  
3. **Swing spacing** (výchozí 1.0) — násobí `min_bars_between_swings` z TF presetu (jako `swing_sparsity` v Pythonu).

`atr_period` a základní `min_bars_between_swings` se odvozují od `timeframe.period` (viz `TF_CONFIG` ve Swing_HL).

---

## 6. Limity Pine (fáze 0 — ověření)

- **Skript:** `indicator(..., max_boxes_count=500, max_lines_count=500, max_labels_count=500, max_bars_back=5000)` (přizpůsobit podle TV).
- **Smyčky:** Pine v5 limit iterací na bar (typicky 50k) — BOS přes seznam swingů musí zůstat pod rozumným počtem.
- **Alerty:** `alertcondition()` — uživatel přidá alert v UI; počet alertů závisí na plánu TradingView.

---

## 7. Testování (náhled fáze 2)

- Vizuálně: náhodné úseky + edge (gaps).
- Minimálně jeden forex a jeden futures symbol, stejný TF.
- Alerty: bez duplicitního spamu na stejné zóně; signály na uzavřené svíčce kde je to rozumné (`barstate.isconfirmed`).

Implementace: [`tradingview/sd_zones_hl_indicator.pine`](../tradingview/sd_zones_hl_indicator.pine).

---

## 8. Pine limity (fáze 0 — ověřeno v kódu)

- Skript používá `indicator(..., max_boxes_count=500, max_lines_count=500, max_labels_count=500, max_bars_back=5000)` a interní strop `MAX_Z = 60` aktivních zón (rozumný výkon na 30m s dlouhou historií).
- **Alerty:** počet alertů závisí na plánu TradingView (viz [TradingView pricing](https://www.tradingview.com/pricing/)); skript definuje dva `alertcondition` (Touch, Departure).
- **Výkon:** BOS prochází seznam swingů (O(n) na bar); při problémech snížit `max_bars_back` v grafu nebo počet BOS swingů v lookbacku.

---

## 9. Testovací checklist (fáze 2)

1. V TradingView: **Pine Editor** → vložit obsah `tradingview/sd_zones_hl_indicator.pine` → **Add to chart**.
2. **TF:** 30m, 1h, 2h, 4h, 1D, 1W, 1M — krátký vizuální vzorek (struktura, zóny, touch/departure).
3. **Symboly:** alespoň jeden **forex** a jeden **futures** (stejný TF) — ověřit ATR v bodech (žádné pevné pipy).
4. **Alerty:** vytvořit alert z indikátoru (Touch / Departure) — na uzavřené svíčce (`barstate.isconfirmed` v podmínkách); zkontrolovat duplicity při retestu.
5. **Srovnání s Pythonem:** očekávat odchylky na okrajích (session, měsíční agregace); cílem je věrohodné chování na TV, ne 1:1 čísla.
