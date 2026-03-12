"use client";

import { useEffect, useRef } from "react";

/** TradingView Lightweight Charts - equity curve */
export function EquityChart({ equity, height = 200 }: { equity: number[]; height?: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);

  useEffect(() => {
    if (!chartRef.current || equity.length === 0) return;

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

      const data = equity.map((v, i) => ({
        time: i,
        value: v,
      }));
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
  }, [equity]);

  if (equity.length === 0) {
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
