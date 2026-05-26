# Hybrid ORB strategy — implementační specifikace (Python)

Dokument slučuje **pouze přenositelné a v literatuře opakovaně podporované** prvky ze šesti SSRN zdrojů. Cílem je jedna srozumitelná pravidla pro backtest a živé obchodování na **akciích** (ne povinně opce / crypto).

| Zdroj (SSRN ID) | Co přebíráme | Co záměrně nebere jako jádro |
|-----------------|--------------|-------------------------------|
| 5198458 | Kratší OR okno má v jejich vzorku silnější surový výkon; mírnější objemový filtr (≈1,2×) vs. příliš přísný; oddělené statistiky long/short | Celé tvrzení o statistické významnosti na 1 titulu — nepovažujeme za důkaz absence edge, ale za varování k délce vzorku |
| 6272239 | Obchodovat jen ve **ztrátě volatility** (režim ATR); **stop v jednotkách ATR**; trejlování volitelné | Denní Donchian na BTC jako hlavní signál |
| 4729284 | **Univerzum „in play“**: zvýšená pozornost / relativní objem; **5m ORB** s **směrem jen podle první 5m svíčky** | Top-20 portfoliová logika jako nutnost — implementovat jako threshold na RV |
| 6355218 | **Den v týdnu** a **VIX pásmo**; **vynechání hlavních makro dnů**; důraz na **ekonomiku provedení** (hrebeňová zranitelnost — přenášíme jako max spread / slippage) | 0DTE debit spread, Monte Carlo jako jediný datový zdroj, vzdálenost striku |
| 4416622 | Vstup na **open druhé 5m** ve směru první; stop u **extrému první 5m**; **cíl 10R nebo EoD**; **riziko X % účtu** na trade; nákladová disciplína | TQQQ jako výchozí instrument — nechat jako volitelný „leverage layer“ |
| 5921742 | **Gap > práh** jako separátní režim; **širší OR (30 m)** v tom režimu; **potvrzení objemem k ADV**; **limit spreadu**; **false-break** kill switch; **časový exit** před close | Převzetí celé small-cap univerza bez vlastních likviditních filtrů |

---

## 1. Filozofie (jedna věta)

Obchodovat **jen tehdy**, kdy trh potvrdí **úvodní nerovnováhu** (úzký OR + směr + likvidita + příznivý režim), s **ATR škálovaným** rizikem a **tvrdými** pravidly pro falešné průrazy a náklady.

---

## 2. Režimy provozu (dva profily — stejný engine, jiné parametry)

Implementace by měla podporovat **`mode`**: `standard` | `gap_and_go`.

### 2.1 `standard` (konsensus 5m ORB — Zarattini / Stocks in Play)

- **Opening range**: prvních **5 minut** regulérní seance (9:30–9:35 US Eastern pro US akcie).
- **Směr**: pokud první 5m svíčka **bullish** (close > open) → povoleny **jen long** při breaku nahoru; pokud **bearish** → jen **short** při breaku dolů; pokud doji (open ≈ close) → **žádný obchod**.
- **Breakout trigger**: uzavření **nad** `OR_high` (long) nebo **pod** `OR_low` (short) na **3–5 min** bar po OR, *nebo* průraz high/low s potvrzením objemem (konfigurovatelné).
- **Entry price model**: konzervativně **open dalšího baru** po triggeru (služebně odpovídá „open druhé svíčky“ logice); parametrizovat.

### 2.2 `gap_and_go` (5921742 — jen když je gap)

- **Podmínka aktivace**: přesnoční gap **≥ `gap_min_pct`** (baseline **2 %**).
- **Opening range**: **30 minut** (9:30–10:00).
- **Long**: gap up; entry nad `OR_high + buffer` (baseline **$0.05** u nízkých cen — škálovat v % nebo v ATR).
- **Volume na break baru**: **≥ `vol_adv_fraction` ×** rolling **průměrný denní objem** (baseline **0,5** jako ve studii; u liquid large-cap zvažte **1,0–1,2×** inspirací z 5198458).

---

## 3. Univerzum a „in play“ filtr (4729284 + 5921742)

Python konfigurace (příklad názvů):

```yaml
universe:
  min_price: 5.0
  min_avg_dollar_volume_20d: 500000   # Poudel baseline; upravte podle brokera
  max_spread_pct: 0.15                # nebo abs. spread v $

stocks_in_play:
  use_relative_volume: true
  relative_volume_min: 2.0             # studie 100 % RV — mapujte na vaši definici
  # volitelně: news flag, premarket % change, atd.
```

**Relevantní princip**: neobchodovat „mrtvé“ jméno — edge v dlouhém horizontu vzorku byl u „akcí v pozornosti“ výrazně vyšší.

---

