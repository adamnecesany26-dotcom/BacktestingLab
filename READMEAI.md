# Backtesting Platform – AI/Bot Reference

**Purpose:** This document enables any AI model or bot to understand the application in detail: architecture, data flow, workflows, logic, technologies, and where to make changes. Read this file first when working with the codebase.

**Language:** Czech and English mixed (matches codebase). Key terms are consistent.

---

## 1. Quick Reference for AI

### 1.1 What This App Does

- **Backtesting platform** – users write Python strategies (Backtrader), run backtests on historical OHLC data in an isolated Docker container, view results (equity, trades, metrics, module outputs).
- **Strategies, Indicators, Modules** – stored in Firebase Firestore. Strategies can import indicators and modules.
- **View mode** – preview module/indicator output (markers, lines, zones) on a chart without running backtest.
- **Run history** – each successful Run is auto-saved to Firestore under the strategy.

### 1.2 Key Entry Points

| Task | Primary File(s) |
|------|-----------------|
| Main app state, orchestration | `frontend/app/page.tsx` |
| Run backtest logic | `frontend/app/page.tsx` → `handleRun`, `frontend/lib/api.ts` → `runBacktestStreaming` |
| Backend run endpoint | `backend/app/api/run.py` |
| Docker orchestration | `backend/app/services/runner.py` |
| Strategy execution (inside Docker) | `backend/docker/engine.py` |
| View (markers/lines from module) | `backend/app/api/view.py`, `frontend/components/StrategyViewChart.tsx` |
| Firestore CRUD | `frontend/lib/firestore.ts` |
| Shared types | `shared/types/index.ts` |

### 1.3 Data Flow Summary

```
User → page.tsx (state) → Firestore (strategies/indicators/modules)
                       → API (run, view, data, chart)
Backend → runner.py → Docker (engine.py) → stdout JSON
Runner → _run_module_outputs() → moduleOutputs in response
Frontend ← SSE events (log, progress, result) → setResults, showResults
```

---

## 2. Architecture

### 2.1 Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (Next.js 14, React, TailwindCSS)                        │
│ - page.tsx: central state, handleRun, handleSaveFile, ...        │
│ - Components: Sidebar, BacktestSettings, StrategyEditor,         │
│   ResultsView, StrategyViewChart, LogPanel, FaqModal, ...         │
│ - lib/api.ts: HTTP/SSE to backend                                │
│ - lib/firestore.ts: Firestore CRUD                               │
│ - lib/strategyParams.ts: parseStrategyParams, parseViewParams    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (fetch), SSE (stream=1)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND (FastAPI, Python 3.11+)                                  │
│ - api/run.py: POST /api/run (streaming)                          │
│ - api/view.py: POST /api/view (OHLC + markers/lines/zones)        │
│ - api/data.py: GET /api/data (instruments)                        │
│ - api/chart.py: POST /api/chart (PNG)                             │
│ - services/runner.py: Docker orchestration, _run_module_outputs  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ docker run (--network none, -v mounts)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ DOCKER (backtest-engine image)                                   │
│ - engine.py: load strategy, load data, run Backtrader, print JSON │
│ - Env: STRATEGY_PATH, DATA_FILE, STRATEGY_PARAMS, ...            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, React, TailwindCSS, Monaco Editor, Plotly, TradingView Lightweight Charts |
| Backend | FastAPI, uvicorn |
| Backtest | Backtrader, pandas (inside Docker) |
| Data | Firebase Firestore (strategies, indicators, modules, results), CSV/parquet (OHLC) |
| Docker | python:3.11-slim, backtrader, pandas |
| Chart PNG | mplfinance |

---

## 3. Project Structure (Key Paths)

```
Backtesting_app/
├── frontend/
│   ├── app/page.tsx              # Main page, state, handleRun, handleSaveFile
│   ├── components/
│   │   ├── Sidebar.tsx           # Left panel: type selector, items, files
│   │   ├── MainView.tsx          # List of strategies/indicators/modules
│   │   ├── BacktestSettings.tsx  # Right panel: Instrument, Params, Run
│   │   ├── editor/StrategyEditor.tsx
│   │   ├── results/ResultsView.tsx, StatBlocks, TradesTable, TradeHighlight, RunHistory
│   │   ├── charts/DetailedChart, EquityChart, ModuleOutputChart, ...
│   │   ├── StrategyViewChart.tsx # View mode chart
│   │   ├── FaqModal.tsx
│   │   └── ...
│   └── lib/
│       ├── api.ts                # runBacktestStreaming, getViewData, getAvailableData
│       ├── firestore.ts          # listItems, createItem, getFiles, saveFile, saveBacktestResult
│       ├── firebase.ts
│       └── strategyParams.ts     # parseStrategyParams, parseViewParams
├── backend/
│   ├── app/main.py
│   ├── app/api/run.py, view.py, data.py, chart.py
│   ├── app/services/runner.py    # run_strategy_streaming, _run_module_outputs
│   └── docker/engine.py          # Runs inside container
├── shared/types/index.ts         # RunRequest, RunResponse, DataInstrument, Trade, ...
└── data/mock/                    # OHLC CSV/parquet files
```

