"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";

interface CandlestickChartProps {
  ohlc: OhlcBar[];
  trades: Trade[];
  height?: number;
}

export function CandlestickChart({ ohlc, trades, height = 320 }: CandlestickChartProps) {
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

      const candleData = ohlc.map((bar) => ({
        time: bar.date.slice(0, 10) as `${number}-${number}-${number}`,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(candleData);

      type Marker = { time: string; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };
      const markers: Marker[] = [];
      const toYmd = (s: string) => (s || "").slice(0, 10);
      trades.forEach((t) => {
        const exitYmd = toYmd(t.exitDate || t.date || "");
        const entryYmd = toYmd(t.entryDate || t.date || "");
        const exitBar = ohlc.find((b) => toYmd(b.date) === exitYmd);
        const entryBar = ohlc.find((b) => toYmd(b.date) === entryYmd);
        if (entryBar) {
          markers.push({
            time: entryBar.date.slice(0, 10) as `${number}-${number}-${number}`,
            position: t.type === "buy" ? "belowBar" : "aboveBar",
            color: t.type === "buy" ? "#10b981" : "#ef4444",
            shape: t.type === "buy" ? "arrowUp" : "arrowDown",
            text: t.type === "buy" ? "Long" : "Short",
          });
        }
        if (exitBar && exitBar.date !== entryBar?.date) {
          markers.push({
            time: exitBar.date.slice(0, 10) as `${number}-${number}-${number}`,
            position: t.type === "buy" ? "aboveBar" : "belowBar",
            color: "#a1a1aa",
            shape: t.type === "buy" ? "arrowDown" : "arrowUp",
            text: "Exit",
          });
        }
      });
      markers.sort((a, b) => a.time.localeCompare(b.time));
      candleSeries.setMarkers(markers);
      chart.timeScale().fitContent();

      return () => chart.remove();
    });

    return () => {
      mounted = false;
    };
  }, [ohlc, trades]);

  if (ohlc.length === 0) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Žádná OHLC data
      </div>
    );
  }

  return <div ref={chartRef} className="w-full" style={{ height }} />;
}
