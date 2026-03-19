"use client";

import { useState } from "react";
import type { RunResponse } from "@shared/types";
import { assessOverfitting } from "@/lib/overfittingSignals";

interface AnalyticsViewProps {
  results: RunResponse;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

function formatProfitFactor(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (value >= 999) return "∞ / no losses";
  return value.toFixed(2);
}

export function AnalyticsView({ results }: AnalyticsViewProps) {
  const [foldOpen, setFoldOpen] = useState<string | null>(null);
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

  const cards: { label: string; value: string }[] = [
    { label: "Počet obchodů", value: String(trades.length) },
    { label: "Win / Loss / BE", value: `${wins.length} / ${losses.length} / ${breakeven.length}` },
    { label: "Avg Win", value: `$${avgWin.toFixed(2)}` },
    { label: "Avg Loss", value: `$${avgLoss.toFixed(2)}` },
    { label: "Best / Worst", value: `$${bestTrade.toFixed(2)} / $${worstTrade.toFixed(2)}` },
    { label: "Avg MFE / MAE", value: `${avgMfe.toFixed(2)} / ${avgMae.toFixed(2)}` },
    { label: "Max Equity", value: `$${(results.metrics.maxEquity ?? results.metrics.finalEquity).toFixed(2)}` },
    { label: "Max DD", value: `${(results.metrics.maxDrawdownPct ?? results.metrics.maxDrawdown).toFixed(2)}%` },
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
  const heatmap =
    robustness?.heatmap && typeof robustness.heatmap === "object"
      ? (robustness.heatmap as Record<string, unknown>)
      : null;
  const heatmapCells = Array.isArray(heatmap?.cells) ? (heatmap.cells as Record<string, unknown>[]) : [];
  const maxHeatCount = heatmapCells.reduce((m, c) => {
    const v = Number(c.count ?? 0);
    return Number.isFinite(v) ? Math.max(m, v) : m;
  }, 0);
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
  const foldsRaw = Array.isArray(results.validation?.folds) ? (results.validation?.folds as Record<string, unknown>[]) : [];
  const guardrails =
    results.validation?.guardrails && typeof results.validation.guardrails === "object"
      ? (results.validation.guardrails as Record<string, unknown>)
      : null;
  const guardHints = Array.isArray(guardrails?.possibleLeakageHints)
    ? (guardrails.possibleLeakageHints as string[])
    : [];
  const batchSummary =
    results.batchSummary && typeof results.batchSummary === "object"
      ? (results.batchSummary as Record<string, unknown>)
      : null;
  const sweepTested = Number(robustness?.tested ?? 0);
  const stabilityScore = Number(robustness?.stabilityScore ?? NaN);
  const avgDegradation = Number(validationSummary?.avgDegradation ?? 0);
  const foldsFailedGates = Number(validationSummary?.foldsFailedGates ?? 0);
  const batchRunCount = Number(batchSummary?.runCount ?? 0);
  const profitFactorMetric = Number(results.metrics?.profitFactor ?? NaN);
  const qualityGatePassed =
    qualityGate && typeof qualityGate.passed === "boolean" ? (qualityGate.passed as boolean) : undefined;

  const overfittingAssessment = assessOverfitting({
    validationMode,
    tradeCount,
    riskOfRuin,
    qualityGatePassed: qualityGatePassed ?? null,
    avgDegradation,
    foldsFailedGates,
    guardHintCount: guardHints.length,
    sweepTested,
    stabilityScore,
    batchRunCount,
    profitFactor: profitFactorMetric,
  });
  const overfittingFlags = overfittingAssessment.warnings;
  const readinessLabel = overfittingAssessment.readinessLabel;

  return (
    <div className="py-4 space-y-4">
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 p-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Heuristic edge readiness signal</div>
        <div className="text-sm text-zinc-200">{readinessLabel}</div>
        <div className="text-xs text-zinc-400 mt-1">
          Validation: {validationMode} | Trades: {tradeCount} | Risk of ruin:{" "}
          {Number.isFinite(riskOfRuin) ? riskOfRuin.toFixed(4) : "N/A"} | Severity score:{" "}
          {overfittingAssessment.severityScore} (heuristika, ne p-value)
        </div>
      </div>

      {overfittingFlags.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-xs uppercase tracking-wider text-amber-200 mb-2">Overfitting warnings</div>
          <div className="space-y-1">
            {overfittingFlags.map((flag) => (
              <div key={flag} className="text-sm text-amber-100">
                - {flag}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
            <div className="text-xs uppercase tracking-wider text-zinc-500">{card.label}</div>
            <div className="text-sm font-mono text-zinc-200 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
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
            <div>Avg degradation: {String(validationSummary?.avgDegradation ?? 0)}</div>
            <div>Profit factor: {formatProfitFactor(results.metrics.profitFactor)}</div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Robustness & Monte Carlo</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Sweep tested: {String(robustness?.tested ?? 0)}</div>
            <div>Stability score: {String(robustness?.stabilityScore ?? 0)}</div>
            <div>
              Score p10/p50/p90:{" "}
              {`${String(scoreDistribution?.p10 ?? 0)} / ${String(scoreDistribution?.p50 ?? 0)} / ${String(scoreDistribution?.p90 ?? 0)}`}
            </div>
            <div>MC simulations: {String(monteCarlo?.simulations ?? 0)}</div>
            <div>MC method: {monteCarloMethod}</div>
            <div>MC mode: {monteCarloMode}</div>
            <div>Risk of ruin estimate: {String(monteCarlo?.riskOfRuin ?? 0)}</div>
            {monteCarloNote && <div className="text-xs text-zinc-500 pt-1">{monteCarloNote}</div>}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Regimes</div>
          <div className="text-sm text-zinc-300">
            {regime?.regimes && typeof regime.regimes === "object"
              ? `${Object.keys(regime.regimes as Record<string, unknown>).length} segments`
              : "N/A"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Portfolio</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Enabled: {String(!!portfolio)}</div>
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
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3 md:col-span-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Execution model &amp; costs</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Enabled: {String(execution?.enabled ?? false)}</div>
            <div>Spread bps: {String(execution?.spreadBps ?? 0)}</div>
            <div>Latency bars: {String(execution?.latencyBars ?? 0)}</div>
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
              <div>Total execution costs: {String(costAttr.totalExecutionCosts ?? "—")}</div>
              <div>Costs / net return ratio: {String(costAttr.executionCostsToNetReturnRatio ?? "—")}</div>
              <div>Costs / Σ|trade PnL| ratio: {String(costAttr.executionCostsToGrossAbsPnlRatio ?? "—")}</div>
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
        </div>
      </div>

      {batchSummary && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-xs uppercase tracking-wider text-amber-200 mb-2">Batch / matrix run</div>
          <div className="text-sm text-amber-100 mb-2">{String(batchSummary.multipleTestingWarning ?? "")}</div>
          <div className="text-xs text-zinc-400 mb-2">
            Batch ID: {String(batchSummary.batchId ?? "—")} | Runs: {String(batchSummary.runCount ?? 0)}
          </div>
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
                      <td className="py-1 pr-2 text-right">{formatProfitFactor(Number(r.profitFactor))}</td>
                      <td className="py-1 pr-2 text-right">{String(r.tradeCount ?? "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {foldsRaw.length > 0 && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Walk-forward / OOS folds</div>
          {guardHints.length > 0 && (
            <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100">
              <div className="text-amber-200 font-medium mb-1">Guardrails (heuristic)</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {guardHints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            {foldsRaw.map((f) => {
              const id = String(f.id ?? "");
              const open = foldOpen === id;
              const tm = f.testMetrics && typeof f.testMetrics === "object" ? (f.testMetrics as Record<string, unknown>) : {};
              return (
                <div key={id} className="border border-zinc-700/40 rounded-md overflow-hidden">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm bg-zinc-800/50 hover:bg-zinc-800 flex justify-between gap-2"
                    onClick={() => setFoldOpen(open ? null : id)}
                  >
                    <span className="font-mono text-zinc-200">{id}</span>
                    <span className="text-zinc-500 text-xs">
                      test {String(f.testStart ?? "")} → {String(f.testEnd ?? "")} | trades {String(tm.tradeCount ?? "—")}
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 py-2 text-xs text-zinc-400 space-y-1 border-t border-zinc-700/40">
                      <div>
                        Train: {String(f.trainStart ?? "")} — {String(f.trainEnd ?? "")} ({String(f.trainBarCount ?? "")} bars)
                      </div>
                      <div>
                        Test: {String(f.testStart ?? "")} — {String(f.testEnd ?? "")} ({String(f.testBarCount ?? "")} bars)
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 text-zinc-300">
                        <div>Test return $: {String(tm.totalReturnUsd ?? "—")}</div>
                        <div>PF: {formatProfitFactor(Number(tm.profitFactor))}</div>
                        <div>Sharpe: {String(tm.sharpeRatio ?? "—")}</div>
                        <div>Max DD %: {String(tm.maxDrawdownPct ?? "—")}</div>
                        <div>Win %: {String(tm.winRate ?? "—")}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {heatmap && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Sweep heatmap (stability view)</div>
          <div className="text-xs text-zinc-400 mb-3">
            x: {String(heatmap.xKey ?? "n/a")} | y: {String(heatmap.yKey ?? "n/a")}
          </div>
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${Number(heatmap.xBins ?? 0)}, minmax(0, 1fr))`,
            }}
          >
            {heatmapCells.map((cell, idx) => {
              const count = Number(cell.count ?? 0);
              const intensity = maxHeatCount > 0 ? count / maxHeatCount : 0;
              return (
                <div
                  key={idx}
                  className="h-6 rounded text-[10px] flex items-center justify-center border border-zinc-800"
                  style={{
                    backgroundColor: `rgba(16, 185, 129, ${0.12 + intensity * 0.75})`,
                    color: intensity > 0.6 ? "#052e16" : "#d4d4d8",
                  }}
                  title={`count=${count}, avgScore=${String(cell.avgScore ?? 0)}`}
                >
                  {count > 0 ? count : ""}
                </div>
              );
            })}
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
  );
}
