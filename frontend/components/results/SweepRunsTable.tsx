"use client";

import { useMemo, useState } from "react";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { SweepRunsCompareModal } from "@/components/results/SweepRunsCompareModal";
import type { SweepRunRow } from "@/components/results/sweepRunTypes";

export type { SweepRunRow } from "@/components/results/sweepRunTypes";

type SortKey =
  | "id"
  | "score"
  | "totalReturnUsd"
  | "winRate"
  | "profitFactor"
  | "tradeCount"
  | "params";

function formatParamsCompact(params: Record<string, unknown> | undefined): string {
  if (!params || typeof params !== "object") return "—";
  const skip = new Set(["module_params"]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (skip.has(k)) continue;
    if (v != null && typeof v === "object") continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? parts.join(", ") : "—";
}

function paramsTitle(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  try {
    return JSON.stringify(params, null, 0);
  } catch {
    return String(params);
  }
}

export function SweepRunsTable({
  rows,
  maxExportNote,
  heatmapSelection,
  onClearHeatmapFilter,
}: {
  rows: SweepRunRow[];
  maxExportNote?: string;
  heatmapSelection: { xBin: number; yBin: number } | null;
  onClearHeatmapFilter: () => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const list = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const ma = a.metrics ?? {};
      const mb = b.metrics ?? {};
      const pa = a.params ?? {};
      const pb = b.params ?? {};
      switch (sortKey) {
        case "id":
          return dir * ((Number(a.id) || 0) - (Number(b.id) || 0));
        case "score":
          return dir * ((Number(a.scoreRawHoldoutOrFull) || 0) - (Number(b.scoreRawHoldoutOrFull) || 0));
        case "totalReturnUsd":
          return dir * ((Number(ma.totalReturnUsd) || 0) - (Number(mb.totalReturnUsd) || 0));
        case "winRate":
          return dir * ((Number(ma.winRate) || 0) - (Number(mb.winRate) || 0));
        case "profitFactor": {
          const pfa = ma.profitFactor;
          const pfb = mb.profitFactor;
          return dir * ((Number(pfa) || 0) - (Number(pfb) || 0));
        }
        case "tradeCount":
          return dir * ((Number(ma.tradeCount) || 0) - (Number(mb.tradeCount) || 0));
        case "params":
          return dir * String(formatParamsCompact(pa)).localeCompare(String(formatParamsCompact(pb)));
        default:
          return 0;
      }
    });
    return list;
  }, [rows, sortKey, sortDir]);

  const filtered = useMemo(() => {
    if (!heatmapSelection) return sorted;
    return sorted.filter((r) => {
      const hb = r.heatmapBin;
      if (!hb || hb.xBin == null || hb.yBin == null) return false;
      return hb.xBin === heatmapSelection.xBin && hb.yBin === heatmapSelection.yBin;
    });
  }, [sorted, heatmapSelection]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "params" || k === "id" ? "asc" : "desc");
    }
  };

  const th = (k: SortKey, label: string) => (
    <th className="py-1.5 pr-2 text-left font-medium text-zinc-400 cursor-pointer hover:text-zinc-200" onClick={() => toggleSort(k)}>
      {label}
      {sortKey === k ? (sortDir === "desc" ? " \u2193" : " \u2191") : ""}
    </th>
  );

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-indigo-700/40 bg-zinc-950/50 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-indigo-400/90 font-medium">
          Tabulka sweep běhů
        </div>
        <button
          type="button"
          onClick={() => setCompareOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-100 border border-indigo-700/50 shrink-0"
        >
          Porovnat všechny běhy (modal)
        </button>
      </div>
      {maxExportNote ? <p className="text-[11px] text-zinc-400 leading-relaxed">{maxExportNote}</p> : null}
      {heatmapSelection ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span>
            Aktivní filtr z heatmapy (sloupec xBin={heatmapSelection.xBin}, řádek yBin={heatmapSelection.yBin}): zobrazeno{" "}
            <strong className="text-zinc-200">{filtered.length}</strong> z <strong className="text-zinc-200">{rows.length}</strong>{" "}
            běhů v tabulce níže. Modal „Porovnat všechny běhy“ vždy ukáže <strong className="text-zinc-200">všech {rows.length}</strong>.
          </span>
          <button
            type="button"
            onClick={onClearHeatmapFilter}
            className="rounded border border-zinc-600 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800"
          >
            Zrušit filtr
          </button>
        </div>
      ) : null}
      {compareOpen ? <SweepRunsCompareModal rows={rows} onClose={() => setCompareOpen(false)} /> : null}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="sticky top-0 bg-zinc-950/95 border-b border-zinc-700 z-10">
            <tr>
              {th("id", "#")}
              {th("params", "Params")}
              {th("totalReturnUsd", "PnL $")}
              {th("winRate", "WR %")}
              {th("profitFactor", "PF")}
              {th("tradeCount", "Trades")}
              {th("score", "Skóre")}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const m = r.metrics ?? {};
              const pnl = Number(m.totalReturnUsd);
              const wr = Number(m.winRate);
              const tc = Number(m.tradeCount);
              const score = Number(r.scoreRawHoldoutOrFull);
              const pf = m.profitFactor;
              const pfStatus = typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined;
              return (
                <tr key={`${r.id ?? idx}-${idx}`} className="border-b border-zinc-800/80 text-zinc-300 align-top">
                  <td className="py-1.5 pr-2 tabular-nums">{r.id != null ? String(r.id) : "—"}</td>
                  <td
                    className="py-1.5 pr-2 max-w-[280px] font-mono text-[10px] text-zinc-400 truncate"
                    title={paramsTitle(r.params)}
                  >
                    {formatParamsCompact(r.params)}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{Number.isFinite(pnl) ? pnl.toFixed(2) : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{Number.isFinite(wr) ? `${wr.toFixed(1)}%` : "—"}</td>
                  <td className="py-1.5 pr-2">{formatProfitFactorDisplay(pf as number | null | undefined, pfStatus)}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{Number.isFinite(tc) ? String(tc) : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{Number.isFinite(score) ? score.toFixed(4) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
