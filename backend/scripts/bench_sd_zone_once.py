"""One-off S/D zone strategy benchmark (host engine subprocess — avoids bt_engine_host Strategy __module__)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

def main() -> None:
    backend = Path(__file__).resolve().parent.parent
    proj = backend.parent

    strategy = str((proj / "strategies" / "sd_zone_strategy" / "main.py").resolve())
    data_path = str((proj / "data").resolve())
    cache_path = str((proj / ".backtest_cache").resolve())
    Path(cache_path).mkdir(parents=True, exist_ok=True)

    params = {
        "zone_timeframes": "1d",
        "prefer_higher_tf": True,
        "exec_timeframe": "30m",
        "entry_model": "limit",
        "entry_mode": "edge",
        "entry_pct": 0.5,
        "target_rr": 1.5,
        # Align s výchozím PARAMS ve strategii — příliš malé okno (60) často vygeneruje 0 obchodů na krátkém úseku.
        "zone_max_bars": 6000,
        "require_inducement": False,
        "stop_offset_pct": 0.10,
        "trend_filter_enabled": False,
        "max_base_length": 0,
    }
    roots = f"{proj}{os.pathsep}{backend}"
    pp = os.environ.get("PYTHONPATH", "").strip()
    py_path = f"{roots}{os.pathsep}{pp}" if pp else roots

    env = os.environ.copy()
    env.update(
        {
            "STRATEGY_PATH": strategy,
            "DATA_PATH": data_path,
            "DATA_CACHE_PATH": cache_path,
            "INSTRUMENT": "NQ",
            "TIMEFRAME": "30m",
            # Default ~0.12 y aby často vznikl alespoň 1 obchod (0.08 často 0 kvůli řídkému 1D + limit logice).
            "YEARS": os.environ.get("BENCH_SD_YEARS", "0.12"),
            "DATA_FILE": "futures_30m/NQ.txt",
            "INITIAL_CAPITAL": "100000",
            "SLIPPAGE_PERC": "0.001",
            "COMMISSION_PERC": "0.0002",
            "INSTRUMENT_TYPE": "futures",
            "TICK_SIZE": "0.25",
            "VALUE_PER_TICK": "5",
            "STRATEGY_PARAMS": json.dumps(params),
            "APPLIED_MODULES": "[]",
            "ANALYSIS_CONFIG": "{}",
            "EXECUTION_MODEL_JSON": json.dumps({"commission_mode": "percentage"}),
            "RUN_ID": "bench_sd_zone_once",
            "RUN_SEED": "42",
            "CODE_DIGEST": "",
            "ACTOR_ID": "bench",
            "PYTHONPATH": py_path,
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )

    engine_py = backend / "docker" / "engine.py"
    t0 = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, str(engine_py)],
        env=env,
        cwd=str(backend),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    wall = time.perf_counter() - t0

    if proc.returncode != 0:
        print("engine exit", proc.returncode)
        sys.exit(proc.returncode)

    out = None
    for line in reversed((proc.stdout or "").splitlines()):
        s = line.strip()
        if len(s) > 50 and s.startswith("{") and s.endswith("}"):
            try:
                cand = json.loads(s)
            except json.JSONDecodeError:
                continue
            if isinstance(cand, dict) and ("metrics" in cand or "manifest" in cand):
                out = cand
                break
    if out is None:
        print("No JSON result in engine stdout (strategy prints to stdout break naive parse).")
        sys.exit(1)

    if out.get("error"):
        print("Engine error:", str(out["error"])[:2000])
        sys.exit(1)

    m = out.get("metrics") or {}
    man = out.get("manifest") or {}
    perf = out.get("perf") or {}
    print("bench_sd_zone_once")
    print("  wall_clock_sec:", round(wall, 3))
    print("  trade_count:", m.get("tradeCount"))
    print("  total_return_usd:", m.get("totalReturnUsd"))
    print("  bars_out:", man.get("barsOut"), "data_file:", man.get("dataFile"))
    print("  data_load_ms:", perf.get("dataLoadMs"), "resample_ms:", perf.get("resampleMs"))


if __name__ == "__main__":
    main()
