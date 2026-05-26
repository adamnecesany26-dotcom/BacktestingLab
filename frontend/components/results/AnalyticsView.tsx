"use client";

import { AnalyticsWorkspace } from "@/components/results/analytics/AnalyticsWorkspace";
import type { AnalyticsWorkspaceProps } from "@/components/results/analytics/AnalyticsWorkspace";

export type AnalyticsViewProps = AnalyticsWorkspaceProps;

/** Záložka Analytics — podsložky Overview / Financials / dynamické podle typu běhu. */
export function AnalyticsView(props: AnalyticsViewProps) {
  return <AnalyticsWorkspace {...props} />;
}
