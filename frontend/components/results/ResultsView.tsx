"use client";

import { useState } from "react";
import { EquityChart } from "@/components/charts/EquityChart";
import { TradesChart } from "@/components/charts/TradesChart";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { StatBlocks } from "@/components/results/StatBlocks";
import { TradesTable } from "@/components/results/TradesTable";
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

      <div className="flex-1 min-h-[480px] px-6 rounded-b-lg overflow-hidden bg-zinc-900/80 border border-zinc-800 border-t-0">
        {activeTab === "equity" && (
          <EquityChart
            equityCurve={results.equityCurve}
            equity={results.equityCurve ? undefined : results.equity}
            height={480}
            dates={
              !results.equityCurve?.length && results.ohlc?.length
                ? (() => {
                    const first = results.ohlc![0]?.date?.slice(0, 10);
                    if (!first) return undefined;
                    const d = new Date(first);
                    d.setDate(d.getDate() - 1);
                    const dayBefore = d.toISOString().slice(0, 10);
                    return [dayBefore, ...results.ohlc!.map((o) => o.date.slice(0, 10))];
                  })()
                : undefined
            }
          />
        )}
        {activeTab === "trades" && (
          <div className="flex flex-col gap-4 h-full min-h-0 overflow-auto py-4">
            <div className="shrink-0">
              <TradesChart trades={results.trades} height={280} />
            </div>
            <div className="shrink-0">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Všechny obchody</h3>
              <TradesTable trades={results.trades} />
            </div>
          </div>
        )}
        {activeTab === "chart" && <CandlestickChart ohlc={results.ohlc ?? []} trades={results.trades} height={480} />}
      </div>

      <div className="mt-4 p-6 shrink-0">
        <StatBlocks results={results} />
      </div>
    </div>
  );
}
