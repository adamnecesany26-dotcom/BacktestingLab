"use client";

import type { RunResponse } from "@shared/types";
import { ManifestRunConfigStrip } from "@/components/results/analytics/ManifestRunConfigStrip";
import { ValidationResultsHero } from "@/components/results/ValidationResultsHero";
import { AnalyticsKpiStrip } from "@/components/results/analytics/AnalyticsKpiStrip";
import { AnalyticsDiagnostics } from "@/components/results/analytics/AnalyticsDiagnostics";

export function AnalyticsOverviewPanel({
  results,
  batchSummary,
}: {
  results: RunResponse;
  batchSummary?: Record<string, unknown> | null;
}) {
  return (
    <div className="space-y-4">
      <ManifestRunConfigStrip results={results} />
      <ValidationResultsHero results={results} variant="default" />
      <AnalyticsKpiStrip results={results} />
      <AnalyticsDiagnostics results={results} batchSummary={batchSummary} />
    </div>
  );
}
