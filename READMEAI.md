# Backtesting Platform – AI/Bot Reference

**Purpose:** This document enables any AI model or bot to understand the application in detail: architecture, data flow, workflows, logic, technologies, and where to make changes. Read this file first when working with the codebase.

**Documentation set (repo root):**

| File | Role |
|------|------|
| `READMEADAM.md` | Human UI/feature map + workflow (keep in sync with `backtestFieldMeta.ts` + `guideContent.ts`). |
| `README.md` | Full technical + API + project structure. |
| `READMEAI.md` | This file — AI/dev contracts and change locations. |
| `SCRIPTS.md` | Run commands (uvicorn, npm, pytest). |
| `audit/` | **Code audit / review outputs** — when performing any audit or systematic code review, **write and save artifacts here** (see `audit/README.md`). Do not confuse with **`.audit/`** (append-only `events.jsonl`). |

When adding UX, update **READMEADAM.md**, **`frontend/data/guideContent.ts`**, and **`frontend/components/backtestFieldMeta.ts`** together; bump **README.md** sections if behavior/API changes.

**Rule — audits:** Any audit, code review, or structured code inspection should produce files under **`audit/`** (named clearly, e.g. with date + topic). See **`audit/README.md`**.

**Language:** Czech and English mixed (matches codebase). Key terms are consistent.

> **Important update (2026-03):** System now includes API auth/rate-limit, sandboxed `/api/view`, append-only audit events, deterministic run fingerprinting in manifest, Firestore owner/role rules with soft-delete, and compare/lifecycle governance in Run history. **DS audit (2026-03):** Bootstrap 95 % CI (mean PnL, total return, trade Sharpe), payoff decomposition (edge equation, Kelly fraction), trial count tracking with Bonferroni α correction, param test train-only mode with holdout evaluation, new metrics (`payoffRatio`, `edgePerTrade`, `kellyFraction`). **Prop firm audit (2026-03):** `_compute_prop_red_flags` in engine — automatic scan for suspicious patterns (high Sharpe + few trades, no losses, too-smooth equity, concentrated PnL, …); `propRedFlags` in RunResponse with `trustLevel` (not_trustworthy / low_trust / cautious / acceptable); trust banner in ResultsView + detailed flags in AnalyticsView; "Prop conservative" preset; stress multiplier UI; "Not a broker" disclaimer. **Performance audit (2026-03):** In-process engine default ON (no subprocess fork); lightweight mode for sub-runs (skip bootstrap CI, drawdown analysis, PnL distribution, OHLC); in-memory result cache (256 slots, keyed by code_digest+params+data); fast dataset fingerprint (mtime+size, no full SHA-256); vectorized OHLC/equity export; server-side OHLC bar cap (MAX_OHLC_EXPORT_BARS=8000). **Trader audit (2026-03):** "Reality check" warning banner in ResultsView (few trades, execution off, single run, PnL concentration >60%); underwater equity chart (DD% timeline + % bars underwater); "Pessimist" execution preset (spread 2bps, slip 3×vol, latency 2 bars, stress 2×); run journal note (textarea + export to repro bundle); color-coded StatBlocks for dangerous values (DD duration, recovery, concentration, trade count). **UX audit (2026-03):** Verdict row above StatBlocks (readiness label + top warnings + run context inline); keyboard shortcuts 1–5 for result tabs; StatBlocks grouped into PnL/Risk/Activity with responsive `auto-fill` grid; methodology tips hidden by default (toggle button); param test wrapped in `<details>` when present; zone dictionary opened via click instead of hover; duplicate stat cards removed from Analytics details; manifest strip text shortened.

---

## 1. Quick Reference for AI

### 1.0 Audit artifacts (`audit/`)

- Save audit reports, review notes, and checklists under **`audit/`** at repo root whenever you run an audit or deep code review. **Index:** **`audit/README.md`** (tabulka všech reportů).
- Not the same as **`.audit/`** (machine events).
- **Seznam souborů:** vždy aktuální tabulka v **`audit/README.md`** (při novém auditu ji tam doplň).
- Doplňující technický dokument: **`docs/QUANT_AUDIT.md`** (quant/engine; mimo `audit/`).

