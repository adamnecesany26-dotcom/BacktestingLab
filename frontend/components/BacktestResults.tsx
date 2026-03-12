"use client";

import type { RunResponse } from "@shared/types";

interface BacktestResultsProps {
  results: RunResponse | null;
}

/** Statistics panel - displays backtest metrics */
export function BacktestResults({ results }: BacktestResultsProps) {
  if (!results) {
    return (
      <div className="text-sm text-zinc-500 italic">
        Run a backtest to see results
      </div>
    );
  }

  const { metrics } = results;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Statistics
      </h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-zinc-500">Final Equity</dt>
        <dd className="font-mono">{metrics.finalEquity.toFixed(2)}</dd>

        <dt className="text-zinc-500">Sharpe Ratio</dt>
        <dd className="font-mono">{metrics.sharpeRatio.toFixed(2)}</dd>

        <dt className="text-zinc-500">Max Drawdown</dt>
        <dd className="font-mono">{metrics.maxDrawdown.toFixed(2)}%</dd>

        <dt className="text-zinc-500">Trade Count</dt>
        <dd className="font-mono">{metrics.tradeCount}</dd>

        {metrics.winRate != null && (
          <>
            <dt className="text-zinc-500">Win Rate</dt>
            <dd className="font-mono">{metrics.winRate}%</dd>
          </>
        )}
        {metrics.totalReturn != null && (
          <>
            <dt className="text-zinc-500">Total Return</dt>
            <dd className="font-mono">{metrics.totalReturn}%</dd>
          </>
        )}
      </dl>
    </div>
  );
}
