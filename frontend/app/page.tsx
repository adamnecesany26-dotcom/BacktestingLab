"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import { StrategyEditor } from "@/components/editor/StrategyEditor";
import { CreateModal } from "@/components/CreateModal";
import { AddFileModal } from "@/components/AddFileModal";
import { BacktestSettings } from "@/components/BacktestSettings";
import { ResultsView } from "@/components/results/ResultsView";
import { LogPanel } from "@/components/LogPanel";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { saveBacktestResult } from "@/lib/firestore";
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
import { runBacktestStreaming, getAvailableData } from "@/lib/api";
import {
  filterInstrumentsByType,
  type RunResponse,
  type DataInstrument,
  type InstrumentType,
} from "@shared/types";

export default function Home() {
  const [selectedType, setSelectedType] = useState<ItemType | null>(null);
  const [items, setItems] = useState<FirestoreItem[]>([]);
  const [openItem, setOpenItem] = useState<{ type: ItemType; id: string; name: string } | null>(null);
  const [files, setFiles] = useState<{ fileName: string; content: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAddFileModalOpen, setIsAddFileModalOpen] = useState(false);

  const [instruments, setInstruments] = useState<DataInstrument[]>([]);
  const [instrumentsLoaded, setInstrumentsLoaded] = useState(false);
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
    instrumentType: "futures",
    tickSize: 0.25,
    valuePerTick: 5,
    shareSize: 100,
    lotSize: 1,
    pipSize: 0.0001,
    pipValue: 10,
  });

  const [results, setResults] = useState<RunResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [terminalMinimized, setTerminalMinimized] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const loadItems = useCallback(async (type: ItemType) => {
    const list = await listItems(type);
    setItems(list);
  }, []);

  const loadFiles = useCallback(async (type: ItemType, id: string) => {
    const f = await getFiles(type, id);
    setFiles(f);
    if (f.length > 0) {
      setSelectedFile(f[0].fileName);
    }
  }, []);

  const loadFileContent = useCallback(async (type: ItemType, id: string, fileName: string) => {
    const content = await getFileContent(type, id, fileName);
    setFileContent(content ?? "");
  }, []);

  useEffect(() => {
    if (selectedType) loadItems(selectedType);
  }, [selectedType, loadItems]);

  useEffect(() => {
    if (openItem?.type === "strategies") {
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
  }, [openItem?.type, openItem?.id]);

  useEffect(() => {
    if (openItem) {
      loadFiles(openItem.type, openItem.id);
    } else {
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
    }
  }, [openItem, loadFiles]);

  useEffect(() => {
    if (!openItem) return;
    if (selectedFile?.startsWith("indicator:")) {
      const id = selectedFile.replace("indicator:", "");
      getFileContent("indicators", id, "main.py").then((c) => setFileContent(c ?? ""));
    } else if (selectedFile?.startsWith("module:")) {
      const id = selectedFile.replace("module:", "");
      getFileContent("modules", id, "main.py").then((c) => setFileContent(c ?? ""));
    } else if (selectedFile) {
      loadFileContent(openItem.type, openItem.id, selectedFile);
    }
  }, [openItem, selectedFile, loadFileContent]);

  useEffect(() => {
    getAvailableData()
      .then((d) => {
        setInstruments(d.instruments);
        setInstrumentsLoaded(true);
        if (d.instruments.length > 0 && !selectedInstrument) {
          const inv = d.instruments[0];
          setSelectedInstrument(inv);
          setYears(Math.min(1, inv.yearsAvailable));
        }
      })
      .catch(() => {
        setInstruments([]);
        setInstrumentsLoaded(true);
      });
  }, []);

  const handleSelectInstrument = (inv: DataInstrument) => {
    setSelectedInstrument(inv);
    setYears((y) => Math.min(y, inv.yearsAvailable));
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
      setSelectedInstrument(filteredInstruments[0] ?? null);
      if (filteredInstruments[0]) {
        setYears((y) => Math.min(y, filteredInstruments[0].yearsAvailable));
      }
    }
  }, [filteredInstruments, backtestParams.instrumentType, selectedInstrument]);

  const handleSelectType = (type: ItemType) => {
    setSelectedType(type);
    setOpenItem(null);
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
    } else if (selectedType) {
      setSelectedType(null);
    }
  };

  const handleCreateItem = async (name: string, tag?: string) => {
    if (!selectedType) return;
    const { id } = await createItem(selectedType, name, tag);
    await loadItems(selectedType);
    const newItem: FirestoreItem = { id, name, tag, createdAt: null as any };
    handleSelectItem(selectedType, newItem);
  };

  const handleAddFile = async (fileName: string) => {
    if (!openItem) return;
    await createFile(openItem.type, openItem.id, fileName);
    await loadFiles(openItem.type, openItem.id);
    setSelectedFile(fileName);
    setFileContent("");
    addLog(`Vytvořen soubor: ${fileName}`);
  };

  const handleSaveFile = async () => {
    if (!openItem || !selectedFile) return;
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
  };

  const handleConfirmSelection = () => {
    setAppliedIndicatorIds([...selectedIndicatorIds]);
    setAppliedModuleIds([...selectedModuleIds]);
    addLog(`Potvrzeno: ${selectedIndicatorIds.length} indikátorů, ${selectedModuleIds.length} modulů`);
  };

  const handleRun = async () => {
    if (!openItem || openItem.type !== "strategies") return;
    const mainCode = await getFileContent(openItem.type, openItem.id, "main.py");
    if (!mainCode) {
      addLog("Chyba: main.py nenalezen");
      return;
    }
    if (!selectedInstrument) {
      addLog("Vyberte instrument");
      return;
    }

    const allFiles: Record<string, string> = {};
    for (const f of files) {
      const content = await getFileContent(openItem.type, openItem.id, f.fileName);
      if (content != null) allFiles[f.fileName] = content;
    }
    const toModuleName = (n: string) =>
      (n || "module").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "_") || "module";

    for (const indId of selectedIndicatorIds) {
      const ind = indicators.find((i) => i.id === indId);
      if (!ind) continue;
      const content = await getFileContent("indicators", indId, "main.py");
      if (content != null) {
        allFiles[`indicators/${toModuleName(ind.name)}.py`] = content;
      }
    }
    for (const modId of selectedModuleIds) {
      const mod = modules.find((m) => m.id === modId);
      if (!mod) continue;
      const content = await getFileContent("modules", modId, "main.py");
      if (content != null) {
        allFiles[`modules/${toModuleName(mod.name)}.py`] = content;
      }
    }
    if (Object.keys(allFiles).length === 0) {
      addLog("Chyba: žádné soubory k spuštění");
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setIsRunning(true);
    setRunProgress(0);
    setLogs([]);
    addLog("Spouštím backtest...");

    try {
      const data = await runBacktestStreaming(
        {
          files: allFiles,
          instrument: selectedInstrument.instrument,
          timeframe: selectedInstrument.timeframe,
          years,
          data_file: selectedInstrument.file,
          initial_capital: backtestParams.initialCapital,
          slippage_perc: backtestParams.slippagePerc,
          instrument_type: backtestParams.instrumentType,
          tick_size: backtestParams.tickSize,
          value_per_tick: backtestParams.valuePerTick,
          share_size: backtestParams.shareSize,
          lot_size: backtestParams.lotSize,
          pip_size: backtestParams.pipSize,
          pip_value: backtestParams.pipValue,
        },
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
      setIsRunning(false);
      setRunProgress(0);
      setAbortController(null);
    }
  };

  const handleStopRun = () => {
    abortController?.abort();
  };

  const getExportPayload = () => {
    if (!results) return null;
    let equityCurve = results.equityCurve;
    if (!equityCurve?.length && results.equity?.length && results.ohlc?.length) {
      const first = results.ohlc[0]?.date?.slice(0, 10);
      const d = first ? new Date(first) : null;
      if (d) d.setDate(d.getDate() - 1);
      const dayBefore = d?.toISOString().slice(0, 10) ?? "0";
      equityCurve = [
        { date: dayBefore, value: results.equity[0] ?? 0 },
        ...results.ohlc.map((o, i) => ({ date: o.date.slice(0, 10), value: results.equity![i + 1] ?? 0 })),
      ];
    } else if (!equityCurve?.length && results.equity?.length) {
      equityCurve = results.equity.map((v, i) => ({ date: String(i), value: v }));
    }
    return {
      equityCurve: equityCurve ?? [],
      metrics: results.metrics,
      trades: results.trades,
    };
  };

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

  const handleSave = async () => {
    const payload = getExportPayload();
    if (!payload || !openItem) return;
    try {
      await saveBacktestResult(openItem.id, openItem.name, payload);
      addLog(`Výsledky uloženy do Results / ${openItem.name}`);
    } catch (e) {
      addLog(`Chyba: ${(e as Error).message}`);
    }
  };

  const centerContent = showResults ? (
    <ResultsView
      results={results}
      onBack={() => setShowResults(false)}
      onExport={handleExport}
      onSave={handleSave}
      strategyName={openItem?.name}
    />
  ) : (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        {openItem && selectedFile && (
          <>
            <button
              onClick={handleSaveFile}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
            >
              Uložit
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
        {openItem && selectedFile ? (
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
      {isCreateModalOpen && selectedType && (
        <CreateModal
          type={selectedType}
          onClose={() => setIsCreateModalOpen(false)}
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
        selectedType={selectedType}
        items={items}
        files={files}
        onSelectType={handleSelectType}
        onSelectItem={handleSelectItem}
        onCreateClick={() => setIsCreateModalOpen(true)}
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
          <div className="w-96 flex flex-col overflow-hidden bg-zinc-900/50 p-4">
            <BacktestSettings
              instruments={filteredInstruments}
              instrumentsLoaded={instrumentsLoaded}
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
            />
          </div>
        </div>
        <LogPanel
          logs={logs}
          minimized={terminalMinimized}
          onToggleMinimize={() => setTerminalMinimized((v) => !v)}
        />
      </div>
    </div>
  );
}
