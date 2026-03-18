# Intraday Correctness and Golden Test Plan

## Objectives

- Preserve full timestamp fidelity from data source to chart rendering.
- Ensure entry/exit markers and overlays align with exact bars.
- Keep backend calculations high precision; round only on presentation layer.

## Implemented Baseline

1. Full ISO timestamps in view API outputs
   - `backend/app/api/view.py` now normalizes dates with full ISO, not day-only truncation.

2. Full ISO timestamps in module outputs from engine
   - `backend/docker/engine.py` emits marker/line/zone timestamps as full ISO.

3. Trade metadata extensions
   - Added `fees`, `barsHeld`, `holdingMinutes` fields to trade payload model.

## Golden Test Matrix (to automate)

1. Daily baseline
   - Fixed seed data, fixed strategy params.
   - Verify exact trade count, final equity, drawdown, MFE/MAE.

2. Intraday precision
   - 1m or 5m dataset with known entry/exit timestamps.
   - Verify marker timestamp equality and rectangle bounds by entry/exit prices.

3. Edge case bars
   - Same-day multiple trades.
   - Gap bars around entry/exit.
   - Long and short with symmetric checks for MAE/MFE.

4. Serialization contracts
   - Assert `date` fields include time component when source data contains time.

## Suggested Automation Targets

- Backend: pytest contract tests for `/api/run` and `/api/view`.
- Frontend: lightweight snapshot/integration tests for `ModuleOutputChart`.
