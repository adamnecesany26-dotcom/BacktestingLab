# UI/UX audit — power user (trader + builder)

**Datum:** 2026-03-23  
**Cílový uživatel:** Ty — technický, netrpělivý, chce rozhodnutí **do ~30 s**, hustá data, minimum kliků.  
**Neřeším:** obecné „hezčí UI“, kompletní redesign.  
**Zaměření:** konzistence, workflow, **Results** (extrémně kritické).

---

## 1) Kritické UX problémy (zpomaluje / mate)

### 1.1 Rozhodovací signál je pohřbený

**Heuristika „edge readiness“, overfitting varování, validace / MC souhrn** jsou v `AnalyticsView` uvnitř **`<details>`** („Obecná analytika — …“). To znamená: abys dostal odpověď **„má to vůbec smysl pokračovat?“**, musíš **přepnout na záložku Analytics** a **rozkliknout** sekci.

Pro power usera je to **fail**: první věc po runu není Sharpe v mřížce, ale **stav validity + red flags**. Teď to **není** nahoře.

**Konkrétní návrh:** Přesuň **jeden řádek** (readiness label + severity + 2–3 nejhorší warningy + validation mode + „MC: ano/ne“) **nad** `StatBlocks` v `ResultsView.tsx`, stejný zdroj dat jako `assessOverfitting` v `AnalyticsView`. `<details>` nech pro **hloubku** (tabulky, foldy, experimenty).

### 1.2 Záložky = nucené skákání

`Equity` | `Highlight` | `Detailed` | `Analytics` | `Run history` — **metrika grid je společný**, ale **kontext runu** (WF foldy, param test graf, S/D breakdown) je **jen** v Analytics. Iterace typu „equity ok → proč to padá na zónách“ = **vždycky přepnout tab**.

**Návrh:** Buď **split view** (equity nahoře / analytika dole) na širokém monitoru, nebo **minimálně** klávesové zkratky `1–5` na taby (bez překryvu s browserem).

### 1.3 Duplicitní a rozházená hierarchie metrik

- `StatBlocks`: Sharpe, Sortino, equity, DD, trades, WR, return, PF, expectancy…  
- `AnalyticsView` (uvnitř details): znovu **cards** (počet obchodů, W/L, avg win/loss, best/worst, MFE/MAE, max equity, max DD) — **část překrývá** StatBlocks, **část doplňuje** (MFE/MAE), ale musíš **hledat** ve dvou patrech.

**Návrh:** **Seskup Y:** jedna sekce **„Run snapshot“** = všechny čísla z jedné mřížky (včetně MFE/MAE) buď jen ve StatBlocks rozšířené, nebo jen v Analytics — **ne obojí** bez označení „duplicitní“.

### 1.4 `StatBlocks`: malé fixní dlaždice `w-[140px]`

Na širokém displeji to **láme řádky** bizarně; na úzkém **plýtvá** vertikálou. Power user chce **tabulku nebo hustší grid bez umělého min-width**.

**Návrh:** Odstraň fixní šířku; použij **CSS grid `auto-fill minmax(7rem,1fr)`** nebo **jednu kompaktní tabulku** (metric | value).

### 1.5 ⓘ tooltips u každé metriky

`METH_TIPS` — pro začátečníka fajn, pro tebe **vizuální šum** a **náhodné hover** na „?“.  

**Návrh:** Skrýt pod **„Metodika“** toggle (default **vypnuto** pro uložený preference) nebo zobrazit jen u **pravého kliku / long press**.

### 1.6 Analytics: pořadí bloků vs rychlá oseka

Nahoře: `ManifestRunConfigStrip` → `ParamTestAnalytics` → výběr modulu (jedna možnost „S/D zóny“) → `SdZoneAnalytics` → až pak **details** s readiness.

Pro **S/D workflow** je **Param test graf** někdy **nad** vlastní S/D analytikou — pokud zrovna neřešíš param sweep, je to **šum nahoře**.

**Návrh:** Pokud `paramTest` chybí, **nerenderuj** placeholder výšky; pokud je, **sbalit** Param test do `<details open={false}>` s nadpisem „Param sweep“.

### 1.7 Slovník zón (hover panel)

`ZoneDataDictionary` — **hover otevře velký panel**. Při pohybu myší přes toolbar **náhodně překryje** UI. Power user dává přednost **klik → modal / side drawer**.

### 1.8 Run history jako 5. tab

Historie runů je **důležitá pro srovnání iterací**, ale je **oddělená** od aktuálního výsledku stejně jako Analytics. **Porovnání A/B** = spíš **duální výběr** v historii, ne přepínání tabů (pokud už to není v RunHistory — neauditoval jsem hloubku, ale tab model **nepushuje** diff).

---

