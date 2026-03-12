"use client";

import { useState } from "react";
import type { ItemType } from "@/lib/firestore";

interface CreateModalProps {
  type: ItemType;
  onClose: () => void;
  onCreate: (name: string, tag?: string) => Promise<void>;
}

export function CreateModal({ type, onClose, onCreate }: CreateModalProps) {
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

  const title =
    type === "strategies"
      ? "Nová strategie"
      : type === "indicators"
        ? "Nový indikátor"
        : "Nový modul";

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
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
            <label className="block text-sm text-zinc-400 mb-1">
              Tag (volitelné)
            </label>
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
