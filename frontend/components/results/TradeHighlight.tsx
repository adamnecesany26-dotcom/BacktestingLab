"use client";

import { useEffect, useState } from "react";
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

export function TradeHighlight({ ohlc, trades, chartHeight = 360 }: TradeHighlightProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    trades.length > 0 ? 0 : null
  );
  useEffect(() => {
    if (trades.length === 0) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex((prev) => (prev == null || prev >= trades.length ? 0 : prev));
  }, [trades]);
  const selectedTrade = selectedIndex != null && trades[selectedIndex] ? trades[selectedIndex] : null;

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
      <div className="shrink-0">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">Všechny obchody – klikněte pro detail</h3>
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
              {trades.map((t, i) => {
                const pnl = t.pnl ?? 0;
                const isWin = pnl >= 0;
                const isSelected = selectedIndex === i;
                return (
                  <tr
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={`border-b border-zinc-800/80 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-emerald-500/20 hover:bg-emerald-500/25"
                        : "hover:bg-zinc-800/50"
                    }`}
                  >
                    <td className="px-4 py-2 text-zinc-400">{i + 1}</td>
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
