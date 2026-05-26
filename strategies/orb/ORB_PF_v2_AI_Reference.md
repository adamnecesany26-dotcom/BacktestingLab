# ORB Prop Firm Killer v2 — AI Reference (Strategy + Indicator)

**Audience:** Machine-readable specification for downstream AI tools (agents, auditors, refactoring assistants).

**Artifacts:**

| Role | Pine file |
|------|-----------|
| Backtest engine (fills, exits, brokerage simulation) | `ORB_PropFirmKiller.pine` |
| Visualization / alerts / manual trade plan **without** `strategy.*` | `ORB_PropFirmKiller_IND.pine` |

**Language:** Pine Script **v6**, `//@version=6`.

**Research framing:** “Studie 3” build — OR-based US equity day-trading rules (Zarattini et al. 2024 and related ORB literature). The **script implements a parameterized superset** of that idea (prop-firm add-ons, optional filters, multiple SL modes).

---

## 1. High-level behaviour (shared)

1. Define a **trading session** window and an **Opening Range (OR)** of **N minutes** from the **session’s first bar open time** (wall clock, not “first N chart bars” unless the chart TF lines up).
2. While `orbBuilding`, maintain running **`orbHigh`** / **`orbLow`** = max high / min low seen **inside the OR window**.
3. On the **first bar where the OR window has expired** (`orbJustFinalized`), freeze direction:
   - **`firstCandleDir`**: compare **`close[1]`** of the **last bar that was still inside the OR build** vs **`firstOpen`** (open of the **first session bar**).  
   - `+1` bullish (long-only setup that day), `-1` bearish (short-only), `0` doji/neutral.
4. If **gates** pass and flat, arm **one** stop entry at the OR boundary:
   - Long: **`strategy.entry`** / plan at **`orbHigh`**.
   - Short: at **`orbLow`**.
5. Fill semantics: **stop order** — breakout is **trade-through** the level (wick can trigger); **closing price outside OR is NOT required**.
6. **Stop loss** is computed from **`f_stopPrice`** from the planned entry (`orbHigh` or `orbLow`) using `i_slMode`, `i_atrLen`, `i_atrSlPct`, `i_slMult`.
7. Exits:
   - **Ladder**: up to three **limit** partials at `f_limAtR` multiples of initial R; optional **runner** with **EoD flat** or **Fixed RR limit**.
   - **Full position**: single `strategy.exit` with stop + optional TP limit.
   - **Session end** or optional **daily loss breaker**: **`cancel_all`**, **`close_all`**.

---

## 2. Strategy: `strategy()` harness

Configured in **`ORB_PropFirmKiller.pine`**:

| Parameter | Value | Interpretation |
|-----------|-------|----------------|
| `overlay` | `true` | Draw on price pane |
| `initial_capital` | `10000000` | Large default so futures margin does not starve fills |
| `default_qty_type` | `strategy.fixed` | Base qty type (actual qty comes from sizing logic / `strategy.entry`) |
| `pyramiding` | `0` | No add-ons |
| `calc_on_every_tick` | `false` | Historic bar semantics only |
| **`process_orders_on_close`** | **`true`** | **Critical:** Order simulation / sequencing differs from naive “touch inside bar”; contributes to visible **bar-shift vs raw high/low intuition** |
| `commission_type` | percent `0.005` | 0.5% round-turn style setting (adjust per instrument reality) |
| `slippage` | `1` | Tester slippage in ticks |
| `max_boxes_count` / `max_lines_count` / `max_labels_count` | `500` | Raised so frozen PnL drawings are not prematurely culled |

**Implication for humans / indicator alignment:** Tester fill **timing** can lag **immediate** intra-bar touches; **`i_entryXMode = "Strategy tester (backtest parity)"`** approximates that deferral (§13). Earlier modes trade parity for live visibility.

---

## 3. Session & OR window (identical logic between scripts)

**Session predicate:** `inSession = not na(time(timeframe.period, i_session, i_tz))` (and lagged variants for edges).

**Events:**

