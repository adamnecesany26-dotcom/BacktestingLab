"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

/**
 * Osa Y bez nuly: vizuálně „zoom“ kolem dat.
 * Spodní mez = nejbližší hrubší dělení pod minimum (krok ≈ ¼ řádu hodnoty, typ. u ~100k USD je krok 25k),
 * takže např. min equity 90–93k → spodní okraj osy často 75k, 80k… (ne od 0).
 * Horní mez = nad maximum + malý odstup, zaokrouhleno nahoru ke stejnému kroku.
 */
function computeEquityYRange(values: number[]): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];

  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.02, 1);
    return [lo - pad, hi + pad];
  }

  const span = hi - lo;
  const k = Math.floor(Math.log10(Math.max(lo, 1e-9)));
  // 2,5 × 10^(k−1): u účtů řádu 10^5 dá krok 25 000; u menších částek menší krok
  const step = Math.pow(10, Math.max(0, k - 1)) * 2.5;

  const cushionBelow = Math.max(span * 0.1, step * 0.15);
  const cushionAbove = Math.max(span * 0.06, step * 0.15);

  let yMin = Math.floor((lo - cushionBelow) / step) * step;
  if (yMin >= lo - span * 0.005) yMin -= step;

  let yMax = Math.ceil((hi + cushionAbove) / step) * step;
  if (yMax <= hi + span * 0.005) yMax += step;

  return [yMin, yMax];
}

function downsamplePairs(
  dates: string[],
  values: number[],
  maxPoints: number
): { dates: string[]; values: number[] } {
  const n = dates.length;
  if (n <= maxPoints) return { dates, values };
  const outD: string[] = [dates[0]];
  const outV: number[] = [values[0]];
  const inner = maxPoints - 2;
  for (let i = 0; i < inner; i++) {
    const idx = 1 + Math.floor(((i + 0.5) * (n - 2)) / inner);
    const j = Math.min(idx, n - 2);
    outD.push(dates[j]);
    outV.push(values[j]);
  }
  outD.push(dates[n - 1]);
  outV.push(values[n - 1]);
  return { dates: outD, values: outV };
}

/** Equity: Plotly, osa X = datum, osa Y = hodnota účtu. */
export function EquityChart({
  equity,
  height = 340,
  dates,
  equityCurve,
  maxPoints,
}: {
  equity?: number[];
  height?: number;
  dates?: string[];
  equityCurve?: { date: string; value: number }[];
  maxPoints?: number;
}) {
  const pointCap = maxPoints ?? Number.POSITIVE_INFINITY;
  const [Plot, setPlot] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

  const { xDates, yEquity, rawCount } = useMemo(() => {
    if (equityCurve?.length) {
      const d = equityCurve.map((p) => p.date);
      const v = equityCurve.map((p) => p.value);
      return { xDates: d, yEquity: v, rawCount: d.length };
    }
    const v = equity ?? [];
    const d = dates ?? v.map((_, i) => String(i));
    const n = Math.min(d.length, v.length);
    return {
      xDates: d.slice(0, n),
      yEquity: v.slice(0, n),
      rawCount: n,
    };
  }, [equityCurve, equity, dates]);

  const { plotX, plotY } = useMemo(() => {
    if (!Number.isFinite(pointCap) || rawCount <= pointCap) {
      return { plotX: xDates, plotY: yEquity };
    }
    const { dates: d, values: vals } = downsamplePairs(xDates, yEquity, Math.floor(pointCap));
    return { plotX: d, plotY: vals };
  }, [xDates, yEquity, rawCount, pointCap]);

  const downsampleNote = useMemo(() => {
    if (Number.isFinite(pointCap) && rawCount > pointCap) {
      return `Zobrazeno ${plotX.length} bodů z ${rawCount} (kvůli výkonu).`;
    }
    return null;
  }, [pointCap, rawCount, plotX.length]);

  /** Rozsah Y z celé série (ne z downsample), ať osa odpovídá skutečnému min/max. */
  const yRange = useMemo(() => computeEquityYRange(yEquity), [yEquity]);

  const trace = useMemo(
    () => ({
      type: "scatter" as const,
      mode: "lines" as const,
      x: plotX,
      y: plotY,
      fill: "tozeroy",
      fillcolor: "rgba(16, 185, 129, 0.35)",
      line: { color: "#10b981", width: 2 },
      hovertemplate: "%{x}<br>Equity: %{y:,.2f}<extra></extra>",
    }),
    [plotX, plotY]
  );

  const layout = useMemo(
    () => ({
      height,
      margin: { t: 24, r: 16, b: 48, l: 56 },
      paper_bgcolor: "#18181b",
      plot_bgcolor: "#18181b",
      font: { color: "#a1a1aa", size: 11 },
      xaxis: {
        title: { text: "Čas", font: { size: 11, color: "#71717a" } },
        type: "date" as const,
        gridcolor: "#27272a",
        rangeslider: { visible: false },
        fixedrange: false,
        automargin: true,
      },
      yaxis: {
        title: { text: "Equity", font: { size: 11, color: "#71717a" } },
        gridcolor: "#27272a",
        tickformat: ",.2f",
        fixedrange: false,
        automargin: true,
        range: yRange,
        autorange: false,
        rangemode: "normal" as const,
      },
      showlegend: false,
      dragmode: "zoom" as const,
    }),
    [height, yRange]
  );

  const config = useMemo(
    () => ({
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    }),
    []
  );

  if (rawCount === 0) {
    return (
      <div className="h-[200px] rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
        No equity data
      </div>
    );
  }

  if (!Plot) {
    return (
      <div
        className="flex items-center justify-center text-zinc-500 text-sm rounded-lg bg-zinc-900"
        style={{ height }}
      >
        Načítání grafu…
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0 gap-2">
      <div className="shrink-0">
        {downsampleNote ? (
          <p className="text-xs text-zinc-500">{downsampleNote}</p>
        ) : (
          <p className="text-xs text-zinc-500">
            Zobrazeno všech {rawCount} bodů. Osa Y je zúžena kolem min/max equity, ne od nuly.
          </p>
        )}
      </div>
      <div className="w-full flex-1 min-h-[280px] rounded-lg overflow-hidden">
        <Plot
          data={[trace]}
          layout={layout}
          config={config}
          style={{ width: "100%", minHeight: height }}
          useResizeHandler
        />
      </div>
    </div>
  );
}

export default EquityChart;
