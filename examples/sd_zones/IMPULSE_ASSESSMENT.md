# Zhodnocení impulse score – feedback a doporučení

**Důležité:** Žádné vyřazování zón podle skóre. Impulse score slouží pouze k hodnocení síly pohybu ze zóny – uživatel/strategie si může filtrovat sám.

---

## 1. Shrnutí feedbacku vs. naše stanovisko

| Bod | Feedback | Naše hodnocení | Akce |
|-----|----------|----------------|------|
| **Vyřazování zón** | Reject if score < threshold | **Nepřijatelné** – uživatel explicitně nechce vyřazovat | Žádná – jen hodnotíme |
| **sqrt(bars) vs. lineární** | Použít lineární bars | **Kompromis** – pro škálu 1–4 používáme sqrt (méně přísné), nižší prahy | sqrt + prahy 0.5/0.28/0.12 |
| **Saturace** | Maže rozdíly | **Vyřešeno** – škála 1–4 s prahy místo lineární transformace | 4 diskrétní úrovně |
| **Velocity** | Chybí měření rychlosti | **Částečně** – sqrt(bars) zohledňuje rychlost | sqrt v agg |
| **Direction dominance** | directional_ratio < 0.6 reject | **Neměníme** – nemáme reject | Posílit direction_factor v score |
| **Candle strength (body)** | Velikost těla svíček | **Volitelné** – přidá složitost | Zatím ne – sledujeme |
| **Imbalance / FVG** | Gap, FVG-like | **Volitelné** – dříve jsme měli, odstranili | Zatím ne – jednoduchost |
| **BOS distance** | Minimální vzdálenost od levelu | **Rozumné** – slabý BOS = nižší score | Přidat do score (ne reject) |
| **Pivot fallback** | max(0, bos_idx-30) = falešné zóny | **Souhlas – kritická chyba** | Opravit – skip zone pokud není validní swing |
| **Pullback kontrola** | Max retrace proti směru | **Volitelné** | Zatím ne |

---

## 2. Co implementujeme

### 2.1 Impulse score – škála 1–4 (aktuální)
- **4** = velmi silný, **3** = silný, **2** = průměrný, **1** = slabý
- **agg = move / (ATR × √bars)** – sqrt méně penalizuje středně dlouhé pohyby
- **direction_factor** = 0.3 + 0.7 × ratio
- Prahy: agg_adj ≥ 0.5 → 4, ≥ 0.28 → 3, ≥ 0.12 → 2, else → 1

### 2.2 Pivot fallback – strukturní oprava
- Pokud není swing low (Demand) resp. swing high (Supply) před swing_idx → **return None**
- Zóna bez validního pivotu v momentum leg se nevytvoří – nejde o reject podle score, ale o správnou definici zóny

### 2.3 BOS strength (volitelně do score)
- Vzdálenost close[BOS] od levelu v ATR – silnější BOS = vyšší příspěvek
- Lze přidat jako malý bonus do score

---

## 3. Co neimplementujeme (zatím)

- **Reject** podle jakéhokoli prahu
- **Velocity threshold** – bars > max → reject
- **Direction threshold** – ratio < 0.6 → reject
- **Candle strength** – body > ATR×0.5
- **Imbalance / FVG** – gap detekce
- **Pullback ratio** – max retrace

---

## 4. Očekávaný efekt

- Pomalé pohyby (mnoho barů) → nižší score
- Slabý směr (málo zelených/červených) → nižší score
- Škála 1–4: jednoduchá interpretace (4=velmi silný, 1=slabý)
- Žádné zóny bez validní swing struktury (pivot fallback)
