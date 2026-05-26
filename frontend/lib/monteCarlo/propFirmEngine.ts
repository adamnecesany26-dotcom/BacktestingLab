import { reorderTrades } from "./equity";
import { mulberry32, shuffleIndices } from "./rng";
import { medianAbsPnls, medianPositive, type NormalizedMcTrade } from "./trades";

export type PropFirmFailReason =
  | "max_drawdown"
  | "daily_drawdown"
  | "max_daily_loss_usd"
  | "incomplete"
  | "consistency";

/** Trailing: kontrola max DD z intradenního / intra-trade high (peak se posouvá i v průběhu dne). EOD: max DD jen z **uzavřených** denních equity — během dne se ceiling nezvedá podle intradenních peaků. */
export type OverallDrawdownMode = "trailing" | "eod";

export type RiskNormalizeMode = "as_backtest" | "fixed_usd" | "range_usd" | "align_median_risk";

export interface PropFirmConfig {
  profitTargetPct: number;
  maxDdMode: "percent" | "absolute";
  maxDdValue: number;
  overallDrawdownMode: OverallDrawdownMode;

  dailyDdLimitPct: number;
  maxDailyLossUsd: number;

  consistencyMaxDayProfitPct: number;

  riskMode: "percent" | "fixed";
  riskPercent: number;
  riskFixedUsd: number;

  riskNormalizeMode: RiskNormalizeMode;
  riskNormFixedUsd: number;
  riskNormRangeMinUsd: number;
  riskNormRangeMaxUsd: number;

  stressAvgRPct: number;
  stressWinRatePts: number;
}

export interface PropFirmRunResult {
  passed: boolean;
  failReason: PropFirmFailReason | null;
  tradesToPass: number | null;
  equity: number[];
  /** Konečná equity po cestě (úspěch = ≥ cíl, neúspěch = stav při failu / nedokončení). */
  finalEquity: number;
  /** Maximální drawdown (%) podél celé equity cesty v simulaci. */
  maxDrawdownPct: number;
  /** Celkový výnos od initial k finalEquity (%). */
  totalReturnPct: number;
}

export interface PropPreparedTrade {
  pnl: number;
  dayKey: string;
  mfeUsd: number | null;
  maeUsd: number | null;
}

function uniformUsd(rng: () => number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo + (hi - lo) * rng();
}

function globalPnlMultiplier(cfg: PropFirmConfig, trades: NormalizedMcTrade[]): number {
  const baselinePct = 1;
  if (cfg.riskMode === "percent") {
    return cfg.riskPercent / baselinePct;
  }
  const ref = medianAbsPnls(trades);
  return cfg.riskFixedUsd / Math.max(ref, 1e-9);
}

function medianRiskReference(trades: NormalizedMcTrade[]): number {
  const risks = trades.map((t) => t.initialRiskUsd).filter((x): x is number => x != null && x > 0);
  const medR = medianPositive(risks, 0);
  if (medR > 0) return medR;
  return Math.max(medianAbsPnls(trades), 1e-9);
}

function effectiveRiskPerTrade(tr: NormalizedMcTrade, medianRisk: number): number {
  return tr.initialRiskUsd != null && tr.initialRiskUsd > 0 ? tr.initialRiskUsd : medianRisk;
}

function riskNormalizeMultiplier(
  tr: NormalizedMcTrade,
  cfg: PropFirmConfig,
  groupMedianRisk: number,
  rng: () => number,
): number {
  const riskRef = effectiveRiskPerTrade(tr, groupMedianRisk);
  switch (cfg.riskNormalizeMode) {
    case "as_backtest":
      return 1;
    case "fixed_usd":
      return cfg.riskNormFixedUsd / Math.max(riskRef, 1e-9);
    case "range_usd": {
      const r = uniformUsd(rng, cfg.riskNormRangeMinUsd, cfg.riskNormRangeMaxUsd);
      return r / Math.max(riskRef, 1e-9);
    }
    case "align_median_risk":
      return groupMedianRisk / Math.max(riskRef, 1e-9);
    default:
      return 1;
  }
}

function applyStressWinRate(effectivePnls: number[], rng: () => number, stressPts: number): void {
  if (stressPts >= 0 || effectivePnls.length === 0) return;
  const frac = Math.min(0.95, Math.abs(stressPts) / 100);
  const wins = effectivePnls.map((pnl, i) => (pnl > 0 ? i : -1)).filter((i) => i >= 0) as number[];
  const demoteN = Math.round(wins.length * frac);
  if (demoteN <= 0) return;
  for (let i = wins.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = wins[i]!;
    wins[i] = wins[j]!;
    wins[j] = tmp;
  }
  const n = Math.min(demoteN, wins.length);
  for (let k = 0; k < n; k++) {
    effectivePnls[wins[k]!] = 0;
  }
}

