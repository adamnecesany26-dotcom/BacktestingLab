# Finální audit — Backtesting platform

**Datum:** 2026-03-31  
**Primární reference:** `README.md`, `READMEAI.md`, `docs/BACKTEST_PIPELINE_REFACTOR.md` (Příloha C), `backend/app/security.py`, `backend/app/main.py`, `frontend/app/page.tsx`.

---

## 1. FINAL SCORE

**READINESS SCORE: 68%**  
**STATUS: FAIL** (cíl 95 % — nedosaženo)

**Proč ne vyšší:** Dokumentace a funkční hloubka jsou nadprůměrné pro interní research nástroj, ale „produkční připravenost“ v užším smyslu (multi-user, důvěryhodná izolace, minimální plocha pro zneužití, udržitelná frontend architektura, úplná korektnost jádra) **nesplňuje** přísný práh. README explicitně připouští **trusted single-user** a **host execution** — to je koncepční strop, ne drobnost.

---

## 2. CRITICAL ISSUES (MUST FIX)

| Issue | Proč to vadí | Dopad |
|--------|----------------|--------|
| **Spouštění libovolného uživatelského Pythonu na hostu (engine subprocess / in-process)** | Stejný interpretér/OS jako API = RCE při kompromitovaném nebo škleném účtu; in-process sdílí ještě víc stavu. Dokumentace to přiznává — pro „produkt“ mimo důvěřený perimeter je to nepřijatelné. | **Vysoký** (bezpečnost / compliance) |
| **Auth model v praxi často redukován na API klíč + lokální bypass** (`security.py`: lokální klient bez `API_AUTH_KEY`, `dev_unauthenticated`, Bearer bez ověření když klíč není nastaven) | Snadné omylné nasazení s vypnutou nebo slabou autentizací; `X-Actor-Id` je spíš audit štítek než identita. | **Vysoký** (když není nasazeno přísně podle README) |
| **Integrita dat / reproducibility: rychlý fingerprint (mtime+size), ne kryptografický hash** (README § výkon) | Dva různé soubory při stejném mtime/size → kolize; silent nesoulad run vs očekávání. „Stejný běh“ není matematicky garantovaný. | **Střední–vysoký** (pro audit trail a důvěru ve výsledky) |
| **Příloha C pipeline: plán není 100 % — event engine, pravidla zániku zón, částečné fáze** (`docs/BACKTEST_PIPELINE_REFACTOR.md`) | Uživatel může věřit, že „artefakt = stejná pravda jako živý engine“, ale dokument říká opak u části sémantiky. Riziko **falešné jistoty** při srovnávání `use_sd_artifacts` vs legacy. | **Vysoký** (korektnost produktu / sémantika) |
| **Křehkost Backtrader integrace** (bug: `Order` instance ≠ stejný objekt při `notify_order`; oprava přes `ref`) | Ukazuje třídu chyb, které **nemusí** projít testy ani kontrolou equity — tiše rozbitý bracket / meta / `zoneMeta`. Engine je obří (`engine.py`); regrese pravděpodobné. | **Vysoký** (korektnost PnL a metrik) |

---

## 3. HIGH PRIORITY IMPROVEMENTS

- **Prod režim bez kompromisů:** vynutit `API_AUTH_KEY`, zakázat default lokální identity v internetovém nasazení, dokumentovat threat model (jeden uživatel vs tým).
- **Izolace engine:** kontejner per run nebo alespoň striktní subprocess + filesystem jail + resource limits; in-process jen explicitně s varováním.
- **Dataset integrity:** konfigurovatelné SHA-256 (nebo podpis) pro kritické běhy; mtime fingerprint nechat pro dev speed.
- **Rozbití monolitu** `page.tsx` (~1486 řádků): extrahovat hooky (`useRunOrchestration`, `useFirestoreStrategy`, `useBacktestParams`), event bus nebo reducer pro část stavu; snížit kognitivní zátěž a riziko race v `handleRun`.
- **Sjednocení „pravdy“ View vs backtest:** UI copy + guide už částečně řeší; chybí **jedna** uživatelsky viditelná kontrola shody `dataset_id` / years před Run (hard gate nebo jasné potvrzení).
- **SSE hardening:** dokumentovat a testovat odpojení klienta, částečné chunky, `stream_stal` — `runner.py` má idle timeout; ověřit konzistenci stavu UI při všech `type: error` větvích.

