"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";

interface CandlestickChartProps {
  ohlc: OhlcBar[];
  trades: Trade[];
}

export function CandlestickChart({ ohlc, trades }: CandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || ohlc.length === 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 320,
        layout: {
          background: { color: "#18181b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
      });

      const candleData = ohlc.map((bar, i) => ({
        time: i,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(candleData);

      const entryMarkers: { time: number; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string }[] = [];
      const exitMarkers: { time: number; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string }[] = [];

      const toYmd = (s: string) => (s || "").slice(0, 10);
      trades.forEach((t) => {
        const exitYmd = toYmd(t.exitDate || t.date || "");
        const entryYmd = toYmd(t.entryDate || t.date || "");
        const exitIdx = ohlc.findIndex((b) => toYmd(b.date) === exitYmd);
        const entryIdx = ohlc.findIndex((b) => toYmd(b.date) === entryYmd);
        if (entryIdx >= 0) {
          entryMarkers.push({
            time: entryIdx,
            position: t.type === "buy" ? "belowBar" : "aboveBar",
            color: t.type === "buy" ? "#10b981" : "#ef4444",
            shape: t.type === "buy" ? "arrowUp" : "arrowDown",
            text: t.type === "buy" ? "Long" : "Short",
          });
        }
        if (exitIdx >= 0 && exitIdx !== entryIdx) {
          exitMarkers.push({
            time: exitIdx,
            position: t.type === "buy" ? "aboveBar" : "belowBar",
            color: "#a1a1aa",
            shape: t.type === "buy" ? "arrowDown" : "arrowUp",
            text: "Exit",
          });
        }
      });

      candleSeries.setMarkers([...entryMarkers, ...exitMarkers]);
      chart.timeScale().fitContent();

      return () => chart.remove();
    });

    return () => {
      mounted = false;
    };
  }, [ohlc, trades]);

  if (ohlc.length === 0) {
    return (
      <div className="h-[320px] flex items-center justify-center text-zinc-500 text-sm">
        Žádná OHLC data
      </div>
    );
  }

  return <div ref={chartRef} className="w-full h-[320px]" />;
}
