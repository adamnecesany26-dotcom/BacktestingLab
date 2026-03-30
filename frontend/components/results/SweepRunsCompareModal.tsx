"use client";

import { useEffect, useMemo } from "react";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import type { SweepRunRow } from "@/components/results/sweepRunTypes";

function formatParamsJson(params: Record<string, unknown> | undefined): string {
  if (!params || typeof params !== "object") return "{}";
  try {
    return JSON.stringify(params, null, 2);
  } catch {
    return String(params);
  }
}

export function SweepRunsCompareModal({ rows, onClose }: { rows: SweepRunRow[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ordered = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => (Number(b.scoreRawHoldoutOrFull) || 0) - (Number(a.scoreRawHoldoutOrFull) || 0));
    return list;
  }, [rows]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-zinc-900 rounded-xl border border-indigo-700/50 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sweep-compare-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-700 shrink-0">
          <div>
            <h2 id="sweep-compare-title" className="text-lg font-semibold text-zinc-100">
              Porovnání sweep běhů
            </h2>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-2xl">
              Každý blok = jeden samostatný backtest v rámci robustness sweepu. Uvnitř je{" "}
              <strong className="text-zinc-400">kompletní JSON parametrů</strong> (včetně vnořených hodnot, např.{" "}
              <code className="text-zinc-400">module_params</code>). Stejný sweep může měnit{" "}
              <strong className="text-zinc-400">více číselných PARAMS najednou</strong> — srovnej řádky mezi sebou.
            </p>
            <p className="text-[11px] text-zinc-600 mt-2">Počet běhů v tomto exportu: {ordered.length}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
            aria-label="Zavřít"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1 min-h-0">
          {ordered.map((r, idx) => {
            const m = r.metrics ?? {};
            const pnl = Number(m.totalReturnUsd);
            const wr = Number(m.winRate);
            const tc = Number(m.tradeCount);
            const score = Number(r.scoreRawHoldoutOrFull);
            const pf = m.profitFactor;
            const pfStatus = typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined;
            const hb = r.heatmapBin;
            return (
              <div
                key={`${r.id ?? idx}-compare-${idx}`}
                className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-zinc-200">
                  <span className="font-semibold text-indigo-300">Běh #{r.id != null ? String(r.id) : idx + 1}</span>
                  <span className="text-zinc-400">
                    Skóre: {Number.isFinite(score) ? score.toFixed(4) : "—"} · PnL:{" "}
                    {Number.isFinite(pnl) ? `$${pnl.toFixed(2)}` : "—"} · WR:{" "}
                    {Number.isFinite(wr) ? `${wr.toFixed(1)}%` : "—"} · PF:{" "}
                    {formatProfitFactorDisplay(pf as number | null | undefined, pfStatus)} · Trades:{" "}
                    {Number.isFinite(tc) ? tc : "—"}
                  </span>
                  {hb != null && hb.xBin != null && hb.yBin != null ? (
                    <span className="text-[11px] text-zinc-500">
                      Heatmap buňka: xBin={hb.xBin}, yBin={hb.yBin}
                    </span>
                  ) : null}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Všechna nastavení (params)</div>
                  <pre className="text-[11px] leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/80 p-2">
                    {formatParamsJson(r.params)}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-zinc-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 border border-zinc-600"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}
