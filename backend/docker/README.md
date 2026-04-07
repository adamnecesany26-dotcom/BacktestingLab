# Backtest engine scripts (host execution)

`engine.py` and `view_engine.py` are run **on the host** via the same Python interpreter as the FastAPI app (`subprocess` or optional in-process). The **Docker image is no longer required** for normal operation.

## Environment relevant to S/D artifacts

When `use_sd_artifacts=1` in strategy params, `runner.py` sets:

- `USE_SD_ARTIFACTS=1`
- `SD_ARTIFACT_ZONES_PATH` — absolute path to `.../.backtest_artifacts/{dataset_id}/sd/v1/zones.parquet`

When `use_sd_artifacts=0`, the runner sets `USE_SD_ARTIFACTS=0` and removes `SD_ARTIFACT_ZONES_PATH` from the env passed to the engine so host-level env cannot force artifact mode on legacy runs.

Artifact layout and CLI precompute: **`docs/BACKTEST_PIPELINE_REFACTOR.md`** (repo root).

Optional: you can still build the old Docker image for reference; it is not used by `runner.py` or `/api/view`.
