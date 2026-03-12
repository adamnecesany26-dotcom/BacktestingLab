"""
Strategy Runner - orchestrates Docker container execution.
Creates temp dir, writes strategy, runs container, parses results.
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path

from app.models.run import RunResponse, BacktestMetrics, Trade


async def run_strategy(code: str, instrument: str, timeframe: str) -> RunResponse:
    """
    Execute strategy in Docker sandbox.
    1. Create temp run directory
    2. Write strategy.py
    3. Run docker container
    4. Parse JSON output
    """
    with tempfile.TemporaryDirectory(prefix="backtest_run_") as run_dir:
        strategy_path = Path(run_dir) / "strategy.py"
        strategy_path.write_text(code, encoding="utf-8")

        # Resolve data directory (relative to backend)
        backend_root = Path(__file__).resolve().parent.parent.parent
        data_dir = backend_root / "data"

        # Ensure data dir exists
        data_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            "docker", "run",
            "--rm",
            "--memory=512m",
            "--cpus=1",
            "--network", "none",
            "-v", f"{run_dir}:/app/strategy:rw",
            "-v", f"{data_dir}:/app/data:ro",
            "-e", f"INSTRUMENT={instrument}",
            "-e", f"TIMEFRAME={timeframe}",
            "backtest-engine",
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            err_msg = stderr.decode() if stderr else "Unknown error"
            raise RuntimeError(f"Docker run failed: {err_msg}")

        try:
            data = json.loads(stdout.decode())
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from engine: {e}")

        return RunResponse(
            equity=data.get("equity", []),
            metrics=BacktestMetrics(**data.get("metrics", {})),
            trades=[Trade(**t) for t in data.get("trades", [])],
        )
