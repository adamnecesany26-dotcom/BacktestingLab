"""
Generate candlestick chart with trade visualization (entry/exit, MFE/MAE) using mplfinance.
"""

import io
from typing import List, Optional, Tuple

import mplfinance as mpf
import pandas as pd
from matplotlib import patches


def _parse_date(s: str) -> Optional[pd.Timestamp]:
    """Parse date string to pandas Timestamp."""
    return pd.Timestamp(s) if s else None


def _get_mfe_mae(
    df: pd.DataFrame,
    entry_ts: pd.Timestamp,
    exit_ts: pd.Timestamp,
    is_long: bool,
) -> Tuple[float, float]:
    """Get MFE and MAE price levels from OHLC between entry and exit."""
    mask = (df.index >= entry_ts) & (df.index <= exit_ts)
    subset = df.loc[mask]
    if subset.empty:
        return 0.0, 0.0
    max_high = subset["high"].max()
    min_low = subset["low"].min()
    return (max_high, min_low) if is_long else (min_low, max_high)


def generate_chart(
    ohlc: List[dict],
    trades: List[dict],
    width: int = 14,
    height: int = 7,
    dpi: int = 100,
) -> bytes:
    """
    Generate PNG chart with candlesticks, entry/exit markers, and MFE/MAE rectangles.
    Returns PNG bytes.
    """
    if not ohlc:
        raise ValueError("No OHLC data")

    df = pd.DataFrame(ohlc)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    df = df[["open", "high", "low", "close"]].astype(float)

    # mplfinance style - green/red candles, dark background
    mc = mpf.make_marketcolors(
        up="green",
        down="red",
        edge="inherit",
        wick="inherit",
        volume="inherit",
    )
    style = mpf.make_mpf_style(
        marketcolors=mc,
        facecolor="#18181b",
        gridcolor="#27272a",
        gridstyle="-",
        rc={
            "axes.labelcolor": "#a1a1aa",
            "xtick.color": "#a1a1aa",
            "ytick.color": "#a1a1aa",
        },
    )

    fig, axlist = mpf.plot(
        df,
        type="candle",
        style=style,
        returnfig=True,
        figsize=(width, height),
    )
    ax = axlist[0]

    for t in trades:
        entry_date = t.get("entryDate") or t.get("date") or ""
        exit_date = t.get("exitDate") or t.get("date") or ""
        entry_price = t.get("entryPrice") or t.get("price", 0)
        exit_price = t.get("exitPrice") or t.get("price", 0)
        is_long = t.get("type") == "buy"

        if not entry_date or not exit_date:
            continue

        entry_ts = _parse_date(entry_date)
        exit_ts = _parse_date(exit_date)
        if entry_ts is None or exit_ts is None or exit_ts < entry_ts:
            continue

        entry_ts = entry_ts.normalize()
        exit_ts = exit_ts.normalize()

        mfe_price, mae_price = _get_mfe_mae(df, entry_ts, exit_ts, is_long)

        # Get x indices for entry and exit (bar index in mplfinance)
        entry_idx = None
        exit_idx = None
        for i, idx in enumerate(df.index):
            d = idx.normalize() if hasattr(idx, "normalize") else idx
            if d >= entry_ts:
                entry_idx = i
                break
        for i, idx in enumerate(df.index):
            d = idx.normalize() if hasattr(idx, "normalize") else idx
            if d >= exit_ts:
                exit_idx = i
                break
        if entry_idx is None:
            entry_idx = 0
        if exit_idx is None:
            exit_idx = len(df) - 1
        if entry_idx < 0 or exit_idx < 0:
            continue

        # Ensure exit >= entry for rectangle width
        if exit_idx < entry_idx:
            exit_idx, entry_idx = entry_idx, exit_idx
        width_bars = max(exit_idx - entry_idx, 0.5)

        # MFE rectangle (green)
        if is_long and mfe_price > entry_price:
            rect = patches.Rectangle(
                (entry_idx - 0.25, entry_price),
                width_bars + 0.5,
                mfe_price - entry_price,
                linewidth=0,
                facecolor="green",
                alpha=0.2,
            )
            ax.add_patch(rect)
        elif not is_long and mfe_price < entry_price:
            rect = patches.Rectangle(
                (entry_idx - 0.25, mfe_price),
                width_bars + 0.5,
                entry_price - mfe_price,
                linewidth=0,
                facecolor="green",
                alpha=0.2,
            )
            ax.add_patch(rect)

        # MAE rectangle (red)
        if is_long and mae_price < entry_price:
            rect = patches.Rectangle(
                (entry_idx - 0.25, mae_price),
                width_bars + 0.5,
                entry_price - mae_price,
                linewidth=0,
                facecolor="red",
                alpha=0.2,
            )
            ax.add_patch(rect)
        elif not is_long and mae_price > entry_price:
            rect = patches.Rectangle(
                (entry_idx - 0.25, entry_price),
                width_bars + 0.5,
                mae_price - entry_price,
                linewidth=0,
                facecolor="red",
                alpha=0.2,
            )
            ax.add_patch(rect)

        # Entry marker (blue dot)
        ax.scatter(
            [entry_idx],
            [entry_price],
            s=80,
            c="#3b82f6",
            zorder=5,
            edgecolors="white",
            linewidths=1,
        )
        ax.annotate(
            "entry long" if is_long else "entry short",
            (entry_idx, entry_price),
            xytext=(0, 8),
            textcoords="offset points",
            fontsize=8,
            color="#3b82f6",
            ha="center",
        )

        # Exit marker (orange dot)
        ax.scatter(
            [exit_idx],
            [exit_price],
            s=80,
            c="#f97316",
            zorder=5,
            edgecolors="white",
            linewidths=1,
        )
        ax.annotate(
            "exit long" if is_long else "exit short",
            (exit_idx, exit_price),
            xytext=(0, -12),
            textcoords="offset points",
            fontsize=8,
            color="#f97316",
            ha="center",
        )

    ax.set_ylim(ax.get_ylim())  # Recompute limits after patches

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", facecolor="#18181b")
    buf.seek(0)
    return buf.getvalue()
