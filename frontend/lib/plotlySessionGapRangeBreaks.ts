import type { OhlcBar } from "@shared/types";
import { inferMedianBarMs } from "@/lib/chartOhlcResample";

/** Plotly `rangebreaks`: schová víkend + typickou noční pauzu RTH (viz Plotly time-series docs). */
export type PlotlyRangeBreak = { bounds: [string, string] } | { bounds: [number, number]; pattern: "hour" };

const INTRA_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Skrytí mezer na ose X (so–ne, případně 17:00–9:30 lokální „den“) — vhodné pro session / minutové řady.
 * U čistě denních dat (medián krok ≈ 1 den) vrací jen víkendy, aby se neusekávaly platné dny.
 */
export function plotlyRangeBreaksForOhlcGaps(ohlc: OhlcBar[]): PlotlyRangeBreak[] {
  const out: PlotlyRangeBreak[] = [{ bounds: ["sat", "mon"] }];
  if (ohlc.length < 2) return out;
  const med = inferMedianBarMs(ohlc);
  if (med != null && med < 0.85 * INTRA_DAY_MS) {
    out.push({ bounds: [17, 9.5], pattern: "hour" });
  }
  return out;
}