---

## 4. State and Data Flow

### 4.1 Main State (page.tsx)

| State | Purpose |
|-------|---------|
| `selectedType` | "strategies" \| "indicators" \| "modules" |
| `openItem` | { type, id, name } – currently open strategy/indicator/module |
| `files` | List of files in openItem |
| `selectedFile` | Active file (e.g. "main.py", "indicator:xyz", "module:abc") |
| `fileContent`, `lastSavedContent` | Editor content, comparison for Save button |
| `instruments`, `selectedInstrument` | From GET /api/data |
| `indicators`, `modules` | From Firestore listItems |
| `selectedIndicatorIds`, `selectedModuleIds` | Checkbox selection |
| `appliedIndicatorIds`, `appliedModuleIds` | After "Potvrdit" (Confirm) |
| `backtestParams` | instrumentType, tickSize, valuePerTick, initialCapital, slippagePerc, ... |
| `strategyParams`, `moduleParams` | From PARAMS/VIEW_PARAMS parsing |
| `results` | RunResponse after backtest |
| `runHistory` | SavedBacktestRun[] from Firestore |
| `viewMode` | true = View chart, false = Editor |
| `logs` | Log lines from SSE |

### 4.2 Critical Flows

**Flow: Create new strategy**
1. User clicks "Vytvořit strategii" → `handleCreateItem("strategies", name)`
2. `createItem` → Firestore `addDoc` + `setDoc` for `main.py` with `DEFAULT_STRATEGY_CONTENT`
3. `loadItems("strategies")` refreshes list

**Flow: Run backtest**
1. `handleRun` checks: openItem?.type === "strategies", main.py exists, selectedInstrument
2. Builds `allFiles`: strategy files + `indicators/{Name}.py` for applied indicators + `modules/{Name}.py` for applied modules
3. `runBacktestStreaming(request, abortSignal, onEvent)` → SSE
4. On `result` event: `setResults(data)`, `setShowResults(true)`
5. `saveBacktestResult(strategyId, strategyName, payload)` → Firestore
6. `listBacktestResults(strategyId)` → `setRunHistory`

**Flow: View mode**
1. User toggles View → `setViewMode(true)`
2. `StrategyViewChart` receives `initialItemId`, `initialItemType` (module/indicator/strategy)
3. Fetches code via `getFileContent(type, id, "main.py")`
4. `getViewData(dataFile, years, code, params)` → POST /api/view
5. Backend: loads OHLC, execs module code, calls `detect`/`get_line`/`get_zones`, returns markers/lines/zones
6. Chart renders OHLC + markers + lines + zones

**Flow: Module outputs in Results**
1. Run request includes `applied_modules: [{ id, name, params }]`
2. Runner after engine completes: `_run_module_outputs(run_dir, ohlc, applied_modules)`
3. For each module: import from `modules/{Name}.py`, call `detect`/`get_line`/`get_zones` on OHLC DataFrame
4. Returns `moduleOutputs: { "ModuleName": { markers, lines, zones } }`
5. Frontend `ResultsView` → `ModuleOutputChart` for each module

---

## 5. API Contracts

### 5.1 POST /api/run

**Request (RunRequest):**
```json
{
  "files": { "main.py": "...", "indicators/EMA.py": "...", "modules/Swing_HL.py": "..." },
  "instrument": "NQ",
  "timeframe": "1d",
  "years": 1,
  "data_file": "mock/NQ_5Y.csv",
  "initial_capital": 100000,
  "slippage_perc": 0.001,
  "instrument_type": "futures",
  "tick_size": 0.25,
  "value_per_tick": 5,
  "params": { "sma_fast": 20, "module_params": { "Swing HL": { "timeframe": "1d" } } },
  "applied_modules": [{ "id": "...", "name": "Swing HL", "params": { "timeframe": "1d" } }]
}
```

