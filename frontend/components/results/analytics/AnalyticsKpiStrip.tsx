"use client";

import type { RunResponse } from "@shared/types";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { summarizeTradeRMultiples, tradeRFromTrade } from "@/lib/tradeMetrics";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n >= 0 ? "" : "-";
  return `${s}$${Math.abs(n).toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function initialCapital(manifest: Record<string, unknown> | null): number {
  if (!manifest) return 100_000;
  const a = Number(manifest.initial_capital ?? manifest.initialCapital);
  return Number.isFinite(a) && a > 0 ? a : 100_000;
}

export function AnalyticsKpiStrip({ results }: { results: RunResponse }) {
  const m = results.metrics;
  const manifest =
    results.manifest && typeof results.manifest === "object" ? (results.manifest as Record<string, unknown>) : null;
  const ic = initialCapital(manifest);
  const totalPnl =
    m.totalReturnUsd != null && Number.isFinite(Number(m.totalReturnUsd))
      ? Number(m.totalReturnUsd)
      : m.finalEquity != null && Number.isFinite(Number(m.finalEquity))
        ? Number(m.finalEquity) - ic
        : null;
  const winPct = Number.isFinite(Number(m.winRate)) ? Number(m.winRate) : null;
  const maxDd = m.maxDrawdownPct != null && Number.isFinite(Number(m.maxDrawdownPct)) ? Number(m.maxDrawdownPct) : Number(m.maxDrawdown);
  const pfStatus = typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined;
  const rSummary = summarizeTradeRMultiples(results.trades ?? []);
  const avgRFromTrades = rSummary != null ? rSummary.mean : null;
  const avgRMetric =
    m.expectancyR != null && Number.isFinite(Number(m.expectancyR))
      ? Number(m.expectancyR)
      : m.rMultiple != null && Number.isFinite(Number(m.rMultiple))
        ? Number(m.rMultiple)
        : null;
  const kpis: { label: string; value: string; hint?: string; tone?: "emerald" | "rose" | "zinc" }[] = [
    { label: "Celkový P/L", value: fmtUsd(totalPnl), tone: (totalPnl ?? 0) >= 0 ? "emerald" : "rose" },
    { label: "Win rate", value: winPct != null ? `${winPct.toFixed(1)} %` : "—" },
    { label: "Počet obchodů", value: String(m.tradeCount ?? results.trades?.length ?? 0) },
    {
      label: "Ø R (z obchodů)",
      value: avgRFromTrades != null ? avgRFromTrades.toFixed(2) : "—",
      hint:
        avgRFromTrades == null && avgRMetric != null
          ? `Metrika z engine: ${avgRMetric.toFixed(2)}`
          : avgRFromTrades == null
            ? "Chybí initialRisk u obchodů — doplní engine nebo zoneMeta."
            : undefined,
    },
    {
      label: "Max drawdown",
      value: Number.isFinite(maxDd) ? `${maxDd.toFixed(2)} %` : "—",
      tone: "rose",
    },
    {
      label: "Profit factor",
      value: formatProfitFactorDisplay(m.profitFactor, pfStatus),
    },
    {
      label: "Sharpe",
      value: Number.isFinite(Number(m.sharpeRatio)) ? Number(m.sharpeRatio).toFixed(3) : "—",
    },
    {
      label: "Expectancy / trade",
      value: m.expectancyUsd != null && Number.isFinite(Number(m.expectancyUsd)) ? fmtUsd(Number(m.expectancyUsd)) : "—",
    },
    {
      label: "Final equity",
      value: m.finalEquity != null ? fmtUsd(Number(m.finalEquity)) : "—",
    },
    {
      label: "Calmar",
      value: m.calmarRatio != null && Number.isFinite(Number(m.calmarRatio)) ? Number(m.calmarRatio).toFixed(3) : "—",
    },
    {
      label: "Sortino",
      value: m.sortinoRatio != null && Number.isFinite(Number(m.sortinoRatio)) ? Number(m.sortinoRatio).toFixed(3) : "—",
    },
  ];

  const denom = (results.trades ?? []).filter((t) => tradeRFromTrade(t) != null).length;

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-3">Přehled výkonu</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2.5"
            title={k.hint}
          >
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k.label}</div>
            <div
              className={`text-sm font-mono font-medium mt-1 ${
                k.tone === "emerald"
                  ? "text-emerald-400"
                  : k.tone === "rose"
                    ? "text-rose-400"
                    : "text-zinc-100"
              }`}
            >
              {k.value}
            </div>
            {k.hint && <div className="text-[10px] text-zinc-600 mt-1 leading-snug">{k.hint}</div>}
          </div>
        ))}
      </div>
      {denom > 0 && (
        <p className="text-[10px] text-zinc-600 mt-2">
          Ø R z {denom} obchodů s odvozeným rizikem — zbytek řádků bez R v metrice výše.
        </p>
      )}
    </div>
  );
}
