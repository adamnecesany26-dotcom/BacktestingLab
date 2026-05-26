"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { StrategyEditor } from "@/components/editor/StrategyEditor";
import { CreateModal } from "@/components/CreateModal";
import { AddFileModal } from "@/components/AddFileModal";
import {
  BacktestSettings,
  defaultOatSweepConfig,
  type EdgeFindingSettings,
  type OatSweepConfig,
} from "@/components/BacktestSettings";
import { ResultsView } from "@/components/results/ResultsView";
import { StrategyViewChart } from "@/components/StrategyViewChart";
import { MonteCarloWorkspace } from "@/components/monteCarlo/MonteCarloWorkspace";
import { RegimeAnalysisWorkspace } from "@/components/regime/RegimeAnalysisWorkspace";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import {
  saveBacktestResult,
  listBacktestResults,
  deleteBacktestResult,
  deleteAllBacktestResults,
  updateBacktestRunGovernance,
  type SavedBacktestRun,
} from "@/lib/firestore";
import {
  listItems,
  getFiles,
  getFileContent,
  saveFile,
  createFile,
  createItem,
  type ItemType,
  type FirestoreItem,
} from "@/lib/firestore";
import { ensureAnonymousSession } from "@/lib/firebase";
import {
  runBacktestStreaming,
  getAvailableData,
} from "@/lib/api";
import { MIN_BACKTEST_YEARS } from "@/lib/dataRange";
import {
  parseStrategyParams,
  parseStrategyParamBundle,
  parseViewParamBundle,
  mergeStrategyImportDependencyTokens,
  parseParamModuleChain,
  resolveModuleIdsForParamChain,
  normalizePythonModuleToken,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";
import {
  strategyParamTouchedFromBaseline,
  buildBacktestSavePayload,
} from "@/lib/backtestPageUtils";
import { useBacktestExecutionParams } from "@/hooks/useBacktestExecutionParams";
import {
  type RunRequest,
  type RunResponse,
  type DataInstrument,
} from "@shared/types";
import { getFuturesExecutionSpec } from "@/lib/futuresExecutionSpec";
import {
  buildPropFirmBacktestRequestPayload,
  defaultPropFirmForm,
  type PropFirmBacktestFormState,
} from "@/lib/propFirmBacktestConfig";

const EMPTY_SIDEBAR_LISTS: Record<ItemType, FirestoreItem[]> = {
  strategies: [],
  indicators: [],
  modules: [],
};

const DEFAULT_EXPANDED_SIDEBAR: Record<ItemType, boolean> = {
  strategies: true,
  indicators: false,
  modules: false,
};

/** Wall-clock limit pro engine run (sekundy); UI pole odstraněno — fixní hodnota. */
const RUN_TIMEOUT_SEC_DEFAULT = 7200;

/** Hlavní režim aplikace (záložky uprostřed workspace). */
type WorkspaceTab = "backtest" | "view" | "monteCarlo" | "regime";

const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "backtest", label: "Backtest" },
  { id: "view", label: "View" },
  { id: "regime", label: "Regime" },
  { id: "monteCarlo", label: "Monte Carlo" },
];

