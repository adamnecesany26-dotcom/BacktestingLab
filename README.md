# Backtesting Platform – Kompletní dokumentace

Webová aplikace pro testování obchodních strategií na historických datech. Uživatel píše strategie v Pythonu (Backtrader), spouští backtest v izolovaném Docker kontejneru a vidí výsledky – grafy, statistiky a obchody.

**Účel dokumentu:** Tento soubor slouží jako kompletní technická dokumentace pro hodnocení workflow aplikace (např. ChatGPT, code review).

---

## 1. Přehled aplikace

### 1.1 Co aplikace dělá

1. **Strategie** – uživatel vytváří a upravuje obchodní strategie v Pythonu (Backtrader API)
2. **Indikátory a moduly** – znovupoužitelné komponenty (indikátory jako `bt.Indicator`, moduly jako utility funkce)
3. **Backtest** – spuštění strategie na historických OHLCV datech v izolovaném prostředí
4. **Výsledky** – equity křivka, metriky (Sharpe, drawdown, win rate), seznam obchodů, candlestick graf s entry/exit

### 1.2 Architektura (vysokoúrovňově)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js, React)                                                   │
│  - page.tsx: hlavní stav, orchestrace                                         │
│  - BacktestSettings: konfigurace, instrument, indikátory, moduly, Run        │
│  - StrategyEditor: Monaco editor (kód)                                        │
│  - ResultsView: grafy, statistiky, tabulka obchodů                            │
│  - Firebase Firestore: strategie, indikátory, moduly (cloud storage)         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (fetch)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI, Python)                                                  │
│  - GET /api/data: seznam dostupných instrumentů                            │
│  - POST /api/run: spuštění backtestu (stream=1 → SSE)                       │
│  - POST /api/chart: generace PNG grafu (mplfinance)                         │
│  - services/runner.py: orchestrace Dockeru, streamování výstupu              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ docker run
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  DOCKER KONTEJNER (backtest-engine)                                         │
│  - engine.py: načte strategii, data, spustí Backtrader                      │
│  - Mount: /app/strategy (strategie), /app/data (OHLCV CSV/parquet)           │
│  - Výstup: JSON na stdout, PROGRESS:X na stderr                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Proč Docker

Strategie je cizí Python kód. Spouští se v izolovaném kontejneru:
- Bez síťového přístupu (`--network none`)
- Omezená paměť (1 GB), CPU (1 core)
- Timeout 3 minuty
- Nemůže poškodit hostitelský systém

---

## 2. Struktura projektu