function prepareEffectiveTrades(
  ordered: NormalizedMcTrade[],
  cfg: PropFirmConfig,
  rng: () => number,
): PropPreparedTrade[] {
  const groupMedianRisk = medianRiskReference(ordered);
  const rms = ordered.map((tr) => riskNormalizeMultiplier(tr, cfg, groupMedianRisk, rng));
  const stressF = 1 + cfg.stressAvgRPct / 100;
  const pnls = ordered.map((tr, i) => tr.pnl * rms[i]! * stressF);
  applyStressWinRate(pnls, rng, cfg.stressWinRatePts);

  const g = globalPnlMultiplier(cfg, ordered);
  return ordered.map((tr, i) => {
    const rm = rms[i]!;
    const excMul =
      Math.abs(tr.pnl) > 1e-9 ? pnls[i]! / tr.pnl : rm * stressF;
    const mfe =
      tr.mfeUsd != null && tr.mfeUsd >= 0 ? tr.mfeUsd * excMul * g : null;
    const mae =
      tr.maeUsd != null && tr.maeUsd >= 0 ? tr.maeUsd * excMul * g : null;
    return {
      pnl: pnls[i]! * g,
      dayKey: tr.dayKey,
      mfeUsd: mfe,
      maeUsd: mae,
    };
  });
}

/** Kroky equity v obchodu: vstup → (MAE) → případně MFE → uzavření. Pro max DD v trailing režimu. */
function intraTradeEquityPoints(entryEquity: number, tr: PropPreparedTrade): number[] {
  const { pnl, maeUsd, mfeUsd } = tr;
  const adverse = maeUsd != null && maeUsd > 0 ? maeUsd : pnl < 0 ? -pnl : 0;
  const favorable = mfeUsd != null && mfeUsd > 0 ? mfeUsd : 0;

  const pts: number[] = [entryEquity];
  const low = entryEquity - adverse;
  if (low < entryEquity - 1e-9) pts.push(low);

  if (favorable > 0) {
    const hi = entryEquity + favorable;
    const last = pts[pts.length - 1]!;
    if (hi > last + 1e-9) pts.push(hi);
  }

  const close = entryEquity + pnl;
  const last2 = pts[pts.length - 1]!;
  if (Math.abs(close - last2) > 1e-9) pts.push(close);
  return pts;
}

function maxDdPctFromPeak(peak: number, equity: number): number {
  if (peak <= 0) return 0;
  return ((peak - equity) / peak) * 100;
}

