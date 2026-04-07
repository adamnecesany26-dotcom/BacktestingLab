"use client";

import React, { useMemo, useState } from "react";
import type { DataInstrument, InstrumentType } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import {
  paramFieldVisible,
  type StrategyParamValue,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp, getParamFallbackHelp, type BacktestFieldHelp } from "@/components/backtestFieldMeta";
import { MIN_BACKTEST_YEARS, QUICK_RANGE_MONTHS_YEARS } from "@/lib/dataRange";

export type CommissionMode = "percentage" | "per_contract";

export interface BacktestParams {
  initialCapital: number;
  slippagePerc: number;
  commissionPerc: number;
  /** Futures: fixed USD per contract per side (when commissionMode is per_contract). */
  commissionMode: CommissionMode;
  commissionPerContract: number;
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
  /** Backend wall-clock timeout for engine subprocess (seconds). 0 = ask server for no limit (if supported). */
  runTimeoutSec: number;
}

type PartialBacktestParams = Partial<BacktestParams>;

/** Jedna řádka rozsahu pro Param test (jen strategie PARAMS, int/float). */
export type ParamTestRangeRow = { enabled: boolean; min: number; max: number };

export interface EdgeFindingSettings {
  validationMode: "single" | "oos_split" | "walk_forward" | "param_test";
  oosRatio: number;
  wfFolds: number;
  wfTestRatio: number;
  /** Param test: horní strop počtu dodatečných backtestů v engine (4–48). */
  paramTestMaxRuns: number;
  /** Param test: run OAT sweep only on train portion of data (prevents in-sample overfitting). */
  paramTestTrainOnly: boolean;
  /** Klíče = názvy PARAMS; pouze číselné parametry strategie. */
  paramTestRanges: Record<string, ParamTestRangeRow>;
  minTradesGate: number;
  maxDdGate: number;
  minPfGate: number;
  sweepMode: "none" | "grid" | "random";
  sweepSamples: number;
  monteCarloEnabled: boolean;
  monteCarloSims: number;
  /** iid_trade = per-trade bootstrap; block_bootstrap preserves short-run serial correlation */
  monteCarloMode: "iid_trade" | "block_bootstrap";
  regimeEnabled: boolean;
  portfolioEnabled: boolean;
  portfolioInstrumentsJson: string;
  executionEnabled: boolean;
  spreadBps: number;
  slippageVolMult: number;
  latencyBars: number;
  stressMultiplier: number;
  forwardBridgeEnabled: boolean;
  forwardBridgeMode: "paper_shadow" | "live_shadow";
  forwardBridgeBaselineEquity: number;
  experimentHypothesis: string;
  experimentTagsCsv: string;
  experimentBranch: string;
  promoteOnPass: boolean;
  /** When true, engine uses fixed RNG seed (Monte Carlo, sweep, bootstrap blocks). */
  runFixedSeedEnabled: boolean;
  /** Integer seed sent as experiment.seed → RUN_SEED in engine (clamped). */
  runFixedSeedValue: number;
  /** Sequential matrix runs (same strategy files, overridden fields per item) */
  batchEnabled: boolean;
  batchMaxRuns: number;
  /** JSON array of objects with partial overrides, e.g. [{"instrument":"ES","data_file":"mock/ES_5Y.csv"}] */
  batchItemsJson: string;
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
  monteCarloMode: "iid_trade",
  regimeEnabled: false,
  portfolioEnabled: false,
  executionEnabled: false,
  forwardBridgeEnabled: false,
  spreadBps: 0.5,
  slippageVolMult: 1,
  latencyBars: 0,
  stressMultiplier: 1.0,
  promoteOnPass: false,
  runFixedSeedEnabled: false,
  runFixedSeedValue: 42,
  batchEnabled: false,
  batchMaxRuns: 8,
  batchItemsJson: '[{"instrument":"NQ","data_file":"mock/NQ_5Y.csv","timeframe":"1d"}]',
  paramTestMaxRuns: 24,
  paramTestTrainOnly: false,
  paramTestRanges: {},
};

const EDGE_PRESETS: Record<"safe" | "balanced" | "explore" | "prop_conservative" | "pessimist", Partial<EdgeFindingSettings>> = {
  pessimist: {
    executionEnabled: true,
    spreadBps: 2.0,
    slippageVolMult: 3,
    latencyBars: 2,
    stressMultiplier: 2.0,
  },
  prop_conservative: {
    validationMode: "walk_forward",
    wfFolds: 5,
    wfTestRatio: 0.2,
    minTradesGate: 50,
    maxDdGate: 15,
    minPfGate: 1.5,
    sweepMode: "none",
    monteCarloEnabled: true,
    monteCarloSims: 1000,
    monteCarloMode: "block_bootstrap",
    executionEnabled: true,
    spreadBps: 1.5,
    slippageVolMult: 2,
    latencyBars: 1,
    stressMultiplier: 1.5,
    promoteOnPass: false,
    paramTestTrainOnly: true,
  },
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
    monteCarloMode: "block_bootstrap",
    executionEnabled: true,
    spreadBps: 0.5,
    slippageVolMult: 1,
    latencyBars: 0,
    stressMultiplier: 1.0,
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
    monteCarloMode: "iid_trade",
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
    monteCarloMode: "iid_trade",
    executionEnabled: false,
    promoteOnPass: false,
    batchEnabled: false,
  },
};

/** Module-level: stable component identity so inputs are not remounted on every parent render. */
function resolveBacktestFieldHelp(fieldId: string, override?: Partial<BacktestFieldHelp>): BacktestFieldHelp {
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
}