```
Backtesting_app/
├── frontend/                    # Next.js aplikace
│   ├── app/
│   │   ├── page.tsx             # Hlavní stránka – stav, logika, orchestrace
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Sidebar.tsx          # Levý panel – soubory strategie, Zpět
│   │   ├── MainView.tsx         # Strategie / Indikátory / Moduly – seznam + vytvoření
│   │   ├── BacktestSettings.tsx # Pravý panel – Instrument Type, Instrument, Years, Run
│   │   ├── BacktestResults.tsx  # Statistiky (equity, Sharpe, drawdown, trades)
│   │   ├── editor/
│   │   │   └── StrategyEditor.tsx # Monaco editor
│   │   ├── results/
│   │   │   ├── ResultsView.tsx  # Kontejner výsledků
│   │   │   ├── StatBlocks.tsx   # Metriky
│   │   │   ├── TradesTable.tsx # Tabulka obchodů
│   │   │   └── ...
│   │   ├── charts/
│   │   │   ├── DetailedChart.tsx # Candlestick + trades
│   │   │   ├── EquityChart.tsx
│   │   │   └── TradesChart.tsx
│   │   ├── LogPanel.tsx         # Spodní panel – logy z backendu
│   │   ├── LoadingOverlay.tsx   # Progress bar + Zastavit
│   │   ├── CreateModal.tsx     # Modal pro vytvoření strategie/indikátoru/modulu
│   │   └── AddFileModal.tsx    # Modal pro přidání souboru
│   └── lib/
│       ├── api.ts               # runBacktestStreaming, getAvailableData, getChartImage
│       ├── firestore.ts         # listItems, createItem, getFiles, getFileContent, saveFile
│       └── firebase.ts          # Firebase konfigurace
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, routy
│   │   ├── api/
│   │   │   ├── run.py           # POST /api/run (streaming / non-streaming)
│   │   │   ├── data.py          # GET /api/data, GET /api/data/debug
│   │   │   └── chart.py         # POST /api/chart (PNG)
│   │   ├── services/
│   │   │   ├── runner.py        # Docker orchestrace, streamování
│   │   │   └── chart.py         # mplfinance generace grafu
│   │   └── models/
│   │       └── run.py           # RunRequest, RunResponse, Trade, BacktestMetrics
│   └── docker/
│       ├── Dockerfile           # python:3.11-slim + backtrader
│       ├── engine.py            # Skript běžící UVNITŘ kontejneru
│       └── requirements.txt
│
├── shared/
│   └── types/
│       └── index.ts             # RunRequest, RunResponse, DataInstrument, InstrumentType
│
├── data/
│   ├── broker_config.json       # tick_size, tick_value, mult, margin pro futures
│   └── mock/
│       ├── NQ_5Y.csv            # Futures (root = backward compat)
│       ├── futures/             # (volitelné) další futures
│       ├── stocks/              # Akcie (AAPL_5Y.csv, ...)
│       └── forex/               # Forex páry (EURUSD_5Y.csv, ...)
│
├── strategies/                  # Lokální příklady (ne v produkci)
└── README.md
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
| 8 | (Volitelně) Vybere indikátory/moduly | Checkboxy v BacktestSettings, `onConfirmSelection` |
| 9 | Vybere **Instrument Type** (Futures/Stocks/Forex) | `backtestParams.instrumentType` |
| 10 | Vybere **Instrument** | Filtrováno podle `instrumentType` – pouze relevantní instrumenty |
| 11 | Nastaví **Délku** (roky) | `years` state |
| 12 | Klikne **Run** | `handleRun()` – viz níže |

### 3.3 Run backtest – detailní tok

**Frontend (`handleRun` v `page.tsx`):**

1. Ověří: otevřená strategie, `main.py` existuje, vybraný instrument
2. Sestaví `allFiles`:
   - Všechny soubory strategie (main.py, utils.py, …)
   - Vybrané indikátory → `indicators/{Název}.py`
   - Vybrané moduly → `modules/{Název}.py`
3. Vytvoří `AbortController` pro možnost zastavení
4. Zavolá `runBacktestStreaming(request, signal, onEvent)`
5. `onEvent`: `log` → přidá do LogPanelu, `progress` → aktualizuje progress bar
6. Po `result` → `setResults(data)`, `setShowResults(true)`

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
  "instrument_type": "futures",
  "tick_size": 0.25,
  "value_per_tick": 5,
  "share_size": null,
  "lot_size": null,
  "pip_size": null,
  "pip_value": null
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
     ...
     backtest-engine
   ```
4. Čte stdout/stderr v odděleném vlákně
5. Parsuje JSON z stdout → `{"equity": [...], "metrics": {...}, "trades": [...], "ohlc": [...]}` → event `result`
6. Parsuje `PROGRESS:10` z stderr → event `progress`
7. Při chybě: JSON `{"error": "..."}` → event `error`
8. Streamuje události klientovi přes SSE
9. Po dokončení smaže `.backtest_run/*.py`

**Engine (`docker/engine.py` – uvnitř kontejneru):**

1. Načte env: `STRATEGY_PATH`, `DATA_PATH`, `INSTRUMENT`, `TIMEFRAME`, `YEARS`, `DATA_FILE`, …
2. `load_strategy(path)`: dynamický import, najde první třídu dědící z `bt.Strategy`
3. `load_data(data_path, instrument, timeframe, years, data_file)`:
   - Pokud `data_file`: načte přímo `data_path/data_file` (např. `mock/NQ_5Y.csv`)
   - Jinak hledá `mock/{instrument}_5Y.csv`, `mock/{instrument}.csv`, parquet
4. Normalizuje CSV sloupce (Date/date, Close/Last→close, Open, High, Low, Volume)
5. Filtruje data podle `years` (posledních N let)
6. `run_backtest()`:
   - Vytvoří Cerebro, přidá data, strategii, analyzéry (Sharpe, DrawDown, TradeAnalyzer)
   - Nastaví broker: cash, commission=0, slippage
   - Spustí `cerebro.run()`
   - Zaznamenává equity na každý bar, obchody přes `notify_trade`/`notify_order`
   - Vypočítá metriky (Sharpe, max drawdown, win rate, profit factor, …)
