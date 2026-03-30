"use client";

import { useEffect, useMemo, useState } from "react";
import { TradeHighlightChart } from "@/components/charts/TradeHighlightChart";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";

interface TradeHighlightProps {
  ohlc: OhlcBar[];
  trades: Trade[];
  chartHeight?: number;
}

function formatDate(s: string | undefined): string {
  if (!s) return "—";
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return s;
  const hasTime = /T\d{2}:\d{2}/.test(s) || /\s\d{2}:\d{2}/.test(s);
  return parsed.toLocaleString("cs-CZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : {}),
  });
}

function formatPnl(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}$${n.toFixed(2)}`;
}

type TradeSort =
  | "index"
  | "pnl_desc"
  | "pnl_asc"
  | "entry_desc"
  | "entry_asc"
  | "exit_desc"
  | "exit_asc";

export function TradeHighlight({ ohlc, trades, chartHeight = 360 }: TradeHighlightProps) {
  const [sort, setSort] = useState<TradeSort>("index");
  const order = useMemo(() => {
    const idx = trades.map((_, i) => i);
    const entryMs = (t: Trade) => {
      const s = t.entryDate ?? t.date ?? "";
      const ms = Date.parse(s);
      return Number.isFinite(ms) ? ms : 0;
    };
    const exitMs = (t: Trade) => {
      const s = t.exitDate ?? t.date ?? "";
      const ms = Date.parse(s);
      return Number.isFinite(ms) ? ms : 0;
    };
    const pnl = (t: Trade) => (t.pnl != null && Number.isFinite(t.pnl) ? t.pnl : 0);
    if (sort === "index") return idx;
    if (sort === "pnl_desc") return [...idx].sort((a, b) => pnl(trades[b]!) - pnl(trades[a]!));
    if (sort === "pnl_asc") return [...idx].sort((a, b) => pnl(trades[a]!) - pnl(trades[b]!));
    if (sort === "entry_desc") return [...idx].sort((a, b) => entryMs(trades[b]!) - entryMs(trades[a]!));
    if (sort === "entry_asc") return [...idx].sort((a, b) => entryMs(trades[a]!) - entryMs(trades[b]!));
    if (sort === "exit_desc") return [...idx].sort((a, b) => exitMs(trades[b]!) - exitMs(trades[a]!));
    return [...idx].sort((a, b) => exitMs(trades[a]!) - exitMs(trades[b]!));
  }, [trades, sort]);

  const [selectedOrderPos, setSelectedOrderPos] = useState(0);
  useEffect(() => {
    if (trades.length === 0) {
      setSelectedOrderPos(0);
      return;
    }
    setSelectedOrderPos((p) => (p >= order.length ? 0 : p));
  }, [trades.length, order.length]);

  const selectedOriginalIndex = order.length > 0 ? order[Math.min(selectedOrderPos, order.length - 1)]! : null;
  const selectedTrade =
    selectedOriginalIndex != null && trades[selectedOriginalIndex] ? trades[selectedOriginalIndex] : null;

  if (trades.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">
        Žádné obchody k zobrazení
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4 h-full min-h-0 overflow-auto">
      <div className="shrink-0 space-y-2">
        <TradeHighlightChart
          ohlc={ohlc}
          trade={selectedTrade}
          height={chartHeight}
        />
        {selectedTrade && (
          <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400 space-y-1">
            <p className="text-zinc-300 font-medium">Interpretace vs. PnL</p>
            <p>
              <span className="text-zinc-500">Fill ceny (engine):</span>{" "}
              <span className="font-mono text-zinc-200">
                {selectedTrade.entryPrice != null ? selectedTrade.entryPrice.toFixed(5) : "—"} →{" "}
                {selectedTrade.exitPrice != null ? selectedTrade.exitPrice.toFixed(5) : "—"}
              </span>
              {selectedTrade.type === "buy" &&
                selectedTrade.entryPrice != null &&
                selectedTrade.exitPrice != null && (
                  <span className="text-zinc-500">
                    {" "}
                    (long: hrubý zisk v ceně instrumentu, když je exit vyšší než entry)
                  </span>
                )}
            </p>
            <p>
              <span className="text-zinc-500">PnL (po poplatcích, pnlcomm):</span>{" "}
              <span className="font-mono text-zinc-200">{formatPnl(selectedTrade.pnl)}</span>
              {selectedTrade.fees != null && (
                <>
                  {" "}
                  <span className="text-zinc-500">| poplatky:</span>{" "}
                  <span className="font-mono">${Number(selectedTrade.fees).toFixed(2)}</span>
                </>
              )}
              {selectedTrade.slippageCost != null && Number(selectedTrade.slippageCost) > 0 && (
                <>
                  {" "}
                  <span className="text-zinc-500">| odhad slippage v payloadu:</span>{" "}
                  <span className="font-mono">${Number(selectedTrade.slippageCost).toFixed(2)}</span>
                </>
              )}
            </p>
            <p className="text-zinc-500 leading-relaxed">
              Šipky ukazují bar nejblíž času vstupu/výstupu; u futures je USD výsledek násobený kontraktem
              (bod ceny × mult × size), takže malý nepříznivý pohyb ceny může dát velkou USD ztrátu. Čárkované
              linky na grafu = skutečné <code className="text-zinc-400">entryPrice</code> /{" "}
              <code className="text-zinc-400">exitPrice</code> z backtestu.
            </p>
          </div>
        )}
      </div>
      <div className="shrink-0 rounded-xl border border-zinc-700/45 bg-zinc-950/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium text-zinc-300">Obchody — klikni pro detail na grafu</h3>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Řazení
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as TradeSort);
                setSelectedOrderPos(0);
              }}
              className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200 text-xs"
            >
              <option value="index">Pořadí ve strategii</option>
              <option value="pnl_desc">PnL nejvyšší → nejnižší</option>
              <option value="pnl_asc">PnL nejnižší → nejvyšší</option>
              <option value="entry_desc">Datum vstupu ↓</option>
              <option value="entry_asc">Datum vstupu ↑</option>
              <option value="exit_desc">Datum výstupu ↓</option>
              <option value="exit_asc">Datum výstupu ↑</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-800 max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-800/95 z-10">
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-2 text-left font-medium text-zinc-400">#</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-400">Entry</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-400">Exit</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-400">Typ</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-400">PnL</th>
              </tr>
            </thead>
            <tbody>
              {order.map((origIdx, rowPos) => {
                const t = trades[origIdx]!;
                const pnl = t.pnl ?? 0;
                const isWin = pnl >= 0;
                const isSelected = selectedOrderPos === rowPos;
                return (
                  <tr
                    key={`${origIdx}-${rowPos}`}
                    onClick={() => setSelectedOrderPos(rowPos)}
                    className={`border-b border-zinc-800/80 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-emerald-500/20 hover:bg-emerald-500/25"
                        : "hover:bg-zinc-800/50"
                    }`}
                  >
                    <td className="px-4 py-2 text-zinc-400">{origIdx + 1}</td>
                    <td className="px-4 py-2 text-zinc-300">{formatDate(t.entryDate ?? t.date)}</td>
                    <td className="px-4 py-2 text-zinc-300">{formatDate(t.exitDate ?? t.date)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          t.type === "buy"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-rose-500/20 text-rose-400"
                        }`}
                      >
                        {t.type === "buy" ? "Long" : "Short"}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono font-medium ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {formatPnl(t.pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
