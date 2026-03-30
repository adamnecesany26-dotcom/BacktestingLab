export interface SweepRunRow {
  id?: unknown;
  params?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  scoreRawHoldoutOrFull?: unknown;
  scoreMultipleTestingAdjusted?: unknown;
  heatmapBin?: { xBin?: number; yBin?: number };
}
