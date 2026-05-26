"use client";

import type { RunResponse } from "@shared/types";
import { validationFoldsPropsFromResults } from "@/lib/analytics/validationFoldsProps";
import { ValidationFoldsPanel } from "@/components/results/ValidationFoldsPanel";

export function AnalyticsOosPanel({ results }: { results: RunResponse }) {
  const v = validationFoldsPropsFromResults(results);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-sky-500/25 bg-sky-950/20 px-4 py-3 text-sm text-zinc-300">
        <h2 className="text-base font-semibold text-zinc-100">OOS split</h2>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed max-w-3xl">
          Jednorázové nebo vícero přehledných řezů dat na <strong>in-sample</strong> (fit) a{" "}
          <strong>out-of-sample</strong> (holdout). Engine vrací metriky pro každý fold — porovnávej hlavně testovací
          P/L a drawdown vůči tréninkové části; stabilní edge drží OOS v rozumném pásmu napříč foldy.
        </p>
      </section>
      <ValidationFoldsPanel
        key={`oos-${String(results.runId ?? "")}`}
        folds={v.foldsRaw}
        guardHints={v.guardHints}
        foldsMissingPayload={v.foldsMissingPayload}
        foldsMissingUnknown={v.foldsMissingUnknown}
        manifestFoldCount={v.manifestFoldCount}
        validationMode="oos_split"
      />
    </div>
  );
}
