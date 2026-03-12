"use client";

interface LoadingOverlayProps {
  progress?: number; // 0-100
  message?: string;
  onStop?: () => void;
}

export function LoadingOverlay({
  progress = 0,
  message = "Spouštím backtest...",
  onStop,
}: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center z-10">
      <div className="w-80 space-y-4">
        <p className="text-zinc-400 text-center">{message}</p>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        {onStop && (
          <button
            onClick={onStop}
            className="w-full py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm font-medium"
          >
            Zastavit
          </button>
        )}
      </div>
    </div>
  );
}
