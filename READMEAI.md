# Backtesting Platform – AI/Bot Reference

**Purpose:** This document enables any AI model or bot to understand the application in detail: architecture, data flow, workflows, logic, technologies, and where to make changes. Read this file first when working with the codebase.

**Documentation set (repo root):**

| File | Role |
|------|------|
| `READMEADAM.md` | Human UI/feature map + workflow (keep in sync with `backtestFieldMeta.ts` + `guideContent.ts`). |
| `README.md` | Full technical + API + project structure. |
| `READMEAI.md` | This file — AI/dev contracts and change locations. |
| `SCRIPTS.md` | Run commands (Docker, uvicorn, npm). |

When adding UX, update **READMEADAM.md**, **`frontend/data/guideContent.ts`**, and **`frontend/components/backtestFieldMeta.ts`** together; bump **README.md** sections if behavior/API changes.

**Language:** Czech and English mixed (matches codebase). Key terms are consistent.

> **Important update (2026-03):** System now includes API auth/rate-limit, sandboxed `/api/view`, append-only audit events, deterministic run fingerprinting in manifest, Firestore owner/role rules with soft-delete, and compare/lifecycle governance in Run history.

---

## 1. Quick Reference for AI

### 1.1 What This App Does

- **Backtesting platform** – users write Python strategies (Backtrader), run backtests on historical OHLC data in an isolated Docker container, view results (equity, trades, metrics, module outputs).
- **Strategies, Indicators, Modules** – stored in Firebase Firestore. Strategies can import indicators and modules.
- **View mode** – preview module/indicator output (markers, lines, zones) on a chart without running backtest.
- **Run history** – each successful Run is auto-saved to Firestore under the strategy.
- **Governance layer** – experiment lifecycle (`draft/review/approved/promoted`), reviewer sign-off, compare workspace.

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
Docker engine (`engine.py`) → _run_module_outputs_in_engine() → moduleOutputs in response
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
│   ResultsView, StrategyViewChart, LogPanel, FieldHelpPopover, ... │
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
│ - api/view.py: POST /api/view (Docker-sandboxed execution)        │
│ - api/data.py: GET /api/data (instruments)                        │
│ - api/chart.py: POST /api/chart (PNG)                             │
│ - services/runner.py: Docker orchestration, streaming            │
│ - security.py: auth + rate limiting dependency                    │
│ - services/audit.py: append-only audit log                        │
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
│   ├── app/guide/page.tsx        # A-Z user guide page
│   ├── components/
│   │   ├── Sidebar.tsx           # Left panel: type selector, items, files
│   │   ├── MainView.tsx          # List of strategies/indicators/modules
│   │   ├── BacktestSettings.tsx  # Right panel: collapsible Basic/Instrument config/Simulation/Indicators&Modules/Parameters/Run
│   │   ├── editor/StrategyEditor.tsx
│   │   ├── results/ResultsView.tsx, StatBlocks, TradeHighlight, RunHistory, AnalyticsView
│   │   ├── charts/DetailedChart, EquityChart, ModuleOutputChart, ...
│   │   ├── StrategyViewChart.tsx # View mode chart
│   │   ├── FieldHelpPopover.tsx
│   │   └── ...
│   └── lib/
│       ├── api.ts                # runBacktestStreaming, getViewData, getAvailableData
│       ├── firestore.ts          # CRUD + soft-delete + run governance update
│       ├── firebase.ts
│       ├── strategyParams.ts     # parseStrategyParams, parseViewParams
│       └── overfittingSignals.ts # assessOverfitting + readiness (AnalyticsView, RunHistory)
├── backend/
│   ├── app/main.py
│   ├── app/security.py
│   ├── app/api/run.py, view.py, data.py, chart.py
│   ├── app/services/runner.py    # run_strategy_streaming, _run_module_outputs, manifest metadata
│   ├── app/services/audit.py     # append-only audit events
│   ├── docker/engine.py          # Runs inside container
│   └── docker/view_engine.py     # sandbox execution for /api/view
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
| `backtestParams` | instrumentType, tickSize, valuePerTick, initialCapital, slippagePerc, commissionPerc, ... |
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
2. Auto-detects imports from `main.py` (`from indicators.X`, `from modules.Y`) and preselects matching items (user can still edit checkboxes)
3. Builds `allFiles`: strategy files + `indicators/{Name}.py` for selected indicators + `modules/{Name}.py` for selected modules
4. `runBacktestStreaming(request, abortSignal, onEvent)` → SSE
5. On `result` event: `setResults(data)`, `setShowResults(true)`
6. `saveBacktestResult(strategyId, strategyName, payload)` → Firestore
7. `listBacktestResults(strategyId)` → `setRunHistory`

