# READMEADAM — tvůj přehled aplikace (Backtesting App)

Tento soubor je **osobní mapa produktu**: co aplikace umí, kde to najdeš v UI a jak z ní vytěžit maximum. Technické detaily deploymentu a API jsou v `README.md` a `READMEAI.md`; tady jde o **používání**.

### Rodina README / dokumentace v repozitáři

| Soubor | Obsah |
|--------|--------|
| **READMEADAM.md** (tento) | Mapa UI, funkcí, workflow, odkazy na nápovědu v aplikaci. |
| **README.md** | Kompletní technická dokumentace platformy, API, struktura, limity, troubleshooting. |
| **READMEAI.md** | Kontrakty a data flow pro AI / vývojáře; tabulka „kde měnit kód“. |
| **SCRIPTS.md** | Jak spustit backend, frontend; časté problémy. |
| **audit/README.md** | Index **uložených auditů** (risk, data science, prop firm, trader, výkon, UX) — review mimo chat. |
| **docs/QUANT_AUDIT.md** | Hlubší technický audit dat, exekuce a metrik engine. |
| **examples/\*/README.md**, **strategies/\*/README.md** | Dokumentace konkrétního modulu/strategie + níže odkaz na platformu. |
| **SD_def.md**, **SD_de.md** | Definice S/D zón (geometrie) vs. obchodní spec strategie `sd_zone_strategy` (MTF, vstupy, filtry). |

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

   **S/D modul (`S_D_Zones` / `SD_identificator`):** Jeden zdroj kódu je [`examples/sd_zones.py`](examples/sd_zones.py) — vlož ho do obou názvů modulu v aplikaci, pokud používáš oba. Modul načítá swingy/BOS z **`HL_identificator` před `Swing_HL`** (`_load_swing_hl_module`). Strategie [`sd_zone_strategy`](strategies/sd_zone_strategy/main.py) používá **stejné pořadí** při importu z `modules/`, aby při dvou kopiích swing modulu View a backtest nečetly rozdílné swingy/BOS.

3. **Pravý panel (`BacktestSettings`)**  
   Veškerá konfigurace backtestu, edge finding, Run.

4. **Spodní panel (`LogPanel`)**  
   Logy ze serveru / engine procesu během běhu, progress.

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

### Kontrola dat (prázdné řádky, NaN, podezřelé mezery)

Z kořene repa: `python scripts/audit_market_data.py` — projde `data/**/*.txt|.csv|.parquet`, nahlásí prázdné řádky v souboru, `NaN` v OHLCV a časové mezery delší než „běžná“ pauza (výchozí až ~28 h nebo 4× medián mezi bary), pokud nejdou vysvětlit víkendem nebo vánočním rozsahem (24.–31. 12. / 1.–2. 1.). Úspěch = exit kód 0.

### Simulation

- Počáteční kapitál, slippage %, komise %.

### Indicators & modules

