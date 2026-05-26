# Strategie v tomto repozitáři

Každá složka je jedna strategie (`main.py`). U každé je **README.md** jednoduchým jazykem – co dělá, co potřebuješ nastavit, jestli vyžaduje moduly.

| Složka | Stručně |
|--------|---------|
| [orb_prop_firm_killer](orb_prop_firm_killer/) | ORB Prop Firm Killer v2 (Pine port); MNQ 1m ``data/futures_mnq/``; ``process_orders_on_close`` + broker ``set_coc`` pro TV paritu. |
| [rsi_gbp](rsi_gbp/) | RSI pásma + TP/SL v USD; forex, **bez** modulů. |
| [test](test/) | EMA křížení – **test enginu**, ne reálný edge. |

Supply/Demand **zóny** pro graf (View / precompute) zůstávají v modulu [`examples/sd_zones.py`](../examples/sd_zones.py) a „repo“ swing modul v [`strategies/modules/Swing_HL.py`](modules/Swing_HL.py) — bez samostatné S/D **backtest** strategie v tomto repu.

Jak spustit backtest a co kde kliknout: **[READMEADAM.md](../READMEADAM.md)**.
