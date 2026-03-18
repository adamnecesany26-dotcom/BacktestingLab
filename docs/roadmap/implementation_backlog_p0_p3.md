# Implementation Backlog (P0-P3)

This document turns the dual audit into execution backlog with acceptance criteria.

## P0 - Security and Determinism

- Move all user module execution into Docker engine.
- Introduce per-run isolation in `.backtest_run/<run_id>`.
- Add strict path traversal protection for uploaded strategy files.
- Enforce unified request validation before stream/non-stream divergence.
- Add run correlation metadata (`runId`, manifest snapshot).

### Acceptance Criteria

- No user Python code is executed on backend host outside Docker.
- Parallel runs do not share files and cannot overwrite each other.
- Traversal attempts (`../`) are rejected.
- `runId` is present in result payload and persisted to run history.

## P1 - Intraday Correctness

- Preserve full ISO timestamps in view and module output payloads.
- Keep numeric precision in backend calculations and round only in UI.
- Add trade metadata fields (`fees`, `barsHeld`, `holdingMinutes`).
- Ensure detailed chart marker alignment for intraday dates.

### Acceptance Criteria

- Intraday overlays are plotted on exact bars when data contains time.
- Trade payload includes new metadata fields without breaking old runs.

## P2 - Trader Productivity

- Persist run manifest snapshot with request context.
- Make run records collision-safe (no second-level timestamp IDs).
- Prepare run comparison and experiment metadata extension points.

### Acceptance Criteria

- Saved run entries include `runId` + `manifest`.
- Run IDs remain unique during rapid consecutive runs.

## P3 - Performance and Observability

- Define telemetry fields for runtime and failure categorization.
- Add data endpoint caching strategy and lightweight response options.
- Add run-history pagination/filter strategy for large histories.

### Acceptance Criteria

- Team has measurable counters for run throughput and failure types.
- Roadmap provides explicit implementation slices and rollout order.
