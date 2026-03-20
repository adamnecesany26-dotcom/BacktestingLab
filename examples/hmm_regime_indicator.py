# -*- coding: utf-8 -*-
"""
Demo indikátor režimu trhu pro View: spodní histogram ve StrategyViewChart.

Výstup z get_line musí být dict s klíčem obsahujícím:
  { "kind": "regime_histogram", "data": [ { "date", "trend", "chop", "high_vol" }, ... ] }

Nebo bez kind, pokud každý řádek má trend/chop/high_vol (0–1); backend pravděpodobnosti normalizuje na součet 1.

Toto je zjednodušený model (rolling volatilita + směr návratů → softmax), ne skutečný HMM —
nahraď fit HMM (např. hmmlearn) podle vlastní metodiky.

VIEW_PARAMS musí být bez inline komentářů za hodnotami v dictu.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

VIEW_PARAMS = {
    "lookback": 20,
    "vol_window": 14,
}

VIEW_PARAMS_META = {
    "lookback": {
        "title": "Okno trendu (bary)",
        "whatItMeans": "Delší okno = hladší odhad směru návratů (proxy trend vs chop).",
    },
    "vol_window": {
        "title": "Okno volatility (bary)",
        "whatItMeans": "Rolling směrodatná odchylka návratů — vstup do stavu „high vol“.",
    },
}


def _softmax3(a: float, b: float, c: float) -> tuple[float, float, float]:
    x = np.array([a, b, c], dtype=float)
    x = x - np.max(x)
    e = np.exp(np.clip(x, -20, 20))
    s = float(e.sum())
    if s <= 0:
        return 1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0
    e = e / s
    return float(e[0]), float(e[1]), float(e[2])


def _row_dates(df: pd.DataFrame) -> list[str]:
    idx = df.index
    out: list[str] = []
    for t in idx:
        if hasattr(t, "isoformat"):
            out.append(pd.Timestamp(t).isoformat())
        else:
            out.append(str(t))
    return out


def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict:
    params = params or {}
    lb = max(3, int(params.get("lookback", VIEW_PARAMS["lookback"])))
    vw = max(2, int(params.get("vol_window", VIEW_PARAMS["vol_window"])))

    df = ohlc.copy()
    close = pd.to_numeric(df["close"], errors="coerce").ffill()
    ret = close.pct_change().fillna(0.0)
    vol = ret.rolling(vw, min_periods=1).std().fillna(0.0)
    trend_strength = ret.rolling(lb, min_periods=1).mean().abs()

    vol_scale = vol.rolling(max(lb * 5, 50), min_periods=1).quantile(0.85).clip(lower=1e-8)
    trend_scale = trend_strength.rolling(max(lb * 5, 50), min_periods=1).quantile(0.85).clip(lower=1e-8)

    vol_n = (vol / vol_scale).clip(0.0, 2.5).fillna(0.0)
    trend_n = (trend_strength.abs() / trend_scale).clip(0.0, 2.5).fillna(0.0)
    chop_raw = (1.0 - (trend_n + vol_n) / 3.0).clip(0.05, 1.0)

    dates = _row_dates(df)
    data: list[dict] = []
    for i in range(len(df)):
        tr = float(trend_n.iloc[i] * 1.15)
        hv = float(vol_n.iloc[i])
        ch = float(chop_raw.iloc[i])
        t_prob, c_prob, h_prob = _softmax3(tr, ch, hv)
        data.append(
            {
                "date": dates[i],
                "trend": t_prob,
                "chop": c_prob,
                "high_vol": h_prob,
            }
        )

    return {
        "Regime": {
            "kind": "regime_histogram",
            "data": data,
        }
    }