- `newSession` — first bar inside session after being outside.
- `sessionEnd` — first bar outside session after being inside.

**OR build flag:**

```text
orbBuilding := inSession and not na(orbStartTime)
     and (time - orbStartTime < i_orbMinutes * 60000)
```

- `orbStartTime` set on `newSession` to that bar’s `time` (bar open time).
- OR length is **milliseconds wall time**: `i_orbMinutes * 60000`.

**Range update (while building):**

```text
orbHigh := max(orbHigh, high)
orbLow  := min(orbLow,  low)
```

**Finalize:**

```text
orbJustFinalized = orbBuildingPrev and not orbBuilding
```

On finalize:

```text
orbReady := true
orCloseEnd = close[1]   // close of last OR-building bar
firstCandleDir := orCloseEnd > firstOpen ? 1 : orCloseEnd < firstOpen ? -1 : 0
```

**Chart timeframe rule:** Intended **`timeframe.period` minutes ≤ `i_orbMinutes`**. Both scripts warn (label) if chart bar length **exceeds** OR length — OR logic becomes inconsistent with the paper’s “N-minute window”.

**ORB box drawing difference:**

- **Strategy:** Box from `orbStartTime` to **finalize bar’s** `time`, `extend.right` until `sessionEnd`, then clamp right edge.
- **Indicator:** Precise rectangle: **`orbEndClose`** = `time_close` of the **last OR-building bar**; `extend.none`; old `orbBox` deleted before creating a new one.

---

## 4. External series (both scripts)

All `request.security` use **`lookahead = barmerge.lookahead_off`** and **`gaps = barmerge.gaps_off`** where applicable. ATR/SMA use **`[1]`** on daily series where noted in code — **non-repaint** prior bar.

| Series | Usage |
|--------|--------|
| `dailyAtr` | `ta.atr(i_atrLen)[1]` on `"D"` |
| `dailyAvgVol` | `ta.sma(volume, 14)[1]` on `"D"` |
| `dailyOpen` | daily `open` |
| `htfEma` | `ta.ema(close, i_htfEmaLen)[1]` on `i_htfTf` |

---

## 5. Relative volume (OR session volume vs history)

**During `orbBuilding`:** accumulate `orVolToday += volume`.

**On `orbJustFinalized`:** push `orVolToday` into `orVolHist` ring buffer of length `i_relVolBack`, compute:

```text
relVol = orVolToday / average(orVolHist excluding current push semantics per code)
```

First history bar defaults `relVol := 1.0`.

**Gate:** if `i_useRelVol`, require `relVol >= i_relVolMin`.

---

## 6. Eligibility gates

**Strict (`gateStrict`):**

```text
orbReady and inSession and universeOk and relVolOk and dowOk
     and (not dailyLossHit) and tradeCountOk
```

**Loose (`gateLoose`):**

```text
orbReady and inSession and tradeCountOk
     and (not i_useRelVol or relVolOk)
```

**Note:** `RelVol` is intentionally **not** dropped in relaxed mode when `i_useRelVol` is ON — only universe / DoW / daily-loss are skipped by relaxed. When `i_useRelVol` is OFF, `relVolOk` is vacuously true and behaviour matches the old relaxed gate.

**Selected gate:**

```text
gate = i_relaxedBt ? gateLoose : gateStrict
```

**Universe (`universeOk`):** When `i_useUni`, require `dailyOpen >= i_minPrice`, `dailyAvgVol >= i_minAvgVol`, `dailyAtr >= i_minAtr`.

**DoW:** When `i_useDow`, require today’s weekday enabled via `i_mon`…`i_fri`.

**HTF:** When `i_useHtf`, long path needs `close > htfEma` (`htfBullOk`), short needs `close < htfEma` (`htfBearOk`). Uses **chart close** vs **prior HTF EMA** — not a separate HTF bar close unless chart is HTF.

### 6.1 Daily loss

**Strategy:**

```text
dailyPnLPct = (strategy.equity - dayStartEquity) / dayStartEquity * 100
dailyLossHit = i_useDayStop and dailyPnLPct <= -i_dayLossPct
```

