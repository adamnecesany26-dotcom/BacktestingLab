"use client";

import React from "react";
import type { DataInstrument } from "@shared/types";

export interface BacktestParams {
  initialCapital: number;
  commissionPerc: number;
  slippagePerc: number;
}

type PartialBacktestParams = Partial<BacktestParams>;

interface BacktestSettingsProps {
  instruments: DataInstrument[];
  selectedInstrument: DataInstrument | null;
  onSelectInstrument: (inv: DataInstrument) => void;
  years: number;
  onYearsChange: (y: number) => void;
  params: BacktestParams;
  onParamsChange: (p: PartialBacktestParams) => void;
  onRun: () => void;
  isRunning: boolean;
  canRun?: boolean;
}

export function BacktestSettings({
  instruments,
  selectedInstrument,
  onSelectInstrument,
  years,
  onYearsChange,
  params,
  onParamsChange,
  onRun,
  isRunning,
  canRun = true,
}: BacktestSettingsProps) {
  const maxYears = selectedInstrument?.yearsAvailable ?? 5;
  const minYears = 1;

  const content = (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Nastavení backtestu
      </h4>
      <div>
        <label className="block text-sm text-zinc-400 mb-1">Instrument</label>
        <select
          value={selectedInstrument?.instrument ?? ""}
          onChange={(e) => {
            const inv = instruments.find((i) => i.instrument === e.target.value);
            if (inv) onSelectInstrument(inv);
          }}
          className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
        >
          {instruments.length === 0 ? (
            <option value="">Načítám...</option>
          ) : (
            instruments.map((inv) => (
              <option key={inv.file} value={inv.instrument}>
                {inv.instrument} ({inv.yearsAvailable} let)
              </option>
            ))
          )}
        </select>
      </div>
      <div>
        <label className="block text-sm text-zinc-400 mb-1">
          Délka (roky, min {minYears} – max {maxYears})
        </label>
        <input
          type="number"
          min={minYears}
          max={maxYears}
          step={0.5}
          value={years}
          onChange={(e) => onYearsChange(parseFloat(e.target.value) || minYears)}
          className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
        />
      </div>
      <div className="border-t border-zinc-700 pt-3 space-y-3">
        <h5 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Realistická simulace
        </h5>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Počáteční kapitál</label>
          <input
            type="number"
            min={1000}
            step={1000}
            value={params.initialCapital}
            onChange={(e) => onParamsChange({ initialCapital: parseFloat(e.target.value) || 100000 })}
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Komise (%)</label>
          <input
            type="number"
            min={0}
            max={10}
            step={0.01}
            value={params.commissionPerc * 100}
            onChange={(e) => onParamsChange({ commissionPerc: (parseFloat(e.target.value) || 0) / 100 })}
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
          />
          <span className="text-xs text-zinc-500">např. 0.1 = 0.1%</span>
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Slippage (%)</label>
          <input
            type="number"
            min={0}
            max={10}
            step={0.01}
            value={params.slippagePerc * 100}
            onChange={(e) => onParamsChange({ slippagePerc: (parseFloat(e.target.value) || 0) / 100 })}
            className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
          />
          <span className="text-xs text-zinc-500">např. 0.1 = 0.1%</span>
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={isRunning || !canRun}
        className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
      >
        {isRunning ? "Běží..." : canRun ? "Run" : "Otevřete strategii"}
      </button>
    </div>
  );
  return content;
}
