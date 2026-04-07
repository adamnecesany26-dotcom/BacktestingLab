"""
H/L precompute spec: TF žebříček a pravidla Major swingů (fáze 2+).

Major úrovně se **nepočítají jako vlastní pivoty** na 1M — na grafu 1M nejsou žádné „major“ značky.
Na **1d** grafu bereme majory z **1M + 1w**. Na **1w** jen z **1M**.
Na TF **jemnějších než 1d** (4h, 1h, 30m, …) skládáme majory ze **všech vyšších TF: 1M + 1w + 1d**,
aby se např. týdenní major swingy na jemném grafu neztratily.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.services.ohlc_timeframe import normalize_tf

# Od nejhrubšího k nejjemnějšímu (výchozí pořadí precomputu / artefakty pro View a build).
# 30m záměrně ne — předpočet swingů a zón na plném intraday by byl extrémně drahý; max. 1h.
PRECOMPUTE_TF_LADDER: tuple[str, ...] = ("1M", "1w", "1d", "4h", "1h")

# Pro každý **chart / výstupní** TF: z jakých **zdrojových** TF bereme major swing body (už vypočtené na dané sérii).
# Pořadí tuple: vždy od nejhrubšího k nejjemnějšímu zdroji.
MAJOR_SOURCES_BY_CHART_TF: dict[str, tuple[str, ...]] = {
    "1M": (),
    "1w": ("1M",),
    "1d": ("1M", "1w"),
    "4h": ("1M", "1w", "1d"),
    "1h": ("1M", "1w", "1d"),
    "30m": ("1M", "1w", "1d"),
}


def canonical_precompute_tf(tf: str | None) -> str | None:
    """Mapuje aliasy na klíče v PRECOMPUTE_TF_LADDER / MAJOR_SOURCES_BY_CHART_TF."""
    if tf is None or not str(tf).strip():
        return None
    raw = str(tf).strip()
    n = normalize_tf(raw)
    if n is None:
        return None
    # normalize_tf vrací 30m, 1w, 1d, 4h, 1h; měsíc jako 1M
    if n == "1M" or raw.upper() in ("1MO", "1MONTH"):
        return "1M"
    key = n
    if key in MAJOR_SOURCES_BY_CHART_TF:
        return key
    # fallback: lowercase week/day/hour pokud normalize vrátil jinak
    low = key.lower()
    aliases = {"1mo": "1M"}
    if low in aliases:
        return aliases[low]
    return key if key in MAJOR_SOURCES_BY_CHART_TF else None


def major_source_timeframes_for_chart(chart_tf: str | None) -> tuple[str, ...]:
    """
    TF, ze kterých se pro daný výstupní TF skládají Major swing úrovně.
    Pod 1d (4h, 1h, 30m): **1M + 1w + 1d**. Na 1D: 1M + 1w. Na 1w: jen 1M. Na 1M: prázdné.
    """
    c = canonical_precompute_tf(chart_tf)
    if c is None:
        return ()
    return MAJOR_SOURCES_BY_CHART_TF.get(c, ())


def chart_tf_has_native_major_levels(chart_tf: str | None) -> bool:
    """True pokud se na tom TF mají kreslit major body (vždy kromě 1M)."""
    return len(major_source_timeframes_for_chart(chart_tf)) > 0


def resolve_build_timeframes(requested: Sequence[str] | None) -> tuple[str, ...]:
    """
    Podmnožina ``PRECOMPUTE_TF_LADDER`` v pevném pořadí žebříčku.
    ``None`` nebo prázdná sekvence → celý žebříček.
    Neznámé / nekanonické hodnoty se přeskočí; pokud nic nezůstane → ValueError.
    """
    if not requested:
        return PRECOMPUTE_TF_LADDER
    want: set[str] = set()
    for raw in requested:
        c = canonical_precompute_tf(str(raw).strip())
        if c and c in PRECOMPUTE_TF_LADDER:
            want.add(c)
    ordered = tuple(tf for tf in PRECOMPUTE_TF_LADDER if tf in want)
    if not ordered:
        raise ValueError(
            "precompute_timeframes: žádný platný TF. Povolené hodnoty (nebo aliasy): "
            + ", ".join(PRECOMPUTE_TF_LADDER)
        )
    return ordered
