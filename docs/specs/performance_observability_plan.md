# Performance and Observability Plan

## Goals

- Reduce time-to-feedback for iterative backtesting.
- Improve operational visibility for failures and bottlenecks.

## Baseline Observability Added

- Run correlation through `runId` across runner and engine payload.
- Manifest snapshot to persist run context for postmortem analysis.

## Implementation Roadmap

### 1) Telemetry primitives

- Standard structured fields on logs:
  - `run_id`
  - `phase` (prepare, engine_spawn, stream, parse_result, cleanup)
  - `duration_ms`
  - `status`

### 2) Data and response optimization

- Cache `/api/data` summary by file mtime.
- Add optional response shaping flags:
  - `include_ohlc`
  - `include_trades`
  - `include_module_outputs`

### 3) Run history scalability

- Add pagination and server-side sorting by `savedAt`.
- Add filters by strategy, instrument, date range, and key metrics.

### 4) Performance test harness

- Benchmark scenarios:
  - small daily dataset
  - large intraday dataset
  - parallel run submissions
- Track p50/p95 for end-to-end latency.

## KPI Targets

- p95 orchestration overhead reduction by 20%.
- >99% successful run completion under normal payload limits.
- <2s run-history load with 1000+ records via pagination.
