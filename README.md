# Backtesting Platform – Kompletní dokumentace

Webová aplikace pro testování obchodních strategií na historických datech. Uživatel píše strategie v Pythonu (Backtrader), spouští backtest přes **hostovský Python subprocess** (stejný engine jako dříve v Dockeru) a vidí výsledky – grafy, statistiky, obchody a historii runů.

**Mapa dokumentace (vše v kořeni repozitáře):**

| Soubor | Účel |
|--------|------|
| **READMEADAM.md** | Osobní přehled UI, všech funkcí a workflow (pro každodenní používání). |
| **README.md** (tento) | Kompletní technická dokumentace platformy, API, struktura projektu, limity. |
| **READMEAI.md** | Reference pro AI / vývojáře: kontrakty, data flow, kde měnit kód. |
| **SCRIPTS.md** | Příkazy: backend, frontend, troubleshooting při spuštění. |
| **audit/** | Uložené audity (risk, quant, UX, výkon, …) — **index:** **audit/README.md**. |
| **docs/QUANT_AUDIT.md** | Hlubší technický audit dat, exekuce a engine (doplňuje README). |
| **docs/BACKTEST_PIPELINE_REFACTOR.md** | Plán a stav pipeline: **`.backtest_artifacts/`**, H/L + S/D precompute, View z cache, `use_sd_artifacts`, rollout (Příloha C = audit fází). |

**Účel tohoto souboru:** technická dokumentace pro hodnocení workflow, deployment a code review. Popisy polí v UI drží **`frontend/components/backtestFieldMeta.ts`** a průvodce **`frontend/data/guideContent.ts`** + **`/guide`** — při změně funkcí je aktualizuj společně s **READMEADAM.md**.

### Pravidlo: složka `audit/` (AI a code review)

Při **jakémkoli auditu nebo systematické kontrole kódu** ukládej výsledné soubory (reporty, poznámky, checklisty) do **`audit/`** v kořeni repozitáře. Nepoužívej tuto složku pro runtime logy — ty patří jinam; **`.audit/`** je vyhrazeno pro append-only strojové události (`events.jsonl`). Detailní popis a konvence pojmenování: **`audit/README.md`**.

> **Důležité (2026-03):** Institution-grade hardening + rozšířený research stack:
> - API auth + rate limiting; `/api/view` v host subprocessu; append-only audit (`.audit/events.jsonl`).
> - Manifest fingerprinting (`runSeed`, `datasetFingerprint`, `codeDigest`, `actorId`).
> - Firestore owner/role + soft-delete; compare workspace + lifecycle v Run history.
> - Edge finding: OOS/WF, **param_test** (citlivost numerických PARAMS na stejných datech), quality gates, sweep, execution model, forward bridge. Jeden Run v UI = **jedna strategie, jeden instrument** (žádné portfolio / matrix / regime z klienta).
> - **Monte Carlo** (shuffle trade sequence, prop-firm simulace v prohlížeči): samostatná **hlavní záložka** po uložení runu — není v menu Edge finding.
> - Volitelný **fixní seed** (`experiment.seed` → `RUN_SEED` v engine).
> - **Cost attribution** v execution summary; **Analytics** s heuristikami readiness/overfitting (`overfittingSignals.ts`).
> - **Bootstrap CI** (95% intervaly pro mean PnL, total return, trade Sharpe; Bonferroni α korekce); **Payoff decomposition** (edge rovnice, Kelly frakce); **Multiple testing awareness** (trial count K, Bonferroni strip).
> - **Param test train-only** režim: OAT sweep na trénovací části, holdout evaluace nejlepšího parametru.
> - **Repro bundle (ZIP)** z výsledků (manifest + summary + snapshot `main.py`).
> - Nápověda u polí: **FieldHelpPopover** + `backtestFieldMeta.ts`; **Guided mode** a **/guide** z `guideContent.ts`.
> - **Prop-level red flags** (`_compute_prop_red_flags`): automatická kontrola výsledků na podezřelé vzory (vysoký Sharpe s málo obchody, nulové ztráty, příliš hladká equity, koncentrace PnL, …); výstup `propRedFlags` v `RunResponse` s `trustLevel` (not_trustworthy / low_trust / cautious / acceptable) + trust banner v ResultsView a barevná sekce v Analytics.
> - **Prop conservative** preset v Edge finding (WF 5 foldů, min 50 obchodů, PF/drawdown brány, execution se stress 1.5×, param test train-only; bez Monte Carla v tomto presetu — MC je v záložce Monte Carlo).
> - **„Not a broker" disclaimer** v execution summary sekci Analytics.
> - **Performance optimalizace:** In-process engine jako výchozí (eliminace subprocess overhead), lightweight mode pro sub-runy (přeskočení bootstrap CI / drawdown / OHLC), in-memory result cache (256 slotů), fast data fingerprint (mtime+size místo SHA-256), vectorized OHLC/equity export, server-side OHLC cap (8000 barů).
> - **Trader audit (2026-03):** "Reality check" varování v ResultsView (málo obchodů, execution off, single run, PnL koncentrace); **Underwater equity chart** (drawdown % timeline + "pod vodou" statistika); **Pessimist preset** (agresivní execution: spread 2 bps, slip 3×vol, latence 2 bary, stress 2×); **Run journal note** (poznámka k runu, export do repro bundle); color-coded StatBlocks (DD duration, recovery, PnL koncentrace, trade count — vizuální alarm při nebezpečných hodnotách).
> - **UX audit (2026-03):** **Verdict row** nad StatBlocks (readiness label + severity + top 3 warnings + run kontext inline — validace / exekuce / instrument); **klávesové zkratky** 1–5 pro záložky výsledků; **StatBlocks seskupeny** do 3 kategorií (PnL / Risk / Activity) s responsive gridem `auto-fill minmax(7rem,1fr)`; **ⓘ metodika toggle** (defaultně skryté, odkrytí přes "Metodika" tlačítko); **param test** zbalen do `<details>` když je přítomen; **zone slovník na klik** místo hover; **odstraněny duplicitní stat cards** z Analytics details (ponecháno jen Avg Win/Loss, Best/Worst, MFE/MAE); zkrácený manifest strip text.

---

## 1. Přehled aplikace

### 1.1 Co aplikace dělá

1. **Strategie** – Python (Backtrader); editor v Monaco.
2. **Indikátory a moduly** – `bt.Indicator` vs utility moduly (`detect` / `get_line` / `get_zones`).
3. **Parameter Panel** – `PARAMS` strategie a `VIEW_PARAMS` modulů; záložky Strategie | Modul1 | …
4. **Auto-detekce importů** – předvýběr indikátorů/modulů podle `from indicators.X` / `from modules.Y`.
5. **Backtest** – host engine subprocess, SSE logy a progress.
6. **Výsledky (ResultsView)** – záložky **Equity** | **Highlight** | **Detailed** | **Analytics** | **Run history**; **StatBlocks** s metodickými ⓘ; **Export JSON** a **Repro bundle (ZIP)**.
7. **Detailed** – svíčky + sloučené výstupy modulů (`ModuleOutputChart`) a obchody; není samostatná záložka „Moduly“.
8. **Trade Highlight** – jeden obchod, okno entry–exit + kontext.
9. **Analytics** – strip **konfigurace běhu** z `manifest.analysis`; záložka **S/D zóny** (`SdZoneAnalytics`, `zoneMeta`); při `param_test` grafy **`ParamTestAnalytics`**; validace, foldy, guardrails, robustnost/sweep heatmapa, volitelně pole `monteCarlo` / `regimeAnalysis` / `portfolio` / `batchSummary` ze **starších nebo API** běhů, execution + **cost attribution**, forward bridge, quality gate, experiment diff; **readiness / overfitting** (heuristiky; část bloků je v rozbalené „Obecná analytika“).
10. **Run history** – Firestore, tabulka, grafy metrik, **N-way compare**, lifecycle/governance, sloupec readiness (stejná logika jako Analytics).
11. **Edge finding** (pravý panel) – validace (`single` / `oos_split` / `walk_forward` / **`param_test`**), gates, sweep, MC režimy, seed, regime, portfolio, batch, execution, forward bridge, experiment (hypotéza, tagy, branch, promote on pass). Presety: **Pessimist** (agresivní execution: spread 2 bps, slip 3×vol, latence 2 bary, stress 2× — nemění validaci) / Safe / Balanced / Explore / **Prop conservative** (WF 5 folds, min 50 obchodů, max DD 15 %, PF ≥ 1.5, MC 1000 block_bootstrap, execution se stress 1.5×, param test train-only).
13. **Guided mode** – checklist + varování před riskantními kombinacemi (např. sweep bez OOS).
14. **View mode** – graf bez backtestu; View params drawer pro `VIEW_PARAMS`.
15. **Uložit / Uloženo** – stav tlačítka podle změn v editoru.
16. **Guide** – plovoucí **?** → `/guide` (obsah `guideContent.ts`); u polí **?** → `backtestFieldMeta.ts`.
17. **Precompute artefaktů (H/L + S/D)** – CLI `python -m app.services.hl_precompute` / `python -m app.services.sd_precompute` ukládá Parquet + manifesty pod **`.backtest_artifacts/{dataset_id}/`**. Složka je v **`.gitignore`**. Stejný `dataset_id` používá View, build v UI a runner při `use_sd_artifacts=1`.
18. **View z cache** – v `StrategyViewChart` lze zapnout **H/L + S/D z cache** (`POST /api/view` s `use_artifacts: true`); bez přepočtu modulů na serveru. Řádek **Cache (dataset)** + **Build features** volá `POST /api/artifacts/build` a `POST /api/artifacts/status`.
19. **Backtest se S/D Parquet** – parametr strategie `use_sd_artifacts`: runner ověří `sd/v1/zones.parquet`, nastaví `USE_SD_ARTIFACTS` + `SD_ARTIFACT_ZONES_PATH`. Při `0` sanitizuje env (legacy větev `get_zones`). Detaily: `docs/BACKTEST_PIPELINE_REFACTOR.md`.