**Indicator (approximation):**

```text
dailyPnLPct = (close / sessOpenRef - 1) * 100   // sessOpenRef = session first bar open
dailyLossHit = i_useDayStop and dailyPnLPct <= -i_dayLossPct
```

These are **not equivalent** when `i_useDayStop` is on — strategy uses **account equity**, indicator uses **price change from session open**.

### 6.2 Trade / setup count

**Strategy `tradesToday`:** closed trades since session snap + 1 if currently in position.

**Indicator `setupsArmCount`:** increments when a **bracket plan** is armed (`orderArmed` block succeeds). **`tradeCountOk = setupsArmCount < i_maxTrades`**.

Naming differs; both cap “attempts per day” via `i_maxTrades`.

---

## 7. Stop loss: `f_stopPrice(isLong, entry)`

Let `orW = abs(orbHigh - orbLow)`, `minD = syminfo.mintick`.

Modes:

1. **`ATR % (Daily)`**  
   `atrD = dailyAtr * i_atrSlPct / 100`  
   `baseDist = atrD` or fallback `orW` if `dailyAtr` na  
   `adjDist = max(baseDist * i_slMult, minD)`  
   Long: `entry - adjDist`. Short: `entry + adjDist`.

2. **`OR Opposite Boundary`**  
   `adjDist = max(orW * i_slMult, minD)`  
   Long: `entry - adjDist`; Short: `entry + adjDist`.  
   (Interprets “full OR width scaled” opposite side style distance.)

3. **`Opposite OR Price (orbHigh/orbLow)`**  
   Anchor long: `orbLow`; short: `orbHigh`.  
   `adjA = max(abs(entry - anc) * i_slMult, minD)` → offset entry away from anchor.

4. **`First OR bar High/Low`**  
   Anchor long: `orFirstBarLo`; short: `orFirstBarHi` (tracked during session reset). Same distance pattern as mode 3; fallback `orW` if anchor na.

Invalid branch falls back scaled `orW`.

**Validity checks at entry:**

- Long requires `stop < entry` (`sP < eP`).
- Short requires `stop > entry` (`sP > eP`).

---

## 8. Take profit & R math

**Initial R distance:** `abs(entry - stop)` using **initial** `stopPx` stored at entry (ladder partials still reference this for limit placement).

```text
f_tpPrice(isLong, entry, stop):
    rDist = abs(entry - stop)
    long: entry + rDist * i_fixedRR
    short: entry - rDist * i_fixedRR

f_limAtR(isLong, entry, stop, rMult):
    rDist = abs(entry - stop)
    long: entry + rDist * rMult
    short: entry - rDist * rMult
```

**`i_exitMode`:**

- **`EoD`:** Runner / full position flattened by `strategy.close_all` at session end (unless stopped out sooner).
- **`Fixed RR`:** Runner (or full) gets `strategy.exit(..., limit = tpPx, stop = ...)` — TP box only when RR mode + valid `tpPx`.

---

## 9. Position sizing

### Strategy

```text
f_qty(entry, stop):
    if Fixed Contracts -> i_contracts
    else -> riskAmt = strategy.equity * i_riskPct / 100
           qty = riskAmt / abs(entry - stop)

    if i_relaxedBt -> max(qty, 1.0)
    else -> qty

f_entryQty:
    base = f_qty(...)
    if relaxed AND Ladder mode -> max(max(base, sumLadderQty), 1.0)
    else -> base
```

**Ladder constraint:** `sumLadderQty <= q` must hold or entry is skipped.

### Indicator

Same structure but **`i_proxyEquity`** replaces `strategy.equity` in `%` mode:

```text
q0 = i_posMode == "Fixed Contracts" ? i_contracts
   : i_proxyEquity * i_riskPct / 100 / abs(entry - stop)
```

**Indicators have no brokerage equity** — sizing display is illustrative unless user syncs proxy to account.

---

## 10. Entry (strategy implementation)

Single attempt per session while flat:

```text
if orbJustFinalized and gate and not orderArmed and strategy.position_size == 0
```

