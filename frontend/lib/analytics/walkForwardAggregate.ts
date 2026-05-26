/**
 * Aggregates walk-forward fold payload (engine validation.folds) for the WF dashboard.
 */

export type WfRedFlag = { kind: string; label: string; detail: string; severity: "high" | "medium" };

export interface WfStitchedPoint {
  y: number;
  ddPctFromPeak: number;
  foldIndex: number;
  foldId: string;
}

export interface WalkForwardAggregate {
  foldCount: number;
  totalOosReturnUsd: number;
  totalIsReturnUsd: number;
  oosVsIsRatioPct: number | null;
  weightedOosWinRatePct: number | null;
  maxOosDdPct: number | null;
  avgOosDdPct: number | null;
  medianOosProfitFactor: number | null;
  avgOosProfitFactor: number | null;
  stitched: WfStitchedPoint[];
  /** First stitched index for each fold's OOS series (segment boundary in chart). */
  foldStartIndices: number[];
  /** Indices in `stitched` where drawdown is at local maximum (for subtle marking) */
  ddTroughIndices: number[];
  /** Relative step change — unusually large vs median step */
  spikeIndices: number[];
  /** Longest flat run (low relative change) */
  stagnationMaxRun: number;
  segments: {
    id: string;
    oosReturnUsd: number;
    isReturnUsd: number;
    oosDdPct: number | null;
    oosPf: number | null;
    trades: number;
  }[];
  distribution: { profit: number; loss: number; flat: number; avgReturn: number; medianReturn: number };
  redFlags: WfRedFlag[];
}

function num(x: unknown): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function snap(tr: Record<string, unknown> | null): Record<string, unknown> {
  return tr && typeof tr === "object" ? tr : {};
}