**Response (RunResponse):**
```json
{
  "equity": [100000, 100500, ...],
  "equityCurve": [{ "date": "2024-01-01", "value": 100000 }, ...],
  "metrics": { "finalEquity", "sharpeRatio", "maxDrawdown", "tradeCount", "winRate", ... },
  "trades": [{ "entryDate", "exitDate", "type", "size", "pnl", "entryPrice", "exitPrice" }, ...],
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "moduleOutputs": {
    "Swing HL": {
      "markers": [{ "date", "type": "high"|"low"|"signal", "value" }, ...],
      "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
      "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
    }
  }
}
```

**SSE (stream=1):** `data: {"type":"log","line":"..."}`, `{"type":"progress","value":50}`, `{"type":"result","data":RunResponse}`, `{"type":"error","message":"..."}`

### 5.2 POST /api/view

**Request:**
```json
{
  "data_file": "mock/NQ_5Y.csv",
  "years": 1,
  "module_code": "def detect(ohlc, params=None): ...",
  "params": { "period": 20 }
}
```

**Response:**
```json
{
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "markers": [{ "date", "type", "value" }, ...],
  "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
  "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
}
```

Backend executes `module_code` in temp file, checks `hasattr(mod, "detect")`, `hasattr(mod, "get_line")`, `hasattr(mod, "get_zones")`, calls with `(df, params)` if signature has 2+ params.

### 5.3 GET /api/data

**Response:**
```json
{
  "instruments": [{
    "instrument": "NQ",
    "timeframe": "1d",
    "file": "mock/NQ_5Y.csv",
    "minDate", "maxDate", "yearsAvailable",
    "instrumentType": "futures",
    "brokerConfig": { "tick_size", "tick_value", "mult", "margin" }
  }]
}
```

---

## 6. Module/Indicator Interface

### 6.1 Functions (View + Results)

| Function | Purpose | Return format |
|----------|---------|---------------|
| `detect(ohlc, params=None)` | Point markers | `[{"date":"YYYY-MM-DD","type":"high"\|"low"\|"signal","value":float}, ...]` |
| `get_line(ohlc, params=None)` | Lines | `{"EMA20":[{"date","value"},...]}` or `{"EMA20":{"data":[...],"color":"#hex"}}` |
| `get_zones(ohlc, params=None)` | Rectangles | `[{"date_start","date_end","value_low","value_high","fillcolor"?, "name"?}, ...]` |

- `type`: "high"=green, "low"=red, "signal"=blue
- Backend uses `inspect.signature` to decide `fn(df)` vs `fn(df, params)`

### 6.2 VIEW_PARAMS

- Dict in code: `VIEW_PARAMS = {"period": 20, "color": "#3b82f6"}`
- Parsed by `parseViewParams(code)` in `strategyParams.ts`
- Sent to POST /api/view as `params`
- Supported types: number, boolean, string

### 6.3 Naming for Imports

- Indicator "EMA 20" → `indicators/EMA_20.py` → `from indicators.EMA_20 import MyIndicator`
- Module "Swing HL" → `modules/Swing_HL.py` → `from modules.Swing_HL import detect, get_swings`
- Conversion: spaces/special chars → underscore, `toModuleName` in runner

---

## 7. Firestore Structure

```
/strategies/{strategyId}
  - name, tag, createdAt
  /files/{fileName}  → fileName, content
  /results/{backtestId}  → strategyName, savedAt, equityCurve, metrics, trades

/indicators/{indicatorId}
  - name, tag, createdAt
  /files/main.py

/modules/{moduleId}
  - name, tag, createdAt
  /files/main.py
```

**Key functions:** `listItems`, `createItem`, `getFiles`, `getFileContent`, `saveFile`, `createFile`, `saveBacktestResult`, `listBacktestResults`, `deleteBacktestResult`, `deleteAllBacktestResults`

---

## 8. Runner Logic (runner.py)

1. `run_strategy_streaming` receives RunRequest
2. `_prepare_strategy_files`: write files to `.backtest_run/`, create `indicators/__init__.py`, `modules/__init__.py`
3. `subprocess` Docker: mount `.backtest_run` → `/app/strategy`, `data` → `/app/data`
4. Read stdout (JSON result), stderr (PROGRESS:X)
5. If `applied_modules`: `_run_module_outputs` – for each module, import from `modules/{Name}.py`, call detect/get_line/get_zones on OHLC, merge into `moduleOutputs`
6. Stream events to client
7. Cleanup `.backtest_run/*.py`

