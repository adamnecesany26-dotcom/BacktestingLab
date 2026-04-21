"use client";

import { useEffect, useMemo, useState } from "react";
import type { OhlcBar } from "@shared/types";
import type { ViewLine, ViewZone } from "@/lib/api";
import {
  buildViewLikeChartSpec,
  DEFAULT_VISIBILITY,
  type VisibilityKey,
} from "@/components/charts/viewLikeChartSpec";

type Props = {
  ohlc: OhlcBar[];
  markers: { date: string; type: string; value: number | null; bar_index?: number | string }[];
  lines: ViewLine[];
  zones: ViewZone[];
  height: number;
  visibility?: Record<VisibilityKey, boolean>;
  extraTraces?: any[];
  extraShapes?: any[];
  extraAnnotations?: any[];
  revision?: number;
};

export function ViewLikeChart({
  ohlc,
  markers,
  lines,
  zones,
  height,
  visibility,
  extraTraces,
  extraShapes,
  extraAnnotations,
  revision,
}: Props) {
  const [Plot, setPlot] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    void import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

  const spec = useMemo(() => {
    return buildViewLikeChartSpec({
      ohlc,
      markers,
      lines,
      zones,
      visibility: visibility ?? { ...DEFAULT_VISIBILITY },
      height,
      extraTraces,
      extraShapes,
      extraAnnotations,
    });
  }, [ohlc, markers, lines, zones, visibility, height, extraTraces, extraShapes, extraAnnotations]);

  if (!Plot) {
    return (
      <div className="flex items-center justify-center text-zinc-500" style={{ height }}>
        Načítání Plotly...
      </div>
    );
  }

  return (
    <Plot
      data={spec.traces}
      layout={spec.layout}
      config={spec.config}
      // Explicit px height avoids feedback loops where % height + ResizeObserver on an ancestor
      // grow the chart container from Plotly layout height.
      style={{ width: "100%", height }}
      useResizeHandler
      revision={revision ?? 0}
    />
  );
}

