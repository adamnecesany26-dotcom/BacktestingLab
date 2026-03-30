# Security Hardening Spec (Runner + Engine)

> **2026 update:** The app no longer uses Docker by default. The engine runs as a **host subprocess** with the same privileges as the FastAPI process. Sections below about container flags are **historical** unless you reintroduce a container runtime.

## Scope

Backend files:

- `backend/app/services/runner.py`
- `backend/docker/engine.py`
- `backend/app/models/run.py`

## Implemented Changes

1. Request limits and validation
   - Added constraints for `years`, `slippage_perc`, `commission_perc`, and payload sizes.
   - Added model-level validation to reject empty code/files payloads.

2. Path traversal protection
   - Added `_safe_join_run_path()` in runner.
   - Rejects unsafe relative paths and enforces writes inside run directory.

3. Per-run isolation
   - Each run now gets unique folder `.backtest_run/<run_id>`.
   - Full run folder cleanup after completion.

4. In-container module execution
   - Moved `applied_modules` output computation into engine runtime.
   - Runner no longer executes user module code on host.

5. Container hardening additions
   - Added `--pids-limit=256`, `--security-opt no-new-privileges:true`, `--cap-drop ALL`.
   - Added `PYTHONDONTWRITEBYTECODE=1` to reduce container file writes.

## Follow-up Hardening (Next Increment)

- Add dedicated non-root user in Docker image.
- Switch to read-only rootfs and tmpfs for writable paths.
- Add payload byte-size cap at HTTP layer (reverse proxy / middleware).
- Add rate limiting and optional auth for run endpoint.
