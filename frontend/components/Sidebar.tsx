"use client";

import type { ItemType } from "@/lib/firestore";
import type { FirestoreFile, FirestoreItem } from "@/lib/firestore";

const LABELS: Record<ItemType, string> = {
  strategies: "Strategie",
  indicators: "Indikátory",
  modules: "Moduly",
};

const CREATE_LABELS: Record<ItemType, string> = {
  strategies: "Vytvořit strategii",
  indicators: "Vytvořit indikátor",
  modules: "Vytvořit modul",
};

/** Virtual file key for viewing imported indicator/module: "indicator:id" or "module:id" */
export type VirtualFileKey = string;

interface SidebarProps {
  openItem: { type: ItemType; id: string; name: string } | null;
  selectedType: ItemType | null;
  items: FirestoreItem[];
  files: FirestoreFile[];
  /** Applied (confirmed) indicators - shown in left menu when strategy is open */
  appliedIndicators?: FirestoreItem[];
  appliedModules?: FirestoreItem[];
  onSelectType?: (type: ItemType) => void;
  onSelectItem?: (type: ItemType, item: FirestoreItem) => void;
  onCreateClick?: () => void;
  onAddFileClick?: () => void;
  onBack?: () => void;
  onSelectFile?: (fileName: string) => void;
  /** When clicking imported indicator/module, pass "indicator:id" or "module:id" */
  onSelectImported?: (key: VirtualFileKey) => void;
  selectedFile?: string | null;
}

/** Sidebar - 3 buttons, or expanded list + create, or item files */
export function Sidebar({
  openItem,
  selectedType,
  items,
  files,
  onSelectType,
  onSelectItem,
  onCreateClick,
  onAddFileClick,
  appliedIndicators = [],
  appliedModules = [],
  onBack,
  onSelectFile,
  onSelectImported,
  selectedFile,
}: SidebarProps) {
  if (openItem) {
    return (
      <aside className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-900/30">
        <div className="px-4 py-3 border-b border-zinc-800">
          <button
            onClick={onBack}
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-2"
          >
            ← Zpět
          </button>
          <h2 className="font-semibold text-sm mt-2 truncate">{openItem.name}</h2>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Soubory
            </h3>
            <button
              onClick={onAddFileClick}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
              title="Přidat soubor"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="space-y-0.5">
            {files.map((f) => (
              <div
                key={f.fileName}
                onClick={() => onSelectFile?.(f.fileName)}
                className={`flex items-center gap-2 py-2 px-2 rounded text-sm cursor-pointer ${
                  selectedFile === f.fileName
                    ? "bg-zinc-700 text-zinc-100"
                    : "hover:bg-zinc-800 text-zinc-400"
                }`}
              >
                <span>📄</span>
                <span>{f.fileName}</span>
              </div>
            ))}
          </div>
          {openItem.type === "strategies" && (appliedIndicators.length > 0 || appliedModules.length > 0) && (
            <>
              {appliedIndicators.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                    Importované indikátory
                  </h3>
                  <div className="space-y-0.5">
                    {appliedIndicators.map((ind) => {
                      const key = `indicator:${ind.id}`;
                      return (
                        <div
                          key={key}
                          onClick={() => onSelectImported?.(key)}
                          className={`flex items-center gap-2 py-2 px-2 rounded text-sm cursor-pointer ${
                            selectedFile === key ? "bg-zinc-700 text-zinc-100" : "hover:bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <span>📊</span>
                          <span className="truncate">{ind.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {appliedModules.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                    Importované moduly
                  </h3>
                  <div className="space-y-0.5">
                    {appliedModules.map((mod) => {
                      const key = `module:${mod.id}`;
                      return (
                        <div
                          key={key}
                          onClick={() => onSelectImported?.(key)}
                          className={`flex items-center gap-2 py-2 px-2 rounded text-sm cursor-pointer ${
                            selectedFile === key ? "bg-zinc-700 text-zinc-100" : "hover:bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <span>📦</span>
                          <span className="truncate">{mod.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    );
  }

  if (selectedType) {
    const label = LABELS[selectedType];
    const createLabel = CREATE_LABELS[selectedType];
    return (
      <aside className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-900/30">
        <div className="px-4 py-3 border-b border-zinc-800">
          <button
            onClick={() => onBack?.()}
            className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-2"
          >
            ← Zpět
          </button>
          <h2 className="font-semibold text-sm mt-2 text-zinc-300">{label}</h2>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <div className="space-y-0.5">
            {items.length === 0 ? (
              <p className="text-zinc-500 text-sm py-2">Žádné položky</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectItem?.(selectedType, item)}
                  className="flex items-center gap-2 py-2 px-2 rounded text-sm cursor-pointer hover:bg-zinc-800 text-zinc-400"
                >
                  <span>📁</span>
                  <span className="truncate">{item.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={onCreateClick}
            className="w-full px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
          >
            {createLabel}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-900/30">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="font-semibold text-sm text-zinc-300">Projekt</h2>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        <button
          onClick={() => onSelectType?.("strategies")}
          className="w-full px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-left transition-colors"
        >
          Strategie
        </button>
        <button
          onClick={() => onSelectType?.("indicators")}
          className="w-full px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-left transition-colors"
        >
          Indikátory
        </button>
        <button
          onClick={() => onSelectType?.("modules")}
          className="w-full px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-left transition-colors"
        >
          Moduly
        </button>
      </div>
    </aside>
  );
}
