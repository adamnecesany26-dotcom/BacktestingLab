# READMEADAM — tvůj přehled aplikace (Backtesting App)

Tento soubor je **osobní mapa produktu**: co aplikace umí, kde to najdeš v UI a jak z ní vytěžit maximum. Technické detaily deploymentu a API jsou v `README.md` a `READMEAI.md`; tady jde o **používání**.

### Rodina README / dokumentace v repozitáři

| Soubor | Obsah |
|--------|--------|
| **READMEADAM.md** (tento) | Mapa UI, funkcí, workflow, odkazy na nápovědu v aplikaci. |
| **README.md** | Kompletní technická dokumentace platformy, API, struktura, limity, troubleshooting. |
| **READMEAI.md** | Kontrakty a data flow pro AI / vývojáře; tabulka „kde měnit kód“. |
| **SCRIPTS.md** | Jak spustit backend, frontend, Docker; časté problémy. |
| **examples/\*/README.md**, **strategies/\*/README.md** | Dokumentace konkrétního modulu/strategie + níže odkaz na platformu. |

Při větší změně produktu aktualizuj konzistentně **README.md** (technické), **READMEAI.md** (kontrakty), **READMEADAM.md** + **`guideContent.ts`** + **`backtestFieldMeta.ts`** (uživatelský popis).

---

## Kde hledat nápovědu (vždy aktuální s kódem)

| Zdroj | K čemu |
|--------|--------|
| **Ikona „?“ u polí** (pravý panel) | `FieldHelpPopover` + texty z `frontend/components/backtestFieldMeta.ts` — vysvětlení konkrétního nastavení. |
| **Stránka `/guide`** | Plný textový průvodce z `frontend/data/guideContent.ts` — otevřeš plovoucím tlačítkem **?** vpravo dole na hlavní stránce nebo přejdeš na `/guide`. |
| **Guided mode** | V pravém panelu sekce *Guided mode (beginner)* — krokové checklisty + varování před riskantní kombinací (např. sweep bez OOS). |
| **StatBlocks ⓘ** | Nad záložkami výsledků — krátké metodické poznámky u metrik (Sharpe, PF, …). |
| **Analytics** | Blok *Heuristic edge readiness* + *Overfitting warnings* — sdílená logika v `frontend/lib/overfittingSignals.ts` (heuristiky, ne test významnosti). |
| **Tento soubor** | Celkový přehled funkcí a workflow. Po velkých změnách ho nech aktualizovat spolu s `guideContent.ts` a `backtestFieldMeta.ts`. |

---

## Rozložení obrazovky (hlavní stránka `/`)

1. **Levý panel (Sidebar)**  
   Výběr typu položky (strategie / indikátory / moduly), seznam entit, soubory u otevřené strategie. Vytváření strategie, přidání souboru.

2. **Střed**  
   - **Editor** — kód `main.py`, indikátorů, modulů.  
   - **View** — přepínač View mód: svíčky + výstupy `detect` / `get_line` / `get_zones` bez plného backtestu (`StrategyViewChart`).

3. **Pravý panel (`BacktestSettings`)**  
   Veškerá konfigurace backtestu, edge finding, Run.

4. **Spodní panel (`LogPanel`)**  
   Logy ze serveru / Dockeru během běhu, progress.

5. **Po Runu**  
   Přepne se na **Results** (`ResultsView`): záložky Equity → Highlight → Detailed → Analytics → Run history, exporty.

---

## Pravý panel — sekce po sekci

### Guided mode (beginner)

- Checklist: instrument + roky → realistická simulace → validace ne single → quality gates.  
- **Varování** (žlutý text): single run, sweep bez OOS/WF, nízký min trades, vypnuté MC, kombinace fixní seed + sweep na single.  
- Tlačítko *Beginner defaults* nastaví rozumný výchozí edge profil (OOS, MC, …).

### Basic

- **Instrument Type** — futures / stocks / forex (filtr dat a chování brokera).  
- **Instrument** — konkrétní symbol + dostupná léta dat.  
- **Roky** — hloubka historie.

### Instrument config

- Futures: tick size, value per tick.  
- Stocks: position size.  
- Forex: lot, pip (dle dostupnosti v UI).

### Simulation

- Počáteční kapitál, slippage %, komise %.

