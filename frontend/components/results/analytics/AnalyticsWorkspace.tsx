"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunResponse } from "@shared/types";
import { deriveDynamicAnalyticsTabs, type AnalyticsDynamicTab } from "@/lib/analytics/dynamicAnalyticsTabs";
import { AnalyticsOverviewPanel } from "@/components/results/analytics/AnalyticsOverviewPanel";
import { AnalyticsFinancialsPanel } from "@/components/results/analytics/AnalyticsFinancialsPanel";
import { AnalyticsSweepPanel } from "@/components/results/analytics/AnalyticsSweepPanel";
import { AnalyticsWalkForwardPanel } from "@/components/results/analytics/AnalyticsWalkForwardPanel";
import { AnalyticsOosPanel } from "@/components/results/analytics/AnalyticsOosPanel";
import { AnalyticsParamTestPanel } from "@/components/results/analytics/AnalyticsParamTestPanel";
import { AnalyticsRegimePanel } from "@/components/results/analytics/AnalyticsRegimePanel";

export interface AnalyticsWorkspaceProps {
  results: RunResponse;
  batchSummary?: Record<string, unknown> | null;
}

const STATIC_TABS: { id: "overview" | "financials"; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
];

function DynamicPanelRouter({ tab, results }: { tab: AnalyticsDynamicTab; results: RunResponse }) {
  switch (tab.kind) {
    case "sweep":
      return <AnalyticsSweepPanel results={results} />;
    case "walk_forward":
      return <AnalyticsWalkForwardPanel results={results} />;
    case "oos_split":
      return <AnalyticsOosPanel results={results} />;
    case "param_test":
      return <AnalyticsParamTestPanel results={results} />;
    case "regime":
      return <AnalyticsRegimePanel results={results} />;
    default:
      return null;
  }
}

export function AnalyticsWorkspace({ results, batchSummary }: AnalyticsWorkspaceProps) {
  const dynamicTabs = useMemo(() => deriveDynamicAnalyticsTabs(results), [results]);
  const tabIds = useMemo(
    () => new Set<string>([...STATIC_TABS.map((t) => t.id), ...dynamicTabs.map((t) => t.id)]),
    [dynamicTabs],
  );

  const [active, setActive] = useState<string>("overview");

  useEffect(() => {
    setActive("overview");
  }, [results?.runId]);

  useEffect(() => {
    if (!tabIds.has(active)) setActive("overview");
  }, [active, tabIds]);

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-700/60 bg-zinc-900/50 p-1 overflow-x-auto">
        {STATIC_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              active === t.id
                ? "bg-emerald-600/25 text-emerald-300 border border-emerald-500/40"
                : "text-zinc-500 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
        {dynamicTabs.length > 0 && (
          <span className="self-center text-[10px] uppercase tracking-wider text-zinc-600 px-1 hidden sm:inline">
            · typ běhu
          </span>
        )}
        {dynamicTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              active === t.id
                ? "bg-violet-600/25 text-violet-200 border border-violet-500/35"
                : "text-zinc-500 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "overview" && <AnalyticsOverviewPanel results={results} batchSummary={batchSummary} />}
      {active === "financials" && <AnalyticsFinancialsPanel results={results} />}
      {(() => {
        const dyn = dynamicTabs.find((t) => t.id === active);
        return dyn ? <DynamicPanelRouter key={dyn.id} tab={dyn} results={results} /> : null;
      })()}
    </div>
  );
}
