import {
  isViewRegimeHistogramLine,
  type ViewLine,
  type ViewLineSeries,
  type ViewZone,
} from "@/lib/api";
import type { OhlcBar } from "@shared/types";
import { coerceViewMarkerBarIndex } from "@/lib/viewDemoObdobiSlice";
import {
  HL_TREND_STATE_COLORS,
  groupIndexedTrendSegments,
  lineDataHasTrendState,
} from "@/lib/viewChartLines";

export type VisibilityKey =
  | "swing_hl"
  | "internal_hl"
  | "major_hl"
  | "bos_levels"
  | "inducement_points"
  | "demand_supply_zones"
  | "support_resistance_zones"
  | "premium_discount_zones"
  | "lines";

export const DEFAULT_VISIBILITY: Record<VisibilityKey, boolean> = {
  swing_hl: true,
  internal_hl: false,
  major_hl: false,
  bos_levels: false,
  inducement_points: false,
  demand_supply_zones: true,
  support_resistance_zones: false,
  premium_discount_zones: false,
  lines: false,
};

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "").trim();
  if (m.length !== 6 || !/^[0-9a-fA-F]+$/.test(m)) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const REGIME_HISTOGRAM_COLORS = {
  trend: "rgba(0, 200, 0, 0.85)",
  chop: "rgba(120, 120, 120, 0.65)",
  high_vol: "rgba(220, 0, 0, 0.85)",
} as const;

function zoneEndpointsToBarIndices(
  z: Pick<ViewZone, "date_start" | "date_end">,
  ohlc: OhlcBar[],
  n: number,
): [number, number] | null {
  if (n < 1) return null;
  const barMs = (i: number) => Date.parse(ohlc[i]?.date ?? "");
  let zs = Date.parse(z.date_start);
  let ze = Date.parse(z.date_end);
  if (!Number.isFinite(zs) || !Number.isFinite(ze)) return null;
  if (ze < zs) {
    const t = zs;
    zs = ze;
    ze = t;
  }
  const firstMs = barMs(0);
  const lastMs = barMs(n - 1);
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return null;
  if (ze < firstMs || zs > lastMs) return null;
  let idxStart = 0;
  for (let i = 0; i < n; i++) {
    const t = barMs(i);
    if (Number.isFinite(t) && t >= zs) {
      idxStart = i;
      break;
    }
  }
  let idxEnd = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    const t = barMs(i);
    if (Number.isFinite(t) && t <= ze) {
      idxEnd = i;
      break;
    }
  }
  if (idxStart > idxEnd) return null;
  return [idxStart, idxEnd];
}

function buildInducementMarkerTrace(
  points: { idx: number; val: number }[],
  colorHex: string,
  name: string,
  numBars: number,
): any | null {
  if (points.length === 0 || numBars < 1) return null;
  const clamped = points
    .map((p) => ({
      idx: Math.max(0, Math.min(Math.floor(p.idx), numBars - 1)),
      val: p.val,
    }))
    .filter((p) => Number.isFinite(p.val));
  if (clamped.length === 0) return null;
  return {
    type: "scatter",
    mode: "markers",
    x: clamped.map((p) => p.idx),
    y: clamped.map((p) => p.val),
    marker: {
      size: 11,
      symbol: "circle",
      color: hexToRgba(colorHex, 0.4),
      line: { color: "rgba(255,255,255,0.4)", width: 1 },
    },
    name,
    showlegend: true,
    hovertemplate: "Inducement %{y:.4f}<extra></extra>",
  };
}

function buildZoneTouchMarkerTrace(
  zones: { touch_bar_index?: number; touch_marker_price?: number }[],
  numBars: number,
): any | null {
  if (numBars < 1) return null;
  const pts: { idx: number; val: number }[] = [];
  for (const z of zones) {
    const bi = z.touch_bar_index;
    const pr = z.touch_marker_price;
    if (typeof bi !== "number" || typeof pr !== "number" || !Number.isFinite(pr)) continue;
    pts.push({
      idx: Math.max(0, Math.min(Math.floor(bi), numBars - 1)),
      val: pr,
    });
  }
  if (pts.length === 0) return null;
  return {
    type: "scatter",
    mode: "markers",
    x: pts.map((p) => p.idx),
    y: pts.map((p) => p.val),
    marker: {
      size: 14,
      symbol: "circle",
      color: "rgba(245, 158, 11, 0.75)",
      line: { color: "rgba(251, 191, 36, 0.95)", width: 1.5 },
    },
    name: "Touch zóny",
    showlegend: true,
    hovertemplate: "Touch zóny %{y:.4f}<extra></extra>",
  };
}

