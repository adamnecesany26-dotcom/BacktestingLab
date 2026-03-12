"use client";

interface RunButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/** Run backtest button */
export function RunButton({ onClick, disabled }: RunButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
    >
      {disabled ? "Running..." : "Run"}
    </button>
  );
}
