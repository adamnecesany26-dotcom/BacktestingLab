"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";

interface TradeHighlightChartProps {
  ohlc: OhlcBar[];
  trade: Trade | null;
  height?: number;
}

const CONTEXT_BARS = 15;

/** Normalize date to YYYY-MM-DD for matching (handles ISO, datetime, timezone). */
function toYmd(s: string): string {
  const raw = (s || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.slice(0, 10);
}

/** Get OHLC slice for a single trade - entry to exit + context bars before/after */
function getOhlcWindow(ohlc: OhlcBar[], trade: Trade): OhlcBar[] {
  if (ohlc.length === 0) return [];
  const entryDate = trade.entryDate ?? trade.date ?? "";
  const exitDate = trade.exitDate ?? trade.date ?? "";
  const entryKey = toYmd(entryDate);
  const exitKey = toYmd(exitDate);

  let entryIdx = ohlc.findIndex((b) => toYmd(b.date) === entryKey);
  let exitIdx = ohlc.findIndex((b) => toYmd(b.date) === exitKey);

  if (entryIdx < 0) entryIdx = 0;
  if (exitIdx < 0) exitIdx = ohlc.length - 1;
  if (entryIdx > exitIdx) [entryIdx, exitIdx] = [exitIdx, entryIdx];

  const start = Math.max(0, entryIdx - CONTEXT_BARS);
  const end = Math.min(ohlc.length, exitIdx + CONTEXT_BARS + 1);
  return ohlc.slice(start, end);
}

export function TradeHighlightChart({ ohlc, trade, height = 360 }: TradeHighlightChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);

  const windowOhlc = trade ? getOhlcWindow(ohlc, trade) : [];

  useEffect(() => {
    if (!chartRef.current || windowOhlc.length === 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }

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

      const candleData = windowOhlc.map((bar, i) => ({
        time: toUtcSeconds(bar.date, i) as import("lightweight-charts").UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(candleData);

      if (trade) {
        const entryYmd = toYmd(trade.entryDate ?? trade.date ?? "");
        const exitYmd = toYmd(trade.exitDate ?? trade.date ?? "");
        const entryBar = windowOhlc.find((b) => toYmd(b.date) === entryYmd);
        const exitBar = windowOhlc.find((b) => toYmd(b.date) === exitYmd);

        type Marker = {
          time: import("lightweight-charts").UTCTimestamp;
          position: "belowBar" | "aboveBar";
          color: string;
          shape: "arrowUp" | "arrowDown";
          text: string;
        };
        const markers: Marker[] = [];
        if (entryBar) {
          markers.push({
            time: toUtcSeconds(entryBar.date, 0) as import("lightweight-charts").UTCTimestamp,
            position: trade.type === "buy" ? "belowBar" : "aboveBar",
            color: trade.type === "buy" ? "#10b981" : "#ef4444",
            shape: trade.type === "buy" ? "arrowUp" : "arrowDown",
            text: trade.type === "buy" ? "Long" : "Short",
          });
        }
        if (exitBar && exitBar.date !== entryBar?.date) {
          markers.push({
            time: toUtcSeconds(exitBar.date, 0) as import("lightweight-charts").UTCTimestamp,
            position: trade.type === "buy" ? "aboveBar" : "belowBar",
            color: "#a1a1aa",
            shape: trade.type === "buy" ? "arrowDown" : "arrowUp",
            text: "Exit",
          });
        }
        candleSeries.setMarkers(markers);
      }

      chart.timeScale().fitContent();
      chartInstanceRef.current = chart;
    });

    return () => {
      mounted = false;
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [windowOhlc, trade, height]);

  if (!trade) {
    return (
      <div
        className="flex items-center justify-center text-zinc-500 text-sm"
        style={{ height }}
      >
        Vyberte obchod ze seznamu níže
      </div>
    );
  }

  if (windowOhlc.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-zinc-500 text-sm"
        style={{ height }}
      >
        Žádná OHLC data pro tento obchod
      </div>
    );
  }

  return <div ref={chartRef} className="w-full" style={{ height }} />;
}
