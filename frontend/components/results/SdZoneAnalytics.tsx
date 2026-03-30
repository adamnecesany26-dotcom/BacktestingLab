"use client";

import type { Trade } from "@shared/types";

function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

function metaObj(t: Trade): Record<string, unknown> | null {
  const m = t.zoneMeta;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  return m as Record<string, unknown>;
}

function num(m: Record<string, unknown>, k: string): number | null {
  const v = m[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(m: Record<string, unknown>, k: string): string | null {
  const v = m[k];
  if (typeof v === "string") return v;
  return null;
}

function boolish(m: Record<string, unknown>, k: string): boolean | null {
  const v = m[k];
  if (typeof v === "boolean") return v;
  return null;
}

function isWin(t: Trade): boolean {
  return (t.pnl ?? 0) > 0;
}

interface SdZoneAnalyticsProps {
  trades: Trade[];
}

export function SdZoneAnalytics({ trades }: SdZoneAnalyticsProps) {
  const withMeta = trades.filter((t) => metaObj(t) !== null);
  const n = withMeta.length;

  if (n === 0) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-6 text-center text-sm text-zinc-400">
        Žádný obchod nemá <code className="text-zinc-300">zoneMeta</code>. Spusť backtest se strategií S/D zón — metadata se přidají při plnění
        vstupní objednávky (limit nebo market).
      </div>
    );
  }

  const wins = withMeta.filter(isWin);
  const wr = pct(wins.length, n);

  const byName = (name: string) => withMeta.filter((t) => str(metaObj(t)!, "zoneName") === name);
  const demand = byName("Demand");
  const supply = byName("Supply");

  const hasInducement = (t: Trade) => {
    const m = metaObj(t)!;
    if (boolish(m, "hadInducement") === true) return true;
    const c = num(m, "inducementCount");
    return c != null && c > 0;
  };
  const withInd = withMeta.filter(hasInducement);
  const withoutInd = withMeta.filter((t) => !hasInducement(t));

  const baseVals = withMeta
    .map((t) => num(metaObj(t)!, "baseLength"))
    .filter((v): v is number => v != null);
  const baseWins = wins
    .map((t) => num(metaObj(t)!, "baseLength"))
    .filter((v): v is number => v != null);
  const avgBase = baseVals.length ? baseVals.reduce((a, b) => a + b, 0) / baseVals.length : null;
  const avgBaseWins = baseWins.length ? baseWins.reduce((a, b) => a + b, 0) / baseWins.length : null;

  const impulseWins = wins.map((t) => num(metaObj(t)!, "impulseScore")).filter((v): v is number => v != null);
  const impulseLoss = withMeta
    .filter((t) => !isWin(t))
    .map((t) => num(metaObj(t)!, "impulseScore"))
    .filter((v): v is number => v != null);
  const avgImpW =
    impulseWins.length ? impulseWins.reduce((a, b) => a + b, 0) / impulseWins.length : null;
  const avgImpL =
    impulseLoss.length ? impulseLoss.reduce((a, b) => a + b, 0) / impulseLoss.length : null;

  const tfMap = new Map<string, Trade[]>();
  for (const t of withMeta) {
    const tf = str(metaObj(t)!, "primaryTf") ?? "—";
    if (!tfMap.has(tf)) tfMap.set(tf, []);
    tfMap.get(tf)!.push(t);
  }
  const tfRows = Array.from(tfMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const touchTrue = withMeta.filter((t) => boolish(metaObj(t)!, "hasTouch") === true);
  const touchFalse = withMeta.filter((t) => boolish(metaObj(t)!, "hasTouch") !== true);
  const gapTrue = withMeta.filter((t) => boolish(metaObj(t)!, "hasGap") === true);
  const gapFalse = withMeta.filter((t) => boolish(metaObj(t)!, "hasGap") !== true);

  const byEntryStyle = (s: string) =>
    withMeta.filter((t) => (str(metaObj(t)!, "entryStyle") ?? "").toLowerCase() === s.toLowerCase());
  const styleEdge = byEntryStyle("limit_edge");
  const styleMid = byEntryStyle("limit_mid");
  const styleMom = byEntryStyle("market_momentum");

  const trapTrue = withMeta.filter((t) => boolish(metaObj(t)!, "trapZone") === true);
  const trapFalse = withMeta.filter((t) => boolish(metaObj(t)!, "trapZone") !== true);

  const dipVals = withMeta
    .map((t) => num(metaObj(t)!, "preEntryDipPct"))
    .filter((v): v is number => v != null);
  const avgDip = dipVals.length ? dipVals.reduce((a, b) => a + b, 0) / dipVals.length : null;

  const card = (label: string, value: string) => (
    <div key={label} className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm font-mono text-zinc-200 mt-1">{value}</div>
    </div>
  );

  const wrBar = (label: string, sub: string, winC: number, tot: number) => {
    const p = pct(winC, tot);
    return (
      <div key={label}>
        <div className="text-xs text-zinc-400 mb-1">
          {label} <span className="text-zinc-500">({sub})</span> — WR {p.toFixed(1)}%
        </div>
        <div className="h-2 rounded bg-zinc-800 overflow-hidden">
          <div className="h-full bg-emerald-500/90 transition-all" style={{ width: `${p}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {card("Obchodů se zoneMeta", String(n))}
        {card("Win rate (ze zoneMeta)", `${wr.toFixed(1)}%`)}
        {card("Výhry / prohry", `${wins.length} / ${n - wins.length}`)}
        {card("Průměr baseLength", avgBase != null ? avgBase.toFixed(2) : "—")}
        {card("Prům. base u výher", avgBaseWins != null ? avgBaseWins.toFixed(2) : "—")}
        {card("Demand (n / WR)", `${demand.length} / ${pct(demand.filter(isWin).length, demand.length).toFixed(0)}%`)}
        {card("Supply (n / WR)", `${supply.length} / ${pct(supply.filter(isWin).length, supply.length).toFixed(0)}%`)}
        {card(
          "Impulse Ø výhra / prohra",
          avgImpW != null && avgImpL != null ? `${avgImpW.toFixed(2)} / ${avgImpL.toFixed(2)}` : "—"
        )}
        {card("Ø preEntryDipPct", avgDip != null ? `${avgDip.toFixed(2)} %` : "—")}
      </div>

      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">Win rate — entryStyle</div>
        <div className="space-y-3 max-w-lg text-sm text-zinc-400">
          {wrBar("limit_edge", `n=${styleEdge.length}`, styleEdge.filter(isWin).length, styleEdge.length)}
          {wrBar("limit_mid", `n=${styleMid.length}`, styleMid.filter(isWin).length, styleMid.length)}
          {wrBar("market_momentum", `n=${styleMom.length}`, styleMom.filter(isWin).length, styleMom.length)}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">Win rate — inducement</div>
        <div className="space-y-3 max-w-lg">
          {wrBar("S inducementem", `n=${withInd.length}`, withInd.filter(isWin).length, withInd.length)}
          {wrBar("Bez inducementu", `n=${withoutInd.length}`, withoutInd.filter(isWin).length, withoutInd.length)}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Dotyk zóny (hasTouch)</div>
          <div className="space-y-2 text-sm text-zinc-300">
            <div>
              Ano: {touchTrue.length} obch. — WR {pct(touchTrue.filter(isWin).length, touchTrue.length).toFixed(1)}%
            </div>
            <div>
              Ne / neznámé: {touchFalse.length} obch. — WR{" "}
              {pct(touchFalse.filter(isWin).length, touchFalse.length).toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Gap u pivotu (hasGap)</div>
          <div className="space-y-2 text-sm text-zinc-300">
            <div>
              Ano: {gapTrue.length} obch. — WR {pct(gapTrue.filter(isWin).length, gapTrue.length).toFixed(1)}%
            </div>
            <div>
              Ne / neznámé: {gapFalse.length} obch. — WR{" "}
              {pct(gapFalse.filter(isWin).length, gapFalse.length).toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 md:col-span-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Retest zóny před vstupem (trapZone)</div>
          <div className="space-y-2 text-sm text-zinc-300">
            <div>
              Ano: {trapTrue.length} obch. — WR {pct(trapTrue.filter(isWin).length, trapTrue.length).toFixed(1)}%
            </div>
            <div>
              Ne / neznámé: {trapFalse.length} obch. — WR{" "}
              {pct(trapFalse.filter(isWin).length, trapFalse.length).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Podle primaryTf</div>
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-zinc-700 text-zinc-500 text-xs uppercase">
              <th className="py-2 pr-4">TF</th>
              <th className="py-2 pr-4 text-right">Obchodů</th>
              <th className="py-2 pr-4 text-right">Výher</th>
              <th className="py-2 text-right">WR %</th>
            </tr>
          </thead>
          <tbody>
            {tfRows.map(([tf, list]) => (
              <tr key={tf} className="border-b border-zinc-800/80 text-zinc-300">
                <td className="py-2 pr-4 font-mono">{tf}</td>
                <td className="py-2 pr-4 text-right">{list.length}</td>
                <td className="py-2 pr-4 text-right">{list.filter(isWin).length}</td>
                <td className="py-2 text-right">{pct(list.filter(isWin).length, list.length).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