### 1.2 Architektura (vysokoúrovňově)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js, React)                                                   │
│  - page.tsx: hlavní stav, orchestrace, handleRun, saveBacktestResult          │
│  - BacktestSettings: + Edge finding, Guided mode; FieldHelp + backtestFieldMeta│
│  - components/monteCarlo/MonteCarloWorkspace: záložka Monte Carlo (simulace z uložených runů) │
│  - StrategyEditor: Monaco editor (kód)                                       │
│  - ResultsView: Equity | Highlight | Detailed | Analytics | Run history; ZIP   │
│  - StatBlocks, AnalyticsView (readiness/overfitting), TradeHighlight, RunHistory│
│  - lib/overfittingSignals.ts: sdílená heuristika readiness                    │
│  - Firebase Firestore: strategie, indikátory, moduly, results (Run history)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (fetch), SSE (stream=1)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI, Python)                                                   │
│  - GET /api/data: seznam instrumentů (mock/*, futures_30m/*.txt)               │
│  - POST /api/run?stream=1: spuštění backtestu (SSE: log, progress, result)    │
│  - POST /api/view: OHLC + markery/čáry/zóny (live modul nebo use_artifacts z cache) │
│  - POST /api/artifacts/status, POST /api/artifacts/build: stav a synchronní build H/L→S/D │
│  - POST /api/chart: generace PNG grafu (mplfinance)                          │
│  - services/runner.py: subprocess nebo volitelně in-process engine; USE_SD_ARTIFACTS dle PARAMS │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ subprocess (stejný Python / venv)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKTEST ENGINE (backend/docker/engine.py na hostu)                         │
│  - načte strategii, data, spustí Backtrader                                  │
│  - Cesty: STRATEGY_PATH, DATA_PATH, DATA_CACHE_PATH (absolutní na disku)      │
│  - Volitelně: načtení sd/v1/zones.parquet (use_sd_artifacts) — viz env v runneru │
│  - Výstup: JSON na stdout, PROGRESS:X na stderr                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2a Artefakty a dataset_id (shrnutí)

- **Úložiště:** `{repo}/.backtest_artifacts/{dataset_id}/hl/v1/…`, `…/sd/v1/zones.parquet` — výpočet `dataset_id` v [`artifact_store.py`](backend/app/services/artifact_store.py) (stejná logika pro precompute, view a run).
- **Precompute:** [`hl_precompute.py`](backend/app/services/hl_precompute.py), [`sd_precompute.py`](backend/app/services/sd_precompute.py); spec Major TF: [`hl_artifact_spec.py`](backend/app/services/hl_artifact_spec.py).
- **View:** [`view_artifacts.py`](backend/app/services/view_artifacts.py) čte Parquet a skládá odpověď pro graf.
- **Úplný stav vs plán:** Příloha C v `docs/BACKTEST_PIPELINE_REFACTOR.md` (100 % cílového „event engine“ zatím ne).

### 1.3 Provoz na hostu (single-user)

Engine běží jako **dětský proces** stejného Pythonu jako backend. Pro vlastní / důvěřovaný kód je to nejjednodušší; pro veřejný multi-tenant hosting by bylo potřeba znovu zavést silnější izolaci.

- Timeout default 1 hodina (`RUN_TIMEOUT_SEC` / UI **Max. doba běhu** / `run_timeout_sec` v requestu)
- **Batch / matrix:** desktopové UI **neposílá** `batch_config`; hromadné běhy zůstávají jako možnost API/skriptů (`batch_config` + volitelná paralelizace `BATCH_PARALLEL_WORKERS`, 1–8).
- **In-process engine** je nyní **výchozí** (bez druhého interpreteru; eliminuje cold-start overhead). Subprocess se použije jen při explicitním `RUN_INPROCESS_ENGINE=0`. Globální lock zajišťuje konzistenci stavu.
- **Single-user:** strategie běží jako tvůj uživatel na hostu; pro veřejný multi-tenant by bylo potřeba znovu zavést silnější izolaci než čistý subprocess.

### 1.4 Výkonnostní optimalizace (2026-03)

Systém obsahuje několik vrstev optimalizace pro minimalizaci doby backtestů:

| Optimalizace | Popis | Dopad |
|---|---|---|
| **In-process engine (default)** | Eliminuje subprocess fork + Python import overhead na každý run. | ~2–5s úspora na run (kritické pro param test / sweep s desítkami sub-runů). |
| **Lightweight mode** | Param test, sweep a WF fold sub-runy přeskočí těžké analytiky (bootstrap CI, drawdown analysis, PnL distribution, payoff decomposition, OHLC export). | ~30–60 % úspora CPU na sub-run; dramaticky menší JSON payload. |
| **Result cache** | In-memory LRU (256 slotů) klíčovaný (code_digest, params, data_fingerprint, bars, lightweight). Cache hit = nulový CPU. | Okamžitý návrat pro opakované param test / sweep body. |
| **Fast data fingerprint** | Rutinní `datasetFingerprint` používá `mtime_ns + size` hash místo plného SHA-256 celého souboru. | Eliminuje druhé plné čtení disku na GB CSV souborech. |
| **Vectorized OHLC export** | Pandas vectorizace místo row-by-row `iloc` smyčky + server-side cap (default 8000 barů, `MAX_OHLC_EXPORT_BARS`). | ~10× rychlejší export + menší JSON pro frontend. |
| **Vectorized equity curve** | Exportní smyčka equity s daty nahrazena bulk `strftime` + list comprehension. | ~5× rychlejší serializace u velkých datasetů. |

**Architektonické limity (Backtrader):** Hlavní bottleneck zůstává Backtrader `next()` smyčka — per-bar dispatch v CPythonu. Pro SD zone strategii existuje základ v `sd_numba_exec.py` (Numba-akcelerovaný demand limit kernel). **Roadmap:** plná vektorizace SD zone execution do Numba/NumPy (potenciální 10–50× zrychlení oproti Backtrader).

---

## 2. Struktura projektu

```
Backtesting_app/
├── README.md                    # Technická dokumentace (tento soubor)
├── READMEADAM.md                # Uživatelská mapa UI a funkcí
├── READMEAI.md                  # AI/dev reference, API kontrakty
├── SCRIPTS.md                   # Příkazy pro lokální běh
├── frontend/                    # Next.js aplikace
│   ├── app/
│   │   ├── page.tsx             # Hlavní stránka – stav, logika, orchestrace, handleRun, loadRunHistory
│   │   ├── guide/page.tsx       # A-Z průvodce aplikací (stránka /guide)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Sidebar.tsx          # Levý panel – Strategie/Indikátory/Moduly, soubory, Zpět
│   │   ├── MainView.tsx         # Strategie / Indikátory / Moduly – seznam + vytvoření
│   │   ├── BacktestSettings.tsx # Pravý panel + Edge finding + Guided mode
│   │   ├── BacktestResults.tsx  # (legacy) Statistiky
│   │   ├── editor/
│   │   │   └── StrategyEditor.tsx # Monaco editor
│   │   ├── results/
│   │   │   ├── ResultsView.tsx  # Kontejner výsledků – záložky Equity, Highlight, Detailed, Analytics, Run history
│   │   │   ├── StatBlocks.tsx   # Metriky (equity, Sharpe, drawdown, win rate, …)
│   │   │   ├── AnalyticsView.tsx # Manifest strip, S/D + param test, validace, MC, readiness
│   │   │   ├── SdZoneAnalytics.tsx
│   │   │   ├── ParamTestAnalytics.tsx
│   │   │   ├── TradeHighlight.tsx # Graf jednoho obchodu + seznam obchodů (klik pro detail)
│   │   │   └── RunHistory.tsx   # Historie runů – tabulka + grafy metrik
│   │   ├── charts/
│   │   │   ├── ModuleOutputChart.tsx # Detailed + výsledky: OHLC Plotly + zóny/čáry + obchody
│   │   │   ├── DetailedChart.tsx   # (další candlestick / legacy cesty)
│   │   │   ├── EquityChart.tsx     # Plotly equity (+ kumulativní R v ResultsView)
│   │   │   ├── TradesChart.tsx
│   │   │   └── TradeHighlightChart.tsx # Okno entry–exit pro jeden obchod
│   │   ├── StrategyViewChart.tsx # View mode – Plotly candlestick + H/L markery, View params drawer (ikona vedle Obnovit)
│   │   ├── LogPanel.tsx         # Spodní panel – logy z backendu
│   │   ├── LoadingOverlay.tsx   # Progress bar + Zastavit
│   │   ├── CreateModal.tsx     # Modal pro vytvoření strategie/indikátoru/modulu
│   │   ├── AddFileModal.tsx    # Modal pro přidání souboru
│   │   ├── FieldHelpPopover.tsx # Detailní wiki pop-upy pro konfigurace
│   │   └── backtestFieldMeta.ts # Metadata a texty nápověd konfigurací
│   ├── data/
│   │   └── guideContent.ts      # Strukturovaný obsah A-Z guide stránky
│   └── lib/
│       ├── api.ts               # runBacktestStreaming, getAvailableData, getChartImage
│       ├── chartOhlcResample.ts # Agregace TF pro Detailed graf
│       ├── overfittingSignals.ts # Heuristiky readiness (Analytics + Run history)
│       ├── firestore.ts         # CRUD + owner metadata, soft-delete run history, governance update
│       ├── firebase.ts          # Firebase konfigurace
│       └── strategyParams.ts    # parseStrategyParams, parseViewParams – parsování PARAMS/VIEW_PARAMS (strip Python # komentářů)
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, routy
│   │   ├── security.py          # Auth + rate limiting dependency
│   │   ├── api/
│   │   │   ├── run.py           # POST /api/run (streaming / non-streaming)
│   │   │   ├── data.py          # GET /api/data, GET /api/data/debug
│   │   │   ├── view.py          # POST /api/view (modul nebo use_artifacts)
│   │   │   ├── artifacts.py     # POST /api/artifacts/status, /api/artifacts/build
│   │   │   └── chart.py         # POST /api/chart (PNG)
│   │   ├── services/
│   │   │   ├── runner.py        # Engine + manifest; env artefaktů vs legacy (viz PARAMS use_sd_artifacts)
│   │   │   ├── artifact_store.py, hl_precompute.py, sd_precompute.py, view_artifacts.py, artifact_api_service.py
│   │   │   ├── audit.py         # Append-only audit logger
│   │   │   └── chart.py         # mplfinance generace grafu
│   │   └── models/
│   │       └── run.py           # RunRequest, RunResponse, Trade, BacktestMetrics
│   └── docker/
│       ├── Dockerfile           # python:3.11-slim + backtrader
│       ├── engine.py            # Backtest engine (spouští se na hostu jako subprocess)
│       ├── view_engine.py       # Sandbox engine pro /api/view
│       └── requirements.txt
│
├── shared/
│   └── types/
│       └── index.ts             # RunRequest, RunResponse, DataInstrument, InstrumentType, filterInstrumentsByType
│
├── data/
│   ├── broker_config.json       # tick_size, tick_value, mult, margin pro futures
│   ├── futures_30m/             # Intraday futures: SYMBOL.txt (MM/DD/YYYY,HH:MM,O,H,L,C,V)
│   └── mock/
│       ├── NQ_5Y.csv            # Futures (root = backward compat)
│       ├── futures/             # (volitelné) další futures
│       ├── stocks/              # Akcie (AAPL_5Y.csv, …)
│       └── forex/               # Forex páry (EURUSD_5Y.csv, …)
│
├── firestore.rules              # Firestore security rules
├── firebase.json                # Konfigurace pro firebase deploy
├── strategies/                  # Lokální příklady (ne v produkci)
├── examples/                    # Příklady modulů/indikátorů ke kopírování
├── audit/                       # Auditní reporty (lidské) — seznam v audit/README.md
├── docs/
│   ├── QUANT_AUDIT.md           # Technický quant audit (data, exekuce, metriky)
│   └── BACKTEST_PIPELINE_REFACTOR.md  # Artefakty, precompute, View cache, rollout
├── .backtest_artifacts/         # Runtime cache (gitignored) — H/L + S/D Parquet
└── SCRIPTS.md                   # Příkazy, skripty, troubleshooting
```

---

## 3. Kompletní workflow – krok za krokem

### 3.1 Spuštění aplikace

1. **Backend:** `cd backend && uvicorn app.main:app --reload` → http://localhost:8000
2. **Frontend:** `cd frontend && npm run dev` → http://localhost:3000
3. **Závislosti:** `pip install -r backend/requirements.txt` (Backtrader, pyarrow, …).

### 3.2 Uživatelský flow

| Krok | Akce | Technická implementace |
|------|------|------------------------|
| 1 | Uživatel otevře http://localhost:3000 | Next.js načte `page.tsx` |
| 2 | Klikne na **Strategie** | `listItems("strategies")` → Firestore |
| 3 | Klikne **Vytvořit strategii** | `createItem("strategies", name, tag)` → Firestore + výchozí `main.py` |
| 4 | Otevře strategii | `loadFiles("strategies", id)` → seznam souborů v Sidebaru |
| 5 | Klikne na `main.py` | `getFileContent("strategies", id, "main.py")` → obsah do editoru |
| 6 | Upraví kód | Monaco editor (lokální stav) |
| 7 | Klikne **Uložit** | `saveFile("strategies", id, "main.py", content)` → Firestore |
| 8 | (Volitelně) Auto-detekce + ruční výběr indikátorů/modulů | Import parser (`from indicators...`, `from modules...`) předvybere checkboxy; `onConfirmSelection` pro potvrzení |
| 9 | Vybere **Instrument Type** (Futures/Stocks/Forex) | `backtestParams.instrumentType` |
| 10 | Vybere **Instrument** | Filtrováno podle `instrumentType` – pouze relevantní instrumenty |
| 11 | (Volitelně) Upraví **Strategy Parameters** | `parseStrategyParams(main.py)` → dynamické inputy v Parameter Panel |
| 12 | Nastaví **Délku** (roky) | `years` state |
| 13 | Klikne **Run** | `handleRun()` – viz níže |
| 14 | (Volitelně) Klikne **View** | OHLC graf; live modul nebo **H/L + S/D z cache**; Build features + stav cache; drawer `VIEW_PARAMS` u Obnovit |
| 15 | (Volitelně) Uloží soubor | Tlačítko „Uložit“ se změní na „Uloženo“ (disabled); po změně kódu zpět na „Uložit“ |

### 3.3 Run backtest – detailní tok

**Frontend (`handleRun` v `page.tsx`):**

1. Ověří: otevřená strategie, `main.py` existuje, vybraný instrument
2. Auto-detekuje importy z `main.py` a předvybere odpovídající indikátory/moduly
3. Sestaví `allFiles`:
   - Všechny soubory strategie (main.py, utils.py, …)
   - Vybrané indikátory → `indicators/{Název}.py`
   - Vybrané moduly → `modules/{Název}.py`
4. Vytvoří `AbortController` pro možnost zastavení
5. Zavolá `runBacktestStreaming(request, signal, onEvent)`
6. `onEvent`: `log` → přidá do LogPanelu, `progress` → aktualizuje progress bar
7. Po `result` → `setResults(data)`, `setShowResults(true)`
8. **Automatické uložení:** `saveBacktestResult(strategyId, strategyName, payload)` → Firestore `/strategies/{id}/results/{backtestId}`
9. `listBacktestResults(strategyId)` → aktualizace `runHistory` pro záložku Run history

**Request payload (`RunRequest`):**

```json
{
  "files": { "main.py": "...", "indicators/EMA.py": "...", "modules/utils.py": "..." },
  "instrument": "NQ",
  "timeframe": "1d",
  "years": 1,
  "data_file": "mock/NQ_5Y.csv",
  "initial_capital": 100000,
  "slippage_perc": 0.001,
  "commission_perc": 0.0002,
  "instrument_type": "futures",
  "tick_size": 0.25,
  "value_per_tick": 5,
  "share_size": null,
  "lot_size": null,
  "pip_size": null,
  "pip_value": null,
  "params": { "sma_fast": 20, "sma_slow": 50, "module_params": { "Swing HL": { "timeframe": "1d", "atr_period": 10 } } },
  "applied_modules": [{ "id": "abc123", "name": "Swing HL", "params": { "timeframe": "1d", "atr_period": 10 } }],
  "run_id": "run_20260318_abc123",
  "validation_mode": "oos_split",
  "validation_config": { "oos_ratio": 0.25 },
  "quality_gates": { "min_trades": 30, "max_dd": 25, "min_pf": 1.2 },
  "sweep_mode": "random",
  "sweep_config": { "max_samples": 24 },
  "execution_model": { "enabled": true, "spread_bps": 0.5, "slippage_vol_mult": 1.0, "latency_bars": 0, "stress_multiplier": 1.0 },
  "experiment": { "hypothesis": "sd-trend-breakout", "tags": ["manual-run"], "seed": 42 }
}
```

*Desktopové UI (`page.tsx`)* typicky **neposílá** `monte_carlo`, `regime_config`, `portfolio_config` ani `batch_config` — Monte Carlo běží v samostatné záložce nad uloženými výsledky. **API** ale dál umí volitelně `monte_carlo`, `regime_config`, `portfolio_config`, `batch_config` (skripty, integrace, starší klienti).

*Poznámka:* `experiment.seed` je volitelné; v UI lze zapnout fixní seed → hodnota se předá do env `RUN_SEED` subprocessu (reprodukovatelnost náhodného výběru ve sweepu / block-bootstrapu v engine, pokud je v requestu zapnuto). Když seed v requestu chybí, backend doplní náhodný.

*`validation_mode`:* kromě příkladu výše je podporováno `single`, `walk_forward` a **`param_test`** (OAT citlivost vybraných číselných `PARAMS` na stejných datech; konfigurace v `validation_config.param_test`, engine vrací `validation.paramTest` a UI `ParamTestAnalytics`). Param test podporuje **train-only režim** (`train_only: true`): OAT sweep probíhá jen na trénovací části dat a nejlepší nalezený parametr se automaticky vyhodnotí na hold-out (out-of-sample) části — výsledek holdout evaluace je v `validation.paramTest.holdout`.

**Backend (`api/run.py`):**

1. Přijme `RunRequest`
2. Pokud `?stream=1`: vrací `StreamingResponse` s `text/event-stream`
3. Volá `run_strategy_streaming(...)` z `runner.py`

**Runner (`services/runner.py`):**

1. Vytvoří `.backtest_run/` v project root
2. `_prepare_strategy_files()`: zapíše soubory do `.backtest_run/`, vytvoří `indicators/__init__.py`, `modules/__init__.py` pokud potřeba
3. Spustí **subprocess** `python backend/docker/engine.py` *nebo* při `RUN_INPROCESS_ENGINE=1` zavolá `execute_backtest_from_environ()` v tom samém procesu (`engine_inprocess.py`). Env obsahuje mimo jiné `STRATEGY_PATH`, `DATA_PATH`, `DATA_CACHE_PATH`, `HOST_DATASET_FINGERPRINT`, `INSTRUMENT`, `TIMEFRAME`, `YEARS`, `DATA_FILE`, `INITIAL_CAPITAL`, `STRATEGY_PARAMS`, `RUN_SEED`, `CODE_DIGEST`, `ACTOR_ID`, `PYTHONPATH` = kořen repa **+** `backend` (import `app.services.*`, `examples.*`, …).  
   Pokud `use_sd_artifacts=1` ve `STRATEGY_PARAMS`: ověří se existence `zones.parquet` pro vypočtené `dataset_id`; nastaví se `USE_SD_ARTIFACTS=1` a `SD_ARTIFACT_ZONES_PATH`. Jinak `USE_SD_ARTIFACTS=0` a `SD_ARTIFACT_ZONES_PATH` se z env **odebere** (aby host `.env` nekřížil legacy run).
4. Čte stdout/stderr v odděleném vlákně
5. Parsuje JSON z stdout → `{"equity": [...], "metrics": {...}, "trades": [...], "ohlc": [...]}` → event `result`
6. Pokud `applied_modules` v requestu: `engine.py` dopočítá `moduleOutputs` (detect/get_line/get_zones) a vrátí je v JSON výsledku
7. Parsuje `PROGRESS:10` z stderr → event `progress`
8. Při chybě: JSON `{"error": "..."}` → event `error`
9. Streamuje události klientovi přes SSE
10. Po dokončení smaže `.backtest_run/{run_id}/`
11. Do engine env posílá governance metadata: `RUN_SEED`, `CODE_DIGEST`, `ACTOR_ID`

**Engine (`docker/engine.py` — subprocess nebo in-process na hostu):**

1. Načte env: `STRATEGY_PATH`, `DATA_PATH`, `DATA_CACHE_PATH`, `INSTRUMENT`, `TIMEFRAME`, `YEARS`, `DATA_FILE`, `STRATEGY_PARAMS` (JSON), `RUN_SEED`, `CODE_DIGEST`, `ACTOR_ID`
2. `load_strategy(path)`: dynamický import, najde první třídu dědící z `bt.Strategy`
3. `strategy_params = json.loads(STRATEGY_PARAMS)` → předá do `cerebro.addstrategy(TradeRecordingStrategy, **params)`
4. `load_data(data_path, instrument, timeframe, years, data_file)`:
   - Pokud `data_file`: načte přímo `data_path/data_file` (např. `mock/NQ_5Y.csv`)
   - Jinak hledá `mock/{instrument}_5Y.csv`, `mock/{instrument}.csv`, parquet
5. Normalizuje CSV sloupce (Date/date, Close/Last→close, Open, High, Low, Volume)
6. Filtruje data podle `years` (posledních N let)
7. `run_backtest()`:
   - Vytvoří Cerebro, přidá data, strategii, analyzéry (Sharpe, DrawDown, TradeAnalyzer)
   - Nastaví broker: cash, commission=0, slippage
   - Spustí `cerebro.run()`
   - Zaznamenává equity na každý bar, obchody přes `notify_trade`/`notify_order`
   - Vypočítá metriky (Sharpe, max drawdown, win rate, profit factor, expectancy, …)
   - `_compute_drawdown_analysis()`: detailní analýza drawdownu — max/avg trvání (bary + dny), recovery, underwater %, počet period
   - `_compute_trade_pnl_distribution()`: histogram PnL, percentily, skewness, kurtosis, tail risk (CVaR), koncentrace (top 5 %)
   - `_compute_bootstrap_ci(trades)`: bootstrap 95% CI pro mean PnL, total return a trade-level Sharpe (1 000 resamplingů uzavřených obchodů); vrací `bootstrapCI` s `lo`/`hi`/`alpha`/`adjustedAlpha`/`trialCount`
   - `_compute_payoff_decomposition(trades, metrics)`: rozklad edge — win rate, loss rate, avg win, avg loss, payoff ratio (avg win / avg loss), edge per trade (WR×AvgWin − LR×AvgLoss), Kelly fraction; vrací `payoffDecomposition`
   - `_compute_prop_red_flags(metrics, trades, equity, manifest, bootstrapCI, tradePnlDistribution)`: automatická kontrola výsledků z pohledu prop-firm reviewer — vrací `propRedFlags` s `trustLevel` a seznamem `flags`. Kontrolované vzory: extrémně vysoký Sharpe s málo obchody, příliš málo obchodů (< 10 critical, < 30 warning), nulové ztráty / win rate > 95 %, nedefinovaný PF (sentinel), single run bez validace, vypnutý execution model, kombinace single + no execution = minimální věrohodnost, podezřele nízký DD, příliš hladká equity (> 92 % barů rostoucích), bootstrap CI protínající nulu, koncentrace PnL (top 5 > 80 %)
   - `trialCount` v manifestu: počet nezávislých pokusů (sweep vzorky × dílčí běhy batch × foldy; u běžného UI bez batch často sweep × foldy); `overfittingSignals.bonferroniAlpha` = 0.05 / K
8. Vypíše JSON na stdout, `PROGRESS:100` na stderr

**Response (`RunResponse`):**

```json
{
  "equity": [100000, 100500, ...],
  "equityCurve": [{"date": "2024-01-01", "value": 100000}, ...],
  "metrics": {
    "finalEquity": 105000,
    "maxEquity": 108200,
    "sharpeRatio": 1.2,
    "maxDrawdown": 5.5,
    "maxDrawdownPct": 5.5,
    "maxDrawdownUsd": 6200,
    "commissionPerc": 0.0002,
    "tradeCount": 42,
    "longCount": 25,
    "shortCount": 17,
    "winRate": 60,
    "totalReturn": 5.0,
    "totalReturnUsd": 5000,
    "profitFactor": 1.8,
    "profitFactorStatus": "defined",
    "sharpeRatioLegacyAnalyzer": 0.95,
    "grossProfitClosedTrades": 12000,
    "grossLossAbsClosedTrades": 6666,
    "riskAnnualizationPeriodsPerYear": 252,
    "expectancyUsd": 119,
    "expectancyR": 0.5,
    "rMultiple": 0.5,
    "maxDrawdownDurationBars": 47,
    "maxDrawdownDurationDays": 65,
    "timeToRecoveryBars": 32,
    "timeToRecoveryDays": 44,
    "currentDrawdownPct": 1.8,
    "payoffRatio": 1.85,
    "edgePerTrade": 28.5,
    "kellyFraction": 0.18
  },
  "trades": [
    {"date": "...", "entryDate": "...", "exitDate": "...", "type": "buy", "size": 1, "pnl": 150, "entryPrice": 20000, "exitPrice": 20150, "mfe": 220, "mae": 80, "mfePct": 1.1, "maePct": 0.4}
  ],
  "ohlc": [{"date": "...", "open": 20000, "high": 20100, "low": 19950, "close": 20050}],
  "moduleOutputs": {
    "Swing HL": {
      "markers": [{"date": "2024-03-12", "type": "high", "value": 20100}, {"date": "2024-03-15", "type": "low", "value": 19950}],
      "lines": []
    }
  },
  "drawdownAnalysis": {
    "maxDurationBars": 47,
    "maxDurationDays": 65,
    "timeToRecoveryBars": 32,
    "timeToRecoveryDays": 44,
    "currentDrawdownPct": 1.8,
    "underwaterPct": 38.2,
    "avgDurationBars": 12,
    "periodsCount": 8
  },
  "tradePnlDistribution": {
    "histogram": [{"binEdge": -500, "count": 3}, {"binEdge": 0, "count": 12}, {"binEdge": 500, "count": 18}],
    "percentiles": {"p5": -420, "p25": -80, "p50": 60, "p75": 310, "p95": 820},
    "skewness": 0.42,
    "kurtosis": 3.1,
    "tailRiskCVaR": -380,
    "concentration": {"top5PnlPct": 42.5}
  },
  "bootstrapCI": {
    "meanPnl": {"lo": 45.2, "hi": 210.8, "alpha": 0.05},
    "totalReturn": {"lo": 3.1, "hi": 7.8, "alpha": 0.05},
    "tradeSharpe": {"lo": 0.08, "hi": 0.42, "alpha": 0.05},
    "nBootstrap": 1000,
    "adjustedAlpha": 0.025,
    "trialCount": 2,
    "note": "Trade-level resampling; adjustedAlpha = 0.05 / trialCount (Bonferroni)"
  },
  "payoffDecomposition": {
    "winRate": 0.60,
    "lossRate": 0.40,
    "avgWin": 310.5,
    "avgLoss": 180.2,
    "payoffRatio": 1.72,
    "edgePerTrade": 114.2,
    "kellyFraction": 0.18,
    "edgeEquation": "WR×AvgWin − LR×AvgLoss"
  },
  "overfittingSignals": {
    "trialCount": 2,
    "bonferroniAlpha": 0.025,
    "multipleTestingNote": "K=2 trials detected; naive Bonferroni α = 0.05/2 = 0.025"
  },
  "propRedFlags": {
    "trustLevel": "cautious",
    "flags": [
      { "key": "too_few_trades", "severity": "warning", "label": "Low trade count", "detail": "30 trades — below 30 is a warning for prop evaluation" },
      { "key": "no_execution_model", "severity": "warning", "label": "Execution model disabled", "detail": "Results do not account for spread, slippage or latency" }
    ],
    "criticalCount": 0,
    "warningCount": 2,
    "tip": "Enable walk-forward or OOS validation to increase credibility"
  }
}
```

### 3.4 Zobrazení výsledků (ResultsView)

**Záložky** (klávesové zkratky `1`–`5`):

| Záložka | Klávesa | Obsah |
|---------|---------|-------|
| **Equity** | `1` | `EquityChart` – křivka equity v čase + underwater chart |
| **Highlight** | `2` | `TradeHighlight` – jeden obchod (entry–exit) + seznam obchodů |
| **Detailed** | `3` | OHLC + markery/zóny + obchody; volitelně **vrstvy z `.backtest_artifacts`** (stejný `/api/view` jako Strategy View) |
| **Analytics** | `4` | Manifest strip (zkrácený); S/D analytika; param test v `<details>`; validace, MC, DD, PnL dist, Bootstrap CI, Edge decomposition, Prop red flags, readiness/overfitting v „Obecná analytika" |
| **Run history** | `5` | `RunHistory` – uložené runy, compare, lifecycle, grafy metrik, sloupec readiness |

**Trust banner (pod export tlačítky v ResultsView):**

- Barevný pruh z `propRedFlags.trustLevel`: zelený = `acceptable`, žlutý = `cautious`, oranžový = `low_trust`, červený = `not_trustworthy`
- Zobrazuje počet critical a warning flagů + validační tip (např. „Enable walk-forward or OOS validation to increase credibility")
- Přítomen pouze pokud `propRedFlags` existuje v `RunResponse`

**"Reality check" banner (trader audit):**

- Automaticky se zobrazí při nebezpečné kombinaci: málo obchodů (<30), vypnutý execution model, single run bez validace, nebo PnL koncentrace >60% v top 5 obchodech
- Žlutý varovný banner s konkrétními zprávami (nezávislý na prop red flags — doplňují se)

**Underwater chart (záložka Equity):**

- SVG drawdown % timeline pod hlavní equity křivkou
- Zobrazuje: max DD %, % barů strávených „pod vodou" (equity pod předchozím peakem)
- Vizualizuje jak hluboké, tak jak dlouhé jsou drawdowny — „jak dlouho jsi v pekle"

**Run journal note:**

- Tlačítko „Poznámka" vedle export tlačítek otevírá textarea pro volný text k runu
- Poznámka se exportuje do repro bundle (soubor `run_note.txt` + pole `runNote` v `results_summary.json`)

**Trade Highlight (detail):**

- `TradeHighlightChart`: zobrazí OHLC okno od entry do exit + 5 barů kontextu před/za
- Seznam obchodů pod grafem – kliknutí na řádek změní zobrazený obchod
- Při změně obchodu se starý graf odstraní (`chartInstanceRef` + cleanup v `useEffect`)

**Run history:**

- Tabulka: Run ID, Datum, Total P/L, Sharpe, R-multiple, WR %, Promote status, ikona smazání
- Tlačítko „Smazat vše“ s potvrzením
- Grafy metrik: Sharpe ratio, R-multiple, Total P/L ($), Win %, Profit factor, Expectancy ($)
- Osa X: čísla runů (1, 2, 3…), osa Y: hodnoty
- Layout: 2 grafy na řádek (`grid-cols-2`)

**Verdict row (UX audit):** Kompaktní řádek nad StatBlocks zobrazující readiness label (ready / caution / not_ready), severity score, top 3 overfitting warnings, validační mode, MC status, execution status, instrument a datový soubor. Zdroj dat: `assessOverfitting()` z `overfittingSignals.ts`. Přechod od „klikej na Analytics → rozklikni details" k „okamžitá odpověď na jednom místě".

**StatBlocks:** Metriky seskupeny do tří kategorií: **PnL** (return, equity, PF, expectancy, payoff, Kelly), **Risk** (Sharpe, Sortino, DD, recovery, koncentrace) a **Activity** (trades, L/S, win rate). Grid: `auto-fill minmax(7rem,1fr)` — responzivní bez fixní šířky. **ⓘ metodika** schovaná za toggle "Metodika ⓘ" (defaultně off). Color-coded alerts: DD duration, recovery, PnL koncentrace a trade count s barevným rámcem (amber/rose) při nebezpečných hodnotách. Monte Carlo řádek zobrazuje risk of ruin + mode/method.

**Klávesové zkratky:** `1`–`5` přepínají záložky Equity / Highlight / Detailed / Analytics / Run history. Nefungují v inputech/textareách.

**Export JSON:** celý RunResponse ke stažení.

**Repro bundle (ZIP):** `manifest.json`, zkrácený `results_summary.json`, `strategy_main.py` (snapshot z editoru v okamžiku exportu), `README_bundle.txt` — viz `ResultsView.tsx` (fflate).

---

## 4. Parameter Panel (Parameters)

### 4.1 Parsování PARAMS a VIEW_PARAMS

- `parseStrategyParams(code)` v `frontend/lib/strategyParams.ts` hledá v kódu strategie `PARAMS = {...}`
- `parseViewParams(code)` hledá v kódu modulu/indikátoru `VIEW_PARAMS = {...}`
- Podporované typy: `number`, `boolean`, `string`
- Python dict se převádí na JSON (True→true, 'key'→"key", …)
- Před parsováním se odstraní Python komentáře (`# ...`) – zachová se `#` uvnitř řetězců

### 4.2 Zobrazení v UI – záložky

- Collapsible sekce **Parameters** v BacktestSettings
- **Záložky:** Strategie | [Název modulu 1] | [Název modulu 2] | …
- **Strategie:** parametry z `PARAMS` strategie
- **Moduly:** parametry z `VIEW_PARAMS` každého vybraného modulu (vybrané v sekci Moduly)
- Při backtestu lze upravit VIEW_PARAMS každého modulu v záložce daného modulu – hodnoty se předávají do `module_params` a strategie je předává modulům
- Dynamické inputy podle typu: number → `<input type="number">`, boolean → checkbox, string → text input
- Při změně strategie se parametry znovu naparsují; při změně výběru modulů se načtou jejich `VIEW_PARAMS`

### 4.3 Předání do engine

- `params` v `RunRequest` obsahuje:
  - ploché parametry strategie (`swing_tf`, `hh_count`, …)
  - vnořený objekt `module_params`: `{"Swing HL": {"timeframe": "1d", "atr_period": 10, …}}`
- Strategie přijímá `params` včetně `module_params` a předává je modulům (např. `get_swings(ohlc, params)`)

---

## 5. View mode a View params panel

### 5.1 Co je View mode

**View** je záložka vedle Results, kde vidíš svíčkový graf s OHLC daty a vrstvy struktury (swingy, zóny, trend) — **bez plného backtestu**.

**Dva režimy vrstev (H/L + S/D):**

1. **Live modul** — `POST /api/view` spustí `view_engine.py`, zavolá `detect` / `get_line` / `get_zones` nad (případně resamplovaným) DataFrame.
2. **Z cache (`use_artifacts`)** — server přečte Parquet z **`.backtest_artifacts/`** (`view_artifacts.py`); žádný přepočet Python modulu na serveru. Vyžaduje předchozí **Build features** (H/L → S/D) nebo CLI precompute.

**Typický workflow:**
1. Vytvoříš indikátor nebo modul (případně strategii s `detect`)
2. Přepneš na záložku **View**, vybereš instrument a roky
3. Buď zapneš **H/L + S/D z cache** + případně **Build features**, nebo necháš live modul a upravíš `VIEW_PARAMS` (drawer u Obnovit)
4. Graf zobrazí OHLC + markery/čáry/zóny dle režimu

### 5.2 Rozhraní pro View (detect, get_line, get_zones)

Modul, indikátor i strategie používají stejné rozhraní:

| Funkce | Účel | Vrací |
|--------|------|-------|
| `detect(ohlc, params=None)` | Bodové značky (H/L, signály) | `[{"date": "YYYY-MM-DD", "type": "high"\|"low"\|"signal", "value": float}, ...]` |
| `get_line(ohlc, params=None)` | Čáry (indikátory) | `[{"date", "value"}, ...]` nebo `{"EMA20": [...], "EMA50": [...]}` |
| `get_zones(ohlc, params=None)` | Zóny/boxy (support, resistance) | `[{"date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"?}, ...]` |

- **type** u markerů: `"high"` = zelené, `"low"` = červené, `"signal"` = modré
- **value**: cena (y-ová souřadnice)
- **zóny**: obdélníky na grafu – `date_start`/`date_end` = časový rozsah, `value_low`/`value_high` = cenový rozsah, `fillcolor` = barva výplně (např. `"rgba(59, 130, 246, 0.2)"`)

### 5.3 View params panel – dynamické parametry ve View módu

Při vývoji indikátoru/modulu můžeš v View módu **měnit parametry bez úpravy kódu** – podobně jako Parameter Panel u backtestu, ale přímo u grafu.

**Jak to funguje:**

1. V kódu modulu/indikátoru/strategie deklaruješ `VIEW_PARAMS`:
   ```python
   VIEW_PARAMS = {"period": 20}
   ```

2. Funkce `detect` a/nebo `get_line` přijímají druhý argument `params`:
   ```python
   def get_line(ohlc, params=None):
       params = params or {}
       period = int(params.get("period", 20))
       ema = ohlc["close"].ewm(span=period, adjust=False).mean()
       # ...
   ```

3. Ve View záložce se zobrazí **ikona params** (tři čáry s tečkami) vedle tlačítka Obnovit – kliknutím otevře **drawer** z pravé strany s inputy pro každý parametr.

4. Změníš hodnotu (např. period 20 → 50, barva `#ff0000`) a klikneš **Použít** → graf se znovu načte s novými parametry.

### 5.3a View params drawer – přístup k parametrům

- **Ikona** – zobrazí se vedle tlačítka „Obnovit“, když je vybraný modul/indikátor/strategie
- **Drawer** – kliknutím na ikonu se z pravé strany vysune panel (šířka 320px) s parametry
- **VIEW_PARAMS_META** – volitelný dict ve stejném stylu jako `PARAMS_META` (`title`, `whatItMeans`, `howToUse`); u každého pole se v draweru zobrazí lidský název a text nápovědy (`parseViewParamMeta` v `strategyParams.ts`)
- **Žádné VIEW_PARAMS** – pokud modul nemá `VIEW_PARAMS`, drawer zobrazí návod, co přidat do kódu
- **Barva čar** – `get_line` může vracet `{"EMA20": {"data": [...], "color": "#ff0000"}}` pro vlastní barvu čáry

### 5.4 Pravidla pro View params panel

| Pravidlo | Popis |
|----------|-------|
| **VIEW_PARAMS** | Musí být platný Python dict s klíči a výchozími hodnotami. Podporované typy: `number`, `boolean`, `string`. |
| **params v signatuře** | `detect(ohlc, params=None)` a `get_line(ohlc, params=None)` – druhý argument je volitelný. Pokud ho funkce nemá, params se nepředávají (zpětná kompatibilita). |
| **Parsování** | Frontend hledá v kódu `VIEW_PARAMS = {...}` (stejný formát jako `PARAMS`). Funkce `parseViewParams(code)` v `strategyParams.ts`. Před parsováním se odstraní Python komentáře (`# ...`) – zachová se `#` uvnitř řetězců (např. `"#3b82f6"`). |
| **Backend** | `POST /api/view` přijímá `params` v body a předává je do `detect`/`get_line` pomocí `_call_with_params()` – podle signatury volá `fn(df, params)` nebo `fn(df)`. |

### 5.5 Příklad (EMA s View params a barvou)

```python
VIEW_PARAMS = {"period": 20, "color": "#3b82f6"}

def get_line(ohlc, params=None):
    params = params or {}
    period = int(params.get("period", 20))
    color = str(params.get("color", "#3b82f6")).strip()
    if not color.startswith("#"):
        color = "#" + color
    ema = ohlc["close"].ewm(span=period, adjust=False).mean()
    data = [{"date": ohlc.index[i].strftime("%Y-%m-%d"), "value": float(ema.iloc[i])}
            for i in range(len(ohlc))]
    return {f"EMA{period}": {"data": data, "color": color}}
```

Viz `examples/ema_indicator_view.py`, `examples/ema_indicator_mock.py`, `examples/view_interface.md`.

---

## 6. Typy instrumentů a ukládání dat

### 6.1 Instrument Type

Aplikace podporuje tři typy:

| Typ | Popis | Parametry v UI |
|-----|-------|----------------|
| **Futures** | Futures kontrakty (NQ, ES) | Tick Size, Value Per Tick |
| **Stocks** | Akcie | Position Size (počet akcií) |
| **Forex** | Forex páry | Lot Size, Pip Size, Pip Value |

### 6.2 Struktura složek pro data

Typ instrumentu se určuje podle **umístění souboru**:

```
data/mock/
├── NQ_5Y.csv              → instrumentType: "futures" (root = backward compat)
├── ES_5Y.csv              → futures
├── futures/                → futures
│   └── *.csv
├── stocks/                 → stocks
│   ├── AAPL_5Y.csv
│   └── MSFT_10Y.csv
└── forex/                  → forex
    ├── EURUSD_5Y.csv
    └── GBPUSD_3Y.csv

data/futures_30m/
├── NQ.txt, ES.txt, …      → instrumentType: "futures", timeframe: "30m"
```

### 6.2a Formát futures_30m (*.txt)

- Jedna řádka = jeden bar: `MM/DD/YYYY,HH:MM,open,high,low,close,volume` (bez hlavičky).
- Název souboru `{SYMBOL}.txt` → `instrument` = symbol (např. NQ, CL, TY).
- `GET /api/data` vrací navíc `displayName` (lidský popis kontraktu) a `brokerConfig` z `broker_config.json` pokud existuje.

### 6.3 Formát CSV

- Povinné sloupce: `Date` nebo `date`, OHLC (Open, High, Low, Close/Last)
- Volitelné: `Volume` (default 1000)
- Název souboru: `{INSTRUMENT}_5Y.csv` → instrument = první část před `_`

### 6.4 Filtrování instrumentů v UI

- `GET /api/data` vrací všechny instrumenty včetně `instrumentType`
- Frontend: `filterInstrumentsByType(instruments, backtestParams.instrumentType)`
- Při změně Instrument Type se výběr resetuje na první dostupný instrument daného typu

### 6.5 broker_config.json (futures)

```json
{
  "NQ": {
    "tick_size": 0.25,
    "tick_value": 5,
    "mult": 20,
    "margin": 20000,
    "commission_per_contract": 2.5
  },
  "ES": { ... }
}
```

Používá se pro futures v engine (PnL, commission). Další symboly (CL, GC, EU, …) viz aktuální `data/broker_config.json`. Stocks/Forex – viz sekce 13.

---

## 7. Firestore struktura

```
/strategies/{strategyId}
  - name, tag, createdAt
  /files/{fileName}  (např. main.py, utils.py)
    - fileName, content
  /results/{backtestId}   # Run history – automaticky po každém Run
    - strategyName, savedAt, equityCurve, metrics, trades

/indicators/{indicatorId}
  - name, tag, createdAt
  /files/main.py
    - fileName, content

/modules/{moduleId}
  - name, tag, createdAt
  /files/main.py
    - fileName, content
```

### 7.1 Run history – ukládání, governance a mazání

- **Uložení:** `saveBacktestResult(strategyId, strategyName, { equityCurve, metrics, trades })` – voláno automaticky po úspěšném Run
  - ukládá také `ownerUid`, governance metadata a experiment context
- **Seznam:** `listBacktestResults(strategyId)` – seřazeno podle `savedAt` (nejnovější první)
- **Smazání jednoho:** `deleteBacktestResult(strategyId, resultId)` = soft delete (`deletedAt`, `deletedBy`, `deleteReason`)
- **Smazání všech:** `deleteAllBacktestResults(strategyId)` = hromadný soft delete
- **Lifecycle update:** `updateBacktestRunGovernance(strategyId, resultId, patch)` – patch se zapisuje jako **merge** do vnořených polí `experiment.*` (Firestore dot-path), ne jako přepsání celého objektu `experiment`.

---

## 8. API reference

### 8.0 Auth a rate limiting

API endpointy používají security dependency:
- Auth: `X-API-Key` nebo Bearer token shodný s `API_AUTH_KEY`
- **Lokální vývoj:** pokud je request z `127.0.0.1` / `::1` a `API_AUTH_KEY` není nastavený, backend může povolit přístup (`local_dev_auto`) – v produkci vždy nastav `API_AUTH_KEY`.
- Identity lineage: volitelně `X-Actor-Id` (sanitizované)
- Rate limiting: in-memory window limiter

Doporučené env:
- `API_AUTH_REQUIRED=true`
- `API_AUTH_KEY=<strong-secret>` + frontend `NEXT_PUBLIC_API_AUTH_KEY` se stejnou hodnotou
- `API_ALLOW_DEV_BYPASS=false`
- `API_RATE_LIMIT_MAX_REQUESTS=120`
- `API_RATE_LIMIT_WINDOW_SEC=60`

### GET /api/data

Vrací seznam dostupných instrumentů.

**Response:**
```json
{
  "instruments": [
    {
      "instrument": "NQ",
      "displayName": "Nasdaq-100 E-mini",
      "timeframe": "1d",
      "file": "mock/NQ_5Y.csv",
      "minDate": "2021-03-12",
      "maxDate": "2026-03-11",
      "yearsAvailable": 5.0,
      "instrumentType": "futures",
      "brokerConfig": { "tick_size": 0.25, "tick_value": 5, "mult": 20, ... }
    }
  ]
}
```

`displayName` je volitelné (hlavně u `futures_30m`).

### GET /api/data/debug

Diagnostika: `data_dir`, `mock_exists`, `futures_30m_exists`, `csv_count`, `txt_count`, `csv_files`, `txt_files`.

### POST /api/run

Spustí backtest.

**Query:** `?stream=1` – SSE stream (log, progress, result)

**Body (RunRequest):** jako výše; desktop klient posílá zjednodušenou podmnožinu (**bez** `monte_carlo`, `regime_config`, `portfolio_config`, `batch_config`). Plný tvar včetně volitelných polí: `files`, `instrument`, `timeframe`, `years`, `data_file`, `initial_capital`, `slippage_perc`, `commission_perc`, `instrument_type`, `tick_size`, `value_per_tick`, `share_size`, `lot_size`, `pip_size`, `pip_value`, `params` (strategy + module_params), `applied_modules`, `run_id`, `validation_mode` (`single` \| `oos_split` \| `walk_forward` \| `param_test`), `validation_config`, `quality_gates`, `sweep_mode`, `sweep_config`, volitelně `monte_carlo`, `regime_config`, `portfolio_config`, `execution_model`, `experiment`, `batch_config`

**Response (non-stream):** RunResponse (equity, equityCurve, metrics incl. `maxEquity`/`maxDrawdownPct`/`maxDrawdownUsd` + `sortinoRatio`/`calmarRatio`/`marRatio`/`ulcerIndex`/`cagr` + `maxDrawdownDurationBars`/`maxDrawdownDurationDays`/`timeToRecoveryBars`/`timeToRecoveryDays`/`currentDrawdownPct` + `payoffRatio`/`edgePerTrade`/`kellyFraction`, trades incl. `mfe`/`mae`/`fees`/`slippageCost`, ohlc, moduleOutputs, `drawdownAnalysis` (full DD analysis: `underwaterPct`, `avgDurationBars`, `periodsCount`), `tradePnlDistribution` (histogram, percentiles, skewness, kurtosis, `tailRiskCVaR`, concentration), **`bootstrapCI`** (95% CI pro mean PnL, total return, trade Sharpe; trade-level resampling, 1000 bootstraps; `adjustedAlpha` = 0.05/trialCount Bonferroni), **`payoffDecomposition`** (win/loss rate, avg win/loss, payoff ratio, edge per trade, Kelly fraction), **`overfittingSignals`** (`trialCount`, `bonferroniAlpha`, `multipleTestingNote`), **`propRedFlags`** (`trustLevel`, `flags[]` s `key`/`severity`/`label`/`detail`, `criticalCount`, `warningCount`, `tip`), `validation`, `robustness`, `monteCarlo` (včetně `method`/`mode`/`note` u Monte Carla), `regimeAnalysis`, `portfolio`, `executionSummary` incl. `costAttribution`/`totalFees`/`totalSlippageCost`/`forwardBridge`, `qualityGate`, `experiment` incl. `runDiff`/`promoteEvidence`/`promoteDecision`=`review_candidate`|`hold`, volitelně `batchSummary`)

**SSE events (stream=1):**
- `{"type": "log", "line": "..."}`
- `{"type": "progress", "value": 0-100}`
- `{"type": "result", "data": RunResponse}`
- `{"type": "error", "message": "..."}`

### POST /api/view

OHLC + markery / čáry / zóny pro View chart.

**Body (zjednodušeně):** `data_file`, `years`, volitelně `module_code`, `params`, `module_dependencies`, `chart_timeframe`, `start_iso` / `end_iso`, `use_artifacts`, `artifact_include_sd`, `artifact_dataset_id`.

- **`chart_timeframe`:** `null`/`native` = zdrojová jemnost; jinak agregace (`1m`…`1Mo`).
- **`use_artifacts: true`:** vrstvy z **`.backtest_artifacts/`** (bez přepočtu modulu). Odpověď může obsahovat `zones`, `artifact_status`, `artifact_banner`, `dataset_id`.

**Response:** `{ ohlc, markers, lines, zones?, artifact_status?, artifact_banner?, dataset_id? }`

**Live modul (bez `use_artifacts`):** rozhraní `detect` / `get_line` / `get_zones`:
- `detect(ohlc, params=None)` → markery: `[{"date", "type": "high"|"low"|"signal", "value"}, ...]`
- `get_line(ohlc, params=None)` → čáry: `[{"date", "value"}, ...]` nebo `{"EMA20": [...], "EMA50": [...]}`

**View execution:** Pokud je v requestu `module_code` a nepoužívá se `use_artifacts`, backend spouští `view_engine.py` jako host subprocess (stejný Python jako backend).

**View params:** Pokud modul definuje `VIEW_PARAMS = {...}`, frontend posílá `params` v requestu; backend předává `params` do `detect`/`get_line` (pokud funkce druhý argument přijímá).

**Barva čar:** `get_line` může vracet `{"název": {"data": [...], "color": "#hex"}}` – frontend použije barvu v grafu.

Viz `examples/view_interface.md`, `examples/hl_module_template.py`, `examples/ema_indicator_view.py`, `examples/ema_indicator_mock.py`. Plán artefaktů: **`docs/BACKTEST_PIPELINE_REFACTOR.md`**.

### POST /api/artifacts/status

Stav H/L a S/D vrstev pro `data_file` + `years` (stejný klíč jako View / precompute). Odpověď: např. `dataset_id`, `hl`, `sd`, `overall` / `overall_label` pro badge ve UI.

### POST /api/artifacts/build

Synchronní build: H/L precompute (pokud potřeba), poté S/D precompute. Tělo obsahuje `data_file`, `years`, volitelně `zone_timeframes` (sladění se strategií). Může trvat minuty — UI zobrazí průběh / chybu.

### POST /api/chart

Generuje PNG candlestick grafu s mplfinance.

**Body:** `{ "ohlc": [...], "trades": [...] }`

**Response:** `image/png`

---

## 9. Indikátory a moduly

### Import v strategii

- Indikátor: `from indicators.{Název} import {Třída}` – soubor je uložen jako `indicators/{Název}.py` (název bez mezer, speciálních znaků)
- Modul: `from modules.{Název} import {funkce}` – soubor `modules/{Název}.py`

### Sestavení `files` při Run

1. Všechny soubory strategie (main.py, utils.py, …)
2. Pro každý vybraný indikátor: `indicators/{toModuleName(ind.name)}.py` = obsah `main.py` indikátoru
3. Pro každý vybraný modul: `modules/{toModuleName(mod.name)}.py` = obsah `main.py` modulu

Uživatel musí v BacktestSettings vybrat indikátory/moduly a kliknout **Potvrdit** před Run.

### Výchozí obsah při vytvoření

Při vytvoření nového indikátoru nebo modulu (`createItem` v `frontend/lib/firestore.ts`) se do `main.py` zapíše výchozí kód s návodem a funkčním příkladem:
- **Indikátor:** backtrader třída + `get_line` (EMA příklad), `VIEW_PARAMS`, komentáře k rozhraní
- **Modul:** `detect` (3-bar pivot příklad), `get_line` (prázdný), `VIEW_PARAMS`, komentáře k rozhraní

### Příklad: Swing HL modul

Modul **Swing HL** (`examples/swing_hl_detector.py`) vrací:

| Funkcionalita | Pro strategii | Pro View/Results |
|---------------|---------------|------------------|
| Swing H/L | `get_swings(ohlc, params)` | `detect()` – markery high/low |
| Internal H/L | `get_swings(ohlc, {**params, "include_internals": True})` | `detect()` – markery internal_high/low |
| BOS | `get_bos(ohlc, params)` | `get_zones()` – zóny BOS |
| Trend | `get_trend(ohlc, params)` → `{"score", "state"}` | `get_line()` – trendová čára |

- Parametry: `VIEW_PARAMS` modulu (timeframe, atr_period, ema_fast, …) – upravitelné v panelu Parameters při backtestu (záložka modulu)
- Strategie musí modul vybrat v panelu Moduly; params z `params.module_params["Swing HL"]` předat do modulu
- Po backtestu: záložka **Detailed** (nebo modulové výstupy v `moduleOutputs`) zobrazí OHLC + markery + trend + BOS zóny podle `ModuleOutputChart`

---

## 10. Technologie

| Vrstva | Technologie |
|--------|-------------|
| Frontend | Next.js 14, React, TailwindCSS, Monaco Editor, Plotly (react-plotly.js), TradingView Lightweight Charts |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Backtest | Backtrader (`docker/engine.py` — subprocess nebo volitelně in-process) |
| Data | Firebase Firestore (strategie, indikátory, moduly, results), CSV (OHLCV) |
| Engine deps | backtrader, pandas, pyarrow (viz `backend/requirements.txt`) |
| Graf (PNG) | mplfinance |

---

## 11. Konfigurace

### Environment variables

- **Frontend:** `NEXT_PUBLIC_API_URL` – URL backendu (default `http://localhost:8000`)
- **Frontend (auth):** `NEXT_PUBLIC_API_AUTH_KEY` – API key posílaný na backend
- **Backend (security):** `API_AUTH_REQUIRED`, `API_AUTH_KEY`, `API_ALLOW_DEV_BYPASS`, `API_RATE_LIMIT_MAX_REQUESTS`, `API_RATE_LIMIT_WINDOW_SEC`
- **Backend (optional governance hardening):** `API_STRICT_GOVERNANCE=true` zamítne u klientů bez API klíče eskalaci v `experiment`: `lifecycleStatus` ∈ {approved, promoted}, `reviewerApproved=true`, nebo nastavené `promotedAt`
- **Backend (timeouts):** `RUN_TIMEOUT_SEC`, `RUN_STREAM_IDLE_TIMEOUT_SEC`, `RUN_DISCONNECT_GRACE_SEC` (prodleva před ukončením **engine subprocessu** při odpojení klienta během studeného startu), `VIEW_WORKER_TIMEOUT_SEC`
- **Backend (manifest):** `codeDigest`, `engine` = `host-worker`, volitelně `engineExecutionMode` = `inprocess`; legacy `imageDigest` se z manifestu odstraňuje po normalizaci
- **Firebase:** konfigurace v `frontend/lib/firebase.ts`

### Runner

- Timeout: default **3600s** wall-clock (env `RUN_TIMEOUT_SEC` nebo request `run_timeout_sec`; `0` = bez limitu)
- Stream idle: default **1800s** (`RUN_STREAM_IDLE_TIMEOUT_SEC`) — žádný log/progress z engine po tuto dobu = považovat za zásek
- **In-process engine** je nyní výchozí (eliminuje subprocess overhead). Pro subprocess: `RUN_INPROCESS_ENGINE=0`.
- `MAX_OHLC_EXPORT_BARS` — server-side OHLC bar cap (default 8000). Delší série se uniform-downsampleují.

---

## 12. Firestore pravidla

Pro ukládání výsledků backtestů musí být nasazena Firestore pravidla v owner/role režimu:
- create: pouze autentikovaný owner (`ownerUid == request.auth.uid`),
- read/update: owner + role `admin`/`reviewer`,
- hard delete run result: pouze admin (UI používá soft-delete).

Nasazení v root projektu:

```bash
firebase deploy --only firestore:rules
```

Vyžaduje Firebase CLI (`npm i -g firebase-tools`) a přihlášení (`firebase login`). Soubory `firestore.rules` a `firebase.json` jsou v projektu.

### 8.1 Metodické limity (shrnutí)

- **Monte Carlo:** `riskOfRuin` je **odhad z bootstrapu** (náhodné přeuspořádání PnL), ne pravděpodobnost z reálné distribuce trhu. Pole `method`/`mode`/`note` ve výsledku popisují použitý postup.
- **Profit factor:** poměr hrubého zisku a hrubé ztráty z uzavřených obchodů. **Bez ztrátových obchodů** je poměr matematicky nedefinovaný: `metrics.profitFactor` je **`null`**, `metrics.profitFactorStatus` je např. `undefined_no_losing_trades` (ne číselný sentinel 999). Pro **řazení ve sweepu** engine používá interní konečné `forScoring`, ne JSON null. Starší uložené runy mohou mít ještě vysoký číselný sentinel — UI ho bere jako legacy.
- **Sharpe:** hlavní `sharpeRatio` je annualizovaný z equity křivky (stejná logika jako Sortino); `sharpeRatioLegacyAnalyzer` je hodnota z Backtrader `SharpeRatio` analyzéru pro srovnání.
- **Portfolio:** `portfolio.model` = `independent_isolated_capital_per_instrument` — každý instrument má izolovaný kapitál; `weightedIndependentReturnUsd` / `weightedIndependentMaxDrawdownPct` jsou vážené průměry metrik, ne jedna multi-asset equity cesta (viz `disclaimer` v JSON).
- **Execution latency:** `slippage_latency_proxy_bars` (alias `latency_bars`) zvyšuje efektivní slippage %, **neodkládá** objednávky v čase.
- **CSV bez volume:** při chybějícím sloupci engine/view doplní **syntetické volume=1000** a zaloguje varování — strategie závislé na reálném objemu nejsou validní.
- **Walk-forward / OOS:** fold-level metriky a `guardrails` jsou **heuristiky** (varování před možným leakage nebo slabým foldem), ne důkaz absence leakage.
- **Overfitting / readiness (UI):** záložka Analytics a sloupec v Run history používají sdílenou **heuristickou** sadu pravidel (single run, počet obchodů, riziko z Monte Carla pokud pole `monteCarlo` v odpovědi je, quality gate, sweep na single, degradace train→test, selhání fold gates, guardrails, stabilita sweepu, velké batch dávky z API, extrémní PF). Jde o orientační signál, ne statistický test.
- **Drawdown duration (`drawdownAnalysis`):** `maxDrawdownDurationBars` / `Days` měří nejdelší nepřerušený pokles od vrcholu k dnu; `timeToRecoveryBars` / `Days` = bary/dny od dna zpět na nový vrchol equity (nebo null pokud nedošlo k recovery). `underwaterPct` = procento barů pod předchozím maximem; `periodsCount` = celkový počet drawdown epizod.
- **Trade PnL distribution (`tradePnlDistribution`):** histogram uzavřených PnL, percentily (p5–p95), skewness, kurtosis, `tailRiskCVaR` (podmíněná hodnota v riziku na 5. percentilu), `concentration.top5PnlPct` = podíl celkového zisku z top 5 obchodů (vysoká koncentrace = závislost na málo obchodech).
- **Stress multiplier (`execution_model.stress_multiplier`):** násobí slippage/spread penaltu v execution modelu; výchozí 1.0 (žádný stress), hodnota > 1 simuluje horší podmínky plnění (např. 1.5 = 50 % přirážka na tření). V UI jako vstupní pole **Stress multiplier** v sekci Execution Model (Edge finding).
- **Portfolio model:** `portfolio.model` v odpovědi — např. `independent_isolated_capital_per_instrument`; UI zobrazuje banner s popisem modelu a disclaimerem (portfoliové metriky jsou vážené průměry, ne multi-asset equity).
- **Bootstrap CI (`bootstrapCI`):** 95% intervaly spolehlivosti (mean PnL, total return, trade-level Sharpe) pomocí **trade-level resamplingU** (1 000 bootstrapů). `adjustedAlpha` = 0.05 / `trialCount` (naivní Bonferroni korekce na počet nezávislých pokusů K z manifestu). Předpokládá nezávislost obchodů (IID); při silné sériové korelaci PnL interpretuj opatrně.
- **Payoff decomposition (`payoffDecomposition`):** rozklad edge na win rate × avg win − loss rate × avg loss; `payoffRatio` = avg win / avg loss; `kellyFraction` = Kelly kritérium pro position sizing. Kelly předpokládá přesné pravděpodobnosti a nezávislé sázky — v praxi se obvykle bere **half-Kelly nebo méně**.
- **Multiple testing / trial count (`overfittingSignals`):** `trialCount` K zahrnuje sweep, případné dílčí běhy `batch_config` a foldy; naivní **Bonferroni α = 0.05 / K**. Je to konzervativní horní odhad — při korelovaných pokusech (podobné parametry) je skutečná korekce slabší. UI zviditelňuje K a upravenou α.
- **Prop red flags (`propRedFlags`):** engine funkce `_compute_prop_red_flags()` automaticky skenuje výsledky z pohledu prop-firm reviewer. Vrací `trustLevel` (not_trustworthy / low_trust / cautious / acceptable) a seznam `flags` s `severity` (critical / warning). Kontrolované vzory: extrémně vysoký Sharpe s málo obchody, méně než 10 obchodů (critical) / méně než 30 (warning), nulové ztráty / win rate > 95 %, nedefinovaný PF (sentinel), single run bez validace, vypnutý execution model, kombinace single + no execution (minimální věrohodnost), podezřele nízký DD, příliš hladká equity (> 92 % barů rostoucích), bootstrap CI protínající nulu, koncentrace PnL (top 5 > 80 %). UI zobrazuje trust banner pod exportem a detailní sekci v Analytics.
- **„Not a broker" disclaimer (`executionSummary`):** v Analytics u execution summary se zobrazuje upozornění, že execution model je **zjednodušená aproximace** (lineární slippage, bez market impact, bez modelování kapacity a book depth). Není to broker-level simulace a výsledky nelze přímo srovnávat s reálným plněním.
- **Governance:** schvalování z UI zapisuje metadata do Firestore; **server-only** enforcement (Phase 6b) vyžaduje backend proxy nebo Cloud Functions – viz READMEAI.

---

## 13. Známá omezení a TODO

1. **Futures:** Engine nyní používá `broker_config.json` (mult, margin, commission_per_contract) pro správný výpočet PnL a commission.
2. **Stocks:** Broker používá procentní commission z `broker_config.default.commission_perc`. Strategie musí mít `share_size` v params a volat `self.buy(size=self.params.share_size)` – hodnota se předává z UI.
3. **Forex:** Broker používá stocklike režim. Plný výpočet PnL podle pip_value/lot_size vyžaduje custom CommInfo – zatím neimplementováno.

---

## 14. Troubleshooting

| Problém | Možná příčina | Řešení |
|---------|---------------|--------|
| 401 Unauthorized na API | Chybí API key / auth header | Nastav `NEXT_PUBLIC_API_AUTH_KEY` a backend `API_AUTH_KEY`, zkontroluj hlavičky |
| 429 Rate limit | Příliš mnoho requestů ve window | Uprav `API_RATE_LIMIT_MAX_REQUESTS` / `API_RATE_LIMIT_WINDOW_SEC` |
| Instrument se nenačítá | Instrument Type ≠ typ dat | Zkontroluj, že máš vybraný správný Instrument Type (Futures pro NQ) |
| Žádné instrumenty | Data složka prázdná nebo špatná cesta | Zkontroluj `GET /api/data/debug`, strukturu `data/mock/` |
| Backtest selže | Chybějící závislosti (Backtrader, pyarrow), chyba ve strategii | `pip install -r backend/requirements.txt`, logy v LogPanelu, `.backtest_run/last_error_strategy.py` |
| **exit 130 / KeyboardInterrupt** v logu engine | Přerušení procesu (SIGINT), ne chyba pandas | Nejčastěji Zastavit v UI nebo zavření záložky. Zkus znovu. |
| CORS chyba | Backend jiný port/origin | Nastav `allow_origins` v main.py nebo `NEXT_PUBLIC_API_URL` |
| Firebase chyba | Chybějící konfigurace | Zkontroluj `firebase.ts`, service account / API key |
| **FirebaseError: Missing or insufficient permissions** | Firestore pravidla blokují zápis | Nasazení pravidel: `firebase deploy --only firestore:rules` (v root projektu) |
| Run history prázdná | Firestore pravidla nebo chyba při ukládání | Zkontroluj logy („Uložení výsledků selhalo“), Firestore rules |
| View params: „nemá VIEW_PARAMS“ | Python komentáře v dict, encoding | Odstranit `# komentář` za hodnotami; kód uložit jako UTF-8; viz `examples/ema_indicator_mock.py` |

---

## 15. Další dokumentace

- **READMEADAM.md** – uživatelská mapa celé aplikace (UI, Edge finding, výsledky, kde je nápověda)
- **READMEAI.md** – reference pro AI/boty: architektura, data flow, API kontrakty, kde měnit kód
- **audit/README.md** – index uložených auditů (risk, DS, prop, trader, výkon, UX)
- **docs/QUANT_AUDIT.md** – technický quant audit (data pipeline, exekuce, metriky engine)
- **SCRIPTS.md** – příkazy pro spuštění (backend, frontend), troubleshooting
- **strategies/test/readme.py** – tutoriál psaní strategií (Backtrader API, životní cyklus, příklady)
- **examples/view_interface.md** – rozhraní pro View (detect, get_line, VIEW_PARAMS)
- **examples/ema_indicator_mock.py** – příklad indikátoru s VIEW_PARAMS (period, color)