**Flow: View mode**
1. User toggles View → `setViewMode(true)`
2. `StrategyViewChart` receives `initialItemId`, `initialItemType` (module/indicator/strategy)
3. Fetches code via `getFileContent(type, id, "main.py")`
4. `getViewData(dataFile, years, code, params)` → POST /api/view
5. Backend: loads OHLC, execs module code, calls `detect`/`get_line`/`get_zones`, returns markers/lines/zones
6. Chart renders OHLC + markers + lines + zones

**Flow: Module outputs in Results**
1. Run request includes `applied_modules: [{ id, name, params }]`
2. Engine computes `moduleOutputs` in-container via `_run_module_outputs_in_engine(...)`
3. For each module: import from `modules/{Name}.py`, call `detect`/`get_line`/`get_zones` on OHLC DataFrame
4. Returns `moduleOutputs: { "ModuleName": { markers, lines, zones } }`
5. Frontend `ResultsView` → `ModuleOutputChart` for each module

---

## 5. API Contracts

### 5.0 Security contract (all `/api/*`)

- Client sends `X-API-Key` (or Bearer token) matching `API_AUTH_KEY` when set.
- **Local dev:** if `API_AUTH_REQUIRED` is true but `API_AUTH_KEY` is **not** set and the client IP is `127.0.0.1` / `::1`, backend accepts the request with `auth_method=local_dev_auto` (`backend/app/security.py`).
- Frontend: `NEXT_PUBLIC_API_AUTH_KEY` → `frontend/lib/api.ts` sends `X-API-Key`.
- Optional `X-Actor-Id` is sanitized and forwarded for lineage/audit.
- Backend applies in-memory rate limiting per client key.
- Relevant envs: `API_AUTH_REQUIRED`, `API_AUTH_KEY`, `API_ALLOW_DEV_BYPASS`, `API_RATE_LIMIT_MAX_REQUESTS`, `API_RATE_LIMIT_WINDOW_SEC`.

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
  "commission_perc": 0.0002,
  "instrument_type": "futures",
  "tick_size": 0.25,
  "value_per_tick": 5,
  "params": { "sma_fast": 20, "module_params": { "Swing HL": { "timeframe": "1d" } } },
  "applied_modules": [{ "id": "...", "name": "Swing HL", "params": { "timeframe": "1d" } }],
  "run_id": "run_20260318_abc123",
  "validation_mode": "walk_forward",
  "validation_config": { "folds": 4, "test_ratio": 0.2 },
  "quality_gates": { "min_trades": 30, "max_dd": 25, "min_pf": 1.2, "min_sortino": 0.5 },
  "sweep_mode": "random",
  "sweep_config": { "max_samples": 24, "param_ranges": { "risk_pct": { "min": 0.5, "max": 2.0 } } },
  "monte_carlo": { "simulations": 300, "ruin_dd_pct": 50, "mode": "iid_trade" },
  "regime_config": { "enabled": true },
  "portfolio_config": { "instruments": [] },
  "execution_model": { "enabled": true, "spread_bps": 0.5, "slippage_vol_mult": 1.0, "latency_bars": 0 },
  "batch_config": {
    "batch_id": "batch_abc",
    "max_runs": 8,
    "items": [{ "instrument": "NQ", "data_file": "mock/NQ_5Y.csv", "timeframe": "1d" }]
  },
  "experiment": {
    "hypothesis": "edge-test",
    "tags": ["manual-run"],
    "runDiff": {
      "totalReturnUsd": { "current": 1500, "baseline": 900, "delta": 600, "deltaPct": 66.6667 }
    },
    "promoteEvidence": { "gatePassed": true, "promoteRequested": true, "stabilityScore": 0.61, "promote": true },
    "promoteDecision": "review_candidate",
    "seed": 42
  }
}
```

`promoteDecision` is constrained in UI to **`review_candidate`** | **`hold`** (not free-form strings).

**`experiment.seed`:** optional integer; `runner.py` passes it as Docker `RUN_SEED` so `engine.py` can `random.seed(...)` for Monte Carlo, sweep sampling, and block-bootstrap starts. UI toggle *Fixní run seed* sets this; if omitted, runner generates a random seed. Batch sub-runs inherit the same parent seed (each subprocess still deterministic for that seed).

**`batch_config`:** when present with non-empty `items`, `run.py` runs a **sequence** of Docker jobs (`_merge_batch_sub_request` merges each item into a copy of the base request, clears nested `batch_config` on sub-requests). Final streamed/non-stream response includes **`batchSummary`** (`batchId`, `runCount`, `runs[]`, `multipleTestingWarning`). Do not combine with `portfolio_config` in UI (client warns).

**Overfitting / readiness:** `frontend/lib/overfittingSignals.ts` centralizes heuristic rules consumed by **Analytics** (warnings list + severity score) and **Run history** (ready / caution / not_ready). Not a statistical test—only guides human review.

**Repro ZIP:** `ResultsView` uses dynamic `fflate` import; bundle includes manifest, trimmed JSON summary, and editor snapshot of `main.py` (see `handleReproBundle`).

**Response (RunResponse):**
```json
{
  "equity": [100000, 100500, ...],
  "equityCurve": [{ "date": "2024-01-01T00:00:00", "value": 100000 }, ...],
  "metrics": { "finalEquity", "maxEquity", "sharpeRatio", "maxDrawdown", "maxDrawdownPct", "maxDrawdownUsd", "commissionPerc", "tradeCount", "winRate", ... },
  "trades": [{ "entryDate", "exitDate", "type", "size", "pnl", "entryPrice", "exitPrice", "mfe", "mae", "mfePct", "maePct" }, ...],
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "moduleOutputs": {
    "Swing HL": {
      "markers": [{ "date", "type": "high"|"low"|"signal", "value" }, ...],
      "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
      "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
    }
  },
  "validation": { "mode": "walk_forward", "folds": [], "summary": {} },
  "robustness": { "mode": "random", "tested": 24, "stabilityScore": 0.62, "results": [], "heatmap": {} },
  "monteCarlo": { "simulations": 300, "method": "trade_pnl_bootstrap", "mode": "iid_trade", "note": "...", "drawdownPct": {}, "endingEquity": {}, "riskOfRuin": 0.12 },
  "regimeAnalysis": { "regimes": {}, "sessions": {} },
  "portfolio": null,
  "executionSummary": { "enabled": true, "spreadBps": 0.5, "latencyBars": 0, "totalFees": 123.4, "totalSlippageCost": 89.1, "costAttribution": {}, "forwardBridge": { "mode": "paper_shadow", "driftPct": 1.2 } },
  "qualityGate": { "passed": true, "checks": [] },
  "experiment": { "hypothesis": "edge-test", "tags": ["manual-run"] }
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
  "params": { "period": 20 },
  "chart_timeframe": null
}
```

**`chart_timeframe`:** `null` / omit / `"native"` = use source bar size. Otherwise resample OHLC on the server before chart + module (`1m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `1D`, `1W`, `1Mo`) — must be **coarser** than inferred native bar spacing (median delta, gaps &lt; 48h ignored). Implemented in `view.py` and `docker/view_engine.py` (pandas `resample`).

