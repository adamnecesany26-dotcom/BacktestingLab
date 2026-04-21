"use client";

import { useEffect, useMemo, useRef } from "react";
import type { OhlcBar } from "@shared/types";
import { formatChartAxisUtcLabel, prepareOhlcUtcSecondsSeries } from "@/lib/chartOhlcResample";

interface PriceContextChartProps {
  ohlc: OhlcBar[];
  entryIso: string;
  side?: "long" | "short";
  height?: number;
}

/** Forex / jemné ceny – LW Charts default truncuje na 2 desetinná místa. */
function inferPriceFormat(bars: OhlcBar[]): { type: "price"; precision: number; minMove: number } {
  let maxD = 2;
  const n = bars.length;
  const sample = n > 600 ? [...bars.slice(0, 300), ...bars.slice(-300)] : bars;
  for (const b of sample) {
    for (const v of [b.open, b.high, b.low, b.close]) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const s = v.toFixed(10).replace(/\.?0+$/, "");
      const dot = s.indexOf(".");
      if (dot >= 0) {
        const fracLen = s.length - dot - 1;
        maxD = Math.max(maxD, Math.min(fracLen, 10));
      }
    }
  }
  const fxLike = sample.some((b) => {
    const c = b.close;
    return typeof c === "number" && c > 0.2 && c < 500;
  });
  if (fxLike) maxD = Math.max(maxD, 5);
  const precision = Math.min(Math.max(maxD, 2), 8);
  const minMove = Number(Math.pow(10, -precision).toFixed(12));
  return { type: "price", precision, minMove };
}

function parseMs(s: string | undefined): number {
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function findNearestBarIndex(ohlc: OhlcBar[], isoWhen: string): number {
  if (!ohlc.length || !isoWhen.trim()) return -1;
  const target = Date.parse(isoWhen);
  if (!Number.isFinite(target)) return -1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < ohlc.length; i++) {
    const barMs = parseMs(ohlc[i].date);
    if (!Number.isFinite(barMs)) continue;
    const d = Math.abs(barMs - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

export function PriceContextChart({ ohlc, entryIso, side = "long", height = 320 }: PriceContextChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<import("lightweight-charts").IChartApi | null>(null);

  const safeBars = useMemo(() => {
    if (!ohlc.length) return [];
    const barTimes = prepareOhlcUtcSecondsSeries(ohlc);
    const out: { time: import("lightweight-charts").UTCTimestamp; open: number; high: number; low: number; close: number; _srcIdx: number }[] = [];
    for (let i = 0; i < ohlc.length; i++) {
      const t = barTimes[i];
      const b = ohlc[i];
      if (t == null) continue;
      const o = b?.open;
      const h = b?.high;
      const l = b?.low;
      const c = b?.close;
      if (
        typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number" ||
        !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)
      ) {
        continue;
      }
      out.push({
        time: t as import("lightweight-charts").UTCTimestamp,
        open: o,
        high: h,
        low: l,
        close: c,
        _srcIdx: i,
      });
    }
    return out;
  }, [ohlc]);

  const entryIndex = useMemo(() => findNearestBarIndex(ohlc, entryIso), [ohlc, entryIso]);
  const safeEntryIdx = useMemo(() => {
    if (!safeBars.length || entryIndex < 0) return -1;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < safeBars.length; i++) {
      const d = Math.abs(safeBars[i]!._srcIdx - entryIndex);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  }, [safeBars, entryIndex]);

  useEffect(() => {
    if (!chartRef.current || safeBars.length < 2 || entryIndex < 0) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;

      const chart = createChart(chartRef.current, {
        width: Math.max(chartRef.current.clientWidth, 240),
        height,
        layout: {
          background: { color: "#18181b" },
          textColor: "#a1a1aa",
        },
        localization: {
          locale: "cs-CZ",
          timeFormatter: (t: unknown) => (typeof t === "number" ? formatChartAxisUtcLabel(t) : String(t)),
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        rightPriceScale: { borderColor: "#3f3f46" },
        timeScale: {
          borderColor: "#3f3f46",
          rightOffset: 6,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: "rgba(161, 161, 170, 0.35)" },
          horzLine: { color: "rgba(161, 161, 170, 0.35)" },
        },
      });
      chartInstanceRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
      });
      candleSeries.applyOptions({ priceFormat: inferPriceFormat(ohlc) });

      const candleData = safeBars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      candleSeries.setData(candleData);

      type Marker = {
        time: import("lightweight-charts").UTCTimestamp;
        position: "belowBar" | "aboveBar";
        color: string;
        shape: "arrowUp" | "arrowDown";
        text: string;
      };
      const ei = Math.max(0, Math.min(safeEntryIdx, candleData.length - 1));
      const entryT = candleData[ei]?.time;
      if (entryT != null) {
        const isLong = side === "long";
        const markers: Marker[] = [
          {
            time: entryT,
            position: isLong ? "belowBar" : "aboveBar",
            color: isLong ? "#10b981" : "#ef4444",
            shape: isLong ? "arrowUp" : "arrowDown",
            text: "Entry",
          },
        ];
        candleSeries.setMarkers(markers);
      }

      chart.timeScale().fitContent();
    });

    return () => {
      mounted = false;
      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;
    };
  }, [ohlc, safeBars, entryIndex, safeEntryIdx, side, height]);

  if (!ohlc.length) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Žádná OHLC data
      </div>
    );
  }

  if (!entryIso.trim() || entryIndex < 0) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Entry není k dispozici
      </div>
    );
  }

  if (safeBars.length < 2) {
    return (
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height }}>
        Nedostatek validních OHLC dat (null/NaN) pro LW graf
      </div>
    );
  }

  return <div ref={chartRef} className="w-full" style={{ height }} />;
}

