"""Robustness sweep export: heatmap cells include metric aggregates; rankingSample includes metrics + heatmapBin."""

import pandas as pd
import pytest

from app.services import engine_inprocess as ei


@pytest.fixture
def eng():
    return ei._get_engine_module()


def test_sweep_heatmap_cells_and_ranking_sample(eng, monkeypatch):
    def fake_run_bt(*_a, strategy_params=None, **_k):
        sp = strategy_params or {}
        ef = float(sp.get("ema_fast", 1))
        es = float(sp.get("ema_slow", 1))
        return {
            "metrics": {
                "finalEquity": 100000.0,
                "maxDrawdownPct": 5.0,
                "profitFactor": 1.2,
                "tradeCount": 10,
                "winRate": 50.0 + ef * 0.05,
                "sortinoRatio": 1.0,
                "totalReturnUsd": ef * 100.0 + es * 10.0,
            }
        }

    monkeypatch.setattr(eng, "run_backtest", fake_run_bt)

    data = pd.DataFrame({"open": list(range(50)), "close": list(range(50))})
    base = {"ema_fast": 10.0, "ema_slow": 30.0}
    sweep_cfg = {
        "max_samples": 80,
        "holdout_ratio": 0.0,
        "param_ranges": {
            "ema_fast": {"min": 5.0, "max": 15.0},
            "ema_slow": {"min": 20.0, "max": 40.0},
        },
    }
    out = eng._run_sweep_robustness(
        object(),
        data,
        "",
        "NQ",
        base,
        "grid",
        sweep_cfg,
    )
    assert out.get("tested", 0) > 0
    hm = out.get("heatmap")
    assert isinstance(hm, dict)
    cells = hm.get("cells")
    assert isinstance(cells, list) and len(cells) == 36
    non_empty = [c for c in cells if isinstance(c, dict) and c.get("count", 0) > 0]
    assert non_empty
    for key in ("avgTotalReturnUsd", "avgWinRate", "avgScore", "bestScore", "maxTotalReturnUsd"):
        assert key in non_empty[0]

    rs = out.get("rankingSample")
    assert isinstance(rs, list) and rs
    row0 = rs[0]
    assert "metrics" in row0 and isinstance(row0["metrics"], dict)
    assert "totalReturnUsd" in row0["metrics"]
    assert "heatmapBin" in row0
    assert "xBin" in row0["heatmapBin"] and "yBin" in row0["heatmapBin"]
    hists = out.get("histograms")
    assert isinstance(hists, dict)
    assert isinstance(hists.get("score"), dict) and hists["score"].get("counts")
    assert isinstance(hists.get("totalReturnUsd"), dict) and hists["totalReturnUsd"].get("counts")
    ss = out.get("sweepSummary")
    assert isinstance(ss, dict) and "profitableFraction" in ss
    assert isinstance(out.get("paramSensitivity"), dict)