- Checkboxy + **Potvrdit** — co se zkopíruje do běhu engine (`indicators/`, `modules/`).  
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
| **Rychlé profily** | Safe / Balanced / Explore / **Prop conservative** — přednastavení validace, sweep, MC, execution. Prop conservative: WF 5 folds, min 50 obchodů, max DD 15 %, PF ≥ 1.5, MC 1000 sims (block_bootstrap), execution se spread 1.5 bps, slippage ×vol 2, latence 1 bar, stress multiplier 1.5×, param test train-only. |
| **Validation mode** | `single` (rychlé, nejnižší důvěra) / `oos_split` / `walk_forward` / **`param_test`** (citlivost vybraných číselných parametrů strategie na stejných datech; výstup `paramTest` + grafy v Analytics). |
| **OOS ratio** | Velikost hold-out části (např. 0.25) — u OOS split. |
| **WF folds / test ratio** | Počet oken a podíl testu ve walk-forward. |
| **Param test** | V `validation_config`: rozpočet běhů, zaškrtnuté rozsahy u číselných klíčů z `PARAMS`; není náhrada OOS. Podporuje **train-only** režim (`train_only: true`): OAT sweep jen na trénovací části dat, automatická holdout evaluace nejlepšího parametru. |
| **Quality gates** | Min trades, max DD %, min PF — engine vyhodnotí PASS/FAIL. |
| **Fixní run seed** | Zapneš-li, stejný seed → reprodukovatelné MC, sweep, block bootstrap (`experiment.seed` → `RUN_SEED`). Bez zaškrtnutí náhodný seed každý run. Batch: stejný seed pro všechny dílčí runy z jednoho requestu. |
| **Experiment** | Hypotéza, tagy (CSV), **Run branch** (seskupení runů). |
| **Promote when gates pass** | Logický příznak v experimentu pro workflow (kandidát po splnění gate). |
| **Sweep** | `none` / `random` / `grid` + počet vzorků — citlivost na parametry (s OOS/WF mnohem bezpečnější). |
| **Monte Carlo** | Zap/vyp, počet simulací, **režim**: `iid_trade` vs `block_bootstrap` (serialita PnL). |
| **Regime segmentation** | Zapíná regime analýzu v engine (pokud je v datech/strategii podporováno). |
| **Portfolio backtest** | Více instrumentů v jednom requestu (JSON konfigurace) — **nepoužívat současně s batch** (UI to hlásí). |
| **Batch / matrix** | Pole `items` v JSON — stejná strategie, různé overrides (instrument, data_file, …); sekvenční runy, souhrn v `batchSummary` + varování multiple testing. |
| **Execution model** | Spread (bps), slippage × vola, latence v barech, **stress multiplier** (nové vstupní pole v UI — násobí slippage/spread penaltu; > 1 = horší podmínky plnění, např. 1.5× v Prop conservative presetu). |
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
- **DD Duration** — maximální trvání drawdownu v barech a dnech (jak dlouho trvalo dostat se z vrcholu na dno).
- **Recovery** — čas k zotavení: kolik barů/dnů od dna zpět na nový peak equity (nebo „—" pokud ještě nedošlo k obnově).
- **Top 5 PnL %** — kolik procent celkového zisku pochází z pěti nejlepších obchodů (vysoká koncentrace = strategie závisí na pár outlierech).
- **Payoff Ratio** — poměr průměrného výdělku k průměrné ztrátě (avg win / avg loss). Hodnota > 1 = výhry jsou v průměru větší než prohry.
- **Edge / trade** — edge na obchod = WR × AvgWin − LR × AvgLoss. Kladná hodnota = hra s kladnou střední hodnotou.
- **Kelly %** — Kellyho frakce pro optimální velikost pozice (předpokládá přesné pravděpodobnosti a nezávislé sázky — v praxi se bere half-Kelly nebo méně).

### Trust banner (pod export tlačítky)

- Barevný pruh z `propRedFlags.trustLevel`:
  - 🟢 **acceptable** (zelený) — žádné podezřelé vzory
  - 🟡 **cautious** (žlutý) — několik warningů, ale nic kritického
  - 🟠 **low_trust** (oranžový) — existují critical flagy
  - 🔴 **not_trustworthy** (červený) — vícero critical flagů, výsledek je podezřelý
- Zobrazuje počet **critical** a **warning** flagů + **validační tip** (např. „Zapni walk-forward nebo OOS validaci pro vyšší věrohodnost").
- Zobrazuje se jen pokud engine vrátil `propRedFlags` v odpovědi.

### Záložka Equity

- Křivka equity (a související grafy dle implementace).

### Highlight / Detailed

- **Highlight** — jeden obchod, okno entry–exit.  
- **Detailed** — výřez času (obchody / měsíce), volitelný **TF grafu** (agregace svíček z dat runu), RRR styl, moduly + obchody.

### Tabulka obchodů

- V Highlight / přehledech; u strategií typu S/D může obchod obsahovat **`zoneMeta`** (JSON z engine — zóna, impulse, inducement, …).

### Analytics

- **Konfigurace běhu** — horní strip z `manifest.analysis` (co bylo ve skutečnosti zapnuté v requestu).  
- **S/D zóny** — záložka s `SdZoneAnalytics` (obchody s `zoneMeta`: Demand/Supply, inducement, base, impulse, …); slovník polí u ikony válce.  
- **Param test** — pokud běžel režim `param_test`, grafy/metriky v `ParamTestAnalytics`. Při **train-only** režimu (`train_only: true`) sweep probíhá jen na trénovací části dat a nejlepší parametr se automaticky vyhodnotí na hold-out — v UI je zobrazení holdout výsledků.
- **Bootstrap CI karty** — 95% intervaly spolehlivosti pro mean PnL, total return a trade-level Sharpe (1 000 bootstrap resamplingů uzavřených obchodů). Pokud proběhlo víc pokusů (sweep, batch, folds), zobrazuje **upravenou α** (Bonferroni: 0.05 / K).
- **Edge decomposition** — sekce rozkladu edge: win rate vs payoff ratio, rovnice WR×AvgWin − LR×AvgLoss, Kelly frakce. Vizuální přehled toho, z čeho se skládá ziskovost strategie.
- **Multiple testing awareness strip** — řádek s počtem pokusů K a naivní Bonferroni korigovanou α (0.05 / K). Připomínka, že čím víc kombinací zkoušíš, tím spíš najdeš „šťastný" výsledek.
- **Drawdown analysis** — sekce s podrobnou analýzou drawdownu: maximální a průměrná doba trvání (bary + dny), čas k recovery, procento barů pod equity high (underwater %), počet drawdown epizod.
- **PnL distribution** — histogram uzavřených PnL obchodů, percentily (p5–p95), skewness a kurtosis (tvar distribuce), tail risk CVaR (podmíněná průměrná ztráta v 5. percentilu), koncentrace zisku v top 5 obchodech.
- **Regime tabulka** — tabulka s PnL a profit factorem per regime segment (např. trend/range × nízká/vysoká volatilita a session) — ukazuje, kde strategie vydělává a kde krvácí.
- **Portfolio honest labeling banner** — pokud běžel portfolio backtest, zobrazí se banner s popisem použitého modelu (např. „independent isolated capital per instrument") a disclaimerem, že portfoliové metriky jsou vážené průměry, ne multi-asset equity.
- **Sharpe frequency context strip** — řádek pod Sharpe metrikou vysvětlující frekvenci annualizace (kolik period za rok engine použil pro výpočet).
- **Prop red flags** — barevně kódovaná sekce s výsledky automatické kontroly z `_compute_prop_red_flags` v engine. Každý flag má **severity badge** (critical = červený, warning = žlutý) a vysvětlení. Kontrolované vzory: extrémně vysoký Sharpe s málo obchody, příliš málo obchodů (< 10 critical, < 30 warning), nulové ztráty / win rate > 95 %, nedefinovaný PF, single run bez validace, vypnutý execution model, single + no execution = minimální věrohodnost, podezřele nízký DD, příliš hladká equity (> 92 % barů roste), bootstrap CI protínající nulu, koncentrace PnL (top 5 > 80 %).
- **„Not a broker" disclaimer** — v sekci execution summary: upozornění, že execution model je **zjednodušená aproximace** (lineární slippage, bez market impact, bez modelování kapacity a book depth). Výsledky nelze přímo srovnávat s reálným plněním od brokera.
- **Obecná analytika** — rozbalovací blok: **readiness / overfitting** (severity + varování, `overfittingSignals.ts`), validace, foldy, guardrails, robustnost / heatmapa sweepu, Monte Carlo, režimy, **cost attribution**, forward bridge, batch summary, quality gate, experiment (run diff, promote evidence, …).

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
- **`data_timeframe` ve View** — při zvolené agregaci (např. 1D) frontend posílá do modulu `data_timeframe` odpovídající **tomuto** grafu (ne rozlišení souboru), aby Swing HL nesimuloval 30m data nad denními svíčkami.
- Parametry z `VIEW_PARAMS` + nápověda jako u strategických parametrů (logický TF modulu je nezávislý na agregaci svíček).
- **Který modul co kreslí:** `detect` → markery (swing high/low, internal, major dle modulu). `get_zones` záleží na souboru: **Swing HL** (`swing_hl_detector.py`) vrací jen **BOS** čáry; **S/D Zóny** (`examples/sd_zones.py`) vrací BOS + Demand/Supply + inducementy. Když ve Viditelnosti vidíš BOS ale ne D/S, často je vybraný jen Swing HL — pro D/S zkopíruj modul z `sd_zones.py`.
- **`max_base_length` > 0** v S/D modulu může odfiltrovat všechny Demand/Supply zóny, ale **BOS** záznamy v `zones` zůstanou — panel pak ukáže BOS ano, D/S ne.
- **Base zóny ve View:** `VIEW_PARAMS` v [`examples/sd_zones.py`](examples/sd_zones.py) obsahuje `base_bar_range_in_zone_min` a `base_body_in_zone_min` (AND pro započtení svíčky do base), plus filtry `max_base_length`, `require_inducement`, střih překryvu a max. pivot rozsah — viz `VIEW_PARAMS_META` v souboru.

### Strategie `sd_zone_strategy` — parametry zón a realita exekuce

- **`zone_max_bars` vs. `zone_extend_right_bars`:** při výpočtu zón ve strategii se do modulu vždy posílá `zone_extend_right_bars` **přepsané** z `zone_max_bars` (viz `_sd_module_params_for_tf`). Hodnota `zone_extend_right_bars` z panelu modulu v backtestu tedy pro geometrii/životnost zóny **neplatí** — pro srovnání s View nastav stejnou číslici jako `zone_max_bars` ve strategii, nebo spoléhej na jeden zdroj v `PARAMS`.
- **Limitní vstupy:** strategie sama nemodeluje spread u limitů; obecné náklady řeší globální nastavení simulace (slippage / execution model v UI), ne „limit přesně u bid/ask“.
- **Výstup z pozice:** rozhodnutí target vs. stop jde z **jednoho** OHLC baru; pokud by v reálu v jednom baru prošly obě úrovně, pořadí ticků uvnitř baru simulace nerozliší (viz `_check_exit` ve `strategies/sd_zone_strategy/main.py`).

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
- **Param test** v Edge finding + výstupy v Analytics.  
- **Batch/matrix** běhy s `batchSummary` a varováním na multiple testing.  
- **Fixní seed** v UI a manifestu.  
- **Repro ZIP** z výsledků.  
- **Overfitting / readiness** sdílené mezi Analytics a Run history.  
- **Audit / governance** hooky na backendu (README Phase 6).  
- **StatBlocks** metodické ⓘ a rozšířené metriky (Calmar, ulcer, … dle engine).
- **Drawdown analysis** v engine (`_compute_drawdown_analysis`) + celá sekce v Analytics (trvání, recovery, underwater %).
- **Trade PnL distribution** v engine (`_compute_trade_pnl_distribution`) + histogram a percentily v Analytics.
- **Stress multiplier** v execution modelu (`execution_model.stress_multiplier`) — násobí tření (slippage/spread).
- **Nové metriky v StatBlocks:** DD Duration (bary/dny), Recovery, Top 5 PnL % (koncentrace).
- **Regime tabulka** v Analytics — PnL a profit factor per segment.
- **Portfolio honest labeling** — banner s disclaimerem modelu.
- **Sharpe frequency context strip** — annualizační kontext u Sharpe.

**Data Scientist audit (březen 2026):**
- **Bootstrap CI karty** v Analytics — 95% intervaly spolehlivosti pro mean PnL, total return a trade-level Sharpe (trade-level resampling, 1 000 bootstrapů). Bonferroni korekce α na počet pokusů.
- **Payoff decomposition** v Analytics — rozklad edge: win rate vs payoff ratio, rovnice WR×AvgWin − LR×AvgLoss, Kelly frakce.
- **Payoff Ratio, Edge / trade, Kelly %** v StatBlocks — nové metriky vedle existujících.
- **Multiple testing awareness strip** — řádek v Analytics s počtem pokusů K a korigovanou Bonferroni α.
- **Trial count** v manifestu — počet nezávislých pokusů (sweep × batch × folds) pro korekci multiple testing.
- **Param test train-only** režim — OAT sweep jen na train části, automatická holdout evaluace nejlepšího parametru; zobrazení v ParamTestAnalytics.
- **Nová pole v `BacktestMetrics`:** `payoffRatio`, `edgePerTrade`, `kellyFraction`.
- **Nová pole v `RunResponse`:** `bootstrapCI`, `payoffDecomposition`, `overfittingSignals` (top-level).

**Prop firm reviewer audit (březen 2026):**
- **Prop-level red flags** v engine (`_compute_prop_red_flags`) — automatický sken výsledků na podezřelé vzory: vysoký Sharpe s málo obchody, nulové ztráty, příliš hladká equity, koncentrovaný PnL, single run bez validace, vypnutý execution model aj.
- **Trust banner** v ResultsView — barevný pruh pod exportem zobrazující `trustLevel` (not_trustworthy / low_trust / cautious / acceptable), počet critical/warning flagů a validační tip.
- **Detailní red flags sekce** v AnalyticsView — jednotlivé flagy s severity badge a vysvětlením.
- **Prop conservative preset** v Edge finding — WF 5 folds, min 50 obchodů, max DD 15 %, PF ≥ 1.5, MC 1000 block_bootstrap, execution se spread 1.5 bps, slippage ×vol 2, latence 1 bar, stress multiplier 1.5×, param test train-only.
- **Stress multiplier UI** — nové vstupní pole v sekci Execution Model (Edge finding).
- **„Not a broker" disclaimer** — v execution summary sekci Analytics: vysvětlení zjednodušeného slippage modelu.
- **Nové pole v `RunResponse`:** `propRedFlags` (trustLevel, flags, criticalCount, warningCount, tip).

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

**Co to dělá:** Vybereš, které **indikátory** a **moduly** se mají **zkopírovat do běhu** engine (složky `indicators/`, `modules/`), aby je strategie mohla importovat.

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
- **Min profit factor:** Hrubý poměr zisků ke ztrátám — pod určitou hranicí strategii nechceš ani jako kandidáta. Když v testu **nejsou žádné ztrátové** obchody, `profitFactor` je `null` a quality gate s `min_pf > 0` typicky **FAIL** (viz `qualityGate.checks[].note`).

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

Spustí celý řetězec: příprava souborů → engine subprocess → (validace, sweep, MC, režimy…) → výsledek do **Results**. Logy a progress jsou dole v **LogPanelu**. **Zastavit** přeruší běh (můžeš vidět exit 130 / přerušení — není to chyba pandas).

**Časový limit:** V sekci **Simulation** je **Max. doba běhu (s)** — kolik sekund smí backend čekat na dokončení engine (výchozí 3600). Při pomalém stroji nebo síti zvyš (např. 7200–14400). Na serveru jde globálně nastavit i `RUN_TIMEOUT_SEC` a `RUN_STREAM_IDLE_TIMEOUT_SEC` (viz `backend/app/services/runner.py`).

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

## Výkon engine (performance audit, březen 2026)

| Co se změnilo | Praktický dopad |
|---|---|
| **In-process engine** nyní výchozí | Odpadá startování nového Python procesu na každý run. Param test / sweep s 24 sub-runy ušetří ~2–5 s × 24 = **desítky sekund**. |
| **Lightweight mode** pro sub-runy | Param test, sweep, WF fold a portfolio sub-runy přeskočí bootstrap CI, drawdown analysis, PnL distribution, payoff decomposition a export OHLC/equity dat. **~30–60 % úspora CPU** na každém sub-runu. |
| **Result cache** (256 slotů) | Opakovaný run se stejným kódem + parametry + daty vrátí výsledek okamžitě z paměti. |
| **Fast data fingerprint** | Rutinní `datasetFingerprint` nepoužívá plný SHA-256 celého souboru — místo toho `mtime + size` hash. Eliminuje druhé čtení GB CSV. |
| **Vectorized OHLC/equity export** | Pandas vectorizace místo row-by-row `iloc`. ~10× rychlejší serializace. |
| **Server-side OHLC cap** (8000 barů) | Automaticky downsampleuje OHLC pro frontend (`MAX_OHLC_EXPORT_BARS`). Dramaticky menší JSON payload. |

**Co zůstává pomalé:** Backtrader `next()` smyčka — per-bar dispatch v CPythonu. Pro SD zone strategii existuje základ Numba kernelu (`sd_numba_exec.py`). **Příští krok:** plná vektorizace SD zone execution mimo Backtrader (10–50× potenciál).

## Trader mindset (trader audit, březen 2026)

Cíl: **nutit tě konfrontovat realitu, ne slavit čísla.**

| Co se změnilo | Proč |
|---|---|
| **"Reality check" banner** | Automatické varování při nebezpečné kombinaci: málo obchodů (<30), vypnutý execution, single run bez validace, PnL koncentrace >60 % v top 5. Zobrazeno hned pod trust bannerem. |
| **Underwater equity chart** | SVG drawdown % timeline pod hlavní equity — ukazuje jak hluboké, tak jak **dlouhé** jsou propady. Statistika „% barů pod vodou". |
| **Pessimist preset** | Jedno tlačítko pro agresivní execution (spread 2 bps, slippage 3×vol, latence 2 bary, stress 2×). **Nemění validační nastavení** — čistě jen execution pesimismus. |
| **Run journal note** | Poznámka k runu (proč testuji, co jsem zjistil). Exportuje se do repro bundle. |
| **Color-coded StatBlocks** | Dlaždice DD Duration, Recovery, PnL concentration a Trade count mají barevný rámec (amber/rose) při nebezpečných hodnotách. „Not recovered" má ⚠ prefix. |

## UX optimalizace (power user audit, březen 2026)

Cíl: **rozhodnutí do 30 sekund — důležité nahoře, žádné klikání navíc.**

| Co se změnilo | Proč |
|---|---|
| **Verdict row nad StatBlocks** | Readiness label + severity + top 3 warnings + run kontext (validace/MC/exec/instrument) — okamžitá odpověď „pokračuj / zahoď" bez přepínání na Analytics. |
| **Klávesové zkratky 1–5** | Záložky výsledků přepínatelné klávesou bez myši. Ignorují se v inputech/textareách. |
| **StatBlocks: PnL / Risk / Activity** | Metriky seskupeny do logických skupin. Grid `auto-fill minmax(7rem,1fr)` — žádná fixní šířka, responzivní. |
| **Metodika toggle** | ⓘ tipy defaultně skryté (vizuální šum pro power usera). Odkrytí přes tlačítko „Metodika ⓘ". |
| **Param test zbalen** | `<details>` wrapper — neblokuje obsah pod ním, když param test neřešíš. |
| **Zone slovník: klik** | Hover panel nahrazen klik-to-open s overlay dismiss. Žádné náhodné překrytí UI. |
| **Duplicitní cards odstraněny** | Analytics details: zůstaly jen Avg Win/Loss, Best/Worst, MFE/MAE (to, co StatBlocks nemají). |
| **Manifest strip zkrácen** | Jeden řádek místo odstavce — odkaz na fold sekci. |

---

*Poslední synchronizace: březen 2026 — param_test validace, manifest strip + S/D analytika v Results, uložené audity v `audit/` (viz `audit/README.md`), seed, overfitting heuristiky, guide §8, batch popupy, repro ZIP, README + SCRIPTS + troubleshooting po Runu. Drawdown analysis, PnL distribution, stress multiplier, regime tabulka, portfolio honest labeling, Sharpe freq strip (risk manager audit). Bootstrap CI, payoff decomposition (edge equation, Kelly), multiple testing awareness (trial count, Bonferroni α), param test train-only + holdout, nové metriky payoffRatio/edgePerTrade/kellyFraction (data scientist audit). Prop red flags (trustLevel, flagy, trust banner, detail v Analytics), Prop conservative preset, stress multiplier UI, „Not a broker" disclaimer, propRedFlags v RunResponse (prop firm reviewer audit). **Performance audit:** in-process engine default, lightweight mode, result cache, fast fingerprint, vectorized export, OHLC cap. **Trader audit:** Reality check banner, underwater equity, Pessimist preset, run journal note, color-coded StatBlocks. **UX audit:** verdict row, keyboard shortcuts 1–5, StatBlocks grouped PnL/Risk/Activity, methodology toggle, param test collapsed, zone dict click, dedup cards, shorter manifest strip.*
