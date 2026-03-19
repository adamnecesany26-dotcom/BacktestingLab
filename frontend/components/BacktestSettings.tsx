"use client";

import React, { useState } from "react";
import type { DataInstrument, InstrumentType } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { StrategyParams, StrategyParamsMeta } from "@/lib/strategyParams";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp, getParamFallbackHelp, type BacktestFieldHelp } from "@/components/backtestFieldMeta";

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
  experimentBranch: string;
  promoteOnPass: boolean;
}

const BEGINNER_EDGE_DEFAULTS: Partial<EdgeFindingSettings> = {
  validationMode: "oos_split",
  oosRatio: 0.25,
  wfFolds: 4,
  wfTestRatio: 0.2,
  minTradesGate: 30,
  maxDdGate: 25,
  minPfGate: 1.2,
  sweepMode: "none",
  sweepSamples: 24,
  monteCarloEnabled: true,
  monteCarloSims: 300,
  regimeEnabled: false,
  portfolioEnabled: false,
  executionEnabled: false,
  forwardBridgeEnabled: false,
  spreadBps: 0.5,
  slippageVolMult: 1,
  latencyBars: 0,
  promoteOnPass: false,
};

const EDGE_PRESETS: Record<"safe" | "balanced" | "explore", Partial<EdgeFindingSettings>> = {
  safe: {
    validationMode: "walk_forward",
    wfFolds: 4,
    wfTestRatio: 0.2,
    minTradesGate: 40,
    maxDdGate: 20,
    minPfGate: 1.3,
    sweepMode: "none",
    sweepSamples: 24,
    monteCarloEnabled: true,
    monteCarloSims: 500,
    executionEnabled: true,
    spreadBps: 0.5,
    slippageVolMult: 1,
    latencyBars: 0,
    promoteOnPass: false,
  },
  balanced: {
    validationMode: "oos_split",
    oosRatio: 0.25,
    minTradesGate: 30,
    maxDdGate: 25,
    minPfGate: 1.2,
    sweepMode: "random",
    sweepSamples: 24,
    monteCarloEnabled: true,
    monteCarloSims: 300,
    executionEnabled: true,
    spreadBps: 0.5,
    slippageVolMult: 1,
    latencyBars: 0,
    promoteOnPass: false,
  },
  explore: {
    validationMode: "single",
    minTradesGate: 15,
    maxDdGate: 35,
    minPfGate: 1.0,
    sweepMode: "random",
    sweepSamples: 48,
    monteCarloEnabled: false,
    executionEnabled: false,
    promoteOnPass: false,
  },
};

interface BacktestSettingsProps {
  instruments: DataInstrument[];
  instrumentsLoaded?: boolean;
  dataLoadError?: string | null;
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
  strategyParamMeta?: StrategyParamsMeta;
  onStrategyParamsChange?: (params: StrategyParams) => void;
  /** Module parameters (VIEW_PARAMS per module) - keyed by module name */
  moduleParams?: Record<string, StrategyParams>;
  moduleParamMeta?: Record<string, StrategyParamsMeta>;
  onModuleParamsChange?: (moduleName: string, params: StrategyParams) => void;
  /** Module names for which to show params (from applied/selected modules) */
  moduleNamesForParams?: string[];
  edgeSettings?: EdgeFindingSettings;
  onEdgeSettingsChange?: (next: EdgeFindingSettings) => void;
}

