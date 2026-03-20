"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleOutputChart } from "@/components/charts/ModuleOutputChart";
import { RunHistory } from "@/components/results/RunHistory";

/** Client-only + stable chunk loading (avoids dev ChunkLoadError on lightweight-charts async splits). */
const EquityChart = dynamic(
  () => import("@/components/charts/EquityChart").then((m) => ({ default: m.EquityChart })),
  { ssr: false, loading: () => <div className="py-16 text-center text-sm text-zinc-500">Načítám graf equity…</div> }
);
const TradeHighlight = dynamic(
  () => import("@/components/results/TradeHighlight").then((m) => ({ default: m.TradeHighlight })),
  { ssr: false, loading: () => <div className="py-16 text-center text-sm text-zinc-500">Načítám graf…</div> }
);
import { StatBlocks } from "@/components/results/StatBlocks";
import { QualityGateBanner } from "@/components/results/QualityGateBanner";
import { AnalyticsView } from "@/components/results/AnalyticsView";
import { RunModuleViewChart } from "@/components/results/RunModuleViewChart";
import type { ModuleOutput, RunResponse } from "@shared/types";
import {
  computeDetailedChartWindow,
  filterModuleOutputToOhlcWindow,
  type DetailedViewMode,
} from "@/lib/detailedTradesWindow";
import type { SavedBacktestRun } from "@/lib/firestore";

type TabId = "equity" | "highlight" | "detailed" | "runView" | "analytics" | "runHistory";

interface ResultsViewProps {
  results: RunResponse | null;
  runHistory: SavedBacktestRun[];
  strategyId: string;
  onBack: () => void;
  onExport: () => void;
  onDeleteRun: (id: string) => void;
  onDeleteAllRuns: () => void;
  onUpdateLifecycle: (runDocId: string, patch: Record<string, unknown>) => Promise<void>;
  strategyName?: string;
  /** Current editor snapshot of main.py (or best-effort) for reproducibility bundle */
  strategyMainPy?: string;
}

