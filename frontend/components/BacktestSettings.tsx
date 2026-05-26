"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DataInstrument } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import {
  orderParamEntriesForNestedDisplay,
  paramFieldVisible,
  type StrategyParams,
  type StrategyParamsMeta,
  type StrategyParamValue,
} from "@/lib/strategyParams";
import { StrategyConfigModal, StrategyParamsFieldList } from "@/components/StrategyParamsEditor";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp, getParamFallbackHelp, type BacktestFieldHelp } from "@/components/backtestFieldMeta";
import { MIN_BACKTEST_YEARS, QUICK_RANGE_MONTHS_YEARS } from "@/lib/dataRange";
import { isMnqParquetDataFile, getFuturesExecutionSpec } from "@/lib/futuresExecutionSpec";
import type { PropFirmBacktestFormState } from "@/lib/propFirmBacktestConfig";
import { applyPropFirmPreset } from "@/lib/propFirmBacktestConfig";

export interface BacktestParams {
  initialCapital: number;
  slippagePerc: number;
  /** USD za kontrakt za stranu (jediný režim komise). */
  commissionPerContract: number;
  /** Futures: tick / tick value (derived from symbol table in page.tsx). */
  tickSize?: number;
  valuePerTick?: number;
}

type PartialBacktestParams = Partial<BacktestParams>;

export interface EdgeFindingSettings {
  validationMode: "single" | "walk_forward";
  wfFolds: number;
  wfTestRatio: number;
  minTradesGate: number;
  maxDdGate: number;
  minPfGate: number;
  sweepMode: "none" | "grid" | "random";
  sweepSamples: number;
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
  /** When true, engine uses fixed RNG seed (sweep, bootstrap blocks, reproducible runs). */
  runFixedSeedEnabled: boolean;
  /** Integer seed sent as experiment.seed → RUN_SEED in engine (clamped). */
  runFixedSeedValue: number;
  /** Engine: segmentace obchodů a výstupů podle režimu trhu (EMA + ATR range). */
  perRegimeSegmentation: boolean;
}

/** Jednoparametrový OAT sweep — engine `validation_mode: param_test` + `param_ranges` s `step`. */
export type OatSweepConfig = {
  enabled: boolean;
  paramKey: string | null;
  from: number;
  to: number;
  step: number;
};

const DEFAULT_OAT_SWEEP: OatSweepConfig = {
  enabled: false,
  paramKey: null,
  /** Typický ORB `atr_sl_pct` (10–50 = procenta z denního ATR jako číslo, ne 0–1). U jiného parametru uprav. */
  from: 10,
  to: 50,
  step: 5,
};

export function defaultOatSweepConfig(): OatSweepConfig {
  return { ...DEFAULT_OAT_SWEEP };
}

function isNumericOatParam(
  val: StrategyParamValue,
  meta: StrategyParamsMeta[string] | undefined,
): boolean {
  const m = meta ?? {};
  if (Array.isArray(m.options) && m.options.length > 0) return false;
  if (m.widget === "multiselect") return false;
  if (typeof val === "boolean") return false;
  if (typeof val === "string") return false;
  if (typeof val === "number") {
    if (m.booleanWidget && (val === 0 || val === 1)) return false;
    return true;
  }
  return false;
}

const BEGINNER_EDGE_DEFAULTS: Partial<EdgeFindingSettings> = {
  validationMode: "walk_forward",
  wfFolds: 4,
  wfTestRatio: 0.2,
  minTradesGate: 30,
  maxDdGate: 25,
  minPfGate: 1.2,
  sweepMode: "none",
  sweepSamples: 24,
  executionEnabled: false,
  forwardBridgeEnabled: false,
  spreadBps: 0.5,
  slippageVolMult: 1,
  latencyBars: 0,
  stressMultiplier: 1.0,
  promoteOnPass: false,
  runFixedSeedEnabled: false,
  runFixedSeedValue: 42,
  perRegimeSegmentation: false,
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
    executionEnabled: true,
    spreadBps: 1.5,
    slippageVolMult: 2,
    latencyBars: 1,
    stressMultiplier: 1.5,
    promoteOnPass: false,
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
    executionEnabled: true,
    spreadBps: 0.5,
    slippageVolMult: 1,
    latencyBars: 0,
    stressMultiplier: 1.0,
    promoteOnPass: false,
  },
  balanced: {
    validationMode: "walk_forward",
    wfFolds: 4,
    wfTestRatio: 0.2,
    minTradesGate: 30,
    maxDdGate: 25,
    minPfGate: 1.2,
    sweepMode: "random",
    sweepSamples: 24,
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
    executionEnabled: false,
    promoteOnPass: false,
  },
};

