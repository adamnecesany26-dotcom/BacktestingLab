# Backtesting Platform – Kompletní dokumentace

Webová aplikace pro testování obchodních strategií na historických datech. Uživatel píše strategie v Pythonu (Backtrader), spouští backtest v izolovaném Docker kontejneru a vidí výsledky – grafy, statistiky, obchody a historii runů.

**Účel dokumentu:** Tento soubor slouží jako kompletní technická dokumentace pro hodnocení workflow aplikace (např. ChatGPT, code review).

> **Důležité (2026-03):** Přidán institution-grade hardening:
> - API auth + rate limiting,
> - `/api/view` běží v Docker sandboxu,
> - append-only audit log (`.audit/events.jsonl`),
> - run manifest fingerprinting (`runSeed`, `datasetFingerprint`, `codeDigest`, `imageDigest`, `actorId`),
> - Firestore owner/role policy + soft-delete run history,
> - compare workspace + lifecycle approvals v Run history.

---

## 1. Přehled aplikace

### 1.1 Co aplikace dělá

1. **Strategie** – uživatel vytváří a upravuje obchodní strategie v Pythonu (Backtrader API)
2. **Indikátory a moduly** – znovupoužitelné komponenty (indikátory jako `bt.Indicator`, moduly jako utility funkce)
3. **Parameter Panel** – dynamické parametry z `PARAMS = {...}` strategie a `VIEW_PARAMS` modulů – záložky Strategie | Modul1 | Modul2, úprava bez editace kódu
4. **Auto-detekce importů** – systém podle importů ve strategii předvybere indikátory/moduly (ruční úprava zůstává možná)
5. **Backtest** – spuštění strategie na historických OHLCV datech v izolovaném prostředí
6. **Výsledky** – equity křivka, metriky (Sharpe, drawdown, max equity, MFE/MAE), seznam obchodů, candlestick grafy, záložka **Moduly** s výstupy modulů (markery, čáry)
6. **Trade Highlight** – detail jednoho obchodu (okno entry–exit + kontext) s interaktivním výběrem
7. **Run history** – automatické ukládání každého runu do Firestore, tabulka + grafy metrik napříč runy
8. **View mode** – svíčkový graf s markery/čáry z modulu/indikátoru bez backtestu; **View params drawer** – ikona vedle Obnovit otevře panel pro úpravu `VIEW_PARAMS` (period, barva, …)
9. **Uložit / Uloženo** – tlačítko Uložit se po uložení změní na „Uloženo“ (disabled), po změně kódu zpět na „Uložit“
10. **Guide** – ikona otazníku v pravém dolním rohu otevře stránku `/guide` s A-Z průvodcem

