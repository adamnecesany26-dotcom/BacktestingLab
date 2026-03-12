# Backtesting Platform

Webová aplikace pro testování obchodních strategií na historických datech. Píšeš strategii v Pythonu, spustíš backtest a vidíš výsledky – grafy a statistiky.

---

## Co aplikace dělá?

Představ si to takto:

1. **Máš obchodní strategii** – napsanou v Pythonu (např. „když cena stoupne, kup“).
2. **Máš historická data** – ceny akcií/futures z minulosti (např. 5 let denních dat).
3. **Backtest** = „spusť strategii na historii“ – program projde data po dni a simuluje, co by se stalo, kdybys strategii používal.
4. **Výsledky** – kolik bys vydělal, ztratil, jaké riziko atd.

Aplikace ti umožní:
- **Vytvářet** strategie, indikátory a moduly (složky s Python soubory)
- **Ukládat** je do Firebase (cloud)
- **Přepisovat** kód v editoru (jako ve VS Code)
- **Spouštět** backtest jedním kliknutím
- **Zobrazovat** výsledky – graf equity a statistiky

---

## Jak to celé funguje? (Velmi jednoduše)

```
Ty (uživatel)
    ↓ klikneš na Run
Prohlížeč (frontend)
    ↓ pošle kód strategie + nastavení na server
Backend (Python server)
    ↓ vytvoří dočasnou složku, zapíše tam strategii
    ↓ spustí Docker kontejner
Docker (izolovaný „krabička“)
    ↓ načte strategii, načte data
    ↓ spustí Backtrader (knihovna pro backtest)
    ↓ vyhodí výsledky
Backend
    ↓ předá výsledky
Prohlížeč
    ↓ zobrazí graf a statistiky
Ty vidíš výsledky
```

**Proč Docker?**  
Strategie je cizí Python kód. Spouštíme ji v izolovaném prostředí (kontejner), aby nemohla poškodit tvůj počítač – nemá přístup k síti, má omezenou paměť.

---

## Struktura projektu

```
Backtesting_app/
│
├── frontend/                 ← Co vidíš v prohlížeči
│   ├── app/
│   │   ├── page.tsx         ← Hlavní stránka (logika, stav)
│   │   ├── layout.tsx       ← Vzhled celé aplikace
│   │   └── globals.css      ← Styly
│   ├── components/          ← Skládací kostičky UI
│   │   ├── Sidebar.tsx      ← Levý panel (soubory, Zpět)
│   │   ├── MainView.tsx     ← Klikací tlačítka Strategie/Indikátory/Moduly
│   │   ├── BacktestSettings.tsx  ← Pravý panel (instrument, délka, Run)
│   │   ├── BacktestResults.tsx  ← Statistiky (equity, Sharpe, trades)
│   │   ├── EquityChart.tsx      ← Graf vývoje účtu
│   │   ├── LogPanel.tsx         ← Logy (jako terminál)
│   │   ├── LoadingOverlay.tsx   ← Zobrazení při běhu
│   │   ├── ExportButton.tsx     ← Export výsledků
│   │   └── editor/
│   │       └── StrategyEditor.tsx  ← Monaco editor (kód)
│   ├── lib/
│   │   ├── api.ts           ← Volání backendu (fetch)
│   │   ├── firestore.ts     ← Čtení/zápis do Firebase
│   │   └── firebase.ts      ← Konfigurace Firebase
│   └── package.json
│
├── backend/                  ← Python server
│   ├── app/
│   │   ├── main.py          ← Vstupní bod (FastAPI)
│   │   ├── api/
│   │   │   ├── run.py       ← Endpoint POST /api/run
│   │   │   └── data.py      ← Endpoint GET /api/data
│   │   ├── services/
│   │   │   └── runner.py    ← Spouští Docker, streamuje výstup
│   │   └── models/
│   │       └── run.py       ← Struktury request/response
│   ├── docker/
│   │   ├── Dockerfile       ← Jak sestavit Docker obraz
│   │   ├── engine.py        ← Skript, který běží UVNITŘ kontejneru
│   │   └── requirements.txt
│   └── requirements.txt
│
├── shared/
│   └── types/
│       └── index.ts         ← Sdílené typy (RunRequest, RunResponse)
│
├── data/
│   └── mock/
│       └── NQ_5Y.csv        ← Historická data (NQ, 5 let)
│
├── README.md
└── SCRIPTS.md
```

---

## Co dělá který soubor?

### Frontend (React)

| Soubor | Účel |
|--------|------|
| `page.tsx` | Hlavní stránka. Drží stav (kód, výsledky, logy). Spojuje komponenty (Sidebar, Editor, Settings). Volá API a Firestore. |
| `Sidebar.tsx` | Levý panel. Když je otevřená strategie: seznam souborů + tlačítko Zpět. |
| `MainView.tsx` | Tři tlačítka (Strategie, Indikátory, Moduly). Po kliknutí seznam položek + „Vytvořit X“. Modal pro vytvoření. |
| `StrategyEditor.tsx` | Monaco editor – editor kódu (jako VS Code). |
| `BacktestSettings.tsx` | Výběr instrumentu, délky v letech, tlačítko Run. |
| `BacktestResults.tsx` | Zobrazí metriky (final equity, Sharpe, drawdown, trades). |
| `EquityChart.tsx` | Graf vývoje účtu (TradingView Lightweight Charts). |
| `LogPanel.tsx` | Spodní panel – logy z backendu (stdout/stderr). |
| `LoadingOverlay.tsx` | Zobrazení při běhu backtestu s progress barem a tlačítkem Zastavit. |
| `api.ts` | `runBacktestStreaming()` – volá `/api/run?stream=1`, čte SSE stream. `getAvailableData()` – volá `/api/data`. |
| `firestore.ts` | `listItems`, `createItem`, `getFiles`, `getFileContent`, `saveFile` – práce s Firebase. |

