# Příklady modulů a indikátorů

Tady jsou **hotové kousky kódu**, které zkopíruješ do aplikace (Moduly nebo Indikátory). U každého je v podsložce **README** – nahoře je *rychlý přehled*, níže detaily.

| Soubor | Typ | O čem to je | README |
|--------|-----|-------------|--------|
| `swing_hl_detector.py` | Modul | Swing high/low, major, interní, BOS, trend | [swing_hl_detector/README.md](swing_hl_detector/README.md) |
| `sd_zones.py` | Modul | Supply / Demand zóny z BOS | [sd_zones/README.md](sd_zones/README.md) |
| `sr_zones.py` | Modul | Support / Resistance z major swingů | [sr_zones/README.md](sr_zones/README.md) |
| `premium_discount.py` | Indikátor | Pásma Premium / Mid / Discount | [premium_discount/README.md](premium_discount/README.md) |
| `hmm_regime_indicator.py` | Indikátor | Režim (trend/chop/high_vol) — spodní histogram ve View | [hmm_regime/README.md](hmm_regime/README.md) |

**Postup obecně:** vytvoř entitu v aplikaci → vlož obsah příslušného `.py` do `main.py` → ulož → ve View vyber modul/indikátor (live) nebo použij **H/L + S/D z cache** po precomputu.

**Precompute (S/D + Swing HL do Parquet):** CLI `python -m app.services.hl_precompute` a `python -m app.services.sd_precompute` z kořene s nastaveným `PYTHONPATH` (viz [README.md](../README.md)); nebo **Build features** v UI. Detaily: [docs/BACKTEST_PIPELINE_REFACTOR.md](../docs/BACKTEST_PIPELINE_REFACTOR.md).

Strategie z `strategies/` mají README přímo ve své složce (např. `strategies/sd_zone_strategy/README.md`).

Celá platforma: [README.md](../README.md) · průvodce uživatelem: [READMEADAM.md](../READMEADAM.md).
