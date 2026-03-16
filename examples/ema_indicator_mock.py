# -*- coding: utf-8 -*-
"""
EMA indicator mock - test View params panel.
Change period and color via View params (no code edit).

Usage:
1. Create new module/indicator in app (e.g. "EMA Mock")
2. Copy this code to main.py
3. Save
4. Go to View tab
5. Select module/indicator
6. In View params change period (20->50) or color (#ff0000)
7. Click Apply
"""

import pandas as pd

VIEW_PARAMS = {
    "period": 20,
    "color": "#3b82f6",  # blue - hex format #rrggbb
}


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict:
    """
    Return one EMA line with period and color from params.
    Format: {name: {"data": [...], "color": "#hex"}}
    """
    params = params or {}
    period = int(params.get("period", 20))
    color = str(params.get("color", "#3b82f6")).strip()
    if not color.startswith("#"):
        color = "#" + color

    ema = ohlc["close"].ewm(span=period, adjust=False).mean()

    data = [
        {
            "date": ohlc.index[i].strftime("%Y-%m-%d") if hasattr(ohlc.index[i], "strftime") else str(ohlc.index[i])[:10],
            "value": float(ema.iloc[i]),
        }
        for i in range(len(ohlc))
    ]

    return {f"EMA{period}": {"data": data, "color": color}}
