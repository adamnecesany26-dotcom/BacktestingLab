import pandas as pd

from app.services.zone_r_validator import analyze_zones_r_multiple


def _make_ohlc(n: int = 200) -> pd.DataFrame:
    # Simple trending series with dips for touches
    idx = pd.date_range("2020-01-01", periods=n, freq="D")
    base = pd.Series(range(n), index=idx).astype(float)
    close = 100.0 + base * 0.1
    open_ = close.shift(1).fillna(close.iloc[0])
    high = pd.concat([open_, close], axis=1).max(axis=1) + 0.5
    low = pd.concat([open_, close], axis=1).min(axis=1) - 0.5
    # inject one dip to touch a demand zone edge
    low.iloc[80] = low.iloc[80] - 3.0
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


def test_zone_r_validator_returns_schema_and_events():
    df = _make_ohlc()
    zones = [
        {
            "name": "Demand",
            "date_start": "2020-01-10",
            "date_end": "2020-12-31",
            "start_idx": 10,
            "end_idx": len(df) - 1,
            "pivot_idx": 10,
            "value_low": float(df["low"].iloc[10]) - 0.2,
            "value_high": float(df["low"].iloc[10]) + 0.2,
        }
    ]
    out = analyze_zones_r_multiple(df, zones, {"mfe_cap_R": 10, "departure_margin_atr": 0.0})
    assert isinstance(out, dict)
    assert "summary" in out and "zones" in out
    assert isinstance(out["zones"], list) and len(out["zones"]) == 1
    row = out["zones"][0]
    assert "zone_id" in row and isinstance(row["zone_id"], str)
    assert "zone_meta" in row and "zone_agg" in row and "touch_events" in row
    assert row["zone_meta"]["name"] == "Demand"
    assert isinstance(row["touch_events"], list)

