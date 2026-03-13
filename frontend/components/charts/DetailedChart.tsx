"use client";

import { useEffect, useState } from "react";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";

interface DetailedChartProps {
  ohlc: OhlcBar[];
  trades: Trade[];
  height?: number;
}

function parseDate(s: string): number {
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function toDateKey(s: string): string {
  return (s || "").slice(0, 10);
}

/** Find OHLC bar date that matches the given trade date (by day). */
function findBarDate(ohlc: OhlcBar[], tradeDate: string): string | null {
  if (!tradeDate) return null;
  const key = toDateKey(tradeDate);
  for (const bar of ohlc) {
    if (toDateKey(bar.date) === key) return bar.date;
  }
  return null;
}

function getMfeMae(
  ohlc: OhlcBar[],
  entryDate: string,
  exitDate: string,
  isLong: boolean
): { mfePrice: number; maePrice: number } {
  const entryT = parseDate(entryDate);
  const exitT = parseDate(exitDate);
  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const bar of ohlc) {
    const t = parseDate(bar.date);
    if (t >= entryT && t <= exitT) {
      if (bar.high > maxHigh) maxHigh = bar.high;
      if (bar.low < minLow) minLow = bar.low;
    }
  }
  if (maxHigh === -Infinity) maxHigh = 0;
  if (minLow === Infinity) minLow = 0;
  return { mfePrice: isLong ? maxHigh : minLow, maePrice: isLong ? minLow : maxHigh };
}

export function DetailedChart({ ohlc, trades, height = 560 }: DetailedChartProps) {
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
  };

  const entryX: string[] = [];
  const entryY: number[] = [];
  const entryText: string[] = [];
  const exitX: string[] = [];
  const exitY: number[] = [];
  const exitText: string[] = [];

  const shapes: any[] = [];

  for (const t of trades) {
    const entryDate = t.entryDate ?? t.date ?? "";
    const exitDate = t.exitDate ?? t.date ?? "";
    const entryPrice = t.entryPrice ?? t.price;
    const exitPrice = t.exitPrice ?? t.price;
    const isLong = t.type === "buy";

    const entryBarDate = findBarDate(ohlc, entryDate);
    const exitBarDate = findBarDate(ohlc, exitDate);

    if (entryBarDate) {
      entryX.push(entryBarDate);
      entryY.push(entryPrice);
      entryText.push(isLong ? "entry long" : "entry short");
    }
    if (exitBarDate) {
      exitX.push(exitBarDate);
      exitY.push(exitPrice);
      exitText.push(isLong ? "exit long" : "exit short");
    }

    const { mfePrice, maePrice } = getMfeMae(ohlc, entryDate, exitDate, isLong);

    if (entryBarDate && exitBarDate && parseDate(exitDate) >= parseDate(entryDate)) {
      if (isLong) {
        if (mfePrice > entryPrice) {
          shapes.push({
            type: "rect",
            x0: entryBarDate,
            x1: exitBarDate,
            y0: entryPrice,
            y1: mfePrice,
            fillcolor: "rgba(16, 185, 129, 0.2)",
            line: { width: 0 },
            layer: "below",
          });
        }
        if (maePrice < entryPrice) {
          shapes.push({
            type: "rect",
            x0: entryBarDate,
            x1: exitBarDate,
            y0: maePrice,
            y1: entryPrice,
            fillcolor: "rgba(239, 68, 68, 0.2)",
            line: { width: 0 },
            layer: "below",
          });
        }
      } else {
        if (mfePrice < entryPrice) {
          shapes.push({
            type: "rect",
            x0: entryBarDate,
            x1: exitBarDate,
            y0: mfePrice,
            y1: entryPrice,
            fillcolor: "rgba(16, 185, 129, 0.2)",
            line: { width: 0 },
            layer: "below",
          });
        }
        if (maePrice > entryPrice) {
          shapes.push({
            type: "rect",
            x0: entryBarDate,
            x1: exitBarDate,
            y0: entryPrice,
            y1: maePrice,
            fillcolor: "rgba(239, 68, 68, 0.2)",
            line: { width: 0 },
            layer: "below",
          });
        }
      }
    }
  }

  const entryTrace: any = {
    type: "scatter",
    x: entryX,
    y: entryY,
    mode: "markers+text",
    marker: {
      size: 12,
      color: "#3b82f6",
      symbol: "circle",
      line: { color: "#fff", width: 1 },
    },
    text: entryText,
    textposition: "top center",
    textfont: { size: 10, color: "#3b82f6" },
    showlegend: false,
  };

  const exitTrace: any = {
    type: "scatter",
    x: exitX,
    y: exitY,
    mode: "markers+text",
    marker: {
      size: 12,
      color: "#f97316",
      symbol: "circle",
      line: { color: "#fff", width: 1 },
    },
    text: exitText,
    textposition: "bottom center",
    textfont: { size: 10, color: "#f97316" },
    showlegend: false,
  };

  const layout: any = {
    height,
    margin: { t: 40, r: 40, b: 40, l: 60 },
    paper_bgcolor: "#18181b",
    plot_bgcolor: "#18181b",
    font: { color: "#a1a1aa", size: 11 },
    xaxis: {
      type: "date",
      gridcolor: "#27272a",
      rangeslider: { visible: false },
      fixedrange: false,
      rangebreaks: [
        { bounds: ["sat", "mon"] },
      ],
    },
    yaxis: {
      gridcolor: "#27272a",
      tickformat: ".2f",
      fixedrange: false,
    },
    shapes,
    dragmode: "zoom",
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
        data={[candlestickTrace, entryTrace, exitTrace]}
        layout={layout}
        config={config}
        style={{ width: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
