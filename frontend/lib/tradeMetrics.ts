import type { EquityPoint, Trade } from "@shared/types";

/** Initial risk v USD (nebo měně účtu) z entry vs stop ze zoneMeta. */
export function getTradeInitialRiskUsd(trade: Trade): number | null {
  const zm = trade.zoneMeta as Record<string, unknown> | undefined;
  const stop = zm != null && zm.stopPrice != null ? Number(zm.stopPrice) : NaN;
  const entry = trade.entryPrice ?? trade.price;
  const sz = Math.abs(trade.size);
  if (!Number.isFinite(stop) || !Number.isFinite(entry) || !Number.isFinite(sz) || sz <= 0) return null;
  const riskPerUnit = trade.type === "buy" ? entry - stop : stop - entry;
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) return null;
  return riskPerUnit * sz;
}

/** R-násobek obchodu: PnL / počáteční riziko (pokud ho lze odvodit). */
export function tradeRFromTrade(trade: Trade): number | null {
  if (trade.tradeR != null && Number.isFinite(trade.tradeR)) return trade.tradeR;
  const pnl = trade.pnl;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  const risk = getTradeInitialRiskUsd(trade);
  if (risk == null || risk <= 0) return null;
  return pnl / risk;
}

function parseExitMs(t: Trade): number {
  return Date.parse(t.exitDate ?? t.entryDate ?? t.date ?? "");
}

/** Kumulativní součet R po uzavřených obchodech (řazeno podle exitDate). */
export function buildCumulativeREquityCurve(trades: Trade[]): EquityPoint[] {
  const closed = trades.filter((t) => Number.isFinite(parseExitMs(t)));
  closed.sort((a, b) => parseExitMs(a) - parseExitMs(b));
  let cum = 0;
  const out: EquityPoint[] = [];
  for (const t of closed) {
    const r = tradeRFromTrade(t);
    if (r == null || !Number.isFinite(r)) continue;
    cum += r;
    const d = t.exitDate ?? t.entryDate ?? t.date;
    if (d) out.push({ date: d, value: cum });
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo);
}

export type TradeRMultipleSummary = {
  count: number;
  mean: number;
  median: number;
  p5: number;
  p95: number;
};

export function summarizeTradeRMultiples(trades: Trade[]): TradeRMultipleSummary | null {
  const rs = trades.map(tradeRFromTrade).filter((x): x is number => x != null && Number.isFinite(x));
  if (!rs.length) return null;
  rs.sort((a, b) => a - b);
  const sum = rs.reduce((a, b) => a + b, 0);
  return {
    count: rs.length,
    mean: sum / rs.length,
    median: percentile(rs, 0.5),
    p5: percentile(rs, 0.05),
    p95: percentile(rs, 0.95),
  };
}
