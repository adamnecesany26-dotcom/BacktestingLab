# Backtest engine scripts (host execution)

`engine.py` and `view_engine.py` are run **on the host** via the same Python interpreter as the FastAPI app (`subprocess`). The **Docker image is no longer required** for normal operation.

Optional: you can still build the old image for reference; it is not used by `runner.py` or `/api/view`.