### Indicators & modules

- Checkboxy + **Potvrdit** — co se zkopíruje do Docker běhu (`indicators/`, `modules/`).  
- Auto-detect závislostí z importů v `main.py` (doplňuje výběr).

### Parameters

- Záložky **Strategy** vs jednotlivé **moduly**.  
- Hodnoty z `PARAMS` / `VIEW_PARAMS` v Pythonu; metadata z `PARAMS_META` / `VIEW_PARAMS_META` se promítne do nápovědy u dynamických polí.

### Run

- Tlačítko spuštění (streaming logů).  
- Funguje jen pro **strategii** s `main.py` a vybraným instrumentem.

### Edge finding (nejširší blok funkcí)

| Oblast | Co to dělá |
|--------|------------|
| **Rychlé profily** | Safe / Balanced / Explore — přednastavení validace, sweep, MC, execution. |
| **Validation mode** | `single` (rychlé, nejnižší důvěra) / `oos_split` / `walk_forward`. |
| **OOS ratio** | Velikost hold-out části (např. 0.25). |
| **WF folds / test ratio** | Počet oken a podíl testu ve walk-forward. |
| **Quality gates** | Min trades, max DD %, min PF — engine vyhodnotí PASS/FAIL. |
| **Fixní run seed** | Zapneš-li, stejný seed → reprodukovatelné MC, sweep, block bootstrap (`experiment.seed` → `RUN_SEED`). Bez zaškrtnutí náhodný seed každý run. Batch: stejný seed pro všechny dílčí runy z jednoho requestu. |
| **Experiment** | Hypotéza, tagy (CSV), **Run branch** (seskupení runů). |
| **Promote when gates pass** | Logický příznak v experimentu pro workflow (kandidát po splnění gate). |
| **Sweep** | `none` / `random` / `grid` + počet vzorků — citlivost na parametry (s OOS/WF mnohem bezpečnější). |
| **Monte Carlo** | Zap/vyp, počet simulací, **režim**: `iid_trade` vs `block_bootstrap` (serialita PnL). |
| **Regime segmentation** | Zapíná regime analýzu v engine (pokud je v datech/strategii podporováno). |
| **Portfolio backtest** | Více instrumentů v jednom requestu (JSON konfigurace) — **nepoužívat současně s batch** (UI to hlásí). |
| **Batch / matrix** | Pole `items` v JSON — stejná strategie, různé overrides (instrument, data_file, …); sekvenční runy, souhrn v `batchSummary` + varování multiple testing. |
| **Execution model** | Spread (bps), slippage × vola, latence v barech. |
| **Forward bridge** | Paper/live shadow režim + baseline equity pro srovnání driftu (metriky v `executionSummary`). |

---

## Výsledky (`ResultsView`)

### Horní lišta

- **Zpět na editor**  
- **Export JSON** — celý RunResponse (pro vlastní analýzu).  
- **Repro bundle (ZIP)** — `manifest.json`, `results_summary.json`, `strategy_main.py` (snapshot z editoru v okamžiku exportu), `README_bundle.txt`. Pozor: neuložené změny v editoru vs Firestore.

### StatBlocks

- Mřížka klíčových metrik + ⓘ tooltips (omezení interpretace Sharpe/Sortino/PF/…).  
- Pokud běžel MC: řádek s **risk of ruin** (odhad) a **mode**.

### Záložka Equity

- Křivka equity (a související grafy dle implementace).

### Highlight / Detailed

- Výběr obchodu, svíčky, zvýraznění vstupů/výstupů, tabulka obchodů.

### Analytics

- **Readiness / overfitting** — severity score + seznam heuristických varování (`overfittingSignals.ts`).  
- Validace, foldy, guardrails, robustnost / heatmapa sweepu, Monte Carlo, režimy, **cost attribution** (poplatky/slippage rozpad), forward bridge, batch summary, quality gate checks, experiment (run diff, promote evidence, …).

### Run history

- Uložené runy ze Firestore pod strategií.  
- **Readiness** sloupec — stejná heuristika jako Analytics.  
- Výběr více runů → **compare** (metriky vedle sebe).  
- **Lifecycle / governance** — úprava stavu schválení (zápis do `experiment.*` v dokumentu; při `API_STRICT_GOVERNANCE` na backendu platí omezení pro API klíč — viz README).

