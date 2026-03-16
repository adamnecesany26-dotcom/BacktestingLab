"""
H/L (High/Low) detection module - template for View chart.
Use in Strategy View: select this module to see markers on the candlestick chart.

Interface:
  def detect(ohlc: pd.DataFrame) -> list[dict]:
      Returns [{"date": "YYYY-MM-DD", "type": "high"|"low", "value": float}, ...]
"""

import pandas as pd


def detect(ohlc: pd.DataFrame) -> list[dict]:
    """
    Detect swing highs and lows using a simple N-bar window.
    High: bar's high is max of window
    Low: bar's low is min of window
    """
    if ohlc is None or len(ohlc) < 5:
        return []

    window = 5
    results = []

    for i in range(window - 1, len(ohlc)):
        start = i - window + 1
        end = i + 1
        window_highs = ohlc["high"].iloc[start:end]
        window_lows = ohlc["low"].iloc[start:end]

        if ohlc["high"].iloc[i] >= window_highs.max():
            date_str = ohlc.index[i].strftime("%Y-%m-%d") if hasattr(ohlc.index[i], "strftime") else str(ohlc.index[i])[:10]
            results.append({"date": date_str, "type": "high", "value": float(ohlc["high"].iloc[i])})
        if ohlc["low"].iloc[i] <= window_lows.min():
            date_str = ohlc.index[i].strftime("%Y-%m-%d") if hasattr(ohlc.index[i], "strftime") else str(ohlc.index[i])[:10]
            results.append({"date": date_str, "type": "low", "value": float(ohlc["low"].iloc[i])})

    return results
