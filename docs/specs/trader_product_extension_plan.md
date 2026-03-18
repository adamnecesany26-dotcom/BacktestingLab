# Trader Product Extension Plan

## Goal

Increase trust and day-to-day usability for strategy research workflows.

## Implemented Foundations

1. Run manifest persistence
   - `RunResponse` now supports `runId` and `manifest`.
   - Frontend saves manifest snapshot with result history.

2. Collision-safe run storage IDs
   - Replaced second-level timestamp IDs with UUID-backed IDs in Firestore saves.

3. Confirmed dependency execution model
   - Run uses applied module/indicator set, aligning user confirmation with actual execution.

## Next Product Increments

1. Experiment ledger
   - Add `note`, `tags`, `hypothesis`, `baseline` fields to saved runs.
   - Add filter/sort UI in Run history.

2. Run comparison view
   - Two-run diff panel:
     - Config diff
     - Metric deltas
     - Trade distribution delta

3. Export 2.0
   - JSON + CSV (trades/equity) + compact HTML/PDF summary.

4. Research governance
   - Dataset fingerprint and code hash in manifest.
   - Quick “re-run with same config” action.
