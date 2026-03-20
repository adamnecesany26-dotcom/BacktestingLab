# Režimový histogram (View)

Soubor [`../hmm_regime_indicator.py`](../hmm_regime_indicator.py) zkopíruj do **Indikátoru** v aplikaci a v View ho vyber.

## Výstup

`get_line` vrací řadu pravděpodobností `trend`, `chop`, `high_vol` (součet 1 po normalizaci na backendu). Ve **StrategyViewChart** se vykreslí **spodní panel** pod cenou: sloupce sdílejí osu X se svíčkami, **barva** = dominantní stav, **výška** = max z tří pravděpodobností.

## Kontrakt

Buď explicitně:

```python
{"název": {"kind": "regime_histogram", "data": [{"date": "...", "trend": 0.5, "chop": 0.3, "high_vol": 0.2}, ...]}}
```

nebo stejné body bez `kind`, pokud první řádek už obsahuje `trend` / `chop` / `high_vol`.

Volitelně místo plochých klíčů: `"states": {"trend": ..., "chop": ..., "high_vol": ...}` na řádku.

Platforma: [Backtesting_app](../../README.md)
