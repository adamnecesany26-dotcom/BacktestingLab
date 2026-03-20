"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { StrategyEditor } from "@/components/editor/StrategyEditor";
import { CreateModal } from "@/components/CreateModal";
import { AddFileModal } from "@/components/AddFileModal";
import { BacktestSettings } from "@/components/BacktestSettings";
import type { EdgeFindingSettings } from "@/components/BacktestSettings";
import { ResultsView } from "@/components/results/ResultsView";
import { StrategyViewChart } from "@/components/StrategyViewChart";
import { LogPanel } from "@/components/LogPanel";
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
import { runBacktestStreaming, getAvailableData } from "@/lib/api";
import {
  parseStrategyParams,
  parseStrategyParamBundle,
  parseViewParamBundle,
  parseStrategyImportDependencies,
  normalizePythonModuleToken,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";
import {
  filterInstrumentsByType,
  type RunRequest,
  type RunResponse,
  type DataInstrument,
  type InstrumentType,
} from "@shared/types";

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

export default function Home() {
  const runLockRef = useRef(false);
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
  const [selectedInstrument, setSelectedInstrument] = useState<DataInstrument | null>(null);
  const [indicators, setIndicators] = useState<FirestoreItem[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [appliedIndicatorIds, setAppliedIndicatorIds] = useState<string[]>([]);
  const [modules, setModules] = useState<FirestoreItem[]>([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [appliedModuleIds, setAppliedModuleIds] = useState<string[]>([]);
  const [years, setYears] = useState(1);
  const [backtestParams, setBacktestParams] = useState<{
    initialCapital: number;
    slippagePerc: number;
    commissionPerc: number;
    instrumentType: InstrumentType;
    tickSize?: number;
    valuePerTick?: number;
    shareSize?: number;
    lotSize?: number;
    pipSize?: number;
    pipValue?: number;
  }>({
    initialCapital: 100000,
    slippagePerc: 0.001,
    commissionPerc: 0.0,
    instrumentType: "futures",
    tickSize: 0.25,
    valuePerTick: 5,
    shareSize: 100,
    lotSize: 1,
    pipSize: 0.0001,
    pipValue: 10,
  });

  const [strategyParams, setStrategyParams] = useState<StrategyParams>({});
  const [strategyParamMeta, setStrategyParamMeta] = useState<StrategyParamsMeta>({});
  const [moduleParams, setModuleParams] = useState<Record<string, StrategyParams>>({});
  const [moduleParamMeta, setModuleParamMeta] = useState<Record<string, StrategyParamsMeta>>({});
  const [edgeSettings, setEdgeSettings] = useState<EdgeFindingSettings>({
    validationMode: "single",
    oosRatio: 0.25,
    wfFolds: 4,
    wfTestRatio: 0.2,
    minTradesGate: 30,
    maxDdGate: 25,
    minPfGate: 1.2,
    sweepMode: "none",
    sweepSamples: 24,
    monteCarloEnabled: false,
    monteCarloSims: 300,
    regimeEnabled: false,
    portfolioEnabled: false,
    portfolioInstrumentsJson:
      '[{"instrument":"NQ","timeframe":"1d","years":1,"weight":1},{"instrument":"ES","timeframe":"1d","years":1,"weight":1}]',
    executionEnabled: false,
    spreadBps: 0.5,
    slippageVolMult: 1.0,
    latencyBars: 0,
    forwardBridgeEnabled: false,
    forwardBridgeMode: "paper_shadow",
    forwardBridgeBaselineEquity: 100000,
    experimentHypothesis: "sd-edge-hypothesis",
    experimentTagsCsv: "manual-run",
    experimentBranch: "main",
    promoteOnPass: false,
    runFixedSeedEnabled: false,
    runFixedSeedValue: 42,
    monteCarloMode: "iid_trade",
    batchEnabled: false,
    batchMaxRuns: 8,
    batchItemsJson: '[{"instrument":"NQ","data_file":"mock/NQ_5Y.csv","timeframe":"1d"}]',
  });
  const [results, setResults] = useState<RunResponse | null>(null);
  const [runHistory, setRunHistory] = useState<SavedBacktestRun[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [strategiesForView, setStrategiesForView] = useState<FirestoreItem[]>([]);
  const [autoDetectedForStrategy, setAutoDetectedForStrategy] = useState<string | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

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
    if (viewMode) {
      listItems("strategies").then(setStrategiesForView);
    }
  }, [viewMode]);

  useEffect(() => {
    if (openItem?.type === "strategies") {
      listItems("indicators").then(setIndicators);
      listItems("modules").then(setModules);
    } else if (viewMode) {
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
  }, [openItem?.type, openItem?.id, viewMode]);

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
      setStrategyParams({});
      setStrategyParamMeta({});
      setAutoDetectedForStrategy(null);
      return;
    }
    getFileContent(openItem.type, openItem.id, "main.py").then((c) => {
      const bundle = parseStrategyParamBundle(c ?? "");
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

  /** Load VIEW_PARAMS for applied modules */
  useEffect(() => {
    if (!openItem || openItem.type !== "strategies" || appliedModuleIds.length === 0) {
      setModuleParams({});
      setModuleParamMeta({});
      return;
    }
    const load = async () => {
      const next: Record<string, StrategyParams> = {};
      const nextMeta: Record<string, StrategyParamsMeta> = {};
      for (const modId of appliedModuleIds) {
        const mod = modules.find((m) => m.id === modId);
        if (!mod) continue;
        const content = await getFileContent("modules", modId, "main.py");
        const bundle = parseViewParamBundle(content ?? "");
        if (Object.keys(bundle.params).length > 0) {
          next[mod.name] = bundle.params;
        }
        if (Object.keys(bundle.meta).length > 0) {
          nextMeta[mod.name] = bundle.meta;
        }
      }
      setModuleParams(next);
      setModuleParamMeta(nextMeta);
    };
    load();
  }, [openItem?.type, openItem?.id, appliedModuleIds, modules]);

  useEffect(() => {
    if (
      openItem?.type !== "strategies" ||
      !openItem?.id ||
      autoDetectedForStrategy === openItem.id ||
      (indicators.length === 0 && modules.length === 0)
    ) {
      return;
    }

    const toModuleName = (n: string) =>
      normalizePythonModuleToken((n || "module").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_"));

    const detect = async () => {
      const code =
        selectedFile === "main.py" && fileContent
          ? fileContent
          : (await getFileContent("strategies", openItem.id, "main.py")) ?? "";
      const deps = parseStrategyImportDependencies(code);
      const detectedIndicatorIds = indicators
        .filter((ind) => deps.indicators.includes(toModuleName(ind.name)))
        .map((ind) => ind.id);
      const detectedModuleIds = modules
        .filter((mod) => deps.modules.includes(toModuleName(mod.name)))
        .map((mod) => mod.id);

      setSelectedIndicatorIds((prev) => Array.from(new Set([...detectedIndicatorIds, ...prev])));
      setSelectedModuleIds((prev) => Array.from(new Set([...detectedModuleIds, ...prev])));
      setAutoDetectedForStrategy(openItem.id);
      if (detectedIndicatorIds.length > 0 || detectedModuleIds.length > 0) {
        addLog(
          `Auto-detect importů: ${detectedIndicatorIds.length} indikátorů, ${detectedModuleIds.length} modulů. Pro run je ještě potvrďte.`
        );
      }
    };
    detect();
  }, [
    openItem?.type,
    openItem?.id,
    autoDetectedForStrategy,
    indicators,
    modules,
    selectedFile,
    fileContent,
    addLog,
  ]);

  const applyInstrumentSelection = useCallback((inv: DataInstrument) => {
    setSelectedInstrument(inv);
    setYears((y) => Math.min(y, inv.yearsAvailable));
    if (backtestParams.instrumentType === "futures" && inv.brokerConfig) {
      setBacktestParams((prev) => ({
        ...prev,
        tickSize: inv.brokerConfig?.tick_size ?? prev.tickSize,
        valuePerTick: inv.brokerConfig?.tick_value ?? prev.valuePerTick,
      }));
    }
  }, [backtestParams.instrumentType]);

  useEffect(() => {
    getAvailableData()
      .then((d) => {
        setInstruments(d.instruments);
        setInstrumentsLoaded(true);
        setDataLoadError(null);
        if (d.instruments.length > 0 && !selectedInstrument) {
          const inv = d.instruments[0];
          applyInstrumentSelection(inv);
          setYears(Math.min(1, inv.yearsAvailable));
        }
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
    for (const modId of appliedModuleIds) {
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
  }, [strategyParams, appliedModuleIds, modules, moduleParams]);

  const handleSelectInstrument = (inv: DataInstrument) => {
    applyInstrumentSelection(inv);
  };

  /** Instruments filtered by selected instrument type */
  const filteredInstruments = useMemo(
    () => filterInstrumentsByType(instruments, backtestParams.instrumentType),
    [instruments, backtestParams.instrumentType]
  );

  /** Reset selection when current instrument is not in filtered list (e.g. switched Futures → Stocks) */
  useEffect(() => {
    if (!selectedInstrument) return;
    const isInFiltered = filteredInstruments.some(
      (i) => i.file === selectedInstrument.file && i.instrument === selectedInstrument.instrument
    );
    if (!isInFiltered) {
      const next = filteredInstruments[0] ?? null;
      setSelectedInstrument(next);
      if (filteredInstruments[0]) {
        if (backtestParams.instrumentType === "futures" && filteredInstruments[0].brokerConfig) {
          setBacktestParams((prev) => ({
            ...prev,
            tickSize: filteredInstruments[0].brokerConfig?.tick_size ?? prev.tickSize,
            valuePerTick: filteredInstruments[0].brokerConfig?.tick_value ?? prev.valuePerTick,
          }));
        }
        setYears((y) => Math.min(y, filteredInstruments[0].yearsAvailable));
      }
    }
  }, [filteredInstruments, backtestParams.instrumentType, selectedInstrument]);

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
    if (edgeSettings.validationMode === "single") {
      addLog("WARNING: běžíte pouze single run. Pro první edge doporučeno OOS split nebo walk-forward.");
    }
    if (edgeSettings.sweepMode !== "none" && edgeSettings.validationMode === "single") {
      addLog("WARNING: sweep bez OOS/WF může vést k overfittingu.");
    }
    if (edgeSettings.minTradesGate < 20) {
      addLog("WARNING: min trades gate < 20 může dělat metriky nestabilní.");
    }
    if (!edgeSettings.monteCarloEnabled) {
      addLog("TIP: zapněte Monte Carlo pro odhad tail-risk/risk of ruin.");
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
    for (const modId of appliedModuleIds) {
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

    // Params z aktuálního main.py (ne z cache) – odpovídá kódu, který posíláme
    const mainContent = allFiles["main.py"];
    const runStrategyParams = mainContent ? parseStrategyParams(mainContent) : strategyParams;
    const runParams = (() => {
      const flat: Record<string, number | boolean | string | Record<string, unknown>> = { ...runStrategyParams };
      const mods: Record<string, Record<string, number | boolean | string>> = {};
      for (const modId of appliedModuleIds) {
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
    setLogs([]);
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

      const appliedModules = appliedModuleIds.reduce<
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
            profitFactor: Number(latestRun.metrics.profitFactor ?? 0),
            winRate: Number(latestRun.metrics.winRate ?? 0),
            sortinoRatio: Number(latestRun.metrics.sortinoRatio ?? 0),
            calmarRatio: Number(latestRun.metrics.calmarRatio ?? 0),
            tradeCount: Number(latestRun.metrics.tradeCount ?? 0),
          }
        : undefined;
      let portfolioConfig: Record<string, unknown> | undefined = undefined;
      if (edgeSettings.portfolioEnabled) {
        try {
          const parsed = JSON.parse(edgeSettings.portfolioInstrumentsJson);
          if (!Array.isArray(parsed) || parsed.length < 2) {
            addLog("Portfolio config musí být JSON pole alespoň se 2 instrumenty.");
            runLockRef.current = false;
            return;
          }
          portfolioConfig = { instruments: parsed };
        } catch {
          addLog("Portfolio JSON je neplatný. Oprav formát v Edge finding sekci.");
          runLockRef.current = false;
          return;
        }
      }
      let batchConfig: Record<string, unknown> | undefined = undefined;
      if (edgeSettings.batchEnabled) {
        if (edgeSettings.portfolioEnabled) {
          addLog("Batch run nelze kombinovat s portfolio režimem — vypni jedno z nich.");
          runLockRef.current = false;
          return;
        }
        try {
          const items = JSON.parse(edgeSettings.batchItemsJson) as unknown;
          if (!Array.isArray(items) || items.length === 0) {
            throw new Error("empty");
          }
          batchConfig = {
            max_runs: Math.min(48, Math.max(1, edgeSettings.batchMaxRuns)),
            items,
          };
        } catch {
          addLog("Batch items JSON je neplatný. Očekává se pole objektů s poli jako instrument, data_file, …");
          runLockRef.current = false;
          return;
        }
      }
      const runRequest: RunRequest = {
        files: allFiles,
        instrument: selectedInstrument.instrument,
        timeframe: selectedInstrument.timeframe,
        years,
        data_file: selectedInstrument.file,
        initial_capital: backtestParams.initialCapital,
        slippage_perc: backtestParams.slippagePerc,
        commission_perc: backtestParams.commissionPerc,
        instrument_type: backtestParams.instrumentType,
        tick_size: backtestParams.tickSize,
        value_per_tick: backtestParams.valuePerTick,
        share_size: backtestParams.shareSize,
        lot_size: backtestParams.lotSize,
        pip_size: backtestParams.pipSize,
        pip_value: backtestParams.pipValue,
        params: runParams,
        applied_modules: appliedModules.length > 0 ? appliedModules : undefined,
        run_id: requestRunId,
        validation_mode: edgeSettings.validationMode,
        validation_config:
          edgeSettings.validationMode === "oos_split"
            ? { oos_ratio: edgeSettings.oosRatio }
            : edgeSettings.validationMode === "walk_forward"
              ? { folds: edgeSettings.wfFolds, test_ratio: edgeSettings.wfTestRatio }
              : undefined,
        quality_gates: {
          min_trades: edgeSettings.minTradesGate,
          max_dd: edgeSettings.maxDdGate,
          min_pf: edgeSettings.minPfGate,
        },
        sweep_mode: edgeSettings.sweepMode === "none" ? undefined : edgeSettings.sweepMode,
        sweep_config:
          edgeSettings.sweepMode === "none"
            ? undefined
            : {
                max_samples: edgeSettings.sweepSamples,
              },
        monte_carlo: edgeSettings.monteCarloEnabled
          ? {
              simulations: edgeSettings.monteCarloSims,
              ruin_dd_pct: 50,
            }
          : undefined,
        regime_config: edgeSettings.regimeEnabled ? { enabled: true } : undefined,
        portfolio_config: portfolioConfig,
        execution_model: edgeSettings.executionEnabled
          ? {
              enabled: true,
              spread_bps: edgeSettings.spreadBps,
              slippage_vol_mult: edgeSettings.slippageVolMult,
              latency_bars: edgeSettings.latencyBars,
              forward_bridge: edgeSettings.forwardBridgeEnabled
                ? {
                    mode: edgeSettings.forwardBridgeMode,
                    baseline_final_equity: edgeSettings.forwardBridgeBaselineEquity,
                  }
                : undefined,
            }
          : undefined,
        batch_config: batchConfig,
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
      if (strategyContext) {
        const payload = buildSavePayload(data, runRequest);
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

  function buildSavePayload(data: RunResponse, request?: RunRequest) {
    let equityCurve = data.equityCurve;
    if (!equityCurve?.length && data.equity?.length && data.ohlc?.length) {
      const first = data.ohlc[0]?.date;
      const d = first ? new Date(first) : null;
      if (d) d.setDate(d.getDate() - 1);
      const dayBefore = d?.toISOString() ?? "0";
      equityCurve = [
        { date: dayBefore, value: data.equity[0] ?? 0 },
        ...data.ohlc.map((o, i) => ({ date: o.date, value: data.equity![i + 1] ?? 0 })),
      ];
    } else if (!equityCurve?.length && data.equity?.length) {
      equityCurve = data.equity.map((v, i) => ({ date: String(i), value: v }));
    }
    return {
      runId: data.runId ?? null,
      manifest: {
        ...(data.manifest ?? {}),
        request: request ?? null,
      },
      equityCurve: equityCurve ?? [],
      metrics: data.metrics,
      trades: data.trades,
      validation: data.validation ?? null,
      robustness: data.robustness ?? null,
      monteCarlo: data.monteCarlo ?? null,
      regimeAnalysis: data.regimeAnalysis ?? null,
      portfolio: data.portfolio ?? null,
      executionSummary: data.executionSummary ?? null,
      qualityGate: data.qualityGate ?? null,
      experiment: data.experiment ?? null,
      batchSummary: data.batchSummary ?? null,
      methodologyNotes: (data.manifest?.methodology as Record<string, string> | undefined) ?? null,
    };
  }

  const getExportPayload = () => (results ? buildSavePayload(results) : null);

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

  const centerContent = showResults ? (
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
  ) : (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        {openItem && selectedFile && (
          <>
            <button
              onClick={handleSaveFile}
              disabled={fileContent === lastSavedContent || isSaving}
              className={`px-4 py-2 rounded-lg text-sm ${
                fileContent === lastSavedContent && !isSaving
                  ? "bg-zinc-800 text-zinc-500 cursor-default"
                  : "bg-zinc-700 hover:bg-zinc-600"
              }`}
            >
              {isSaving ? "Ukládám…" : fileContent === lastSavedContent ? "Uloženo" : "Uložit"}
            </button>
            <button
              onClick={() => setViewMode((v) => !v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                viewMode ? "bg-emerald-600 text-white" : "bg-zinc-700 hover:bg-zinc-600"
              }`}
            >
              View
            </button>
            <span className="text-sm text-zinc-500">
              {selectedFile.startsWith("indicator:")
                ? `📊 ${indicators.find((i) => i.id === selectedFile.replace("indicator:", ""))?.name ?? selectedFile}`
                : selectedFile.startsWith("module:")
                  ? `📦 ${modules.find((m) => m.id === selectedFile.replace("module:", ""))?.name ?? selectedFile}`
                  : selectedFile}
            </span>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {viewMode ? (
          <div className="h-full p-4 overflow-auto">
            <StrategyViewChart
              instruments={instruments}
              modules={modules}
              indicators={indicators}
              strategies={strategiesForView}
              defaultDataFile={selectedInstrument?.file ?? "mock/NQ_5Y.csv"}
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
        ) : openItem && selectedFile ? (
          <StrategyEditor value={fileContent} onChange={setFileContent} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-zinc-950 p-8">
            <img
              src="/assets/stonks.webp"
              alt="Backtesting"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        )}
      </div>
    </div>
  );

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
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800 relative">
            {isRunning && (
              <LoadingOverlay
                progress={runProgress}
                message={runProgress > 0 ? `Běží ${runProgress}%` : "Spouštím backtest..."}
                onStop={handleStopRun}
              />
            )}
            {centerContent}
          </div>
          <div className="w-96 flex flex-col min-h-0 overflow-y-auto bg-zinc-900/50 p-4">
            <BacktestSettings
              instruments={filteredInstruments}
              instrumentsLoaded={instrumentsLoaded}
              dataLoadError={dataLoadError}
              selectedInstrument={selectedInstrument}
              onSelectInstrument={handleSelectInstrument}
              years={years}
              onYearsChange={(y) => setYears(Math.max(1, Math.min(y, selectedInstrument?.yearsAvailable ?? 5)))}
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
              strategyParams={strategyParams}
              strategyParamMeta={strategyParamMeta}
              onStrategyParamsChange={setStrategyParams}
              moduleParams={moduleParams}
              moduleParamMeta={moduleParamMeta}
              onModuleParamsChange={(name, params) =>
                setModuleParams((prev) => ({ ...prev, [name]: params }))
              }
              moduleNamesForParams={appliedModuleIds
                .map((id) => modules.find((m) => m.id === id)?.name)
                .filter((n): n is string => !!n)}
              edgeSettings={edgeSettings}
              onEdgeSettingsChange={setEdgeSettings}
            />
          </div>
        </div>
        <LogPanel
          logs={logs}
          minimized={terminalMinimized}
          onToggleMinimize={() => setTerminalMinimized((v) => !v)}
        />
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
