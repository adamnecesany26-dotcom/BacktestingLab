"use client";

import React, { useState } from "react";
import type { DataInstrument, InstrumentType } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { StrategyParams } from "@/lib/strategyParams";

export interface BacktestParams {
  initialCapital: number;
  slippagePerc: number;
  commissionPerc: number;
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

export interface EdgeFindingSettings {
  validationMode: "single" | "oos_split" | "walk_forward";
  oosRatio: number;
  wfFolds: number;
  wfTestRatio: number;
  minTradesGate: number;
  maxDdGate: number;
  minPfGate: number;
  sweepMode: "none" | "grid" | "random";
  sweepSamples: number;
  monteCarloEnabled: boolean;
  monteCarloSims: number;
  regimeEnabled: boolean;
  portfolioEnabled: boolean;
  portfolioInstrumentsJson: string;
  executionEnabled: boolean;
  spreadBps: number;
  slippageVolMult: number;
  latencyBars: number;
  forwardBridgeEnabled: boolean;
  forwardBridgeMode: "paper_shadow" | "live_shadow";
  forwardBridgeBaselineEquity: number;
  experimentHypothesis: string;
  experimentTagsCsv: string;
  promoteOnPass: boolean;
}

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
  /** Strategy parameters (from PARAMS dict) - only when strategy open */
  strategyParams?: StrategyParams;
  onStrategyParamsChange?: (params: StrategyParams) => void;
  /** Module parameters (VIEW_PARAMS per module) - keyed by module name */
  moduleParams?: Record<string, StrategyParams>;
  onModuleParamsChange?: (moduleName: string, params: StrategyParams) => void;
  /** Module names for which to show params (from applied/selected modules) */
  moduleNamesForParams?: string[];
  edgeSettings?: EdgeFindingSettings;
  onEdgeSettingsChange?: (next: EdgeFindingSettings) => void;
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
  strategyParams = {},
  onStrategyParamsChange,
  moduleParams = {},
  onModuleParamsChange,
  moduleNamesForParams = [],
  edgeSettings,
  onEdgeSettingsChange,
}: BacktestSettingsProps) {
  const maxYears = selectedInstrument?.yearsAvailable ?? 5;
  const minYears = 1;
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    basic: true,
    instrumentConfig: true,
    simulation: true,
    dependencies: true,
    parameters: true,
    run: true,
    edgeFinding: true,
  });
  const [paramsTab, setParamsTab] = useState<"strategy" | string>("strategy");

  const inputClass = "w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200";
  const labelClass = "block text-sm text-zinc-400 mb-1";
  const edge = edgeSettings;

  const strategyParamEntries = Object.entries(strategyParams);
  const hasStrategyParams = strategyParamEntries.length > 0;
  const moduleTabs = moduleNamesForParams.filter((n) => {
    const p = moduleParams[n];
    return p && Object.keys(p).length > 0;
  });
  const hasModuleParams = moduleTabs.length > 0;
  const hasAnyParams = hasStrategyParams || hasModuleParams;

  const currentParams =
    paramsTab === "strategy"
      ? strategyParams
      : moduleParams[paramsTab] ?? {};
  const currentParamEntries = Object.entries(currentParams);
  const onCurrentParamsChange =
    paramsTab === "strategy"
      ? (next: StrategyParams) => onStrategyParamsChange?.(next)
      : (next: StrategyParams) => onModuleParamsChange?.(paramsTab, next);

  const toggleSection = (id: string) => {
    setSectionsOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const Section = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) => (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/40">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/40 rounded-lg"
      >
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</span>
        <span className="text-zinc-500 text-sm">{sectionsOpen[id] ? "▼" : "▶"}</span>
      </button>
      {sectionsOpen[id] && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );

  const content = (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Nastavení backtestu
      </h4>
      <Section id="basic" title="Basic settings">
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
        <div>
          <label className={labelClass}>Instrument</label>
          <select
            value={selectedInstrument?.file ?? ""}
            onChange={(e) => {
              const inv = instruments.find((i) => i.file === e.target.value);
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
                <option key={inv.file} value={inv.file}>
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
            className={inputClass}
          />
        </div>
      </Section>

      <Section id="instrumentConfig" title="Instrument config">
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
              />
            </div>
          </div>
        )}
      </Section>

      <Section id="simulation" title="Simulation">
        <div>
          <label className={labelClass}>Počáteční kapitál</label>
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
          <label className={labelClass}>Slippage (%)</label>
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
        <div>
          <label className={labelClass}>Komise (%)</label>
          <input
            type="number"
            min={0}
            max={10}
            step={0.001}
            value={params.commissionPerc * 100}
            onChange={(e) => onParamsChange({ commissionPerc: (parseFloat(e.target.value) || 0) / 100 })}
            className={inputClass}
          />
          <span className="text-xs text-zinc-500">např. 0.02 = 0.02%</span>
        </div>
      </Section>

      {canRun && (
        <Section id="dependencies" title="Indicators & Modules">
          {onSelectIndicators && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Indikátory (auto-detect + ruční úprava)</label>
              <div className="max-h-24 overflow-auto rounded bg-zinc-800 border border-zinc-700 p-2 space-y-1">
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
            </div>
          )}
          {onSelectModules && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Moduly (auto-detect + ruční úprava)</label>
              <div className="max-h-24 overflow-auto rounded bg-zinc-800 border border-zinc-700 p-2 space-y-1">
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
            </div>
          )}
          {onConfirmSelection && (selectedIndicatorIds.length > 0 || selectedModuleIds.length > 0) && (
            <button
              onClick={onConfirmSelection}
              className="w-full py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
            >
              Potvrdit → zobrazit v menu
            </button>
          )}
        </Section>
      )}

      {canRun && (
        <Section id="edgeFinding" title="Edge finding">
          {edge ? (
            <>
              <div>
                <label className={labelClass}>Validation mode</label>
                <select
                  value={edge.validationMode}
                  onChange={(e) =>
                    onEdgeSettingsChange?.({
                      ...edge,
                      validationMode: e.target.value as EdgeFindingSettings["validationMode"],
                    })
                  }
                  className={inputClass}
                >
                  <option value="single">Single run</option>
                  <option value="oos_split">Out-of-sample split</option>
                  <option value="walk_forward">Walk-forward</option>
                </select>
              </div>
              {edge.validationMode === "oos_split" && (
                <div>
                  <label className={labelClass}>OOS ratio</label>
                  <input
                    type="number"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={edge.oosRatio}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, oosRatio: parseFloat(e.target.value) || 0.25 })}
                    className={inputClass}
                  />
                </div>
              )}
              {edge.validationMode === "walk_forward" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>WF folds</label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      step={1}
                      value={edge.wfFolds}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, wfFolds: parseInt(e.target.value, 10) || 4 })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>WF test ratio</label>
                    <input
                      type="number"
                      min={0.1}
                      max={0.6}
                      step={0.05}
                      value={edge.wfTestRatio}
                      onChange={(e) =>
                        onEdgeSettingsChange?.({ ...edge, wfTestRatio: parseFloat(e.target.value) || 0.2 })
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>Gate min trades</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={edge.minTradesGate}
                    onChange={(e) =>
                      onEdgeSettingsChange?.({ ...edge, minTradesGate: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Gate max DD %</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={edge.maxDdGate}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, maxDdGate: parseFloat(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Gate min PF</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={edge.minPfGate}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, minPfGate: parseFloat(e.target.value) || 0 })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-2 pt-1 border-t border-zinc-800">
                <div>
                  <label className={labelClass}>Experiment hypothesis</label>
                  <input
                    type="text"
                    value={edge.experimentHypothesis}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentHypothesis: e.target.value })}
                    className={inputClass}
                    placeholder="např. SD breakout after liquidity sweep"
                  />
                </div>
                <div>
                  <label className={labelClass}>Experiment tags (CSV)</label>
                  <input
                    type="text"
                    value={edge.experimentTagsCsv}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentTagsCsv: e.target.value })}
                    className={inputClass}
                    placeholder="sd, breakout, nq, v1"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.promoteOnPass}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, promoteOnPass: e.target.checked })}
                    className="rounded"
                  />
                  Promote candidate when gates pass
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Sweep mode</label>
                  <select
                    value={edge.sweepMode}
                    onChange={(e) =>
                      onEdgeSettingsChange?.({
                        ...edge,
                        sweepMode: e.target.value as EdgeFindingSettings["sweepMode"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="none">Disabled</option>
                    <option value="random">Random</option>
                    <option value="grid">Grid</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Sweep samples</label>
                  <input
                    type="number"
                    min={4}
                    max={128}
                    step={1}
                    value={edge.sweepSamples}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, sweepSamples: parseInt(e.target.value, 10) || 24 })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.monteCarloEnabled}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, monteCarloEnabled: e.target.checked })}
                    className="rounded"
                  />
                  Monte Carlo
                </label>
                {edge.monteCarloEnabled && (
                  <div>
                    <label className={labelClass}>MC simulations</label>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      step={10}
                      value={edge.monteCarloSims}
                      onChange={(e) =>
                        onEdgeSettingsChange?.({ ...edge, monteCarloSims: parseInt(e.target.value, 10) || 300 })
                      }
                      className={inputClass}
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.regimeEnabled}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, regimeEnabled: e.target.checked })}
                    className="rounded"
                  />
                  Regime segmentation
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.portfolioEnabled}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, portfolioEnabled: e.target.checked })}
                    className="rounded"
                  />
                  Portfolio backtest
                </label>
                {edge.portfolioEnabled && (
                  <div>
                    <label className={labelClass}>Portfolio instruments (JSON array)</label>
                    <textarea
                      value={edge.portfolioInstrumentsJson}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, portfolioInstrumentsJson: e.target.value })}
                      rows={5}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.executionEnabled}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, executionEnabled: e.target.checked })}
                    className="rounded"
                  />
                  Realistic execution model
                </label>
                {edge.executionEnabled && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={labelClass}>Spread (bps)</label>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={edge.spreadBps}
                          onChange={(e) => onEdgeSettingsChange?.({ ...edge, spreadBps: parseFloat(e.target.value) || 0 })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Slip x vol</label>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={edge.slippageVolMult}
                          onChange={(e) =>
                            onEdgeSettingsChange?.({ ...edge, slippageVolMult: parseFloat(e.target.value) || 0 })
                          }
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Latency bars</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={edge.latencyBars}
                          onChange={(e) => onEdgeSettingsChange?.({ ...edge, latencyBars: parseInt(e.target.value, 10) || 0 })}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={edge.forwardBridgeEnabled}
                        onChange={(e) => onEdgeSettingsChange?.({ ...edge, forwardBridgeEnabled: e.target.checked })}
                        className="rounded"
                      />
                      Forward testing bridge
                    </label>
                    {edge.forwardBridgeEnabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelClass}>Bridge mode</label>
                          <select
                            value={edge.forwardBridgeMode}
                            onChange={(e) =>
                              onEdgeSettingsChange?.({
                                ...edge,
                                forwardBridgeMode: e.target.value as EdgeFindingSettings["forwardBridgeMode"],
                              })
                            }
                            className={inputClass}
                          >
                            <option value="paper_shadow">Paper shadow</option>
                            <option value="live_shadow">Live shadow</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Baseline equity</label>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={edge.forwardBridgeBaselineEquity}
                            onChange={(e) =>
                              onEdgeSettingsChange?.({
                                ...edge,
                                forwardBridgeBaselineEquity: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-zinc-500 text-xs">Edge settings nejsou dostupné.</p>
          )}
        </Section>
      )}

      {canRun && (
        <Section id="parameters" title="Parameters">
          {hasAnyParams ? (
            <>
              <div className="flex gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setParamsTab("strategy")}
                  className={`px-2 py-1 rounded text-xs ${
                    paramsTab === "strategy"
                      ? "bg-zinc-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Strategie
                </button>
                {moduleTabs.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setParamsTab(name)}
                    className={`px-2 py-1 rounded text-xs ${
                      paramsTab === name
                        ? "bg-zinc-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {currentParamEntries.length > 0 ? (
                currentParamEntries.map(([key, value]) => (
                  <div key={key}>
                    <label className={labelClass}>{key}</label>
                    {typeof value === "number" ? (
                      <input
                        type="number"
                        value={value}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v)) {
                            onCurrentParamsChange?.({ ...currentParams, [key]: v });
                          }
                        }}
                        step={Number.isInteger(value) ? 1 : 0.01}
                        className={inputClass}
                      />
                    ) : typeof value === "boolean" ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(e) =>
                            onCurrentParamsChange?.({ ...currentParams, [key]: e.target.checked })
                          }
                          className="rounded"
                        />
                        <span className="text-sm text-zinc-300">{value ? "Yes" : "No"}</span>
                      </label>
                    ) : (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) =>
                          onCurrentParamsChange?.({ ...currentParams, [key]: e.target.value })
                        }
                        className={inputClass}
                      />
                    )}
                  </div>
                ))
              ) : (
                <p className="text-zinc-500 text-xs">
                  {paramsTab === "strategy"
                    ? "Žádné parametry strategie"
                    : `Žádné parametry pro ${paramsTab}`}
                </p>
              )}
            </>
          ) : (
            <p className="text-zinc-500 text-xs">Žádné parametry</p>
          )}
        </Section>
      )}

      <Section id="run" title="Run">
        <button
          onClick={onRun}
          disabled={isRunning || !canRun}
          className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isRunning ? "Běží..." : canRun ? "Run" : "Otevřete strategii"}
        </button>
      </Section>
    </div>
  );
  return content;
}
