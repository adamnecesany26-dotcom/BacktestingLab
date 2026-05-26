"use client";

import { useMemo, useState } from "react";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { SweepRunsCompareModal } from "@/components/results/SweepRunsCompareModal";
import type { SweepRunRow } from "@/components/results/sweepRunTypes";

export type { SweepRunRow } from "@/components/results/sweepRunTypes";

type SortKey =
  | "id"
  | "score"
  | "scoreAdj"
  | "totalReturnUsd"
  | "trainPnl"
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
  outlierScoreThreshold,
}: {
  rows: SweepRunRow[];
  maxExportNote?: string;
  heatmapSelection: { xBin: number; yBin: number } | null;
  onClearHeatmapFilter: () => void;
  /** Top ~1 % skóre — označ outlier v tabulce (volitelné, novější engine). */
  outlierScoreThreshold?: number | null;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const holdoutCols = useMemo(() => rows.some((r) => r.holdoutEnabled === true), [rows]);

  const sorted = useMemo(() => {
    const list = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const ma = a.metrics ?? {};
      const mb = b.metrics ?? {};
      const mta = a.metricsTrain ?? {};
      const mtb = b.metricsTrain ?? {};
      const pa = a.params ?? {};
      const pb = b.params ?? {};
      switch (sortKey) {
        case "id":
          return dir * ((Number(a.id) || 0) - (Number(b.id) || 0));
        case "score":
          return dir * ((Number(a.scoreRawHoldoutOrFull) || 0) - (Number(b.scoreRawHoldoutOrFull) || 0));
        case "scoreAdj":
          return dir * ((Number(a.scoreMultipleTestingAdjusted) || 0) - (Number(b.scoreMultipleTestingAdjusted) || 0));
        case "totalReturnUsd":
          return dir * ((Number(ma.totalReturnUsd) || 0) - (Number(mb.totalReturnUsd) || 0));
        case "trainPnl":
          return dir * ((Number(mta.totalReturnUsd) || 0) - (Number(mtb.totalReturnUsd) || 0));
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

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => formatParamsCompact(r.params).toLowerCase().includes(q));
  }, [sorted, search]);

  const filtered = useMemo(() => {
    if (!heatmapSelection) return searchFiltered;
    return searchFiltered.filter((r) => {
      const hb = r.heatmapBin;
      if (!hb || hb.xBin == null || hb.yBin == null) return false;
      return hb.xBin === heatmapSelection.xBin && hb.yBin === heatmapSelection.yBin;
    });
  }, [searchFiltered, heatmapSelection]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "params" || k === "id" ? "asc" : "desc");
    }
  };

  const th = (k: SortKey, label: string, extraClass = "") => (
    <th
      className={`py-2.5 px-2 text-left text-[10px] uppercase tracking-wider text-zinc-500 font-semibold cursor-pointer hover:text-cyan-300/90 transition-colors whitespace-nowrap ${extraClass}`}
      onClick={() => toggleSort(k)}
    >
      {label}
      {sortKey === k ? (sortDir === "desc" ? " \u2193" : " \u2191") : ""}
    </th>
  );

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/70 shadow-lg shadow-black/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-zinc-100">Detailní tabulka běhů</h4>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Řazení klikem na hlavičku · výchozí = surové skóre (holdout / full dle enginu)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrovat params…"
            className="min-w-[10rem] flex-1 sm:flex-initial rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-cyan-600/50"
            aria-label="Filtrovat sweep podle textu parametrů"
          />
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-cyan-900/40 hover:bg-cyan-800/50 text-cyan-100 border border-cyan-700/40 font-medium shrink-0"
          >
            Porovnat v modalu
          </button>
        </div>
      </div>

      {maxExportNote ? <p className="text-[11px] text-zinc-500 px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/40">{maxExportNote}</p> : null}

      {heatmapSelection ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-zinc-400 bg-cyan-950/15 border-b border-cyan-900/20">
          <span>
            Filtr z heatmapy <span className="font-mono text-cyan-200">x={heatmapSelection.xBin}</span>,{" "}
            <span className="font-mono text-cyan-200">y={heatmapSelection.yBin}</span>:{" "}
            <strong className="text-zinc-200">{filtered.length}</strong> / {rows.length} řádků
          </span>
          <button
            type="button"
            onClick={onClearHeatmapFilter}
            className="rounded-md border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            Zrušit filtr
          </button>
        </div>
      ) : null}

      {compareOpen ? <SweepRunsCompareModal rows={rows} onClose={() => setCompareOpen(false)} /> : null}

      <div className="overflow-x-auto max-h-[min(520px,55vh)] overflow-y-auto">
        <table className="w-full text-xs text-left border-collapse min-w-[720px]">
          <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/98 backdrop-blur-sm">
            <tr>
              {th("id", "#")}
              {th("params", "Parametry", "min-w-[200px]")}
              {holdoutCols ? th("trainPnl", "Train P/L $") : null}
              {th("totalReturnUsd", holdoutCols ? "OOS / full $" : "P/L $")}
              {th("winRate", "WR %")}
              {th("profitFactor", "PF")}
              {th("tradeCount", "Tr")}
              {th("score", "Skóre")}
              {th("scoreAdj", "Skóre adj.")}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const m = r.metrics ?? {};
              const mt = r.metricsTrain ?? {};
              const pnl = Number(m.totalReturnUsd);
              const trainPnl = Number(mt.totalReturnUsd);
              const wr = Number(m.winRate);
              const tc = Number(m.tradeCount);
              const score = Number(r.scoreRawHoldoutOrFull);
              const scoreAdj = Number(r.scoreMultipleTestingAdjusted);
              const pf = m.profitFactor;
              const pfStatus = typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined;
              const outlier =
                outlierScoreThreshold != null &&
                Number.isFinite(outlierScoreThreshold) &&
                Number.isFinite(score) &&
                score >= outlierScoreThreshold;
              const zebra = idx % 2 === 0 ? "bg-zinc-950/20" : "bg-zinc-900/15";
              const nextRow = filtered[idx + 1];
              const nextPnl = nextRow ? Number((nextRow.metrics ?? {}).totalReturnUsd) : NaN;
              const rankDelta =
                idx < 15 && Number.isFinite(pnl) && Number.isFinite(nextPnl) ? pnl - nextPnl : null;
              return (
                <tr
                  key={`${r.id ?? idx}-${idx}`}
                  className={`border-b border-zinc-800/50 text-zinc-300 align-top transition-colors hover:bg-cyan-950/20 ${zebra}`}
                >
                  <td className="py-2 px-2 tabular-nums text-zinc-500 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span>{r.id != null ? String(r.id) : "—"}</span>
                      {outlier ? (
                        <span
                          className="text-[9px] font-medium text-violet-300/95 max-w-[4.5rem] leading-tight"
                          title="Horní ~1 % skóre v tomto sweepu — izolovaný peak může být náhodný / přeladěný."
                        >
                          top 1 % skóre
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td
                    className="py-2 px-2 max-w-[320px] font-mono text-[10px] text-zinc-400 align-top"
                    title={paramsTitle(r.params)}
                  >
                    <div className="truncate">{formatParamsCompact(r.params)}</div>
                    {rankDelta != null ? (
                      <div className="text-[9px] text-zinc-600 mt-0.5 whitespace-normal" title="Rozdíl P/L oproti dalšímu řádku v aktuálním řazení tabulky">
                        Δ k dalšímu v ranku:{" "}
                        <span className={rankDelta >= 0 ? "text-emerald-500/90" : "text-rose-500/80"}>
                          {rankDelta >= 0 ? "+" : ""}
                          {rankDelta.toFixed(2)} $
                        </span>
                      </div>
                    ) : null}
                  </td>
                  {holdoutCols ? (
                    <td className={`py-2 px-2 tabular-nums ${trainPnl >= 0 ? "text-sky-300/95" : "text-orange-300/90"}`}>
                      {Number.isFinite(trainPnl) ? trainPnl.toFixed(2) : "—"}
                    </td>
                  ) : null}
                  <td className={`py-2 px-2 tabular-nums font-medium ${pnl >= 0 ? "text-emerald-400/90" : "text-rose-400/90"}`}>
                    {Number.isFinite(pnl) ? pnl.toFixed(2) : "—"}
                  </td>
                  <td className="py-2 px-2 tabular-nums">{Number.isFinite(wr) ? `${wr.toFixed(1)}%` : "—"}</td>
                  <td className="py-2 px-2">{formatProfitFactorDisplay(pf as number | null | undefined, pfStatus)}</td>
                  <td className="py-2 px-2 tabular-nums text-zinc-400">{Number.isFinite(tc) ? String(tc) : "—"}</td>
                  <td className="py-2 px-2 tabular-nums font-mono text-cyan-200/90">{Number.isFinite(score) ? score.toFixed(3) : "—"}</td>
                  <td className="py-2 px-2 tabular-nums font-mono text-zinc-500">{Number.isFinite(scoreAdj) ? scoreAdj.toFixed(3) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && searchFiltered.length > 0 ? (
        <div className="px-4 py-6 text-center text-sm text-zinc-500">Žádný řádek po filtru — zkus jiný text nebo zruš filtr heatmapy.</div>
      ) : null}
    </div>
  );
}
