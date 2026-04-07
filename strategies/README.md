# Strategie v tomto repozitáři

Každá složka je jedna strategie (`main.py`). U každé je **README.md** jednoduchým jazykem – co dělá, co potřebuješ nastavit, jestli vyžaduje moduly.

| Složka | Stručně |
|--------|---------|
| [sd_zone_strategy](sd_zone_strategy/) | Supply/Demand zóny; **bez modulu S/D zón neobchoduje** (legacy), nebo režim **`use_sd_artifacts`** se zónami z **`.backtest_artifacts/`** (shoda s View po Build). Swing HL nutný pro trend filtr; jinak u legacy oba moduly v běhu — viz `sd_zone_strategy/README.md`, `examples/sd_zones/README.md`, `docs/BACKTEST_PIPELINE_REFACTOR.md`. |
| [rsi_gbp](rsi_gbp/) | RSI pásma + TP/SL v USD; forex, **bez** modulů. |
| [test](test/) | EMA křížení – **test enginu**, ne reálný edge. |

Jak spustit backtest a co kde kliknout: **[READMEADAM.md](../READMEADAM.md)**.
