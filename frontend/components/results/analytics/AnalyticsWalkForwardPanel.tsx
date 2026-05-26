"use client";

import { useState } from "react";
import type { RunResponse } from "@shared/types";
import { validationFoldsPropsFromResults } from "@/lib/analytics/validationFoldsProps";
import { ValidationFoldsPanel } from "@/components/results/ValidationFoldsPanel";
import { WalkForwardDashboard } from "@/components/results/analytics/WalkForwardDashboard";

export function AnalyticsWalkForwardPanel({ results }: { results: RunResponse }) {
  const v = validationFoldsPropsFromResults(results);
  const hasFolds = v.foldsRaw.length > 0;
  const [showFoldDetails, setShowFoldDetails] = useState(false);

  return (
    <div className="space-y-5">
      {hasFolds ? <WalkForwardDashboard results={results} /> : null}

      {!hasFolds ? (
        <section className="rounded-xl border border-violet-500/25 bg-violet-950/20 px-4 py-3 text-sm text-zinc-300">
          <h2 className="text-base font-semibold text-zinc-100">Walk-forward validace</h2>
          <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed max-w-3xl">
            Posuvná okna: každý fold rozšiřuje trénink a ověřuje strategii na <strong>následném</strong> úseku. Zde
            zatím nejsou načtené foldy — zkontroluj manifest / spusť znovu backtest na aktuálním backendu.
          </p>
        </section>
      ) : null}

      {hasFolds ? (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowFoldDetails((x) => !x)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-900/40 transition-colors"
          >
            <span>
              <span className="font-medium text-zinc-100">Detail foldů</span>
              <span className="text-zinc-500 text-xs ml-2">(IS + OOS sparkline, metriky na fold)</span>
            </span>
            <span className="text-zinc-500 tabular-nums">{showFoldDetails ? "▼" : "▶"}</span>
          </button>
          {showFoldDetails ? (
            <div className="border-t border-zinc-800/80 p-3 sm:p-4">
              <ValidationFoldsPanel
                key={`wf-detail-${String(results.runId ?? "")}`}
                folds={v.foldsRaw}
                guardHints={v.guardHints}
                foldsMissingPayload={v.foldsMissingPayload}
                foldsMissingUnknown={v.foldsMissingUnknown}
                manifestFoldCount={v.manifestFoldCount}
                validationMode="walk_forward"
                hideFoldOverviewBars
              />
            </div>
          ) : null}
        </div>
      ) : (
        <ValidationFoldsPanel
          key={`wf-${String(results.runId ?? "")}`}
          folds={v.foldsRaw}
          guardHints={v.guardHints}
          foldsMissingPayload={v.foldsMissingPayload}
          foldsMissingUnknown={v.foldsMissingUnknown}
          manifestFoldCount={v.manifestFoldCount}
          validationMode="walk_forward"
        />
      )}
    </div>
  );
}
