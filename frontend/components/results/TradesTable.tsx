"use client";

import type { Trade } from "@shared/types";

interface TradesTableProps {
  trades: Trade[];
}

function formatDate(s: string | undefined): string {
  if (!s) return "—";
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : s;
}

function formatPrice(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function formatPnl(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}$${n.toFixed(2)}`;
}

function formatReturn(entry: number | undefined, exit: number | undefined): string {
  if (entry == null || exit == null || entry === 0 || Number.isNaN(entry) || Number.isNaN(exit)) return "—";
  const pct = ((exit - entry) / entry) * 100;
  const s = pct >= 0 ? "+" : "";
  return `${s}${pct.toFixed(2)}%`;
}

export function TradesTable({ trades }: TradesTableProps) {
  if (trades.length === 0) {
    return (
      <div className="py-8 text-center text-zinc-500 text-sm">
        Žádné obchody
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-800/50">
            <th className="px-4 py-3 text-left font-medium text-zinc-400">#</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Entry</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Exit</th>
            <th className="px-4 py-3 text-left font-medium text-zinc-400">Typ</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Entry Price</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Exit Price</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Size</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">Return %</th>
            <th className="px-4 py-3 text-right font-medium text-zinc-400">PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const entry = t.entryPrice ?? t.price;
            const exit = t.exitPrice ?? t.price;
            const pnl = t.pnl ?? 0;
            const isWin = pnl >= 0;
            return (
              <tr
                key={i}
                className="border-b border-zinc-800/80 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="px-4 py-2.5 text-zinc-400">{i + 1}</td>
                <td className="px-4 py-2.5 text-zinc-300">{formatDate(t.entryDate ?? t.date)}</td>
                <td className="px-4 py-2.5 text-zinc-300">{formatDate(t.exitDate ?? t.date)}</td>
                <td className="px-4 py-2.5">
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
                <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">
                  {formatPrice(entry)}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">
                  {formatPrice(exit)}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-300 font-mono">
                  {t.size}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {formatReturn(entry, exit)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-mono font-medium ${
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
  );
}
