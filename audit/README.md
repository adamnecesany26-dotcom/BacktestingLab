# Složka `audit/`

**Účel:** Centrální místo v kořeni repozitáře pro **výstupy auditů, code review a kontrol kódu** (reporty, poznámky, checklisty, exporty související s kontrolou kvality).

## Pravidlo pro AI / vývojáře

1. Při jakémkoli **auditu**, **systematické kontrole kódu** nebo **hlubším code review** v tomto projektu ukládej relevantní **soubory a poznámky sem** (`audit/`), nikoli rozptýleně jen do chatu.
2. Pojmenovávej soubory srozumitelně a včetně data nebo tématu, např.  
   `2026-03-23_results-page-config-review.md`, `quant-metrics-audit-notes.md`.
3. **Nepleť s** adresářem **`.audit/`** v kořeni — ten slouží pro **append-only strojové události** (`events.jsonl`), ne pro lidské auditní dokumenty.
4. Existující dlouhé technické dokumenty (např. `docs/QUANT_AUDIT.md`) můžeš ponechat tam, kde jsou; nové iterace nebo souhrny z kontroly můžeš duplikovat nebo odkazovat sem podle potřeby.

## Seznam auditů v repozitáři (pro pozdější review)

Všechny níže jsou **uložené v gitu** v `audit/` (kromě poznámky u `docs/`).

| Soubor | Téma |
|--------|------|
| `2026-03-31-final-readiness-audit.md` | Finální readiness audit (skóre, kritika, A–J) — 68 % FAIL vs cíl 95 % |
| `DEPLOYMENT_CHECKLIST.md` | Krátký checklist nasazení (API key, CORS, engine, bypass) |
| `risk_manager_audit.md` | Risk manager — DD, portfolio, Monte Carlo interpretace |
| `data_scientist_audit.md` | Data scientist — statistická validita, overfitting, metriky |
| `prop_firm_reviewer_audit.md` | Prop firm / capital allocator — alokace kapitálu ano/ne |
| `trader_audit.md` | Profesionální trader — realita vs backtest, workflow |
| `performance_analyst_audit.md` | Výkon, škálování, bottlenecky backend/frontend |
| `power_user_ux_audit.md` | UI/UX pro power usera, kritika Results stránky |

**Související (mimo `audit/`):** [`docs/QUANT_AUDIT.md`](../docs/QUANT_AUDIT.md) — quant audit dat, exekuce, engine. [`docs/BACKTEST_PIPELINE_REFACTOR.md`](../docs/BACKTEST_PIPELINE_REFACTOR.md) — pipeline předfiltrovaných modulů, `.backtest_artifacts/`, stav fází (Příloha C).

**Kořenová dokumentace:** [`README.md`](../README.md), [`READMEADAM.md`](../READMEADAM.md), [`READMEAI.md`](../READMEAI.md) — při větších změnách produktu je udržuj v souladu s `audit/` a `docs/`.

Pravidlo je zapsáno i v **`README.md`** a **`READMEAI.md`** v kořeni projektu.
