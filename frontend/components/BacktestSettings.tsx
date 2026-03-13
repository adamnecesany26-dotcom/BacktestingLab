"use client";

import React from "react";
import type { DataInstrument, InstrumentType } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";

export interface BacktestParams {
  initialCapital: number;
  slippagePerc: number;
  instrumentType: InstrumentType;
  /** Futures */
  tickSize?: number;
  valuePerTick?: number;
  /** Stocks */
  shareSize?: number;
  /** Forex */
  lotSize?: number;
  pipSize?: number;
  pipValue?: number;
}

type PartialBacktestParams = Partial<BacktestParams>;

interface BacktestSettingsProps {
  instruments: DataInstrument[];
  instrumentsLoaded?: boolean;
  selectedInstrument: DataInstrument | null;
  onSelectInstrument: (inv: DataInstrument) => void;
  years: number;
  onYearsChange: (y: number) => void;
  params: BacktestParams;
  onParamsChange: (p: PartialBacktestParams) => void;
  indicators?: FirestoreItem[];
  selectedIndicatorIds?: string[];
  onSelectIndicators?: (ids: string[]) => void;
  modules?: FirestoreItem[];
  selectedModuleIds?: string[];
  onSelectModules?: (ids: string[]) => void;
  onConfirmSelection?: () => void;
  onRun: () => void;
  isRunning: boolean;
  canRun?: boolean;
}

export function BacktestSettings({
  instruments,
  instrumentsLoaded = true,
  selectedInstrument,
  onSelectInstrument,
  years,
  onYearsChange,
  params,
  onParamsChange,
  indicators = [],
  selectedIndicatorIds = [],
  onSelectIndicators,
  modules = [],
  selectedModuleIds = [],
  onSelectModules,
  onConfirmSelection,
  onRun,
  isRunning,
  canRun = true,
}: BacktestSettingsProps) {
  const maxYears = selectedInstrument?.yearsAvailable ?? 5;
  const minYears = 1;

  const inputClass = "w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200";
  const labelClass = "block text-sm text-zinc-400 mb-1";

  const content = (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Nastavení backtestu
      </h4>
      <div>
        <label className={labelClass}>Instrument Type</label>
        <select
          value={params.instrumentType}
          onChange={(e) => onParamsChange({ instrumentType: e.target.value as InstrumentType })}
          className={inputClass}
        >
          <option value="futures">Futures</option>
          <option value="stocks">Stocks</option>
          <option value="forex">Forex</option>
        </select>
      </div>
      {params.instrumentType === "futures" && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Tick Size</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={params.tickSize ?? 0.25}
              onChange={(e) => onParamsChange({ tickSize: parseFloat(e.target.value) || 0.25 })}
              className={inputClass}
              placeholder="např. 0.25"
            />
          </div>
          <div>
            <label className={labelClass}>Value Per Tick (USD)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={params.valuePerTick ?? 5}
              onChange={(e) => onParamsChange({ valuePerTick: parseFloat(e.target.value) || 5 })}
              className={inputClass}
              placeholder="např. 5 pro NQ"
            />
          </div>
        </div>
      )}
      {params.instrumentType === "stocks" && (
        <div>
          <label className={labelClass}>Position Size (počet akcií)</label>
          <input
            type="number"
            min={1}
            step={1}
            value={params.shareSize ?? 100}
            onChange={(e) => onParamsChange({ shareSize: parseInt(e.target.value, 10) || 100 })}
            className={inputClass}
            placeholder="např. 100"
          />
          <span className="text-xs text-zinc-500">PnL = (exit - entry) × shares</span>
        </div>
      )}
      {params.instrumentType === "forex" && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Lot Size</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={params.lotSize ?? 1}
              onChange={(e) => onParamsChange({ lotSize: parseFloat(e.target.value) || 1 })}
              className={inputClass}
              placeholder="např. 1"
            />
          </div>
          <div>
            <label className={labelClass}>Pip Size</label>
            <input
              type="number"
              min={0}
              step={0.0001}
              value={params.pipSize ?? 0.0001}
              onChange={(e) => onParamsChange({ pipSize: parseFloat(e.target.value) || 0.0001 })}
              className={inputClass}
              placeholder="default 0.0001"
            />
          </div>
          <div>
            <label className={labelClass}>Pip Value (USD)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={params.pipValue ?? 10}
              onChange={(e) => onParamsChange({ pipValue: parseFloat(e.target.value) || 10 })}
              className={inputClass}
              placeholder="např. 10"
            />
          </div>
        </div>
      )}
      <div>
        <label className={labelClass}>Instrument</label>
        <select
          value={selectedInstrument?.instrument ?? ""}
          onChange={(e) => {
            const inv = instruments.find((i) => i.instrument === e.target.value);
            if (inv) onSelectInstrument(inv);
          }}
          className={inputClass}
        >
          {!instrumentsLoaded ? (
            <option value="">Načítám...</option>
          ) : instruments.length === 0 ? (
            <option value="">
              {params.instrumentType === "futures"
                ? "Žádné futures"
                : params.instrumentType === "stocks"
                  ? "Žádné akcie"
                  : "Žádné forex páry"}
            </option>
          ) : (
            instruments.map((inv) => (
              <option key={inv.file} value={inv.instrument}>
                {inv.instrument} ({inv.yearsAvailable} let)
              </option>
            ))
          )}
        </select>
      </div>
      {canRun && onSelectIndicators && (
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            Indikátory (volitelné)
          </label>
          <div className="max-h-20 overflow-auto rounded bg-zinc-800 border border-zinc-700 p-2 space-y-1">
            {indicators.length === 0 ? (
              <p className="text-zinc-500 text-xs">Žádné indikátory. Vytvoř v sekci Indikátory.</p>
            ) : (
              indicators.map((ind) => (
                <label key={ind.id} className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={selectedIndicatorIds.includes(ind.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectIndicators([...selectedIndicatorIds, ind.id]);
                      } else {
                        onSelectIndicators(selectedIndicatorIds.filter((id) => id !== ind.id));
                      }
                    }}
                    className="rounded"
                  />
                  {ind.name}
                </label>
              ))
            )}
          </div>
          {indicators.length > 0 && (
            <span className="text-xs text-zinc-500">
              Import: from indicators.{`{Název}`} import {`{Třída}`}
            </span>
          )}
        </div>
      )}
      {canRun && onSelectModules && (
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            Moduly (volitelné)
          </label>
          <div className="max-h-20 overflow-auto rounded bg-zinc-800 border border-zinc-700 p-2 space-y-1">
            {modules.length === 0 ? (
              <p className="text-zinc-500 text-xs">Žádné moduly. Vytvoř v sekci Moduly.</p>
            ) : (
              modules.map((mod) => (
                <label key={mod.id} className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={selectedModuleIds.includes(mod.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectModules([...selectedModuleIds, mod.id]);
                      } else {
                        onSelectModules(selectedModuleIds.filter((id) => id !== mod.id));
                      }
                    }}
                    className="rounded"
                  />
                  {mod.name}
                </label>
              ))
            )}
          </div>
          {modules.length > 0 && (
            <span className="text-xs text-zinc-500">
              Import: from modules.{`{Název}`} import {`{funkce/třída}`}
            </span>
          )}
        </div>
      )}
      {canRun && onConfirmSelection && (selectedIndicatorIds.length > 0 || selectedModuleIds.length > 0) && (
        <button
          onClick={onConfirmSelection}
          className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
        >
          Potvrdit → zobrazit v menu
        </button>
      )}
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
            className={inputClass}
          />
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
            className={inputClass}
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
