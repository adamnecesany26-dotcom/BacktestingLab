"use client";

import { useState } from "react";
import { EquityChart } from "@/components/charts/EquityChart";
import { ModuleOutputChart } from "@/components/charts/ModuleOutputChart";
import { TradeHighlight } from "@/components/results/TradeHighlight";
import { RunHistory } from "@/components/results/RunHistory";
import { StatBlocks } from "@/components/results/StatBlocks";
import { AnalyticsView } from "@/components/results/AnalyticsView";
import type { RunResponse } from "@shared/types";
import type { SavedBacktestRun } from "@/lib/firestore";

type TabId = "equity" | "highlight" | "detailed" | "analytics" | "runHistory";

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
}: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("equity");

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

  const hasModuleOutputs = !!results.moduleOutputs && Object.keys(results.moduleOutputs).length > 0;
  const mergedOutput = hasModuleOutputs
    ? {
        markers: Object.values(results.moduleOutputs!).flatMap((o) => o.markers ?? []),
        lines: Object.entries(results.moduleOutputs!).flatMap(([mod, o]) =>
          (o.lines ?? []).map((l) => ({ ...l, name: `${mod}: ${l.name ?? "line"}` }))
        ),
        zones: Object.values(results.moduleOutputs!).flatMap((o) => o.zones ?? []),
      }
    : { markers: [] as any[], lines: [] as any[], zones: [] as any[] };

  const tabs: { id: TabId; label: string }[] = [
    { id: "equity", label: "Equity" },
    { id: "highlight", label: "Highlight" },
    { id: "detailed", label: "Detailed" },
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
        <button
          onClick={onExport}
          className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-medium text-sm"
        >
          Export
        </button>
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

      <div className="px-6 pt-3 pb-2 shrink-0 border-b border-zinc-800">
        <StatBlocks results={results} />
      </div>

      <div
        className={`flex-1 px-6 rounded-b-lg overflow-hidden bg-zinc-900/80 border border-zinc-800 border-t-0 ${
          activeTab === "highlight" || activeTab === "detailed" || activeTab === "runHistory" || activeTab === "analytics"
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
          (results.ohlc ? (
            <div className="py-4 h-full overflow-auto">
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
                <ModuleOutputChart
                  ohlc={results.ohlc}
                  moduleName="Detailed"
                  output={mergedOutput}
                  trades={results.trades}
                  height={520}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              Detailed view není dostupný, protože run nevrátil OHLC data.
            </div>
          ))}
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
