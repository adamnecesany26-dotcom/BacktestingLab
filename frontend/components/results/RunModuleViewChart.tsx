"use client";

import { useMemo } from "react";
import { ModuleOutputChart } from "@/components/charts/ModuleOutputChart";
import type { ModuleOutput, RunResponse, Trade } from "@shared/types";

function mergeModuleOutputs(moduleOutputs: RunResponse["moduleOutputs"]): ModuleOutput {
  if (!moduleOutputs || !Object.keys(moduleOutputs).length) {
    return { markers: [], lines: [], zones: [] };
  }
  return {
    markers: Object.values(moduleOutputs).flatMap((o) => o.markers ?? []),
    lines: Object.entries(moduleOutputs).flatMap(([mod, o]) =>
      (o.lines ?? []).map((l) => ({ ...l, name: `${mod}: ${l.name ?? "line"}` }))
    ),
    zones: Object.values(moduleOutputs).flatMap((o) => o.zones ?? []),
  };
}

/**
 * Jako View mód: OHLC z runu + sloučené výstupy modulů + všechny obchody (entry/exit).
 */
export function RunModuleViewChart({
  results,
  height = 540,
}: {
  results: RunResponse;
  height?: number;
}) {
  const ohlc = results.ohlc ?? [];
  const output = useMemo(() => mergeModuleOutputs(results.moduleOutputs), [results.moduleOutputs]);
  const trades: Trade[] = results.trades ?? [];

  if (!ohlc.length) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm py-16">
        Run view potřebuje OHLC v odpovědi (spusť backtest s daty obsahujícími časové řady).
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Zobrazení z uložených <code className="text-zinc-400">moduleOutputs</code> z tohoto runu + obchody. Pro živý přepočet modulu použij záložku View v editoru.
      </p>
      <ModuleOutputChart
        ohlc={ohlc}
        moduleName="Run view"
        output={output}
        trades={trades}
        height={height}
      />
    </div>
  );
}
