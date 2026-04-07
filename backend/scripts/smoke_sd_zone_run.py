"""Smoke run sd_zone_strategy: dokončení bez chyby, počet obchodů, TP vs SL z fill cen."""
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

    years = os.environ.get("SMOKE_SD_YEARS", "0.25").strip() or "0.25"

    params = {
        "zone_timeframes": "1d",
        "prefer_higher_tf": True,
        "exec_timeframe": "30m",
        "entry_model": "limit",
        "entry_mode": "edge",
        "entry_pct": 0.5,
        "target_rr": 1.5,
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
            "YEARS": years,
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
            "RUN_ID": "smoke_sd_zone_run",
            "RUN_SEED": "42",
            "CODE_DIGEST": "",
            "ACTOR_ID": "smoke",
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
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    wall = time.perf_counter() - t0

    err_log = backend.parent / ".backtest_run" / "smoke_sd_zone_stderr.log"
    try:
        err_log.parent.mkdir(parents=True, exist_ok=True)
        err_log.write_text(proc.stderr or "", encoding="utf-8")
    except OSError:
        pass

    print(f"engine_returncode={proc.returncode} wall_sec={round(wall, 3)} years={years}")
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-2000:].encode("ascii", "replace").decode("ascii")
        print("stderr_tail_ascii:\n", tail, sep="")
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
        print("No JSON result in stdout")
        sys.exit(1)
    if out.get("error"):
        print("Engine error field:", str(out["error"])[:1500])
        sys.exit(1)

    dump_path = backend.parent / ".backtest_run" / "smoke_sd_zone_last.json"
    try:
        dump_path.parent.mkdir(parents=True, exist_ok=True)
        dump_path.write_text(json.dumps(out, indent=2, default=str)[:500_000], encoding="utf-8")
    except OSError:
        pass

    m = out.get("metrics") or {}
    trades: list = out.get("trades") or []
    tc = int(m.get("tradeCount") or 0)
    print(f"trade_count={tc} total_return_usd={m.get('totalReturnUsd')}")

    near = []
    for t in trades:
        zm = t.get("zoneMeta") if isinstance(t.get("zoneMeta"), dict) else None
        ex = t.get("exitPrice")
        en = t.get("entryPrice")
        if zm is None or ex is None or en is None:
            continue
        st = zm.get("stopPrice")
        tg = zm.get("targetPrice")
        if st is None or tg is None:
            continue
        exf = float(ex)
        enf = float(en)
        stf = float(st)
        tgf = float(tg)
        is_long = str(t.get("direction", "")).lower() in ("long", "buy", "l")
        if is_long:
            d_sl = abs(exf - stf)
            d_tp = abs(exf - tgf)
        else:
            d_sl = abs(exf - stf)
            d_tp = abs(exf - tgf)
        tick = 0.25
        near.append(
            (
                "tp" if d_tp <= d_sl + tick * 2 else "sl",
                d_tp,
                d_sl,
                float(t.get("pnl") or 0),
            )
        )

    if trades:
        wins = sum(1 for t in trades if float(t.get("pnl") or 0) > 0)
        losses = sum(1 for t in trades if float(t.get("pnl") or 0) < 0)
        print(f"wins={wins} losses={losses} with_zone_targets={len(near)}")
        if near:
            tp_like = sum(1 for x in near if x[0] == "tp")
            sl_like = sum(1 for x in near if x[0] == "sl")
            print(f"exit_near_target_vs_stop_approx: tp_like={tp_like} sl_like={sl_like}")
    if tc == 0:
        print("WARNING: zero trades — zvets SMOKE_SD_YEARS nebo zkontroluj data/filtery.")
        sys.exit(2)

    if not near:
        print("WARNING: missing zoneMeta stop/target on trades; nelze overit TP/SL presne.")
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    main()