function summarizeEquityPath(path: number[], initial: number): Pick<PropFirmRunResult, "finalEquity" | "maxDrawdownPct" | "totalReturnPct"> {
  if (path.length === 0) {
    return { finalEquity: initial, maxDrawdownPct: 0, totalReturnPct: 0 };
  }
  const finalEquity = path[path.length - 1]!;
  let peak = path[0]!;
  let maxDd = 0;
  for (const e of path) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = ((peak - e) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  const totalReturnPct = initial > 0 ? ((finalEquity - initial) / initial) * 100 : 0;
  return { finalEquity, maxDrawdownPct: maxDd, totalReturnPct };
}

export function runSinglePropFirmSim(
  trades: NormalizedMcTrade[],
  initial: number,
  cfg: PropFirmConfig,
  seed: number,
): PropFirmRunResult {
  if (trades.length === 0) {
    const path = [initial];
    return {
      passed: false,
      failReason: "incomplete",
      tradesToPass: null,
      equity: path,
      ...summarizeEquityPath(path, initial),
    };
  }

  const rng = mulberry32(seed);
  const order = shuffleIndices(trades.length, rng);
  const ordered = reorderTrades(trades, order);
  const prepared = prepareEffectiveTrades(ordered, cfg, rng);

  const targetEq = initial * (1 + cfg.profitTargetPct / 100);
  const maxDdPctLimit =
    cfg.maxDdMode === "percent" ? cfg.maxDdValue : (cfg.maxDdValue / initial) * 100;

  const dailyLimitPct = cfg.dailyDdLimitPct > 0 ? cfg.dailyDdLimitPct : null;
  const dailyLossUsd = cfg.maxDailyLossUsd > 0 ? cfg.maxDailyLossUsd : null;
  const consistencyLimit =
    cfg.consistencyMaxDayProfitPct > 0 ? cfg.consistencyMaxDayProfitPct / 100 : null;

  const equityPath: number[] = [initial];
  let equity = initial;
  let peakTrailing = initial;
  let eodHighWatermark = initial;
  let currentDay: string | null = null;
  let dayHigh = initial;
  let dayStartEquity = initial;
  const dayPnl: Record<string, number> = {};

  const fail = (reason: PropFirmFailReason): PropFirmRunResult => ({
    passed: false,
    failReason: reason,
    tradesToPass: null,
    equity: equityPath,
    ...summarizeEquityPath(equityPath, initial),
  });

  const checkOverallTrailing = (peak: number, e: number): boolean => {
    return maxDdPctFromPeak(peak, e) <= maxDdPctLimit + 1e-6;
  };

  const checkEodOverall = (): boolean => {
    return maxDdPctFromPeak(eodHighWatermark, equity) <= maxDdPctLimit + 1e-6;
  };

  const closeTradingDay = (): boolean | null => {
    if (cfg.overallDrawdownMode !== "eod") return null;
    if (!checkEodOverall()) return false;
    eodHighWatermark = Math.max(eodHighWatermark, equity);
    return true;
  };

  for (let k = 0; k < prepared.length; k++) {
    const tr = prepared[k]!;

    if (tr.dayKey !== currentDay) {
      if (currentDay != null) {
        const ok = closeTradingDay();
        if (ok === false) return fail("max_drawdown");
      }
      currentDay = tr.dayKey;
      dayHigh = equity;
      dayStartEquity = equity;
    }

    const steps = intraTradeEquityPoints(equity, tr);

    for (let s = 1; s < steps.length; s++) {
      const eq = steps[s]!;
      equityPath.push(eq);
      equity = eq;

      if (cfg.overallDrawdownMode === "trailing") {
        peakTrailing = Math.max(peakTrailing, equity);
        if (!checkOverallTrailing(peakTrailing, equity)) {
          return fail("max_drawdown");
        }
      }

      if (equity > dayHigh) dayHigh = equity;
      if (dailyLimitPct != null && dayHigh > 0) {
        const dayDd = ((dayHigh - equity) / dayHigh) * 100;
        if (dayDd > dailyLimitPct) return fail("daily_drawdown");
      }
      if (dailyLossUsd != null && dayStartEquity - equity > dailyLossUsd) {
        return fail("max_daily_loss_usd");
      }
    }

    dayPnl[tr.dayKey] = (dayPnl[tr.dayKey] ?? 0) + tr.pnl;

    if (equity >= targetEq) {
      if (cfg.overallDrawdownMode === "eod") {
        if (!checkEodOverall()) return fail("max_drawdown");
        eodHighWatermark = Math.max(eodHighWatermark, equity);
      }

      const tradesToPass = k + 1;
      const totalProfit = equity - initial;

      if (consistencyLimit != null && totalProfit > 0) {
        let maxDay = 0;
        for (const v of Object.values(dayPnl)) {
          if (v > maxDay) maxDay = v;
        }
        if (maxDay / totalProfit > consistencyLimit) {
          return fail("consistency");
        }
      }
      return {
        passed: true,
        failReason: null,
        tradesToPass,
        equity: equityPath,
        ...summarizeEquityPath(equityPath, initial),
      };
    }
  }

  if (cfg.overallDrawdownMode === "eod") {
    if (closeTradingDay() === false) return fail("max_drawdown");
  }

  return fail("incomplete");
}

export function propFailReasonLabel(reason: PropFirmFailReason): string {
  switch (reason) {
    case "max_drawdown":
      return "Max drawdown";
    case "daily_drawdown":
      return "Denní drawdown (%)";
    case "max_daily_loss_usd":
      return "Max denní ztráta (USD)";
    case "consistency":
      return "Consistency rule";
    case "incomplete":
      return "Cíl nedosažen (došly obchody)";
    default:
      return reason;
  }
}

export function sampleEquityCurves(
  results: PropFirmRunResult[],
  passed: boolean,
  maxSamples: number,
): number[][] {
  const pool = results.filter((r) => r.passed === passed && r.equity.length > 1);
  if (pool.length === 0) return [];
  const step = Math.max(1, Math.ceil(pool.length / maxSamples));
  const out: number[][] = [];
  for (let i = 0; i < pool.length && out.length < maxSamples; i += step) {
    out.push(pool[i]!.equity);
  }
  return out;
}
