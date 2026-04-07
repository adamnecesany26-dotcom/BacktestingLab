"""Pravidla Major zdrojů podle TF (BACKTEST_PIPELINE_REFACTOR)."""

import pytest

from app.services.hl_artifact_spec import (
    MAJOR_SOURCES_BY_CHART_TF,
    PRECOMPUTE_TF_LADDER,
    canonical_precompute_tf,
    chart_tf_has_native_major_levels,
    major_source_timeframes_for_chart,
    resolve_build_timeframes,
)


def test_monthly_no_major_sources():
    assert MAJOR_SOURCES_BY_CHART_TF["1M"] == ()
    assert major_source_timeframes_for_chart("1M") == ()
    assert chart_tf_has_native_major_levels("1M") is False


def test_weekly_majors_only_from_monthly():
    assert major_source_timeframes_for_chart("1w") == ("1M",)
    assert major_source_timeframes_for_chart("1W") == ("1M",)


def test_daily_majors_from_month_and_week():
    assert major_source_timeframes_for_chart("1d") == ("1M", "1w")


def test_intraday_majors_from_m_w_d():
    for tf in ("4h", "4H", "1h", "30m"):
        assert major_source_timeframes_for_chart(tf) == ("1M", "1w", "1d")


def test_canonical_aliases():
    assert canonical_precompute_tf("1MO") == "1M"
    assert canonical_precompute_tf("30min") == "30m"


def test_resolve_build_timeframes_full_when_omitted_or_empty():
    assert resolve_build_timeframes(None) == PRECOMPUTE_TF_LADDER
    assert resolve_build_timeframes([]) == PRECOMPUTE_TF_LADDER


def test_resolve_build_timeframes_ordered_subset():
    assert resolve_build_timeframes(["1d", "1M", "1d"]) == ("1M", "1d")
    assert resolve_build_timeframes(["1h", "30m"]) == ("1h",)  # 30m není v žebříčku buildu


def test_resolve_build_timeframes_rejects_only_30m():
    with pytest.raises(ValueError, match="precompute_timeframes"):
        resolve_build_timeframes(["30m"])


def test_resolve_build_timeframes_rejects_unknown():
    with pytest.raises(ValueError, match="precompute_timeframes"):
        resolve_build_timeframes(["not_a_tf"])
