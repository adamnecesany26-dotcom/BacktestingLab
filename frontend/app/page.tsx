"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { StrategyEditor } from "@/components/editor/StrategyEditor";
import { CreateModal } from "@/components/CreateModal";
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
  createItem,
  type ItemType,
  type FirestoreItem,
} from "@/lib/firestore";
import { runBacktestStreaming, getAvailableData } from "@/lib/api";
import type { RunResponse, DataInstrument } from "@shared/types";

export default function Home() {
  const [selectedType, setSelectedType] = useState<ItemType | null>(null);
  const [items, setItems] = useState<FirestoreItem[]>([]);
  const [openItem, setOpenItem] = useState<{ type: ItemType; id: string; name: string } | null>(null);
  const [files, setFiles] = useState<{ fileName: string; content: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [instruments, setInstruments] = useState<DataInstrument[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<DataInstrument | null>(null);
  const [years, setYears] = useState(1);
  const [backtestParams, setBacktestParams] = useState({
    initialCapital: 100000,
    commissionPerc: 0.001,
    slippagePerc: 0.001,
  });

  const [results, setResults] = useState<RunResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

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
    if (openItem) {
      loadFiles(openItem.type, openItem.id);
    } else {
      setFiles([]);
      setSelectedFile(null);
      setFileContent("");
    }
  }, [openItem, loadFiles]);

  useEffect(() => {
    if (openItem && selectedFile) {
      loadFileContent(openItem.type, openItem.id, selectedFile);
    }
  }, [openItem, selectedFile, loadFileContent]);

  useEffect(() => {
    getAvailableData()
      .then((d) => {
        setInstruments(d.instruments);
        if (d.instruments.length > 0 && !selectedInstrument) {
          const inv = d.instruments[0];
          setSelectedInstrument(inv);
          setYears(Math.min(1, inv.yearsAvailable));
        }
      })
      .catch(() => setInstruments([]));
  }, []);

  const handleSelectInstrument = (inv: DataInstrument) => {
    setSelectedInstrument(inv);
    setYears((y) => Math.min(y, inv.yearsAvailable));
  };

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

  const handleSaveFile = async () => {
    if (!openItem || !selectedFile) return;
    await saveFile(openItem.type, openItem.id, selectedFile, fileContent);
    addLog(`Uloženo: ${selectedFile}`);
  };

  const handleRun = async () => {
    if (!openItem) return;
    const code = await getFileContent(openItem.type, openItem.id, "main.py");
    if (!code) {
      addLog("Chyba: main.py nenalezen");
      return;
    }
    if (!selectedInstrument) {
      addLog("Vyberte instrument");
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
          code,
          instrument: selectedInstrument.instrument,
          timeframe: selectedInstrument.timeframe,
          years,
          data_file: selectedInstrument.file,
          initial_capital: backtestParams.initialCapital,
          commission_perc: backtestParams.commissionPerc,
          slippage_perc: backtestParams.slippagePerc,
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

  const handleExport = () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], {
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
    if (!results || !openItem) return;
    try {
      await saveBacktestResult(openItem.id, openItem.name, results as unknown as Record<string, unknown>);
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
            <span className="text-sm text-zinc-500">{selectedFile}</span>
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
      <Sidebar
        openItem={openItem}
        selectedType={selectedType}
        items={items}
        files={files}
        onSelectType={handleSelectType}
        onSelectItem={handleSelectItem}
        onCreateClick={() => setIsCreateModalOpen(true)}
        onBack={handleBack}
        onSelectFile={(f) => {
          setSelectedFile(f);
          setShowResults(false);
        }}
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
              instruments={instruments}
              selectedInstrument={selectedInstrument}
              onSelectInstrument={handleSelectInstrument}
              years={years}
              onYearsChange={(y) => setYears(Math.max(1, Math.min(y, selectedInstrument?.yearsAvailable ?? 5)))}
              params={backtestParams}
              onParamsChange={(p) => setBacktestParams((prev) => ({ ...prev, ...p }))}
              onRun={handleRun}
              isRunning={isRunning}
              canRun={openItem?.type === "strategies"}
            />
          </div>
        </div>
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
