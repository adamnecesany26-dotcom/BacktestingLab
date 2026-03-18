# Co jsme teď implementovali (jednoduše)

Tento soubor je krátké shrnutí změn v aplikaci jednoduchým jazykem.

## 1) Co je nové v aplikaci

- Přidali jsme **Edge finding workflow**:
  - Out-of-sample split
  - Walk-forward test
  - Quality gates (min počet obchodů, max drawdown, min profit factor)
  - Parameter sweep (grid/random)
  - Monte Carlo simulace
  - Regime analýza (trend/range + volatilita + sessions)
  - Portfolio backtest (víc instrumentů najednou)
  - Realističtější execution model (spread, slippage, latency)
  - Forward bridge (paper/live shadow s baseline equity)
  - Experiment tracking + promote evidence

- Přidali jsme nové metriky:
  - Sortino, Calmar, MAR, Ulcer Index, CAGR
  - U trade i execution části: fees, slippage cost, holding time

- Přidali jsme **run diff**:
  - Aplikace porovnává aktuální run proti baseline (typicky poslední run).
  - Vidíš delty pro důležité metriky (např. return, DD, PF, win rate).

- Přidali jsme **promote workflow evidence**:
  - Pokud gates projdou a máš zapnuté `promote_on_pass`, run je označen jako kandidát.
  - Uvidíš důvod rozhodnutí (`promoteEvidence.reason`).

## 2) Kde nové funkce uvidíš

## Pravé menu (BacktestSettings)

- Nová sekce **Edge finding**:
  - Validation mode (single / OOS split / walk-forward)
  - Gates (min trades, max DD, min PF)
  - Sweep mode + samples
  - Monte Carlo toggle + počet simulací
  - Regime segmentation toggle
  - Portfolio backtest toggle + JSON instrumentů
  - Execution model toggle (spread/slippage/latency)
  - Forward testing bridge (mode + baseline equity)
  - Experiment tracking (hypothesis, tags, promote on pass)

## Výsledky -> Analytics tab

- Uvidíš:
  - Validation summary + gate pass/fail
  - Robustness summary + heatmap sweepu
  - Monte Carlo (risk of ruin, distribuce)
  - Regime sekce
  - Portfolio summary
  - Execution summary (fees, slippage, holding)
  - Forward bridge drift
  - Experiment tracking + promote recommendation
  - Run diff (current vs baseline)

## Výsledky -> Run history tab

- Přidaný sloupec **Promote**:
  - `candidate_for_promote` nebo `hold`

## 3) Co to znamená prakticky pro tebe

- Už nemusíš hodnotit strategii jen podle jednoho runu.
- Můžeš hned vidět:
  - jestli strategie drží výkon i mimo sample,
  - jak je citlivá na parametry,
  - jaké má tail risk (Monte Carlo),
  - jestli dává smysl ji posunout dál (promote).

## 4) Technicky důležité poznámky

- Timeout runu je teď defaultně vypnutý (lze řídit přes env `RUN_TIMEOUT_SEC`).
- Výsledky ukládáme do Firestore i s edge-finding daty:
  - validation
  - robustness
  - monteCarlo
  - regimeAnalysis
  - portfolio
  - executionSummary
  - qualityGate
  - experiment (včetně runDiff a promoteEvidence)

## 5) Co je další logický krok

- Přidat detailnější UI pro:
  - baseline management (vybrat konkrétní baseline run),
  - run-to-run diff panel v Run history (nejen v Analytics),
  - explicitní approve/reject tlačítko pro promote workflow.
