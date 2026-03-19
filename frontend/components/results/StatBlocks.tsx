"use client";

import type { RunResponse } from "@shared/types";

interface StatBlocksProps {
  results: RunResponse | null;
}

const METH_TIPS: Partial<Record<string, string>> = {
  sharpeRatio:
    "Annualized Sharpe z equity křivky (Backtrader analyzer). Předpoklady i.i.d. výnosů často neplatí — používej jako hrubý poměr signálu k šumu.",
  sortinoRatio:
    "Podobně jako Sharpe, ale penalizuje jen downside volatilitu. Stále závisí na frekvenci dat a délce vzorku.",
  profitFactor:
    "Hrubý zisk / hrubá ztráta z uzavřených obchodů. Hodnota ≥999 znamená sentinel „bez ztrátových obchodů“ v tomto vzorku.",
  maxDrawdown: "Maximální propad equity od lokálního maxima (%) — z analyzeru a křivky.",
  expectancyR:
    "Expectancy USD děleno průměrnou velikostí ztráty — hrubý „R“ proxy; není to broker R-multiple bez definovaného risku na obchod.",
};

function MethTip({ text }: { text: string }) {
  return (
    <span className="ml-0.5 text-zinc-500 cursor-help select-none" title={text}>
      ⓘ
    </span>
  );
}

const STAT_ITEMS = [
  { key: "sharpeRatio", label: "Sharpe Ratio", format: (v: number) => v.toFixed(2) },
  { key: "finalEquity", label: "Final Equity", format: (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2 }) },
  { key: "sortinoRatio", label: "Sortino Ratio", format: (v: number) => v.toFixed(2) },
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

function formatProfitFactor(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 999) return "∞ / no losses";
  return value.toFixed(2);
}

export function StatBlocks({ results }: StatBlocksProps) {
  if (!results) return null;

  const m = results.metrics as unknown as Record<string, unknown>;
  const mc = results.monteCarlo && typeof results.monteCarlo === "object" ? (results.monteCarlo as Record<string, unknown>) : null;
  const ror = mc != null ? Number(mc.riskOfRuin ?? NaN) : NaN;
  const mcMode = mc != null ? String(mc.mode ?? "n/a") : "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {STAT_ITEMS.map(({ key, label, format }) => {
          let value: string;
          if (key === "longShort") {
            value = `${m.longCount ?? 0} / ${m.shortCount ?? 0}`;
          } else if (key === "profitFactor") {
            value = formatProfitFactor(m[key] as number | undefined);
          } else {
            const v = m[key] as number | undefined;
            value = v != null ? format(v) : "—";
          }
          const tip = METH_TIPS[key as string];
          return (
            <div
              key={key}
              className="rounded-lg bg-zinc-800/80 border border-zinc-700/50 p-3 w-[140px] h-[72px] flex flex-col justify-between"
            >
              <span className="text-xs text-zinc-500 uppercase tracking-wider truncate flex items-center">
                {label}
                {tip ? <MethTip text={tip} /> : null}
              </span>
              <span className="font-mono text-sm text-zinc-200 truncate">{value}</span>
            </div>
          );
        })}
      </div>
      {mc != null && Number.isFinite(ror) && (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2 text-xs text-zinc-400 flex flex-wrap gap-x-3 gap-y-1 items-center">
          <span className="text-zinc-500 uppercase tracking-wider">Monte Carlo</span>
          <span>
            Risk of ruin (est.): <span className="text-zinc-200 font-mono">{ror.toFixed(4)}</span>
          </span>
          <span>
            Mode: <span className="text-zinc-200 font-mono">{mcMode}</span>
          </span>
          <span className="flex items-center">
            Bootstrap odhad z resampled PnL
            <MethTip text="riskOfRuin je podíl simulací, kde max DD % překročil práh — ne pravděpodobnost z tržního modelu." />
          </span>
        </div>
      )}
    </div>
  );
}