**Long branch:** `firstCandleDir == 1` AND `htfBullOk`  
- `eP = orbHigh`  
- `sP = f_stopPrice(true, eP)`  
- `q = f_entryQty(eP, sP)`  
- `ladOk` ladder sum check  
- If `not na(sP)` and `sP < eP` and `q > 0` and `ladOk`: store `entryPx`, `stopPx`, `tpPx`, sizes, **`orderArmed := true`**, call:

```pine
strategy.entry("L", strategy.long, qty = q, stop = eP, comment = "OR-Long")
```

**Short branch:** `firstCandleDir == -1` AND `htfBearOk`  
- `eP = orbLow`, `sP = f_stopPrice(false, eP)`, symmetrical validity `sP > eP`:

```pine
strategy.entry("S", strategy.short, qty = q, stop = eP, comment = "OR-Short")
```

**State reset when flat:**

```text
if strategy.position_size == 0 and (sessionEnd or newSession):
    entryPx, stopPx, tpPx, entryQty, runnerQtyInit := na
    orderArmed := false
```

**Circuit breaker:**

```text
if dailyLossHit or sessionEnd:
    strategy.cancel_all()

if (dailyLossHit or sessionEnd) and position != 0:
    strategy.close_all(comment = ...)
```

---

## 11. Exit wiring (strategy)

**Partial detection:**

```text
partialOccurred =
    position != 0 and not na(entryQty)
    and abs(position_size) < entryQty - 0.0001
```

**Breakeven stop for ladder runner (optional):**

```text
activeStop = (i_useBE and Ladder mode and partialOccurred) ? entryPx : stopPx
```

Each ladder leg runs `strategy.exit` with **`stop = stopPx`** (initial stop, **not BE**) on partial exits — BE applies to **`L-Final` / `S-Final`** stop when enabled.

**Full position branch:** Final exit uses **`stopPx`** (+ `limit tpPx` if Fixed RR).

**Runner qty:** `runnerQtyInit = q - sumLadderQty` in ladder mode; final exit only created if `runnerQtyInit > 0`.

---

## 12. Indicator: plan state machine (no fills)

State variables: `orderArmed`, `bracketActive`, `pendEntry`, `pendStop`, `pendTp`, `pendQty`, `pendRunnerQty`, `pendLeftT`, `pendLong`, **`bracketArmBar`**.

**Arm block:** Mirrors strategy conditions but **writes plan fields** instead of calling `strategy.*`.

```text
if dailyLossHit or sessionEnd:
    orderArmed := false   // bracket may still show until sessionEnd clears pend*

if sessionEnd:
    bracketActive := false
    pendEntry/stop/tp := na
```

---

## 13. Indicator: “stop entry touched” marker (`firstTouchStopEntry`)

**Purpose:** Approximate strategy tester fill **bar**, or provide **earlier** touch markers for manual / replay use.

Controlled by **`i_entryXMode`** (and **`i_showEntryX`** for drawing).

**Per-bracket bookkeeping:** On `pendLeftT` change, **`bracketTouchedEntry`** resets.

**Deferral predicate `entryXBarOk`** (conceptual):

```text
bracketArmBar := bar_index on the orb-finalize ARM bar.

"Strategy tester (backtest parity)": bar_index > bracketArmBar + 1
"One bar after OR arm (earlier)":   bar_index > bracketArmBar
"Immediate incl. arm bar":       bar_index >= bracketArmBar
"Off":                            never evaluate touch pulses
```

**Touch (first time per bracket once `entryXBarOk`):**

```text
long:  high >= pendEntry
short: low  <= pendEntry
```

Default **parity** mode excludes arm bar **and** the next bar (`> arm + 1`).

**Manual workflow:** The **triangle + arm alerts** are the canonical **“prepare bracket now”** signal; **`firstTouchStopEntry`** is secondary confirmation / parity replay depending on **`i_entryXMode`**.

**Not modeled:** Exact fill price, partial fills, stop-limit rejected touches, latency.

---

## 14. Visual layers

### Strategy

