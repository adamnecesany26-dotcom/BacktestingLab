# 2026-04-07 — S/D Strategy Audit: H/L artifacts, parity, hangs, production readiness

## Executive summary

Priority goal: **production-ready, credible Supply/Demand strategy** built on **H/L** (swings + majors + internals + BOS + trend) and **S/D zones** (dependent on H/L), using **precomputed artifacts** to avoid multi-hour runs.

This audit focuses on the gap between the **intended architecture** (artifacts as the source of truth for backtest) and the **observed problems** (build “stuck”, terrible swing density, missing inheritance, live 500s, live vs artifacts mismatch).

## Current ground truth (code-level)

### View “6M window” is implemented via `years`, not `start_iso/end_iso`
- UI “Období zobrazení” uses `years` (6M = `0.5`) and sends it to `POST /api/view`.
- File: `frontend/components/StrategyViewChart.tsx`

### Artifact build is always computed on the **full dataset**, regardless of View window
- `POST /api/artifacts/build` orchestrator explicitly treats build as “full file”. It does **not** build “6M artifacts”; it builds **whole-file** artifacts.
- Files: `backend/app/api/artifacts.py`, `backend/app/services/artifact_api_service.py`, `backend/app/services/hl_precompute.py`, `backend/app/services/sd_precompute.py`

### Why “Live 6M” and “Artifacts full dataset” cannot be identical
There are two different computations:
- **Live View**: module runs on **windowed OHLC** (e.g., last 6 months).
- **Artifacts View**: markers/zones are read from **full-series precompute** then mapped onto the current chart slice.

Even if Swing HL uses rolling windows, “compute-on-window” vs “compute-on-full-series then slice” will not match perfectly for structure-dependent logic (BOS acceptance, trend structure, dedupe/injection logic near boundaries).

**So parity expectation must be defined precisely**:
- **Expected parity**: *When live is forced to compute on the full series (`years=0`), it should match artifacts for the same `chart_timeframe` and params*.
- **Not expected**: live with `years=0.5` equals artifacts (full-file) on a 6M chart.

## Repro matrix (what to run, what to expect)

### Dimensions
- **Instrument native timeframe**: `1d` CSV vs `30m` TXT
- **chart_timeframe**: `native`, `1h`, `4h`, `1D`, `1W`
- **window**: `years=0` (full) vs `years=0.5` (6M)
- **source**: live module (`module_code`) vs artifacts (`use_artifacts=true`)

### Scenarios and expected outcomes

#### Group A — Full-series parity (must be near-identical)
For the same instrument + chart_timeframe:
- **A1**: live with `years=0` vs artifacts (`use_artifacts=true`, `years=0`)  
  **Expected**: swings/majors/internals/BOS counts within tight tolerance; trend line matches length; no systemic shifts.

If A1 fails, the cause is likely one of:
- artifact TF selection is not what you think (e.g. “native 30m” showing 1h artifacts)
- mapping of artifact timestamps/bar_index to chart index
- different params/injected fields between live and precompute

#### Group B — Windowed vs global mismatch (allowed to differ, but must be explainable)
- **B1**: live `years=0.5` vs artifacts `years=0.5`  
  **Expected**: differences are normal; artifacts represent “global structure”, live is “local structure”.
  **Requirement**: UI should explain this clearly and provide a one-click “full-series parity check”.

#### Group C — Intraday artifact TF clarity (must not mislead)
On a native `30m` file:
- **C1**: chart_timeframe=`native`, artifacts enabled  
  **Expected**: If `30m` isn’t built, the system must **explicitly disclose** it is showing `1h` artifacts (fallback).

## Root-cause candidates for your reported issues

### 1) “Build stuck at %”
Most likely:
- **CPU-bound H/L compute** on large intraday files (rolling windows, BOS clustering/merge, trend scoring) with progress only at TF boundaries.
- **File I/O** (multiple Parquet writes per TF).
Potentially:
- **stale lock** on Windows that never clears (lock file + PID handling).

### 2) “Artifacts compute finished but swings are nonsense (1–2 swings for full file)”
Most likely:
- You are **viewing a coarser TF artifact** than you think (notably on intraday: `native` wants 30m but ladder doesn’t build 30m → fallback to 1h).
- Or swing algorithm thresholds are effectively too strict for long-history series (parameter merge problem).

### 3) “Inheritance often doesn’t work (weekly as swing, but not visible as major on daily)”
Most likely:
- Marker mapping in View relies heavily on **timestamp alignment**; if the timestamp lands outside the displayed index due to label semantics or timezone/session shifts, markers are dropped.
- In artifacts mode, API currently removes `bar_index` from markers, forcing UI to map by date.

### 4) “Live view often returns 500”
Most likely true 500 source:
- tz-aware `start_iso/end_iso` compared with tz-naive index can raise `TypeError` (not caught).
- Even if StrategyViewChart doesn’t send ISO windows, other flows or future UI can.

## Production-ready acceptance criteria (recommendation)

### H/L artifacts (per TF) must satisfy basic “density sanity”
Example of simple gates:
- On `1d` for a 5Y dataset: swing count should not be single digits.
- On `1h` over a multi-year intraday dataset: swing count should be non-trivial and scale with bar count.

Gate failures should:
- be written into the H/L manifest as quality diagnostics
- surface as an **artifact banner** in View and as `artifact_status` detail

### Build must be operationally diagnosable
Minimum:
- progress events at sub-steps per TF: resample → swings → majors/internals → BOS → trend → parquet write
- lock failure messages that explain what to do (and whether it’s stale)

## Next implementation steps (what code changes will deliver)
- Fix tz-aware slicing to eliminate real 500s.
- Make artifact TF fallback explicit (especially `30m`→`1h`), so you don’t debug “missing swings” that are just TF mismatch.
- Add H/L quality diagnostics (counts + warnings) into manifests and View banner.
- Improve build SSE progress granularity.
- Add tests for tz slicing + artifacts mapping with ISO windows + TF selection fallback.

