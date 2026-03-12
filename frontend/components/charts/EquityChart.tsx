"use client";

import { useEffect, useRef } from "react";

/** TradingView Lightweight Charts - equity curve */
export function EquityChart({
  equity,
  height = 200,
  dates,
  equityCurve,
}: {
  equity?: number[];
  height?: number;
  dates?: string[];
  equityCurve?: { date: string; value: number }[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);

  const data: { time: string; value: number }[] =
    equityCurve?.map((p) => ({ time: p.date.slice(0, 10), value: p.value })) ??
    (equity ?? []).map((v, i) => ({
      time: dates?.[i]?.slice(0, 10) ?? new Date(2020, 0, 1 + i).toISOString().slice(0, 10),
      value: v,
    }));

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }

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
      });
      chartInstanceRef.current = chart;

      const series = chart.addAreaSeries({
        lineColor: "#10b981",
        topColor: "rgba(16, 185, 129, 0.4)",
        bottomColor: "rgba(16, 185, 129, 0)",
      });

      series.setData(data.map((d) => ({ time: d.time as `${number}-${number}-${number}`, value: d.value })));
      chart.timeScale().fitContent();
    });

    return () => {
      mounted = false;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [equityCurve, equity, dates, height]);

  if (data.length === 0) {
    return (
      <div className="h-[200px] rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
        No equity data
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <div ref={chartRef} className="w-full h-full rounded-lg overflow-hidden" />
    </div>
  );
}