## 4. Režim trhu a kalendář (6355218 — adaptace na akcie)

```yaml
regime:
  vix_min: 15
  vix_max: 25
  allowed_weekdays: [0, 2, 4]   # Mon=0, Wed=2, Fri=4  (Po/St/Pá)
  skip_macro_days: true       # FOMC, CPI, NFP, hlavní Fed — vlastní kalendář
```

**Poznámka**: Striktní VIX filtr může výrazně snížit počet obchodů; pro robustní test držte `vix_min/max` jako parametr walk-forward.

---

## 5. Potvrzení průrazu a false break (5921742 + 5198458)

- **Objem na signálu**: min. násobek **denního průměru** nebo **relativní objem** (konfigurovatelné).
- **False breakout** (zejména `gap_and_go`): pokud po vstupu long cena do **`N` minut** spadne **pod `OR_low`** → **okamžitý exit** (kill switch). Symetricky pro short.

---

## 6. Stop-loss a position sizing (4416622 + 6272239 + 5921742)

1. **Strukturální stop** (Zarattini): long — pod **low první 5m** (resp. `OR_low` v `gap_and_go`); short — nad **high první 5m** (`OR_high`).
2. **ATR cap** (Poluri / obecná volatilita):  
   `stop_distance = min(|entry - structural_stop|, atr_mult × ATR14_daily)`  
   Pokud strukturální stop je **dál** než cap, **zmenšit pozici** nebo **riskovat menší R** — zabrání obřím stopům v divokých dnech.
3. **Velikost pozice**: `shares = floor((equity × risk_pct_per_trade) / stop_distance)`  
   Baseline **risk_pct_per_trade = 0,01**; respektovat **max leverage / buying power** (viz 4416622).

---

## 7. Take profit a čas ukončení

- **Profit target (standard)**: **10 × R** nebo **EoD** liquidation — který dřív (4416622).
- **Profit target (gap_and_go)**: **entry + `k_or_range` × šířka OR** (baseline **k_or_range = 2**).
- **Time stop**: plochý exit **T minut před závěrem** (např. 15:45 US), aby se redukoval overnight gap risk (5921742).

---

## 8. Transakční náklady a provedení (všechny studie, vynucení v kódu)

```yaml
execution:
  commission_per_share: 0.0005
  slippage_pct_per_side: 0.02    # doladit podle akcie
  enforce_max_spread_at_entry: true
 ```

Backtest musí **fail** nebo **označit trade jako neproveditelný**, pokud spread překročí limit — jinak přeceňujete edge (viz zejména 6355218, 5921742).

---

## 9. Výstup datového modelu pro Python

Minimální **normalizovaná řádka signálu** (např. pandas Row / dataclass):

```text
symbol, date, mode, or_high, or_low, first_bar_bias,
breakout_time, entry_time, entry_price, stop_price, r_distance,
atr14, vix, weekday, rv_at_break, spread_at_entry,
target_price, exit_reason, pnl_R, fees
```

---

## 10. Modulová struktura (doporučení)

```text
orb_strategy/
  config.yaml
  data/          # ingest minute bars, VIX, calendar
  filters.py     # universe, in_play, vix, weekdays, macro
  opening_range.py
  signals.py     # breakout + false-break
  risk.py        # stops, sizing, ATR cap
  execution.py   # costs, spread checks
  backtest.py
  live/          # volitelně broker API
```

Implementace ve vývojovém repozitáři: ``strategies/orb_prop_firm_killer_ref_v2/`` (Python verze **2**; verze **1** je Pine parity v ``orb_prop_firm_killer/``).

---

## 11. Co optimalizovat ve walk-forward (a co nebrutálně fittingovat)

- `gap_min_pct`, `vol_adv_fraction`, `vix_min/max`, `risk_pct`, `atr_mult`, `relative_volume_min`.  
- **Ne** zaměřovat se jen na kumulativní křivku bez **out-of-sample** bloků (5198458 ukazuje, že surové OUT může být OK, ale variabilita denních rozdílů zůstává vysoká).

---

## 12. Shrnutí pro maximalizaci „relevantní úspěšnosti“

1. **Kontext** > holý pattern: in-play + režim (VIX/kalendář).  
2. **5m OR + směr první svíčky** jako default; **30m OR + gap** jako druhý profil.  
3. **Likvidita a spread** jako tvrdý gate.  
4. **Strukturální stop + ATR strop** na velikost ztráty.  
5. **10R / EoD** nebo **2× šířka OR** podle módu.  
6. **Náklady a skluz** modelovat vždy — strategie je citlivá na provedení.

---

*Verze spec: 1.0 — odvozeno z PDF analýzy SSRN 5198458, 6272239, 4729284, 6355218, 4416622, 5921742.*