**Response:**
```json
{
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "markers": [{ "date", "type", "value" }, ...],
  "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
  "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
}
```

Backend executes `module_code` in Docker sandbox (`view_engine.py`), checks `hasattr(mod, "detect")`, `hasattr(mod, "get_line")`, `hasattr(mod, "get_zones")`, calls with `(df, params)` if signature has 2+ params.

### 5.3 GET /api/data

**Response:**
```json
{
  "instruments": [{
    "instrument": "NQ",
    "displayName": "Nasdaq-100 E-mini",
    "timeframe": "1d",
    "file": "mock/NQ_5Y.csv",
    "minDate", "maxDate", "yearsAvailable",
    "instrumentType": "futures",
    "brokerConfig": { "tick_size", "tick_value", "mult", "margin" }
  }]
}
```

Intraday futures live under `data/futures_30m/*.txt` (one row per bar: `MM/DD/YYYY,HH:MM,O,H,L,C,V`); API returns `timeframe: "30m"` and `file` like `futures_30m/NQ.txt`.

**GET /api/data/debug:** `data_dir`, `mock_exists`, `futures_30m_exists`, `csv_count`, `txt_count`, `csv_files`, `txt_files`.

### 5.3a Metrics / Monte Carlo notes for AI

- **`profitFactor`:** engine may use a sentinel when there are no losing trades; UI shows ∞/N/A; sweep scoring caps PF to avoid sentinel skew.
- **`riskOfRuin` (Monte Carlo):** interpret as **bootstrap estimate** from resampled trade (or block) PnL, not a structural market probability. Always read `monteCarlo.method`, `monteCarlo.mode`, `monteCarlo.note`.
- **Run history table:** primary R column is **expectancy in R** (`expectancyR`); legacy payloads may still expose `rMultiple` — prefer `expectancyR` when present.

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
- **Při backtestu:** Parameters panel má záložky Strategie | [Modul 1] | [Modul 2]. Každá záložka modulu zobrazuje VIEW_PARAMS daného modulu – lze upravit před Run. Hodnoty jdou do `module_params` v requestu.
- Supported types: number, boolean, string

### 6.3 Swing HL Module (complete interface)