### 1.2 Architektura (vysokoúrovňově)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js, React)                                                   │
│  - page.tsx: hlavní stav, orchestrace, handleRun, saveBacktestResult          │
│  - BacktestSettings: collapsible sekce (Basic, Instrument config, Simulation, Indicators&Modules, Parameters, Run)      │
│  - StrategyEditor: Monaco editor (kód)                                       │
│  - ResultsView: záložky Equity | Highlight | Detailed | Analytics | Run history│
│  - TradeHighlight: graf jednoho obchodu + seznam obchodů                     │
│  - RunHistory: tabulka runů + grafy metrik (Sharpe, R-multiple, P/L, …)       │
│  - Firebase Firestore: strategie, indikátory, moduly, results (Run history)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (fetch), SSE (stream=1)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI, Python)                                                   │
│  - GET /api/data: seznam dostupných instrumentů (podle složek mock/*)         │
│  - POST /api/run?stream=1: spuštění backtestu (SSE: log, progress, result)    │
│  - POST /api/view: OHLC + markery/čáry z modulu, View params                  │
│  - POST /api/chart: generace PNG grafu (mplfinance)                          │
│  - services/runner.py: orchestrace Dockeru, streamování výstupu              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ docker run
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  DOCKER KONTEJNER (backtest-engine)                                          │
│  - engine.py: načte strategii, data, spustí Backtrader                      │
│  - Mount: /app/strategy (strategie), /app/data (OHLCV CSV/parquet)            │
│  - Env: STRATEGY_PATH, DATA_FILE, STRATEGY_PARAMS (JSON), …                  │
│  - Výstup: JSON na stdout, PROGRESS:X na stderr                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Proč Docker

Strategie je cizí Python kód. Spouští se v izolovaném kontejneru:
- Bez síťového přístupu (`--network none`)
- Omezená paměť (1 GB), CPU (1 core)
- Timeout default 5 minut (`RUN_TIMEOUT_SEC=300`, lze přepsat env)
- Nemůže poškodit hostitelský systém

---

## 2. Struktura projektu

```
Backtesting_app/
├── frontend/                    # Next.js aplikace
│   ├── app/
│   │   ├── page.tsx             # Hlavní stránka – stav, logika, orchestrace, handleRun, loadRunHistory
│   │   ├── guide/page.tsx       # A-Z průvodce aplikací (stránka /guide)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Sidebar.tsx          # Levý panel – Strategie/Indikátory/Moduly, soubory, Zpět
│   │   ├── MainView.tsx         # Strategie / Indikátory / Moduly – seznam + vytvoření
│   │   ├── BacktestSettings.tsx # Pravý panel – collapsible sekce Basic/Instrument config/Simulation/Indicators&Modules/Parameters/Run
│   │   ├── BacktestResults.tsx  # (legacy) Statistiky
│   │   ├── editor/
│   │   │   └── StrategyEditor.tsx # Monaco editor
│   │   ├── results/
│   │   │   ├── ResultsView.tsx  # Kontejner výsledků – záložky Equity, Highlight, Detailed, Analytics, Run history
│   │   │   ├── StatBlocks.tsx   # Metriky (equity, Sharpe, drawdown, win rate, …)
│   │   │   ├── AnalyticsView.tsx # Souhrnná analytika backtestu (MVP)
│   │   │   ├── TradeHighlight.tsx # Graf jednoho obchodu + seznam obchodů (klik pro detail)
│   │   │   └── RunHistory.tsx   # Historie runů – tabulka + grafy metrik
│   │   ├── charts/
│   │   │   ├── DetailedChart.tsx # Candlestick + trades (TradingView Lightweight Charts)
│   │   │   ├── EquityChart.tsx
│   │   │   ├── TradesChart.tsx
│   │   │   └── TradeHighlightChart.tsx # Candlestick okno entry–exit pro jeden obchod
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
│   │   │   ├── view.py          # POST /api/view (OHLC + markery/čáry z modulu, View params)
│   │   │   └── chart.py         # POST /api/chart (PNG)
│   │   ├── services/
│   │   │   ├── runner.py        # Docker orchestrace, streamování + manifest metadata
│   │   │   ├── audit.py         # Append-only audit logger
│   │   │   └── chart.py         # mplfinance generace grafu
│   │   └── models/
│   │       └── run.py           # RunRequest, RunResponse, Trade, BacktestMetrics
│   └── docker/
│       ├── Dockerfile           # python:3.11-slim + backtrader
│       ├── engine.py            # Skript běžící UVNITŘ kontejneru
│       ├── view_engine.py       # Sandbox engine pro /api/view
│       └── requirements.txt
│
├── shared/
│   └── types/
│       └── index.ts             # RunRequest, RunResponse, DataInstrument, InstrumentType, filterInstrumentsByType
│
├── data/
│   ├── broker_config.json       # tick_size, tick_value, mult, margin pro futures
│   └── mock/
│       ├── NQ_5Y.csv            # Futures (root = backward compat)
│       ├── futures/             # (volitelné) další futures
│       ├── stocks/              # Akcie (AAPL_5Y.csv, …)
│       └── forex/               # Forex páry (EURUSD_5Y.csv, …)
│
├── firestore.rules              # Firestore security rules
├── firebase.json                # Konfigurace pro firebase deploy
├── strategies/                  # Lokální příklady (ne v produkci)
├── SCRIPTS.md                   # Příkazy, skripty, troubleshooting
├── README.md                    # Dokumentace pro vývojáře
└── READMEAI.md                  # Referenční dokument pro AI/boty – architektura, data flow, workflow
```

---

## 3. Kompletní workflow – krok za krokem

### 3.1 Spuštění aplikace

1. **Backend:** `cd backend && uvicorn app.main:app --reload` → http://localhost:8000
2. **Frontend:** `cd frontend && npm run dev` → http://localhost:3000
3. **Docker:** Image `backtest-engine` musí být sestaven: `docker build -t backtest-engine backend/docker`

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
| 14 | (Volitelně) Klikne **View** | Přepne na View chart – svíčkový graf s mock daty, výběr modulu/indikátoru pro vizualizaci H/L bodů; ikona params vedle Obnovit otevře drawer s parametry |
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
  "monte_carlo": { "simulations": 300, "ruin_dd_pct": 50 },
  "regime_config": { "enabled": true },
  "execution_model": { "enabled": true, "spread_bps": 0.5, "slippage_vol_mult": 1.0, "latency_bars": 0 },
  "experiment": { "hypothesis": "sd-trend-breakout", "tags": ["manual-run"] }
}
```

**Backend (`api/run.py`):**

1. Přijme `RunRequest`
2. Pokud `?stream=1`: vrací `StreamingResponse` s `text/event-stream`
3. Volá `run_strategy_streaming(...)` z `runner.py`

**Runner (`services/runner.py`):**

1. Vytvoří `.backtest_run/` v project root
2. `_prepare_strategy_files()`: zapíše soubory do `.backtest_run/`, vytvoří `indicators/__init__.py`, `modules/__init__.py` pokud potřeba
3. Spustí Docker:
   ```
   docker run --rm --memory=1g --cpus=1 --network none
     -v .backtest_run:/app/strategy:rw
     -v data:/app/data:ro
     -e STRATEGY_PATH=/app/strategy/main.py
     -e INSTRUMENT=NQ
     -e TIMEFRAME=1d
     -e YEARS=1
     -e DATA_FILE=mock/NQ_5Y.csv
     -e INITIAL_CAPITAL=100000
     -e SLIPPAGE_PERC=0.001
     -e INSTRUMENT_TYPE=futures
     -e TICK_SIZE=0.25
     -e VALUE_PER_TICK=5
     -e STRATEGY_PARAMS={"sma_fast":20,"sma_slow":50,...}
     ...
     backtest-engine
   ```
4. Čte stdout/stderr v odděleném vlákně
5. Parsuje JSON z stdout → `{"equity": [...], "metrics": {...}, "trades": [...], "ohlc": [...]}` → event `result`
6. Pokud `applied_modules` v requestu: `engine.py` dopočítá `moduleOutputs` uvnitř kontejneru (detect/get_line/get_zones) a vrátí je v JSON výsledku
7. Parsuje `PROGRESS:10` z stderr → event `progress`
8. Při chybě: JSON `{"error": "..."}` → event `error`
9. Streamuje události klientovi přes SSE
10. Po dokončení smaže `.backtest_run/*.py`
11. Do engine env posílá governance metadata: `RUN_SEED`, `CODE_DIGEST`, `ENGINE_IMAGE_DIGEST`, `ACTOR_ID`

**Engine (`docker/engine.py` – uvnitř kontejneru):**

1. Načte env: `STRATEGY_PATH`, `DATA_PATH`, `INSTRUMENT`, `TIMEFRAME`, `YEARS`, `DATA_FILE`, `STRATEGY_PARAMS` (JSON), `RUN_SEED`, `CODE_DIGEST`, `ENGINE_IMAGE_DIGEST`, `ACTOR_ID`
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
    "expectancyUsd": 119,
    "expectancyR": 0.5,
    "rMultiple": 0.5
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
  }
}
```

### 3.4 Zobrazení výsledků (ResultsView)

**Záložky:**

| Záložka | Obsah |
|---------|-------|
| **Equity** | EquityChart – křivka equity v čase |
| **Highlight** | TradeHighlight – graf jednoho obchodu (entry–exit + kontext) + seznam obchodů (klik pro detail) |
| **Detailed** | Plotly candlestick graf s markery entry/exit + rectangle mezi entry/exit (zisk = zelená, ztráta = červená) |
| **Analytics** | Edge-finding analytika: validation, gates, robustness heatmap, Monte Carlo, regime/portfolio, execution costs, forward bridge, run diff vs baseline, promote evidence |
| **Moduly** | Pro každý použitý modul: Plotly graf OHLC + markery/čáry z `detect`/`get_line` (zobrazí se jen pokud backtest vrací `moduleOutputs`) |
| **Run history** | RunHistory – tabulka runů + grafy metrik napříč runy |

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

**StatBlocks:** zobrazí metriky aktuálního runu konzistentně napříč taby.

**Export:** JSON výsledků ke stažení (equityCurve, metrics, trades).

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

**View** je záložka vedle Results, kde vidíš svíčkový graf s OHLC daty a volitelně **markery** (body) nebo **čáry** (indikátory) z tvého kódu – bez spuštění backtestu. Slouží k rychlé vizualizaci toho, jak modul/indikátor/strategie funguje na datech.

**Typický workflow:**
1. Vytvoříš indikátor (např. EMA) nebo modul (např. swing H/L)
2. Přepneš na záložku **View**
3. Vybereš instrument, období a modul/indikátor/strategii
4. Graf se zobrazí s čárami nebo markery z tvého kódu

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
```

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
    "tick_value": 20,
    "mult": 80,
    "margin": 20000,
    "commission_per_contract": 2.5
  },
  "ES": { ... }
}
```

Používá se pro futures v engine (zatím primárně pro konfiguraci; výpočet PnL pro Stocks/Forex je v engine zatím neimplementovaný – viz poznámky níže).

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
- **Lifecycle update:** `updateBacktestRunGovernance(strategyId, resultId, patch)` pro approval workflow

---

## 8. API reference

### 8.0 Auth a rate limiting

API endpointy používají security dependency:
- Auth: `X-API-Key` nebo Bearer token
- Identity lineage: volitelně `X-Actor-Id`
- Rate limiting: in-memory window limiter

Doporučené env:
- `API_AUTH_REQUIRED=true`
- `API_AUTH_KEY=<strong-secret>`
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
      "timeframe": "1d",
      "file": "mock/NQ_5Y.csv",
      "minDate": "2021-03-12",
      "maxDate": "2026-03-11",
      "yearsAvailable": 5.0,
      "instrumentType": "futures",
      "brokerConfig": { "tick_size": 0.25, "tick_value": 20, "mult": 80, ... }
    }
  ]
}
```

### GET /api/data/debug

Diagnostika: `data_dir`, `mock_exists`, `csv_count`, `csv_files`.

### POST /api/run

Spustí backtest.

**Query:** `?stream=1` – SSE stream (log, progress, result)

**Body (RunRequest):** `files`, `instrument`, `timeframe`, `years`, `data_file`, `initial_capital`, `slippage_perc`, `commission_perc`, `instrument_type`, `tick_size`, `value_per_tick`, `share_size`, `lot_size`, `pip_size`, `pip_value`, `params` (strategy + module_params), `applied_modules` (pro výstupy modulů), `run_id`, `validation_mode`, `validation_config`, `quality_gates`, `sweep_mode`, `sweep_config`, `monte_carlo`, `regime_config`, `portfolio_config`, `execution_model`, `experiment`

**Response (non-stream):** RunResponse (equity, equityCurve, metrics incl. `maxEquity`/`maxDrawdownPct`/`maxDrawdownUsd` + `sortinoRatio`/`calmarRatio`/`marRatio`/`ulcerIndex`/`cagr`, trades incl. `mfe`/`mae`/`fees`/`slippageCost`, ohlc, moduleOutputs, `validation`, `robustness`, `monteCarlo`, `regimeAnalysis`, `portfolio`, `executionSummary` incl. `totalFees`/`totalSlippageCost`/`forwardBridge`, `qualityGate`, `experiment` incl. `runDiff`/`promoteEvidence`/`promoteDecision`)

**SSE events (stream=1):**
- `{"type": "log", "line": "..."}`
- `{"type": "progress", "value": 0-100}`
- `{"type": "result", "data": RunResponse}`
- `{"type": "error", "message": "..."}`

### POST /api/view

OHLC data + volitelné markery a čáry z modulu/indikátoru/strategie pro View chart.

**Body:** `{ data_file: string, years: number, module_code?: string, params?: Record<string, number|boolean|string> }`

**Response:** `{ ohlc: [...], markers: [...], lines: [{ name, data: [...] }, ...] }`

**Rozhraní (modul, indikátor i strategie):**
- `detect(ohlc, params=None)` → markery: `[{"date", "type": "high"|"low"|"signal", "value"}, ...]`
- `get_line(ohlc, params=None)` → čáry: `[{"date", "value"}, ...]` nebo `{"EMA20": [...], "EMA50": [...]}`

**View sandbox execution:** Pokud je v requestu `module_code`, backend spouští `view_engine.py` uvnitř Docker sandboxu.

**View params:** Pokud modul definuje `VIEW_PARAMS = {...}`, frontend posílá `params` v requestu; backend předává `params` do `detect`/`get_line` (pokud funkce druhý argument přijímá).

**Barva čar:** `get_line` může vracet `{"název": {"data": [...], "color": "#hex"}}` – frontend použije barvu v grafu.

Viz `examples/view_interface.md`, `examples/hl_module_template.py`, `examples/ema_indicator_view.py`, `examples/ema_indicator_mock.py`.

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
- Po backtestu: záložka **Moduly** zobrazí OHLC + markery + trendová čára + BOS zóny

---

## 10. Technologie

| Vrstva | Technologie |
|--------|-------------|
| Frontend | Next.js 14, React, TailwindCSS, Monaco Editor, TradingView Lightweight Charts |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Backtest | Backtrader (v Dockeru) |
| Data | Firebase Firestore (strategie, indikátory, moduly, results), CSV (OHLCV) |
| Docker | python:3.11-slim, backtrader, pandas |
| Graf (PNG) | mplfinance |

---

## 11. Konfigurace

### Environment variables

- **Frontend:** `NEXT_PUBLIC_API_URL` – URL backendu (default `http://localhost:8000`)
- **Frontend (auth):** `NEXT_PUBLIC_API_AUTH_KEY` – API key posílaný na backend
- **Backend (security):** `API_AUTH_REQUIRED`, `API_AUTH_KEY`, `API_ALLOW_DEV_BYPASS`, `API_RATE_LIMIT_MAX_REQUESTS`, `API_RATE_LIMIT_WINDOW_SEC`
- **Backend (timeouts):** `RUN_TIMEOUT_SEC`, `RUN_STREAM_IDLE_TIMEOUT_SEC`, `VIEW_WORKER_TIMEOUT_SEC`
- **Backend (manifest):** `BACKTEST_ENGINE_IMAGE_DIGEST` (volitelné, pro audit fingerprint)
- **Firebase:** konfigurace v `frontend/lib/firebase.ts`

### Runner

- Timeout: default **300s** (`RUN_TIMEOUT_SEC=300`), optional env override
- Docker: `--memory=1g`, `--cpus=1`, `--network none`

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
| Backtest selže | Docker neběží, chyba ve strategii | Zkontroluj `docker ps`, logy v LogPanelu, `.backtest_run/last_error_strategy.py` |
| CORS chyba | Backend jiný port/origin | Nastav `allow_origins` v main.py nebo `NEXT_PUBLIC_API_URL` |
| Firebase chyba | Chybějící konfigurace | Zkontroluj `firebase.ts`, service account / API key |
| **FirebaseError: Missing or insufficient permissions** | Firestore pravidla blokují zápis | Nasazení pravidel: `firebase deploy --only firestore:rules` (v root projektu) |
| Run history prázdná | Firestore pravidla nebo chyba při ukládání | Zkontroluj logy („Uložení výsledků selhalo“), Firestore rules |
| View params: „nemá VIEW_PARAMS“ | Python komentáře v dict, encoding | Odstranit `# komentář` za hodnotami; kód uložit jako UTF-8; viz `examples/ema_indicator_mock.py` |

---

## 15. Další dokumentace

- **READMEAI.md** – referenční dokument pro AI/boty: architektura, data flow, workflow, API kontrakty, kde provádět změny
- **SCRIPTS.md** – příkazy, skripty, edge cases
- **strategies/test/readme.py** – tutoriál psaní strategií (Backtrader API, životní cyklus, příklady)
- **examples/view_interface.md** – rozhraní pro View (detect, get_line, VIEW_PARAMS)
- **examples/ema_indicator_mock.py** – příklad indikátoru s VIEW_PARAMS (period, color)