export function BacktestSettings({
  instruments,
  instrumentsLoaded = true,
  dataLoadError = null,
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
  strategyParamMeta = {},
  onStrategyParamsChange,
  moduleParams = {},
  moduleParamMeta = {},
  onModuleParamsChange,
  moduleNamesForParams = [],
  edgeSettings,
  onEdgeSettingsChange,
}: BacktestSettingsProps) {
  const maxYears = selectedInstrument?.yearsAvailable ?? 5;
  const minYears = 1;
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    guided: true,
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
  const labelTextClass = "text-sm text-zinc-400";
  const getFieldHelp = (fieldId: string, override?: Partial<BacktestFieldHelp>): BacktestFieldHelp => {
    const base = backtestFieldHelp[fieldId] ?? {
      id: fieldId,
      title: fieldId,
      whatItMeans: "Konfigurace backtestu.",
      whyItMatters: "Tato volba ovlivnuje chovani simulace a kvalitu vysledku.",
      howToUse: ["Pouzij konzistentni hodnoty napric porovnavanymi runy."],
      recommendedDefault: "Pouzij baseline hodnotu dle guide.",
      withoutIt: "Muze dojít ke zkresleni vyhodnoceni.",
      bestPractices: ["Pri zmene konfigurace zmen eviduj v hypothesis/branch."],
    };
    return { ...base, ...override };
  };
  const getDynamicParamHelp = (paramName: string): BacktestFieldHelp => {
    const source = paramsTab === "strategy" ? "PARAMS" : "VIEW_PARAMS";
    const moduleMeta = paramsTab === "strategy" ? undefined : moduleParamMeta[paramsTab]?.[paramName];
    const strategyMeta = paramsTab === "strategy" ? strategyParamMeta[paramName] : undefined;
    const resolvedMeta = strategyMeta ?? moduleMeta;
    const fallback = getParamFallbackHelp(paramName, source);
    if (!resolvedMeta) return fallback;
    return {
      ...fallback,
      title: resolvedMeta.title ?? fallback.title,
      whatItMeans: resolvedMeta.whatItMeans ?? fallback.whatItMeans,
      whyItMatters: resolvedMeta.whyItMatters ?? fallback.whyItMatters,
      howToUse: resolvedMeta.howToUse && resolvedMeta.howToUse.length > 0 ? resolvedMeta.howToUse : fallback.howToUse,
      recommendedDefault: resolvedMeta.recommendedDefault ?? fallback.recommendedDefault,
      withoutIt: resolvedMeta.withoutIt ?? fallback.withoutIt,
      bestPractices:
        resolvedMeta.bestPractices && resolvedMeta.bestPractices.length > 0
          ? resolvedMeta.bestPractices
          : fallback.bestPractices,
    };
  };
  const FieldLabel = ({ label, fieldId, helpOverride }: { label: string; fieldId: string; helpOverride?: Partial<BacktestFieldHelp> }) => (
    <div className="mb-1 flex items-center gap-2">
      <span className={labelTextClass}>{label}</span>
      <FieldHelpPopover help={getFieldHelp(fieldId, helpOverride)} />
    </div>
  );
  const edge = edgeSettings;
  const guidanceSteps = [
    { label: "1) Vyber instrument + roky", done: !!selectedInstrument && years >= minYears },
    { label: "2) Nastav realistickou simulaci", done: params.initialCapital > 0 && params.slippagePerc >= 0 && params.commissionPerc >= 0 },
    { label: "3) Zapni validaci mimo single run", done: !!edge && edge.validationMode !== "single" },
    { label: "4) Použij quality gates", done: !!edge && edge.minTradesGate >= 20 && edge.minPfGate >= 1.0 },
  ];
  const guidanceReady = guidanceSteps.every((s) => s.done);
  const guidanceWarnings: string[] = [];
  if (edge) {
    if (edge.validationMode === "single") {
      guidanceWarnings.push("Pouze single run může vést k falešné důvěře v edge.");
    }
    if (edge.sweepMode !== "none" && edge.validationMode === "single") {
      guidanceWarnings.push("Sweep bez OOS/Walk-forward často zvyšuje riziko overfittingu.");
    }
    if (edge.minTradesGate < 20) {
      guidanceWarnings.push("Nízký min trades gate může zkreslit metriky.");
    }
    if (!edge.monteCarloEnabled) {
      guidanceWarnings.push("Bez Monte Carlo nevidíš tail-risk a risk of ruin.");
    }
  }

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

  const applyBeginnerDefaults = () => {
    onParamsChange({
      initialCapital: 100000,
      slippagePerc: 0.001,
      commissionPerc: 0.0002,
    });
    if (edge && onEdgeSettingsChange) {
      onEdgeSettingsChange({
        ...edge,
        ...BEGINNER_EDGE_DEFAULTS,
      });
    }
  };
  const applyEdgePreset = (preset: "safe" | "balanced" | "explore") => {
    if (!edge || !onEdgeSettingsChange) return;
    onEdgeSettingsChange({
      ...edge,
      ...EDGE_PRESETS[preset],
    });
  };
  const edgeValidationLabel =
    edge?.validationMode === "walk_forward"
      ? "nejbezpečnější validace"
      : edge?.validationMode === "oos_split"
        ? "rozumný kompromis validace"
        : "rychlý test (vyšší riziko overfittingu)";
  const edgeTrustLabel =
    !edge
      ? "N/A"
      : edge.validationMode === "single"
        ? "Low confidence"
        : edge.minTradesGate >= 30 && edge.monteCarloEnabled
          ? "Higher confidence"
          : "Medium confidence";

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
      {canRun && (
        <Section id="guided" title="Guided mode (beginner)">
          <div className="rounded border border-zinc-700/60 bg-zinc-800/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-300">
                Stav připravenosti:{" "}
                <span className={guidanceReady ? "text-emerald-400 font-medium" : "text-amber-300 font-medium"}>
                  {guidanceReady ? "Ready for a first heuristic edge test" : "Needs setup"}
                </span>
              </div>
              <button
                type="button"
                onClick={applyBeginnerDefaults}
                className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs"
              >
                Použít doporučené defaulty
              </button>
            </div>
            <div className="space-y-1">
              {guidanceSteps.map((step) => (
                <div key={step.label} className="text-xs text-zinc-300 flex items-center gap-2">
                  <span className={step.done ? "text-emerald-400" : "text-zinc-500"}>{step.done ? "✓" : "•"}</span>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
            {guidanceWarnings.length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 space-y-1">
                <div className="text-[11px] uppercase tracking-wider text-amber-200">Guardrails</div>
                {guidanceWarnings.map((warning) => (
                  <div key={warning} className="text-xs text-amber-100">
                    - {warning}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}
      <Section id="basic" title="Basic settings">
        <div>
          <FieldLabel label="Instrument Type" fieldId="instrumentType" />
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
          <FieldLabel label="Instrument" fieldId="instrument" />
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
            ) : dataLoadError ? (
              <option value="">Chyba načtení instrumentů</option>
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
                  {inv.displayName ? `${inv.instrument} - ${inv.displayName}` : inv.instrument} ({inv.timeframe}, {inv.yearsAvailable} let)
                </option>
              ))
            )}
          </select>
          {dataLoadError && (
            <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-xs text-rose-100">
              {dataLoadError}
            </div>
          )}
        </div>
        <div>
          <FieldLabel label={`Delka (roky, min ${minYears} - max ${maxYears})`} fieldId="years" />
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
              <FieldLabel label="Tick Size" fieldId="tickSize" />
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
              <FieldLabel label="Value Per Tick (USD)" fieldId="valuePerTick" />
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
            <FieldLabel label="Position Size (pocet akcii)" fieldId="shareSize" />
            <input
              type="number"
              min={1}
              step={1}
              value={params.shareSize ?? 100}
              onChange={(e) => onParamsChange({ shareSize: parseInt(e.target.value, 10) || 100 })}
              className={inputClass}
            />
          </div>
        )}
        {params.instrumentType === "forex" && (
          <div className="space-y-3">
            <div>
              <FieldLabel label="Lot Size" fieldId="lotSize" />
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
              <FieldLabel label="Pip Size" fieldId="pipSize" />
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
              <FieldLabel label="Pip Value (USD)" fieldId="pipValue" />
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
          <FieldLabel label="Pocatecni kapital" fieldId="initialCapital" />
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
          <FieldLabel label="Slippage (%)" fieldId="slippagePerc" />
          <input
            type="number"
            min={0}
            max={10}
            step={0.01}
            value={params.slippagePerc * 100}
            onChange={(e) => onParamsChange({ slippagePerc: (parseFloat(e.target.value) || 0) / 100 })}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel label="Komise (%)" fieldId="commissionPerc" />
          <input
            type="number"
            min={0}
            max={10}
            step={0.001}
            value={params.commissionPerc * 100}
            onChange={(e) => onParamsChange({ commissionPerc: (parseFloat(e.target.value) || 0) / 100 })}
            className={inputClass}
          />
        </div>
      </Section>

      {canRun && (
        <Section id="dependencies" title="Indicators & Modules">
          {onSelectIndicators && (
            <div>
              <FieldLabel label="Indikatory (auto-detect + rucni uprava)" fieldId="selectedIndicatorIds" />
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
              <FieldLabel label="Moduly (auto-detect + rucni uprava)" fieldId="selectedModuleIds" />
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
              <div className="rounded border border-zinc-700/60 bg-zinc-800/40 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wider text-zinc-500">Jak Edge Finding chápat</div>
                <div className="text-xs text-zinc-300">
                  1) <span className="text-zinc-100">Validation</span> = jak poctivě testuješ robustnost.
                </div>
                <div className="text-xs text-zinc-300">
                  2) <span className="text-zinc-100">Quality gates</span> = minimální práh kvality (trades, DD, PF).
                </div>
                <div className="text-xs text-zinc-300">
                  3) <span className="text-zinc-100">Sweep</span> = průzkum parametrů (hledání citlivosti edge).
                </div>
                <div className="text-xs text-zinc-300">
                  4) <span className="text-zinc-100">Monte Carlo</span> = odhad tail-risk / risk of ruin.
                </div>
                <div className="text-xs text-zinc-300">
                  5) <span className="text-zinc-100">Execution model</span> = realističnost (spread/slippage/latence).
                </div>
                <div className="text-xs text-zinc-400 pt-1 border-t border-zinc-700/60">
                  Aktuálně: {edgeValidationLabel} | Důvěra:{" "}
                  <span
                    className={
                      edgeTrustLabel === "Higher confidence"
                        ? "text-emerald-400"
                        : edgeTrustLabel === "Medium confidence"
                          ? "text-amber-300"
                          : "text-rose-400"
                    }
                  >
                    {edgeTrustLabel}
                  </span>
                </div>
              </div>
              <div className="rounded border border-zinc-700/60 bg-zinc-800/20 p-3 space-y-2">
                <div className="text-xs uppercase tracking-wider text-zinc-500">Rychlé profily nastavení</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("safe")}
                    className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100"
                  >
                    Safe (institucional)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("balanced")}
                    className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100"
                  >
                    Balanced
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("explore")}
                    className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100"
                  >
                    Explore (rychlé)
                  </button>
                </div>
                <div className="text-xs text-zinc-500">
                  Safe = vyšší důvěra, Explore = rychlá iterace a vyšší riziko overfittingu.
                </div>
              </div>
              <div>
                <FieldLabel label="Validation mode" fieldId="validationMode" />
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
                  <FieldLabel label="OOS ratio" fieldId="oosRatio" />
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
                    <FieldLabel label="WF folds" fieldId="wfFolds" />
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
                    <FieldLabel label="WF test ratio" fieldId="wfTestRatio" />
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
                  <FieldLabel label="Gate min trades" fieldId="minTradesGate" />
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
                  <FieldLabel label="Gate max DD %" fieldId="maxDdGate" />
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
                  <FieldLabel label="Gate min PF" fieldId="minPfGate" />
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
                  <FieldLabel label="Experiment hypothesis" fieldId="experimentHypothesis" />
                  <input
                    type="text"
                    value={edge.experimentHypothesis}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentHypothesis: e.target.value })}
                    className={inputClass}
                    placeholder="např. SD breakout after liquidity sweep"
                  />
                </div>
                <div>
                  <FieldLabel label="Experiment tags (CSV)" fieldId="experimentTagsCsv" />
                  <input
                    type="text"
                    value={edge.experimentTagsCsv}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentTagsCsv: e.target.value })}
                    className={inputClass}
                    placeholder="sd, breakout, nq, v1"
                  />
                </div>
                <div>
                  <FieldLabel label="Run branch" fieldId="experimentBranch" />
                  <input
                    type="text"
                    value={edge.experimentBranch}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentBranch: e.target.value })}
                    className={inputClass}
                    placeholder="main"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel label="Promote candidate when gates pass" fieldId="promoteOnPass" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.promoteOnPass}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, promoteOnPass: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel label="Sweep mode" fieldId="sweepMode" />
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
                  <FieldLabel label="Sweep samples" fieldId="sweepSamples" />
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
                <div className="space-y-1">
                  <FieldLabel label="Monte Carlo" fieldId="monteCarloEnabled" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.monteCarloEnabled}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, monteCarloEnabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
                {edge.monteCarloEnabled && (
                  <div>
                    <FieldLabel label="MC simulations" fieldId="monteCarloSims" />
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
                <div className="space-y-1">
                  <FieldLabel label="Regime segmentation" fieldId="regimeEnabled" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.regimeEnabled}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, regimeEnabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
                <div className="space-y-1">
                  <FieldLabel label="Portfolio backtest" fieldId="portfolioEnabled" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.portfolioEnabled}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, portfolioEnabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
                {edge.portfolioEnabled && (
                  <div>
                    <FieldLabel label="Portfolio instruments (JSON array)" fieldId="portfolioInstrumentsJson" />
                    <textarea
                      value={edge.portfolioInstrumentsJson}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, portfolioInstrumentsJson: e.target.value })}
                      rows={5}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <FieldLabel label="Realistic execution model" fieldId="executionEnabled" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.executionEnabled}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, executionEnabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
                {edge.executionEnabled && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <FieldLabel label="Spread (bps)" fieldId="spreadBps" />
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
                        <FieldLabel label="Slip x vol" fieldId="slippageVolMult" />
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
                        <FieldLabel label="Latency bars" fieldId="latencyBars" />
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
                    <div className="space-y-1">
                      <FieldLabel label="Forward testing bridge" fieldId="forwardBridgeEnabled" />
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={edge.forwardBridgeEnabled}
                          onChange={(e) => onEdgeSettingsChange?.({ ...edge, forwardBridgeEnabled: e.target.checked })}
                          className="rounded"
                        />
                        Enabled
                      </label>
                    </div>
                    {edge.forwardBridgeEnabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel label="Bridge mode" fieldId="forwardBridgeMode" />
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
                          <FieldLabel label="Baseline equity" fieldId="forwardBridgeBaselineEquity" />
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
                    <div className="mb-1 flex items-center gap-2">
                      <span className={labelTextClass}>{key}</span>
                      <FieldHelpPopover help={getDynamicParamHelp(key)} />
                    </div>
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
