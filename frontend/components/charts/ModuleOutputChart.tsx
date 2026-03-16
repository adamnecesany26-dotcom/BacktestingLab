"use client";

import { useEffect, useState } from "react";
import type { OhlcBar } from "@shared/types";
import type { ModuleOutput } from "@shared/types";

interface ModuleOutputChartProps {
  ohlc: OhlcBar[];
  moduleName: string;
  output: ModuleOutput;
  height?: number;
}

const MARKER_COLORS: Record<string, string> = {
  high: "#ef4444",
  low: "#10b981",
  internal_high: "#f97316",
  internal_low: "#22c55e",
};

export function ModuleOutputChart({
  ohlc,
  moduleName,
  output,
  height = 480,
}: ModuleOutputChartProps) {
  const [Plot, setPlot] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

  if (!Plot || ohlc.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-zinc-500 text-sm"
        style={{ height }}
      >
        {!Plot ? "Načítání..." : "Žádná OHLC data"}
      </div>
    );
  }

  const dates = ohlc.map((b) => b.date);
  const opens = ohlc.map((b) => b.open);
  const highs = ohlc.map((b) => b.high);
  const lows = ohlc.map((b) => b.low);
  const closes = ohlc.map((b) => b.close);

  const candlestickTrace: any = {
    type: "candlestick",
    x: dates,
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    increasing: {
      line: { color: "#10b981", width: 1 },
      fillcolor: "#10b981",
    },
    decreasing: {
      line: { color: "#ef4444", width: 1 },
      fillcolor: "#ef4444",
    },
    xperiodalignment: "middle",
    name: "OHLC",
  };

  const traces: any[] = [candlestickTrace];

  const markers = output.markers ?? [];
  if (markers.length > 0) {
    const byType: Record<string, { x: string[]; y: number[] }> = {};
    for (const m of markers) {
      const t = (m.type || "high").toLowerCase();
      if (!byType[t]) byType[t] = { x: [], y: [] };
      byType[t].x.push(m.date);
      byType[t].y.push(m.value);
    }
    for (const [t, data] of Object.entries(byType)) {
      traces.push({
        type: "scatter",
        x: data.x,
        y: data.y,
        mode: "markers",
        marker: {
          size: 10,
          color: MARKER_COLORS[t] ?? "#a1a1aa",
          symbol: t.includes("high") ? "triangle-down" : "triangle-up",
          line: { color: "#fff", width: 1 },
        },
        name: t,
        showlegend: true,
      });
    }
  }

  const lines = output.lines ?? [];
  for (const line of lines) {
    const pts = line.data ?? [];
    if (pts.length > 0) {
      traces.push({
        type: "scatter",
        x: pts.map((p: { date: string }) => p.date),
        y: pts.map((p: { value: number }) => p.value),
        mode: "lines",
        line: { color: line.color ?? "#3b82f6", width: 2 },
        name: line.name ?? "line",
        showlegend: true,
      });
    }
  }

  const zoneShapes: any[] = [];
  const zones = output.zones ?? [];
  for (const z of zones) {
    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    zoneShapes.push({
      type: "rect",
      x0: z.date_start,
      x1: z.date_end,
      y0: z.value_low,
      y1: z.value_high,
      fillcolor: fill,
      line: { width: 1, color: "#3b82f6" },
      layer: "below",
    });
  }

  const layout: any = {
    height,
    title: { text: moduleName, font: { size: 14 } },
    margin: { t: 50, r: 40, b: 40, l: 60 },
    paper_bgcolor: "#18181b",
    plot_bgcolor: "#18181b",
    font: { color: "#a1a1aa", size: 11 },
    xaxis: {
      type: "date",
      gridcolor: "#27272a",
      rangeslider: { visible: false },
      fixedrange: false,
    },
    yaxis: {
      gridcolor: "#27272a",
      tickformat: ".2f",
      fixedrange: false,
    },
    dragmode: "zoom",
    showlegend: traces.length > 1,
    legend: { x: 1, y: 1, xanchor: "right" },
    shapes: zoneShapes,
  };

  const config: any = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  return (
    <div className="w-full">
      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