---

## View mód

- Rychlá kontrola signálů bez backtestu.  
- Volá se `/api/view` v sandboxu (`view_engine.py`).  
- **Timeframe svíček** — výběr „Původní (instrument)“ nebo hrubší agregace (`1m` … `1Mo`); server dělá pandas `resample` na OHLC **před** voláním `detect` / `get_line` / `get_zones` (stejný DataFrame jako na grafu).  
- Parametry z `VIEW_PARAMS` + nápověda jako u strategických parametrů (logický TF modulu je nezávislý na agregaci svíček).

---

## Ukládání a historie

- Po úspěšném runu se výsledek typicky uloží do Firestore (`saveBacktestResult`).  
- Historie se znovu načte (`listBacktestResults`).  
- Mazání: jednotlivé / vše (soft delete dle implementace v `firestore.ts`).

---

## Co je v produktu „novější“ / pokročilé (poslední vlna funkcí)

Shrnutí toho, co často chybí v hlavě po rychlém vývoji:

- **Cost attribution** v execution summary + zobrazení v Analytics.  
- **Monte Carlo** s volitelným **block bootstrap** a texty `method` / `mode` / `note` v payloadu.  
- **Walk-forward / OOS** s fold tabulkou a **guardrails** (heuristiky, ne důkaz).  
- **Batch/matrix** běhy s `batchSummary` a varováním na multiple testing.  
- **Fixní seed** v UI a manifestu.  
- **Repro ZIP** z výsledků.  
- **Overfitting / readiness** sdílené mezi Analytics a Run history.  
- **Audit / governance** hooky na backendu (README Phase 6).  
- **StatBlocks** metodické ⓘ a rozšířené metriky (Calmar, ulcer, … dle engine).

*(Tento seznam doplňuj při dalších větších releasích.)*

---

## Doporučený denní workflow (stručně)

1. Úprava kódu → uložit.  
2. View: ověřit logiku na grafu.  
3. Nastavit Edge: aspoň OOS nebo WF pro „vážné“ rozhodnutí; zapnout MC; uvážit execution model.  
4. Run → logy → Results → Analytics (readiness) → případně Run history compare.  
5. Při potřebě sdílet kontext: Export JSON nebo Repro bundle.

---

## Soubory v repu, které drží „pravdu“ o UI

- `frontend/app/page.tsx` — hlavní stav, sestavení `RunRequest`, navigace.  
- `frontend/components/BacktestSettings.tsx` — všechna nastavení a guided texty.  
- `frontend/components/backtestFieldMeta.ts` — obsah popup nápovědy.  
- `frontend/data/guideContent.ts` — `/guide`.  
- `frontend/lib/overfittingSignals.ts` — pravidla readiness / overfitting.  
- `shared/types/index.ts` — tvar request/response.

Když něco v aplikaci **nevypadá podle dokumentace**, první krok: tyto soubory + `README.md`.

---

## Vysvětlení konfiguračního menu

Tahle část je **pro tebe, když se v pravém panelu ztrácíš**. Představ si, že sedíš s mentorem: jdeme **shora dolů**, jak jsou sekce v menu. Cílem není tě zahltit žargonem, ale říct **k čemu to je v praxi** a **kdy to řešit**.

---

### 1) Guided mode (beginner)

**Co to je:** Malý „trenér“ uvnitř aplikace. Nekontroluje strategii za tebe — jen říká: *„Udělal jsi základní kroky, aby výsledek dával aspoň trochu smysl?“*

- **Checklist (odškrtávací body):** máš vybraný instrument a roky, rozumné nastavení simulace (kapitál, poplatky), zapnutou **validaci** něco jiného než čistý *single run*, a nastavené **quality gates** (minimální počet obchodů a rozumný minimální profit factor).
- **Tlačítko „Použít doporučené defaulty“:** Jedním klikem nastaví rozumný výchozí stav (např. OOS validace, Monte Carlo zapnuté, rozumné brány). Hodí se, když nevíš, kde začít.
- **Žlutá pole „Guardrails“:** To nejsou chyby v kódu — jsou to **upozornění**. Např. *sweep bez OOS*, *málo obchodů v gate*, *vypnuté MC*. Mentor ti říká: „Takhle můžeš snadno přehlédnout, že tě oklamala náhoda.“