### Backend (Python)

| Soubor | Účel |
|--------|------|
| `main.py` | FastAPI app. CORS, routy `/api/run`, `/api/data`, `/health`. |
| `api/run.py` | `POST /api/run` – přijme kód + nastavení. Pokud `?stream=1`, vrací SSE stream. Jinak běžný JSON. |
| `api/data.py` | `GET /api/data` – projde `data/mock/`, vrátí seznam instrumentů a rozsah dat. |
| `services/runner.py` | Vytvoří temp složku, zapíše `strategy.py`, spustí `docker run ... backtest-engine`. Čte stdout/stderr, streamuje události (log, progress, result). Timeout 3 min, RAM 1GB. |
| `models/run.py` | Pydantic modely: `RunRequest`, `RunResponse`, `BacktestMetrics`, `Trade`. |
| `docker/engine.py` | Běží UVNITŘ Dockeru. Načte strategii, načte data (CSV/parquet), spustí Backtrader, vypíše JSON na stdout. Na stderr posílá `PROGRESS:10`, `PROGRESS:20`, … |

### Shared

| Soubor | Účel |
|--------|------|
| `shared/types/index.ts` | Typy pro TypeScript: `RunRequest`, `RunResponse`, `DataInstrument`, `BacktestMetrics`, `Trade`. |

---

## Tok dat (krok za krokem)

### 1. Uživatel otevře aplikaci

- Frontend načte stránku.
- Zobrazí se tlačítka Strategie / Indikátory / Moduly.

### 2. Uživatel klikne na „Strategie“

- Zavolá se `listItems("strategies")` z Firestore.
- Zobrazí se seznam strategií + tlačítko „Vytvořit strategii“.

### 3. Uživatel vytvoří strategii

- Klikne „Vytvořit strategii“ → modal (název, tag).
- `createItem("strategies", name, tag)` → vytvoří dokument ve Firestore + soubor `main.py` s výchozím obsahem.
- Otevře se nová strategie.

### 4. Uživatel upraví kód

- V editoru se načte obsah `main.py`.
- Uživatel píše.
- Klikne „Uložit“ → `saveFile()` → zapíše do Firestore.

### 5. Uživatel spustí backtest

- Vybere instrument (např. NQ) a délku (např. 1 rok).
- Klikne Run.
- Frontend:
  - `getFileContent(..., "main.py")` → získá kód
  - `runBacktestStreaming({ code, instrument, ... }, signal, onEvent)` → volá `POST /api/run?stream=1`
- Backend:
  - Vytvoří temp složku, zapíše `strategy.py`
  - Spustí `docker run ... backtest-engine`
  - Čte stdout/stderr, streamuje události (log, progress, result)
- Frontend:
  - `onEvent` přidává logy do LogPanelu.
  - `onEvent` s `progress` aktualizuje progress bar.
  - Po `result` zobrazí výsledky (graf + statistiky).

### 6. Uživatel vidí výsledky

- Equity graf se vykreslí.
- Statistiky (final equity, Sharpe, drawdown, trades) se zobrazí.
- Může exportovat JSON.

---

## Workflow (jak používat aplikaci)

1. **Otevři** http://localhost:3000
2. **Klikni** na Strategie / Indikátory / Moduly
3. **Vytvoř** novou položku (název, volitelně tag)
4. **Otevři** ji – v levém panelu uvidíš soubory (např. `main.py`)
5. **Uprav** kód v editoru
6. **Ulož** (tlačítko Uložit)
7. **V pravém panelu** vyber instrument a délku
8. **Klikni** Run
9. **Počkej** – uvidíš logy a progress bar
10. **Zobraz** výsledky – graf + statistiky
11. **Export** – stáhneš JSON výsledků

---

## Technologie

- **Frontend:** Next.js, React, TailwindCSS, Monaco Editor, TradingView Lightweight Charts, Firebase
- **Backend:** Python, FastAPI, uvicorn
- **Backtest:** Backtrader (v Dockeru)
- **Data:** Firebase (Firestore), CSV (data/mock)

---

## Data

- **Firestore:** strategie, indikátory, moduly – každá položka má subkolekci `files` (např. `main.py`)
- **Historie:** data v `data/mock/` (např. `NQ_5Y.csv` – CSV s Date, Open, High, Low, Close/Last)
- **Broker:** `data/broker_config.json` – tick, mult, margin, commission per instrument (futures)

---

## Další dokumentace

- **SCRIPTS.md** – příkazy, skripty, troubleshooting, edge cases
