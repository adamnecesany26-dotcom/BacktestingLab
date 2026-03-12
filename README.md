# Backtesting Platform

Web-based trading strategy backtesting platform. Local-first MVP for creating, editing, and running Python strategies in a Docker sandbox with Backtrader.

## Architecture

```
User → Frontend (Next.js) → API (FastAPI) → Docker Runner → Backtesting Engine → Results → Frontend
```

### Layers

1. **Frontend IDE** – Next.js, Monaco Editor, TradingView Lightweight Charts
2. **Backend API** – FastAPI, routes, services
3. **Strategy Runner** – Creates temp dir, writes strategy, runs Docker
4. **Backtesting Engine** – Runs inside Docker, uses Backtrader

## Folder Structure

```
project-root/
├── frontend/                 # Next.js application
│   ├── app/                  # App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── editor/           # Monaco editor
│   │   ├── charts/           # Equity chart (Lightweight Charts)
│   │   ├── Sidebar.tsx
│   │   ├── FileTree.tsx
│   │   ├── RunButton.tsx
│   │   ├── BacktestResults.tsx
│   │   └── LogPanel.tsx
│   ├── lib/
│   │   ├── api.ts            # API client
│   │   └── firebase.ts       # Firebase scaffold
│   └── styles/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI entry
│   │   ├── api/              # Routes
│   │   ├── services/         # runner.py, backtest.py
│   │   ├── models/           # Pydantic models
│   │   └── utils/
│   ├── data/                 # Historical datasets (parquet)
│   └── docker/
│       ├── Dockerfile        # Strategy sandbox
│       ├── engine.py         # Backtest engine (runs in container)
│       └── requirements.txt
└── shared/
    └── types/                # Shared interfaces (TS)
```

## System Workflow

1. User edits strategy in Monaco Editor
2. Clicks **Run**
3. Frontend `POST /api/run` with `{ code, instrument, timeframe }`
4. Backend creates temp directory, writes `strategy.py`
5. Backend runs Docker: `docker run ... -v /run_folder:/app/strategy -v /data:/app/data backtest-engine`
6. Container executes `engine.py`:
   - Loads strategy dynamically
   - Loads data from parquet (or generates sample)
   - Runs Backtrader
   - Outputs JSON: `{ equity, metrics, trades }`
7. Backend returns JSON to frontend
8. Frontend renders equity chart and statistics

## Communication

- **Frontend → Backend**: REST over HTTP (CORS enabled for `localhost:3000`)
- **Backend → Docker**: Subprocess, mounts, env vars
- **Docker output**: JSON to stdout, parsed by runner

## Docker Sandbox

- **Image**: `backtest-engine` (build from `backend/docker/`)
- **Resources**: 512MB RAM, 1 CPU, no network
- **Mounts**:
  - `/app/strategy` – strategy code (rw)
  - `/app/data` – historical data (ro)
- **Env**: `INSTRUMENT`, `TIMEFRAME`

## Setup Instructions

### Prerequisites

- Node.js 18+
- Python 3.11+
- Docker

### 1. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at http://localhost:3000

### 2. Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Runs at http://localhost:8000

### 3. Docker Image

```bash
cd backend/docker
docker build -t backtest-engine .
```

### 4. Run Development

1. Start backend: `uvicorn app.main:app --reload --port 8000`
2. Start frontend: `npm run dev`
3. Open http://localhost:3000
4. Edit strategy, click Run

### Data

Place parquet files in `backend/data/`:

- `{instrument}_{timeframe}.parquet` (e.g. `BTCUSD_1d.parquet`)
- Columns: `open`, `high`, `low`, `close`, `volume`
- Index: `datetime` (DatetimeIndex)

If no data exists, the engine generates sample data for demo.

## Firebase

Scaffold only. Add env vars to `frontend/.env.local` for auth/storage when ready:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
```

## Export Results

Export functionality is scaffolded. Implement by extending `RunResponse` and adding an export button that downloads JSON/CSV.
