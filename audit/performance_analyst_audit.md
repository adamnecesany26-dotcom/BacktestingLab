# Performance & škálování — audit (senior performance engineer)

**Datum:** 2026-03-23  
**Rozsah:** Backend runner, Docker engine, data pipeline, batch/API, frontend náročnost.  
**Trading logika:** mimo scope — hodnotím **výkon platformy**.

**Jednovětý verdikt:** Aplikace je **funkčně správně postavená pro izolaci a bezpečnost běhu**, ale **architektura je nákladná**: každý run platí daň **procesem / importy / Backtrader smyčkou**; parametr test a sweep **násobí** stejnou práci lineárně. **Není to plýtvání bez důvodu** — je to **cena volby stacku**. Pro „maximum výkonu za minimum zdrojů“ je to **pod průměrem** specializovaných research nástrojů.

---

## 1) Největší bottlenecky (co reálně zabíjí výkon)

| # | Bottleneck | Proč |
|---|------------|------|
| 1 | **Backtrader + Python `next()` po barech** | Obecná event-driven simulace v CPythonu **není** vektorizovatelná bez přepsání strategie. Hlavní CPU čas typicky tady. |
| 2 | **Nový host proces na každý run** (default) | `subprocess.Popen` + cold import (`backtrader`, strategie, moduly) **před** prvním barem. U krátkých runů na malých datech **dominuje overhead**. |
| 3 | **Param test / walk-forward / sweep** | Každý krok = **celý** `run_backtest` (Cerebro, analyzátory, sběr obchodů). **Žádné** inkrementální přepočty „jen změněné části“. Složitost **O(počet runů × bary)**. |
| 4 | **Načtení dat: pandas + případně full-file SHA-256** | `_read_market_data_file` → `read_csv` / `read_parquet`; při cache miss se do metadat počítá **`_file_sha256` celého souboru** — u GB CSV **druhé plné čtení disku**. |
| 5 | **Disk cache jako `pickle` celého `DataFrame`** | Funguje, ale **pomalé** serializace/deserializace a **velké** soubory oproti Arrow/Parquet cache řádků. |
| 6 | **View režim** | Další **subprocess** (`view_engine.py`), znovu načtení / výpočet OHLC a modulů — **stejná daň** jako backtest z hlediska cold start. |
| 7 | **Frontend: Plotly** | `react-plotly.js` + Plotly bundle je **těžký**; lazy import **pomáhá první paint**, ale interakce a velké trace **sežerou** main thread a paměť. |

---

## 2) Zbytečné výpočty (co se dělá znovu / dvakrát)

- **Každá varianta parametru** spouští kompletní backtest — **očekávané** u obecné strategie, **drahé** pro research s desítkami bodů.
- **Walk-forward:** train + test run na fold → **násobí** bod 1.
- **Fingerprint souboru:** pro `datasetFingerprint` se při cache miss **hashuje celý obsah**, přestože cache klíč už používá **mtime + size** (`_build_cache_key`). Pro lokální invalidaci **stačilo by** konzistentní metadata; full hash je **auditovatelně pevné**, **výkonově drahé** na velkých souborech.
- **Batch režim:** každá položka = **samostatný engine běh** (logicky správně pro izolaci); **žádné** sdílení už nahraného DataFrame mezi procesy → **N× IO a paměť**.

---

## 3) Špatná / drahá rozhodnutí architektury (brzdí škálování)

1. **Subprocess jako default engine** — správné pro **kill na disconnect**, čistý stav, Windows/asyncio realitu v `runner.py`. **Cena:** latence a RAM na proces.
2. **Jeden engine = jedna data pipeline** — škáluješ **horizontálně** počtem procesů (`BATCH_PARALLEL_WORKERS` max **8**), ne **vertikálně** jedním vektorizovaným jádrem.
3. **Výsledný JSON** může nést **velké** pole `ohlc`, `trades`, `equityCurve` — síť a JSON parse na frontendu **rostou** s délkou historie (i když část grafů downsampluje).

---

## 4) Cache — co existuje, co chybí

**Je:**

- **`.backtest_cache/dataset_*.pkl`** — normalizovaný + resamplovaný `DataFrame` pod klíčem (path, mtime, size, years, TF). **Hit = přeskočí** read+resample.
- **S/D feature pipeline** — disk + memo cache pro `get_zones` (`sd_feature_pipeline.py`) — **smysluplné** pro opakované view / stejná data.

**Není:**

- Cache **výsledku** backtestu pro stejný `(digest kódu, params, data fingerprint, analysis config)` — **každý Run znovu počítá**.
- Sdílený **warm worker pool** (procesy s předimportovaným BT) — vždy znovu **od nuly** (kromě opt-in in-process režimu).

---

## 5) Re-exec při změně parametru

**Přepočítává se vše.** Parametr test explicitně volá `run_backtest` v cyklu (`_run_param_test`). **Žádná** diference jen „změněných signálů“.

---

## 6) Multi-instrument a paralelizace

- **Batch:** `asyncio.gather` + `Semaphore(workers)` — **až 8 souběžných** `run_strategy` volání (`run.py`). To jsou **až 8 subprocessů** = **až 8× paměť** pro data + engine.
- **CPU:** Paralelismus **ano**, ale **omezený** číslem 8 a kapacitou stroje. **GIL** neblokuje subprocessy.
- **Jeden run:** jeden proces = **jedno jádro** typicky saturuje Backtrader smyčka.

