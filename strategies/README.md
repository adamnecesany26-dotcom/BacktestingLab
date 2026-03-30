# Strategie v tomto repozitáři

Každá složka je jedna strategie (`main.py`). U každé je **README.md** jednoduchým jazykem – co dělá, co potřebuješ nastavit, jestli vyžaduje moduly.

| Složka | Stručně |
|--------|---------|
| [sd_zone_strategy](sd_zone_strategy/) | Supply/Demand zóny; **bez modulu S/D zón neobchoduje**. **Swing HL** (nebo HL identificator) je v strategii nutný jen pro **trend filtr**; modul `sd_zones` pro BOS swingy stejně v praxi vyžaduje **Swing HL + S/D** oba v aplikovaných modulech — viz `sd_zone_strategy/README.md` a `examples/sd_zones/README.md`. |
| [rsi_gbp](rsi_gbp/) | RSI pásma + TP/SL v USD; forex, **bez** modulů. |
| [test](test/) | EMA křížení – **test enginu**, ne reálný edge. |

Jak spustit backtest a co kde kliknout: **[READMEADAM.md](../READMEADAM.md)**.