**Kdy to řešit:** Vždy na začátku; když spěcháš, aspoň přečti guardrails.

---

### 2) Basic settings (základ)

**Instrument Type (Futures / Stocks / Forex)**  
Říká aplikaci, **jaký typ trhu** simuluješ. Podle toho se filtrují dostupná data a chová se broker v engine (např. futures vs akcie).

**Instrument**  
Konkrétní „papír“ a datový soubor (symbol, timeframe, kolik let dat máš k dispozici). Bez toho backtest nemá co žrát.

**Délka (roky)**  
Jak hluboko do historie sahá test. Kratší období = méně dat, ale rychlejší běh; delší = víc režimů trhu, ale strategie musí mít smysl i na dlouhé řadě.

---

### 3) Instrument config (nastavení podle typu nástroje)

Tady doplňuješ **technické jednotky**, aby výpočet PnL dával smysl:

- **Futures:** *Tick size* a *Value per tick* — „o kolik se hýbe cena“ a „kolik USD je jeden tick“.
- **Stocks:** *Position size* — kolik akcií v jednom obchodu (strategie to musí umět použít v `buy`/`sell`).
- **Forex:** *Lot*, *pip size*, *pip value* — aby šlo zhruba spočítat, co znamená pohyb ceny v dolarech.

**Mentorova věta:** Když jsou tady nesmysly, graf může vypadat hezky, ale **peníze v metrikách budou kecy**.

---

### 4) Simulation (simulace účtu)

**Počáteční kapitál** — odkud startuješ na účtu (výchozí velikost pro equity křivku).

**Slippage (%)** — modeluješ, že **nekoupíš přesně uprostřed svíčky**, ale trochu hůř (realita burzy/brokera).

**Komise (%)** — kolik si broker „ukousne“ z obchodu (zjednodušeně procentem).

**Poznámka:** V sekci *Edge finding* můžeš mít ještě **Execution model** (spread, skluz podle volatility, latence) — to je „tvrdší“ vrstva realismu. Základní slippage/komise z *Simulation* a execution model se doplňují podle toho, co máš zapnuté v engine; pro začátek stačí rozumné hodnoty tady.

---

### 5) Indicators & Modules (indikátory a moduly)

**Co to dělá:** Vybereš, které **indikátory** a **moduly** se mají **zkopírovat do běhu** ve Dockeru (složky `indicators/`, `modules/`), aby je strategie mohla importovat.

**Potvrdit → zobrazit v menu:** Až po potvrzení se výběr promítne tam, kde to aplikace očekává pro další kroky.

**Auto-detect:** Aplikace se snaží z `main.py` poznat importy a doplnit zaškrtnutí — pořád je dobré **zkontrolovat ručně**.

**Mentorova věta:** Zapomenout zaškrtnout modul = strategie spadne nebo poběží bez logiky, kterou čekáš.

---

### 6) Edge finding (nejdelší sekce — „jak poctivě testuju strategii?“)

Tady nejde o jedno číslo, ale o **disciplínu**. Představ si to jako laboratoř: nejdřív definuješ pravidla experimentu, pak až čteš výsledek.

#### 6a) Úvodní text a profily Safe / Balanced / Explore

Krátký text v panelu ti připomene souvislosti (validace, brány, sweep, MC, execution). **Profily** jsou zkratky: jedním klikem nastavíš styl testu (opatrný / střední / průzkumný). Pořád můžeš vše ručně přebít.

#### 6b) Validation mode (režim validace)

- **Single run:** Celá historie „najednou“ — **nejrychlejší**, ale **nejvyšší riziko**, že sis jen přizpůsobil minulost (overfitting). Mentor: používej na první nápad, ne na rozhodnutí „jdu do toho s penězi“.
- **OOS split (out-of-sample):** Data se rozdělí: část „pro návrh“ a část **hold-out** „pro zkoušku, kterou jsi neviděl“. Lepší než single.
- **Walk-forward (WF):** Jako opakovaná zkouška: posouváš okna v čase — „naučil jsem se z minulosti — funguje to i na dalším kuse?“ Obvykle **nejpoctivější** z nabídky, zase náročnější na výklad.

