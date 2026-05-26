import type { NormalizedMcTrade } from "./trades";

export interface EquityPathStats {
  equity: number[];
  maxDrawdownPct: number;
  finalEquity: number;
  winRate: number;
}

export function buildEquityPath(initial: number, pnls: number[]): EquityPathStats {
  const equity: number[] = [initial];
  let peak = initial;
  let maxDd = 0;
  let wins = 0;
  let e = initial;
  for (const p of pnls) {
    e += p;
    equity.push(e);
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = ((peak - e) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
    if (p > 0) wins += 1;
  }
  const n = pnls.length;
  return {
    equity,
    maxDrawdownPct: maxDd,
    finalEquity: e,
    winRate: n > 0 ? wins / n : 0,
  };
}

export function reorderTrades(trades: NormalizedMcTrade[], order: number[]): NormalizedMcTrade[] {
  return order.map((i) => trades[i]!);
}