## 2) Co je dobře (držet)

- **StatBlocks + Quality gate** jsou **vidět bez** vstupu do Analytics — základ pro rychlý scan je tam.  
- **Batch přepínač instrumentu** + vysvětlující amber box — jasné, kde končí agregace a začíná jeden symbol.  
- **Detailed** s výřezem po obchodech / měsících, TF select, Plotly s moduly — **správný** nástroj na forenzní práci.  
- **EquityChart** downsampling + lightweight — **ne** táhne megapixelovou stupiditu při dlouhé historii.  
- **Manifest strip** v Analytics — **jedna pravda** o tom, co bylo zapnuté v requestu; pro audit runu **kvalitní**.  
- **Export JSON + Repro bundle** nahoře vpravo — **builder-friendly**, málo kliků.

---

## 3) Co chybí (hlavně Results) pro rozhodnutí za 30 s

| Chybí | Proč to bolí |
|--------|----------------|
| **„Verdikt řádek“** (readiness + top warnings) nad metrikami | Bez toho čteš **15 čísel** místo **jedné odpovědi** „pokračuj / zahoď“. |
| **Koncentrace PnL** (kolik % z celku dá top 5 obchodů) | Okamžitá detekce **curve-fit na dvě střely**. |
| **Jedna věta kontextu běhu** vedle runId (instrument, data file, TF, years, execution on/off) | Dnes část v manifestu, část v hlavičce — **rychlá orientace** chce **inline**. |
| **Srovnání s předchozím runem** (delta klíčových metrik) | Iterace bez diffu = **pamatuj si hlavou**. |

---

## 4) High-impact zlepšení (malé změny → velký efekt)

1. **Readiness + flags** ven z `<details>` → **sticky pod** quality gate / nad StatBlocks.  
2. **Seskupit metriky** do **3 sloupců**: PnL / Risk / Activity (trades, long/short, WR) — méně skenování očima.  
3. **Vypnout nebo zabalit** ⓘ tooltips defaultně.  
4. **Klávesové zkratky** na taby výsledků.  
5. **Param test** sbalit, když není relevantní.  
6. **Zone slovník** na **klik**, ne hover.

---

## 5) Konzistence a cognitive load

- **Konvence:** Taby výsledků vs jiné části appky (editor, settings) — rozumně konzistentní (zinc/emerald).  
- **Nekonzistence:** Někde „power“ data v **summary** (manifest), někde v **details**, někde v **StatBlocks** — **stejná otázka** („běžel MC?“) lze číst na **třech místech** s různou přesností. Po přesunu readiness nahoru **sjednoť**: jedna **canonical** věta + odkaz „detail v Analytics“.  
- **Cognitive load:** Střední až vysoký — ne proto, že je **husté**, ale proto, že **důležité je skryté** a **duplicitní**.

---

## 6) Grafy (stručně)

- **Equity:** Kontext DD **jen implicitně** z křivky; **číslo** max DD je v metrikách — OK pro scan.  
- **Highlight / Detailed:** Trade + modul výstupy — **těžké** (Plotly), ale **odůvodnitelné** pro práci se zónami; **clutter** řeší výřez okna, ne globální zoom.  
- **Module outputs:** Sloučení více modulů v `mergedOutput` s prefixem `mod: line` — **správné** pro rozlišení, u mnoha modulů **přeplněné** — legenda / filter by pomohly (budoucí iterace).

---

## 7) Red flags (zbytečné / matoucí)

- **Duplicitní stat cards** v Analytics details.  
- **Readiness uvnitř zavřeného details** — největší hřích pro tvůj use-case.  
- **Jedna položka** v selectu „Typ analytiky“ (`S/D zóny`) — **zbytečný krok**; zmizí až přidáš druhý modul.  
- **Dlouhé vysvětlující odstavce** v manifest stripu — pro tebe **snížit** na jednu linku nebo odkaz „docs“.

---

## 8) Závěr

**Intuitivní** pro rychlé rozhodování: **částečně** — data tam jsou, **priorita zobrazení** je **špatně** pro power usera: **nejprve** čísla, **až pak** (po klikání) **inteligence** o tom, jestli jsou čísla **k ničemu**.

**Optimalizace bez redesignu:** přesuň **rozhodovací vrstvu** nahoru, **orez duplicity**, **zkratky + méně náhodných hoverů**. Pak to odpovídá někomu, kdo chce **maximum informací v minimálním čase** — teď to spíš odpovídá **„všechno máme, najdi si to“**.

---

**Soubory k úpravě (implementační kotva):**  
`frontend/components/results/ResultsView.tsx`, `frontend/components/results/AnalyticsView.tsx`, `frontend/components/results/StatBlocks.tsx`, `frontend/lib/overfittingSignals.ts`.
