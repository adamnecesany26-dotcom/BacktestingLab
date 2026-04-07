# Refaktor `frontend/app/page.tsx` — fáze 1

**Cíl:** Shodit kognitivní zátěž a riziko race podmínek v `handleRun`, **bez** nových produktových feature. Stav z března 2026.

## Hotovo (fáze 1a)

- **`frontend/lib/backtestPageUtils.ts`** — `ohlcExportBarIndices`, `strategyParamTouchedFromBaseline`, `buildBacktestSavePayload` (stejná sémantika jako dříve v `page.tsx`).
- **`frontend/hooks/useBacktestExecutionParams.ts`** — typ `BacktestExecutionParamsState`, výchozí hodnoty, hook `useBacktestExecutionParams()` pro state broker/capital/timeouts.

## Plánované hooky (fáze 1b–1c)

### `useBacktestExecutionParams` (hotovo)

Jediný zdroj pravdy pro `initial_capital`, komise, typ instrumentu, tick/lot/pip, `run_timeout_sec`. `page.tsx` pouze spotřebovává `[backtestParams, setBacktestParams]`.

### `useHomeDataCatalog` (další krok)

- Načtení `getAvailableData()`, stavy `instruments`, `instrumentsLoaded`, `dataLoadError`.
- **Neřeší** výběr souborů ani roky — zůstává v page, dokud neuzavřeme závislosti na `backtestParams.instrumentType` a `years`.

### `useFirestoreStrategySession` („Firestore strategy“)

- `openItem`, `files`, `selectedFile`, `fileContent`, `loadFiles`, `loadFileContent`, `handleSaveFile`, sidebar strategie.
- Úzké vazby: `indicators` / `modules` pro speciální `indicator:` / `module:` pseudo-soubory — extrahovat až se stabilizuje rozhraní.

### `useRunOrchestration` (největší kus)

- Vstupy (readonly / refs): `runLockRef`, `strategyParamsBaselineRef`, `runHistory`, `moduleIdsForParamPanels`, `transitiveModuleIdSet`, `edgeSettings`, `years`, `selectedInstruments`, `selectedInstrument`, řezy Firestore kódu (`files`, `fileContent`, `selectedFile`).
- Výstupy: `handleRun`, `handleStopRun`, případně `{ isRunning, runProgress, abortController }` pokud se přesune i ten state.

**Doporučený postup:** nejdřív vytáhnout čisté funkce bez hooků (`buildRunRequestFromPageState`, normalizace větví / experiment) do `lib/runRequestBuilder.ts`, pak obalit `useCallback` v tenkém hooku — sníží se diff a testovatelnost.

### Typovaný run state machine (fáze 2 / volitelně 1d)

- Stav: `idle | preparing | streaming | saving | error | stopped`.
- Přepínání jen na konci `try/catch/finally` v `handleRun` a v SSE callbacku při fatální chybě — dokumentovat v READMEAI, až bude implementováno.

## Co záměrně neměnit v 1. běhu

- Žádné změny copy, UX gate pro dataset, ani nové API.
- `BacktestSettings.tsx` zůstává monolit — samostatná vlna.

## Odkazy

- Audit: `audit/2026-03-31-final-readiness-audit.md` (sekce frontend architektura).
- Engine integrita: `backend/tests/test_engine_sd_zone_zone_meta.py`.