7. Vypíše JSON na stdout, `PROGRESS:100` na stderr

**Response (`RunResponse`):**

```json
{
  "equity": [100000, 100500, ...],
  "equityCurve": [{"date": "2024-01-01", "value": 100000}, ...],
  "metrics": {
    "finalEquity": 105000,
    "sharpeRatio": 1.2,
    "maxDrawdown": 5.5,
    "tradeCount": 42,
    "longCount": 25,
    "shortCount": 17,
    "winRate": 60,
    "totalReturn": 5.0,
    "totalReturnUsd": 5000,
    "profitFactor": 1.8,
    "expectancyUsd": 119,
    "expectancyR": 0.5
  },
  "trades": [
    {"date": "...", "entryDate": "...", "exitDate": "...", "type": "buy", "size": 1, "pnl": 150, "entryPrice": 20000, "exitPrice": 20150}
  ],
  "ohlc": [{"date": "...", "open": 20000, "high": 20100, "low": 19950, "close": 20050}]
}
```

### 3.4 Zobrazení výsledků

1. **ResultsView** zobrazí:
   - **StatBlocks**: final equity, Sharpe, max drawdown, trade count, win rate, profit factor, …
   - **TradesTable**: tabulka obchodů
   - **DetailedChart**: candlestick graf (TradingView Lightweight Charts) s OHLC + entry/exit značkami
2. **Chart PNG**: volitelně `getChartImage(ohlc, trades)` → POST /api/chart → mplfinance PNG
3. **Export**: JSON výsledků ke stažení
4. **Uložení do Firestore**: `saveBacktestResult(strategyId, strategyName, result)` → `/strategies/{id}/results/{backtestId}`

---

## 4. Typy instrumentů a ukládání dat

### 4.1 Instrument Type

Aplikace podporuje tři typy:

| Typ | Popis | Parametry v UI |
|-----|-------|----------------|
| **Futures** | Futures kontrakty (NQ, ES) | Tick Size, Value Per Tick |
| **Stocks** | Akcie | Position Size (počet akcií) |
| **Forex** | Forex páry | Lot Size, Pip Size, Pip Value |

### 4.2 Struktura složek pro data

Typ instrumentu se určuje podle **umístění souboru**:

```
data/mock/
├── NQ_5Y.csv              → instrumentType: "futures" (root = backward compat)
├── ES_5Y.csv              → futures
├── futures/               → futures
│   └── *.csv
├── stocks/                → stocks
│   ├── AAPL_5Y.csv
│   └── MSFT_10Y.csv
└── forex/                 → forex
    ├── EURUSD_5Y.csv
    └── GBPUSD_3Y.csv
```

### 4.3 Formát CSV

- Povinné sloupce: `Date` nebo `date`, OHLC (Open, High, Low, Close/Last)
- Volitelné: `Volume` (default 1000)
- Název souboru: `{INSTRUMENT}_5Y.csv` → instrument = první část před `_`

### 4.4 Filtrování instrumentů v UI

- `GET /api/data` vrací všechny instrumenty včetně `instrumentType`
- Frontend filtruje: `filterInstrumentsByType(instruments, backtestParams.instrumentType)`
- Při změně Instrument Type (např. Futures → Stocks) se výběr resetuje na první dostupný instrument daného typu

### 4.5 broker_config.json (futures)

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

## 5. Firestore struktura

```
/strategies/{strategyId}
  - name, tag, createdAt
  /files/{fileName}  (např. main.py, utils.py)
    - fileName, content

/indicators/{indicatorId}
  - name, tag, createdAt
  /files/main.py
    - fileName, content

/modules/{moduleId}
  - name, tag, createdAt
  /files/main.py
    - fileName, content

/strategies/{strategyId}/results/{backtestId}
  - strategyName, savedAt, equity, metrics, trades, ohlc, ...
```

---

## 6. API reference

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

**Body (RunRequest):** `files`, `instrument`, `timeframe`, `years`, `data_file`, `initial_capital`, `slippage_perc`, `instrument_type`, `tick_size`, `value_per_tick`, `share_size`, `lot_size`, `pip_size`, `pip_value`

**Response (non-stream):** RunResponse (equity, equityCurve, metrics, trades, ohlc)

