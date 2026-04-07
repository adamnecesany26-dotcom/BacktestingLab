/**
 * Sdílené pomůcky pro domovskou stránku backtestu (`app/page.tsx`).
 * Extrahováno ve fázi 1 refaktoru — bez změny chování.
 */

import type { RunRequest, RunResponse } from "@shared/types";
import type { StrategyParams } from "@/lib/strategyParams";

/**
 * Mirrors backend OHLC export indexing (docker/engine.py): uniform subsample when
 * fullBarCount > ohlcLength, else one row per bar.
 */
export function ohlcExportBarIndices(fullBarCount: number, ohlcLength: number): number[] {
  if (fullBarCount <= 0 || ohlcLength <= 0) return [];
  if (fullBarCount <= ohlcLength) {
    return Array.from({ length: fullBarCount }, (_, i) => i);
  }
  const step = fullBarCount / ohlcLength;
  const indices = Array.from({ length: ohlcLength }, (_, i) => Math.floor(i * step));
  if (indices[ohlcLength - 1] !== fullBarCount - 1) {
    indices[ohlcLength - 1] = fullBarCount - 1;
  }
  return indices;
}

/** True if panel value differs from PARAMS snapshot taken when strategy was opened (string compare). */
export function strategyParamTouchedFromBaseline(
  current: StrategyParams[keyof StrategyParams] | undefined,
  baseline: StrategyParams[keyof StrategyParams] | undefined,
): boolean {
  return String(current ?? "") !== String(baseline ?? "");
}

export function buildBacktestSavePayload(data: RunResponse, request?: RunRequest) {
  let equityCurve = data.equityCurve;
  if (!equityCurve?.length && data.equity?.length && data.ohlc?.length) {
    const first = data.ohlc[0]?.date;
    const d = first ? new Date(first) : null;
    if (d) d.setDate(d.getDate() - 1);
    const dayBefore = d?.toISOString() ?? "0";
    const eq = data.equity!;
    const fullBarCount = Math.max(0, eq.length - 1);
    const barIdx = ohlcExportBarIndices(fullBarCount, data.ohlc.length);
    equityCurve = [
      { date: dayBefore, value: eq[0] ?? 0 },
      ...data.ohlc.map((o, k) => ({
        date: o.date,
        value: eq[(barIdx[k] ?? k) + 1] ?? 0,
      })),
    ];
  } else if (!equityCurve?.length && data.equity?.length) {
    equityCurve = data.equity.map((v, i) => ({ date: String(i), value: v }));
  }
  return {
    runId: data.runId ?? null,
    manifest: {
      ...(data.manifest ?? {}),
      request: request ?? null,
    },
    equityCurve: equityCurve ?? [],
    metrics: data.metrics,
    trades: data.trades,
    validation: data.validation ?? null,
    robustness: data.robustness ?? null,
    monteCarlo: data.monteCarlo ?? null,
    regimeAnalysis: data.regimeAnalysis ?? null,
    portfolio: data.portfolio ?? null,
    executionSummary: data.executionSummary ?? null,
    qualityGate: data.qualityGate ?? null,
    experiment: data.experiment ?? null,
    batchSummary: data.batchSummary ?? null,
    methodologyNotes: (data.manifest?.methodology as Record<string, string> | undefined) ?? null,
  };
}