### 1.1 What This App Does

- **Backtesting platform** – users write Python strategies (Backtrader), run backtests via a **host Python subprocess** or optional **in-process** call into the same `engine.py` logic (`RUN_INPROCESS_ENGINE=1`, see `engine_inprocess.py`). View results (equity, trades, metrics, module outputs). **Trusted single-user** local use; no container sandbox.
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
| Engine orchestration (subprocess + optional in-process) | `backend/app/services/runner.py`, `backend/app/services/engine_inprocess.py` |
| Strategy execution | `backend/docker/engine.py` (`execute_backtest_from_environ`, CLI `main`) |
| View (markers/lines from module) | `backend/app/api/view.py`, `frontend/components/StrategyViewChart.tsx` |
| Firestore CRUD | `frontend/lib/firestore.ts` |
| Shared types | `shared/types/index.ts` |

### 1.3 Data Flow Summary

```
User → page.tsx (state) → Firestore (strategies/indicators/modules)
                       → API (run, view, data, chart)
Backend → runner.py → subprocess `python …/docker/engine.py` → stdout JSON
Engine (`engine.py`) → _run_module_outputs_in_engine() → moduleOutputs in response
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
│ - api/view.py: POST /api/view (subprocess view_engine.py)          │
│ - api/data.py: GET /api/data (instruments)                        │
│ - api/chart.py: POST /api/chart (PNG)                             │
│ - services/runner.py: engine subprocess or in-process, streaming     │
│ - services/engine_inprocess.py: optional RUN_INPROCESS_ENGINE path │
│ - security.py: auth + rate limiting dependency                    │
│ - services/audit.py: append-only audit log                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ subprocess **or** in-process (stejné env)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ENGINE (backend/docker/engine.py)                                │
│ - load strategy, load data, run Backtrader → dict / stdout JSON   │
│ - Env: STRATEGY_PATH, DATA_PATH, DATA_CACHE_PATH, HOST_DATASET_…  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, React, TailwindCSS, Monaco Editor, Plotly, TradingView Lightweight Charts |
| Backend | FastAPI, uvicorn |
| Backtest | Backtrader, pandas (host subprocess or optional in-process) |
| Data | Firebase Firestore (strategies, indicators, modules, results), CSV/parquet (OHLC) |
| Engine deps | `backend/requirements.txt` (backtrader, pandas, pyarrow, polars, numba) |
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
│   │   ├── BacktestSettings.tsx  # Right panel: collapsible Basic/Instrument config/Simulation/Indicators&Modules/Parameters/Run; Edge finding presets (Safe/Balanced/Explore/Prop conservative); stress multiplier input in Execution Model
│   │   ├── editor/StrategyEditor.tsx
│   │   ├── results/ResultsView (trust banner from propRedFlags), StatBlocks (DD Duration, Recovery, Top 5 PnL %, Payoff Ratio, Kelly %), TradeHighlight, RunHistory, AnalyticsView (DD analysis, PnL distribution, Bootstrap CI cards, Edge decomposition, Multiple testing strip, regime PnL/PF table, portfolio honest labeling, Sharpe freq strip, **prop red flags section**, **"Not a broker" disclaimer**), SdZoneAnalytics, ParamTestAnalytics (+ holdout display), QualityGateBanner
│   │   ├── charts/ModuleOutputChart (Detailed + výsledky), EquityChart, DetailedChart, ...
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
│   ├── app/services/runner.py    # run_strategy_streaming, env + telemetry, optional in-process
│   ├── app/services/engine_inprocess.py  # RUN_INPROCESS_ENGINE path (global lock)
│   ├── app/services/data_ohlc.py # Polars/numpy OHLC helpers, parquet fingerprint
│   ├── app/services/sd_feature_pipeline.py  # get_sd_zones_cached, npz cache keys
│   ├── app/services/sd_numba_exec.py   # Numba slices (research; not wired to /run)
│   ├── app/services/audit.py     # append-only audit events
│   ├── docker/engine.py          # execute_backtest_from_environ, CLI main
│   └── docker/view_engine.py     # /api/view subprocess entrypoint
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
2. Engine computes `moduleOutputs` on the host via `_run_module_outputs_in_engine(...)`
3. For each module: import from `modules/{Name}.py`, call `detect`/`get_line`/`get_zones` on OHLC DataFrame
4. Returns `moduleOutputs: { "ModuleName": { markers, lines, zones } }`
5. Frontend `ResultsView` merges `moduleOutputs` and passes them to **`ModuleOutputChart`** (Detailed tab; single Plotly chart with combined markers/lines/zones)

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
  "execution_model": { "enabled": true, "spread_bps": 0.5, "slippage_vol_mult": 1.0, "latency_bars": 0, "stress_multiplier": 1.0 },
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

**`validation_mode`:** `single` \| `oos_split` \| `walk_forward` \| **`param_test`**. For `param_test`, put budget and per-parameter ranges under `validation_config.param_test` (see `BacktestSettings` / `engine._run_param_test`); response includes `validation.paramTest` and UI shows `ParamTestAnalytics`. **Train-only mode:** set `validation_config.param_test.train_only: true` to run OAT sweep only on the training portion of data; the best parameter is then evaluated on the holdout set. Response includes `validation.paramTest.holdout` with holdout metrics. UI shows holdout results in `ParamTestAnalytics`.

**`experiment.seed`:** optional integer; `runner.py` passes it as env `RUN_SEED` so `engine.py` can `random.seed(...)` for Monte Carlo, sweep sampling, and block-bootstrap starts. UI toggle *Fixní run seed* sets this; if omitted, runner generates a random seed. Batch sub-runs inherit the same parent seed (each subprocess still deterministic for that seed).

**`batch_config`:** when present with non-empty `items`, `run.py` runs sequential or parallel `run_strategy` calls (`BATCH_PARALLEL_WORKERS`, default 1). Each call uses subprocess **or** in-process engine per `RUN_INPROCESS_ENGINE`. With in-process, a **global lock** serializes engine runs — parallel batch workers do not speed up wall time (see architecture plan Phase 6). `_merge_batch_sub_request` merges each item into a copy of the base request, clears nested `batch_config` on sub-requests. Final streamed/non-stream response includes **`batchSummary`** (`batchId`, `runCount`, `runs[]`, `multipleTestingWarning`). Do not combine with `portfolio_config` in UI (client warns).

**Runner env (subset):** `HOST_DATASET_FINGERPRINT` (dataset cache key for `sd_zone_strategy` disk cache), `SD_ZONE_DISK_CACHE`, `RUN_INPROCESS_ENGINE`, optional `INPROCESS_ENGINE_DIGESTS` (whitelist of `CODE_DIGEST` hex values). Manifest after normalize may include `runnerHostPrepareMs`, `runnerEngineWallMs`, `engineExecutionMode` = `inprocess`.

**Overfitting / readiness:** `frontend/lib/overfittingSignals.ts` centralizes heuristic rules consumed by **Analytics** (warnings list + severity score) and **Run history** (ready / caution / not_ready). Not a statistical test—only guides human review.

**Repro ZIP:** `ResultsView` uses dynamic `fflate` import; bundle includes manifest, trimmed JSON summary, and editor snapshot of `main.py` (see `handleReproBundle`).

**Response (RunResponse):**
```json
{
  "equity": [100000, 100500, ...],
  "equityCurve": [{ "date": "2024-01-01T00:00:00", "value": 100000 }, ...],
  "metrics": { "finalEquity", "maxEquity", "sharpeRatio", "maxDrawdown", "maxDrawdownPct", "maxDrawdownUsd", "maxDrawdownDurationBars", "maxDrawdownDurationDays", "timeToRecoveryBars", "timeToRecoveryDays", "currentDrawdownPct", "commissionPerc", "tradeCount", "winRate", "payoffRatio", "edgePerTrade", "kellyFraction", ... },
  "trades": [{ "entryDate", "exitDate", "type", "size", "pnl", "entryPrice", "exitPrice", "mfe", "mae", "mfePct", "maePct" }, ...],
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "moduleOutputs": {
    "Swing HL": {
      "markers": [{ "date", "type": "high"|"low"|"signal", "value" }, ...],
      "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
      "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
    }
  },
  "drawdownAnalysis": { "maxDurationBars": 47, "maxDurationDays": 65, "timeToRecoveryBars": 32, "timeToRecoveryDays": 44, "currentDrawdownPct": 1.8, "underwaterPct": 38.2, "avgDurationBars": 12, "periodsCount": 8 },
  "tradePnlDistribution": { "histogram": [...], "percentiles": { "p5": -420, "p25": -80, "p50": 60, "p75": 310, "p95": 820 }, "skewness": 0.42, "kurtosis": 3.1, "tailRiskCVaR": -380, "concentration": { "top5PnlPct": 42.5 } },
  "validation": { "mode": "walk_forward", "folds": [], "summary": {} },
  "robustness": { "mode": "random", "tested": 24, "stabilityScore": 0.62, "results": [], "heatmap": {} },
  "monteCarlo": { "simulations": 300, "method": "trade_pnl_bootstrap", "mode": "iid_trade", "note": "...", "drawdownPct": {}, "endingEquity": {}, "riskOfRuin": 0.12 },
  "regimeAnalysis": { "regimes": {}, "sessions": {} },
  "portfolio": null,
  "executionSummary": { "enabled": true, "spreadBps": 0.5, "latencyBars": 0, "totalFees": 123.4, "totalSlippageCost": 89.1, "costAttribution": {}, "forwardBridge": { "mode": "paper_shadow", "driftPct": 1.2 } },
  "qualityGate": { "passed": true, "checks": [] },
  "bootstrapCI": { "meanPnl": { "lo": 45.2, "hi": 210.8, "alpha": 0.05 }, "totalReturn": { "lo": 3.1, "hi": 7.8, "alpha": 0.05 }, "tradeSharpe": { "lo": 0.08, "hi": 0.42, "alpha": 0.05 }, "nBootstrap": 1000, "adjustedAlpha": 0.025, "trialCount": 2 },
  "payoffDecomposition": { "winRate": 0.60, "lossRate": 0.40, "avgWin": 310.5, "avgLoss": 180.2, "payoffRatio": 1.72, "edgePerTrade": 114.2, "kellyFraction": 0.18, "edgeEquation": "WR×AvgWin − LR×AvgLoss" },
  "overfittingSignals": { "trialCount": 2, "bonferroniAlpha": 0.025, "multipleTestingNote": "K=2 trials; α = 0.05/2" },
  "propRedFlags": {
    "trustLevel": "cautious",
    "flags": [
      { "key": "too_few_trades", "severity": "warning", "label": "Low trade count", "detail": "30 trades — below 30 is a warning for prop evaluation" }
    ],
    "criticalCount": 0,
    "warningCount": 1,
    "tip": "Enable walk-forward or OOS validation to increase credibility"
  },
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

**Module `timeframe` vs `data_timeframe` (Swing HL, S/D):** `chart_timeframe` only changes the candle series drawn in View. Structure (swings, BOS, zones) should use **`timeframe`** in `VIEW_PARAMS` as the **analysis** bar size (e.g. `1d`) while **`data_timeframe`** describes the **native** spacing of the loaded file (e.g. `30m`). `StrategyViewChart` sets `data_timeframe` from the selected instrument’s `timeframe` so modules can resample inside `get_swings` / `get_bos` without forcing analysis TF to match the file.

**Response:**
```json
{
  "ohlc": [{ "date", "open", "high", "low", "close" }, ...],
  "markers": [{ "date", "type", "value" }, ...],
  "lines": [{ "name", "data": [{ "date", "value" }], "color"?: string }, ...],
  "zones": [{ "date_start", "date_end", "value_low", "value_high", "fillcolor"?, "name"? }, ...]
}
```

Backend executes `module_code` via subprocess `view_engine.py`, checks `hasattr(mod, "detect")`, `hasattr(mod, "get_line")`, `hasattr(mod, "get_zones")`, calls with `(df, params)` if signature has 2+ params.

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

- **`profitFactor` / `profitFactorStatus`:** when there are **no losing trades**, the ratio is undefined: API returns `profitFactor: null` and e.g. `profitFactorStatus: "undefined_no_losing_trades"` (not a 999 sentinel). Sweep ranking uses an internal finite `forScoring` from `_profit_factor_detailed`. UI formats null+status and still understands legacy ~999 payloads.
- **`sharpeRatio` vs `sharpeRatioLegacyAnalyzer`:** headline Sharpe is equity-curve annualized (aligned with Sortino annualization); legacy field mirrors Backtrader's `SharpeRatio` analyzer.
- **Portfolio:** `portfolio.model` + `summary.weightedIndependent*` — weighted blends of **separate** full-capital runs per instrument; read `disclaimer`.
- **Synthetic volume:** CSV/OHLC without a volume column gets `volume=1000` plus stderr warning in engine and view paths.
- **`riskOfRuin` (Monte Carlo):** interpret as **bootstrap estimate** from resampled trade (or block) PnL, not a structural market probability. Always read `monteCarlo.method`, `monteCarlo.mode`, `monteCarlo.note`.
- **Run history table:** primary R column is **expectancy in R** (`expectancyR`); legacy payloads may still expose `rMultiple` — prefer `expectancyR` when present.
- **Drawdown duration (`drawdownAnalysis`):** `maxDrawdownDurationBars/Days` = longest peak-to-trough period; `timeToRecoveryBars/Days` = bars/days from trough back to new equity high (null if no recovery yet); `underwaterPct` = % of bars below prior equity peak; `periodsCount` = total DD episodes.
- **Trade PnL distribution (`tradePnlDistribution`):** histogram of closed PnL, percentiles (p5–p95), skewness, kurtosis, `tailRiskCVaR` (conditional value-at-risk at 5th percentile), `concentration.top5PnlPct` = share of total profit from top 5 trades. High concentration = profit depends on few outlier trades.
- **Bootstrap CI (`bootstrapCI`):** 95 % confidence intervals for mean PnL, total return, and trade-level Sharpe via **trade-level resampling** (1 000 bootstraps). `adjustedAlpha` = 0.05 / `trialCount` (naive Bonferroni for multiple testing). Assumes IID trades; serial correlation weakens coverage.
- **Payoff decomposition (`payoffDecomposition`):** edge = WR × AvgWin − LR × AvgLoss; `payoffRatio` = avg win / avg loss; `kellyFraction` = Kelly criterion for optimal bet size (assumes known probabilities and independent bets — in practice use half-Kelly or less).
- **Trial count / multiple testing (`overfittingSignals`):** `trialCount` K = sweep_samples × batch_runs × folds (≥ 1). Naive Bonferroni adjusted α = 0.05 / K. Conservative upper bound; correlated trials (similar params) have weaker true correction. UI displays awareness strip.
- **Stress multiplier (`execution_model.stress_multiplier`):** multiplies slippage/spread penalty; default 1.0; values > 1 simulate worse fill conditions (e.g. 1.5 = 50 % surcharge on friction).
- **Portfolio model (`portfolio.model`):** response includes model name (e.g. `independent_isolated_capital_per_instrument`) and `disclaimer`; UI shows honest labeling banner explaining that portfolio metrics are weighted averages, not a single multi-asset equity path.
- **Prop red flags (`propRedFlags`):** engine function `_compute_prop_red_flags` automatically scans results for patterns suspicious from a prop-firm evaluation perspective. Returns `trustLevel` (not_trustworthy / low_trust / cautious / acceptable) and `flags[]` with `severity` (critical / warning). Checked patterns: high Sharpe + few trades, trade count < 10 (critical) / < 30 (warning), no losses / win rate > 95 %, undefined PF, single run without validation, execution disabled, single + no execution, suspiciously low DD, too-smooth equity (> 92 % bars rising), bootstrap CI spanning zero, concentrated PnL (top 5 > 80 %). UI: trust banner below export buttons in ResultsView + color-coded flags section in AnalyticsView.
- **"Not a broker" disclaimer:** execution summary section in AnalyticsView displays a note explaining that the execution model is a simplified linear approximation (no market impact, no book depth, no capacity modeling). Results should not be compared directly with real broker fills.

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
3. `subprocess` host Python: env `STRATEGY_PATH` = absolute path under `.backtest_run`, `DATA_PATH` = project `data/`
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
6. `_compute_drawdown_analysis(equity_curve)`: compute detailed drawdown metrics — max/avg duration (bars + days), time to recovery, underwater %, periods count → populates `drawdownAnalysis` in response and DD metrics in `metrics`
7. `_compute_trade_pnl_distribution(trades)`: histogram, percentiles (p5–p95), skewness, kurtosis, tail risk CVaR, top-5 PnL concentration → populates `tradePnlDistribution` in response
8. `_compute_bootstrap_ci(trades)`: bootstrap 95% confidence intervals for mean PnL, total return, and trade-level Sharpe ratio. Uses **trade-level resampling** with 1 000 bootstrap iterations. Returns `bootstrapCI` dict with `lo`/`hi`/`alpha` per metric, plus `adjustedAlpha` = 0.05 / `trialCount` (naive Bonferroni). `trialCount` is read from manifest (sweep × batch × folds).
9. `_compute_payoff_decomposition(trades, metrics)`: decomposes edge into win rate, loss rate, avg win, avg loss, payoff ratio (avg win / avg loss), edge per trade (WR×AvgWin − LR×AvgLoss), and Kelly fraction. Also writes `payoffRatio`, `edgePerTrade`, `kellyFraction` into `metrics` dict. Returns top-level `payoffDecomposition` in response.
10. **Trial count** (`manifest.trialCount`): calculated as sweep_samples × batch_runs × folds (clamped to ≥ 1). Propagated to `overfittingSignals.trialCount` and `bootstrapCI.trialCount` in response. `overfittingSignals.bonferroniAlpha` = 0.05 / K.
11. **Param test train-only mode** (`validation_config.param_test.train_only`): when `true`, `_run_param_test` performs OAT sweep **only on the training portion** of data (split by `oos_ratio` or default 0.25). The best parameter from the sweep is then evaluated on the **holdout** portion. Response includes `validation.paramTest.holdout` with holdout metrics.
12. If `execution_model.stress_multiplier` > 1: slippage/spread penalty is multiplied by that factor
13. `_compute_prop_red_flags(metrics, trades, equity, manifest, bootstrapCI, tradePnlDistribution)`: scans results for prop-firm red flags. Returns `propRedFlags` dict with `trustLevel` (not_trustworthy / low_trust / cautious / acceptable), `flags[]` (each with `key`, `severity` = critical/warning, `label`, `detail`), `criticalCount`, `warningCount`, `tip`. Checked patterns: extremely high Sharpe with few trades, trade count < 10 (critical) / < 30 (warning), no losing trades / win rate > 95 %, undefined PF (sentinel), single run without validation, execution model disabled, single + no execution = minimum credibility, suspiciously low DD, too-smooth equity curve (> 92 % bars rising), bootstrap CI spanning zero, concentrated PnL (top 5 > 80 %). `trustLevel` is derived from flag counts: any critical → not_trustworthy or low_trust; warnings only → cautious; zero flags → acceptable.
14. Print JSON to stdout, PROGRESS:100 to stderr

**Performance layer (2026-03):**
- `run_backtest(lightweight=True)`: sub-runs (param test, sweep, WF folds, portfolio) skip heavy post-processing (bootstrap CI, drawdown analysis, PnL distribution, payoff decomposition, OHLC export, equity curve with dates). Returns only core ranking metrics.
- `_RESULT_CACHE`: in-memory dict (max 256 entries) keyed by `(CODE_DIGEST, strategy_params, data_fingerprint, n_bars, lightweight)`. Checked before Cerebro setup; populated after successful run.
- `_load_file` uses fast fingerprint (`mtime_ns + size` SHA-256, 24 chars) for `datasetFingerprint` instead of full file SHA-256.
- OHLC export: vectorized pandas `.tolist()` + server-side bar cap (`MAX_OHLC_EXPORT_BARS`, default 8000 bars, uniform downsampling).
- `engine_inprocess.py`: default ON (runner.py `_use_inprocess_engine()` returns True unless `RUN_INPROCESS_ENGINE=0`). Caches engine module by mtime.

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
| Change drawdown analysis logic | `backend/docker/engine.py` → `_compute_drawdown_analysis` |
| Change trade PnL distribution logic | `backend/docker/engine.py` → `_compute_trade_pnl_distribution` |
| Change DD/recovery StatBlocks | `frontend/components/results/StatBlocks.tsx` |
| Change DD analysis / PnL dist Analytics | `frontend/components/results/AnalyticsView.tsx` |
| Change stress multiplier in execution | `backend/docker/engine.py` (execution model), `frontend/components/BacktestSettings.tsx` |
| Change bootstrap CI logic | `backend/docker/engine.py` → `_compute_bootstrap_ci` |
| Change payoff decomposition logic | `backend/docker/engine.py` → `_compute_payoff_decomposition` |
| Change trial count / Bonferroni calculation | `backend/docker/engine.py` (manifest `trialCount`), `backend/app/services/runner.py` |
| Change param test train-only / holdout | `backend/docker/engine.py` → `_run_param_test` |
| Change Bootstrap CI / Edge / Multiple testing UI | `frontend/components/results/AnalyticsView.tsx` |
| Change payoff ratio / Kelly in StatBlocks | `frontend/components/results/StatBlocks.tsx` |
| Change prop red flags logic | `backend/docker/engine.py` → `_compute_prop_red_flags` |
| Change trust banner in Results | `frontend/components/results/ResultsView.tsx` |
| Change prop red flags detail in Analytics | `frontend/components/results/AnalyticsView.tsx` |
| Change "Not a broker" disclaimer | `frontend/components/results/AnalyticsView.tsx` (execution summary section) |
| Change Prop conservative preset | `frontend/components/BacktestSettings.tsx` (edge finding presets) |
| Change stress multiplier UI field | `frontend/components/BacktestSettings.tsx` (execution model section) |
| Change in-process engine default / path | `backend/app/services/runner.py` (`_use_inprocess_engine`), `backend/app/services/engine_inprocess.py` |
| Change lightweight mode (what to skip) | `backend/docker/engine.py` → `run_backtest(lightweight=...)` |
| Change result cache size / key | `backend/docker/engine.py` → `_RESULT_CACHE_MAX`, `_result_cache_key` |
| Change OHLC export cap | env `MAX_OHLC_EXPORT_BARS` or `backend/docker/engine.py` default 8000 |
| Change data fingerprint strategy | `backend/docker/engine.py` → `_load_file` (fast_fingerprint) |
| Change "Reality check" banner logic | `frontend/components/results/ResultsView.tsx` (IIFE after trust banner) |
| Change underwater equity chart | `frontend/components/results/ResultsView.tsx` (equity tab SVG) |
| Change run journal note | `frontend/components/results/ResultsView.tsx` (`runNote` state + repro bundle) |
| Change StatBlocks color-coding thresholds | `frontend/components/results/StatBlocks.tsx` (`alertBorder` logic) |
| Change Pessimist preset | `frontend/components/BacktestSettings.tsx` (`EDGE_PRESETS.pessimist`) |
| Change verdict row (readiness above StatBlocks) | `frontend/components/results/ResultsView.tsx` (IIFE before StatBlocks using `assessOverfitting`) |
| Change StatBlocks grouping / responsive grid | `frontend/components/results/StatBlocks.tsx` (`STAT_ITEMS` with `group` + `GROUP_LABELS`) |
| Change methodology tips toggle | `frontend/components/results/StatBlocks.tsx` (`showTips` state) |
| Change keyboard shortcuts for tabs | `frontend/components/results/ResultsView.tsx` (`useEffect` keydown handler) |
| Change zone dictionary trigger (click/hover) | `frontend/components/results/AnalyticsView.tsx` (`ZoneDataDictionary`) |
| Change param test collapse behavior | `frontend/components/results/AnalyticsView.tsx` (`<details>` around ParamTestAnalytics) |
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
- **Missing deps (backtrader/pyarrow):** Run fails at engine import — `pip install -r backend/requirements.txt`

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