/** Module-level: stable component identity so inputs are not remounted on every parent render. */
function resolveBacktestFieldHelp(fieldId: string, override?: Partial<BacktestFieldHelp>): BacktestFieldHelp {
  const base = backtestFieldHelp[fieldId] ?? {
    id: fieldId,
    title: fieldId,
    whatItMeans: "Konfigurace ovlivňuje průběh backtestu nebo výsledky.",
    whyItMatters: "Špatná hodnota může zkreslit simulaci.",
    howToUse: ["Při porovnání runů drž stejné nastavení, pokud nezkoušíš právě tuto osu."],
    recommendedDefault: "Viz /guide nebo READMEADAM.md.",
    withoutIt: "Horší srovnatelnost a interpretace.",
    bestPractices: ["Zapisuj změny do hypotézy, tagů a větve experimentu."],
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

function InstrumentMultiSelect({
  instruments,
  selectedSet,
  onToggle,
  onSelectAll,
  instrumentsLoaded,
  dataLoadError,
  emptyMessage,
  inputClass,
  maxBatch,
}: {
  instruments: DataInstrument[];
  selectedSet: Set<string>;
  onToggle: (file: string) => void;
  onSelectAll: () => void;
  instrumentsLoaded: boolean;
  dataLoadError: string | null;
  emptyMessage: string;
  inputClass: string;
  maxBatch: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const count = selectedSet.size;
  const summary = useMemo(() => {
    const sel = instruments.filter((i) => selectedSet.has(i.file));
    if (sel.length === 0) return "Nic nevybráno";
    const labels = sel.map((i) => i.instrument).slice(0, 3);
    const extra = sel.length > 3 ? ` +${sel.length - 3}` : "";
    return `${labels.join(", ")}${extra}`;
  }, [instruments, selectedSet]);

  if (!instrumentsLoaded) {
    return <div className={`${inputClass} text-zinc-500`}>Načítám instrumenty…</div>;
  }
  if (dataLoadError) {
    return (
      <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-xs text-rose-100">
        {dataLoadError}
      </div>
    );
  }
  if (instruments.length === 0) {
    return <div className={`${inputClass} text-zinc-500`}>{emptyMessage}</div>;
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 truncate">
          <span className="text-zinc-400 tabular-nums">{count}</span>
          <span className="text-zinc-500"> × </span>
          <span className="text-zinc-200">{summary}</span>
        </span>
        <span className="shrink-0 text-zinc-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[min(100%,22rem)] rounded-lg border border-zinc-600 bg-zinc-900 shadow-xl">
          {maxBatch > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-700/80 px-2 py-2">
              <button
                type="button"
                onClick={onSelectAll}
                className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200"
              >
                Vybrat vše ({maxBatch} max)
              </button>
              <span className="text-[11px] text-zinc-500 leading-snug">
                MNQ (1m parquet) nelze kombinovat s daty z 30m složky v jedné dávce.
              </span>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto px-2 py-2 space-y-2">
            {instruments.map((inv) => {
              const on = selectedSet.has(inv.file);
              const mnq = isMnqParquetDataFile(inv.file);
              return (
                <label
                  key={inv.file}
                  className="flex items-start gap-2 cursor-pointer text-sm text-zinc-300 leading-snug"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(inv.file)}
                    className="mt-0.5 rounded border-zinc-600"
                  />
                  <span>
                    {inv.displayName ? `${inv.instrument} — ${inv.displayName}` : inv.instrument}{" "}
                    <span className="text-zinc-500">
                      ({inv.timeframe}
                      {mnq ? ", MNQ" : ""}, max {inv.yearsAvailable} let)
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Jedna strategie = jeden datový soubor / instrument na run. */
export const MAX_INSTRUMENTS_BATCH = 1;

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
  /** Count of currently loaded saved runs (Run history). */
  savedRunsCount?: number;
  /** Soft-delete all saved runs for current strategy (Run history). */
  onDeleteSavedBacktests?: () => void;
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
  /** Horní záložka backtest vs prop firm. */
  backtestPanel?: "standard" | "prop";
  onBacktestPanelChange?: (panel: "standard" | "prop") => void;
  propFirmForm?: PropFirmBacktestFormState;
  onPropFirmFormChange?: (next: PropFirmBacktestFormState) => void;
  /** Jednoparametrový OAT sweep (`validation_mode: param_test`). */
  oatSweep?: OatSweepConfig;
  onOatSweepChange?: (next: OatSweepConfig) => void;
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
  savedRunsCount = 0,
  onDeleteSavedBacktests,
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
  backtestPanel = "standard",
  onBacktestPanelChange,
  propFirmForm,
  onPropFirmFormChange,
  oatSweep = DEFAULT_OAT_SWEEP,
  onOatSweepChange,
}: BacktestSettingsProps) {
  const maxYears = useMemo(() => {
    if (selectedInstrumentFiles.length === 0) return selectedInstrument?.yearsAvailable ?? 5;
    const ys = instruments
      .filter((i) => selectedInstrumentFiles.includes(i.file))
      .map((i) => i.yearsAvailable);
    return ys.length > 0 ? Math.min(...ys) : (selectedInstrument?.yearsAvailable ?? 5);
  }, [instruments, selectedInstrumentFiles, selectedInstrument?.yearsAvailable]);
  /** Průnik kalendářních rozsahů vybraných souborů (co engine reálně může použít napříč dávkou). */
  const selectedCalendarOverlap = useMemo(() => {
    const sel =
      selectedInstrumentFiles.length > 0
        ? instruments.filter((i) => selectedInstrumentFiles.includes(i.file))
        : selectedInstrument
          ? [selectedInstrument]
          : [];
    if (sel.length === 0) return null;
    const start = sel.reduce((a, i) => (i.minDate > a ? i.minDate : a), sel[0].minDate);
    const end = sel.reduce((a, i) => (i.maxDate < a ? i.maxDate : a), sel[0].maxDate);
    return start <= end ? { start, end } : null;
  }, [instruments, selectedInstrumentFiles, selectedInstrument]);
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
    propRules: true,
  });
  const [strategyConfigModalOpen, setStrategyConfigModalOpen] = useState(false);
  const [paramModalTab, setParamModalTab] = useState<"strategy" | "modules">("strategy");
  const [strategyParamModalSubTab, setStrategyParamModalSubTab] = useState<"params" | "oat">("params");
  const [confirmDeleteSaved, setConfirmDeleteSaved] = useState(false);

  const inputClass = "w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200";

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

  const edge = edgeSettings;
  const guidanceSteps = [
    { label: "1) Vyber instrument + roky", done: !!selectedInstrument && years >= minYears },
    {
      label: "2) Nastav realistickou simulaci",
      done:
        params.initialCapital > 0 &&
        params.slippagePerc >= 0 &&
        params.commissionPerContract >= 0,
    },
    {
      label: "3) Quality gates (min. obchody, min. PF)",
      done: !!edge && edge.minTradesGate >= 20 && edge.minPfGate >= 1.0,
    },
  ];
  const guidanceReady = guidanceSteps.every((s) => s.done);
  const guidanceWarnings: string[] = [];
  if (edge) {
    if (edge.validationMode === "single") {
      guidanceWarnings.push("Pouze single run může vést k falešné důvěře v edge.");
    }
    if (edge.sweepMode !== "none" && edge.validationMode === "single") {
      guidanceWarnings.push("Robustness sweep na single runu může zvýšit riziko přeladění na vzorku — interpretuj opatrně.");
    }
    if (edge.minTradesGate < 20) {
      guidanceWarnings.push("Nízký min trades gate může zkreslit metriky.");
    }
    if (edge.runFixedSeedEnabled && edge.validationMode === "single" && edge.sweepMode !== "none") {
      guidanceWarnings.push(
        "Fixní seed zaručí reprodukovatelnost, ale sweep na single runu pořád zvyšuje riziko přeladění.",
      );
    }
  }

  const strategyParamEntries = Object.entries(strategyParams);
  const oatEligibleEntries = useMemo(() => {
    const ordered = orderParamEntriesForNestedDisplay(Object.entries(strategyParams), strategyParamMeta);
    return ordered.filter(([k, v]) => {
      if (!paramFieldVisible(strategyParamMeta[k], strategyParams)) return false;
      return isNumericOatParam(v, strategyParamMeta[k]);
    });
  }, [strategyParams, strategyParamMeta]);

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

  useEffect(() => {
    if (!oatSweep.enabled) setStrategyParamModalSubTab("params");
  }, [oatSweep.enabled]);

  useEffect(() => {
    if (!strategyConfigModalOpen) return;
    if (hasStrategyParams) setParamModalTab("strategy");
    else setParamModalTab("modules");
  }, [strategyConfigModalOpen, hasStrategyParams]);

  const toggleSection = (id: string) => {
    setSectionsOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const applyBeginnerDefaults = () => {
    const spec = getFuturesExecutionSpec(selectedInstrument?.instrument ?? "");
    onParamsChange({
      initialCapital: 100000,
      slippagePerc: spec.defaultSlippagePerc,
      commissionPerContract: 0,
      tickSize: spec.tickSize,
      valuePerTick: spec.valuePerTick,
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
    edge?.validationMode === "walk_forward" ? "walk-forward (rolling okna)" : "single run (celá série)";
  const edgeTrustLabel =
    !edge
      ? "N/A"
      : edge.validationMode === "walk_forward"
        ? edge.minTradesGate >= 30
          ? "Higher confidence"
          : "Medium confidence"
        : edge.minTradesGate >= 30
          ? "Medium confidence"
          : "Low confidence";

  const tabWorkspaceActive =
    "flex-1 rounded-md px-3 py-2 text-xs font-medium bg-violet-600/90 text-white border border-violet-500/40 shadow-sm";
  const tabWorkspaceIdle =
    "flex-1 rounded-md px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-100 border border-transparent hover:border-zinc-600";
  const isPropWorkspace = backtestPanel === "prop" && !!propFirmForm && !!onPropFirmFormChange;

  const content = (
    <div className="space-y-4">
      {onBacktestPanelChange ? (
        <div className="flex rounded-lg border border-zinc-700/90 overflow-hidden p-0.5 bg-zinc-950/50 gap-0.5">
          <button
            type="button"
            onClick={() => onBacktestPanelChange("standard")}
            className={backtestPanel === "standard" ? tabWorkspaceActive : tabWorkspaceIdle}
          >
            Backtest
          </button>
          <button
            type="button"
            onClick={() => onBacktestPanelChange("prop")}
            className={backtestPanel === "prop" ? tabWorkspaceActive : tabWorkspaceIdle}
          >
            Prop backtest
          </button>
        </div>
      ) : null}

      {isPropWorkspace ? (
        <div className="space-y-4">
          <div className="space-y-1 pb-1 border-b border-zinc-800/80">
            <h4 className="text-sm font-semibold text-zinc-100 tracking-tight">Prop firm backtest</h4>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Standardní engine run (jedna série) + simulace pravidel evaluace na uzavřených obchodech v čase. Po failu se
              na dalším obchodu začíná nová challenge se stejným starting balance. Limit kontraktů z pravidel firmy zde
              neuplatňujeme — velikost pozice řídí výhradně strategie.
            </p>
          </div>

          <SettingsSection id="basic" title="Instrument & historie" open={sectionsOpen.basic} onToggle={toggleSection}>
            <div>
              <SettingsFieldLabel label="Instrument(y)" fieldId="instrument" />
              <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
                Stejný výběr dat jako u klasického backtestu (jeden soubor na run).
              </p>
              <InstrumentMultiSelect
                instruments={instruments}
                selectedSet={selectedSet}
                onToggle={onToggleInstrumentFile}
                onSelectAll={onSelectAllInstrumentsInList}
                instrumentsLoaded={instrumentsLoaded}
                dataLoadError={dataLoadError}
                emptyMessage="Žádná futures data"
                inputClass={inputClass}
                maxBatch={MAX_INSTRUMENTS_BATCH}
              />
            </div>
            <div>
              <SettingsFieldLabel
                label={`Historie (roky; platný rozsah ${minYears.toFixed(3)} … ${maxYears})`}
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
            </div>
          </SettingsSection>

          <SettingsSection id="simulation" title="Simulace (broker)" open={sectionsOpen.simulation} onToggle={toggleSection}>
            <div>
              <SettingsFieldLabel label="Slippage (%)" fieldId="slippagePerc" />
              <input
                type="number"
                min={0}
                max={10}
                step={0.001}
                value={params.slippagePerc * 100}
                onChange={(e) => onParamsChange({ slippagePerc: (parseFloat(e.target.value) || 0) / 100 })}
                className={inputClass}
              />
            </div>
            <div>
              <SettingsFieldLabel label="Komise (USD / kontrakt / strana)" fieldId="commissionPerContract" />
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
            </div>
          </SettingsSection>

          <SettingsSection id="propRules" title="Pravidla prop účtu" open={true} onToggle={toggleSection}>
            <div className="grid gap-3">
              <div>
                <SettingsFieldLabel label="Režim" fieldId="propMode" />
                <select
                  value={propFirmForm.mode}
                  onChange={(e) =>
                    onPropFirmFormChange({
                      ...propFirmForm,
                      mode: e.target.value as PropFirmBacktestFormState["mode"],
                    })
                  }
                  className={inputClass}
                >
                  <option value="challenges_only">Jen challenge (série pokusů)</option>
                  <option value="challenge_then_pa">Challenge → performance účet</option>
                </select>
              </div>
              <div>
                <SettingsFieldLabel label="Preset (50k eval)" fieldId="propPreset" />
                <select
                  value={propFirmForm.presetId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") onPropFirmFormChange({ ...propFirmForm, presetId: "custom" });
                    else
                      onPropFirmFormChange(
                        applyPropFirmPreset(v as "apex_50k" | "topstep_50k" | "mff_custom_50k", propFirmForm),
                      );
                  }}
                  className={inputClass}
                >
                  <option value="apex_50k">Apex Trader Funding</option>
                  <option value="topstep_50k">Topstep</option>
                  <option value="mff_custom_50k">MyFundedFutures (zjednodušeně)</option>
                  <option value="custom">Vlastní (pole níže)</option>
                </select>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Hodnoty jsou orientační; uprav je podle aktuálních pravidel firmy.
                </p>
              </div>
              <div>
                <SettingsFieldLabel label="Starting balance (eval)" fieldId="accountSize" />
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={propFirmForm.accountSize}
                  onChange={(e) =>
                    onPropFirmFormChange({ ...propFirmForm, accountSize: parseFloat(e.target.value) || 50_000 })
                  }
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <SettingsFieldLabel label="Profit target (USD)" fieldId="profitTarget" />
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={propFirmForm.profitTargetUsd}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        profitTargetUsd: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <SettingsFieldLabel label="Max drawdown (USD)" fieldId="maxDd" />
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={propFirmForm.maxDrawdownUsd}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        maxDrawdownUsd: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <SettingsFieldLabel label="Drawdown model" fieldId="ddModel" />
                <select
                  value={propFirmForm.drawdownModel}
                  onChange={(e) =>
                    onPropFirmFormChange({
                      ...propFirmForm,
                      drawdownModel: e.target.value as PropFirmBacktestFormState["drawdownModel"],
                    })
                  }
                  className={inputClass}
                >
                  <option value="intraday_trailing">Intraday trailing (peak equity v řadě kroků)</option>
                  <option value="eod_trailing">EOD trailing (limit vs poslední EOD high watermark)</option>
                  <option value="static_floor">Statická podlaha (ze starting balance)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <SettingsFieldLabel label="Daily loss limit (USD, 0=vypnuto)" fieldId="dailyLoss" />
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={propFirmForm.dailyLossLimitUsd}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        dailyLossLimitUsd: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <SettingsFieldLabel label="Denní drawdown % (0=vypnuto)" fieldId="dailyDd" />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={propFirmForm.dailyDrawdownPct}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        dailyDrawdownPct: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <SettingsFieldLabel label="Min. obchodních dnů před pass" fieldId="minDays" />
                  <input
                    type="number"
                    min={0}
                    max={90}
                    step={1}
                    value={propFirmForm.minTradingDays}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        minTradingDays: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <SettingsFieldLabel label="Consistency: max podíl top dne % (0=vypnuto)" fieldId="consistency" />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={propFirmForm.consistencyBestDayMaxPct}
                    onChange={(e) =>
                      onPropFirmFormChange({
                        ...propFirmForm,
                        consistencyBestDayMaxPct: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              {propFirmForm.mode === "challenge_then_pa" ? (
                <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3">
                  <div>
                    <SettingsFieldLabel label="PA starting balance (USD)" fieldId="paBal" />
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={propFirmForm.performanceStartingBalance}
                      onChange={(e) =>
                        onPropFirmFormChange({
                          ...propFirmForm,
                          performanceStartingBalance: parseFloat(e.target.value) || 50_000,
                        })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <SettingsFieldLabel label="PA max DD (USD, prázdné=stejné jako eval)" fieldId="paDd" />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={`např. ${propFirmForm.maxDrawdownUsd}`}
                      value={propFirmForm.performanceMaxDrawdownUsd}
                      onChange={(e) =>
                        onPropFirmFormChange({ ...propFirmForm, performanceMaxDrawdownUsd: e.target.value })
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </SettingsSection>
        </div>
      ) : (
        <>
      <div className="space-y-1 pb-1 border-b border-zinc-800/80">
        <h4 className="text-sm font-semibold text-zinc-100 tracking-tight">Nastavení backtestu</h4>
        <p className="text-[11px] text-zinc-500 leading-relaxed">Instrument, simulace, edge validace a spuštění běhu.</p>
      </div>
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
          <SettingsFieldLabel label="Instrument(y)" fieldId="instrument" />
          <p className="text-xs text-zinc-500 mb-2 leading-relaxed">
            Vyber <strong>jeden</strong> soubor dat na run (jedna strategie, jeden set-up). U futures zvol buď{" "}
            <span className="text-zinc-400">MNQ 1m parquet</span>, nebo soubory ze <span className="text-zinc-400">30m</span>{" "}
            skupiny — bez míchání skupin v jednom výběru.
          </p>
          <InstrumentMultiSelect
            instruments={instruments}
            selectedSet={selectedSet}
            onToggle={onToggleInstrumentFile}
            onSelectAll={onSelectAllInstrumentsInList}
            instrumentsLoaded={instrumentsLoaded}
            dataLoadError={dataLoadError}
            emptyMessage="Žádná futures data"
            inputClass={inputClass}
            maxBatch={MAX_INSTRUMENTS_BATCH}
          />
          {multiCount > 0 && (
            <p className="mt-1.5 text-xs text-zinc-400 tabular-nums">Vybraný instrument: {multiCount}</p>
          )}
        </div>
        <div>
          <SettingsFieldLabel
            label={`Historie (roky; platný rozsah ${minYears.toFixed(3)} … ${maxYears}, podle nejužšího max u výběru)`}
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
            {selectedCalendarOverlap && (
              <>
                {" "}
                Kalendářní dostupnost výběru (průnik):{" "}
                <span className="text-zinc-400">
                  {selectedCalendarOverlap.start} — {selectedCalendarOverlap.end}
                </span>
                .
              </>
            )}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection id="instrumentConfig" title="Instrument config" open={sectionsOpen.instrumentConfig} onToggle={toggleSection}>
        <div className="rounded border border-zinc-700/80 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400 leading-relaxed">
          Backtesty jsou pouze jako futures kontrakty. Tick size a value per tick se berou z pevné tabulky podle symbolu
          (první vybraný instrument v dávce) — pole zde nejsou, aby nevznikaly nekonzistence s reálnými kontrakty.
        </div>
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
            step={0.001}
            value={params.slippagePerc * 100}
            onChange={(e) => onParamsChange({ slippagePerc: (parseFloat(e.target.value) || 0) / 100 })}
            className={inputClass}
          />
        </div>
        <div>
          <SettingsFieldLabel label="Komise (USD / kontrakt / strana)" fieldId="commissionPerContract" />
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
          <p className="text-[10px] text-zinc-500 mt-0.5">Pevn\u00fd poplatek brokera/burzy za jednu stranu obchodu na kontrakt. V\u00fdchoz\u00ed 0.</p>
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
                  4) <span className="text-zinc-100">Execution model</span> = realističnost (spread/slippage/latence).
                </div>
                <div className="text-xs text-zinc-400">
                  Monte Carlo (shuffle / prop challenge) je v hlavní záložce{" "}
                  <span className="text-zinc-200">Monte Carlo</span>, ne v backtest konfiguraci.
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
                  <option value="single">Single run (celá historie)</option>
                  <option value="walk_forward">Walk-forward</option>
                </select>
              </div>
              {edge.validationMode === "walk_forward" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <SettingsFieldLabel label="WF folds" fieldId="wfFolds" />
                      <input
                        type="number"
                        min={2}
                        max={12}
                        step={1}
                        value={edge.wfFolds}
                        onChange={(e) =>
                          onEdgeSettingsChange?.({ ...edge, wfFolds: parseInt(e.target.value, 10) || 4 })
                        }
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
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Walk-forward vrací foldy s test metrikami; statický OOS split a OAT param sweep nejsou v menu (lze
                    zkoušet ručně mimo tuto aplikaci).
                  </p>
                </>
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
              <div className="rounded border border-zinc-700/50 bg-zinc-800/25 p-3 space-y-2">
                <SettingsFieldLabel
                  label="Per Regime — segmentace výsledků"
                  fieldId="perRegimeSegmentation"
                />
                <label className="flex items-start gap-2 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={edge.perRegimeSegmentation}
                    onChange={(e) =>
                      onEdgeSettingsChange?.({ ...edge, perRegimeSegmentation: e.target.checked })
                    }
                    className="rounded mt-0.5"
                  />
                  <span>
                    Rozdělit backtest podle režimu trhu (uptrend / downtrend / range) pomocí EMA a ATR. Zapne
                    výstupy v Analytics a záložce Regime; pro Monte Carlo umožní simulaci po režimech.
                  </span>
                </label>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Engine: EMA rychlá vs. pomalá na timeframe dat; <span className="text-zinc-400">range</span> = malý
                  poměr |EMAf−EMAs|/close a současně potlačená relativní volatilita (ATR/close vs. medián řady).
                </p>
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
                    Použít pevný seed pro sweep / bootstrap (jinak náhodný každý run)
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
                    Hodnota jde do manifestu a <code className="text-zinc-400">RUN_SEED</code> v engine (reprodukovatelnost
                    sweepu při stejném kódu a datech).
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

        </>
      )}

      {canRun && (
        <SettingsSection
          id="parameters"
          title="Strategie a zobrazení"
          open={sectionsOpen.parameters}
          onToggle={toggleSection}
        >
          {hasAnyParams ? (
            <div className="rounded-xl border border-zinc-700/70 bg-gradient-to-b from-zinc-900/85 to-zinc-950/65 p-4 space-y-3 shadow-inner shadow-black/25">
              <p className="text-xs text-zinc-400 leading-relaxed">
                Engine parametry (<span className="text-zinc-200">PARAMS</span>) a ladění vrstev (
                <span className="text-zinc-200">VIEW_PARAMS</span>) jsou v přehledném dialogu — podobně jako vstupy ve
                TradingView. Klikni na <span className="text-zinc-300">?</span> u pole pro detail.
              </p>
              <button
                type="button"
                onClick={() => setStrategyConfigModalOpen(true)}
                className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shadow-md shadow-violet-950/40 border border-violet-400/20 transition-colors"
              >
                Otevřít nastavení parametrů…
              </button>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                {hasStrategyParams ? (
                  <span>
                    Strategie (PARAMS):{" "}
                    <span className="text-zinc-300 tabular-nums">{strategyParamEntries.length}</span>
                  </span>
                ) : (
                  <span>Strategie (PARAMS): žádné</span>
                )}
                {hasModulePanels ? (
                  <span>
                    Moduly (VIEW): <span className="text-zinc-300 tabular-nums">{modulePanelRows.length}</span>
                  </span>
                ) : null}
                {hasIndicatorParams ? (
                  <span>
                    Indikátory (VIEW): <span className="text-zinc-300 tabular-nums">{indicatorTabs.length}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-zinc-500 text-xs">
              Žádné parametry k úpravě — strategie neexportuje PARAMS ani VIEW_PARAMS v main.py.
            </p>
          )}
        </SettingsSection>
      )}

      <SettingsSection id="run" title="Run" open={sectionsOpen.run} onToggle={toggleSection}>
        <button
          onClick={onRun}
          disabled={isRunning || !canRun}
          className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isRunning ? "Běží..." : canRun ? "Run" : "Otevřete strategii"}
        </button>

        {canRun && onDeleteSavedBacktests ? (
          <div className="pt-3 mt-3 border-t border-zinc-800 space-y-2">
            <div className="text-xs text-zinc-500">
              Uložené backtesty (Run history):{" "}
              <span className="text-zinc-300 tabular-nums">{savedRunsCount}</span>
            </div>
            {!confirmDeleteSaved ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteSaved(true)}
                disabled={isRunning}
                className="w-full py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/25 border border-rose-500/30 text-rose-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                title="Soft-delete všech uložených runů pro tuto strategii"
              >
                🗑️ Smazat uložené backtesty
              </button>
            ) : (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 space-y-2">
                <div className="text-xs text-rose-100">
                  Opravdu smazat <span className="font-medium">{savedRunsCount}</span> uložených backtestů? (soft-delete)
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSaved(false)}
                    className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
                  >
                    Zrušit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteSaved(false);
                      onDeleteSavedBacktests();
                    }}
                    disabled={isRunning}
                    className="flex-1 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Smazat vše
                  </button>
                </div>
              </div>
            )}
            <div className="text-[11px] text-zinc-600 leading-snug">
              Tip: smaže pouze historii uložených runů ve Firestore (neovlivní strategii ani kód).
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );

  return (
    <>
      {content}
      <StrategyConfigModal
        open={strategyConfigModalOpen && hasAnyParams}
        onClose={() => setStrategyConfigModalOpen(false)}
        title="Nastavení strategie a zobrazení"
        subtitle="PARAMS řídí chování při backtestu; VIEW_PARAMS ladí moduly a indikátory. Textový klíč z kódu je pod názvem pole (kvůli logům a přehledu ve stacku)."
        footer={
          <button
            type="button"
            onClick={() => setStrategyConfigModalOpen(false)}
            className="w-full py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium text-zinc-100"
          >
            Hotovo
          </button>
        }
      >
        {dualParamTabs ? (
          <div className="flex gap-1 p-0.5 rounded-lg bg-zinc-800/85 border border-zinc-700/80 mb-4 sticky top-0 z-[1] backdrop-blur-sm">
            <button
              type="button"
              className={paramModalTab === "strategy" ? tabBtnActive : tabBtnIdle}
              onClick={() => setParamModalTab("strategy")}
            >
              Strategie · PARAMS
            </button>
            <button
              type="button"
              className={paramModalTab === "modules" ? tabBtnActive : tabBtnIdle}
              onClick={() => setParamModalTab("modules")}
            >
              Moduly / indikátory · VIEW_PARAMS
            </button>
          </div>
        ) : null}

        {(dualParamTabs ? paramModalTab === "strategy" : hasStrategyParams) ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Parametry strategie</div>
              {hasStrategyParams ? (
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={oatSweep.enabled}
                    onChange={(e) => onOatSweepChange?.({ ...oatSweep, enabled: e.target.checked })}
                    className="rounded border-zinc-600"
                  />
                  <span>OAT sweep</span>
                </label>
              ) : null}
            </div>

            {hasStrategyParams && oatSweep.enabled ? (
              <>
                <div className="flex gap-1 p-0.5 rounded-lg bg-zinc-800/85 border border-zinc-700/80">
                  <button
                    type="button"
                    className={strategyParamModalSubTab === "params" ? tabBtnActive : tabBtnIdle}
                    onClick={() => setStrategyParamModalSubTab("params")}
                  >
                    Hodnoty
                  </button>
                  <button
                    type="button"
                    className={strategyParamModalSubTab === "oat" ? tabBtnActive : tabBtnIdle}
                    onClick={() => setStrategyParamModalSubTab("oat")}
                  >
                    OAT rozsah
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Jednoparametrový sweep ve stejném runu: rozsah (od→do, krok) přepíše default pro jednotlivé backtesty.
                  Režim validace bude <span className="text-zinc-400 font-mono">param_test</span> (nelze kombinovat s
                  walk-forward).
                </p>
              </>
            ) : null}

            {hasStrategyParams ? (
              !oatSweep.enabled || strategyParamModalSubTab === "params" ? (
                <StrategyParamsFieldList
                  entries={strategyParamEntries}
                  current={strategyParams}
                  onPatch={(next) => onStrategyParamsChange?.(next)}
                  metaMap={strategyParamMeta}
                  getHelp={(k) => getParamHelp({ kind: "strategy" }, k)}
                  inputClass={inputClass}
                />
              ) : (
                <div className="space-y-4 rounded-lg border border-violet-700/35 bg-violet-950/15 px-3 py-3">
                  <p className="text-xs text-zinc-400">
                    Vyber parametr a rozsah <span className="text-zinc-500">(od / do / krok)</span>. Hodnoty jsou přesně
                    takové, jak je strategie bere v kódu — u <span className="font-mono text-zinc-500">atr_sl_pct</span>{" "}
                    Pine/Python používá číslo v jednotkách procent (např. <span className="font-mono">30</span> = 30 %), ne
                    zlomek 0,3. Pro sweep 10 %–50 % tedy zadej <span className="font-mono">10</span> až{" "}
                    <span className="font-mono">50</span>, krok např. <span className="font-mono">5</span> nebo{" "}
                    <span className="font-mono">10</span>.
                  </p>
                  <div className="max-h-[min(52vh,400px)] overflow-y-auto space-y-2 pr-1">
                    {oatEligibleEntries.length === 0 ? (
                      <p className="text-sm text-zinc-500">Žádný vhodný číselný parametr (select / boolean se neobjeví).</p>
                    ) : (
                      oatEligibleEntries.map(([key, val]) => {
                        const meta = strategyParamMeta[key] ?? {};
                        const label = meta.title?.trim() || key;
                        const picked = oatSweep.paramKey === key;
                        return (
                          <label
                            key={key}
                            className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                              picked ? "border-violet-500/60 bg-violet-950/25" : "border-zinc-800 bg-zinc-950/35"
                            }`}
                          >
                            <input
                              type="radio"
                              name="oat-sweep-param"
                              checked={picked}
                              onChange={() => onOatSweepChange?.({ ...oatSweep, paramKey: key })}
                              className="mt-1 border-zinc-600"
                            />
                            <span className="min-w-0">
                              <span className="text-sm text-zinc-200 block">{label}</span>
                              <span className="font-mono text-[10px] text-zinc-500">{key}</span>
                              {typeof val === "number" ? (
                                <span className="block text-[10px] text-zinc-600 mt-0.5">
                                  aktuálně: <span className="font-mono text-zinc-400">{val}</span> (pro sweep přepíše rozsah)
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {oatSweep.paramKey ? (
                    <div className="space-y-2 pt-1 border-t border-zinc-800/80">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                          Od
                          <input
                            type="number"
                            step="any"
                            value={oatSweep.from}
                            onChange={(e) =>
                              onOatSweepChange?.({ ...oatSweep, from: parseFloat(e.target.value) || 0 })
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                          Do
                          <input
                            type="number"
                            step="any"
                            value={oatSweep.to}
                            onChange={(e) =>
                              onOatSweepChange?.({ ...oatSweep, to: parseFloat(e.target.value) || 0 })
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                          Krok
                          <input
                            type="number"
                            step="any"
                            value={oatSweep.step}
                            onChange={(e) =>
                              onOatSweepChange?.({ ...oatSweep, step: parseFloat(e.target.value) || 0 })
                            }
                            className={inputClass}
                          />
                        </label>
                      </div>
                      {(() => {
                        if (oatSweep.step <= 0) {
                          return <p className="text-[11px] text-rose-400/90">Zadej krok &gt; 0.</p>;
                        }
                        const lo = Math.min(oatSweep.from, oatSweep.to);
                        const hi = Math.max(oatSweep.from, oatSweep.to);
                        const n = Math.floor((hi - lo) / oatSweep.step + 1e-9) + 1;
                        if (!Number.isFinite(n) || n < 1) {
                          return <p className="text-[11px] text-rose-400/90">Neplatný rozsah.</p>;
                        }
                        return (
                          <p className="text-[11px] text-zinc-500">
                            Bodů v mřížce:{" "}
                            <span className="font-mono text-zinc-300">{n}</span>
                            <span className="text-zinc-600"> · engine max 500 bodů</span>
                          </p>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">Vyber parametr výše.</p>
                  )}
                </div>
              )
            ) : (
              <p className="text-sm text-zinc-500">Žádné PARAMS v main.py strategie.</p>
            )}
          </div>
        ) : null}

        {(dualParamTabs
          ? paramModalTab === "modules"
          : !hasStrategyParams && (hasModulePanels || hasIndicatorParams)) ? (
          <div className="space-y-8">
            {hasModulePanels ? (
              <div className="space-y-5">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Moduly</h4>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                    Hodnoty jdou do <code className="text-zinc-400">params.module_params</code> pod klíčem názvu modulu;
                    strategie je sloučí podle své logiky.
                  </p>
                </div>
                {modulePanelRows.map((row: ModuleParamPanelEntry) => {
                  const cur = moduleParams[row.name] ?? {};
                  const ent = Object.entries(cur);
                  if (ent.length === 0) {
                    return (
                      <div key={row.name} className="rounded-lg border border-zinc-800/90 bg-zinc-950/30 p-3">
                        <div className="text-sm font-medium text-zinc-200">{row.name}</div>
                        <p className="text-xs text-zinc-500 mt-1">
                          Modul nemá VIEW_PARAMS v main.py — přidej dict VIEW_PARAMS nebo uprav výchozí v kódu.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div key={row.name} className="space-y-2">
                      <div className="text-sm font-medium text-zinc-200">
                        {row.name}
                        {row.fromParamChain ? (
                          <span className="ml-2 text-[10px] font-normal text-violet-400 normal-case">
                            · PARAM_MODULE_CHAIN
                          </span>
                        ) : null}
                      </div>
                      <StrategyParamsFieldList
                        entries={ent}
                        current={cur}
                        onPatch={(next) => onModuleParamsChange?.(row.name, next)}
                        metaMap={moduleParamMeta[row.name] ?? {}}
                        getHelp={(k) => getParamHelp({ kind: "module", name: row.name }, k)}
                        inputClass={inputClass}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}

            {hasIndicatorParams ? (
              <div className="space-y-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Indikátory</h4>
                {indicatorTabs.map((name) => {
                  const cur = indicatorParams[name] ?? {};
                  const ent = Object.entries(cur);
                  if (ent.length === 0) {
                    return (
                      <div key={name} className="rounded-lg border border-zinc-800/90 bg-zinc-950/30 p-3">
                        <div className="text-sm font-medium text-zinc-200">{name}</div>
                        <p className="text-xs text-zinc-500 mt-1">Indikátor nemá VIEW_PARAMS v main.py.</p>
                      </div>
                    );
                  }
                  return (
                    <div key={name} className="space-y-2">
                      <div className="text-sm font-medium text-zinc-200">{name}</div>
                      <StrategyParamsFieldList
                        entries={ent}
                        current={cur}
                        onPatch={(next) => onIndicatorParamsChange?.(name, next)}
                        metaMap={indicatorParamMeta[name] ?? {}}
                        getHelp={(k) => getParamHelp({ kind: "indicator", name }, k)}
                        inputClass={inputClass}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </StrategyConfigModal>
    </>
  );
}
