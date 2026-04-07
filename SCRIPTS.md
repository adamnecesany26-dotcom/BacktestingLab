# Skripty a příkazy 

Přehled všech důležitých příkazů, jak spustit aplikaci, co dělat při problémech a tipy pro vývoj.

## Dokumentace (související soubory v kořeni)

| Soubor | K čemu |
|--------|--------|
| **README.md** | Architektura, API, Firestore, výsledkové záložky, limity. |
| **READMEADAM.md** | Co kde v UI najdeš; Edge finding; exporty; nápověda v aplikaci. |
| **READMEAI.md** | Pro vývoj: kde v kódu měnit chování, kontrakty request/response. |
| **audit/README.md** | Index uložených auditů (review později). |
| **docs/QUANT_AUDIT.md** | Technický quant audit dat a engine. |
| **docs/BACKTEST_PIPELINE_REFACTOR.md** | Artefakty `.backtest_artifacts/`, precompute H/L + S/D, View cache. |
| **SCRIPTS.md** (tento soubor) | Jen příkazy a běh lokálně. |

---

## Prerekvizity

Před prvním spuštěním potřebuješ:

- **Node.js 18+** – [nodejs.org](https://nodejs.org)
- **Python 3.11+** – [python.org](https://python.org)
---

## První spuštění (setup)

### 1. Backend – virtuální prostředí a závislosti

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

**Kdy znovu:** Po přidání nové závislosti do `requirements.txt`.

---

### 3. Frontend – závislosti

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\frontend
npm install
```

**Kdy znovu:** Po změně `package.json` nebo `package-lock.json`.

---

## Běžné spuštění aplikace

Potřebuješ **2 terminály** (backend + frontend).

### Terminál 1 – Backend

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

Backend běží na **http://localhost:8000**

---

### Terminál 2 – Frontend

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\frontend
npm run dev
```

Frontend běží na **http://localhost:3000**

---

### Otevři v prohlížeči

```
http://localhost:3000
```

---

## Důležité příkazy

### Frontend (npm)

| Příkaz | Popis |
|--------|-------|
| `npm run dev` | Spustí vývojový server (hot reload) |
| `npm run build` | Sestaví produkční build |
| `npm run start` | Spustí produkční server (po `build`) |
| `npm run lint` | Spustí ESLint |

### Backend (Python)

| Příkaz | Popis |
|--------|-------|
| `uvicorn app.main:app --reload --port 8000` | Spustí API server s auto-reload |
| `uvicorn app.main:app --port 8000` | Spustí bez reload (produkce) |
| `python -m pytest` | Spustí testy (`backend/tests/`, z adresáře `backend/`) |
| `python backend/scripts/build_nq_view_demo_2025.py` | Z `data/futures_30m/NQ.txt` vyřízne rok 2025 → `nq_view_demo_2025.parquet` (View demo instrument) |

### Precompute artefaktů (volitelné — CLI)

Z adresáře **`backend`** s aktivním venv (kvůli importům `app.*`):

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\backend
.\venv\Scripts\activate
$env:PYTHONPATH = "..\;$(Get-Location)"
python -m app.services.hl_precompute --help
python -m app.services.sd_precompute --help
```

Výstup se ukládá do **`.backtest_artifacts/`** v kořeni projektu (není v gitu). Stejný výsledek lze dosáhnout tlačítkem **Build features** ve View — viz **`docs/BACKTEST_PIPELINE_REFACTOR.md`**.

---

## Co dělat když…

### Aplikace se nenačte (bílá stránka)

1. Zkontroluj, že frontend běží: `npm run dev` v `frontend/`
2. Otevři DevTools (F12) → Console – hledej chyby
3. Zkontroluj, že backend běží: otevři http://localhost:8000/health – měl by vrátit `{"status":"ok"}`

---

### Run nefunguje / „Engine subprocess failed“

1. **Závislosti backendu:** `pip install -r backend/requirements.txt` (Backtrader, pyarrow, …)
2. **Stejný Python:** engine se spouští jako `sys.executable` z venv, ve kterém běží uvicorn
3. **Data existují?** – soubor `data/mock/NQ_5Y.csv` musí být na místě
4. **Backend logy** – v terminálu s uvicorn uvidíš stderr z engine subprocessu

---

### „Missing or insufficient permissions“ (Firebase)

- Otevři [Firebase Console](https://console.firebase.google.com) → projekt backtestlab-5cbb7
- Firestore Database → Rules
- Nastav pravidla (viz README nebo předchozí konverzace)

---

### Port 3000 nebo 8000 je obsazený

**Změna portu frontendu:**
```powershell
npm run dev -- -p 3001
```

**Změna portu backendu:**
```powershell
uvicorn app.main:app --reload --port 8001
```
Pak v `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8001
```

---

### Backend nenačítá data

- Data jsou v `data/mock/` (v kořeni projektu, ne v `backend/`)
- Backend hledá `backend_root.parent / "data"` = kořen projektu / data
- Zkontroluj, že `data/mock/NQ_5Y.csv` existuje

---

### Chyba v Python strategii (syntax, runtime)

- Chyba se zobrazí v **LogPanel** (spodní panel)
- Backend předává stderr z engine subprocessu
- Zkontroluj logy – měl bys vidět traceback

---

### Progress bar se nehýbe / zůstane na 0

- Engine posílá `PROGRESS:10`, `PROGRESS:20`, … na stderr
- Pokud backtest padne hned na začátku, progress se nezmění
- Zkontroluj logy – co přesně engine vypisuje

---

### Chci zastavit běžící backtest

- Klikni na **Zastavit** v loading overlay
- Nebo zavři záložku (request se zruší, backend ukončí engine subprocess)

---

## Edge cases a tipy

### Změnil jsem engine.py – co teď?

- Uvicorn s `--reload` obvykle nestačí na child proces — zastav backend (Ctrl+C) a spusť znovu `uvicorn …`, aby další Run načetl nový `engine.py`.

Bez přestavby obrazu se změny neprojeví.

---

### Změnil jsem backend kód (runner, api, …)

- Uvicorn s `--reload` sám restartuje
- Pokud ne, zastav (Ctrl+C) a znovu spusť `uvicorn ...`

---

### Změnil jsem frontend kód

- Next.js s `npm run dev` má hot reload
- Stránka se obnoví automaticky

---

### Mám více verzí Pythonu

Použij konkrétní cestu:

```powershell
py -3.11 -m venv venv
```

---

### npm install padá s chybou

```powershell
# Smazat cache a node_modules
rm -r node_modules
rm package-lock.json
npm install
```

(Na Windows můžeš smazat složky ručně.)

---

### pip install padá

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

---

### Firestore – prázdný seznam strategií

- Normální při prvním spuštění
- Klikni „Vytvořit strategii“ a vytvoř první

---

### Export nefunguje

- **Export JSON** a **Repro bundle (ZIP)** jsou aktivní jen po úspěšném Run (záložky výsledků)
- JSON: stáhne celý RunResponse; ZIP: manifest + souhrn + snapshot `main.py` z editoru (vyžaduje balíček `fflate` — `npm install` ve `frontend/`)
- Co které tlačítko dělá: **[READMEADAM.md](READMEADAM.md)** → sekce Výsledky

---

## Struktura příkazů (cheat sheet)

```
# První setup
cd backend && python -m venv venv && .\venv\Scripts\activate && pip install -r requirements.txt
cd frontend && npm install

# Každé spuštění
# Terminál 1:
cd backend && .\venv\Scripts\activate && uvicorn app.main:app --reload --port 8000

# Terminál 2:
cd frontend && npm run dev

# Otevři: http://localhost:3000
```

---

## Kontrolní seznam před prvním Run

- [ ] `pip install -r backend/requirements.txt`
- [ ] Backend běží (http://localhost:8000/health → ok)
- [ ] Frontend běží (http://localhost:3000)
- [ ] Vytvořena alespoň jedna strategie
- [ ] V strategii existuje `main.py` s třídou dědící z `bt.Strategy`
- [ ] Data `data/mock/NQ_5Y.csv` existují

---

## Další čtení

- **[READMEADAM.md](READMEADAM.md)** — co všechno aplikace umí v UI (Edge finding, validace, exporty).
- **[README.md](README.md)** — API, engine subprocess, Firestore, struktura projektu.
- **[READMEAI.md](READMEAI.md)** — kde v kódu hledat změny.
