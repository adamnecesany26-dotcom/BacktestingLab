"use client";

import type { RunResponse } from "@shared/types";

interface ExportButtonProps {
  results: RunResponse | null;
}

/** Export results as JSON - placeholder for full export */
export function ExportButton({ results }: ExportButtonProps) {
  const handleExport = () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      disabled={!results}
      className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
    >
      Export
    </button>
  );
}