export default function Home() {
  const runLockRef = useRef(false);
  const lastParamChainUnresolvedLogKey = useRef<string>("");
  /** PARAMS parsed from main.py when strategy last loaded — panel overrides apply only if different from this. */
  const strategyParamsBaselineRef = useRef<StrategyParams>({});
  const [sidebarLists, setSidebarLists] =
    useState<Record<ItemType, FirestoreItem[]>>(EMPTY_SIDEBAR_LISTS);
  const [expandedSidebar, setExpandedSidebar] =
    useState<Record<ItemType, boolean>>(DEFAULT_EXPANDED_SIDEBAR);
  const [createModalType, setCreateModalType] = useState<ItemType | null>(null);
  const [openItem, setOpenItem] = useState<{ type: ItemType; id: string; name: string } | null>(null);
  const [files, setFiles] = useState<{ fileName: string; content: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAddFileModalOpen, setIsAddFileModalOpen] = useState(false);

  const [instruments, setInstruments] = useState<DataInstrument[]>([]);
  const [instrumentsLoaded, setInstrumentsLoaded] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  /** Vybraný datový soubor (jeden instrument na run). */
  const [selectedInstrumentFiles, setSelectedInstrumentFiles] = useState<string[]>([]);
  const [indicators, setIndicators] = useState<FirestoreItem[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [appliedIndicatorIds, setAppliedIndicatorIds] = useState<string[]>([]);
  const [modules, setModules] = useState<FirestoreItem[]>([]);
  /** View chart resolves VIEW_DEPENDENCIES from Firestore; `modules` is often still [] on first View paint (child effects run before parent's listItems). Sidebar list is loaded at mount — use as fallback so the first fetch sends dependency code. */
  const modulesForViewChart = useMemo(
    () => (modules.length > 0 ? modules : sidebarLists.modules),
    [modules, sidebarLists.modules],
  );
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [appliedModuleIds, setAppliedModuleIds] = useState<string[]>([]);
  /** PARAM_MODULE_CHAIN z uloženého main.py (když v editoru není otevřený main.py). */
  const [savedMainParamModuleChain, setSavedMainParamModuleChain] = useState<string[]>([]);
  const [years, setYears] = useState(1);
  const [backtestSettingsPanel, setBacktestSettingsPanel] = useState<"standard" | "prop">("standard");
  const [propFirmForm, setPropFirmForm] = useState<PropFirmBacktestFormState>(() => defaultPropFirmForm());
  const [backtestParams, setBacktestParams] = useBacktestExecutionParams();

  const [strategyParams, setStrategyParams] = useState<StrategyParams>({});
  const [strategyParamMeta, setStrategyParamMeta] = useState<StrategyParamsMeta>({});
  const [moduleParams, setModuleParams] = useState<Record<string, StrategyParams>>({});
  const [moduleParamMeta, setModuleParamMeta] = useState<Record<string, StrategyParamsMeta>>({});
  const [indicatorParams, setIndicatorParams] = useState<Record<string, StrategyParams>>({});
  const [indicatorParamMeta, setIndicatorParamMeta] = useState<Record<string, StrategyParamsMeta>>({});
  const [edgeSettings, setEdgeSettings] = useState<EdgeFindingSettings>({
    validationMode: "single",
    wfFolds: 4,
    wfTestRatio: 0.2,
    minTradesGate: 30,
    maxDdGate: 25,
    minPfGate: 1.2,
    sweepMode: "none",
    sweepSamples: 24,
    executionEnabled: false,
    spreadBps: 0.5,
    slippageVolMult: 1.0,
    latencyBars: 0,
    stressMultiplier: 1.0,
    forwardBridgeEnabled: false,
    forwardBridgeMode: "paper_shadow",
    forwardBridgeBaselineEquity: 100000,
    experimentHypothesis: "sd-edge-hypothesis",
    experimentTagsCsv: "manual-run",
    experimentBranch: "main",
    promoteOnPass: false,
    runFixedSeedEnabled: false,
    runFixedSeedValue: 42,
    perRegimeSegmentation: false,
  });
  const [oatSweep, setOatSweep] = useState<OatSweepConfig>(() => defaultOatSweepConfig());
  const [results, setResults] = useState<RunResponse | null>(null);
  const [runHistory, setRunHistory] = useState<SavedBacktestRun[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("backtest");
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  /** Levé adresářové menu + pravý panel nastavení — lze schovat kvůli většímu prostoru pro editor / výsledky. */
  const [leftNavOpen, setLeftNavOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [strategiesForView, setStrategiesForView] = useState<FirestoreItem[]>([]);
  const [autoDetectedForStrategy, setAutoDetectedForStrategy] = useState<string | null>(null);

  const addLog = useCallback((msg: string) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }, []);

  // Plotly charts resize on window resize. When we collapse/expand side panels,
  // the container width changes without a real window resize → force a resize event.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        // ignore
      }
    }, 250); // match panel transition duration (200ms) with a bit of buffer
    return () => clearTimeout(t);
  }, [leftNavOpen, rightPanelOpen, workspaceTab]);

  /** Sloučí statické importy, importlib.import_module("modules.X") a PARAM_MODULE_CHAIN → výběr modulů/indikátorů. */
  const applyLibraryAutoDetect = useCallback(
    (code: string, opts?: { log?: boolean }) => {
      const deps = mergeStrategyImportDependencyTokens(code);
      const toModuleName = (n: string) =>
        normalizePythonModuleToken((n || "module").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_"));
      const detectedIndicatorIds = indicators
        .filter((ind) => deps.indicators.includes(toModuleName(ind.name)))
        .map((ind) => ind.id);
      const detectedFromImports = modules
        .filter((mod) => deps.modules.includes(toModuleName(mod.name)))
        .map((mod) => mod.id);
      const { ids: chainIds } = resolveModuleIdsForParamChain(
        parseParamModuleChain(code),
        modules.map((m) => ({ id: m.id, name: m.name })),
      );
      const detectedModuleIds = Array.from(new Set([...detectedFromImports, ...chainIds]));
      setSelectedIndicatorIds((prev) => Array.from(new Set([...detectedIndicatorIds, ...prev])));
      setSelectedModuleIds((prev) => Array.from(new Set([...detectedModuleIds, ...prev])));
      if (opts?.log && (detectedIndicatorIds.length > 0 || detectedModuleIds.length > 0)) {
        addLog(
          `Auto-detect (import / importlib / PARAM_MODULE_CHAIN): ${detectedIndicatorIds.length} indikátorů, ${detectedModuleIds.length} modulů — potvrďte výběr.`,
        );
      }
    },
    [indicators, modules, addLog],
  );

  const effectiveParamModuleChain = useMemo(() => {
    if (openItem?.type === "strategies" && selectedFile === "main.py") {
      return parseParamModuleChain(fileContent);
    }
    return savedMainParamModuleChain;
  }, [openItem?.type, selectedFile, fileContent, savedMainParamModuleChain]);

  const { ids: chainModuleIds, unresolved: unresolvedParamChainModules } = useMemo(
    () => resolveModuleIdsForParamChain(effectiveParamModuleChain, modules),
    [effectiveParamModuleChain, modules],
  );

  const moduleIdsForParamPanels = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of appliedModuleIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    for (const id of chainModuleIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }, [appliedModuleIds, chainModuleIds]);

  const transitiveModuleIdSet = useMemo(() => {
    const applied = new Set(appliedModuleIds);
    return new Set(chainModuleIds.filter((id) => !applied.has(id)));
  }, [appliedModuleIds, chainModuleIds]);

  const moduleParamPanels = useMemo(
    () =>
      moduleIdsForParamPanels
        .map((id) => {
          const mod = modules.find((m) => m.id === id);
          if (!mod) return null;
          return {
            id: mod.id,
            name: mod.name,
            fromParamChain: transitiveModuleIdSet.has(id),
          };
        })
        .filter((x): x is { id: string; name: string; fromParamChain: boolean } => x != null),
    [moduleIdsForParamPanels, modules, transitiveModuleIdSet],
  );

  /** Firestore writes need auth; on localhost we try anonymous sign-in automatically. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await ensureAnonymousSession();
      if (cancelled) return;
      if ("user" in r) {
        addLog(
          r.user.isAnonymous
            ? "Firebase: přihlášen anonymně (localhost nebo NEXT_PUBLIC_FIREBASE_ANONYMOUS_SIGNIN) — Run history se může ukládat."
            : "Firebase: přihlášen — Run history se může ukládat."
        );
      } else {
        addLog(`Firebase: nepodařilo se přihlásit — ${r.error} (Run history se bez toho neuloží).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  const loadSidebarLists = useCallback(async () => {
    const [strategies, indicators, modules] = await Promise.all([
      listItems("strategies"),
      listItems("indicators"),
      listItems("modules"),
    ]);
    setSidebarLists({ strategies, indicators, modules });
  }, []);

  useEffect(() => {
    void loadSidebarLists();
  }, [loadSidebarLists]);

  const loadFiles = useCallback(async (type: ItemType, id: string) => {
    const f = await getFiles(type, id);
    setFiles(f);
    if (f.length > 0) {
      setSelectedFile(f[0].fileName);
    }
  }, []);

  const loadFileContent = useCallback(async (type: ItemType, id: string, fileName: string) => {
    const content = await getFileContent(type, id, fileName);
    const v = content ?? "";
    setFileContent(v);
    setLastSavedContent(v);
  }, []);

  useEffect(() => {
    if (workspaceTab === "view") {
      listItems("strategies").then(setStrategiesForView);
    }
  }, [workspaceTab]);

  useEffect(() => {
    if (openItem?.type === "strategies") {
      listItems("indicators").then(setIndicators);
      listItems("modules").then(setModules);
    } else if (workspaceTab === "view") {
      listItems("indicators").then(setIndicators);
      listItems("modules").then(setModules);
    } else {
      setIndicators([]);
      setSelectedIndicatorIds([]);
      setAppliedIndicatorIds([]);
      setModules([]);
      setSelectedModuleIds([]);
      setAppliedModuleIds([]);
    }
  }, [openItem?.type, openItem?.id, workspaceTab]);

  useEffect(() => {
    if (openItem) {
      loadFiles(openItem.type, openItem.id);
    } else {
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
      setLastSavedContent("");
    }
  }, [openItem, loadFiles]);

  useEffect(() => {
    if (!openItem) return;
    if (selectedFile?.startsWith("indicator:")) {
      const id = selectedFile.replace("indicator:", "");
      getFileContent("indicators", id, "main.py").then((c) => {
        const v = c ?? "";
        setFileContent(v);
        setLastSavedContent(v);
      });
    } else if (selectedFile?.startsWith("module:")) {
      const id = selectedFile.replace("module:", "");
      getFileContent("modules", id, "main.py").then((c) => {
        const v = c ?? "";
        setFileContent(v);
        setLastSavedContent(v);
      });
    } else if (selectedFile) {
      loadFileContent(openItem.type, openItem.id, selectedFile);
    }
  }, [openItem, selectedFile, loadFileContent]);

  /** Parse PARAMS from main.py when strategy loads - reset when strategy changes */
  useEffect(() => {
    if (!openItem || openItem.type !== "strategies") {
      strategyParamsBaselineRef.current = {};
      setStrategyParams({});
      setStrategyParamMeta({});
      setAutoDetectedForStrategy(null);
      return;
    }
    getFileContent(openItem.type, openItem.id, "main.py").then((c) => {
      const bundle = parseStrategyParamBundle(c ?? "");
      strategyParamsBaselineRef.current = { ...bundle.params };
      setStrategyParams(bundle.params);
      setStrategyParamMeta(bundle.meta);
    });
  }, [openItem?.type, openItem?.id]);

  useEffect(() => {
    if (openItem?.type !== "strategies" || !openItem?.id) return;
    setSelectedIndicatorIds([]);
    setAppliedIndicatorIds([]);
    setSelectedModuleIds([]);
    setAppliedModuleIds([]);
    setAutoDetectedForStrategy(null);
  }, [openItem?.type, openItem?.id]);

  /** PARAM_MODULE_CHAIN ze uloženého main.py (živá úprava main.py řídí effectiveParamModuleChain). */
  useEffect(() => {
    if (!openItem || openItem.type !== "strategies") {
      setSavedMainParamModuleChain([]);
      lastParamChainUnresolvedLogKey.current = "";
      return;
    }
    void getFileContent("strategies", openItem.id, "main.py").then((c) => {
      setSavedMainParamModuleChain(parseParamModuleChain(c ?? ""));
    });
  }, [openItem?.type, openItem?.id]);

  useEffect(() => {
    if (!openItem || openItem.type !== "strategies" || unresolvedParamChainModules.length === 0) return;
    const key = `${openItem.id}::${unresolvedParamChainModules.join("|")}`;
    if (lastParamChainUnresolvedLogKey.current === key) return;
    lastParamChainUnresolvedLogKey.current = key;
    addLog(
      `PARAM_MODULE_CHAIN: v knihovně Moduly chybí tyto názvy (musí přesně odpovídat názvu položky): ${unresolvedParamChainModules.join(", ")}`,
    );
  }, [openItem?.type, openItem?.id, unresolvedParamChainModules, addLog]);

  /** Load VIEW_PARAMS for applied modules + PARAM_MODULE_CHAIN transitive modules */
  useEffect(() => {
    if (!openItem || openItem.type !== "strategies" || moduleIdsForParamPanels.length === 0) {
      setModuleParams({});
      setModuleParamMeta({});
      return;
    }
    const load = async () => {
      const next: Record<string, StrategyParams> = {};
      const nextMeta: Record<string, StrategyParamsMeta> = {};
      for (const modId of moduleIdsForParamPanels) {
        const mod = modules.find((m) => m.id === modId);
        if (!mod) continue;
        const content = await getFileContent("modules", modId, "main.py");
        const bundle = parseViewParamBundle(content ?? "");
        next[mod.name] = bundle.params;
        if (Object.keys(bundle.meta).length > 0) {
          nextMeta[mod.name] = bundle.meta;
        }
      }
      setModuleParams(next);
      setModuleParamMeta(nextMeta);
    };
    void load();
  }, [openItem?.type, openItem?.id, moduleIdsForParamPanels, modules]);

  /** Load VIEW_PARAMS for applied indicators (collapsible panel v backtest nastavení) */
  useEffect(() => {
    if (!openItem || openItem.type !== "strategies" || appliedIndicatorIds.length === 0) {
      setIndicatorParams({});
      setIndicatorParamMeta({});
      return;
    }
    const load = async () => {
      const next: Record<string, StrategyParams> = {};
      const nextMeta: Record<string, StrategyParamsMeta> = {};
      for (const indId of appliedIndicatorIds) {
        const ind = indicators.find((i) => i.id === indId);
        if (!ind) continue;
        const content = await getFileContent("indicators", indId, "main.py");
        const bundle = parseViewParamBundle(content ?? "");
        next[ind.name] = bundle.params;
        if (Object.keys(bundle.meta).length > 0) {
          nextMeta[ind.name] = bundle.meta;
        }
      }
      setIndicatorParams(next);
      setIndicatorParamMeta(nextMeta);
    };
    load();
  }, [openItem?.type, openItem?.id, appliedIndicatorIds, indicators]);

  /** První průchod po otevření strategie — vždy main.py ze úložiště (editor může mít jiný soubor otevřený). */
  useEffect(() => {
    if (
      openItem?.type !== "strategies" ||
      !openItem?.id ||
      autoDetectedForStrategy === openItem.id ||
      (indicators.length === 0 && modules.length === 0)
    ) {
      return;
    }
    void (async () => {
      const code = (await getFileContent("strategies", openItem.id, "main.py")) ?? "";
      applyLibraryAutoDetect(code, { log: true });
      setAutoDetectedForStrategy(openItem.id);
    })();
  }, [openItem?.type, openItem?.id, autoDetectedForStrategy, indicators, modules, applyLibraryAutoDetect]);

  /** Při úpravách main.py v editoru znovu sloučit závislosti (debounce — bez log spamu). */
  useEffect(() => {
    if (openItem?.type !== "strategies" || !openItem?.id || selectedFile !== "main.py") return;
    if (indicators.length === 0 && modules.length === 0) return;
    const t = window.setTimeout(() => {
      applyLibraryAutoDetect(fileContent, { log: false });
    }, 500);
    return () => window.clearTimeout(t);
  }, [fileContent, selectedFile, openItem?.type, openItem?.id, indicators.length, modules.length, applyLibraryAutoDetect]);

  useEffect(() => {
    getAvailableData()
      .then((d) => {
        setInstruments(d.instruments);
        setInstrumentsLoaded(true);
        setDataLoadError(null);
      })
      .catch((error) => {
        setInstruments([]);
        setInstrumentsLoaded(true);
        const message = error instanceof Error ? error.message : String(error);
        setDataLoadError(message);
        addLog(`Načtení dat selhalo: ${message}`);
      });
  }, [addLog]);

  /** Merge strategy params + module_params for run request */
  const buildMergedParams = useCallback((): RunRequest["params"] => {
    const flat: Record<string, number | boolean | string | Record<string, unknown>> = { ...strategyParams };
    const mods: Record<string, Record<string, number | boolean | string>> = {};
    for (const modId of moduleIdsForParamPanels) {
      const mod = modules.find((m) => m.id === modId);
      if (!mod) continue;
      const p = moduleParams[mod.name];
      if (p && Object.keys(p).length > 0) {
        mods[mod.name] = p;
      }
    }
    if (Object.keys(mods).length > 0) {
      flat.module_params = mods;
    }
    if (Object.keys(flat).length === 0) return undefined;
    return flat;
  }, [strategyParams, moduleIdsForParamPanels, modules, moduleParams]);

  const filteredInstruments = instruments;

  const selectedInstruments = useMemo(() => {
    return selectedInstrumentFiles
      .map((f) => filteredInstruments.find((i) => i.file === f))
      .filter((x): x is DataInstrument => !!x);
  }, [selectedInstrumentFiles, filteredInstruments]);

  const selectedInstrument = selectedInstruments[0] ?? null;

  const minYearsAcrossSelected = useMemo(
    () =>
      selectedInstruments.length > 0
        ? Math.min(...selectedInstruments.map((i) => i.yearsAvailable))
        : 5,
    [selectedInstruments],
  );

  /** Drž výběr v souladu s dostupnými futures instrumenty a zajisti nejméně jeden instrument */
  useEffect(() => {
    setSelectedInstrumentFiles((prev) => {
      const valid = prev.filter((f) => filteredInstruments.some((i) => i.file === f));
      if (valid.length > 1) return [valid[0]!];
      if (valid.length === prev.length && prev.length > 0) return prev;
      if (valid.length > 0) return valid;
      const first = filteredInstruments[0];
      return first ? [first.file] : [];
    });
  }, [filteredInstruments]);

  /** Omez délku (roky) podle nejužšího limitu vybraných instrumentů */
  useEffect(() => {
    if (selectedInstruments.length === 0) return;
    const cap = minYearsAcrossSelected;
    setYears((y) => Math.min(y, cap));
  }, [selectedInstruments.length, minYearsAcrossSelected]);

  /** Tick spec z tabulky podle prvního vybraného souboru (batch dílčí položky mají vlastní tick). */
  useEffect(() => {
    if (selectedInstrumentFiles.length === 0) return;
    const inv = filteredInstruments.find((i) => i.file === selectedInstrumentFiles[0]);
    if (!inv) return;
    const spec = getFuturesExecutionSpec(inv.instrument);
    setBacktestParams((prev) => ({
      ...prev,
      tickSize: spec.tickSize,
      valuePerTick: spec.valuePerTick,
      slippagePerc: spec.defaultSlippagePerc,
    }));
  }, [selectedInstrumentFiles, filteredInstruments]);

  const toggleInstrumentFile = useCallback((file: string) => {
    setSelectedInstrumentFiles((prev) => {
      if (prev.includes(file)) {
        if (prev.length <= 1) return prev;
        return prev.filter((f) => f !== file);
      }
      return [file];
    });
  }, []);

  const selectAllInstrumentFiles = useCallback(() => {
    const first = filteredInstruments[0];
    setSelectedInstrumentFiles(first ? [first.file] : []);
  }, [filteredInstruments]);

  const toggleSidebarSection = (type: ItemType) => {
    setExpandedSidebar((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const openCreateModalForType = (type: ItemType) => {
    setCreateModalType(type);
    setIsCreateModalOpen(true);
  };

  const handleSelectItem = (type: ItemType, item: FirestoreItem) => {
    setOpenItem({ type, id: item.id, name: item.name });
    setSelectedFile(null);
    setShowResults(false);
  };

  const handleBack = () => {
    if (openItem) {
      setOpenItem(null);
      setShowResults(false);
    }
  };

  const handleCreateItem = async (name: string, tag?: string) => {
    const type = createModalType;
    if (!type) return;
    const { id } = await createItem(type, name, tag);
    await loadSidebarLists();
    const newItem: FirestoreItem = { id, name, tag, createdAt: null as any };
    handleSelectItem(type, newItem);
  };

  const handleAddFile = async (fileName: string) => {
    if (!openItem) return;
    await createFile(openItem.type, openItem.id, fileName);
    await loadFiles(openItem.type, openItem.id);
    setSelectedFile(fileName);
    setFileContent("");
    setLastSavedContent("");
    addLog(`Vytvořen soubor: ${fileName}`);
  };

  const handleSaveFile = async () => {
    if (!openItem || !selectedFile) return;
    const prevSaved = lastSavedContent;
    setLastSavedContent(fileContent);
    setIsSaving(true);
    try {
      if (selectedFile.startsWith("indicator:")) {
        const id = selectedFile.replace("indicator:", "");
        await saveFile("indicators", id, "main.py", fileContent);
        addLog(`Uloženo: indikátor ${indicators.find((i) => i.id === id)?.name ?? id}`);
      } else if (selectedFile.startsWith("module:")) {
        const id = selectedFile.replace("module:", "");
        await saveFile("modules", id, "main.py", fileContent);
        addLog(`Uloženo: modul ${modules.find((m) => m.id === id)?.name ?? id}`);
      } else {
        await saveFile(openItem.type, openItem.id, selectedFile, fileContent);
        addLog(`Uloženo: ${selectedFile}`);
      }
    } catch (e) {
      setLastSavedContent(prevSaved);
      addLog(`Chyba při ukládání: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmSelection = () => {
    setAppliedIndicatorIds([...selectedIndicatorIds]);
    setAppliedModuleIds([...selectedModuleIds]);
    addLog(`Potvrzeno: ${selectedIndicatorIds.length} indikátorů, ${selectedModuleIds.length} modulů`);
  };

  const handleRun = async () => {
    if (runLockRef.current || isRunning) return;
    if (!openItem || openItem.type !== "strategies") return;

    const strategyContext = { id: openItem.id, name: openItem.name, type: openItem.type };
    runLockRef.current = true;
    const mainCode = await getFileContent(strategyContext.type, strategyContext.id, "main.py");
    if (!mainCode) {
      addLog("Chyba: main.py nenalezen");
      runLockRef.current = false;
      return;
    }
    if (!selectedInstrument) {
      addLog("Vyberte instrument");
      runLockRef.current = false;
      return;
    }
    const chainBundledNames = moduleIdsForParamPanels
      .filter((id) => transitiveModuleIdSet.has(id))
      .map((id) => modules.find((m) => m.id === id)?.name)
      .filter((n): n is string => !!n);
    if (chainBundledNames.length > 0) {
      addLog(`Run: moduly z PARAM_MODULE_CHAIN (přibaleny + jejich VIEW_PARAMS): ${chainBundledNames.join(", ")}`);
    }
    if (edgeSettings.validationMode === "single") {
      addLog("INFO: single run na celé historii — out-of-sample ověření si nastav ručně mimo app, pokud potřebuješ.");
    }
    if (edgeSettings.sweepMode !== "none" && edgeSettings.validationMode === "single") {
      addLog("WARNING: Robustness sweep na single runu může vést k overfittingu — interpretuj opatrně.");
    }
    if (edgeSettings.minTradesGate < 20) {
      addLog("WARNING: min trades gate < 20 může dělat metriky nestabilní.");
    }

    const allFiles: Record<string, string> = {};
    for (const f of files) {
      const content =
        selectedFile === f.fileName
          ? fileContent
          : await getFileContent(strategyContext.type, strategyContext.id, f.fileName);
      if (content != null) allFiles[f.fileName] = content;
    }
    const toModuleName = (n: string) =>
      (n || "module").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_") || "module";

    for (const indId of appliedIndicatorIds) {
      const ind = indicators.find((i) => i.id === indId);
      if (!ind) continue;
      const content = await getFileContent("indicators", indId, "main.py");
      if (content != null) {
        allFiles[`indicators/${toModuleName(ind.name)}.py`] = content;
      }
    }
    for (const modId of moduleIdsForParamPanels) {
      const mod = modules.find((m) => m.id === modId);
      if (!mod) continue;
      const content = await getFileContent("modules", modId, "main.py");
      if (content != null) {
        allFiles[`modules/${toModuleName(mod.name)}.py`] = content;
      }
    }
    if (Object.keys(allFiles).length === 0) {
      addLog("Chyba: žádné soubory k spuštění");
      runLockRef.current = false;
      return;
    }

    // Aktuální PARAMS z main.py (včetně neuložených úprav v editoru); panel přepíše jen klíče, které uživatel změnil oproti načtení strategie.
    const mainContent = allFiles["main.py"];
    const parsedFromMain = mainContent ? parseStrategyParams(mainContent) : {};
    const baseline = strategyParamsBaselineRef.current;
    const runStrategyParams: StrategyParams = { ...parsedFromMain };
    for (const key of Object.keys(strategyParams)) {
      if (strategyParamTouchedFromBaseline(strategyParams[key], baseline[key])) {
        runStrategyParams[key] = strategyParams[key];
      }
    }
    const runParams = (() => {
      const flat: Record<string, number | boolean | string | Record<string, unknown>> = { ...runStrategyParams };
      const mods: Record<string, Record<string, number | boolean | string>> = {};
      for (const modId of moduleIdsForParamPanels) {
        const mod = modules.find((m) => m.id === modId);
        if (!mod) continue;
        const p = moduleParams[mod.name];
        if (p && Object.keys(p).length > 0) mods[mod.name] = p;
      }
      if (Object.keys(mods).length > 0) flat.module_params = mods;
      return Object.keys(flat).length > 0 ? flat : undefined;
    })();

    const controller = new AbortController();
    setAbortController(controller);
    setIsRunning(true);
    setRunProgress(0);
    addLog("Spouštím backtest...");

    try {
      const normalizeBranchId = (name: string): string => {
        const cleaned = (name || "main")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        return cleaned || "main";
      };
      const branchName = (edgeSettings.experimentBranch || "main").trim() || "main";
      const branchId = normalizeBranchId(branchName);
      const getRunBranchId = (r: SavedBacktestRun): string => {
        const exp = r.experiment && typeof r.experiment === "object" ? (r.experiment as Record<string, unknown>) : null;
        const id = exp?.branch_id ?? exp?.branchId;
        if (typeof id === "string" && id.trim()) return id.trim();
        return "main";
      };
      const branchRuns = runHistory.filter((r) => getRunBranchId(r) === branchId);
      const latestRun = branchRuns[0] ?? runHistory[0];
      const parentRunId =
        branchRuns[0]?.runId ??
        branchRuns[0]?.id ??
        null;
      const branchSeq = branchRuns.length + 1;

      const appliedModules = moduleIdsForParamPanels.reduce<
        { id: string; name: string; params?: Record<string, number | boolean | string> }[]
      >((acc, id) => {
        const mod = modules.find((m) => m.id === id);
        if (!mod) return acc;
        acc.push({
          id: mod.id,
          name: mod.name,
          params: moduleParams[mod.name],
        });
        return acc;
      }, []);

      const requestRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const baselineMetrics = latestRun?.metrics
        ? {
            finalEquity: Number(latestRun.metrics.finalEquity ?? 0),
            totalReturnUsd: Number(latestRun.metrics.totalReturnUsd ?? 0),
            maxDrawdownPct: Number(latestRun.metrics.maxDrawdownPct ?? latestRun.metrics.maxDrawdown ?? 0),
            profitFactor: (() => {
              const p = latestRun.metrics.profitFactor;
              if (p === null || p === undefined) return null;
              const n = Number(p);
              return Number.isFinite(n) ? n : null;
            })(),
            profitFactorStatus:
              typeof latestRun.metrics.profitFactorStatus === "string"
                ? latestRun.metrics.profitFactorStatus
                : undefined,
            winRate: Number(latestRun.metrics.winRate ?? 0),
            sortinoRatio: Number(latestRun.metrics.sortinoRatio ?? 0),
            calmarRatio: Number(latestRun.metrics.calmarRatio ?? 0),
            tradeCount: Number(latestRun.metrics.tradeCount ?? 0),
          }
        : undefined;
      const isPropRun = backtestSettingsPanel === "prop";
      if (isPropRun) {
        addLog("Prop firm backtest: single run + sekvenční simulace challenge na uzavřených obchodech.");
      }
      const oatWant = !isPropRun && oatSweep.enabled && Boolean(oatSweep.paramKey);
      const oatGridN =
        oatWant && oatSweep.step > 0
          ? (() => {
              const lo = Math.min(oatSweep.from, oatSweep.to);
              const hi = Math.max(oatSweep.from, oatSweep.to);
              const n = Math.floor((hi - lo) / oatSweep.step + 1e-9) + 1;
              return Number.isFinite(n) && n >= 1 ? n : 0;
            })()
          : 0;
      const useOatSweep = oatWant && oatGridN > 0;
      if (oatWant && !useOatSweep) {
        addLog(
          "WARNING: OAT sweep je zapnutý, ale konfigurace není platná (parametr, od/do, krok > 0). Použije se běh bez param_test.",
        );
      }
      if (useOatSweep) {
        addLog(`OAT sweep: ${oatGridN} hodnot parametru ${oatSweep.paramKey} v jednom runu (param_test).`);
      }
      const validationConfigPayload: RunRequest["validation_config"] = isPropRun
        ? undefined
        : useOatSweep
          ? {
              param_test: {
                max_runs: Math.min(500, Math.max(24, oatGridN)),
                param_ranges: {
                  [oatSweep.paramKey as string]: {
                    enabled: true,
                    min: Math.min(oatSweep.from, oatSweep.to),
                    max: Math.max(oatSweep.from, oatSweep.to),
                    step: oatSweep.step,
                  },
                },
              },
            }
          : edgeSettings.validationMode === "walk_forward"
            ? { folds: edgeSettings.wfFolds, test_ratio: edgeSettings.wfTestRatio }
            : undefined;
      const runRequest: RunRequest = {
        files: allFiles,
        instrument: selectedInstrument.instrument,
        timeframe: selectedInstrument.timeframe,
        years,
        data_file: selectedInstrument.file,
        initial_capital: isPropRun ? propFirmForm.accountSize : backtestParams.initialCapital,
        slippage_perc: backtestParams.slippagePerc,
        commission_perc: 0,
        instrument_type: "futures",
        tick_size: backtestParams.tickSize,
        value_per_tick: backtestParams.valuePerTick,
        run_timeout_sec: RUN_TIMEOUT_SEC_DEFAULT,
        params: runParams,
        applied_modules: appliedModules.length > 0 ? appliedModules : undefined,
        run_id: requestRunId,
        validation_mode: isPropRun ? "single" : useOatSweep ? "param_test" : edgeSettings.validationMode,
        validation_config: validationConfigPayload,
        quality_gates: {
          min_trades: edgeSettings.minTradesGate,
          max_dd: edgeSettings.maxDdGate,
          min_pf: edgeSettings.minPfGate,
        },
        sweep_mode:
          isPropRun || useOatSweep || edgeSettings.sweepMode === "none" ? undefined : edgeSettings.sweepMode,
        sweep_config:
          isPropRun || useOatSweep || edgeSettings.sweepMode === "none"
            ? undefined
            : {
                max_samples: edgeSettings.sweepSamples,
              },
        regime_config: edgeSettings.perRegimeSegmentation
          ? {
              enabled: true,
              ema_fast: 50,
              ema_slow: 200,
              atr_period: 14,
            }
          : undefined,
        execution_model: {
          commission_mode: "per_contract",
          commission_per_contract: backtestParams.commissionPerContract,
          ...(edgeSettings.executionEnabled
            ? {
                enabled: true,
                spread_bps: edgeSettings.spreadBps,
                slippage_vol_mult: edgeSettings.slippageVolMult,
                latency_bars: edgeSettings.latencyBars,
                stress_multiplier: edgeSettings.stressMultiplier > 1.0 ? edgeSettings.stressMultiplier : undefined,
                forward_bridge: edgeSettings.forwardBridgeEnabled
                  ? {
                      mode: edgeSettings.forwardBridgeMode,
                      baseline_final_equity: edgeSettings.forwardBridgeBaselineEquity,
                    }
                  : undefined,
              }
            : {}),
        },
        experiment: {
          hypothesis: edgeSettings.experimentHypothesis || strategyContext.name,
          tags: edgeSettings.experimentTagsCsv
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x.length > 0),
          baseline: "latest",
          baseline_run_id: latestRun?.runId ?? null,
          baseline_metrics: baselineMetrics,
          branch_name: branchName,
          branch_id: branchId,
          parent_run_id: parentRunId,
          branch_seq: branchSeq,
          promote_on_pass: edgeSettings.promoteOnPass,
          seed: (() => {
            if (edgeSettings.runFixedSeedEnabled) {
              const v = Math.floor(Number(edgeSettings.runFixedSeedValue));
              if (!Number.isFinite(v)) return 42;
              const m = 1_000_000_000;
              return ((v % m) + m) % m;
            }
            return Math.floor(Date.now() % 1_000_000_000);
          })(),
          lifecycleStatus: "draft",
          reviewerApproved: false,
          approvalRequired: true,
        },
        prop_firm_backtest: isPropRun ? buildPropFirmBacktestRequestPayload(propFirmForm) : undefined,
      };
      const data = await runBacktestStreaming(
        runRequest,
        controller.signal,
        (ev) => {
          if (ev.type === "log") {
            addLog(ev.line);
          } else if (ev.type === "progress") {
            setRunProgress(ev.value);
          }
        }
      );
      setRunProgress(100);
      setResults(data);
      setShowResults(true);
      addLog(`Hotovo. ${data.metrics.tradeCount} obchodů, equity: ${data.metrics.finalEquity.toFixed(2)}`);
      if (isPropRun && data.propFirmBacktest && typeof data.propFirmBacktest === "object") {
        const pf = data.propFirmBacktest as Record<string, unknown>;
        const s = pf.summary as Record<string, unknown> | undefined;
        if (s && !pf.error && !pf.skipped) {
          addLog(
            `Prop firm: pass rate ${s.evaluationPassRate != null ? (Number(s.evaluationPassRate) * 100).toFixed(1) : "?"} % (` +
              `${String(s.evaluationPassed ?? 0)} pass / ${String(s.evaluationFailed ?? 0)} fail).`,
          );
        }
      }
      const bs = data.batchSummary;
      if (bs && typeof bs === "object" && Number((bs as { runCount?: number }).runCount) > 1) {
        addLog(
          `Dávka instrumentů: ${(bs as { runCount?: number }).runCount} runů — souhrn řádků je v Analytics (batchSummary).`,
        );
      }
      if (strategyContext) {
        const payload = buildBacktestSavePayload(data, runRequest);
        try {
          await saveBacktestResult(strategyContext.id, strategyContext.name, payload);
          const history = await listBacktestResults(strategyContext.id);
          // Vždy aktualizovat historii po uložení (dřívější podmínka openItem?.id často zablokovala UI).
          setRunHistory(history);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          addLog(`Uložení výsledků selhalo: ${msg}`);
          if (msg.includes("permission") || msg.includes("Permission")) {
            addLog("→ Zkontrolujte Firestore pravidla (viz README nebo firestore.rules)");
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        addLog("Zastaveno uživatelem");
      } else {
        const msg =
          e instanceof Error
            ? e.message || e.name || "Neznámá chyba"
            : String(e) || "Neznámá chyba";
        addLog(`Chyba: ${msg}`);
        console.error("Backtest error:", e);
      }
      setResults(null);
    } finally {
      runLockRef.current = false;
      setIsRunning(false);
      setRunProgress(0);
      setAbortController(null);
    }
  };

  const handleStopRun = () => {
    abortController?.abort();
  };

  const getExportPayload = () => (results ? buildBacktestSavePayload(results) : null);

  const handleExport = () => {
    const payload = getExportPayload();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadRunHistory = useCallback(async () => {
    if (openItem?.type !== "strategies") {
      setRunHistory([]);
      return;
    }
    try {
      const history = await listBacktestResults(openItem.id);
      setRunHistory(history);
    } catch (e) {
      console.warn("Run history load failed:", e);
      setRunHistory([]);
    }
  }, [openItem?.type, openItem?.id]);

  useEffect(() => {
    if (openItem?.type === "strategies") {
      loadRunHistory();
      return;
    }
    setRunHistory([]);
  }, [openItem?.type, openItem?.id, loadRunHistory]);

  useEffect(() => {
    if (workspaceTab === "monteCarlo" && openItem?.type === "strategies") {
      loadRunHistory();
    }
  }, [workspaceTab, openItem?.type, openItem?.id, loadRunHistory]);

  useEffect(() => {
    if (workspaceTab === "regime" && openItem?.type === "strategies") {
      loadRunHistory();
    }
  }, [workspaceTab, openItem?.type, openItem?.id, loadRunHistory]);

  useEffect(() => {
    if (showResults && openItem?.type === "strategies") {
      loadRunHistory();
    }
  }, [showResults, openItem?.type, openItem?.id, loadRunHistory]);

  const handleDeleteRun = async (resultId: string) => {
    if (!openItem) return;
    try {
      await deleteBacktestResult(openItem.id, resultId);
      await loadRunHistory();
    } catch (e) {
      addLog(`Chyba mazání: ${(e as Error).message}`);
    }
  };

  const handleDeleteAllRuns = async () => {
    if (!openItem) return;
    try {
      await deleteAllBacktestResults(openItem.id);
      setRunHistory([]);
    } catch (e) {
      addLog(`Chyba mazání: ${(e as Error).message}`);
    }
  };

  const handleUpdateRunLifecycle = async (runDocId: string, patch: Record<string, unknown>) => {
    if (!openItem) return;
    try {
      await updateBacktestRunGovernance(openItem.id, runDocId, patch);
      await loadRunHistory();
    } catch (e) {
      addLog(`Chyba governance update: ${(e as Error).message}`);
    }
  };

  const showLeftColumn = true;
  const showRightSettingsPanel = workspaceTab === "backtest";

  const centerContent =
    workspaceTab === "monteCarlo" ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MonteCarloWorkspace
          runs={runHistory}
          strategyOpen={openItem?.type === "strategies"}
          strategyName={openItem?.type === "strategies" ? openItem.name : undefined}
        />
      </div>
    ) : workspaceTab === "regime" ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <RegimeAnalysisWorkspace
          runs={runHistory}
          liveResults={results}
          strategyOpen={openItem?.type === "strategies"}
          strategyName={openItem?.type === "strategies" ? openItem.name : undefined}
        />
      </div>
    ) : workspaceTab === "view" ? (
      <div className="h-full overflow-auto p-4">
        <StrategyViewChart
          instruments={instruments}
          modules={modulesForViewChart}
          indicators={indicators}
          strategies={strategiesForView}
          defaultDataFile={selectedInstrument?.file}
          strategyZoneSyncCode={openItem?.type === "strategies" ? fileContent : null}
          initialItemId={
            selectedFile?.startsWith("module:")
              ? selectedFile.replace("module:", "")
              : selectedFile?.startsWith("indicator:")
                ? selectedFile.replace("indicator:", "")
                : openItem?.type === "strategies" && openItem?.id
                  ? openItem.id
                  : openItem?.type === "modules" && openItem?.id
                    ? openItem.id
                    : openItem?.type === "indicators" && openItem?.id
                      ? openItem.id
                      : undefined
          }
          initialItemType={
            selectedFile?.startsWith("module:")
              ? "module"
              : selectedFile?.startsWith("indicator:")
                ? "indicator"
                : openItem?.type === "strategies"
                  ? "strategy"
                  : openItem?.type === "modules"
                    ? "module"
                    : openItem?.type === "indicators"
                      ? "indicator"
                      : undefined
          }
          height={700}
        />
      </div>
    ) : workspaceTab === "backtest" && showResults ? (
      <ResultsView
        results={results}
        runHistory={runHistory}
        strategyId={openItem?.id ?? ""}
        onBack={() => setShowResults(false)}
        onExport={handleExport}
        onDeleteRun={handleDeleteRun}
        onDeleteAllRuns={handleDeleteAllRuns}
        onUpdateLifecycle={handleUpdateRunLifecycle}
        strategyName={openItem?.name}
        strategyMainPy={fileContent}
      />
    ) : workspaceTab === "backtest" ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2">
          {openItem && selectedFile && (
            <>
              <button
                onClick={handleSaveFile}
                disabled={fileContent === lastSavedContent || isSaving}
                className={`rounded-lg px-4 py-2 text-sm ${
                  fileContent === lastSavedContent && !isSaving
                    ? "cursor-default bg-zinc-800 text-zinc-500"
                    : "bg-zinc-700 hover:bg-zinc-600"
                }`}
              >
                {isSaving ? "Ukládám…" : fileContent === lastSavedContent ? "Uloženo" : "Uložit"}
              </button>
              <span className="text-sm text-zinc-500">
                {selectedFile.startsWith("indicator:")
                  ? `📊 ${indicators.find((i) => i.id === selectedFile.replace("indicator:", ""))?.name ?? selectedFile}`
                  : selectedFile.startsWith("module:")
                    ? `📦 ${modulesForViewChart.find((m) => m.id === selectedFile.replace("module:", ""))?.name ?? selectedFile}`
                    : selectedFile}
              </span>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {openItem && selectedFile ? (
            <StrategyEditor value={fileContent} onChange={setFileContent} />
          ) : (
            <div className="flex h-full flex-1 items-center justify-center bg-zinc-950 p-8">
              <img
                src="/assets/stonks.webp"
                alt="Backtesting"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex h-screen overflow-hidden">
      {isCreateModalOpen && createModalType && (
        <CreateModal
          type={createModalType}
          onClose={() => {
            setIsCreateModalOpen(false);
            setCreateModalType(null);
          }}
          onCreate={handleCreateItem}
        />
      )}
      {isAddFileModalOpen && openItem && (
        <AddFileModal
          onClose={() => setIsAddFileModalOpen(false)}
          onCreate={handleAddFile}
          existingFiles={files.map((f) => f.fileName)}
        />
      )}
      {showLeftColumn && (
        <>
          <div
            className={`shrink-0 overflow-hidden border-r border-zinc-800 transition-[width] duration-200 ease-out ${
              leftNavOpen ? "w-64" : "w-0"
            }`}
          >
            <Sidebar
              openItem={openItem}
              itemsByType={sidebarLists}
              expandedSections={expandedSidebar}
              onToggleSection={toggleSidebarSection}
              onCreateForType={openCreateModalForType}
              files={files}
              onSelectItem={handleSelectItem}
              onAddFileClick={() => setIsAddFileModalOpen(true)}
              onBack={handleBack}
              onSelectFile={(f) => {
                setSelectedFile(f);
                setShowResults(false);
              }}
              onSelectImported={(key) => {
                setSelectedFile(key);
                setShowResults(false);
              }}
              appliedIndicators={indicators.filter((i) => appliedIndicatorIds.includes(i.id))}
              appliedModules={modules.filter((m) => appliedModuleIds.includes(m.id))}
              selectedFile={selectedFile}
            />
          </div>
          <button
            type="button"
            onClick={() => setLeftNavOpen((v) => !v)}
            className="shrink-0 w-7 flex flex-col justify-center items-center border-r border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800/90 text-zinc-500 hover:text-zinc-300 text-xs font-mono transition-colors"
            title={leftNavOpen ? "Skrýt levé menu" : "Zobrazit levé menu"}
            aria-expanded={leftNavOpen}
            aria-label={leftNavOpen ? "Skrýt levé menu" : "Zobrazit levé menu"}
          >
            {leftNavOpen ? "◄" : "►"}
          </button>
        </>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <nav
          className="pointer-events-none absolute left-1/2 top-3 z-50 flex w-full max-w-3xl -translate-x-1/2 justify-center px-2"
          aria-label="Režim aplikace"
        >
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-0.5 rounded-2xl border border-zinc-600/80 bg-zinc-900/95 px-1.5 py-1.5 shadow-xl shadow-black/40 backdrop-blur sm:gap-1">
            {WORKSPACE_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setWorkspaceTab(id)}
                className={`whitespace-nowrap rounded-xl px-2.5 py-1.5 text-[11px] font-medium sm:px-3 sm:text-xs ${
                  workspaceTab === id
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
        <div className="flex min-h-0 flex-1 flex-col pt-14">
          <div className="flex min-h-0 flex-1">
            <div
              className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${
                showRightSettingsPanel ? "border-r border-zinc-800" : ""
              }`}
            >
              {isRunning && (
                <LoadingOverlay
                  progress={runProgress > 0 ? runProgress : 0}
                  message={runProgress > 0 ? `Běží ${runProgress}%` : "Spouštím backtest..."}
                  onStop={handleStopRun}
                />
              )}
              {centerContent}
            </div>
            {showRightSettingsPanel && (
              <>
                <button
                  type="button"
                  onClick={() => setRightPanelOpen((v) => !v)}
                  className="shrink-0 w-7 flex flex-col justify-center items-center border-l border-zinc-800 bg-zinc-900/80 text-xs font-mono text-zinc-500 transition-colors hover:bg-zinc-800/90 hover:text-zinc-300"
                  title={rightPanelOpen ? "Skrýt nastavení backtestu" : "Zobrazit nastavení backtestu"}
                  aria-expanded={rightPanelOpen}
                  aria-label={rightPanelOpen ? "Skrýt pravý panel" : "Zobrazit pravý panel"}
                >
                  {rightPanelOpen ? "►" : "◄"}
                </button>
                <div
                  className={`flex shrink-0 flex-col overflow-hidden bg-zinc-900/50 transition-[width] duration-200 ease-out ${
                    rightPanelOpen ? "w-96 border-l border-zinc-800" : "w-0 border-l-0"
                  }`}
                >
                  <div className="flex h-full w-96 min-h-0 flex-col gap-3 overflow-y-auto p-4">
                    <BacktestSettings
                      instruments={filteredInstruments}
                      instrumentsLoaded={instrumentsLoaded}
                      dataLoadError={dataLoadError}
                      selectedInstrument={selectedInstrument}
                      selectedInstrumentFiles={selectedInstrumentFiles}
                      onToggleInstrumentFile={toggleInstrumentFile}
                      onSelectAllInstrumentsInList={selectAllInstrumentFiles}
                      years={years}
                      onYearsChange={(y) =>
                        setYears(Math.max(MIN_BACKTEST_YEARS, Math.min(y, minYearsAcrossSelected)))
                      }
                      params={backtestParams}
                      onParamsChange={(p) => setBacktestParams((prev) => ({ ...prev, ...p }))}
                      indicators={indicators}
                      selectedIndicatorIds={selectedIndicatorIds}
                      onSelectIndicators={setSelectedIndicatorIds}
                      modules={modules}
                      selectedModuleIds={selectedModuleIds}
                      onSelectModules={setSelectedModuleIds}
                      onConfirmSelection={handleConfirmSelection}
                      onRun={handleRun}
                      isRunning={isRunning}
                      canRun={openItem?.type === "strategies"}
                      savedRunsCount={runHistory.length}
                      onDeleteSavedBacktests={handleDeleteAllRuns}
                      strategyParams={strategyParams}
                      strategyParamMeta={strategyParamMeta}
                      onStrategyParamsChange={setStrategyParams}
                      moduleParams={moduleParams}
                      moduleParamMeta={moduleParamMeta}
                      onModuleParamsChange={(name, params) =>
                        setModuleParams((prev) => ({ ...prev, [name]: params }))
                      }
                      moduleParamPanels={moduleParamPanels}
                      indicatorParams={indicatorParams}
                      indicatorParamMeta={indicatorParamMeta}
                      onIndicatorParamsChange={(name, params) =>
                        setIndicatorParams((prev) => ({ ...prev, [name]: params }))
                      }
                      indicatorNamesForParams={appliedIndicatorIds
                        .map((id) => indicators.find((i) => i.id === id)?.name)
                        .filter((n): n is string => !!n)}
                      edgeSettings={edgeSettings}
                      onEdgeSettingsChange={setEdgeSettings}
                      oatSweep={oatSweep}
                      onOatSweepChange={setOatSweep}
                      backtestPanel={backtestSettingsPanel}
                      onBacktestPanelChange={setBacktestSettingsPanel}
                      propFirmForm={propFirmForm}
                      onPropFirmFormChange={setPropFirmForm}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <Link
        href="/guide"
        className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 flex items-center justify-center text-zinc-300 hover:text-white shadow-lg transition-colors z-40"
        aria-label="Průvodce aplikací"
        title="Otevřít průvodce aplikací"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
        </svg>
      </Link>
    </div>
  );
}
