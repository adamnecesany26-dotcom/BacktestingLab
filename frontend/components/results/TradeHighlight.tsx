"use client";

import { useMemo, useState } from "react";
import type { Trade } from "@shared/types";

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

function formatUsdOptional(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(5);
}

/** Délka obchodu: preferuje holdingMinutes, jinak počet barů. */
function formatTradeDuration(t: Trade): string {
  const hm = t.holdingMinutes;
  if (hm != null && Number.isFinite(hm) && hm >= 0) {
    const totalMin = Math.round(hm);
    const d = Math.floor(totalMin / (24 * 60));
    const h = Math.floor((totalMin % (24 * 60)) / 60);
    const m = totalMin % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m || parts.length === 0) parts.push(`${m}m`);
    return parts.join(" ");
  }
  const bh = t.barsHeld;
  if (bh != null && Number.isFinite(bh)) return `${Math.round(bh)} barů`;
  return "—";
}

type TradeSort =
  | "index"
  | "pnl_desc"
  | "pnl_asc"
  | "entry_desc"
  | "entry_asc"
  | "exit_desc"
  | "exit_asc"
  | "duration_desc"
  | "duration_asc";

interface TradeHighlightProps {
  trades: Trade[];
}

export function TradeHighlight({ trades }: TradeHighlightProps) {
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
    const durMin = (t: Trade) =>
      t.holdingMinutes != null && Number.isFinite(t.holdingMinutes) && t.holdingMinutes >= 0
        ? t.holdingMinutes
        : t.barsHeld != null && Number.isFinite(t.barsHeld)
          ? t.barsHeld
          : -1;
    if (sort === "index") return idx;
    if (sort === "pnl_desc") return [...idx].sort((a, b) => pnl(trades[b]!) - pnl(trades[a]!));
    if (sort === "pnl_asc") return [...idx].sort((a, b) => pnl(trades[a]!) - pnl(trades[b]!));
    if (sort === "entry_desc") return [...idx].sort((a, b) => entryMs(trades[b]!) - entryMs(trades[a]!));
    if (sort === "entry_asc") return [...idx].sort((a, b) => entryMs(trades[a]!) - entryMs(trades[b]!));
    if (sort === "exit_desc") return [...idx].sort((a, b) => exitMs(trades[b]!) - exitMs(trades[a]!));
    if (sort === "exit_asc") return [...idx].sort((a, b) => exitMs(trades[a]!) - exitMs(trades[b]!));
    if (sort === "duration_desc") return [...idx].sort((a, b) => durMin(trades[b]!) - durMin(trades[a]!));
    return [...idx].sort((a, b) => durMin(trades[a]!) - durMin(trades[b]!));
  }, [trades, sort]);

  if (trades.length === 0) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">Žádné obchody k zobrazení</div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4 h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h3 className="text-sm font-medium text-zinc-300">Obchody ({trades.length})</h3>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Řazení
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as TradeSort)}
            className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200 text-xs"
          >
            <option value="index">Pořadí ve strategii</option>
            <option value="pnl_desc">PnL nejvyšší → nejnižší</option>
            <option value="pnl_asc">PnL nejnižší → nejvyšší</option>
            <option value="duration_desc">Délka ↓</option>
            <option value="duration_asc">Délka ↑</option>
            <option value="entry_desc">Vstup ↓</option>
            <option value="entry_asc">Vstup ↑</option>
            <option value="exit_desc">Výstup ↓</option>
            <option value="exit_asc">Výstup ↑</option>
          </select>
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-700/45 bg-zinc-950/35">
        <div className="overflow-x-auto min-h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-800/95 z-10 backdrop-blur-sm">
              <tr className="border-b border-zinc-800">
                <th className="px-3 py-2 text-left font-medium text-zinc-400 whitespace-nowrap">#</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-400 whitespace-nowrap">Vstup</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-400 whitespace-nowrap">Výstup</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-400 whitespace-nowrap">Délka</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-400 whitespace-nowrap">Typ</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">Vel.</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">Vstup px</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">Výstup px</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">PnL</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">Poplatky</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">R</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">MFE</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400 whitespace-nowrap">MAE</th>
              </tr>
            </thead>
            <tbody>
              {order.map((origIdx) => {
                const t = trades[origIdx]!;
                const pnl = t.pnl ?? 0;
                const isWin = pnl >= 0;
                const mfeDisp =
                  t.mfeUsd != null && Number.isFinite(t.mfeUsd)
                    ? formatUsdOptional(t.mfeUsd)
                    : t.mfe != null && Number.isFinite(t.mfe)
                      ? t.mfe.toFixed(5)
                      : "—";
                const maeDisp =
                  t.maeUsd != null && Number.isFinite(t.maeUsd)
                    ? formatUsdOptional(t.maeUsd)
                    : t.mae != null && Number.isFinite(t.mae)
                      ? t.mae.toFixed(5)
                      : "—";
                const rDisp =
                  t.tradeR != null && Number.isFinite(t.tradeR) ? t.tradeR.toFixed(2) : "—";
                return (
                  <tr
                    key={origIdx}
                    className="border-b border-zinc-800/80 hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{origIdx + 1}</td>
                    <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{formatDate(t.entryDate ?? t.date)}</td>
                    <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{formatDate(t.exitDate ?? t.date)}</td>
                    <td className="px-3 py-2 text-zinc-400 whitespace-nowrap tabular-nums">
                      {formatTradeDuration(t)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
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
                    <td className="px-3 py-2 text-right text-zinc-300 font-mono whitespace-nowrap">
                      {t.size != null && Number.isFinite(t.size) ? t.size : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-300 font-mono whitespace-nowrap">
                      {formatPrice(t.entryPrice)}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-300 font-mono whitespace-nowrap">
                      {formatPrice(t.exitPrice ?? t.price)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-medium whitespace-nowrap ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {formatPnl(t.pnl)}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400 font-mono text-xs whitespace-nowrap">
                      {t.fees != null && Number.isFinite(t.fees) ? `$${t.fees.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-400/90 font-mono text-xs whitespace-nowrap">
                      {rDisp}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400 font-mono text-xs whitespace-nowrap" title="USD pokud engine poslal mfeUsd, jinak jednotky ceny">
                      {mfeDisp}
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400 font-mono text-xs whitespace-nowrap" title="USD pokud engine poslal maeUsd, jinak jednotky ceny">
                      {maeDisp}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-zinc-600 shrink-0">
        Sloupce MFE/MAE: pokud je v datech <code className="text-zinc-500">mfeUsd</code> /{" "}
        <code className="text-zinc-500">maeUsd</code>, zobrazí se v USD; jinak hrubé hodnoty z backtestu v jednotkách
        instrumentu.
      </p>
    </div>
  );
}
