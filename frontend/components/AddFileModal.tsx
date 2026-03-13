"use client";

import { useState } from "react";

interface AddFileModalProps {
  onClose: () => void;
  onCreate: (fileName: string) => Promise<void>;
  existingFiles: string[];
}

export function AddFileModal({ onClose, onCreate, existingFiles }: AddFileModalProps) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = fileName.trim();
    if (!name) return;

    if (!name.endsWith(".py")) {
      setError("Soubor musí mít příponu .py");
      return;
    }
    if (existingFiles.includes(name)) {
      setError(`Soubor ${name} již existuje`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onCreate(name);
      onClose();
    } catch (err) {
      setError((err as Error).message ?? "Chyba při vytváření");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-lg p-6 w-full max-w-md border border-zinc-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium mb-4">Nový soubor</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Název souboru *</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
              placeholder="např. utils.py, signals.py"
              required
            />
            {error && <p className="text-rose-400 text-sm mt-1">{error}</p>}
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
