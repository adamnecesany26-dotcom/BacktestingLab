"use client";

import { useState } from "react";
import type { SavedBacktestRun } from "@/lib/firestore";

interface RunHistoryProps {
  runs: SavedBacktestRun[];
  onDeleteRun: (id: string) => void;
  onDeleteAll: () => void;
}

function formatDate(savedAt: { seconds: number } | null): string {
  if (!savedAt?.seconds) return "—";
  const d = new Date(savedAt.seconds * 1000);
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNum(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function formatPnl(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}$${n.toFixed(2)}`;
}

const CHART_METRICS = [
  { key: "sharpeRatio", label: "Sharpe ratio" },
  { key: "rMultiple", label: "R-multiple" },
  { key: "totalReturnUsd", label: "Total P/L ($)" },
  { key: "winRate", label: "Win %" },
  { key: "profitFactor", label: "Profit factor" },
  { key: "expectancyUsd", label: "Expectancy ($)" },
] as const;

export function RunHistory({ runs, onDeleteRun, onDeleteAll }: RunHistoryProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | "all" | null>(null);

  const handleDeleteClick = (id: string) => {
    setDeleteConfirm(id);
  };

  const handleDeleteAllClick = () => {
    setDeleteConfirm("all");
  };

  const confirmDelete = () => {
    if (deleteConfirm === "all") {
      onDeleteAll();
    } else if (deleteConfirm) {
      onDeleteRun(deleteConfirm);
    }
    setDeleteConfirm(null);
  };

  const cancelDelete = () => setDeleteConfirm(null);

  if (runs.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">
        Žádná historie runů. Spusťte backtest a výsledky se automaticky uloží.
      </div>
    );
  }

  const sortedRuns = [...runs].sort((a, b) => {
    const aT = (a.savedAt as { seconds: number })?.seconds ?? 0;
    const bT = (b.savedAt as { seconds: number })?.seconds ?? 0;
    return bT - aT;
  });

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-zinc-400">Historie backtestů</h3>
        <button
          onClick={handleDeleteAllClick}
          className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
          title="Smazat všechny"
        >
          🗑️ Smazat vše
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-800/50">
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Datum</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Total P/L</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Sharpe</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">R-multiple</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">WR %</th>
              <th className="px-4 py-2 w-10 text-center font-medium text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRuns.map((r) => {
              const m = r.metrics ?? {};
              const pnl = m.totalReturnUsd ?? 0;
              const isWin = pnl >= 0;
              return (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800/80 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-4 py-2 text-zinc-300">{formatDate(r.savedAt as { seconds: number } | null)}</td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${
                      isWin ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {formatPnl(m.totalReturnUsd)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-300">
                    {formatNum(m.sharpeRatio)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-300">
                    {formatNum(m.rMultiple)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-300">
                    {formatNum(m.winRate)}%
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handleDeleteClick(r.id)}
                      className="text-zinc-500 hover:text-rose-400"
                      title="Smazat"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {CHART_METRICS.map(({ key, label }) => (
          <RunHistoryChart
            key={key}
            runs={sortedRuns}
            metricKey={key}
            label={label}
          />
        ))}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-800 rounded-lg p-6 max-w-sm border border-zinc-700">
            <p className="text-zinc-200 mb-4">
              {deleteConfirm === "all"
                ? "Opravdu smazat všechny backtesty?"
                : "Opravdu smazat tento backtest?"}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelDelete}
                className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
              >
                Zrušit
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm"
              >
                Smazat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunHistoryChart({
  runs,
  metricKey,
  label,
}: {
  runs: SavedBacktestRun[];
  metricKey: string;
  label: string;
}) {
  const chronological = [...runs].reverse();
  const values = chronological.map((r) => {
    const v = (r.metrics as Record<string, unknown>)?.[metricKey];
    return typeof v === "number" || typeof v === "string" ? Number(v) : null;
  });
  const validValues = values.filter((v): v is number => v != null && !Number.isNaN(v));
  const maxVal = validValues.length ? Math.max(...validValues) : 0;
  const minVal = validValues.length ? Math.min(...validValues) : 0;
  const range = maxVal - minVal || 1;
  const padding = Math.max(range * 0.15, 0.1);
  const chartMin = minVal - padding;
  const chartMax = maxVal + padding;
  const chartRange = chartMax - chartMin || 1;

  const padLeft = 56;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 36;
  const chartW = 360;
  const chartH = 180;
  const plotW = chartW - padLeft - padRight;
  const plotH = chartH - padTop - padBottom;

  const points: string[] = [];
  values.forEach((v, i) => {
    if (v != null && !Number.isNaN(v)) {
      const x = padLeft + (values.length <= 1 ? 0 : (i / (values.length - 1)) * plotW);
      const y = padTop + plotH - ((v - chartMin) / chartRange) * plotH;
      points.push(`${x},${y}`);
    }
  });

  const yTicks = 5;
  const yTickValues: number[] = [];
  for (let i = 0; i <= yTicks; i++) {
    yTickValues.push(chartMin + (chartMax - chartMin) * (i / yTicks));
  }

  const formatTick = (n: number) => {
    if (Math.abs(n) >= 1000) return n.toFixed(0);
    if (Math.abs(n) >= 1) return n.toFixed(1);
    return n.toFixed(2);
  };

  return (
    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 min-w-0">
      <h4 className="text-sm font-medium text-zinc-400 mb-3">{label}</h4>
      <div className="h-44 w-full min-w-0">
        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full min-w-0" preserveAspectRatio="xMidYMid meet">
          {/* Y-axis labels */}
          {yTickValues.map((val, i) => {
            const y = padTop + plotH - ((val - chartMin) / chartRange) * plotH;
            return (
              <g key={i}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + plotW}
                  y2={y}
                  stroke="#27272a"
                  strokeWidth="0.5"
                  strokeDasharray="2,2"
                />
                <text
                  x={padLeft - 8}
                  y={y + 5}
                  textAnchor="end"
                  fill="#a1a1aa"
                  fontSize="12"
                  fontFamily="monospace"
                >
                  {formatTick(val)}
                </text>
              </g>
            );
          })}

          {/* Line + points */}
          {points.length >= 2 && (
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              points={points.join(" ")}
            />
          )}
          {values.map((v, i) => {
            if (v == null || Number.isNaN(v)) return null;
            const x = padLeft + (values.length <= 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
            const y = padTop + plotH - ((v - chartMin) / chartRange) * plotH;
            const isPos = v >= 0;
            return (
              <g key={i}>
                <title>Run {i + 1}: {v.toFixed(2)}</title>
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill={isPos ? "#10b981" : "#ef4444"}
                  stroke="#18181b"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={chartH - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize="12"
                >
                  {i + 1}
                </text>
                <text
                  x={x}
                  y={y - 12}
                  textAnchor="middle"
                  fill="#a1a1aa"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  {formatTick(v)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