---

## 7) Paměť

- **Pickle cache** drží **kopii** DataFrame na disku; po načtení **plná** reprezentace v RAM procesu.
- **Velké výsledky** (všechny obchody, OHLC v odpovědi) — držení v paměti backendu po dobu serializace + na klientovi po `JSON.parse`.
- **Leaků** v auditu neřeším bez profileru — rizikové jsou spíš **dlouhé žijící** frontend stavy s velkými výsledky v React state.

---

## 8) API, backend, SSE

- **SSE:** řádky `data: {json}\n\n` — rozumný overhead. Reader v `runner` čte stdout v threadu, **0.5 s timeout** smyčka — **jemný polling**, ne ideální low-latency stream, ale **neblokuje** event loop špatněji než nutné.
- **JSON** velké payloady = **CPU** na serializaci/deserializaci — u megabajtových výsledků **cítíš**.

---

## 9) Frontend

- **EquityChart:** Lightweight Charts + **downsample** (default max ~6000 bodů) — **dobré** rozhodnutí.
- **Plotly** (DetailedChart, ModuleOutputChart, StrategyViewChart, ParamTestAnalytics) — **těžké**; lazy `import()` **neřeší** náklad po načtení.
- **page.tsx** je monolitický — hodně `useMemo`/`useCallback` **pomáhá**, ale **velký strom** komponent při velkém `results` stále **znovu renderuje** podle závislostí.

---

## 10) Škálování (co se stane při růstu)

| Zátěž | Důsledek |
|--------|----------|
| Více dat (řádků) | Lineární zpomalení backtestu; cache prvního načtení + resample **pomůže opakovaným runům**. |
| Více instrumentů (batch) | Až **8 paralelních** procesů — **nárazové** CPU/RAM; můžeš **thrashovat** disk cache. |
| Více paralelních runů (uživatelé) | Stejné — **žádný** centralizovaný queue s fair share; **OS** to řeší hrubě. |
| Hustý param test | **Desítky** plných backtestů v **jednom** engine procesu — CPU dlouho, **UI čeká**. |

---

## 11) Quick wins (nízká složitost, reálný dopad)

1. **`RUN_INPROCESS_ENGINE=1`** tam, kde nepotřebuješ kill subprocessu na disconnect — **ušetříš** fork + import (viz `runner.py`).
2. **Zdrojová data jako Parquet** + časté cache hity — **méně** pandas CSV parse.
3. **Vyhnout se full SHA256** na rutinním loadu: použít **stejný fingerprint jako host** (`HOST_DATASET_FINGERPRINT` / mtime-size) pro `datasetFingerprint` v metadatech, full hash jen na vyžádání „audit export“.
4. **Zmenšit default max batch workers** na slabších strojích nebo **documentovat** RAM = N × velikost datasetu v paměti.
5. **Frontend:** pro velké OHLC **agresivnější downsampling** před předáním do Plotly nebo **server-side** limit řádků pro náhled.

---

## 12) High-impact změny (řádové zrychlení — vysoká cena)

| Změna | Potenciál | Cena |
|--------|-----------|------|
| **Vektorizovaný / Numba engine** pro vybrané strategie | **10×+** na kompatibilní logiku | Přepsání strategií; ztratíš obecnost Backtraderu. |
| **Pool dlouho žijících worker procesů** s předimporty | **2–5×** na latenci malých runů | Složitá správa životního cyklu, stabilita paměti. |
| **Arrow / Polars** v engine bez převodu na pandas pro feed | Teoreticky velké; **Backtrader chce pandas-like** | Prakticky **nekompatibilní** bez fork BT nebo vlastního feedu. |
| **Inkrementální / sdílený výpočet** pro sweep jen u čistě parametrů indikátoru | Závisí na strategii | Vyžaduje **architektonický split** „signály vs exekuce“. |

**Reálné 10×+** pro **obecný** uživatelský Python strategie **bez** přepsání engine: **nečekavej**. Pro **konkrétní** interní strategii mimo BT: **ano**, ale to už není tahle aplikace ve stejné podobě.

---

## 13) Závěr

- **Rychlá?** Na **jeden** střední backtest: **akceptovatelná** po zahřátí cache. Na **research** s WF + param test + batch: **pomalá** — **násobíš** plné runy.
- **Škálovatelná?** **Horizontálně** do počtu jader a RAM **ano, do ~8 paralelních běhů v batch**; **vertikálně** jedním runem **ne** — Backtrader je strop.
- **Efektivní?** **Neplýtvá náhodně** — plýtvá **konzistentně** kvůli **bezpečnému subprocess modelu** a **obecné simulaci**. To je **vědomá daň**, ne bug.

**Kódové reference (pro implementační follow-up):** `backend/app/services/runner.py`, `backend/docker/engine.py` (`load_data`, `_load_file`, `run_backtest`, `_run_param_test`, `_run_validation`, `_run_sweep_robustness`), `backend/app/api/run.py` (`_batch_parallel_workers`), `backend/app/services/sd_feature_pipeline.py`, `frontend/components/charts/EquityChart.tsx`, Plotly v `ModuleOutputChart.tsx` / `StrategyViewChart.tsx`.
