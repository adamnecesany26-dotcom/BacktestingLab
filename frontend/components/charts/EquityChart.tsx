"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MAX_POINTS = 6000;

function parseToUnixSeconds(value: string | undefined, fallbackIndex: number): number {
  if (value == null || value === "") {
    return Math.floor(Date.UTC(1970, 0, 1) / 1000) + fallbackIndex;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed / 1000);
  }
  const asNum = Number(value);
  if (Number.isFinite(asNum)) {
    return Math.floor(Date.UTC(1970, 0, 1) / 1000) + asNum;
  }
  return Math.floor(Date.UTC(2020, 0, 1) / 1000) + fallbackIndex;
}

function enforceStrictlyIncreasingTime(points: { time: number; value: number }[]): { time: number; value: number }[] {
  if (points.length === 0) return [];
  const out: { time: number; value: number }[] = [];
  let prev = -Infinity;
  for (const p of points) {
    let t = p.time;
    if (t <= prev) t = prev + 1;
    out.push({ time: t, value: p.value });
    prev = t;
  }
  return out;
}

function downsampleEquity(
  points: { time: number; value: number }[],
  maxPoints: number
): { time: number; value: number }[] {
  if (points.length <= maxPoints) return points;
  const out: { time: number; value: number }[] = [];
  out.push(points[0]);
  const inner = maxPoints - 2;
  const n = points.length;
  for (let i = 0; i < inner; i++) {
    const idx = 1 + Math.floor(((i + 0.5) * (n - 2)) / inner);
    out.push(points[Math.min(idx, n - 2)]);
  }
  out.push(points[n - 1]);
  return out;
}

/** TradingView Lightweight Charts – equity; tlačítko „fit“ přes fitTick (ref se plní async). */
export function EquityChart({
  equity,
  height = 200,
  dates,
  equityCurve,
  maxPoints = DEFAULT_MAX_POINTS,
}: {
  equity?: number[];
  height?: number;
  dates?: string[];
  equityCurve?: { date: string; value: number }[];
  maxPoints?: number;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [fitTick, setFitTick] = useState(0);

  const rawSeries = useMemo(() => {
    const fromCurve =
      equityCurve?.map((p, i) => ({
        time: parseToUnixSeconds(p.date, i),
        value: p.value,
      })) ??
      (equity ?? []).map((v, i) => ({
        time: parseToUnixSeconds(dates?.[i], i),
        value: v,
      }));
    return fromCurve;
  }, [equityCurve, equity, dates]);

  const chartData = useMemo(() => {
    const inc = enforceStrictlyIncreasingTime(rawSeries);
    return downsampleEquity(inc, maxPoints);
  }, [rawSeries, maxPoints]);

  const downsampleNote = useMemo(() => {
    if (rawSeries.length > maxPoints) {
      return `Zobrazeno ${chartData.length} bodů z ${rawSeries.length} (celý rozsah období).`;
    }
    return null;
  }, [rawSeries.length, chartData.length, maxPoints]);

  const fitAll = useCallback(() => {
    setFitTick((x) => x + 1);
  }, []);

  useEffect(() => {
    if (!chartRef.current || chartData.length === 0) return;

    let mounted = true;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    void import("lightweight-charts").then(({ createChart }) => {
      if (!mounted || !chartRef.current) return;
      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;

      const el = chartRef.current!;
      const w = Math.max(el.clientWidth || el.getBoundingClientRect().width || 300, 200);

      const chart = createChart(el, {
        width: w,
        height,
        layout: {
          background: { color: "#18181b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#27272a" },
          horzLines: { color: "#27272a" },
        },
        timeScale: {
          borderColor: "#3f3f46",
          rightOffset: 4,
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        rightPriceScale: {
          borderColor: "#3f3f46",
        },
      });
      chartInstanceRef.current = chart;

      const series = chart.addAreaSeries({
        lineColor: "#10b981",
        topColor: "rgba(16, 185, 129, 0.4)",
        bottomColor: "rgba(16, 185, 129, 0)",
      });

      series.setData(
        chartData.map((d) => ({
          time: d.time as import("lightweight-charts").UTCTimestamp,
          value: d.value,
        }))
      );

      const doFit = () => {
        try {
          chart.timeScale().fitContent();
        } catch {
          /* ignore */
        }
      };
      doFit();
      requestAnimationFrame(() => {
        doFit();
        requestAnimationFrame(doFit);
      });

      const ro = new ResizeObserver(() => {
        if (!chartRef.current || !chartInstanceRef.current) return;
        const nw = Math.max(chartRef.current.clientWidth, 200);
        chartInstanceRef.current.applyOptions({ width: nw });
        chartInstanceRef.current.timeScale().fitContent();
      });
      ro.observe(el);
      resizeObserverRef.current = ro;
    });

    return () => {
      mounted = false;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      chartInstanceRef.current?.remove();
      chartInstanceRef.current = null;
    };
  }, [chartData, height]);

  /** Tlačítko „Celé období“ – ref se nastaví až po async importu, proto samostatný efekt. */
  useEffect(() => {
    if (fitTick === 0) return;
    const run = () => {
      const chart = chartInstanceRef.current;
      if (!chart) return;
      try {
        chart.timeScale().fitContent();
      } catch {
        /* ignore */
      }
    };
    run();
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      run();
      raf2 = requestAnimationFrame(run);
    });
    const t1 = window.setTimeout(run, 80);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t1);
    };
  }, [fitTick]);

  if (rawSeries.length === 0) {
    return (
      <div className="h-[200px] rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
        No equity data
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        {downsampleNote ? (
          <p className="text-xs text-zinc-500">{downsampleNote}</p>
        ) : (
          <p className="text-xs text-zinc-500">Celé období backtestu (osa X = čas podle dat engine).</p>
        )}
        <button
          type="button"
          onClick={fitAll}
          className="text-xs px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600"
        >
          Celé období (fit)
        </button>
      </div>
      <div ref={chartRef} className="w-full flex-1 min-h-[280px] rounded-lg overflow-hidden" />
    </div>
  );
}
