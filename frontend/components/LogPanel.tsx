"use client";

interface LogPanelProps {
  logs: string[];
  minimized?: boolean;
  onToggleMinimize?: () => void;
}

/** Bottom panel - log output / Terminal */
export function LogPanel({ logs, minimized = false, onToggleMinimize }: LogPanelProps) {
  if (minimized) {
    return (
      <div
        className="h-8 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between px-4 cursor-pointer hover:bg-zinc-800/80 transition-colors"
        onClick={onToggleMinimize}
      >
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Terminál</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMinimize?.();
          }}
          className="text-zinc-400 hover:text-zinc-200 text-sm"
        >
          ▲ Rozbalit
        </button>
      </div>
    );
  }

  return (
    <div className="h-40 border-t border-zinc-800 bg-zinc-900/50 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Terminál</span>
        <button
          onClick={onToggleMinimize}
          className="text-zinc-400 hover:text-zinc-200 text-sm"
        >
          ▼ Minimalizovat
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs text-zinc-400 min-h-0">
        {logs.length === 0 ? (
          <span className="italic text-zinc-600">No logs yet</span>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="py-0.5">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
