"use client";

interface LogPanelProps {
  logs: string[];
}

/** Bottom panel - log output */
export function LogPanel({ logs }: LogPanelProps) {
  return (
    <div className="h-32 border-t border-zinc-800 bg-zinc-900/50 flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Logs
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs text-zinc-400">
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