function SettingsFieldLabel({
  label,
  fieldId,
  helpOverride,
}: {
  label: string;
  fieldId: string;
  helpOverride?: Partial<BacktestFieldHelp>;
}) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="text-sm text-zinc-400">{label}</span>
      <FieldHelpPopover help={resolveBacktestFieldHelp(fieldId, helpOverride)} />
    </div>
  );
}

function SettingsSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/40">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/40 rounded-lg"
      >
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</span>
        <span className="text-zinc-500 text-sm">{open ? "▼" : "▶"}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Collapsible block for module / indicator VIEW_PARAMS (default closed). */
function CollapsibleParamPanel({
  panelId,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  panelId: string;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-zinc-800/90 rounded-lg overflow-hidden bg-zinc-950/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-zinc-800/40 transition-colors"
        aria-expanded={open}
        aria-controls={`param-panel-${panelId}`}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-200 truncate">{title}</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{subtitle}</div>
        </div>
        <span className="text-zinc-500 shrink-0 text-xs tabular-nums">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div id={`param-panel-${panelId}`} className="px-3 pb-3 pt-1 space-y-3 border-t border-zinc-800/80">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Max instrumentů v jedné dávce (server cap batch_config). */
export const MAX_INSTRUMENTS_BATCH = 48;

/** Jedna položka v záložce Moduly (potvrzené moduly + PARAM_MODULE_CHAIN). */
export interface ModuleParamPanelEntry {
  id: string;
  name: string;
  /** Modul přidaný jen přes PARAM_MODULE_CHAIN v main.py strategie, ne přes „Potvrdit výběr“. */
  fromParamChain?: boolean;
}

interface BacktestSettingsProps {
  instruments: DataInstrument[];
  instrumentsLoaded?: boolean;
  dataLoadError?: string | null;
  selectedInstrument: DataInstrument | null;
  /** `DataInstrument.file` — pořadí = pořadí běhů v dávce */
  selectedInstrumentFiles: string[];
  onToggleInstrumentFile: (file: string) => void;
  onSelectAllInstrumentsInList: () => void;
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
  /** Moduly pro VIEW_PARAMS panel (potvrzené + PARAM_MODULE_CHAIN). */
  moduleParamPanels?: ModuleParamPanelEntry[];
  /** Indicator VIEW_PARAMS (applied indicators with VIEW_PARAMS in main.py) */
  indicatorParams?: Record<string, StrategyParams>;
  indicatorParamMeta?: Record<string, StrategyParamsMeta>;
  onIndicatorParamsChange?: (indicatorName: string, params: StrategyParams) => void;
  /** Display names of applied indicators (same order as selection) */
  indicatorNamesForParams?: string[];
  edgeSettings?: EdgeFindingSettings;
  onEdgeSettingsChange?: (next: EdgeFindingSettings) => void;
}

export function BacktestSettings({
  instruments,
  instrumentsLoaded = true,
  dataLoadError = null,
  selectedInstrument,
  selectedInstrumentFiles,
  onToggleInstrumentFile,
  onSelectAllInstrumentsInList,
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
  moduleParamPanels = [],
  indicatorParams = {},
  indicatorParamMeta = {},
  onIndicatorParamsChange,
  indicatorNamesForParams = [],
  edgeSettings,
  onEdgeSettingsChange,
}: BacktestSettingsProps) {
  const maxYears = useMemo(() => {
    if (selectedInstrumentFiles.length === 0) return selectedInstrument?.yearsAvailable ?? 5;
    const ys = instruments
      .filter((i) => selectedInstrumentFiles.includes(i.file))
      .map((i) => i.yearsAvailable);
    return ys.length > 0 ? Math.min(...ys) : (selectedInstrument?.yearsAvailable ?? 5);
  }, [instruments, selectedInstrumentFiles, selectedInstrument?.yearsAvailable]);
  const minYears = MIN_BACKTEST_YEARS;
  const selectedSet = useMemo(
    () => new Set(selectedInstrumentFiles),
    [selectedInstrumentFiles],
  );
  const multiCount = selectedInstrumentFiles.length;
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
  /** Keys `module:Name` / `indicator:Name` — default false = collapsed */
  const [paramPanelOpen, setParamPanelOpen] = useState<Record<string, boolean>>({});
  const [paramScopeTab, setParamScopeTab] = useState<"strategy" | "modules">("strategy");

  const inputClass = "w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200";
  const labelTextClass = "text-sm text-zinc-400";

  type ParamHelpScope =
    | { kind: "strategy" }
    | { kind: "module"; name: string }
    | { kind: "indicator"; name: string };

  const getParamHelp = (scope: ParamHelpScope, paramName: string): BacktestFieldHelp => {
    const source = scope.kind === "strategy" ? "PARAMS" : "VIEW_PARAMS";
    const strategyMeta = scope.kind === "strategy" ? strategyParamMeta[paramName] : undefined;
    const moduleMeta = scope.kind === "module" ? moduleParamMeta[scope.name]?.[paramName] : undefined;
    const indMeta = scope.kind === "indicator" ? indicatorParamMeta[scope.name]?.[paramName] : undefined;
    const resolvedMeta = strategyMeta ?? moduleMeta ?? indMeta;
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

  const toggleParamPanel = (id: string) => {
    setParamPanelOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderParamFields = (
    entries: [string, StrategyParamValue][],
    current: StrategyParams,
    onPatch: (next: StrategyParams) => void,
    scope: ParamHelpScope,
    metaMap: StrategyParamsMeta,
  ) =>
    entries.map(([key, value]) => {
      const meta = metaMap[key] ?? {};
      if (!paramFieldVisible(meta, current)) {
        return null;
      }
      const displayLabel = meta.title?.trim() || key;
      const opts = meta.options;
      const useSelect = Array.isArray(opts) && opts.length > 0;
      const isMultiselect = meta.widget === "multiselect" && useSelect;
      const legacyBoolNumber =
        meta.booleanWidget && typeof value === "number" && (value === 0 || value === 1);
      const asBoolCheckbox = typeof value === "boolean" || legacyBoolNumber;
      const boolVal =
        typeof value === "boolean" ? value : legacyBoolNumber ? value === 1 : Boolean(value);

      return (
        <div key={key}>
          <div className="mb-1 flex items-center gap-2">
            <span className={labelTextClass}>{displayLabel}</span>
            <FieldHelpPopover help={getParamHelp(scope, key)} />
          </div>
          {meta.whatItMeans ? (
            <p className="text-xs text-zinc-500 mb-2 leading-relaxed">{meta.whatItMeans}</p>
          ) : null}
          {isMultiselect ? (
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {opts!.map((opt, i) => {
                const selected = new Set(
                  String(value ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
                const on = selected.has(opt);
                return (
                  <label key={`${key}-${opt}`} className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const nextSel = new Set(selected);
                        if (nextSel.has(opt)) nextSel.delete(opt);
                        else nextSel.add(opt);
                        const ordered = opts!.filter((o) => nextSel.has(o));
                        onPatch({ ...current, [key]: ordered.join(",") });
                      }}
                      className="rounded border-zinc-600"
                    />
                    <span>{meta.optionLabels?.[i] ?? opt}</span>
                  </label>
                );
              })}
            </div>
          ) : useSelect ? (
            <select
              value={String(value)}
              onChange={(e) => {
                onPatch({ ...current, [key]: e.target.value });
              }}
              className={inputClass}
            >
              {opts!.map((opt, i) => (
                <option key={`${i}-${opt || "__empty"}`} value={opt}>
                  {meta.optionLabels?.[i] ?? (opt === "" ? "(výchozí / prázdné)" : opt)}
                </option>
              ))}
            </select>
          ) : asBoolCheckbox ? (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={boolVal}
                onChange={(e) => onPatch({ ...current, [key]: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-zinc-300">{boolVal ? "Ano" : "Ne"}</span>
            </label>
          ) : typeof value === "number" ? (
            <input
              type="number"
              value={value}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) {
                  onPatch({ ...current, [key]: v });
                }
              }}
              step={Number.isInteger(value) ? 1 : 0.01}
              className={inputClass}
            />
          ) : (
            <input
              type="text"
              value={String(value)}
              onChange={(e) => onPatch({ ...current, [key]: e.target.value })}
              className={inputClass}
            />
          )}
        </div>
      );
    });
  const edge = edgeSettings;
  const guidanceSteps = [
    { label: "1) Vyber instrument + roky", done: !!selectedInstrument && years >= minYears },
    {
      label: "2) Nastav realistickou simulaci",
      done:
        params.initialCapital > 0 &&
        params.slippagePerc >= 0 &&
        (params.commissionMode === "percentage"
          ? params.commissionPerc >= 0
          : params.commissionPerContract >= 0),
    },
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
    if (edge.runFixedSeedEnabled && edge.validationMode === "single" && edge.sweepMode !== "none") {
      guidanceWarnings.push(
        "Fixní seed sice zaručí reprodukovatelnost, ale sweep na single runu pořád zvyšuje riziko přeladění.",
      );
    }
    if (edge.validationMode === "param_test" && edge.sweepMode !== "none") {
      guidanceWarnings.push("Param test + robustness sweep násobí počet simulací a riziko přeladění.");
    }
    if (edge.runFixedSeedEnabled && edge.validationMode === "param_test") {
      guidanceWarnings.push("Param test s fixním seedem je reprodukovatelný, ale špičky metrik pořád mohou být náhodné.");
    }
  }

  const strategyParamEntries = Object.entries(strategyParams);
  const numericStrategyParamKeys = useMemo(
    () =>
      strategyParamEntries
        .filter(([, v]) => typeof v === "number" && !Number.isNaN(v))
        .map(([k]) => k)
        .sort(),
    [strategyParamEntries],
  );
  const paramTestBlocksRun = Boolean(
    edge &&
      edge.validationMode === "param_test" &&
      numericStrategyParamKeys.length > 0 &&
      !numericStrategyParamKeys.some((k) => !!edge.paramTestRanges[k]?.enabled),
  );
  const hasStrategyParams = strategyParamEntries.length > 0;
  const modulePanelRows = moduleParamPanels;
  const hasModulePanels = modulePanelRows.length > 0;
  const indicatorTabs = indicatorNamesForParams;
  const hasIndicatorParams = indicatorTabs.length > 0;
  const hasAnyParams = hasStrategyParams || hasModulePanels || hasIndicatorParams;
  const dualParamTabs = hasStrategyParams && (hasModulePanels || hasIndicatorParams);
  const tabBtnActive =
    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium bg-emerald-600/85 text-white border border-emerald-500/50";
  const tabBtnIdle =
    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-transparent hover:border-zinc-600";

  const toggleSection = (id: string) => {
    setSectionsOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const applyBeginnerDefaults = () => {
    onParamsChange({
      initialCapital: 100000,
      slippagePerc: 0.001,
      commissionPerc: 0.0002,
      commissionMode: "percentage",
      commissionPerContract: 2.25,
    });
    if (edge && onEdgeSettingsChange) {
      onEdgeSettingsChange({
        ...edge,
        ...BEGINNER_EDGE_DEFAULTS,
      });
    }
  };
  const applyEdgePreset = (preset: "safe" | "balanced" | "explore" | "prop_conservative" | "pessimist") => {
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
        : edge?.validationMode === "param_test"
          ? "systematický OAT průchod PARAMS (explorace citlivosti)"
          : "rychlý test (vyšší riziko overfittingu)";
  const edgeTrustLabel =
    !edge
      ? "N/A"
      : edge.validationMode === "single"
        ? "Low confidence"
        : edge.validationMode === "param_test"
          ? "Exploratory (multiple comparisons)"
          : edge.minTradesGate >= 30 && edge.monteCarloEnabled
            ? "Higher confidence"
            : "Medium confidence";

  const content = (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Nastavení backtestu
      </h4>
      {canRun && (
        <SettingsSection id="guided" title="Guided mode (beginner)" open={sectionsOpen.guided} onToggle={toggleSection}>
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
        </SettingsSection>
      )}
      <SettingsSection id="basic" title="Basic settings" open={sectionsOpen.basic} onToggle={toggleSection}>
        <div>
          <SettingsFieldLabel label="Instrument Type" fieldId="instrumentType" />
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
          <SettingsFieldLabel label="Instrument(y)" fieldId="instrument" />
          <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
            Zaškrtni jeden nebo více — běží jako dávka po sobě (stejná strategie a parametry). Max {MAX_INSTRUMENTS_BATCH}{" "}
            najednou. Výsledek v grafu = poslední instrument; tabulku všech runů najdeš v Analytics (
            <span className="text-zinc-400">batchSummary</span>). Nelze kombinovat s dávkou JSON v Edge finding ani s portfoliem.
          </p>
          {!instrumentsLoaded ? (
            <div className={`${inputClass} text-zinc-500`}>Načítám instrumenty…</div>
          ) : dataLoadError ? (
            <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-xs text-rose-100">
              {dataLoadError}
            </div>
          ) : instruments.length === 0 ? (
            <div className={`${inputClass} text-zinc-500`}>
              {params.instrumentType === "futures"
                ? "Žádné futures"
                : params.instrumentType === "stocks"
                  ? "Žádné akcie"
                  : "Žádné forex páry"}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  type="button"
                  onClick={onSelectAllInstrumentsInList}
                  className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200"
                >
                  Vybrat vše (max {MAX_INSTRUMENTS_BATCH})
                </button>
                <span className="text-xs text-zinc-400 self-center tabular-nums">
                  Vybráno: {multiCount}
                  {multiCount > 1 ? ` → ${multiCount} runů v dávce` : ""}
                </span>
              </div>
              <div className="max-h-52 overflow-y-auto rounded border border-zinc-700 bg-zinc-800/50 px-2 py-2 space-y-2">
                {instruments.map((inv) => {
                  const on = selectedSet.has(inv.file);
                  return (
                    <label
                      key={inv.file}
                      className="flex items-start gap-2 cursor-pointer text-sm text-zinc-300 leading-snug"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => onToggleInstrumentFile(inv.file)}
                        className="mt-0.5 rounded border-zinc-600"
                      />
                      <span>
                        {inv.displayName ? `${inv.instrument} — ${inv.displayName}` : inv.instrument}{" "}
                        <span className="text-zinc-500">
                          ({inv.timeframe}, {inv.yearsAvailable} let)
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div>
          <SettingsFieldLabel
            label={`Historie (roky jako číslo; minimum ${minYears.toFixed(3)} ≈ 1 měsíc, max ${maxYears})`}
            fieldId="years"
          />
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(
              [
                [1, "1 měsíc"],
                [3, "3 měsíce"],
                [6, "6 měsíců"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => onYearsChange(QUICK_RANGE_MONTHS_YEARS[m])}
                className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-600 text-zinc-200 hover:bg-zinc-700 hover:border-zinc-500"
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={minYears}
            max={maxYears}
            step={1 / 12}
            value={years}
            onChange={(e) => onYearsChange(parseFloat(e.target.value) || minYears)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Kratší okno = rychlejší backtest (engine bere posledních N·365,25 dní).
          </p>
        </div>
      </SettingsSection>

      <SettingsSection id="instrumentConfig" title="Instrument config" open={sectionsOpen.instrumentConfig} onToggle={toggleSection}>
        {params.instrumentType === "futures" && (
          <div className="space-y-3">
            <div>
              <SettingsFieldLabel label="Tick Size" fieldId="tickSize" />
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
              <SettingsFieldLabel label="Value Per Tick (USD)" fieldId="valuePerTick" />
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
            <SettingsFieldLabel label="Position Size (pocet akcii)" fieldId="shareSize" />
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
              <SettingsFieldLabel label="Lot Size" fieldId="lotSize" />
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
              <SettingsFieldLabel label="Pip Size" fieldId="pipSize" />
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
              <SettingsFieldLabel label="Pip Value (USD)" fieldId="pipValue" />
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
      </SettingsSection>

      <SettingsSection id="simulation" title="Simulation" open={sectionsOpen.simulation} onToggle={toggleSection}>
        <div>
          <SettingsFieldLabel label="Pocatecni kapital" fieldId="initialCapital" />
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
          <SettingsFieldLabel label="Slippage (%)" fieldId="slippagePerc" />
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
          <SettingsFieldLabel label="Komise — re\u017eim" fieldId="commissionMode" />
          <select
            id="commissionMode"
            value={params.commissionMode}
            onChange={(e) =>
              onParamsChange({
                ...params,
                commissionMode: e.target.value as CommissionMode,
              })
            }
            className={inputClass}
          >
            <option value="percentage">Procento z notion\u00e1lu</option>
            <option value="per_contract">USD / kontrakt / strana (futures)</option>
          </select>
        </div>
        {params.commissionMode === "percentage" ? (
          <div>
            <SettingsFieldLabel label="Komise (%)" fieldId="commissionPerc" />
            <input
              type="number"
              min={0}
              max={10}
              step={0.001}
              value={params.commissionPerc * 100}
              onChange={(e) => onParamsChange({ ...params, commissionPerc: (parseFloat(e.target.value) || 0) / 100 })}
              className={inputClass}
            />
          </div>
        ) : (
          <div>
            <SettingsFieldLabel label="USD / kontrakt / strana" fieldId="commissionPerContract" />
            <input
              type="number"
              min={0}
              step={0.01}
              value={params.commissionPerContract}
              onChange={(e) =>
                onParamsChange({ ...params, commissionPerContract: parseFloat(e.target.value) || 0 })
              }
              className={inputClass}
            />
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Pevn\u00fd poplatek za kontrakt na stranu (nap\u0159. futures). Pou\u017eije se jen u instrument type
              futures.
            </p>
          </div>
        )}
        <div>
          <SettingsFieldLabel label="Max. doba běhu (s)" fieldId="runTimeoutSec" />
          <input
            type="number"
            min={0}
            max={86400}
            step={60}
            value={params.runTimeoutSec}
            onChange={(e) =>
              onParamsChange({ runTimeoutSec: Math.max(0, parseInt(e.target.value, 10) || 0) })
            }
            className={inputClass}
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            Limit na straně serveru (wall-clock subprocess / in-process engine). 0 = bez limitu (pokud to backend
            povolí). Výchozí 3600 s; při pomalém PC nebo síti zvyš (např. 7200–14400).
          </p>
        </div>
      </SettingsSection>

      {canRun && (
        <SettingsSection id="dependencies" title="Indicators & Modules" open={sectionsOpen.dependencies} onToggle={toggleSection}>
          {onSelectIndicators && (
            <div>
              <SettingsFieldLabel label="Indikatory (auto-detect + rucni uprava)" fieldId="selectedIndicatorIds" />
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
              <SettingsFieldLabel
                label="Moduly (auto-detect + ruční úprava)"
                fieldId="selectedModuleIds"
                helpOverride={{
                  whatItMeans:
                    "Automatika hledá v main.py: from/import modules.X, importlib.import_module(\"modules.X\") a názvy v PARAM_MODULE_CHAIN.",
                  whyItMatters: "Bez výběru a Potvrdit se moduly nepřibalí k runu ani VIEW_PARAMS.",
                  howToUse: [
                    "Po změně importů v main.py počkej krátce (debounce) nebo znovu otevři strategii.",
                    "Názvy v knihovně Moduly musí odpovídat Python balíčku (např. Swing HL → modules.Swing_HL).",
                  ],
                }}
              />
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
          <p className="text-[11px] text-zinc-500 leading-snug">
            Další moduly (např. Swing HL u S/D strategie) mohou být doplněny v{" "}
            <code className="text-zinc-400">main.py</code> jako{" "}
            <code className="text-zinc-400">PARAM_MODULE_CHAIN = &quot;Název|Druhý&quot;</code> — zobrazí se v záložce
            Moduly, přibalí se při runu a jejich VIEW_PARAMS jdou do <code className="text-zinc-400">module_params</code>{" "}
            stejně jako u potvrzených modulů.
          </p>
        </SettingsSection>
      )}

      {canRun && (
        <SettingsSection id="edgeFinding" title="Edge finding" open={sectionsOpen.edgeFinding} onToggle={toggleSection}>
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
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("pessimist")}
                    className="px-2 py-1 rounded bg-amber-900/60 hover:bg-amber-800/70 border border-amber-700/50 text-xs text-amber-100 font-medium"
                  >
                    Pessimist
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("prop_conservative")}
                    className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800/70 border border-rose-700/50 text-xs text-rose-100 font-medium"
                  >
                    Prop conservative
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEdgePreset("safe")}
                    className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100"
                  >
                    Safe
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
                    Explore
                  </button>
                </div>
                <div className="text-xs text-zinc-500">
                  Pessimist = pouze agresivn\u00ed execution (spread 2 bps, slip 3\u00d7vol, latence 2 bary, stress 2\u00d7).
                  Prop conservative = cel\u00fd pipeline. Safe = validace + execution. Explore = rychl\u00e1 iterace.
                </div>
              </div>
              <div>
                <SettingsFieldLabel label="Validation mode" fieldId="validationMode" />
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
                  <option value="param_test">Param test (OAT sweep)</option>
                </select>
              </div>
              {edge.validationMode === "oos_split" && (
                <div>
                  <SettingsFieldLabel label="OOS ratio" fieldId="oosRatio" />
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
                    <SettingsFieldLabel label="WF folds" fieldId="wfFolds" />
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
                    <SettingsFieldLabel label="WF test ratio" fieldId="wfTestRatio" />
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
              {(edge.validationMode === "walk_forward" || edge.validationMode === "oos_split") && (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  WF/OOS: engine vrací foldy s daty a test metrikami; guardrails v Analytics jsou{" "}
                  <strong>heuristiky</strong> (krátké okno, málo obchodů) — ne důkaz absence leakage.
                </p>
              )}
              {edge.validationMode === "param_test" && (
                <div className="space-y-3 rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3">
                  <div>
                    <SettingsFieldLabel
                      label="Param test — max. počet běhů (budget)"
                      fieldId="paramTestMaxRuns"
                      helpOverride={{
                        whatItMeans:
                          "Horní strop dodatečných backtestů po baseline. Engine rozdělí budget mezi zapnuté parametry (OAT, linspace v rozsahu).",
                        whyItMatters: "Omezí čas běhu a riziko náhodných špiček při mnoha porovnáních.",
                        howToUse: ["Začni 16–24 běhů.", "Max. 48.", "Zapni jen parametry, které chceš zkoumat."],
                      }}
                    />
                    <input
                      type="number"
                      min={4}
                      max={48}
                      step={1}
                      value={edge.paramTestMaxRuns}
                      onChange={(e) => {
                        const n = Math.min(48, Math.max(4, parseInt(e.target.value, 10) || 24));
                        onEdgeSettingsChange?.({ ...edge, paramTestMaxRuns: n });
                      }}
                      className={inputClass}
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Pouze <strong>číselné PARAMS strategie</strong> (ne moduly). Baseline run = aktuální hodnoty v
                      záložce Strategie; poté engine systematicky mění jeden parametr najednou v zadaném rozsahu.
                    </p>
                  </div>
                  {numericStrategyParamKeys.length > 0 &&
                    !numericStrategyParamKeys.some((k) => edge.paramTestRanges[k]?.enabled) && (
                      <p className="text-xs text-amber-200/90">
                        Zaškrtni „Test“ u alespoň jednoho parametru — bez toho engine neprovede OAT sweep (proběhne jen
                        baseline).
                      </p>
                    )}
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={edge.paramTestTrainOnly}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, paramTestTrainOnly: e.target.checked })}
                      className="accent-indigo-500 w-4 h-4"
                    />
                    <span>
                      Train-only <span className="text-zinc-500">(OAT sweep na train \u010d\u00e1sti, holdout ov\u011b\u0159en\u00ed nejlep\u0161\u00edho parametru)</span>
                    </span>
                  </label>
                  {numericStrategyParamKeys.length === 0 ? (
                    <p className="text-xs text-amber-200/90">Žádné číselné PARAMS — přidej v kódu strategie nebo panelu.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="text-zinc-500 border-b border-zinc-700">
                            <th className="py-1 pr-2 font-medium">Parametr</th>
                            <th className="py-1 pr-2 font-medium">Test</th>
                            <th className="py-1 pr-2 font-medium">Min</th>
                            <th className="py-1 pr-2 font-medium">Max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {numericStrategyParamKeys.map((paramKey) => {
                            const base = Number(strategyParams[paramKey]);
                            const row = edge.paramTestRanges[paramKey] ?? {
                              enabled: false,
                              min: base,
                              max: base,
                            };
                            return (
                              <tr key={paramKey} className="border-b border-zinc-800/80">
                                <td className="py-1.5 pr-2 font-mono text-zinc-300">{paramKey}</td>
                                <td className="py-1.5 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={row.enabled}
                                    onChange={() =>
                                      onEdgeSettingsChange?.({
                                        ...edge,
                                        paramTestRanges: {
                                          ...edge.paramTestRanges,
                                          [paramKey]: {
                                            enabled: !row.enabled,
                                            min: row.min,
                                            max: row.max,
                                          },
                                        },
                                      })
                                    }
                                    className="rounded border-zinc-600"
                                  />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <input
                                    type="number"
                                    step="any"
                                    value={row.min}
                                    onChange={(e) => {
                                      const n = parseFloat(e.target.value);
                                      onEdgeSettingsChange?.({
                                        ...edge,
                                        paramTestRanges: {
                                          ...edge.paramTestRanges,
                                          [paramKey]: {
                                            ...row,
                                            min: Number.isFinite(n) ? n : row.min,
                                          },
                                        },
                                      });
                                    }}
                                    className={`${inputClass} w-full min-w-[5rem]`}
                                  />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <input
                                    type="number"
                                    step="any"
                                    value={row.max}
                                    onChange={(e) => {
                                      const n = parseFloat(e.target.value);
                                      onEdgeSettingsChange?.({
                                        ...edge,
                                        paramTestRanges: {
                                          ...edge.paramTestRanges,
                                          [paramKey]: {
                                            ...row,
                                            max: Number.isFinite(n) ? n : row.max,
                                          },
                                        },
                                      });
                                    }}
                                    className={`${inputClass} w-full min-w-[5rem]`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <SettingsFieldLabel label="Gate min trades" fieldId="minTradesGate" />
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
                  <SettingsFieldLabel label="Gate max DD %" fieldId="maxDdGate" />
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
                  <SettingsFieldLabel label="Gate min PF" fieldId="minPfGate" />
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
                  <SettingsFieldLabel label="Fixní run seed (reprodukovatelnost)" fieldId="runFixedSeed" />
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300 mb-2">
                    <input
                      type="checkbox"
                      checked={edge.runFixedSeedEnabled}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, runFixedSeedEnabled: e.target.checked })}
                      className="rounded"
                    />
                    Použít pevný seed pro MC / sweep / bootstrap (jinak náhodný každý run)
                  </label>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={999999999}
                    disabled={!edge.runFixedSeedEnabled}
                    value={edge.runFixedSeedValue}
                    onChange={(e) =>
                      onEdgeSettingsChange?.({
                        ...edge,
                        runFixedSeedValue: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className={inputClass + (!edge.runFixedSeedEnabled ? " opacity-50" : "")}
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Hodnota jde do manifestu a <code className="text-zinc-400">RUN_SEED</code> v engine. U batch dávky
                    sdílí všechny dílčí runy stejný seed z parent requestu (srovnatelné RNG napříč položkami).
                  </p>
                </div>
                <div>
                  <SettingsFieldLabel label="Experiment hypothesis" fieldId="experimentHypothesis" />
                  <input
                    type="text"
                    value={edge.experimentHypothesis}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentHypothesis: e.target.value })}
                    className={inputClass}
                    placeholder="např. SD breakout after liquidity sweep"
                  />
                </div>
                <div>
                  <SettingsFieldLabel label="Experiment tags (CSV)" fieldId="experimentTagsCsv" />
                  <input
                    type="text"
                    value={edge.experimentTagsCsv}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentTagsCsv: e.target.value })}
                    className={inputClass}
                    placeholder="sd, breakout, nq, v1"
                  />
                </div>
                <div>
                  <SettingsFieldLabel label="Run branch" fieldId="experimentBranch" />
                  <input
                    type="text"
                    value={edge.experimentBranch}
                    onChange={(e) => onEdgeSettingsChange?.({ ...edge, experimentBranch: e.target.value })}
                    className={inputClass}
                    placeholder="main"
                  />
                </div>
                <div className="space-y-1">
                  <SettingsFieldLabel label="Promote candidate when gates pass" fieldId="promoteOnPass" />
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
                  <SettingsFieldLabel label="Sweep mode" fieldId="sweepMode" />
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
                  <SettingsFieldLabel label="Sweep samples" fieldId="sweepSamples" />
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
                  <SettingsFieldLabel label="Monte Carlo" fieldId="monteCarloEnabled" />
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <SettingsFieldLabel label="MC simulations" fieldId="monteCarloSims" />
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
                    <div>
                      <SettingsFieldLabel label="MC mode" fieldId="monteCarloMode" />
                      <select
                        value={edge.monteCarloMode ?? "iid_trade"}
                        onChange={(e) =>
                          onEdgeSettingsChange?.({
                            ...edge,
                            monteCarloMode: e.target.value as EdgeFindingSettings["monteCarloMode"],
                          })
                        }
                        className={inputClass}
                      >
                        <option value="iid_trade">IID trade bootstrap (default)</option>
                        <option value="block_bootstrap">Block bootstrap (serialita PnL)</option>
                      </select>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Block režim resampluje souvislé bloky uzavřených obchodů — lepší pro korelované výsledky.
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <SettingsFieldLabel label="Regime segmentation" fieldId="regimeEnabled" />
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
                  <SettingsFieldLabel label="Portfolio backtest" fieldId="portfolioEnabled" />
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
                    <SettingsFieldLabel label="Portfolio instruments (JSON array)" fieldId="portfolioInstrumentsJson" />
                    <textarea
                      value={edge.portfolioInstrumentsJson}
                      onChange={(e) => onEdgeSettingsChange?.({ ...edge, portfolioInstrumentsJson: e.target.value })}
                      rows={5}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  </div>
                )}
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="space-y-1">
                    <SettingsFieldLabel label="Batch / matrix runs" fieldId="batchEnabled" />
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={edge.batchEnabled}
                        onChange={(e) => onEdgeSettingsChange?.({ ...edge, batchEnabled: e.target.checked })}
                        className="rounded"
                      />
                      Enabled (batch engine runs, max 48; paralelizace env BATCH_PARALLEL_WORKERS)
                    </label>
                  </div>
                  {edge.batchEnabled && (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-200/90">
                        Pozor na multiple testing — výsledky zobrazí varování. Nelze kombinovat s portfolio režimem.
                      </p>
                      <div>
                        <SettingsFieldLabel label="Max runs (cap)" fieldId="batchMaxRuns" />
                        <input
                          type="number"
                          min={1}
                          max={48}
                          value={edge.batchMaxRuns}
                          onChange={(e) =>
                            onEdgeSettingsChange?.({ ...edge, batchMaxRuns: parseInt(e.target.value, 10) || 8 })
                          }
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <SettingsFieldLabel label="Items JSON" fieldId="batchItemsJson" />
                        <textarea
                          value={edge.batchItemsJson}
                          onChange={(e) => onEdgeSettingsChange?.({ ...edge, batchItemsJson: e.target.value })}
                          rows={6}
                          className={`${inputClass} font-mono text-xs`}
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <SettingsFieldLabel label="Realistic execution model" fieldId="executionEnabled" />
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
                        <SettingsFieldLabel label="Spread (bps)" fieldId="spreadBps" />
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
                        <SettingsFieldLabel label="Slip x vol" fieldId="slippageVolMult" />
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
                        <SettingsFieldLabel label="Latency bars" fieldId="latencyBars" />
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
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <SettingsFieldLabel label="Stress multiplier" fieldId="stressMultiplier" />
                        <input
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          value={edge.stressMultiplier}
                          onChange={(e) => onEdgeSettingsChange?.({ ...edge, stressMultiplier: parseFloat(e.target.value) || 1.0 })}
                          className={inputClass}
                        />
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          N\u00e1sob\u00ed slippage/spread p\u0159i backtestu. 1.0 = norm\u00e1ln\u00ed, 1.5 = prop stress test, 2.0+ = extr\u00e9mn\u00ed.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <SettingsFieldLabel label="Forward testing bridge" fieldId="forwardBridgeEnabled" />
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
                          <SettingsFieldLabel label="Bridge mode" fieldId="forwardBridgeMode" />
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
                          <SettingsFieldLabel label="Baseline equity" fieldId="forwardBridgeBaselineEquity" />
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
        </SettingsSection>
      )}

      {canRun && (
        <SettingsSection id="parameters" title="Parameters" open={sectionsOpen.parameters} onToggle={toggleSection}>
          {hasAnyParams ? (
            <div className="space-y-4">
              {dualParamTabs ? (
                <div className="flex gap-1 p-0.5 rounded-lg bg-zinc-800/70 border border-zinc-700/80">
                  <button
                    type="button"
                    className={paramScopeTab === "strategy" ? tabBtnActive : tabBtnIdle}
                    onClick={() => setParamScopeTab("strategy")}
                  >
                    Strategie · PARAMS
                  </button>
                  <button
                    type="button"
                    className={paramScopeTab === "modules" ? tabBtnActive : tabBtnIdle}
                    onClick={() => setParamScopeTab("modules")}
                  >
                    Moduly / indikátory · VIEW_PARAMS
                  </button>
                </div>
              ) : null}

              {(dualParamTabs ? paramScopeTab === "strategy" : hasStrategyParams) ? (
                <div>
                  <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
                    {dualParamTabs ? "Parametry strategie" : "Strategie"}
                  </div>
                  {hasStrategyParams ? (
                    <div className="space-y-3 pl-0.5">
                      {renderParamFields(
                        strategyParamEntries,
                        strategyParams,
                        (next) => onStrategyParamsChange?.(next),
                        { kind: "strategy" },
                        strategyParamMeta,
                      )}
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-xs">Žádné PARAMS v main.py strategie</p>
                  )}
                </div>
              ) : null}

              {(dualParamTabs ? paramScopeTab === "modules" : !hasStrategyParams && (hasModulePanels || hasIndicatorParams))
                ? (
                <div className="space-y-4">
                  {hasModulePanels ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Moduly</div>
                      <p className="text-[11px] text-zinc-600 leading-snug">
                        Hodnoty jdou do <code className="text-zinc-400">params.module_params</code> pod klíčem názvu
                        modulu — strategie je sloučí podle své logiky (nesčítají se s PARAMS, pokud strategie výslovně
                        nepřenáší klíče).
                      </p>
                      {modulePanelRows.map((row: ModuleParamPanelEntry) => {
                        const mid = `module:${row.name}`;
                        const cur = moduleParams[row.name] ?? {};
                        const ent = Object.entries(cur);
                        const subtitle = row.fromParamChain
                          ? "VIEW_PARAMS · PARAM_MODULE_CHAIN (přibaleno při runu)"
                          : "Parametry modulu (VIEW_PARAMS)";
                        return (
                          <CollapsibleParamPanel
                            key={mid}
                            panelId={mid.replace(/[^a-zA-Z0-9_-]/g, "_")}
                            title={row.fromParamChain ? `${row.name} · řetěz` : row.name}
                            subtitle={subtitle}
                            open={!!paramPanelOpen[mid]}
                            onToggle={() => toggleParamPanel(mid)}
                          >
                            {ent.length === 0 ? (
                              <p className="text-zinc-500 text-xs">
                                Modul nemá VIEW_PARAMS v main.py — přidej dict VIEW_PARAMS nebo uprav výchozí v kódu.
                              </p>
                            ) : (
                              renderParamFields(ent, cur, (next) => onModuleParamsChange?.(row.name, next), {
                                kind: "module",
                                name: row.name,
                              }, moduleParamMeta[row.name] ?? {})
                            )}
                          </CollapsibleParamPanel>
                        );
                      })}
                    </div>
                  ) : null}

                  {hasIndicatorParams ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Indikátory</div>
                      {indicatorTabs.map((name) => {
                        const iid = `indicator:${name}`;
                        const cur = indicatorParams[name] ?? {};
                        const ent = Object.entries(cur);
                        return (
                          <CollapsibleParamPanel
                            key={iid}
                            panelId={iid.replace(/[^a-zA-Z0-9_-]/g, "_")}
                            title={name}
                            subtitle="Parametry indikátoru (VIEW_PARAMS)"
                            open={!!paramPanelOpen[iid]}
                            onToggle={() => toggleParamPanel(iid)}
                          >
                            {ent.length === 0 ? (
                              <p className="text-zinc-500 text-xs">
                                Indikátor nemá VIEW_PARAMS v main.py.
                              </p>
                            ) : (
                              renderParamFields(ent, cur, (next) => onIndicatorParamsChange?.(name, next), {
                                kind: "indicator",
                                name,
                              }, indicatorParamMeta[name] ?? {})
                            )}
                          </CollapsibleParamPanel>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-zinc-500 text-xs">Žádné parametry</p>
          )}
        </SettingsSection>
      )}

      <SettingsSection id="run" title="Run" open={sectionsOpen.run} onToggle={toggleSection}>
        <button
          onClick={onRun}
          disabled={isRunning || !canRun || paramTestBlocksRun}
          className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isRunning ? "Běží..." : canRun ? "Run" : "Otevřete strategii"}
        </button>
      </SettingsSection>
    </div>
  );
  return content;
}
