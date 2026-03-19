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
  const chartInstanceRef = useRef<import("lightweight-charts").IChartApi | null>(null);

  useEffect(() => {
    if (!chartRef.current || ohlc.length === 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: height,
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

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
      });

      const toUtcSeconds = (value: string, fallbackIndex: number): number => {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
        return Math.floor(Date.UTC(2020, 0, 1 + fallbackIndex) / 1000);
      };

      const candleData = ohlc.map((bar, i) => ({
        time: toUtcSeconds(bar.date, i) as import("lightweight-charts").UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(candleData);
      const ohlcWithTime = ohlc.map((bar, i) => ({
        ...bar,
        ts: toUtcSeconds(bar.date, i),
      }));

      type Marker = {
        time: import("lightweight-charts").UTCTimestamp;
        position: "belowBar" | "aboveBar";
        color: string;
        shape: "arrowUp" | "arrowDown";
        text: string;
      };
      const markers: Marker[] = [];
      const findNearestBar = (value: string) => {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
          const target = Math.floor(parsed / 1000);
          let best = ohlcWithTime[0];
          let bestDiff = Math.abs(best.ts - target);
          for (let i = 1; i < ohlcWithTime.length; i += 1) {
            const candidate = ohlcWithTime[i];
            const diff = Math.abs(candidate.ts - target);
            if (diff < bestDiff) {
              best = candidate;
              bestDiff = diff;
            }
          }
          return best;
        }
        const day = (value || "").slice(0, 10);
        return ohlcWithTime.find((bar) => bar.date.slice(0, 10) === day);
      };
      trades.forEach((t) => {
        const exitBar = findNearestBar(t.exitDate || t.date || "");
        const entryBar = findNearestBar(t.entryDate || t.date || "");
        if (entryBar) {
          markers.push({
            time: entryBar.ts as import("lightweight-charts").UTCTimestamp,
            position: t.type === "buy" ? "belowBar" : "aboveBar",
            color: t.type === "buy" ? "#10b981" : "#ef4444",
            shape: t.type === "buy" ? "arrowUp" : "arrowDown",
            text: t.type === "buy" ? "Long" : "Short",
          });
        }
        if (exitBar && exitBar.ts !== entryBar?.ts) {
          markers.push({
            time: exitBar.ts as import("lightweight-charts").UTCTimestamp,
            position: t.type === "buy" ? "aboveBar" : "belowBar",
            color: "#a1a1aa",
            shape: t.type === "buy" ? "arrowDown" : "arrowUp",
            text: "Exit",
          });
        }
      });
      markers.sort((a, b) => a.time - b.time);
      candleSeries.setMarkers(markers);
      chart.timeScale().fitContent();
    });

    return () => {
      mounted = false;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [ohlc, trades, height]);

  if (ohlc.length === 0) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Žádná OHLC data
      </div>
    );
  }

  return <div ref={chartRef} className="w-full" style={{ height }} />;
}
