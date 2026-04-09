"""View: trend z 1d/1M artefaktu přes merge_asof na chart_index (4h view)."""
from __future__ import annotations

import pandas as pd

from app.services.view_artifacts import _htf_trend_source_tf_key, _trend_line_merge_htf_to_chart


def test_htf_trend_source_tf_key():
    assert _htf_trend_source_tf_key("1M") == "1M"
    assert _htf_trend_source_tf_key("1w") == "1M"
    assert _htf_trend_source_tf_key("4h") == "1d"
    assert _htf_trend_source_tf_key("1d") == "1d"


def test_trend_line_merge_htf_to_chart_matches_bar_count():
    idx_4h = pd.date_range("2024-06-03", periods=40, freq="4h", tz="UTC")
    idx_1d = pd.date_range("2024-06-03", periods=12, freq="1D", tz="UTC")
    rows = []
    for i, ts in enumerate(idx_1d):
        rows.append({
            "bar_index": i,
            "iso_time": ts.isoformat(),
            "line_value": 100.0 + float(i),
            "score": 10.0,
            "state": "RANGE",
        })
    htf_df = pd.DataFrame(rows)
    line = _trend_line_merge_htf_to_chart(htf_df, idx_4h)
    assert line is not None
    assert len(line["data"]) == len(idx_4h)
