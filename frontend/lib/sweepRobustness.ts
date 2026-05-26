import type { SweepRunRow } from "@/components/results/sweepRunTypes";

/** Parsuje `robustness.rankingSample` nebo `robustness.results` do řádků pro tabulku / modal. */
export function extractSweepRunRows(robustness: Record<string, unknown> | null | undefined): SweepRunRow[] {
  if (!robustness || typeof robustness !== "object") return [];
  const fromRanking = Array.isArray(robustness.rankingSample)
    ? (robustness.rankingSample as Record<string, unknown>[])
    : [];
  const normalize = (r: Record<string, unknown>): SweepRunRow => {
    const mRaw = r.metrics;
    const mh = r.metricsHoldout;
    const mt = r.metricsTrain;
    const metrics =
      typeof mRaw === "object" && mRaw
        ? (mRaw as Record<string, unknown>)
        : typeof mh === "object" && mh
          ? (mh as Record<string, unknown>)
          : typeof mt === "object" && mt
            ? (mt as Record<string, unknown>)
            : {};
    const hb = r.heatmapBin;
    return {
      id: r.id,
      params: typeof r.params === "object" && r.params ? (r.params as Record<string, unknown>) : undefined,
      metrics,
      metricsTrain: typeof mt === "object" && mt ? (mt as Record<string, unknown>) : undefined,
      metricsHoldout: typeof mh === "object" && mh ? (mh as Record<string, unknown>) : undefined,
      holdoutEnabled: typeof r.holdoutEnabled === "boolean" ? r.holdoutEnabled : undefined,
      scoreRawHoldoutOrFull: r.scoreRawHoldoutOrFull ?? r.score,
      scoreMultipleTestingAdjusted: r.scoreMultipleTestingAdjusted,
      scoreTrain: r.scoreTrain,
      heatmapBin:
        typeof hb === "object" && hb && hb != null
          ? { xBin: Number((hb as Record<string, unknown>).xBin), yBin: Number((hb as Record<string, unknown>).yBin) }
          : undefined,
    };
  };
  if (fromRanking.length > 0) return fromRanking.map(normalize);
  const fromResults = Array.isArray(robustness.results) ? (robustness.results as Record<string, unknown>[]) : [];
  return fromResults.map(normalize);
}