---

## 9. Engine Logic (docker/engine.py)

1. Read env: STRATEGY_PATH, DATA_FILE, STRATEGY_PARAMS (JSON), INITIAL_CAPITAL, SLIPPAGE_PERC, INSTRUMENT_TYPE, TICK_SIZE, VALUE_PER_TICK, ...
2. `load_strategy`: import module, find first class inheriting `bt.Strategy`
3. `load_data`: read CSV/parquet, normalize columns, filter by years
4. `run_backtest`: Cerebro, add data, strategy, analyzers; set broker; run
5. Record equity per bar, trades via notify_trade/notify_order
6. Print JSON to stdout, PROGRESS:100 to stderr

---

## 10. Default Content (firestore.ts)

- **Strategies:** `DEFAULT_STRATEGY_CONTENT` – bt.Strategy template with PARAMS
- **Indicators:** `DEFAULT_INDICATOR_CONTENT` – bt.Indicator + get_line (EMA), VIEW_PARAMS, docstring guide
- **Modules:** `DEFAULT_MODULE_CONTENT` – detect (3-bar pivot), get_line (empty), VIEW_PARAMS, docstring guide

Used in `createItem` when creating new strategy/indicator/module.

---

## 11. Where to Make Changes

| Change | File(s) |
|--------|---------|
| Add new API endpoint | `backend/app/main.py`, new file in `api/` |
| Change Run request/response | `shared/types/index.ts`, `backend/app/models/run.py` |
| Change View logic | `backend/app/api/view.py` |
| Change module output format | `backend/app/services/runner.py` `_run_module_outputs`, `view.py` |
| Add UI component | `frontend/components/` |
| Change default strategy/indicator/module content | `frontend/lib/firestore.ts` |
| Change param parsing | `frontend/lib/strategyParams.ts` |
| Add FAQ item | `frontend/components/FaqModal.tsx` |

---

## 12. Instrument Types

| Type | UI params | Data path |
|------|-----------|-----------|
| futures | tick_size, value_per_tick | mock/*.csv, mock/futures/*.csv |
| stocks | share_size | mock/stocks/*.csv |
| forex | lot_size, pip_size, pip_value | mock/forex/*.csv |

`filterInstrumentsByType(instruments, instrumentType)` filters by `instrumentType` from API.

---

## 13. Error Handling

- **AbortError:** User clicked Stop → `handleStopRun` aborts fetch
- **Backend error:** SSE `{"type":"error","message":"..."}` → thrown, caught, logged
- **Firestore permission:** "Missing or insufficient permissions" → check firestore.rules, deploy
- **Docker not running:** Run fails, log shows connection error

---

## 14. Dependencies Between Components

```
page.tsx
  ├── Sidebar (openItem, items, files, selectedFile, ...)
  ├── BacktestSettings (instruments, params, onRun, indicators, modules, ...)
  ├── StrategyEditor (fileContent, onChange)
  ├── ResultsView (results, runHistory, ...)
  ├── StrategyViewChart (when viewMode)
  ├── LogPanel (logs)
  ├── FaqModal (isFaqOpen)
  └── LoadingOverlay (when isRunning)

BacktestSettings
  └── Uses parseStrategyParams, parseViewParams for param tabs

StrategyViewChart
  └── getViewData (api.ts) → POST /api/view
  └── getFileContent (firestore) for module/indicator code

handleRun
  └── runBacktestStreaming (api.ts) → POST /api/run?stream=1
  └── saveBacktestResult (firestore)
```

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| Strategy | Python file with bt.Strategy class, main trading logic |
| Indicator | Reusable bt.Indicator, optional get_line for View |
| Module | Utility (detect, get_swings, ...), used by strategy, has detect/get_line/get_zones for View/Results |
| Applied | Indicator/module selected + confirmed ("Potvrdit") – included in Run |
| View mode | Chart with OHLC + module output, no backtest |
| Run history | Saved backtest results in Firestore under strategy |
| PARAMS | Strategy parameters dict, parsed for Parameter Panel |
| VIEW_PARAMS | Module/indicator params for View mode, parsed for View params drawer |

---

*End of READMEAI.md. Use this document as the primary reference when modifying or extending the Backtesting Platform.*
