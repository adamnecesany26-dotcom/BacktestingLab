"use client";

import type { RunResponse } from "@shared/types";

interface StatBlocksProps {
  results: RunResponse | null;
}

const STAT_ITEMS = [
  { key: "sharpeRatio", label: "Sharpe Ratio", format: (v: number) => v.toFixed(2) },
  { key: "finalEquity", label: "Final Equity", format: (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2 }) },
  { key: "rMultiple", label: "R-multiple", format: (v: number) => v.toFixed(2) },
  { key: "maxDrawdown", label: "Max Drawdown", format: (v: number) => `${v.toFixed(2)}%` },
  { key: "tradeCount", label: "Trade Count", format: (v: number) => String(v) },
  { key: "longShort", label: "Longs / Shorts", format: (_: number) => "" },
  { key: "winRate", label: "Win Rate", format: (v: number) => `${v}%` },
  { key: "totalReturn", label: "Total Return %", format: (v: number) => `${v}%` },
  { key: "totalReturnUsd", label: "Total Return USD", format: (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}` },
  { key: "profitFactor", label: "Profit Factor", format: (v: number) => v.toFixed(2) },
  { key: "expectancyUsd", label: "Expectancy USD", format: (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}` },
  { key: "expectancyR", label: "Expectancy R", format: (v: number) => v.toFixed(2) },
] as const;

export function StatBlocks({ results }: StatBlocksProps) {
  if (!results) return null;

  const m = results.metrics as unknown as Record<string, unknown>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {STAT_ITEMS.map(({ key, label, format }) => {
        let value: string;
        if (key === "longShort") {
          value = `${m.longCount ?? 0} / ${m.shortCount ?? 0}`;
        } else {
          const v = m[key] as number | undefined;
          value = v != null ? format(v) : "—";
        }
        return (
          <div
            key={key}
            className="rounded-lg bg-zinc-800/80 border border-zinc-700/50 p-3 w-[140px] h-[72px] flex flex-col justify-between"
          >
            <span className="text-xs text-zinc-500 uppercase tracking-wider truncate">{label}</span>
            <span className="font-mono text-sm text-zinc-200 truncate">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
