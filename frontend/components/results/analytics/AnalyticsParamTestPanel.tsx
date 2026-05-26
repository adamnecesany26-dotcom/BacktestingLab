"use client";

import type { RunResponse } from "@shared/types";
import { ParamTestAnalytics } from "@/components/results/ParamTestAnalytics";

export function AnalyticsParamTestPanel({ results }: { results: RunResponse }) {
  const paramTest =
    results.validation?.paramTest != null && typeof results.validation.paramTest === "object"
      ? (results.validation.paramTest as Record<string, unknown>)
      : null;

  if (!paramTest) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
        V tomto výsledku chybí blok <code className="text-zinc-400">validation.paramTest</code> — param test nebyl spuštěn
        nebo payload je oříznutý.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-zinc-300">
        <h2 className="text-base font-semibold text-zinc-100">OAT sweep (citlivost jednoho parametru)</h2>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed max-w-3xl">
          Systematická změna vybraných parametrů strategie kolem baseline — odhaluje strmá maxima a „úzké“ plochy, kde
          malý posun zničí výkon. <strong>Nenahrazuje</strong> walk-forward; kombinuj s OOS, pokud testuješ mnoho
          variant.
        </p>
      </section>
      <ParamTestAnalytics paramTest={paramTest} />
    </div>
  );
}
