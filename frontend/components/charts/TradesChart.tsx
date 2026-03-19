"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@shared/types";

interface TradesChartProps {
  trades: Trade[];
  height?: number;
}

export function TradesChart({ trades, height = 320 }: TradesChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<import("lightweight-charts").IChartApi | null>(null);

  useEffect(() => {
    if (!chartRef.current || trades.length === 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height,
        layout: {
          background: { color: "#18181b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        rightPriceScale: {
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
      });
      chartInstanceRef.current = chart;

      const series = chart.addHistogramSeries({
        color: "#10b981",
        priceFormat: { type: "custom", formatter: (v: number) => `$${v.toFixed(2)}` },
      });

      const dateCounts = new Map<string, number>();
      const data = trades.map((t, i) => {
        const raw = (t.exitDate || t.date || "").trim();
        let time = Number.NaN;
        if (raw) {
          const parsedMs = Date.parse(raw);
          if (Number.isFinite(parsedMs)) {
            time = Math.floor(parsedMs / 1000);
          }
        }
        if (Number.isFinite(time)) {
          const key = String(time);
          const count = dateCounts.get(key) ?? 0;
          dateCounts.set(key, count + 1);
          time += count;
        } else {
          time = Math.floor(Date.now() / 1000) + i;
        }
        return {
          time: time as import("lightweight-charts").UTCTimestamp,
          value: t.pnl ?? 0,
          color: (t.pnl ?? 0) >= 0 ? "rgba(16, 185, 129, 0.8)" : "rgba(239, 68, 68, 0.8)",
        };
      });
      series.setData(data);
      chart.timeScale().fitContent();
    });

    return () => {
      mounted = false;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [trades, height]);

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Žádné obchody
      </div>
    );
  }

  return <div ref={chartRef} className="w-full" style={{ height }} />;
}
