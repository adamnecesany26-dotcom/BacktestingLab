import { buildEquityPath, reorderTrades } from "./equity";
import { mulberry32, shuffleIndices } from "./rng";
import type { NormalizedMcTrade } from "./trades";

export interface ShuffleSimRunResult {
  maxDrawdownPct: number;
  finalEquity: number;
  winRate: number;
  equity: number[];
  /** Celkový výnos od initial (%) — stejné obchody, jen jiné pořadí. */
  totalReturnPct: number;
  /** Hrubý zisk / hrubá ztráta (bez horizontálního capu v engine). */
  profitFactor: number;
  /** Průměrný PnL na obchod v tomto shufflu. */
  expectancy: number;
  /** Směrodatná odchylka PnL (šíře rozptylu). */
  pnlStd: number;
  /** Nejdelší série záporných obchodů v tomto pořadí. */
  maxConsecutiveLosses: number;
  /** totalReturnPct / maxDrawdownPct — poměr výnos / max. DD v daném shuffle (Calmar‑like). */
  returnOverMaxDd: number;
  /** Hrubý poměr: průměr(PnL) / směr.odch. × √n — porovnání šum vs. sklon bez benchmarku. */
  sharpeLike: number;
}

function computeShuffleTradeStats(
  pnls: number[],
  initial: number,
  maxDrawdownPct: number,
  finalEquity: number,
): Pick<
  ShuffleSimRunResult,
  | "totalReturnPct"
  | "profitFactor"
  | "expectancy"
  | "pnlStd"
  | "maxConsecutiveLosses"
  | "returnOverMaxDd"
  | "sharpeLike"
> {
  const n = pnls.length;
  const totalReturnPct = initial > 0 ? ((finalEquity - initial) / initial) * 100 : 0;

  let grossWin = 0;
  let grossLoss = 0;
  let maxConsec = 0;
  let curConsec = 0;

  for (const p of pnls) {
    if (p > 0) {
      grossWin += p;
      curConsec = 0;
    } else if (p < 0) {
      grossLoss += p;
      curConsec += 1;
      maxConsec = Math.max(maxConsec, curConsec);
    } else {
      curConsec = 0;
    }
  }

  let profitFactor = 0;
  if (grossLoss < 0) profitFactor = grossWin / Math.abs(grossLoss);
  else if (grossWin > 0) profitFactor = 1e9;

  const sum = pnls.reduce((a, b) => a + b, 0);
  const mean = n > 0 ? sum / n : 0;
  let pnlStd = 0;
  if (n > 1) {
    let v = 0;
    for (const p of pnls) {
      const d = p - mean;
      v += d * d;
    }
    pnlStd = Math.sqrt(v / (n - 1));
  }

  const sharpeLike = pnlStd > 1e-12 ? (mean / pnlStd) * Math.sqrt(n) : 0;

  let returnOverMaxDd = 0;
  if (maxDrawdownPct > 1e-6) returnOverMaxDd = totalReturnPct / maxDrawdownPct;
  else if (totalReturnPct > 0) returnOverMaxDd = 1e9;
  else if (totalReturnPct < 0) returnOverMaxDd = -1e9;

  return {
    totalReturnPct,
    profitFactor: Math.min(profitFactor, 1e9),
    expectancy: mean,
    pnlStd,
    maxConsecutiveLosses: maxConsec,
    returnOverMaxDd: Math.min(Math.max(returnOverMaxDd, -1e9), 1e9),
    sharpeLike,
  };
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - pos) + sorted[hi]! * (pos - lo);
}

export function runSingleShuffleSim(
  trades: NormalizedMcTrade[],
  initial: number,
  seed: number,
): ShuffleSimRunResult {
  const rng = mulberry32(seed);
  const order = shuffleIndices(trades.length, rng);
  const ordered = reorderTrades(trades, order);
  const pnls = ordered.map((t) => t.pnl);
  const { equity, maxDrawdownPct, finalEquity, winRate } = buildEquityPath(initial, pnls);
  const tradeStats = computeShuffleTradeStats(pnls, initial, maxDrawdownPct, finalEquity);
  return { maxDrawdownPct, finalEquity, winRate, equity, ...tradeStats };
}

export function aggregateShuffleEquityBands(results: ShuffleSimRunResult[]): {
  equityP10: number[];
  equityP50: number[];
  equityP90: number[];
} {
  const len = results[0]?.equity.length ?? 0;
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  for (let i = 0; i < len; i++) {
    const slice = results
      .map((r) => r.equity[i])
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .sort((a, b) => a - b);
    p10.push(quantileSorted(slice, 0.1));
    p50.push(quantileSorted(slice, 0.5));
    p90.push(quantileSorted(slice, 0.9));
  }
  return { equityP10: p10, equityP50: p50, equityP90: p90 };
}