export type ViewLikeSpecInput = {
  ohlc: OhlcBar[];
  markers: { date: string; type: string; value: number | null; bar_index?: number | string }[];
  lines: ViewLine[];
  zones: ViewZone[];
  visibility: Record<VisibilityKey, boolean>;
  height: number;
  extraTraces?: any[];
  extraShapes?: any[];
  extraAnnotations?: any[];
};

export function buildViewLikeChartSpec(input: ViewLikeSpecInput): { traces: any[]; layout: any; config: any } {
  const { ohlc, markers, lines, zones, visibility, height, extraTraces, extraShapes, extraAnnotations } = input;
  const n = ohlc.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const dateToIndex = new Map(ohlc.map((b, i) => [b.date, i]));
  const dayToIndex = new Map(ohlc.map((b, i) => [b.date.slice(0, 10), i]));

  const tickStep = Math.max(1, Math.floor(n / 8));
  const tickvals = Array.from({ length: Math.ceil(n / tickStep) + 1 }, (_, i) => Math.min(i * tickStep, n - 1));
  const ticktext = tickvals.map((i) => {
    const raw = ohlc[i]?.date ?? "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const hasTime = /T\\d{2}:\\d{2}/.test(raw) || /\\s\\d{2}:\\d{2}/.test(raw);
    return parsed.toLocaleString("cs-CZ", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  });

  const candlestickTrace: any = {
    type: "candlestick",
    x: indices,
    open: ohlc.map((b) => b.open),
    high: ohlc.map((b) => b.high),
    low: ohlc.map((b) => b.low),
    close: ohlc.map((b) => b.close),
    increasing: { line: { color: "#10b981", width: 1 }, fillcolor: "#10b981" },
    decreasing: { line: { color: "#ef4444", width: 1 }, fillcolor: "#ef4444" },
    xperiodalignment: "middle",
    name: "OHLC",
  };

  const ohlcYForSwingMarker = (typ: string, idx: number): number | null => {
    const bar = ohlc[idx];
    if (!bar) return null;
    switch (typ) {
      case "high":
      case "major_high":
      case "internal_high":
        return typeof bar.high === "number" && Number.isFinite(bar.high) ? bar.high : null;
      case "low":
      case "major_low":
      case "internal_low":
        return typeof bar.low === "number" && Number.isFinite(bar.low) ? bar.low : null;
      default:
        return null;
    }
  };

  const mapMarkerToIndex = (m: { date: string; type: string; value: number | null; bar_index?: number | string }) => {
    const bi0 = coerceViewMarkerBarIndex(m.bar_index);
    if (bi0 !== null && n > 0) {
      const i = bi0;
      if (i >= 0 && i < n) return i;
    }
    const exact = dateToIndex.get(m.date);
    if (exact !== undefined && exact >= 0) return exact;
    const t = Date.parse(m.date);
    const dayKey = (m.date || "").trim().slice(0, 10);
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(dayKey) && Number.isFinite(t) && n > 0) {
      let bestDay = -1;
      let bestDayAbs = Infinity;
      for (let i = 0; i < n; i++) {
        const raw = ohlc[i]?.date ?? "";
        if (raw.slice(0, 10) !== dayKey) continue;
        const bt = Date.parse(raw);
        if (!Number.isFinite(bt)) continue;
        const d = Math.abs(bt - t);
        if (d < bestDayAbs) {
          bestDayAbs = d;
          bestDay = i;
        }
      }
      if (bestDay >= 0) return bestDay;
    }
    const dayFallback = dayToIndex.get(dayKey);
    if (dayFallback !== undefined && dayFallback >= 0) return dayFallback;
    const ymKey = (s: string) => {
      const d = (s || "").trim().slice(0, 10);
      return d.length >= 7 ? d.slice(0, 7) : "";
    };
    const mkYm = ymKey(m.date);
    if (/^\\d{4}-\\d{2}$/.test(mkYm) && n > 0 && Number.isFinite(t)) {
      let ymBest = -1;
      let ymBestAbs = Infinity;
      for (let i = 0; i < n; i++) {
        const raw = ohlc[i]?.date ?? "";
        if (ymKey(raw) !== mkYm) continue;
        const bt = Date.parse(raw);
        if (!Number.isFinite(bt)) continue;
        const d = Math.abs(bt - t);
        if (d < ymBestAbs) {
          ymBestAbs = d;
          ymBest = i;
        }
      }
      if (ymBest >= 0) return ymBest;
    }
    if (!Number.isFinite(t) || n <= 0) return -1;
    const firstMs = Date.parse(ohlc[0]?.date ?? "");
    const lastMs = Date.parse(ohlc[n - 1]?.date ?? "");
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return -1;
    const padMs = 86400000;
    if (t < firstMs - padMs || t > lastMs + padMs) return -1;
    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < n; i++) {
      const bt = Date.parse(ohlc[i]?.date ?? "");
      if (!Number.isFinite(bt)) continue;
      const d = Math.abs(bt - t);
      if (d < bestAbs) {
        bestAbs = d;
        best = i;
      }
    }
    const stepMs = n >= 2 ? Math.max(3600000, (lastMs - firstMs) / Math.max(1, n - 1)) : 86400000;
    const maxFuzzyMs =
      stepMs >= 7 * 86400000
        ? Math.min(120 * 86400000, Math.max(stepMs * 1.25, 14 * 86400000))
        : Math.min(7 * 86400000, Math.max(3 * stepMs, 2 * 3600000));
    return best >= 0 && bestAbs <= maxFuzzyMs ? best : -1;
  };

  const mapSwingMarker = (m: { date: string; type: string; value: number | null; bar_index?: number | string }) => {
    const idx = mapMarkerToIndex(m);
    if (idx < 0) return { idx, val: null as number | null };
    const yOhlc = ohlcYForSwingMarker(m.type, idx);
    const v =
      yOhlc != null
        ? yOhlc
        : typeof m.value === "number" && Number.isFinite(m.value)
          ? m.value
          : null;
    return { idx, val: v };
  };

  const highMarkers = markers.filter((m) => m.type === "high");
  const lowMarkers = markers.filter((m) => m.type === "low");
  const majorHighMarkers = markers.filter((m) => m.type === "major_high");
  const majorLowMarkers = markers.filter((m) => m.type === "major_low");
  const internalHighMarkers = markers.filter((m) => m.type === "internal_high");
  const internalLowMarkers = markers.filter((m) => m.type === "internal_low");
  const bosBullMarkers = markers.filter((m) => m.type === "bos_bullish");
  const bosBearMarkers = markers.filter((m) => m.type === "bos_bearish");
  const otherMarkers = markers.filter(
    (m) =>
      m.type !== "high" &&
      m.type !== "low" &&
      m.type !== "major_high" &&
      m.type !== "major_low" &&
      m.type !== "internal_high" &&
      m.type !== "internal_low" &&
      m.type !== "bos_bullish" &&
      m.type !== "bos_bearish",
  );

  const highMapped = highMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const lowMapped = lowMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const majorHighMapped = majorHighMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const majorLowMapped = majorLowMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const internalHighMapped = internalHighMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const internalLowMapped = internalLowMarkers
    .map((m) => mapSwingMarker(m))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const otherMapped = otherMarkers
    .map((m) => ({ idx: mapMarkerToIndex(m), val: m.value }))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));

  const bosBullMapped = bosBullMarkers
    .map((m) => ({ idx: mapMarkerToIndex(m), val: m.value }))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));
  const bosBearMapped = bosBearMarkers
    .map((m) => ({ idx: mapMarkerToIndex(m), val: m.value }))
    .filter((p): p is { idx: number; val: number } => p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val));

  const inducementPointsByZone = zones
    .flatMap((z) =>
      (z.inducements ?? []).map((ind) => {
        const rawIndex = (ind as { index?: number }).index;
        let idx: number;
        if (typeof rawIndex === "number" && !Number.isNaN(rawIndex)) {
          idx = Math.max(0, Math.min(rawIndex, n - 1));
        } else {
          idx = mapMarkerToIndex({ date: ind.date ?? "", type: "high", value: ind.value });
        }
        return { idx, val: ind.value, zoneName: z.name };
      }),
    )
    .filter(
      (p): p is { idx: number; val: number; zoneName: string } =>
        p.idx >= 0 && typeof p.val === "number" && Number.isFinite(p.val),
    );

  const inducementDemand = inducementPointsByZone.filter((p) => p.zoneName === "Demand");
  const inducementSupply = inducementPointsByZone.filter((p) => p.zoneName === "Supply");
  const inducementOther = inducementPointsByZone.filter((p) => p.zoneName !== "Demand" && p.zoneName !== "Supply");

  const inducementDemandTrace = buildInducementMarkerTrace(inducementDemand, "#3b82f6", "Inducement (D)", n);
  const inducementSupplyTrace = buildInducementMarkerTrace(inducementSupply, "#a855f7", "Inducement (S)", n);
  const inducementOtherTrace = buildInducementMarkerTrace(inducementOther, "#64748b", "Inducement", n);

  const zoneTouchTrace = buildZoneTouchMarkerTrace(zones, n);

  const highTrace: any = {
    type: "scatter",
    x: highMapped.map((p) => p.idx),
    y: highMapped.map((p) => p.val),
    mode: "markers",
    marker: { size: 10, color: "#10b981", symbol: "circle", line: { color: "#fff", width: 1 } },
    name: "High",
    showlegend: highMarkers.length > 0,
  };
  const lowTrace: any = {
    type: "scatter",
    x: lowMapped.map((p) => p.idx),
    y: lowMapped.map((p) => p.val),
    mode: "markers",
    marker: { size: 10, color: "#ef4444", symbol: "circle", line: { color: "#fff", width: 1 } },
    name: "Low",
    showlegend: lowMarkers.length > 0,
  };

  const majorHighTrace: any =
    majorHighMapped.length > 0
      ? {
          type: "scatter",
          x: majorHighMapped.map((p) => p.idx),
          y: majorHighMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 14, color: "#fbbf24", symbol: "diamond", line: { color: "#fff", width: 1.5 } },
          name: "Major High",
          showlegend: true,
        }
      : null;

  const majorLowTrace: any =
    majorLowMapped.length > 0
      ? {
          type: "scatter",
          x: majorLowMapped.map((p) => p.idx),
          y: majorLowMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 14, color: "#f59e0b", symbol: "diamond", line: { color: "#fff", width: 1.5 } },
          name: "Major Low",
          showlegend: true,
        }
      : null;

  const internalHighTrace: any =
    internalHighMapped.length > 0
      ? {
          type: "scatter",
          x: internalHighMapped.map((p) => p.idx),
          y: internalHighMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 4, color: "#6ee7b7", symbol: "circle", line: { color: "#10b981", width: 0.5 } },
          name: "Internal High",
          showlegend: true,
        }
      : null;
  const internalLowTrace: any =
    internalLowMapped.length > 0
      ? {
          type: "scatter",
          x: internalLowMapped.map((p) => p.idx),
          y: internalLowMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 4, color: "#fca5a5", symbol: "circle", line: { color: "#ef4444", width: 0.5 } },
          name: "Internal Low",
          showlegend: true,
        }
      : null;

  const otherTrace: any =
    otherMapped.length > 0
      ? {
          type: "scatter",
          x: otherMapped.map((p) => p.idx),
          y: otherMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 10, color: "#3b82f6", symbol: "diamond", line: { color: "#fff", width: 1 } },
          name: "Signal",
          showlegend: true,
        }
      : null;

  const bosBullTrace: any =
    bosBullMapped.length > 0
      ? {
          type: "scatter",
          x: bosBullMapped.map((p) => p.idx),
          y: bosBullMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 11, color: "#14b8a6", symbol: "triangle-up", line: { color: "#fff", width: 1 } },
          name: "BOS ↑",
          showlegend: true,
        }
      : null;
  const bosBearTrace: any =
    bosBearMapped.length > 0
      ? {
          type: "scatter",
          x: bosBearMapped.map((p) => p.idx),
          y: bosBearMapped.map((p) => p.val),
          mode: "markers",
          marker: { size: 11, color: "#c084fc", symbol: "triangle-down", line: { color: "#fff", width: 1 } },
          name: "BOS ↓",
          showlegend: true,
        }
      : null;

  const lineColors = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4"];
  const trendNameCount = new Map<string, number>();
  const standardLines = lines.filter((line): line is ViewLineSeries => !isViewRegimeHistogramLine(line));
  const regimeHistogramLine = lines.find(isViewRegimeHistogramLine);

  const lineTraces = standardLines.flatMap((line, i) => {
    const fallbackColor = line.color ?? lineColors[i % lineColors.length];
    const data = line.data ?? [];
    if (line.color) {
      const pts = data
        .map((p) => {
          const idx = dateToIndex.get(p.date) ?? dayToIndex.get(p.date.slice(0, 10)) ?? -1;
          let ht = "%{y:.4f}<extra></extra>";
          if (p.state != null && String(p.state).length > 0) {
            ht =
              p.score != null && Number.isFinite(Number(p.score))
                ? `${p.state} · ${Number(p.score).toFixed(0)}<extra></extra>`
                : `${p.state}<extra></extra>`;
          }
          return { idx, val: p.value, ht };
        })
        .filter((p) => p.idx >= 0)
        .sort((a, b) => a.idx - b.idx);
      if (pts.length === 0) return [];
      const prev = trendNameCount.get(line.name) ?? 0;
      trendNameCount.set(line.name, prev + 1);
      return [
        {
          type: "scatter" as const,
          x: pts.map((p) => p.idx),
          y: pts.map((p) => p.val),
          mode: "lines" as const,
          line: { color: line.color, width: 2, shape: "linear" as const },
          connectgaps: true,
          name: line.name,
          legendgroup: line.name,
          showlegend: prev === 0,
          hovertemplate: "%{text}",
          text: pts.map((p) => p.ht),
        },
      ];
    }
    if (lineDataHasTrendState(data)) {
      const segs = groupIndexedTrendSegments(data, dateToIndex, dayToIndex);
      if (segs.length === 0) return [];
      const prev = trendNameCount.get(line.name) ?? 0;
      trendNameCount.set(line.name, prev + 1);
      const showLegendForLine = prev === 0;
      return segs.map((seg, si) => ({
        type: "scatter" as const,
        x: seg.x,
        y: seg.y,
        mode: "lines" as const,
        line: { color: HL_TREND_STATE_COLORS[seg.state] ?? fallbackColor, width: 2, shape: "linear" as const },
        connectgaps: true,
        name: line.name,
        legendgroup: line.name,
        showlegend: showLegendForLine && si === 0,
        hovertemplate: "%{text}",
        text: seg.text,
      }));
    }
    const pts = data
      .map((p) => ({ idx: dateToIndex.get(p.date) ?? dayToIndex.get(p.date.slice(0, 10)) ?? -1, val: p.value }))
      .filter((p) => p.idx >= 0)
      .sort((a, b) => a.idx - b.idx);
    if (pts.length === 0) return [];
    const count = (trendNameCount.get(line.name) ?? 0) + 1;
    trendNameCount.set(line.name, count);
    return [
      {
        type: "scatter" as const,
        x: pts.map((p) => p.idx),
        y: pts.map((p) => p.val),
        mode: "lines" as const,
        line: { color: fallbackColor, width: 2, shape: "linear" },
        connectgaps: true,
        name: line.name,
        legendgroup: line.name,
        showlegend: count === 1,
      },
    ];
  });

  type RegimeKey = keyof typeof REGIME_HISTOGRAM_COLORS;
  const dominantRegime = (t: number, c: number, h: number): RegimeKey => {
    if (t >= c && t >= h) return "trend";
    if (h >= c) return "high_vol";
    return "chop";
  };

  let regimeBarTrace: any = null;
  if (visibility.lines && regimeHistogramLine && regimeHistogramLine.data.length > 0 && n > 0) {
    const xs: number[] = [];
    const ys: number[] = [];
    const colors: string[] = [];
    const texts: string[] = [];
    for (const p of regimeHistogramLine.data) {
      const idx = mapMarkerToIndex({ date: p.date, type: "high", value: 0 } as any);
      if (idx < 0) continue;
      const t = (p as any).trend;
      const c = (p as any).chop;
      const h = (p as any).high_vol;
      const dom = dominantRegime(t, c, h);
      xs.push(idx);
      ys.push(Math.max(t, c, h));
      colors.push((REGIME_HISTOGRAM_COLORS as any)[dom]);
      const label = dom === "trend" ? "Trend" : dom === "high_vol" ? "High vol" : "Chop";
      texts.push(`${label}<br>Trend: ${t.toFixed(3)} | Chop: ${c.toFixed(3)} | High vol: ${h.toFixed(3)}<extra></extra>`);
    }
    if (xs.length > 0) {
      regimeBarTrace = {
        type: "bar",
        x: xs,
        y: ys,
        xaxis: "x2",
        yaxis: "y2",
        marker: { color: colors, line: { width: 0 } },
        width: 0.92,
        name: regimeHistogramLine.name || "Režim",
        hovertemplate: "%{text}",
        text: texts,
        showlegend: false,
      };
    }
  }

  const showRegimeHistogram = regimeBarTrace != null;
  const pax = showRegimeHistogram ? { xaxis: "x", yaxis: "y" } : {};

  const isBosZone = (name?: string) => name === "BOS" || name === "BOS (M)";
  const isDemandSupplyZone = (name?: string) => name === "Demand" || name === "Supply";
  const isSupportResistanceZone = (name?: string) => name === "Support" || name === "Resistance";

  const ohlcMinLow = ohlc.reduce((m, b) => (typeof b.low === "number" && Number.isFinite(b.low) ? Math.min(m, b.low) : m), Infinity);
  const ohlcMaxHigh = ohlc.reduce((m, b) => (typeof b.high === "number" && Number.isFinite(b.high) ? Math.max(m, b.high) : m), -Infinity);
  const ohlcYRange =
    Number.isFinite(ohlcMinLow) && Number.isFinite(ohlcMaxHigh) ? Math.max(0, ohlcMaxHigh - ohlcMinLow) : 0;
  // Visual clamp to avoid a single gigantic zone stretching the chart.
  // This does NOT change analytics — only how zones are drawn on the chart.
  const MAX_ZONE_HEIGHT_PCT_OF_WINDOW = 0.35;
  const maxZoneHeight = ohlcYRange > 0 ? ohlcYRange * MAX_ZONE_HEIGHT_PCT_OF_WINDOW : 0;

  const zoneShapes: any[] = [];
  for (const z of zones) {
    if (isBosZone(z.name) && !visibility.bos_levels) continue;
    if (isDemandSupplyZone(z.name) && !visibility.demand_supply_zones) continue;
    if (isSupportResistanceZone(z.name) && !visibility.support_resistance_zones) continue;
    if ((z.name === "Discount" || z.name === "Mid" || z.name === "Premium") && !visibility.premium_discount_zones) continue;

    const span = zoneEndpointsToBarIndices(z, ohlc, n);
    if (!span) continue;
    const [idxStart, idxEnd] = span;
    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    const isLine = z.value_low === z.value_high;
    let y0 = z.value_low;
    let y1 = z.value_high;
    if (
      !isLine &&
      maxZoneHeight > 0 &&
      isDemandSupplyZone(z.name) &&
      typeof y0 === "number" &&
      typeof y1 === "number" &&
      Number.isFinite(y0) &&
      Number.isFinite(y1)
    ) {
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      const h = hi - lo;
      if (h > maxZoneHeight) {
        const mid = (lo + hi) / 2;
        y0 = mid - maxZoneHeight / 2;
        y1 = mid + maxZoneHeight / 2;
      } else {
        y0 = lo;
        y1 = hi;
      }
    }
    const lineColor =
      z.name === "Demand"
        ? "#22c55e"
        : z.name === "Supply"
          ? "#ef4444"
          : z.name === "Support"
            ? "#22c55e"
            : z.name === "Resistance"
              ? "#ef4444"
              : z.name === "BOS" || z.name === "BOS (M)"
                ? z.name === "BOS (M)"
                  ? "#fbbf24"
                  : "#f59e0b"
                : z.name === "Discount"
                  ? "#22c55e"
                  : z.name === "Premium"
                    ? "#ef4444"
                    : z.name === "Mid"
                      ? "#a1a1aa"
                      : "#3b82f6";
    if (isLine) {
      zoneShapes.push({
        type: "line",
        x0: idxStart - 0.5,
        x1: idxEnd + 0.5,
        y0,
        y1,
        line: { width: 2, color: lineColor, dash: "solid" },
        layer: "below",
      });
    } else {
      zoneShapes.push({
        type: "rect",
        x0: idxStart - 0.5,
        x1: idxEnd + 0.5,
        y0,
        y1,
        fillcolor: fill,
        line: { width: 1, color: lineColor },
        layer: "below",
      });
    }
  }

  const histDomain = 0.2;
  const histGap = 0.035;
  const mainY0 = showRegimeHistogram ? histDomain + histGap : 0;

  const layout: any = {
    height,
    margin: { t: 50, r: 40, b: showRegimeHistogram ? 52 : 60, l: 60 },
    paper_bgcolor: "#18181b",
    plot_bgcolor: "#18181b",
    font: { color: "#a1a1aa", size: 11 },
    xaxis: {
      type: "linear",
      range: [-0.5, n - 0.5],
      gridcolor: "#27272a",
      tickvals,
      ticktext,
      ...(showRegimeHistogram ? { domain: [0, 1], anchor: "y", showticklabels: false } : { showticklabels: true }),
      rangeslider: { visible: !showRegimeHistogram, thickness: 0.05, bgcolor: "#27272a" },
      fixedrange: false,
    },
    yaxis: {
      ...(showRegimeHistogram ? { domain: [mainY0, 1], anchor: "x" } : {}),
      gridcolor: "#27272a",
      tickformat: ".2f",
      fixedrange: false,
      rangemode: "normal",
    },
    ...(showRegimeHistogram
      ? {
          xaxis2: {
            type: "linear",
            range: [-0.5, n - 0.5],
            anchor: "y2",
            overlaying: "x",
            matches: "x",
            showticklabels: true,
            tickvals,
            ticktext,
            showgrid: false,
            zeroline: false,
            fixedrange: false,
          },
          yaxis2: {
            domain: [0, histDomain],
            anchor: "x2",
            range: [0, 1.08],
            title: { text: "Režim", font: { size: 10, color: "#a1a1aa" } },
            tickformat: ".0f",
            tickvals: [0, 0.5, 1],
            fixedrange: true,
            showgrid: true,
            gridcolor: "#27272a",
            zeroline: false,
          },
        }
      : {}),
    dragmode: "zoom",
    legend: { x: 0, y: 1.1, orientation: "h" },
    shapes: [...zoneShapes, ...(extraShapes ?? [])],
    annotations: [...(extraAnnotations ?? [])],
  };

  const config: any = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  const traces: any[] = [{ ...candlestickTrace, ...pax }];
  if (visibility.swing_hl && highMapped.length > 0) traces.push({ ...highTrace, ...pax });
  if (visibility.swing_hl && lowMapped.length > 0) traces.push({ ...lowTrace, ...pax });
  if (visibility.major_hl && majorHighTrace) traces.push({ ...majorHighTrace, ...pax });
  if (visibility.major_hl && majorLowTrace) traces.push({ ...majorLowTrace, ...pax });
  if (visibility.internal_hl && internalHighTrace) traces.push({ ...internalHighTrace, ...pax });
  if (visibility.internal_hl && internalLowTrace) traces.push({ ...internalLowTrace, ...pax });
  if (visibility.swing_hl && bosBullTrace) traces.push({ ...bosBullTrace, ...pax });
  if (visibility.swing_hl && bosBearTrace) traces.push({ ...bosBearTrace, ...pax });
  if (otherTrace) traces.push({ ...otherTrace, ...pax });
  if (visibility.inducement_points) {
    if (inducementDemandTrace) traces.push({ ...inducementDemandTrace, ...pax });
    if (inducementSupplyTrace) traces.push({ ...inducementSupplyTrace, ...pax });
    if (inducementOtherTrace) traces.push({ ...inducementOtherTrace, ...pax });
  }
  if (visibility.demand_supply_zones && zoneTouchTrace) traces.push({ ...zoneTouchTrace, ...pax });
  if (visibility.lines) traces.push(...lineTraces.map((t) => ({ ...t, ...pax })));
  if (showRegimeHistogram && regimeBarTrace) traces.push(regimeBarTrace);
  if (extraTraces?.length) traces.push(...extraTraces.map((t) => ({ ...t, ...pax })));

  return { traces, layout, config };
}

