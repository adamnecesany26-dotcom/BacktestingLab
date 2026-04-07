"""
Chart OHLC for /api/view must match H/L precompute ``df_chart`` (Swing_HL._resample_ohlc).

View dříve vždy volalo pandas ``resample()`` i když precompute pro stejný TF vrací nativní řadu beze změny
(např. 1D graf nad denními daty) → jiná délka indexu / jiné časové značky → téměř žádné markery z cache.
"""

from __future__ import annotations

import pandas as pd

from app.services.hl_precompute import get_swing_hl_module


def apply_view_chart_timeframe_hl_parity(df: pd.DataFrame, chart_timeframe: str | None) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    if chart_timeframe is None:
        return df
    s = str(chart_timeframe).strip()
    if not s or s.lower() == "native":
        return df
    sh = get_swing_hl_module()
    inferred = sh._infer_data_timeframe(df)
    ctf = sh._canonical_chart_tf(s)
    return sh._resample_ohlc(df, ctf, inferred, source_tf_effective=inferred)
