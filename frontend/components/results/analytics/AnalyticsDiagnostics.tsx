"use client";

import type { RunResponse } from "@shared/types";
import { assessOverfitting } from "@/lib/overfittingSignals";
import { formatProfitFactorDisplay, formatProfitFactorFromRow } from "@/lib/formatProfitFactor";

export interface AnalyticsDiagnosticsProps {
  results: RunResponse;
  batchSummary?: Record<string, unknown> | null;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

export function AnalyticsDiagnostics({ results, batchSummary: batchSummaryProp }: AnalyticsDiagnosticsProps) {
  const trades = results.trades ?? [];
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnl ?? 0) < 0);
  const breakeven = trades.filter((t) => (t.pnl ?? 0) === 0);

  const avgWin = wins.length ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length
    ? losses.reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0) / losses.length
    : 0;
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl ?? 0)) : 0;
  const worstTrade = trades.length ? Math.min(...trades.map((t) => t.pnl ?? 0)) : 0;

  const mfeValues = trades.map((t) => t.mfe ?? 0).filter((v) => Number.isFinite(v));
  const maeValues = trades.map((t) => t.mae ?? 0).filter((v) => Number.isFinite(v));
  const avgMfe = mfeValues.length ? mfeValues.reduce((s, v) => s + v, 0) / mfeValues.length : 0;
  const avgMae = maeValues.length ? maeValues.reduce((s, v) => s + v, 0) / maeValues.length : 0;

  const supplementaryCards: { label: string; value: string }[] = [
    { label: "Avg Win", value: `$${avgWin.toFixed(2)}` },
    { label: "Avg Loss", value: `$${avgLoss.toFixed(2)}` },
    { label: "Best / Worst", value: `$${bestTrade.toFixed(2)} / $${worstTrade.toFixed(2)}` },
    { label: "Avg MFE / MAE", value: `${avgMfe.toFixed(2)} / ${avgMae.toFixed(2)}` },
  ];
  const gatePassed = results.qualityGate && typeof results.qualityGate.passed === "boolean"
    ? (results.qualityGate.passed as boolean)
    : null;
  const validationSummary =
    results.validation && typeof results.validation.summary === "object"
      ? (results.validation.summary as Record<string, unknown>)
      : null;
  const robustness =
    results.robustness && typeof results.robustness === "object"
      ? (results.robustness as Record<string, unknown>)
      : null;
  const monteCarlo =
    results.monteCarlo && typeof results.monteCarlo === "object"
      ? (results.monteCarlo as Record<string, unknown>)
      : null;
  const regime =
    results.regimeAnalysis && typeof results.regimeAnalysis === "object"
      ? (results.regimeAnalysis as Record<string, unknown>)
      : null;
  const execution =
    results.executionSummary && typeof results.executionSummary === "object"
      ? (results.executionSummary as Record<string, unknown>)
      : null;
  const forwardBridge =
    execution?.forwardBridge && typeof execution.forwardBridge === "object"
      ? (execution.forwardBridge as Record<string, unknown>)
      : null;
  const portfolio =
    results.portfolio && typeof results.portfolio === "object"
      ? (results.portfolio as Record<string, unknown>)
      : null;
  const qualityGate =
    results.qualityGate && typeof results.qualityGate === "object"
      ? (results.qualityGate as Record<string, unknown>)
      : null;
  const qualityChecks = Array.isArray(qualityGate?.checks) ? (qualityGate.checks as Record<string, unknown>[]) : [];
  const experiment =
    results.experiment && typeof results.experiment === "object"
      ? (results.experiment as Record<string, unknown>)
      : null;
  const runDiff =
    experiment?.runDiff && typeof experiment.runDiff === "object"
      ? (experiment.runDiff as Record<string, unknown>)
      : null;
  const runDiffRows = runDiff ? Object.entries(runDiff) : [];
  const promoteEvidence =
    experiment?.promoteEvidence && typeof experiment.promoteEvidence === "object"
      ? (experiment.promoteEvidence as Record<string, unknown>)
      : null;
  const scoreDistribution =
    robustness?.scoreDistribution && typeof robustness.scoreDistribution === "object"
      ? (robustness.scoreDistribution as Record<string, unknown>)
      : null;

  const tradeCount = Number(results.metrics.tradeCount ?? trades.length ?? 0);
  const validationMode = String(results.validation?.mode ?? "single");
  const riskOfRuin = Number(monteCarlo?.riskOfRuin ?? NaN);
  const monteCarloMethod = String(monteCarlo?.method ?? "n/a");
  const monteCarloMode = String(monteCarlo?.mode ?? "n/a");
  const monteCarloNote =
    typeof monteCarlo?.note === "string" && monteCarlo.note.trim() ? monteCarlo.note.trim() : null;
  const costAttr =
    execution?.costAttribution && typeof execution.costAttribution === "object"
      ? (execution.costAttribution as Record<string, unknown>)
      : null;
  const defs =
    costAttr?.definitions && typeof costAttr.definitions === "object"
      ? (costAttr.definitions as Record<string, string>)
      : null;
  const valGuard =
    results.validation?.guardrails && typeof results.validation.guardrails === "object"
      ? (results.validation.guardrails as Record<string, unknown>)
      : null;
  const guardHintCount = Array.isArray(valGuard?.possibleLeakageHints)
    ? (valGuard!.possibleLeakageHints as unknown[]).length
    : 0;
  const batchSummary =
    batchSummaryProp && typeof batchSummaryProp === "object"
      ? batchSummaryProp
      : results.batchSummary && typeof results.batchSummary === "object"
        ? (results.batchSummary as Record<string, unknown>)
        : null;
  const batchAggregates =
    batchSummary?.aggregates && typeof batchSummary.aggregates === "object"
      ? (batchSummary.aggregates as Record<string, unknown>)
      : null;
  const sweepTested = Number(robustness?.tested ?? 0);
  const stabilityScore = Number(robustness?.stabilityScore ?? NaN);
  const nestedHoldout =
    robustness?.nestedHoldout && typeof robustness.nestedHoldout === "object"
      ? (robustness.nestedHoldout as Record<string, unknown>)
      : null;
  const scoreFieldNote =
    typeof robustness?.scoreFieldNote === "string" ? robustness.scoreFieldNote.trim() : null;
  const avgDegradation = Number(validationSummary?.avgDegradation ?? 0);
  const foldsFailedGates = Number(validationSummary?.foldsFailedGates ?? 0);
  const batchRunCount = Number(batchSummary?.runCount ?? 0);
  const paramTestRuns = Math.max(0, Math.floor(Number(validationSummary?.paramTestTotalRuns ?? 0)));
  const profitFactorMetric = (() => {
    const v = results.metrics?.profitFactor;
    if (v === null || v === undefined) return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  })();
  const profitFactorStatus =
    typeof results.metrics?.profitFactorStatus === "string" ? results.metrics.profitFactorStatus : null;
  const qualityGatePassed =
    qualityGate && typeof qualityGate.passed === "boolean" ? (qualityGate.passed as boolean) : undefined;

  const overfitSignals =
    results.overfittingSignals && typeof results.overfittingSignals === "object"
      ? (results.overfittingSignals as Record<string, unknown>)
      : null;
  const manifestTrialCount = Number(overfitSignals?.trialCount ?? 1);
  const naiveAlpha = overfitSignals?.naiveAdjustedAlpha != null ? Number(overfitSignals.naiveAdjustedAlpha) : null;

  const bootstrapCI =
    results.bootstrapCI && typeof results.bootstrapCI === "object"
      ? (results.bootstrapCI as Record<string, unknown>)
      : null;
  const bsCImeanPnl =
    bootstrapCI?.meanPnl && typeof bootstrapCI.meanPnl === "object"
      ? (bootstrapCI.meanPnl as Record<string, unknown>)
      : null;
  const bsCItotalReturn =
    bootstrapCI?.totalReturn && typeof bootstrapCI.totalReturn === "object"
      ? (bootstrapCI.totalReturn as Record<string, unknown>)
      : null;
  const bsCIsharpe =
    bootstrapCI?.sharpe && typeof bootstrapCI.sharpe === "object"
      ? (bootstrapCI.sharpe as Record<string, unknown>)
      : null;

  const payoffDecomp =
    results.payoffDecomposition && typeof results.payoffDecomposition === "object"
      ? (results.payoffDecomposition as Record<string, unknown>)
      : null;

  const overfittingAssessment = assessOverfitting({
    validationMode,
    tradeCount,
    riskOfRuin,
    qualityGatePassed: qualityGatePassed ?? null,
    avgDegradation,
    foldsFailedGates,
    guardHintCount,
    sweepTested,
    stabilityScore,
    batchRunCount,
    paramTestRuns,
    profitFactor: Number.isFinite(profitFactorMetric) ? profitFactorMetric : null,
    profitFactorStatus,
    trialCount: manifestTrialCount,
    naiveAdjustedAlpha: Number.isFinite(naiveAlpha ?? NaN) ? naiveAlpha : null,
  });
  const overfittingFlags = overfittingAssessment.warnings;
  const readinessLabel = overfittingAssessment.readinessLabel;

  const monteCarloObj = monteCarlo && typeof monteCarlo === "object" ? monteCarlo : null;
  const mcSimCount = monteCarloObj != null ? Number(monteCarloObj.simulations ?? 0) : 0;
  const mcRan = monteCarloObj != null && mcSimCount > 0;
  const sweepRan = Number(robustness?.tested ?? 0) > 0;

  const ddAnalysis =
    results.drawdownAnalysis && typeof results.drawdownAnalysis === "object"
      ? (results.drawdownAnalysis as Record<string, unknown>)
      : null;
  const pnlDist =
    results.tradePnlDistribution && typeof results.tradePnlDistribution === "object"
      ? (results.tradePnlDistribution as Record<string, unknown>)
      : null;
  const pnlPercentiles =
    pnlDist?.percentiles && typeof pnlDist.percentiles === "object"
      ? (pnlDist.percentiles as Record<string, number>)
      : null;
  const pnlTailRisk =
    pnlDist?.tailRisk && typeof pnlDist.tailRisk === "object"
      ? (pnlDist.tailRisk as Record<string, unknown>)
      : null;
  const pnlConcentration =
    pnlDist?.concentration && typeof pnlDist.concentration === "object"
      ? (pnlDist.concentration as Record<string, unknown>)
      : null;
  const pnlHistogram = Array.isArray(pnlDist?.histogram) ? (pnlDist!.histogram as { binStart: number; binEnd: number; count: number }[]) : [];
  const histMax = pnlHistogram.reduce((m, h) => Math.max(m, h.count), 0);

  const periodsPerYear = Number(results.metrics.riskAnnualizationPeriodsPerYear ?? 0);
  const sharpeFreqLabel = periodsPerYear > 50000 ? "tick/1m" : periodsPerYear > 5000 ? "intraday" : periodsPerYear > 300 ? "daily" : periodsPerYear > 50 ? "weekly" : "monthly/low-freq";

  const propRedFlags =
    results.propRedFlags && typeof results.propRedFlags === "object"
      ? (results.propRedFlags as Record<string, unknown>)
      : null;
  const propFlags = Array.isArray(propRedFlags?.flags) ? (propRedFlags!.flags as { id: string; severity: string; message: string; detail?: string }[]) : [];
  const propTrustLevel = String(propRedFlags?.trustLevel ?? "");
  const propTrustLabel = String(propRedFlags?.trustLabel ?? "");
  const propCriticalCount = Number(propRedFlags?.criticalCount ?? 0);
  const propWarningCount = Number(propRedFlags?.warningCount ?? 0);

  return (
    <div className="py-2 space-y-4">
      {propRedFlags && propFlags.length > 0 && (
        <div className={`rounded-xl border p-4 space-y-2 shadow-lg shadow-black/20 ${
          propTrustLevel === "not_trustworthy" ? "border-rose-600/50 bg-gradient-to-br from-rose-950/35 to-zinc-950/40" :
          propTrustLevel === "low_trust" ? "border-amber-600/45 bg-gradient-to-br from-amber-950/25 to-zinc-950/40" :
          propTrustLevel === "cautious" ? "border-yellow-600/40 bg-gradient-to-br from-yellow-950/20 to-zinc-950/40" :
          "border-emerald-600/40 bg-gradient-to-br from-emerald-950/20 to-zinc-950/40"
        }`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-xs uppercase tracking-wider font-medium ${
              propTrustLevel === "not_trustworthy" ? "text-rose-400" :
              propTrustLevel === "low_trust" ? "text-amber-400" :
              propTrustLevel === "cautious" ? "text-yellow-400" :
              "text-emerald-400"
            }`}>
              Trust assessment
            </span>
            <span className="text-xs text-zinc-300">{propTrustLabel}</span>
            <span className="text-[10px] text-zinc-500">
              ({propCriticalCount} critical, {propWarningCount} warnings)
            </span>
          </div>
          <div className="space-y-1">
            {propFlags.map((flag) => (
              <div
                key={flag.id}
                className={`rounded-md px-2.5 py-1.5 text-xs ${
                  flag.severity === "critical" ? "border border-rose-500/30 bg-rose-500/10 text-rose-200" :
                  flag.severity === "warning" ? "border border-amber-500/20 bg-amber-500/8 text-amber-200" :
                  "border border-zinc-600/30 bg-zinc-800/40 text-zinc-300"
                }`}
              >
                <span className={`font-medium uppercase text-[10px] mr-2 ${
                  flag.severity === "critical" ? "text-rose-400" :
                  flag.severity === "warning" ? "text-amber-400" :
                  "text-zinc-500"
                }`}>{flag.severity}</span>
                {flag.message}
                {flag.detail && <span className="text-zinc-500 ml-1">— {flag.detail}</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600">
            Automatická detekce podezřelých vzorů. Red flags nejsou důkaz podvodu — jsou to signály vyžadující hlubší
            ověření. Backtest je scénář pod pravidly simulátoru, ne důkaz exekuce u brokera.
          </p>
        </div>
      )}

      {ddAnalysis && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Drawdown analysis (duration &amp; recovery)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Longest DD period</div>
              <div className="font-mono text-zinc-200">
                {String(ddAnalysis.maxDurationBars ?? 0)} bars
                {ddAnalysis.maxDurationDays != null ? ` / ${Number(ddAnalysis.maxDurationDays).toFixed(0)}d` : ""}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Time to recovery (deepest)</div>
              <div className="font-mono text-zinc-200">
                {ddAnalysis.timeToRecoveryBars != null
                  ? `${ddAnalysis.timeToRecoveryBars} bars${ddAnalysis.timeToRecoveryDays != null ? ` / ${Number(ddAnalysis.timeToRecoveryDays).toFixed(0)}d` : ""}`
                  : "not recovered"}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Avg DD period</div>
              <div className="font-mono text-zinc-200">{Number(ddAnalysis.avgDurationBars ?? 0).toFixed(1)} bars</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Underwater integral (avg DD%)</div>
              <div className="font-mono text-zinc-200">{Number(ddAnalysis.underwaterPct ?? 0).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">DD periods count</div>
              <div className="font-mono text-zinc-200">{String(ddAnalysis.periodsCount ?? 0)}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Current DD %</div>
              <div className={`font-mono ${Number(ddAnalysis.currentDrawdownPct ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                {Number(ddAnalysis.currentDrawdownPct ?? 0).toFixed(2)}%
              </div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">
            Underwater integral kombinuje hloubku a délku DD — vyšší = více času stráveno v propadu.
            Recovery null = equity nedosáhla zpět na peak před koncem dat.
          </p>
        </div>
      )}

      {pnlDist && Number(pnlDist.count ?? 0) > 0 && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3 space-y-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Trade PnL distribution</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
            {pnlTailRisk?.cvar5Pct != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">CVaR 5% tail</div>
                <div className="font-mono text-rose-400">${Number(pnlTailRisk.cvar5Pct).toFixed(2)}</div>
              </div>
            )}
            {pnlTailRisk?.cvar1Pct != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">CVaR 1% tail</div>
                <div className="font-mono text-rose-400">${Number(pnlTailRisk.cvar1Pct).toFixed(2)}</div>
              </div>
            )}
            {pnlConcentration?.top5PnlPct != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Top 5 trades % of PnL</div>
                <div className={`font-mono ${Number(pnlConcentration.top5PnlPct) > 80 ? "text-amber-400" : "text-zinc-200"}`}>
                  {Number(pnlConcentration.top5PnlPct).toFixed(1)}%
                </div>
              </div>
            )}
            {pnlConcentration?.top10PnlPct != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Top 10 trades % of PnL</div>
                <div className="font-mono text-zinc-200">{Number(pnlConcentration.top10PnlPct).toFixed(1)}%</div>
              </div>
            )}
            {pnlDist.skewness != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Skewness</div>
                <div className="font-mono text-zinc-200">{Number(pnlDist.skewness).toFixed(3)}</div>
              </div>
            )}
            {pnlDist.kurtosis != null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase">Kurtosis (excess)</div>
                <div className="font-mono text-zinc-200">{Number(pnlDist.kurtosis).toFixed(3)}</div>
              </div>
            )}
          </div>
          {pnlPercentiles && (
            <div>
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Percentiles</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono text-zinc-300">
                {Object.entries(pnlPercentiles).map(([k, v]) => (
                  <span key={k}>
                    <span className="text-zinc-500">{k}:</span> ${Number(v).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {pnlHistogram.length > 1 && (
            <div>
              <div className="text-[10px] text-zinc-500 uppercase mb-1">PnL histogram</div>
              <div className="flex items-end gap-px h-16">
                {pnlHistogram.map((bin, i) => {
                  const pctH = histMax > 0 ? (bin.count / histMax) * 100 : 0;
                  const isNeg = bin.binEnd <= 0;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t ${isNeg ? "bg-rose-500/70" : "bg-emerald-500/70"}`}
                      style={{ height: `${Math.max(2, pctH)}%` }}
                      title={`$${bin.binStart.toFixed(0)}–$${bin.binEnd.toFixed(0)}: ${bin.count} trades`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                <span>${pnlHistogram[0]?.binStart.toFixed(0)}</span>
                <span>${pnlHistogram[pnlHistogram.length - 1]?.binEnd.toFixed(0)}</span>
              </div>
            </div>
          )}
          {Number(pnlConcentration?.top5PnlPct ?? 0) > 70 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-100">
              Více než 70 % celkového zisku pochází z top 5 obchodů — edge je pravděpodobně závislý na outlierech, ne na systematickém procesu.
            </div>
          )}
        </div>
      )}

      {periodsPerYear > 0 && (
        <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Sharpe / Sortino context</span>
          <span>
            Data frequency: <span className="text-zinc-200 font-mono">{sharpeFreqLabel}</span> ({periodsPerYear.toFixed(0)} periods/yr)
          </span>
          <span>Sample: <span className="text-zinc-200 font-mono">{tradeCount}</span> trades</span>
          {tradeCount < 30 && (
            <span className="text-amber-400">Málo obchodů — Sharpe/Sortino jsou statisticky nespolehlivé.</span>
          )}
        </div>
      )}

      {bootstrapCI && bsCImeanPnl && (
        <div className="rounded-lg border border-indigo-700/50 bg-indigo-950/20 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400/80">
            Bootstrap {Number(bootstrapCI.alpha ?? 0.05) === 0.05 ? "95%" : `${((1 - Number(bootstrapCI.alpha ?? 0.05)) * 100).toFixed(0)}%`} confidence intervals
            <span className="text-zinc-500 normal-case ml-2">({Number(bootstrapCI.nBoot ?? 0)} resamples, {Number(bootstrapCI.nTrades ?? 0)} trades)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md bg-zinc-900/60 border border-zinc-700/40 p-2">
              <div className="text-[10px] text-zinc-500 uppercase">Mean PnL per trade</div>
              <div className="font-mono text-zinc-200">
                ${Number(bsCImeanPnl.point ?? 0).toFixed(2)}
              </div>
              <div className="font-mono text-xs text-indigo-300/80">
                [{Number(bsCImeanPnl.ciLow ?? 0).toFixed(2)}, {Number(bsCImeanPnl.ciHigh ?? 0).toFixed(2)}]
              </div>
            </div>
            {bsCItotalReturn && (
              <div className="rounded-md bg-zinc-900/60 border border-zinc-700/40 p-2">
                <div className="text-[10px] text-zinc-500 uppercase">Total return (trade sum)</div>
                <div className="font-mono text-zinc-200">
                  ${Number(bsCItotalReturn.point ?? 0).toFixed(2)}
                </div>
                <div className="font-mono text-xs text-indigo-300/80">
                  [{Number(bsCItotalReturn.ciLow ?? 0).toFixed(2)}, {Number(bsCItotalReturn.ciHigh ?? 0).toFixed(2)}]
                </div>
              </div>
            )}
            {bsCIsharpe && (
              <div className="rounded-md bg-zinc-900/60 border border-zinc-700/40 p-2">
                <div className="text-[10px] text-zinc-500 uppercase">Trade-level Sharpe</div>
                <div className="font-mono text-zinc-200">
                  {Number(bsCIsharpe.point ?? 0).toFixed(4)}
                </div>
                <div className="font-mono text-xs text-indigo-300/80">
                  [{Number(bsCIsharpe.ciLow ?? 0).toFixed(4)}, {Number(bsCIsharpe.ciHigh ?? 0).toFixed(4)}]
                </div>
                <div className="text-[9px] text-zinc-500 mt-1">{String(bsCIsharpe.note ?? "")}</div>
              </div>
            )}
          </div>
          {Number(bsCImeanPnl.ciLow ?? 0) < 0 && Number(bsCImeanPnl.ciHigh ?? 0) > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-100">
              CI pro mean PnL zahrnuje nulu — na z\u00e1klad\u011b t\u011bchto dat nelze vylou\u010dit, \u017ee strategie nem\u00e1 edge.
            </div>
          )}
          <p className="text-[10px] text-zinc-600">
            {String(bootstrapCI.note ?? "")}
          </p>
        </div>
      )}

      {payoffDecomp && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Edge decomposition (payoff analysis)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Win Rate</div>
              <div className="font-mono text-zinc-200">{(Number(payoffDecomp.winRate ?? 0) * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Payoff Ratio (AvgW/AvgL)</div>
              <div className="font-mono text-zinc-200">
                {payoffDecomp.payoffRatio != null ? Number(payoffDecomp.payoffRatio).toFixed(2) : "\u2014"}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Edge per trade</div>
              <div className={`font-mono ${Number(payoffDecomp.edgePerTrade ?? 0) > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ${Number(payoffDecomp.edgePerTrade ?? 0).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">Kelly fraction</div>
              <div className="font-mono text-zinc-200">
                {payoffDecomp.kellyFraction != null ? `${(Number(payoffDecomp.kellyFraction) * 100).toFixed(1)}%` : "\u2014"}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">{String(payoffDecomp.note ?? "")}</p>
        </div>
      )}

      {manifestTrialCount > 1 && (
        <div className="rounded-lg border border-orange-700/40 bg-orange-950/20 px-3 py-2 text-xs text-zinc-400 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-orange-400 uppercase tracking-wider text-[10px]">Multiple testing awareness</span>
            <span>
              Total configs tested: <span className="text-zinc-200 font-mono">{manifestTrialCount}</span>
            </span>
            {naiveAlpha != null && Number.isFinite(naiveAlpha) && (
              <span>
                Naive Bonferroni \u03b1: <span className="text-zinc-200 font-mono">{naiveAlpha.toFixed(4)}</span>
                <span className="text-zinc-500 ml-1">(0.05 / {manifestTrialCount})</span>
              </span>
            )}
          </div>
          <p className="text-zinc-500 leading-relaxed">
            {String(overfitSignals?.naiveAdjustedNote ?? "V\u00edce konfiguraci = vy\u0161\u0161\u00ed riziko fale\u0161n\u011b pozitivn\u00edch v\u00fdsledk\u016f.")}
          </p>
        </div>
      )}

      <details className="rounded-lg border border-zinc-800/90 bg-zinc-950/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-400 hover:text-zinc-200 select-none list-none [&::-webkit-details-marker]:hidden">
          Rozšířená diagnostika — regime, náklady, batch, experimenty… (foldy / sweep / param test jsou v podzáložkách
          Analytics)
        </summary>
        <div className="space-y-4 px-4 pb-4 pt-2 border-t border-zinc-800/80">
      <div className="rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/50 via-zinc-900/30 to-zinc-950/50 p-4 shadow-lg shadow-black/20">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Heuristický signál připravenosti edge</div>
        <div className="text-base font-medium text-zinc-100">{readinessLabel}</div>
        <div className="text-xs text-zinc-400 mt-2 leading-relaxed">
          Validace: {validationMode} · Obchody: {tradeCount} · Risk of ruin:{" "}
          {Number.isFinite(riskOfRuin) ? riskOfRuin.toFixed(4) : "N/A"} · Severity score: {overfittingAssessment.severityScore}{" "}
          (heuristika, ne p-value)
        </div>
      </div>

      {overfittingFlags.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-950/30 to-zinc-950/40 p-4 shadow-lg shadow-black/15">
          <div className="text-[11px] uppercase tracking-wider text-amber-200/90 mb-2">Varování před přetrénováním</div>
          <ul className="space-y-1.5 list-none">
            {overfittingFlags.map((flag) => (
              <li key={flag} className="text-sm text-amber-100/95 pl-3 border-l-2 border-amber-500/50">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {supplementaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-zinc-700/45 bg-zinc-950/40 p-3 shadow-md shadow-black/15"
          >
            <div className="text-xs uppercase tracking-wider text-zinc-500">{card.label}</div>
            <div className="text-sm font-mono text-zinc-100 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/45 to-zinc-950/50 p-4 shadow-lg shadow-black/15">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Trade distribution</div>
        <div className="space-y-2">
          <div>
            <div className="text-xs text-zinc-400 mb-1">Winning trades ({pct(wins.length, trades.length).toFixed(1)}%)</div>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${pct(wins.length, trades.length)}%` }} />
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-1">Losing trades ({pct(losses.length, trades.length).toFixed(1)}%)</div>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${pct(losses.length, trades.length)}%` }} />
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-1">Breakeven trades ({pct(breakeven.length, trades.length).toFixed(1)}%)</div>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden">
              <div className="h-full bg-zinc-500" style={{ width: `${pct(breakeven.length, trades.length)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Validation & gates</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Gate status: {gatePassed === null ? "N/A" : gatePassed ? "PASS" : "FAIL"}</div>
            <div>Validation mode: {String(results.validation?.mode ?? "single")}</div>
            <div>Folds: {String(validationSummary?.foldCount ?? 0)}</div>
            {paramTestRuns > 0 ? (
              <div>
                Param test — dodatečné běhy: {paramTestRuns} · parametry:{" "}
                {Array.isArray(validationSummary?.paramKeysTested)
                  ? (validationSummary!.paramKeysTested as string[]).join(", ")
                  : "—"}
              </div>
            ) : null}
            <div>Avg degradation: {String(validationSummary?.avgDegradation ?? 0)}</div>
            <div>
              Profit factor:{" "}
              {formatProfitFactorDisplay(results.metrics.profitFactor, profitFactorStatus ?? undefined)}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Robustness & Monte Carlo</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>
              Sweep:{" "}
              {sweepRan ? (
                <>
                  {String(robustness?.tested ?? 0)} vzorků, stability score {String(robustness?.stabilityScore ?? 0)}
                </>
              ) : (
                <span className="text-zinc-500">vypnuto (v odpovědi není robustness sweep)</span>
              )}
            </div>
            {nestedHoldout && nestedHoldout.enabled === true ? (
              <div className="text-zinc-400">
                Nested holdout: train {String(nestedHoldout.trainBarCount ?? "—")} bars · holdout{" "}
                {String(nestedHoldout.holdoutBarCount ?? "—")} bars (ratio{" "}
                {String(nestedHoldout.holdoutRatioConfigured ?? "—")})
              </div>
            ) : null}
            {scoreFieldNote ? <div className="text-zinc-500 text-xs">{scoreFieldNote}</div> : null}
            {sweepRan ? (
              <div>
                Score p10/p50/p90:{" "}
                {`${String(scoreDistribution?.p10 ?? 0)} / ${String(scoreDistribution?.p50 ?? 0)} / ${String(scoreDistribution?.p90 ?? 0)}`}
              </div>
            ) : null}
            {mcRan ? (
              <>
                <div>MC simulations: {String(monteCarloObj?.simulations ?? 0)}</div>
                <div>MC method: {monteCarloMethod}</div>
                <div>MC mode: {monteCarloMode}</div>
                <div>
                  Risk of ruin (odhad):{" "}
                  {Number.isFinite(riskOfRuin) ? riskOfRuin.toFixed(4) : "N/A"}
                </div>
                {monteCarloNote && <div className="text-xs text-zinc-500 pt-1">{monteCarloNote}</div>}
              </>
            ) : (
              <div className="text-zinc-500">
                Blok <code className="text-zinc-400">monteCarlo</code> v tomto výsledku není (starší servery ho uměly přidat po
                běhu). Nové shuffle / prop analýzy spouštěj v hlavní záložce <span className="text-zinc-300">Monte Carlo</span>.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Regimes — PnL &amp; PF per segment</div>
          {regime?.regimes && typeof regime.regimes === "object" && Object.keys(regime.regimes as Record<string, unknown>).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-zinc-700 text-zinc-500">
                    <th className="py-1 pr-2">Regime</th>
                    <th className="py-1 pr-2 text-right">Trades</th>
                    <th className="py-1 pr-2 text-right">Win %</th>
                    <th className="py-1 pr-2 text-right">Expect. $</th>
                    <th className="py-1 pr-2 text-right">PF</th>
                    <th className="py-1 pr-2 text-right">Total PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(regime.regimes as Record<string, Record<string, unknown>>).map(([key, r]) => (
                    <tr key={key} className="border-b border-zinc-800/80 text-zinc-300">
                      <td className="py-1 pr-2 font-mono">{key}</td>
                      <td className="py-1 pr-2 text-right">{String(r.trades ?? 0)}</td>
                      <td className="py-1 pr-2 text-right">{r.winRate != null ? `${Number(r.winRate).toFixed(1)}%` : "\u2014"}</td>
                      <td className="py-1 pr-2 text-right">{r.expectancyUsd != null ? `$${Number(r.expectancyUsd).toFixed(2)}` : "\u2014"}</td>
                      <td className="py-1 pr-2 text-right">
                        {formatProfitFactorFromRow(r)}
                      </td>
                      <td className="py-1 pr-2 text-right">{r.totalPnl != null ? `$${Number(r.totalPnl).toFixed(2)}` : "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {typeof regime.sessions === "object" && regime.sessions != null && Object.keys(regime.sessions as Record<string, unknown>).length > 0 ? (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600 mt-3 mb-1">Sessions</div>
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-zinc-700 text-zinc-500">
                        <th className="py-1 pr-2">Session</th>
                        <th className="py-1 pr-2 text-right">Trades</th>
                        <th className="py-1 pr-2 text-right">Win %</th>
                        <th className="py-1 pr-2 text-right">Expect. $</th>
                        <th className="py-1 pr-2 text-right">PF</th>
                        <th className="py-1 pr-2 text-right">Total PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(regime.sessions as Record<string, Record<string, unknown>>).map(([key, r]) => (
                        <tr key={key} className="border-b border-zinc-800/80 text-zinc-300">
                          <td className="py-1 pr-2 font-mono">{key}</td>
                          <td className="py-1 pr-2 text-right">{String(r.trades ?? 0)}</td>
                          <td className="py-1 pr-2 text-right">{r.winRate != null ? `${Number(r.winRate).toFixed(1)}%` : "\u2014"}</td>
                          <td className="py-1 pr-2 text-right">{r.expectancyUsd != null ? `$${Number(r.expectancyUsd).toFixed(2)}` : "\u2014"}</td>
                          <td className="py-1 pr-2 text-right">
                            {formatProfitFactorFromRow(r)}
                          </td>
                          <td className="py-1 pr-2 text-right">{r.totalPnl != null ? `$${Number(r.totalPnl).toFixed(2)}` : "\u2014"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-zinc-400">Regime analysis N/A</div>
          )}
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Portfolio</div>
          {portfolio ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 leading-relaxed">
                <span className="font-semibold">Model: independent isolated capital</span> — každý instrument je
                backtestován izolovaně s plným počátečním kapitálem. Vážený return/DD je lineární blend per-run metrik,{" "}
                <strong>nikoliv</strong> multi-asset simulace se sdíleným equity poolem, cross-marginem nebo korelovanými
                drawdown cestami.
              </div>
              <div className="space-y-1 text-sm text-zinc-300">
                <div>Instruments: {String((portfolio?.summary as Record<string, unknown> | undefined)?.count ?? 0)}</div>
                <div>
                  Weighted Return USD:{" "}
                  {String((portfolio?.summary as Record<string, unknown> | undefined)?.weightedReturnUsd ?? 0)}
                </div>
                <div>
                  Weighted Max DD %:{" "}
                  {String((portfolio?.summary as Record<string, unknown> | undefined)?.weightedMaxDrawdownPct ?? 0)}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">N/A</div>
          )}
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3 md:col-span-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Execution model &amp; costs</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Enabled: {String(execution?.enabled ?? false)}</div>
            <div>Spread bps: {String(execution?.spreadBps ?? 0)}</div>
            <div>
              Latency proxy bars:{" "}
              {String(execution?.slippageLatencyProxyBars ?? execution?.latencyBars ?? 0)}
            </div>
            {execution?.latencyModel ? (
              <div className="text-xs text-zinc-500">
                Latency model: {String(execution.latencyModel)}
                {execution.latencyBarsDeprecatedAlias ? " (latencyBars je zastaralý alias)" : ""}
              </div>
            ) : null}
            <div>Total fees: {String(execution?.totalFees ?? costAttr?.totalFees ?? 0)}</div>
            <div>Total slippage cost: {String(execution?.totalSlippageCost ?? costAttr?.totalSlippageCost ?? 0)}</div>
            <div>Avg holding min: {String(execution?.avgHoldingMinutes ?? 0)}</div>
            <div>
              Forward bridge:{" "}
              {forwardBridge
                ? `${String(forwardBridge.mode ?? "paper_shadow")} (${String(forwardBridge.status ?? "ok")})`
                : "N/A"}
            </div>
            {forwardBridge && (
              <div>
                Drift %: {String(forwardBridge.driftPct ?? 0)} (baseline{" "}
                {String(forwardBridge.baselineFinalEquity ?? "n/a")} {"->"}{" "}
                {String(forwardBridge.currentFinalEquity ?? "n/a")})
              </div>
            )}
          </div>
          {costAttr && (
            <div className="mt-3 pt-3 border-t border-zinc-700/50 space-y-1 text-xs text-zinc-400">
              <div className="text-zinc-500 uppercase tracking-wider mb-1">Cost attribution</div>
              <div>
                Fees / |net return| ratio:{" "}
                {String(
                  costAttr.feesToAbsNetReturnRatio ?? costAttr.executionCostsToNetReturnRatio ?? "—",
                )}
              </div>
              <div>
                Fees / Σ|PnL| (abs): {String(costAttr.feesToGrossAbsClosedPnlRatio ?? "—")}
              </div>
              <div>
                Slippage estimate / Σ|PnL| (abs):{" "}
                {String(costAttr.slippageEstimateToGrossAbsClosedPnlRatio ?? "—")}
              </div>
              {costAttr.deprecatedCombinedExecutionCostsRatio &&
              typeof costAttr.deprecatedCombinedExecutionCostsRatio === "object" ? (
                <div className="text-zinc-500">
                  Legacy kombinovaný poměr (nepoužívat pro ekonomickou interpretaci):{" "}
                  {String(
                    (costAttr.deprecatedCombinedExecutionCostsRatio as Record<string, unknown>).value ?? "—",
                  )}
                </div>
              ) : null}
              <div>Avg fee / trade: {String(costAttr.avgFeePerTrade ?? "—")}</div>
              <div>Avg slippage / trade: {String(costAttr.avgSlippagePerTrade ?? "—")}</div>
              {defs && (
                <ul className="list-disc pl-4 mt-2 text-zinc-500 space-y-0.5">
                  {Object.entries(defs).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-zinc-400">{k}:</span> {v}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-3 rounded-md border border-zinc-600/40 bg-zinc-800/30 px-2.5 py-2 text-xs text-zinc-500 space-y-1">
            <div className="text-zinc-400 font-medium">Disclaimer: backtest \u2260 broker execution</div>
            <p>
              Slippage model je zjednodu\u0161en\u00fd (symetrick\u00e9 %, spread v bps, vol multiplik\u00e1tor). Nemodeluje re\u00e1lnou hloubku knihy,
              market impact podle velikosti pozice, gapy ani intrabar pořad\u00ed fill\u016f.
              V\u00fdsledky jsou sc\u00e9n\u00e1\u0159 pod pravidly simul\u00e1toru &mdash; ne d\u016fkaz exekuce u brokera.
            </p>
            <p>
              <strong>Kapacita:</strong> Model nepo\u010d\u00edt\u00e1 s t\u00edm, \u017ee v\u011bt\u0161\u00ed kapit\u00e1l m\u011bn\u00ed trh a fill.
              V\u00fdsledky plat\u00ed pro mal\u00fd \u00fa\u010det; p\u0159i \u0161k\u00e1lov\u00e1n\u00ed pou\u017eij vy\u0161\u0161\u00ed stress multiplier nebo testuj explicitn\u011b.
            </p>
          </div>
        </div>
      </div>

      {batchSummary && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-xs uppercase tracking-wider text-amber-200 mb-2">Batch / matrix run</div>
          <div className="text-sm text-amber-100 mb-2">{String(batchSummary.multipleTestingWarning ?? "")}</div>
          <div className="text-xs text-zinc-400 mb-2">
            Batch ID: {String(batchSummary.batchId ?? "—")} | Runs: {String(batchSummary.runCount ?? 0)}
          </div>
          {batchAggregates && (
            <div className="mb-3 rounded-md border border-amber-500/20 bg-zinc-950/40 px-2 py-2 text-xs text-zinc-300">
              <div className="text-amber-200/90 font-medium mb-1">Agregace přes instrumenty (prostý průměr / součet)</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Obchodů celkem: {String(batchAggregates.totalTrades ?? "—")}</span>
                <span>Σ return USD: {batchAggregates.sumTotalReturnUsd != null ? String(batchAggregates.sumTotalReturnUsd) : "—"}</span>
                <span>Ø return USD: {batchAggregates.meanTotalReturnUsd != null ? String(batchAggregates.meanTotalReturnUsd) : "—"}</span>
                <span>Ø PF: {batchAggregates.meanProfitFactor != null ? String(batchAggregates.meanProfitFactor) : "—"}</span>
                <span>Ø win %: {batchAggregates.meanWinRate != null ? `${batchAggregates.meanWinRate}%` : "—"}</span>
                <span>Ø max DD %: {batchAggregates.meanMaxDrawdownPct != null ? `${batchAggregates.meanMaxDrawdownPct}%` : "—"}</span>
              </div>
            </div>
          )}
          {batchSummary.batchRunsOmitted ? (
            <div className="text-xs text-rose-200/90 mb-2">{String(batchSummary.batchRunsOmittedReason ?? "")}</div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="py-1 pr-2">runId</th>
                  <th className="py-1 pr-2">Inst</th>
                  <th className="py-1 pr-2">TF</th>
                  <th className="py-1 pr-2 text-right">Ret $</th>
                  <th className="py-1 pr-2 text-right">PF</th>
                  <th className="py-1 pr-2 text-right">Trades</th>
                  <th className="py-1 pr-2 text-right">Win %</th>
                  <th className="py-1 pr-2 text-right">Sharpe</th>
                  <th className="py-1 pr-2 text-right">Max DD %</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(batchSummary.runs) ? batchSummary.runs : []).map((row, idx) => {
                  const r = row as Record<string, unknown>;
                  return (
                    <tr key={idx} className="border-b border-zinc-800/80 text-zinc-300">
                      <td className="py-1 pr-2 font-mono truncate max-w-[120px]">{String(r.runId ?? "")}</td>
                      <td className="py-1 pr-2">{String(r.instrument ?? "")}</td>
                      <td className="py-1 pr-2">{String(r.timeframe ?? "")}</td>
                      <td className="py-1 pr-2 text-right">{String(r.totalReturnUsd ?? "")}</td>
                      <td className="py-1 pr-2 text-right">{formatProfitFactorFromRow(r)}</td>
                      <td className="py-1 pr-2 text-right">{String(r.tradeCount ?? "")}</td>
                      <td className="py-1 pr-2 text-right">{r.winRate != null ? String(r.winRate) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{r.sharpeRatio != null ? String(r.sharpeRatio) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{r.maxDrawdownPct != null ? String(r.maxDrawdownPct) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Quality gate checks</div>
          {qualityChecks.length === 0 ? (
            <div className="text-sm text-zinc-400">No gate checks returned.</div>
          ) : (
            <div className="space-y-1">
              {qualityChecks.map((check, idx) => (
                <div key={idx} className="text-sm text-zinc-300">
                  {String(check.metric ?? "metric")}: {String(check.value ?? 0)} vs {String(check.threshold ?? 0)} (
                  {Boolean(check.passed) ? "PASS" : "FAIL"})
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Experiment tracking</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Hypothesis: {String(experiment?.hypothesis ?? "N/A")}</div>
            <div>
              Tags: {Array.isArray(experiment?.tags) ? (experiment?.tags as unknown[]).map(String).join(", ") : "N/A"}
            </div>
            <div>Branch: {String(experiment?.branch_name ?? experiment?.branchName ?? "main")}</div>
            <div>Branch seq: {String(experiment?.branch_seq ?? experiment?.branchSeq ?? "N/A")}</div>
            <div>Parent run ID: {String(experiment?.parent_run_id ?? experiment?.parentRunId ?? "root")}</div>
            <div>Promote on pass: {String(experiment?.promote_on_pass ?? false)}</div>
            <div>
              Promote recommendation:{" "}
              {String(experiment?.promoteDecision ?? (qualityGate?.passed === true ? "review_candidate" : "hold"))}
            </div>
            <div>Baseline run ID: {String(experiment?.baseline_run_id ?? "N/A")}</div>
            {promoteEvidence && (
              <>
                <div>Gate passed: {String(promoteEvidence.gatePassed ?? false)}</div>
                <div>Stability score: {String(promoteEvidence.stabilityScore ?? 0)}</div>
                <div>Promote reason: {String(promoteEvidence.reason ?? "n/a")}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Run diff (current vs baseline)</div>
        {runDiffRows.length === 0 ? (
          <div className="text-sm text-zinc-400">No baseline diff available yet.</div>
        ) : (
          <div className="space-y-1">
            {runDiffRows.map(([metric, val]) => {
              const obj = (val ?? {}) as Record<string, unknown>;
              const delta = Number(obj.delta ?? 0);
              return (
                <div key={metric} className="text-sm text-zinc-300">
                  {metric}: {String(obj.current ?? 0)} vs {String(obj.baseline ?? 0)} |{" "}
                  <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    delta {String(obj.delta ?? 0)} ({String(obj.deltaPct ?? 0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
        </div>
      </details>
    </div>
  );
}
