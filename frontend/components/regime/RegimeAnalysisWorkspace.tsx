"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunResponse } from "@shared/types";
import type { SavedBacktestRun } from "@/lib/firestore";
import { AnalyticsRegimePanel } from "@/components/results/analytics/AnalyticsRegimePanel";

function formatRunDate(run: SavedBacktestRun): string {
  const s = run.savedAt?.seconds;
  if (typeof s === "number") {
    try {
      return new Date(s * 1000).toLocaleString();
    } catch {
      return run.id;
    }
  }
  return run.id;
}

function runHasRegimeSegmentation(run: SavedBacktestRun): boolean {
  const ra = run.regimeAnalysis as Record<string, unknown> | null | undefined;
  if (!ra) return false;
  if (ra.segmentation === "per_regime_ema_atr_v1") return true;
  if (ra.byRegime && typeof ra.byRegime === "object") return true;
  const tr = run.trades;
  if (Array.isArray(tr) && tr.some((t) => t && typeof t === "object" && "marketRegime" in (t as object))) return true;
  return false;
}

function savedToResponse(run: SavedBacktestRun): RunResponse {
  return {
    runId: run.runId ?? undefined,
    equity: [],
    equityCurve: run.equityCurve ?? undefined,
    metrics: run.metrics as RunResponse["metrics"],
    trades: (run.trades ?? []) as RunResponse["trades"],
    ohlc: undefined,
    regimeAnalysis: run.regimeAnalysis ?? undefined,
    validation: run.validation ?? undefined,
    robustness: run.robustness ?? undefined,
    monteCarlo: run.monteCarlo ?? undefined,
  } as RunResponse;
}

export interface RegimeAnalysisWorkspaceProps {
  runs: SavedBacktestRun[];
  strategyOpen: boolean;
  strategyName?: string;
  /** Aktuální výsledek v paměti po backtestu (nemusí být v historii). */
  liveResults: RunResponse | null;
}

export function RegimeAnalysisWorkspace({
  runs,
  strategyOpen,
  strategyName,
  liveResults,
}: RegimeAnalysisWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const liveOk = !!(liveResults?.regimeAnalysis && typeof liveResults.regimeAnalysis === "object");

  const regimeRuns = useMemo(() => runs.filter(runHasRegimeSegmentation), [runs]);

  useEffect(() => {
    if (!strategyOpen) {
      setSelectedId(null);
      return;
    }
    if (regimeRuns.length === 0 && liveOk) {
      setSelectedId("__live__");
      return;
    }
    if (regimeRuns.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev === "__live__" && liveOk) return prev;
      if (prev && regimeRuns.some((r) => r.id === prev)) return prev;
      return regimeRuns[0]!.id;
    });
  }, [strategyOpen, regimeRuns, liveOk]);

  const activeResults = useMemo((): RunResponse | null => {
    if (selectedId === "__live__" && liveOk && liveResults) return liveResults;
    const run = regimeRuns.find((r) => r.id === selectedId);
    if (run) return savedToResponse(run);
    if (liveOk && liveResults) return liveResults;
    return null;
  }, [selectedId, regimeRuns, liveOk, liveResults]);

  if (!strategyOpen) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-zinc-400">
        Otevři strategii v postranním panelu — záložka Regime zobrazuje segmentaci z uložených nebo čerstvých výsledků
        backtestu.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row gap-0 border-t border-zinc-800">
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/80">
        <div className="border-b border-zinc-800 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Zdroj</div>
          <div className="mt-1 text-xs text-zinc-300">
            {strategyName ? <span className="font-medium text-zinc-100">{strategyName}</span> : "Strategie"}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Jen runy se zapnutou segmentací <span className="text-zinc-400">Per Regime</span> v Edge finding.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {liveOk && (
            <button
              type="button"
              onClick={() => setSelectedId("__live__")}
              className={`mb-2 w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                selectedId === "__live__"
                  ? "border-emerald-600/60 bg-emerald-950/40 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <div className="font-medium text-zinc-200">Aktuální session</div>
              <div className="text-[10px] text-zinc-500">Výsledek v paměti (poslední backtest)</div>
            </button>
          )}
          {regimeRuns.length === 0 && !liveOk ? (
            <p className="px-2 py-4 text-xs text-zinc-500">
              Žádný run s regime analýzou. Zapni Per Regime v nastavení backtestu a ulož výsledek.
            </p>
          ) : (
            <ul className="space-y-1">
              {regimeRuns.map((r) => {
                const selected = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                        selected
                          ? "border-violet-600/60 bg-violet-950/30 text-zinc-100"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <div className="font-mono text-[10px] text-zinc-500">{r.id.slice(0, 28)}…</div>
                      <div className="text-[11px] text-zinc-400">{formatRunDate(r)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {activeResults ? (
          <AnalyticsRegimePanel results={activeResults} />
        ) : (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-5 text-sm text-amber-100">
            Vyber run vlevo nebo spusť backtest s <span className="font-medium">Per Regime</span>.
          </div>
        )}
      </main>
    </div>
  );
}