export function aggregateWalkForward(folds: Record<string, unknown>[]): WalkForwardAggregate | null {
  if (!Array.isArray(folds) || folds.length === 0) return null;

  const segments: WalkForwardAggregate["segments"] = [];
  let totalOos = 0;
  let totalIs = 0;
  let maxOosDd: number | null = null;
  let ddSum = 0;
  let ddN = 0;
  const pfVals: number[] = [];
  let wrNum = 0;
  let wrDen = 0;

  for (const f of folds) {
    const id = String(f.id ?? "");
    const te = snap(f.test as Record<string, unknown> | null);
    const tr = snap(f.train as Record<string, unknown> | null);
    const tm = snap(f.testMetrics as Record<string, unknown> | null);
    const oosReturn = num(te.totalReturnUsd);
    const isReturn = num(tr.totalReturnUsd);
    if (Number.isFinite(oosReturn)) totalOos += oosReturn;
    if (Number.isFinite(isReturn)) totalIs += isReturn;
    const ddp = num(tm.maxDrawdownPct);
    if (Number.isFinite(ddp) && ddp >= 0) {
      maxOosDd = maxOosDd == null ? ddp : Math.max(maxOosDd, ddp);
      ddSum += ddp;
      ddN += 1;
    }
    const pf = num(tm.profitFactor);
    if (Number.isFinite(pf) && pf >= 0) pfVals.push(pf);
    const wr = num(tm.winRate);
    const tc = Math.floor(Math.max(0, num(tm.tradeCount)));
    if (Number.isFinite(wr) && tc > 0) {
      wrNum += (wr / 100) * tc;
      wrDen += tc;
    }
    segments.push({
      id,
      oosReturnUsd: Number.isFinite(oosReturn) ? oosReturn : 0,
      isReturnUsd: Number.isFinite(isReturn) ? isReturn : 0,
      oosDdPct: Number.isFinite(ddp) ? ddp : null,
      oosPf: Number.isFinite(pf) ? pf : null,
      trades: tc,
    });
  }

  const avgPf = pfVals.length ? pfVals.reduce((a, b) => a + b, 0) / pfVals.length : null;
  const sortedPf = [...pfVals].sort((a, b) => a - b);
  const medPf =
    sortedPf.length === 0
      ? null
      : sortedPf.length % 2
        ? sortedPf[(sortedPf.length - 1) >> 1]!
        : (sortedPf[sortedPf.length / 2 - 1]! + sortedPf[sortedPf.length / 2]!) / 2;

  const oosVsIsRatioPct =
    Number.isFinite(totalIs) && Math.abs(totalIs) > 1e-9 ? (totalOos / totalIs) * 100 : null;
  const weightedOosWinRatePct = wrDen > 0 ? (wrNum / wrDen) * 100 : null;
  const avgOosDdPct = ddN > 0 ? ddSum / ddN : null;

  const stitched: WfStitchedPoint[] = [];
  let cursor = 100;
  let foldIndex = 0;
  for (const f of folds) {
    const sp =
      f.equitySparklinePct && typeof f.equitySparklinePct === "object"
        ? (f.equitySparklinePct as Record<string, unknown>)
        : null;
    const testPct = Array.isArray(sp?.testPct)
      ? (sp!.testPct as unknown[]).map((x) => num(x)).filter((x) => Number.isFinite(x))
      : [];
    const id = String(f.id ?? "");
    const start = cursor;
    if (testPct.length === 0) {
      foldIndex += 1;
      continue;
    }
    for (const p of testPct) {
      const y = start * (1 + p / 100);
      stitched.push({ y, ddPctFromPeak: 0, foldIndex, foldId: id });
    }
    cursor = start * (1 + testPct[testPct.length - 1]! / 100);
    foldIndex += 1;
  }

  let peak = stitched.length ? stitched[0]!.y : 100;
  for (const pt of stitched) {
    peak = Math.max(peak, pt.y);
    pt.ddPctFromPeak = peak > 1e-9 ? ((peak - pt.y) / peak) * 100 : 0;
  }

  const foldStartIndices: number[] = [];
  let lastFi = -1;
  stitched.forEach((pt, i) => {
    if (pt.foldIndex !== lastFi) {
      foldStartIndices.push(i);
      lastFi = pt.foldIndex;
    }
  });

  const ddTroughIndices: number[] = [];
  for (let i = 1; i < stitched.length - 1; i++) {
    const d = stitched[i]!.ddPctFromPeak;
    if (d >= stitched[i - 1]!.ddPctFromPeak && d >= stitched[i + 1]!.ddPctFromPeak && d > 0.25) {
      ddTroughIndices.push(i);
    }
  }

  const steps: number[] = [];
  for (let i = 1; i < stitched.length; i++) {
    const a = stitched[i - 1]!.y;
    const b = stitched[i]!.y;
    if (a > 1e-9) steps.push(Math.abs((b - a) / a));
  }
  const medStep = steps.length
    ? [...steps].sort((x, y) => x - y)[Math.floor(steps.length / 2)]!
    : 0;
  const spikeIndices: number[] = [];
  for (let i = 1; i < stitched.length; i++) {
    const a = stitched[i - 1]!.y;
    const b = stitched[i]!.y;
    if (a > 1e-9 && Math.abs((b - a) / a) > Math.max(0.08, medStep * 4)) spikeIndices.push(i);
  }

  let run = 0;
  let maxRun = 0;
  for (let i = 1; i < stitched.length; i++) {
    const a = stitched[i - 1]!.y;
    const b = stitched[i]!.y;
    const small = a > 1e-9 && Math.abs((b - a) / a) < 0.0015;
    if (small) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else run = 0;
  }

  const rets = segments.map((s) => s.oosReturnUsd);
  const profit = rets.filter((r) => r > 1).length;
  const loss = rets.filter((r) => r < -1).length;
  const flat = rets.length - profit - loss;
  const sortedR = [...rets].sort((a, b) => a - b);
  const medianReturn =
    sortedR.length === 0
      ? 0
      : sortedR.length % 2
        ? sortedR[(sortedR.length - 1) >> 1]!
        : (sortedR[sortedR.length / 2 - 1]! + sortedR[sortedR.length / 2]!) / 2;
  const avgReturn = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

  const redFlags: WfRedFlag[] = [];

  if (totalIs > 500 && totalOos < totalIs * 0.35) {
    redFlags.push({
      kind: "is_oos_gap",
      severity: "high",
      label: "Silně horší OOS než IS",
      detail:
        "Součet OOS výnosů je výrazně pod součtem IS — typický signál overfittingu nebo nestability. Ověř metodiku a parametry.",
    });
  }

  if (totalIs > 200 && totalOos < 0) {
    redFlags.push({
      kind: "oos_negative",
      severity: "high",
      label: "OOS celkem v záporu",
      detail: "Součet výnosů napříč OOS segmenty je negativní — strategie neprošla out-of-sample testem.",
    });
  }

  const pos = rets.filter((r) => r > 1);
  if (pos.length && totalOos > 0) {
    const mx = Math.max(...pos.map((r) => Math.abs(r)));
    if (mx / totalOos > 0.65) {
      redFlags.push({
        kind: "concentration",
        severity: "medium",
        label: "Koncentrace zisku v jednom segmentu",
        detail: "Jeden OOS segment tvoří většinu souhrnného zisku — výsledek nemusí být robustní napříč časem.",
      });
    }
  }

  const meanAbs = rets.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, rets.length);
  const varI =
    rets.length > 1
      ? Math.sqrt(rets.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (rets.length - 1))
      : 0;
  if (meanAbs > 50 && varI / meanAbs > 1.35) {
    redFlags.push({
      kind: "variability",
      severity: "medium",
      label: "Vysoká variabilita mezi segmenty",
      detail: "OOS P/L se mezi segmenty hodně liší — edge nemusí být stabilní.",
    });
  }

  if (maxRun > Math.max(14, Math.floor(stitched.length * 0.18))) {
    redFlags.push({
      kind: "stagnation",
      severity: "medium",
      label: "Dlouhá stagnace v OOS křivce",
      detail: "Skládaná OOS křivka déle „stojí“ (malé změny po řadu bodů) — slabší dynamika výsledku.",
    });
  }

  if (weightedOosWinRatePct != null && weightedOosWinRatePct < 42 && totalOos > 0) {
    redFlags.push({
      kind: "low_winrate",
      severity: "medium",
      label: "Nízký vážený win rate na OOS",
      detail: "Vážený průměr win rate napříč OOS segmenty je slabý — zkontroluj R multiple a frekvenci.",
    });
  }

  return {
    foldCount: folds.length,
    totalOosReturnUsd: totalOos,
    totalIsReturnUsd: totalIs,
    oosVsIsRatioPct,
    weightedOosWinRatePct,
    maxOosDdPct: maxOosDd,
    avgOosDdPct,
    medianOosProfitFactor: medPf,
    avgOosProfitFactor: avgPf,
    stitched,
    foldStartIndices,
    ddTroughIndices,
    spikeIndices,
    stagnationMaxRun: maxRun,
    segments,
    distribution: { profit, loss, flat, avgReturn, medianReturn },
    redFlags,
  };
}