- ORB box: see §3 strategy variant.
- **PnL zones** (`i_showPnl`): live boxes/lines while `position_size != 0`; **freeze** on `pnlCloseEvt` via snapshot `pnlSnap*`. Creates persistent `box.new` if handles were deleted (recovery path).
- Reward box only if `i_exitMode == "Fixed RR"` and TP defined (`haveTp`).
- **Plots:** When PnL on: `PnL — Entry/S L/ TP`. When PnL off but `i_showLevels`: SL/TP + ladder traces.
- **Shapes:** Triangle on **`position_size`** flip (actual fill visualization).

### Indicator

- ORB box precise window (`orbEndClose`).
- **Triangles:** `sigLongShown` / `sigShortShown` on **`orbJustFinalized`** bar when plan arms — **not** synonymous with historical strategy fill triangle.
- **X marks:** `firstTouchStopEntry` + `i_showEntryX`; timing from **`i_entryXMode`**.
- **Ladder P1–P3:** Shown when **`i_showPnl OR i_showLevels`** while `bracketActive` (ladder mode).
- **Bracket plots:** Entry/SL/TP lines while `bracketActive` when PnL on.
- **`sessClosePlan`:** freezes PnL-style drawing at session boundary (planned bracket snapshot); clears handles after freeze (historical artefacts remain as orphan drawings subject to Pine object caps).

Drawing limits: indicator `max_boxes_count=300` (strategy 500).

---

## 15. Alerts (indicator only in codebase)

| Condition | Rough meaning |
|-----------|----------------|
| `sigLongShown` | Long bracket plan armed |
| `sigShortShown` | Short bracket plan armed |
| `firstTouchStopEntry` | Deferred first trade-through detection |

(Strategy script in repo does not expose `alertcondition` in excerpted sections — rely on Tester + shapes or add alerts downstream.)

---

## 16. Default / parity checklist for AI-maintainers

1. **`i_relaxedBt` default `true`** — drops **universe, DoW, daily-loss halt** from the gate chain; **`i_useRelVol` still applies when enabled** on both scripts.
2. **`i_atrSlPct`:** Indicator default aligned to strategy **30.0**; still verify user presets when comparing runs.
3. **Daily loss:** Comparable only when strategy equity path aligns with `% from session open` — generally **don't** assume parity when `i_useDayStop`.
4. **Ladder BE:** Strategy updates **activeStop**; indicator **`pSnapSl` / visuals** stick to **initial** stop for simplicity (documented in indicator header).

---

## 17. Operational limits & reinterpretation hazards

| Topic | Detail |
|-------|--------|
| **Stop vs close breakout** | Entry is **trade-through stop**, not **`close`** beyond OR boundary. |
| **`process_orders_on_close`** | Fills/order evaluation ordering — use indicator deferral heuristic; still not bitwise identical to all broker types. |
| **Slippage & commission** | Tester knobs ≠ live order book / stop-market slip / stop-limit skips. |
| **Data feed** | Heikin Ashi / non-standard aggregates alter OHLC semantics vs study. |
| **Object eviction** | Exceeding Pine max drawing objects trims oldest artefacts in long histories. |

---

## 18. Minimal decision tree (AI summary)

```
on new session -> reset session-scoped counters / OR trackers
while OR clock active -> widen orbHigh/orbLow, accumulate OR volume

on orbJustFinalized:
    set firstCandleDir from last OR bar vs first session open

if finalize bar AND gate AND not already armed AND (strategy flat OR indicator order slot free):
    if bull direction + bull HTF gate (if enabled):
        plan/stop-buy at orbHigh, compute stop qty checks
    if bear direction + bear HTF gate:
        plan/stop-sell at orbLow, symmetrical

while position open (strategy) OR bracketActive (indicator):
    manage exits / draw planned levels

if session ends OR simulated daily DD trip:
    cancel children, flatten, reset session fields
```

---

*End of document. Maintain alongside `ORB_PropFirmKiller.pine` and `ORB_PropFirmKiller_IND.pine`; revise when Pine logic changes.*
