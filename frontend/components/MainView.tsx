"use client";

import { useState } from "react";
import type { ItemType } from "@/lib/firestore";
import type { FirestoreItem } from "@/lib/firestore";

interface MainViewProps {
  type: ItemType | null;
  items: FirestoreItem[];
  onSelectType: (type: ItemType) => void;
  onSelectItem: (type: ItemType, item: FirestoreItem) => void;
  onCreateClick: () => void;
  onCreateItem: (name: string, tag?: string) => Promise<void>;
  isCreateModalOpen: boolean;
  onCloseCreateModal: () => void;
}

const LABELS: Record<ItemType, string> = {
  strategies: "Strategie",
  indicators: "Indikátory",
  modules: "Moduly",
};

export function MainView({
  type,
  items,
  onSelectType,
  onSelectItem,
  onCreateClick,
  onCreateItem,
  isCreateModalOpen,
  onCloseCreateModal,
}: MainViewProps) {
  if (!type) {
    return null;
  }

  const label = LABELS[type];
  const createLabel = type === "strategies" ? "Vytvořit strategii" : type === "indicators" ? "Vytvořit indikátor" : "Vytvořit modul";

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-zinc-200">{label}</h2>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
        >
          {createLabel}
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        {items.length === 0 ? (
          <p className="text-zinc-500 text-sm">Zatím žádné položky. Klikněte na &quot;{createLabel}&quot;.</p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectItem(type, item)}
              className="px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-left min-w-[180px]"
            >
              <div className="font-medium text-zinc-200">{item.name}</div>
              {item.tag && (
                <div className="text-xs text-zinc-500 mt-1">{item.tag}</div>
              )}
            </button>
          ))
        )}
      </div>
      {isCreateModalOpen && (
        <CreateModal
          type={type}
          onClose={onCloseCreateModal}
          onCreate={onCreateItem}
        />
      )}
    </div>
  );
}

function CreateModal({
  type,
  onClose,
  onCreate,
}: {
  type: ItemType;
  onClose: () => void;
  onCreate: (name: string, tag?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate(name.trim(), tag.trim() || undefined);
      setName("");
      setTag("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const title = type === "strategies" ? "Nová strategie" : type === "indicators" ? "Nový indikátor" : "Nový modul";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-lg p-6 w-full max-w-md border border-zinc-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium mb-4">{title}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Název *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
              placeholder="např. SMA Crossover"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Tag (volitelné)</label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
              placeholder="např. trend-following"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600"
            >
              Zrušit
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? "Vytvářím..." : "Vytvořit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