**OOS ratio / WF folds / WF test ratio:** Jsou to posuvníky **kolik % dat je test** a **kolik máš oken** ve WF. Nemusíš znát vzorce — princip je: *test musí mít dost obchodů*, jinak je výsledek hlučný.

#### 6c) Quality gates (brány kvality)

Po běhu engine zkontroluje hrubé limity:

- **Min trades:** Příliš málo obchodů = metriky mohou být náhodné jako tři hody kostkou.
- **Max drawdown %:** Jak hluboký propad ještě akceptuješ.
- **Min profit factor:** Hrubý poměr zisků ke ztrátám — pod určitou hranicí strategii nechceš ani jako kandidáta.

**PASS/FAIL** je **filtr**, ne záruka pravdy.

#### 6d) Fixní run seed

**Seed** je „semínko“ náhody. Když je zapnuté, části běhu, které používají náhodu (Monte Carlo, některé sweep režimy, bootstrap), budou při **stejném vstupu** opakovatelné — hodí se na ladění a sdílení výsledků. Když chceš vidět rozptyl náhody, seed nemusíš fixovat.

#### 6e) Experiment (hypotéza, tagy, větev)

- **Hypotéza:** Jedna věta typu *„Když změním X, očekávám Y“* — drží tě při zemi, ať nepřeladíš strategii naslepo.
- **Tagy (CSV):** Štítky pro pozdější filtrování v historii (`NQ`, `trend`, `v2`…).
- **Run branch:** Skupina souvisejících pokusů (jako větev v Gitu v hlavě — nemícháš nesouvisející experimenty).

#### 6f) Promote candidate when gates pass

Když projdou brány, run se může označit jako **kandidát** k dalšímu sledování (workflow / metadata). Není to magie — když jsou brány moc benevolentní, „povýšíš“ i náhodu.

#### 6g) Sweep (průzkum parametrů)

Engine zkouší **víc kombinací čísel** z parametrů strategie. **Random** = rychlý průzkum prostoru, **Grid** = systematičtější mřížka. **Bez validace (OOS/WF)** je sweep nebezpečný — snadno najdeš „šťastné číslo“ jen na jednom kusu dat. **Počet vzorků** = kolik kombinací (víc = pomalejší, ale lepší pokrytí).

#### 6h) Monte Carlo

**Po dokončení backtestu** engine vezme **uzavřené obchody** a mnohokrát je **náhodně přeskupí** (bootstrap), aby ukázal rozptyl drawdownu, konečného účtu a odhad **risk of ruin**. **Neběží paralelně s grafem svíček** — je to druhá fáze stejného Runu. Výsledky uvidíš v **Analytics / metrikách** pod `monteCarlo`.

- **IID trade:** losuje jednotlivé obchody (ignoruje krátkodobé „slepení“ výsledků).
- **Block bootstrap:** bere **bloky** obchodů po sobě — vhodnější, když výsledky v čase souvisí (řada ztrát po sobě).

#### 6i) Regime segmentation

Po běhu engine **štítkuje obchody** podle jednoduchých pravidel z cen (krátká vs dlouhá průměrná cena + vysoká vs nízká volatilita) a podle **hodiny vstupu** (asie / evropa / US). **Nerozpozná slovy „bull/bear“** — jde o hrubé přihrádky „trend vs range“ a „hluk vs klid“, abys viděl, kde strategie vydělává a kde krvácí.

#### 6j) Portfolio backtest

Více instrumentů v jednom nastavení (JSON seznam). **Nelze kombinovat s batch režimem** — aplikace to hlásí. Nejdřív si ověř strategii na jednom trhu, portfolio je složitější krok.

#### 6k) Batch / matrix runs

Jeden request spustí **víc běhů za sebou** se stejnou strategií, ale jinými položkami (např. jiný instrument v JSON poli). Šetří klikání, ale **čím víc pokusů, tím víc rizika náhodného „úspěchu“** — ve výsledku bývá varování na *multiple testing*. Drž počet variant nízko, dokud nemáš jasnou hypotézu pro každou.

#### 6l) Realistic execution model

Zapne **tření reality**: spread, skluz závislý na volatilitě, zpoždění ve **svících** mezi signálem a výstupem. Backtest bez toho často **nafoukne** výkon. Zapínej, když už neřešíš jen „jestli signál vůbec dává smysl“, ale „jestli by to přežilo reálné vstupy/výstupy“.