export function ResultsView({
  results,
  runHistory,
  strategyId,
  onBack,
  onExport,
  onDeleteRun,
  onDeleteAllRuns,
  onUpdateLifecycle,
  strategyName,
  strategyMainPy = "",
}: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("equity");
  const [bundleBusy, setBundleBusy] = useState(false);
  const [detailedMode, setDetailedMode] = useState<DetailedViewMode>("by_trades");
  const [detailedPage, setDetailedPage] = useState(0);
  const [tradesPerView, setTradesPerView] = useState(15);
  const [monthsPerView, setMonthsPerView] = useState(3);

  useEffect(() => {
    setDetailedPage(0);
  }, [detailedMode, tradesPerView, monthsPerView]);

  const mergedOutput: ModuleOutput = useMemo(() => {
    if (!results) return { markers: [], lines: [], zones: [] };
    const hasModuleOutputs = !!results.moduleOutputs && Object.keys(results.moduleOutputs).length > 0;
    if (!hasModuleOutputs) return { markers: [], lines: [], zones: [] };
    return {
      markers: Object.values(results.moduleOutputs!).flatMap((o) => o.markers ?? []),
      lines: Object.entries(results.moduleOutputs!).flatMap(([mod, o]) =>
        (o.lines ?? []).map((l) => ({ ...l, name: `${mod}: ${l.name ?? "line"}` }))
      ),
      zones: Object.values(results.moduleOutputs!).flatMap((o) => o.zones ?? []),
    };
  }, [results]);

  const detailedWindow = useMemo(() => {
    if (!results?.ohlc?.length) return null;
    return computeDetailedChartWindow(
      results.ohlc,
      results.trades ?? [],
      detailedMode,
      detailedPage,
      tradesPerView,
      monthsPerView
    );
  }, [results, detailedMode, detailedPage, tradesPerView, monthsPerView]);

  const detailedChartOutput = useMemo(() => {
    if (!detailedWindow?.windowOhlc.length) return mergedOutput;
    return filterModuleOutputToOhlcWindow(mergedOutput, detailedWindow.windowOhlc);
  }, [mergedOutput, detailedWindow]);

  const handleReproBundle = useCallback(async () => {
    if (!results) return;
    setBundleBusy(true);
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const manifest = results.manifest ?? {};
      const fp = String((manifest as Record<string, unknown>).datasetFingerprint ?? "n/a");
      const readme = [
        "Backtesting reproducibility bundle",
        "",
        "Limits:",
        "- strategy_main.py is the editor snapshot at export (may differ from Firestore if unsaved).",
        "- Engine/Docker image and data files must match the original run environment.",
        "",
        `datasetFingerprint (manifest): ${fp}`,
      ].join("\n");
      const zipped = zipSync({
        "README_bundle.txt": strToU8(readme),
        "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
        "results_summary.json": strToU8(
          JSON.stringify(
            {
              runId: results.runId,
              metrics: results.metrics,
              validation: results.validation,
              monteCarlo: results.monteCarlo,
              executionSummary: results.executionSummary,
              batchSummary: results.batchSummary,
              qualityGate: results.qualityGate,
              experiment: results.experiment,
            },
            null,
            2
          )
        ),
        "strategy_main.py": strToU8(
          strategyMainPy.trim()
            ? strategyMainPy
            : "# No editor content passed — open main.py and export again.\n"
        ),
      });
      const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `repro-bundle-${(results.runId ?? "run").toString().slice(0, 24)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("ZIP export selhal (chybí balíček fflate?). Spusť npm install ve frontend/. ");
    } finally {
      setBundleBusy(false);
    }
  }, [results, strategyMainPy]);

  if (!results) {
    return (
      <div className="flex flex-col flex-1 p-6">
        <div className="flex justify-between items-center mb-4">
          <button onClick={onBack} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm">
            ← Zpět na editor
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-500">Žádné výsledky</div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "equity", label: "Equity" },
    { id: "highlight", label: "Highlight" },
    { id: "detailed", label: "Detailed" },
    { id: "runView", label: "Run view" },
    { id: "analytics", label: "Analytics" },
    { id: "runHistory", label: "Run history" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <div className="flex justify-between items-center p-6 pb-4 shrink-0">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
        >
          ← Zpět na editor
        </button>
        <div className="flex gap-2">
          <button
            onClick={onExport}
            className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-medium text-sm"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void handleReproBundle()}
            disabled={bundleBusy}
            className="px-4 py-2 rounded-lg bg-emerald-800/60 hover:bg-emerald-700/70 font-medium text-sm disabled:opacity-50"
          >
            {bundleBusy ? "…" : "Repro bundle (ZIP)"}
          </button>
        </div>
      </div>

      <div className="flex gap-1 px-6 shrink-0">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              activeTab === id
                ? "bg-zinc-800 text-emerald-400 border-b-2 border-emerald-500"
                : "bg-zinc-800/50 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {results.qualityGate != null && (
        <div className="px-6 pt-3 shrink-0">
          <QualityGateBanner qualityGate={results.qualityGate} />
        </div>
      )}

      <div className="px-6 pt-3 pb-2 shrink-0 border-b border-zinc-800">
        <StatBlocks results={results} />
      </div>

      <div
        className={`flex-1 px-6 rounded-b-lg overflow-hidden bg-zinc-900/80 border border-zinc-800 border-t-0 ${
          activeTab === "highlight" ||
            activeTab === "detailed" ||
            activeTab === "runView" ||
            activeTab === "runHistory" ||
            activeTab === "analytics"
            ? "min-h-[560px]"
            : "min-h-[480px]"
        }`}
      >
        {activeTab === "equity" && (
          <EquityChart
            equityCurve={results.equityCurve}
            equity={results.equityCurve ? undefined : results.equity}
            height={480}
            dates={
              !results.equityCurve?.length && results.ohlc?.length
                ? (() => {
                    const first = results.ohlc![0]?.date;
                    if (!first) return undefined;
                    const d = new Date(first);
                    d.setDate(d.getDate() - 1);
                    const dayBefore = d.toISOString();
                    return [dayBefore, ...results.ohlc!.map((o) => o.date)];
                  })()
                : undefined
            }
          />
        )}
        {activeTab === "highlight" && (
          <TradeHighlight ohlc={results.ohlc ?? []} trades={results.trades} chartHeight={360} />
        )}
        {activeTab === "detailed" &&
          (results.ohlc && detailedWindow ? (
            <div className="py-4 h-full overflow-auto">
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                  <span className="text-zinc-500 shrink-0">Výřez:</span>
                  <select
                    value={detailedMode}
                    onChange={(e) => setDetailedMode(e.target.value as DetailedViewMode)}
                    className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200"
                  >
                    <option value="by_trades">Počet obchodů</option>
                    <option value="by_months">Období (měsíce)</option>
                  </select>
                  {detailedMode === "by_trades" ? (
                    <label className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Najednou</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={tradesPerView}
                        onChange={(e) => setTradesPerView(Math.min(100, Math.max(1, Number(e.target.value) || 15)))}
                        className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                      />
                    </label>
                  ) : (
                    <label className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Měsíců</span>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={monthsPerView}
                        onChange={(e) => setMonthsPerView(Math.min(36, Math.max(1, Number(e.target.value) || 3)))}
                        className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                      />
                    </label>
                  )}
                  <div className="flex gap-1 ml-auto">
                    <button
                      type="button"
                      disabled={!detailedWindow.hasPrev}
                      onClick={() => setDetailedPage((p) => Math.max(0, p - 1))}
                      className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      ← Předchozí
                    </button>
                    <button
                      type="button"
                      disabled={!detailedWindow.hasNext}
                      onClick={() => setDetailedPage((p) => p + 1)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Další →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-500">{detailedWindow.summary}</p>
                <ModuleOutputChart
                  ohlc={detailedWindow.windowOhlc}
                  moduleName="Detailed"
                  output={detailedChartOutput}
                  trades={detailedWindow.visibleTrades}
                  height={520}
                  rrrTradeStyle
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              Detailed view není dostupný, protože run nevrátil OHLC data.
            </div>
          ))}
        {activeTab === "runView" && (
          <div className="py-4 h-full overflow-auto">
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
              <RunModuleViewChart results={results} height={540} />
            </div>
          </div>
        )}
        {activeTab === "runHistory" && (
          <div className="py-4 h-full overflow-auto">
            <RunHistory
              runs={runHistory}
              onDeleteRun={onDeleteRun}
              onDeleteAll={onDeleteAllRuns}
              onUpdateLifecycle={onUpdateLifecycle}
            />
          </div>
        )}
        {activeTab === "analytics" && (
          <div className="h-full overflow-auto">
            <AnalyticsView results={results} />
          </div>
        )}
      </div>
    </div>
  );
}
