"""
Indikátor EMA pro View – příklad get_line() s VIEW_PARAMS.
Přidej do indikátoru v aplikaci a vyber v View pro zobrazení čáry na grafu.
Ve View params panelu můžeš měnit periodu (např. EMA20 → EMA50).
"""

import pandas as pd

VIEW_PARAMS = {"period": 20}


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict:
    """
    Vrátí jednu čáru EMA s periodou z params.
    Formát: {"název": [{"date": "YYYY-MM-DD", "value": float}, ...], ...}
    """
    params = params or {}
    period = int(params.get("period", 20))
    ema = ohlc["close"].ewm(span=period, adjust=False).mean()

    def to_data(series):
        return [
            {
                "date": ohlc.index[i].strftime("%Y-%m-%d") if hasattr(ohlc.index[i], "strftime") else str(ohlc.index[i])[:10],
                "value": float(series.iloc[i]),
            }
            for i in range(len(ohlc))
        ]

    return {f"EMA{period}": to_data(ema)}
