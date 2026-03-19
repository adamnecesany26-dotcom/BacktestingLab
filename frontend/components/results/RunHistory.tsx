"use client";

import { useMemo, useState } from "react";
import type { SavedBacktestRun } from "@/lib/firestore";

interface RunHistoryProps {
  runs: SavedBacktestRun[];
  onDeleteRun: (id: string) => void;
  onDeleteAll: () => void;
  onUpdateLifecycle: (runDocId: string, patch: Record<string, unknown>) => Promise<void>;
}

function formatDate(savedAt: { seconds: number; nanoseconds?: number } | null): string {
  if (!savedAt?.seconds) return "—";
  const millis = savedAt.seconds * 1000 + Math.floor((savedAt.nanoseconds ?? 0) / 1_000_000);
  const d = new Date(millis);
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

function formatProfitFactor(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 999) return "No losses";
  return n.toFixed(2);
}

function getSavedAtParts(run: SavedBacktestRun): { sec: number; nano: number } {
  const saved = run.savedAt as { seconds?: number; nanoseconds?: number } | null;
  return { sec: saved?.seconds ?? 0, nano: saved?.nanoseconds ?? 0 };
}

function formatPnl(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}$${n.toFixed(2)}`;
}

function getExperimentObj(run: SavedBacktestRun): Record<string, unknown> {
  return run.experiment && typeof run.experiment === "object"
    ? (run.experiment as Record<string, unknown>)
    : {};
}

function getBranchId(run: SavedBacktestRun): string {
  const exp = getExperimentObj(run);
  const v = exp.branch_id ?? exp.branchId;
  if (typeof v === "string" && v.trim()) return v.trim();
  return "main";
}

function getBranchName(run: SavedBacktestRun): string {
  const exp = getExperimentObj(run);
  const v = exp.branch_name ?? exp.branchName;
  if (typeof v === "string" && v.trim()) return v.trim();
  return "main";
}

function getParentRunId(run: SavedBacktestRun): string | null {
  const exp = getExperimentObj(run);
  const v = exp.parent_run_id ?? exp.parentRunId;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function getReadiness(run: SavedBacktestRun): "ready" | "caution" | "not_ready" {
  const qualityGatePassed =
    run.qualityGate && typeof run.qualityGate === "object"
      ? (run.qualityGate as Record<string, unknown>).passed
      : undefined;
  const validationMode =
    run.validation && typeof run.validation === "object"
      ? String((run.validation as Record<string, unknown>).mode ?? "single")
      : "single";
  const tradeCount = Number(run.metrics?.tradeCount ?? 0);
  const riskOfRuin =
    run.monteCarlo && typeof run.monteCarlo === "object"
      ? Number((run.monteCarlo as Record<string, unknown>).riskOfRuin ?? NaN)
      : NaN;
  const warnings =
    (validationMode === "single" ? 1 : 0) +
    (tradeCount < 20 ? 1 : 0) +
    (!Number.isFinite(riskOfRuin) ? 1 : 0) +
    (qualityGatePassed === false ? 1 : 0);
  if (warnings === 0) return "ready";
  if (warnings <= 2) return "caution";
  return "not_ready";
}

function getBranchSeq(run: SavedBacktestRun): number | null {
  const exp = getExperimentObj(run);
  const v = Number(exp.branch_seq ?? exp.branchSeq ?? NaN);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

const CHART_METRICS = [
  { key: "sharpeRatio", label: "Sharpe ratio" },
  { key: "expectancyR", label: "Expectancy R" },
  { key: "totalReturnUsd", label: "Total P/L ($)" },
  { key: "winRate", label: "Win %" },
  { key: "profitFactor", label: "Profit factor" },
  { key: "expectancyUsd", label: "Expectancy ($)" },
] as const;

export function RunHistory({ runs, onDeleteRun, onDeleteAll, onUpdateLifecycle }: RunHistoryProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | "all" | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);

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

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  if (runs.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">
        Žádná historie runů. Spusťte backtest a výsledky se automaticky uloží.
      </div>
    );
  }

  const sortedRuns = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const aSaved = getSavedAtParts(a);
        const bSaved = getSavedAtParts(b);
        if (aSaved.sec !== bSaved.sec) return bSaved.sec - aSaved.sec;
        if (aSaved.nano !== bSaved.nano) return bSaved.nano - aSaved.nano;
        return (b.runId ?? b.id).localeCompare(a.runId ?? a.id);
      }),
    [runs]
  );
  const branchMeta = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; latestTs: number }>();
    for (const run of sortedRuns) {
      const id = getBranchId(run);
      const current = map.get(id);
      const ts = (() => {
        const p = getSavedAtParts(run);
        return p.sec * 1000 + Math.floor(p.nano / 1_000_000);
      })();
      if (!current) {
        map.set(id, { id, name: getBranchName(run), count: 1, latestTs: ts });
      } else {
        map.set(id, {
          ...current,
          count: current.count + 1,
          latestTs: Math.max(current.latestTs, ts),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [sortedRuns]);
  const branchHeadRunIds = useMemo(() => {
    const heads = new Set<string>();
    const seen = new Set<string>();
    for (const run of sortedRuns) {
      const branchId = getBranchId(run);
      if (seen.has(branchId)) continue;
      seen.add(branchId);
      heads.add(run.id);
    }
    return heads;
  }, [sortedRuns]);
  const filteredRuns = useMemo(() => {
    if (selectedBranchId === "all") return sortedRuns;
    return sortedRuns.filter((r) => getBranchId(r) === selectedBranchId);
  }, [selectedBranchId, sortedRuns]);
  const depthByRunId = useMemo(() => {
    const map = new Map<string, SavedBacktestRun>();
    for (const run of filteredRuns) {
      if (run.id) map.set(run.id, run);
      if (run.runId) map.set(run.runId, run);
    }
    const cache = new Map<string, number>();
    const walkDepth = (run: SavedBacktestRun): number => {
      if (cache.has(run.id)) return cache.get(run.id)!;
      const parent = getParentRunId(run);
      if (!parent) {
        cache.set(run.id, 0);
        return 0;
      }
      const parentRun = map.get(parent);
      if (!parentRun || parentRun.id === run.id) {
        cache.set(run.id, 0);
        return 0;
      }
      const d = Math.min(6, walkDepth(parentRun) + 1);
      cache.set(run.id, d);
      return d;
    };
    for (const run of filteredRuns) walkDepth(run);
    return cache;
  }, [filteredRuns]);
  const compareRuns = useMemo(
    () => filteredRuns.filter((r) => compareIds.includes(r.id)),
    [filteredRuns, compareIds]
  );
  const baselineRun = compareRuns[0] ?? null;
  const compareMetrics: { key: keyof SavedBacktestRun["metrics"]; label: string }[] = [
    { key: "finalEquity", label: "Final Equity" },
    { key: "totalReturnUsd", label: "Total P/L ($)" },
    { key: "maxDrawdownPct", label: "Max DD (%)" },
    { key: "sharpeRatio", label: "Sharpe" },
    { key: "sortinoRatio", label: "Sortino" },
    { key: "profitFactor", label: "PF" },
    { key: "tradeCount", label: "Trades" },
    { key: "winRate", label: "Win %" },
  ];

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-zinc-400">Historie backtestů</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Větev:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
            >
              <option value="all">Všechny ({sortedRuns.length})</option>
              {branchMeta.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.count})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleDeleteAllClick}
            className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
            title="Smazat všechny"
          >
            🗑️ Smazat vše
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-800/50">
              <th className="px-2 py-2 text-center font-medium text-zinc-400">Cmp</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Run ID</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Datum</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Total P/L</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Sharpe</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Expectancy R</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">WR %</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Větev</th>
              <th className="px-4 py-2 text-right font-medium text-zinc-400">Seq</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Parent</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Node</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Ready</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Promote</th>
              <th className="px-4 py-2 text-left font-medium text-zinc-400">Lifecycle</th>
              <th className="px-4 py-2 w-10 text-center font-medium text-zinc-400"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.map((r) => {
              const m = r.metrics ?? {};
              const pnl = m.totalReturnUsd ?? 0;
              const isWin = pnl >= 0;
              const decisionRaw =
                r.experiment && typeof r.experiment === "object"
                  ? (r.experiment as Record<string, unknown>).promoteDecision
                  : undefined;
              const promoteDecision = String(decisionRaw ?? "n/a");
              const lifecycleStatus = String(
                (r.experiment as Record<string, unknown> | undefined)?.lifecycleStatus ?? "draft"
              );
              const reviewerApproved = Boolean(
                (r.experiment as Record<string, unknown> | undefined)?.reviewerApproved ?? false
              );
              const promoteColor =
                promoteDecision === "candidate_for_promote" || promoteDecision === "review_candidate"
                  ? "text-emerald-400"
                  : promoteDecision === "hold"
                    ? "text-amber-300"
                    : "text-zinc-500";
              const promoteLabel =
                promoteDecision === "candidate_for_promote"
                  ? "review_candidate"
                  : promoteDecision;
              const readiness = getReadiness(r);
              const readinessLabel =
                readiness === "ready"
                  ? "ready"
                  : readiness === "caution"
                    ? "caution"
                    : "not_ready";
              const readinessColor =
                readiness === "ready"
                  ? "text-emerald-400"
                  : readiness === "caution"
                    ? "text-amber-300"
                    : "text-rose-400";
              const parent = getParentRunId(r);
              const seq = getBranchSeq(r);
              const isHead = branchHeadRunIds.has(r.id);
              const depth = depthByRunId.get(r.id) ?? 0;
              return (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800/80 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={compareIds.includes(r.id)}
                      onChange={() => toggleCompare(r.id)}
                      className="accent-emerald-500"
                      title="Přidat do compare workspace"
                    />
                  </td>
                  <td className="px-4 py-2 text-zinc-400 font-mono text-xs">
                    <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 10}px` }}>
                      <span>{(r.runId ?? r.id).slice(0, 22)}</span>
                      {depth > 0 && <span className="text-zinc-600">↳</span>}
                    </div>
                  </td>
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
                    {formatNum(m.expectancyR)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zinc-300">
                    {formatNum(m.winRate)}%
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-300">{getBranchName(r)}</td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-400 font-mono">{seq ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500 font-mono">
                    {parent ? parent.slice(0, 16) : "root"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {isHead ? (
                      <span className="text-emerald-400">head</span>
                    ) : !parent ? (
                      <span className="text-zinc-500">root</span>
                    ) : (
                      <span className="text-zinc-500">child</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-xs ${readinessColor}`}>{readinessLabel}</td>
                  <td className={`px-4 py-2 text-xs ${promoteColor}`}>
                    {promoteLabel}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <select
                        value={lifecycleStatus}
                        onChange={(e) =>
                          void onUpdateLifecycle(r.id, {
                            lifecycleStatus: e.target.value,
                          })
                        }
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200"
                      >
                        <option value="draft">draft</option>
                        <option value="review">review</option>
                        <option value="approved">approved</option>
                        <option value="promoted">promoted</option>
                      </select>
                      <button
                        onClick={() =>
                          void onUpdateLifecycle(r.id, {
                            reviewerApproved: !reviewerApproved,
                          })
                        }
                        className={`px-2 py-1 rounded text-[11px] ${
                          reviewerApproved
                            ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                        }`}
                      >
                        {reviewerApproved ? "sign-off" : "awaiting"}
                      </button>
                    </div>
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

      {compareRuns.length >= 2 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-zinc-300">Compare workspace</h4>
            <button
              onClick={() => setCompareIds([])}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Vyčistit výběr
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="py-2 text-left text-zinc-500">Metric</th>
                  {compareRuns.map((r) => (
                    <th key={r.id} className="py-2 text-right text-zinc-400 font-mono">
                      {(r.runId ?? r.id).slice(0, 16)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareMetrics.map((m) => (
                  <tr key={m.key as string} className="border-b border-zinc-800/50">
                    <td className="py-2 text-zinc-300">{m.label}</td>
                    {compareRuns.map((r) => {
                      const value = Number(r.metrics?.[m.key] ?? NaN);
                      const baseline = Number(baselineRun?.metrics?.[m.key] ?? NaN);
                      const delta =
                        Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : NaN;
                      return (
                        <td key={`${r.id}_${String(m.key)}`} className="py-2 text-right text-zinc-300 font-mono">
                          {Number.isFinite(value)
                            ? m.key === "profitFactor" && value >= 999
                              ? "No losses"
                              : value.toFixed(2)
                            : "—"}
                          {Number.isFinite(delta) && baselineRun && baselineRun.id !== r.id ? (
                            <span className={`ml-2 ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {delta >= 0 ? "+" : ""}
                              {delta.toFixed(2)}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {CHART_METRICS.map(({ key, label }) => (
          <RunHistoryChart
            key={key}
            runs={filteredRuns}
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