#### 6m) Forward testing bridge

Most mezi **backtestem** a **sledováním dál** (paper / shadow režim v metadatech execution). **Baseline equity** je kotva pro srovnání „odkud jsme v backtestu vylezli“ — ať forward část nesrovnáváš posunutým měřítkem.

---

### 7) Parameters (parametry strategie a modulů)

Záložky **Strategy** vs jednotlivé **moduly**. Hodnoty odpovídají slovníkům `PARAMS` / `VIEW_PARAMS` v Pythonu. U pole je často **„?“ nápověda** — text může být doplněný z `PARAMS_META` / `VIEW_PARAMS_META` ve strategii nebo modulu.

**Mentorova věta:** Měň parametry **mělce a záměrně** — velký tuning bez validace = náhodný výsledek.

---

### 8) Run

Spustí celý řetězec: příprava souborů → Docker → engine → (validace, sweep, MC, režimy…) → výsledek do **Results**. Logy a progress jsou dole v **LogPanelu**. **Zastavit** přeruší běh (můžeš vidět exit 130 / přerušení — není to chyba pandas).

---

### Shrnutí jednou větou

**Pravý panel = nejdřív *na čem* a *za kolik* testuju (Basic, Instrument, Simulation), pak *co kód dostane k dispozici* (Indicators/Modules, Parameters), pak *jak poctivě hodnotím výsledek* (Edge finding), a nakonec *Run*.**

Detailní texty u jednotlivých polí najdeš v aplikaci u ikony **?** (soubor `backtestFieldMeta.ts`).

---

## Po Runu: časté chyby (Firestore, grafy, čísla)

### „Authentication required“ při ukládání výsledků

Ukládání do **Run history** vyžaduje přihlášeného uživatele Firebase. **Backtest už proběhl** — chybí jen zápis do Firestore.

- **Na `localhost` / `127.0.0.1`** aplikace **automaticky zkouší anonymní přihlášení** při startu (log v LogPanelu: „Firebase: přihlášen anonymně…“ nebo chyba s detailem). V **Firebase Console** musí být zapnuté **Authentication → Sign-in method → Anonymous**.
- **Jiná doména / produkce:** nastav `NEXT_PUBLIC_FIREBASE_ANONYMOUS_SIGNIN=1` ve `frontend/.env.local` a restartuj `npm run dev`.
- **Vypnout auto-anonymous na localhostu:** `NEXT_PUBLIC_FIREBASE_DISABLE_AUTO_ANONYMOUS=1`.
- **Normální cesta:** přihlášení přes UI (Google atd.), pokud ho máš.
- **Firestore rules:** zápis do `strategies/{id}/results` smí jen vlastník strategie (`ownerUid` = `request.auth.uid`). Pokud strategii vytvořil **jiný** účet než aktuální (např. dříve Google, teď anonymní), ukládání **spadne na oprávnění** — otevři strategii pod stejným účtem nebo vytvoř strategii znovu po přihlášení.

### `ChunkLoadError` / nefungují záložky Equity / Highlight

Typicky **rozbitý nebo zastaralý** dev build Next.js (hláška na `lightweight-charts` chunk). Zkus:

1. Zastavit `npm run dev`,
2. smazat složku `frontend/.next`,
3. znovu `npm run dev` a **tvrdý refresh** prohlížeče (Ctrl+F5).

V kódu jsou grafy v Results načítané přes `next/dynamic` + `ssr: false`, aby se chunk choval stabilněji.

### Trade count vs Longs / Shorts

Engine sjednocuje **Trade count** s počtem záznamů v `trades`, které posíláme do UI; směr long/short bere z Backtrader pole **`trade.long`** (ne z prvního „size“ v historii), aby shorty nebyly omylem počítané jako longy. Čistě longová strategie může mít **0 shorts** — to je v pořádku.

---

*Poslední synchronizace: březen 2026 — seed, overfitting heuristiky, guide §8, batch popupy (`batchEnabled` / `batchMaxRuns` / `batchItemsJson`), repro ZIP, dokumentační sada README + SCRIPTS + blok „Vysvětlení konfiguračního menu“ + troubleshooting po Runu.*