---

## 4. MEDIUM / LOW ISSUES (bullets)

- **Frontend:** `BacktestSettings.tsx` ~2k řádků — další údržbový dluh; chybějící striktní `React.memo` na těžkých grafech může škálovat špatně na slabých strojích.
- **API:** CORS `allow_credentials=True` + široké `allow_methods/headers` — OK pro dev; v produkci zúžit.
- **Rate limit:** in-memory, single proces — při horizontálním škálování **ne** sdílený (návrh Redis nebo per-instance limity v docs).
- **Firestore:** veškerá pravidla a konzistence závisí na správné konfiguraci mimo repo; soft-delete a governance komplikují mentální model — dobré pro enterprise, náročné pro solo uživatele.
- **DX:** Parsování Python dict z řetězců ve frontendu (`strategyParams.ts`) — křehké při edge syntaxi; bez formalního AST contractu.
- **Performance:** Backtrader `next()` zůstává hlavní bottleneck (README přiznává); Numba cesty nejsou plně na kritické cestě.

---

## 5. HIDDEN RISKS (IMPORTANT)

- **„Readiness / trust“ heuristiky** (`overfittingSignals.ts`, prop red flags) — uživatel může brát zelený banner jako **statistický důkaz**; jsou to heuristiky. Produktové riziko: **špatné obchodní rozhodnutí** kvůli UI důvěře.
- **In-process engine + globální lock** — správně pro single-user; při budoucím paralelním API bez přepnutí na subprocess vzniknou **deadlock / stav** chyby.
- **Batch / portfolio / sweep** — násobí multiple-testing; UI má povědomí, ale lidský faktor stále vede k „nejlepší řádek tabulky“.
- **Detailed + artefakty** — druhý zdroj geometrie; při opomenutí Build features vizuálně „něco chybí“ bez fatální chyby.
- **R-multiple / zoneMeta** — část obchodů nemusí mít kompletní metadata; metriky mohou být **selektivně neúplné** bez výrazného UI křiku u každého řádku.

---

## 6. BEST NEXT STEPS (ACTION PLAN)

1. **Bezpečnostní profil nasazení:** checklist (`audit/DEPLOYMENT_CHECKLIST.md`) — API_AUTH_KEY, žádný dev bypass v produkci, CORS, síťová izolace.
2. **Korektnost engine:** golden integrační testy (`backend/tests/test_engine_sd_zone_zone_meta.py`) — obchody + `zoneMeta` + regrese `Order.ref`.
3. **Dokumentovat mezery Přílohy C** přímo v UI u `use_sd_artifacts` (volitelný další krok).
4. **Refactor page.tsx:** fáze 1 — viz `docs/REFACTOR_PAGE_TSX_PHASE1.md` + první extrahované hooky.

---

## Audit areas A–J (stručně)

**A. UI/UX** — Silné: guide, help popovers, verdict row, shortcuts. Slabé: vysoká složitost pravého panelu, skryté závislosti (artefakty, moduly).

**B. Workflow / product logic** — E2E logika existuje; mrtvé konce u Build / `dataset_id`; shoda View vs backtest bez vynucení.

**C. Frontend architektura** — `page.tsx` monolit = špatná škálovatelnost údržby; Plotly + velké payloady = výkon na slabých zařízeních.

**D. Backend / API** — Konzistence rozumná; SSE má stall handling; security OK pro single-instance, ne multi-tenant bez práce.

**E. Engine / core** — Velká plocha chyb; determinismus částečně (seed); fingerprint slabší než hash.

**F. Data flow** — Mnoho hran; desync editor / run / artefakty — částečně v docs.

**G. Performance** — Cache a vectorizace reálné; Backtrader O(bars); sync artifact build.

**H. Reliability** — Lock pro in-process; bez sandboxu = single point of trust.

**I. Developer experience** — README výborné; `engine.py` monolit těžký; `strategyParams` parse křehký.

**J. Product risks** — Přecenění metrik a trust banneru; artefakt vs live.

---

## Závěr

**Jako jediný výzkumník na vlastním stroji s plnou kontrolou: ano, s opatrností a po přečtení Přílohy C.**  
**Jako víceuživatelský cloud bez izolace a tvrdé auth: ne.**