| Feature | Strategy API | View/Results |
|---------|--------------|--------------|
| Swing H/L | `get_swings(ohlc, params)` | `detect()` – markers |
| Internal H/L | `get_swings(..., include_internals=True)` | `detect()` – internal_high/low |
| BOS | `get_bos(ohlc, params)` | `get_zones()` |
| Trend | `get_trend(ohlc, params)` → `{score, state}` | `get_line()` – colored trend line |

Strategy passes `params.module_params["Swing HL"]` to module functions.

### 6.4 Naming for Imports

- Indicator "EMA 20" → `indicators/EMA_20.py` → `from indicators.EMA_20 import MyIndicator`
- Module "Swing HL" → `modules/Swing_HL.py` → `from modules.Swing_HL import detect, get_swings, get_bos, get_trend`
- Conversion: spaces/special chars → underscore, `toModuleName` in runner

---

## 7. Firestore Structure

```
/strategies/{strategyId}
  - name, tag, createdAt, ownerUid
  /files/{fileName}  → fileName, content
  /results/{backtestId}  → strategyName, savedAt, equityCurve, metrics, trades, deletedAt?, deletedBy?, deleteReason?

/indicators/{indicatorId}
  - name, tag, createdAt
  /files/main.py

/modules/{moduleId}
  - name, tag, createdAt
  /files/main.py
```

**Key functions:** `listItems`, `createItem`, `getFiles`, `getFileContent`, `saveFile`, `createFile`, `saveBacktestResult`, `listBacktestResults`, `deleteBacktestResult` (soft-delete), `deleteAllBacktestResults` (soft-delete), `updateBacktestRunGovernance`

**Governance patch:** `updateBacktestRunGovernance` uses Firestore **dot-path merge** into nested `experiment.*` fields. Client should only send **whitelisted** governance keys (see `frontend/lib/firestore.ts`). **Phase 6b (server-only approvals):** enforcing reviewer rules requires Cloud Functions or a trusted backend proxy—not client-only Firestore writes.

---

## 8. Runner Logic (runner.py)

1. `run_strategy_streaming` receives RunRequest
2. `_prepare_strategy_files`: write files to `.backtest_run/`, create `indicators/__init__.py`, `modules/__init__.py`
3. `subprocess` Docker: mount `.backtest_run` → `/app/strategy`, `data` → `/app/data`
4. Read stdout (JSON result), stderr (PROGRESS:X)
5. If `applied_modules`: `engine.py` runs `_run_module_outputs_in_engine` and merges `moduleOutputs` into the final result
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
| Change auth/rate limiting | `backend/app/security.py`, `backend/app/main.py` |
| Change audit events | `backend/app/services/audit.py`, `backend/app/api/run.py`, `backend/app/api/view.py` |
| Change module output format | `backend/app/services/runner.py` `_run_module_outputs`, `view.py` |
| Add UI component | `frontend/components/` |
| Change default strategy/indicator/module content | `frontend/lib/firestore.ts` |
| Change param parsing | `frontend/lib/strategyParams.ts` |
| Change guide content | `frontend/data/guideContent.ts`, `frontend/app/guide/page.tsx` |
| Change field popovers | `frontend/components/backtestFieldMeta.ts` |
| Change readiness/overfitting rules | `frontend/lib/overfittingSignals.ts` (AnalyticsView + RunHistory) |
| Change repro ZIP contents | `frontend/components/results/ResultsView.tsx` |
| User-facing feature map | `READMEADAM.md` (keep aligned with guide + popovers) |

---

## 12. Instrument Types

| Type | UI params | Data path |
|------|-----------|-----------|
| futures | tick_size, value_per_tick | mock/*.csv, mock/futures/*.csv, futures_30m/*.txt |
| stocks | share_size | mock/stocks/*.csv |
| forex | lot_size, pip_size, pip_value | mock/forex/*.csv |

`filterInstrumentsByType(instruments, instrumentType)` filters by `instrumentType` from API.

---

## 13. Error Handling

- **AbortError:** User clicked Stop → `handleStopRun` aborts fetch
- **401 Unauthorized:** missing/invalid API key or bearer token
- **429 Too Many Requests:** rate limit exceeded
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
  ├── Link to /guide (help entrypoint)
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

## 16. Documentation maintenance

- **Single source of truth for UI labels/help:** `backtestFieldMeta.ts` (popovers), `guideContent.ts` + `/guide` (narrative), `READMEADAM.md` (inventory).
- **Single source for API shapes:** `shared/types/index.ts`, `backend/app/models/run.py`, this file §5.
- **Operators:** `SCRIPTS.md` for local run; `README.md` §11–14 for env and Firestore.

---

*End of READMEAI.md. Use this document as the primary reference when modifying or extending the Backtesting Platform.*
