# Skripty a příkazy 

Přehled všech důležitých příkazů, jak spustit aplikaci, co dělat při problémech a tipy pro vývoj.

---

## Prerekvizity

Před prvním spuštěním potřebuješ:

- **Node.js 18+** – [nodejs.org](https://nodejs.org)
- **Python 3.11+** – [python.org](https://python.org)
- **Docker Desktop** – [docker.com](https://docker.com) (musí běžet na pozadí)

---

## První spuštění (setup)

### 1. Sestavit Docker obraz (jednou)

```powershell
cd c:\Users\adamn\Desktop\Backtesting_app\backend\docker
docker build -t backtest-engine .
```

**Kdy znovu:** Po změně `engine.py`, `Dockerfile` nebo `requirements.txt` v `backend/docker/`.

---

### 2. Backend – virtuální prostředí a závislosti

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

Potřebuješ **2 terminály** (Docker Desktop musí běžet).

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
| `python -m pytest` | Spustí testy (pokud existují) |

### Docker

| Příkaz | Popis |
|--------|-------|
| `docker build -t backtest-engine .` | Sestaví obraz (v `backend/docker/`) |
| `docker images` | Zobrazí seznam obrazů |
| `docker ps -a` | Zobrazí kontejnery (včetně zastavených) |

---

## Co dělat když…

### Aplikace se nenačte (bílá stránka)

1. Zkontroluj, že frontend běží: `npm run dev` v `frontend/`
2. Otevři DevTools (F12) → Console – hledej chyby
3. Zkontroluj, že backend běží: otevři http://localhost:8000/health – měl by vrátit `{"status":"ok"}`

---

### Run nefunguje / „Docker failed“

1. **Docker Desktop běží?** – musí být spuštěný
2. **Obraz existuje?**
   ```powershell
   docker images
   ```
   Měl bys vidět `backtest-engine`. Pokud ne:
   ```powershell
   cd backend\docker
   docker build -t backtest-engine .
   ```
3. **Data existují?** – soubor `data/mock/NQ_5Y.csv` musí být na místě
4. **Backend logy** – v terminálu s uvicorn uvidíš chyby z Dockeru

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
- Backend předává stderr z Dockeru
- Zkontroluj logy – měl bys vidět traceback

---

### Progress bar se nehýbe / zůstane na 0

- Engine posílá `PROGRESS:10`, `PROGRESS:20`, … na stderr
- Pokud backtest padne hned na začátku, progress se nezmění
- Zkontroluj logy – co přesně engine vypisuje

---

### Chci zastavit běžící backtest

- Klikni na **Zastavit** v loading overlay
- Nebo zavři záložku (request se zruší, backend ukončí Docker)

---

## Edge cases a tipy

### Změnil jsem engine.py – co teď?

```powershell
cd backend\docker
docker build -t backtest-engine .
```

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

### Docker build padá

- Zkontroluj, že jsi v `backend/docker/`
- Zkontroluj, že existují `Dockerfile`, `engine.py`, `requirements.txt`

---

### Firestore – prázdný seznam strategií

- Normální při prvním spuštění
- Klikni „Vytvořit strategii“ a vytvoř první

---

### Export nefunguje

- Export je aktivní jen když máš výsledky (po úspěšném Run)
- Klikni pravým na „Export“ a zkontroluj, že se stahuje JSON

---

## Struktura příkazů (cheat sheet)

```
# První setup
cd backend\docker && docker build -t backtest-engine .
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

- [ ] Docker Desktop běží
- [ ] Obraz `backtest-engine` je sestaven
- [ ] Backend běží (http://localhost:8000/health → ok)
- [ ] Frontend běží (http://localhost:3000)
- [ ] Vytvořena alespoň jedna strategie
- [ ] V strategii existuje `main.py` s třídou dědící z `bt.Strategy`
- [ ] Data `data/mock/NQ_5Y.csv` existují