**SSE events (stream=1):**
- `{"type": "log", "line": "..."}`
- `{"type": "progress", "value": 0-100}`
- `{"type": "result", "data": RunResponse}`
- `{"type": "error", "message": "..."}`

### POST /api/chart

Generuje PNG candlestick grafu s mplfinance.

**Body:** `{ "ohlc": [...], "trades": [...] }`

**Response:** `image/png`

---

## 7. Indikátory a moduly

### Import v strategii

- Indikátor: `from indicators.{Název} import {Třída}` – soubor je uložen jako `indicators/{Název}.py` (název bez mezer, speciálních znaků)
- Modul: `from modules.{Název} import {funkce}` – soubor `modules/{Název}.py`

### Sestavení `files` při Run

1. Všechny soubory strategie (main.py, utils.py, …)
2. Pro každý vybraný indikátor: `indicators/{toModuleName(ind.name)}.py` = obsah `main.py` indikátoru
3. Pro každý vybraný modul: `modules/{toModuleName(mod.name)}.py` = obsah `main.py` modulu

Uživatel musí v BacktestSettings vybrat indikátory/moduly a kliknout **Potvrdit** před Run.

---

## 8. Technologie

| Vrstva | Technologie |
|--------|-------------|
| Frontend | Next.js 14, React, TailwindCSS, Monaco Editor, TradingView Lightweight Charts |
| Backend | Python 3.11+, FastAPI, uvicorn |
| Backtest | Backtrader (v Dockeru) |
| Data | Firebase Firestore (strategie, indikátory, moduly), CSV (OHLCV) |
| Docker | python:3.11-slim, backtrader, pandas |
| Graf (PNG) | mplfinance |

---

## 9. Konfigurace

### Environment variables

- **Frontend:** `NEXT_PUBLIC_API_URL` – URL backendu (default `http://localhost:8000`)
- **Backend:** žádné povinné (CORS pro localhost:3000)
- **Firebase:** konfigurace v `frontend/lib/firebase.ts`

### Runner

- Timeout: 180 s
- Docker: `--memory=1g`, `--cpus=1`, `--network none`

---

## 10. Známá omezení a TODO

1. **Engine** zatím nečte `INSTRUMENT_TYPE`, `TICK_SIZE`, `VALUE_PER_TICK`, `SHARE_SIZE`, `LOT_SIZE`, `PIP_SIZE`, `PIP_VALUE` – výpočet PnL je stále založen na výchozím brokeru (futures-like).
2. **Stocks:** cílový výpočet PnL = `(exit_price - entry_price) * share_size`
3. **Forex:** cílový výpočet PnL podle lot_size, pip_size, pip_value
4. **Broker config** pro futures (tick_value, mult, margin) je v engine zatím neaplikován – commission a margin jsou zjednodušené.

---

## 11. Troubleshooting

| Problém | Možná příčina | Řešení |
|---------|---------------|--------|
| Instrument se nenačítá | Instrument Type ≠ typ dat | Zkontroluj, že máš vybraný správný Instrument Type (Futures pro NQ) |
| Žádné instrumenty | Data složka prázdná nebo špatná cesta | Zkontroluj `GET /api/data/debug`, strukturu `data/mock/` |
| Backtest selže | Docker neběží, chyba ve strategii | Zkontroluj `docker ps`, logy v LogPanelu, `.backtest_run/last_error_strategy.py` |
| CORS chyba | Backend jiný port/origin | Nastav `allow_origins` v main.py nebo `NEXT_PUBLIC_API_URL` |
| Firebase chyba | Chybějící konfigurace | Zkontroluj `firebase.ts`, service account / API key |
| **FirebaseError: Missing or insufficient permissions** | Firestore pravidla blokují zápis | Nasazení pravidel: `firebase deploy --only firestore:rules` (v root projektu) |

---

## 12. Firestore pravidla

Pro ukládání výsledků backtestů (Run history) musí být nasazena Firestore pravidla. V root projektu:

```bash
firebase deploy --only firestore:rules
```

Vyžaduje Firebase CLI (`npm i -g firebase-tools`) a přihlášení (`firebase login`). Soubory `firestore.rules` a `firebase.json` jsou v projektu.

---

## 13. Další dokumentace

- **SCRIPTS.md** – příkazy, skripty, edge cases
- **strategies/test/readme.py** – tutoriál psaní strategií (Backtrader API, životní cyklus, příklady)
