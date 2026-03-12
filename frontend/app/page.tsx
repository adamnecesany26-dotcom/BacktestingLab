"use client";

import { Sidebar } from "@/components/Sidebar";
import { StrategyEditor } from "@/components/editor/StrategyEditor";
import { RunButton } from "@/components/RunButton";
import { ExportButton } from "@/components/ExportButton";
import { BacktestResults } from "@/components/BacktestResults";
import { EquityChart } from "@/components/charts/EquityChart";
import { LogPanel } from "@/components/LogPanel";
import { useState } from "react";
import type { RunResponse } from "@shared/types";

export default function Home() {
  const [code, setCode] = useState(`import backtrader as bt

class Strategy(bt.Strategy):
    def next(self):
        if not self.position:
            self.buy(size=100)
`);

  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<RunResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleRun = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("Starting backtest...");
    try {
      const res = await fetch("http://localhost:8000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          instrument: "BTCUSD",
          timeframe: "1d",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: RunResponse = await res.json();
      setResults(data);
      addLog(`Done. ${data.metrics.tradeCount} trades, equity: ${data.metrics.finalEquity.toFixed(2)}`);
    } catch (e) {
      addLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setResults(null);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onSelectFile={(path) => addLog(`Selected: ${path}`)} />
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
              <RunButton onClick={handleRun} disabled={isRunning} />
              <ExportButton results={results} />
              <span className="text-sm text-zinc-500">strategy.py</span>
            </div>
            <div className="flex-1 min-h-0">
              <StrategyEditor value={code} onChange={setCode} />
            </div>
          </div>
          <div className="w-96 flex flex-col overflow-hidden bg-zinc-900/50">
            <div className="border-b border-zinc-800 px-4 py-2 font-medium text-sm">
              Results
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              <BacktestResults results={results} />
              <EquityChart equity={results?.equity ?? []} />
            </div>
          </div>
        </div>
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
