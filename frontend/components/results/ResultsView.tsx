"use client";

import { useState } from "react";
import { EquityChart } from "@/components/charts/EquityChart";
import { TradesChart } from "@/components/charts/TradesChart";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { StatBlocks } from "@/components/results/StatBlocks";
import type { RunResponse } from "@shared/types";

type TabId = "equity" | "trades" | "chart";

interface ResultsViewProps {
  results: RunResponse | null;
  onBack: () => void;
  onExport: () => void;
  onSave: () => void;
  strategyName?: string;
}

export function ResultsView({ results, onBack, onExport, onSave, strategyName }: ResultsViewProps) {
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

  const tabs: { id: TabId; label: string }[] = [
    { id: "equity", label: "Equity" },
    { id: "trades", label: "Trades" },
    { id: "chart", label: "Chart" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 p-6">
      <div className="flex justify-between items-center mb-4 shrink-0">
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
            Export
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm"
          >
            Uložit
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 shrink-0">
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

      <div className="flex-1 min-h-[280px] rounded-b-lg overflow-hidden bg-zinc-900/80 border border-zinc-800 border-t-0">
        {activeTab === "equity" && <EquityChart equity={results.equity} height={320} />}
        {activeTab === "trades" && <TradesChart trades={results.trades} />}
        {activeTab === "chart" && <CandlestickChart ohlc={results.ohlc ?? []} trades={results.trades} />}
      </div>

      <div className="mt-4 overflow-auto max-h-48 shrink-0">
        <StatBlocks results={results} />
      </div>
    </div>
  );
}
