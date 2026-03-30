"use client";

import { useEffect, useRef } from "react";
import type { Trade } from "@shared/types";
import type { OhlcBar } from "@shared/types";
import { formatChartAxisUtcLabel, prepareOhlcUtcSecondsSeries } from "@/lib/chartOhlcResample";

interface TradeHighlightChartProps {
  ohlc: OhlcBar[];
  trade: Trade | null;
  height?: number;
}

const CONTEXT_BARS = 20;

/** Forex / GBP apod. – LW Charts default truncuje na 2 desetinná místa. */
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

function parseBarTimeMs(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Najde index baru, jehož čas je nejblíž okamžiku obchodu (entry/exit ISO z engine).
 * Dříve se používalo jen YYYY-MM-DD → u intraday všechny bary v jednom dni spadly na STEJNÝ
 * první bar dne → zavádějící šipky vůči skutečným fill cenám.
 */
function findNearestBarIndex(ohlc: OhlcBar[], isoWhen: string): number {
  if (ohlc.length === 0 || !isoWhen.trim()) return -1;
  const target = Date.parse(isoWhen);
  if (!Number.isFinite(target)) return -1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < ohlc.length; i++) {
    const barMs = parseBarTimeMs(ohlc[i].date);
    if (!Number.isFinite(barMs)) continue;
    const d = Math.abs(barMs - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

function getOhlcWindowAndLocalIndices(
  ohlc: OhlcBar[],
  trade: Trade
): { window: OhlcBar[]; entryLocal: number; exitLocal: number } {
  const entryDate = trade.entryDate ?? trade.date ?? "";
  const exitDate = trade.exitDate ?? trade.date ?? "";
  let entryIdx = findNearestBarIndex(ohlc, entryDate);
  let exitIdx = findNearestBarIndex(ohlc, exitDate);
  if (entryIdx < 0) entryIdx = 0;
  if (exitIdx < 0) exitIdx = ohlc.length - 1;
  if (entryIdx > exitIdx) {
    const t = entryIdx;
    entryIdx = exitIdx;
    exitIdx = t;
  }
  const start = Math.max(0, entryIdx - CONTEXT_BARS);
  const end = Math.min(ohlc.length, exitIdx + CONTEXT_BARS + 1);
  const window = ohlc.slice(start, end);
  return {
    window,
    entryLocal: entryIdx - start,
    exitLocal: exitIdx - start,
  };
}

export function TradeHighlightChart({ ohlc, trade, height = 360 }: TradeHighlightChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);

  const pack =
    trade != null && ohlc.length > 0 ? getOhlcWindowAndLocalIndices(ohlc, trade) : null;
  const windowOhlc = pack?.window ?? [];
  const entryLocal = pack?.entryLocal ?? 0;
  const exitLocal = pack?.exitLocal ?? 0;

  useEffect(() => {
    if (!chartRef.current || windowOhlc.length === 0 || !trade) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;

      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;

      const chart = createChart(chartRef.current, {
        width: Math.max(chartRef.current.clientWidth, 200),
        height,
        layout: {
          background: { color: "#18181b" },
          textColor: "#a1a1aa",
        },
        localization: {
          locale: "cs-CZ",
          timeFormatter: (t: unknown) =>
            typeof t === "number" ? formatChartAxisUtcLabel(t) : String(t),
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        rightPriceScale: { borderColor: "#3f3f46" },
        timeScale: {
          borderColor: "#3f3f46",
          rightOffset: 4,
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
      });

      const priceFmt = inferPriceFormat(windowOhlc);
      candleSeries.applyOptions({ priceFormat: priceFmt });

      const barTimes = prepareOhlcUtcSecondsSeries(windowOhlc);
      const deduped = windowOhlc.map((bar: OhlcBar, i: number) => ({
        time: barTimes[i]! as import("lightweight-charts").UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(deduped);

      const ei = Math.max(0, Math.min(entryLocal, deduped.length - 1));
      const xi = Math.max(0, Math.min(exitLocal, deduped.length - 1));

      type Marker = {
        time: import("lightweight-charts").UTCTimestamp;
        position: "belowBar" | "aboveBar";
        color: string;
        shape: "arrowUp" | "arrowDown";
        text: string;
      };
      const markers: Marker[] = [];
      let lastT = -Infinity;
      const pushMarker = (timeSec: number, m: Omit<Marker, "time">) => {
        let t = timeSec;
        if (t <= lastT) t = lastT + 1e-6;
        lastT = t;
        markers.push({ ...m, time: t as import("lightweight-charts").UTCTimestamp });
      };
      pushMarker(Number(deduped[ei].time), {
        position: trade.type === "buy" ? "belowBar" : "aboveBar",
        color: trade.type === "buy" ? "#10b981" : "#ef4444",
        shape: trade.type === "buy" ? "arrowUp" : "arrowDown",
        text: trade.type === "buy" ? "Long" : "Short",
      });
      pushMarker(Number(deduped[xi].time), {
        position: trade.type === "buy" ? "aboveBar" : "belowBar",
        color: "#a1a1aa",
        shape: trade.type === "buy" ? "arrowDown" : "arrowUp",
        text: "Exit",
      });
      candleSeries.setMarkers(markers);

      // Skutečné fill ceny z engine (ne pozice šipek u OHLC)
      const cs = candleSeries as unknown as {
        createPriceLine?: (opts: {
          price: number;
          color: string;
          lineWidth: number;
          lineStyle?: number;
          axisLabelVisible: boolean;
          title: string;
        }) => { remove: () => void };
      };
      if (typeof cs.createPriceLine === "function") {
        if (trade.entryPrice != null && Number.isFinite(trade.entryPrice)) {
          cs.createPriceLine({
            price: trade.entryPrice,
            color: "rgba(16, 185, 129, 0.85)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Entry ${trade.entryPrice.toFixed(priceFmt.precision)}`,
          });
        }
        if (trade.exitPrice != null && Number.isFinite(trade.exitPrice)) {
          cs.createPriceLine({
            price: trade.exitPrice,
            color: "rgba(161, 161, 170, 0.95)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Exit ${trade.exitPrice.toFixed(priceFmt.precision)}`,
          });
        }
        const zm = trade.zoneMeta && typeof trade.zoneMeta === "object" ? (trade.zoneMeta as Record<string, unknown>) : null;
        const readPx = (keys: string[]): number | null => {
          if (!zm) return null;
          for (const k of keys) {
            const v = zm[k];
            if (typeof v === "number" && Number.isFinite(v)) return v;
            if (typeof v === "string") {
              const n = Number(v);
              if (Number.isFinite(n)) return n;
            }
          }
          return null;
        };
        const sl = readPx(["stopPrice", "stop_loss", "sl", "stop"]);
        const tp = readPx(["targetPrice", "takeProfit", "tp", "target"]);
        if (sl != null) {
          cs.createPriceLine({
            price: sl,
            color: "rgba(248, 113, 113, 0.9)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Stop ${sl.toFixed(priceFmt.precision)}`,
          });
        }
        if (tp != null) {
          cs.createPriceLine({
            price: tp,
            color: "rgba(74, 222, 128, 0.9)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `TP ${tp.toFixed(priceFmt.precision)}`,
          });
        }
      }

      chart.timeScale().fitContent();
      chartInstanceRef.current = chart;
    });

    return () => {
      mounted = false;
      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;
    };
  }, [windowOhlc, trade, height, entryLocal, exitLocal]);

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
