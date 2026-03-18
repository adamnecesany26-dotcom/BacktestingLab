"use client";

import type { RunResponse } from "@shared/types";

interface AnalyticsViewProps {
  results: RunResponse;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

export function AnalyticsView({ results }: AnalyticsViewProps) {
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

  return (
    <div className="py-4 space-y-4">
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
            <div>Risk of ruin: {String(monteCarlo?.riskOfRuin ?? 0)}</div>
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
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Execution model</div>
          <div className="space-y-1 text-sm text-zinc-300">
            <div>Enabled: {String(execution?.enabled ?? false)}</div>
            <div>Spread bps: {String(execution?.spreadBps ?? 0)}</div>
            <div>Latency bars: {String(execution?.latencyBars ?? 0)}</div>
            <div>Total fees: {String(execution?.totalFees ?? 0)}</div>
            <div>Total slippage cost: {String(execution?.totalSlippageCost ?? 0)}</div>
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
                {String(forwardBridge.baselineFinalEquity ?? "n/a")} ->{" "}
                {String(forwardBridge.currentFinalEquity ?? "n/a")})
              </div>
            )}
          </div>
        </div>
      </div>

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
            <div>Promote on pass: {String(experiment?.promote_on_pass ?? false)}</div>
            <div>
              Promote recommendation:{" "}
              {String(experiment?.promoteDecision ?? (qualityGate?.passed === true ? "candidate_for_promote" : "hold"))}
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
