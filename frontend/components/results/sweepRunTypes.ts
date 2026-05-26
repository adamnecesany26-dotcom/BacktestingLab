export interface SweepRunRow {
  id?: unknown;
  params?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  /** Train split metrics when engine používá nested holdout ve sweepu */
  metricsTrain?: Record<string, unknown>;
  metricsHoldout?: Record<string, unknown>;
  holdoutEnabled?: boolean;
  scoreRawHoldoutOrFull?: unknown;
  scoreMultipleTestingAdjusted?: unknown;
  /** Skóre z train části při holdout režimu */
  scoreTrain?: unknown;
  heatmapBin?: { xBin?: number; yBin?: number };
}
