/**
 * Plotly spec pro S/D zone test — stejný model osy jako View (lineární index svíčky = žádné mezery o víkendech).
 */

import type { SdZoneTestTrade, ViewLine } from "@/lib/api";
import { isViewRegimeHistogramLine } from "@/lib/api";
import type { OhlcBar } from "@shared/types";

const VIEW_BG = "#18181b";
const VIEW_GRID = "#27272a";
const ZONE_DEMAND_FILL = "rgba(34, 197, 94, 0.28)";
const ZONE_SUPPLY_FILL = "rgba(239, 68, 68, 0.28)";
const ZONE_DEMAND_LINE = "rgba(34, 197, 94, 0.95)";
const ZONE_SUPPLY_LINE = "rgba(239, 68, 68, 0.95)";
const ENTRY_COLOR = "#38bdf8";
const SL_COLOR = "#f87171";
const MFE_COLOR = "#fbbf24";
const MAE_COLOR = "#94a3b8";

export type SdZoneTestChartVisibility = {
  zoneBox: boolean;
  zoneMeta: boolean;
  touchMarker: boolean;
  tradeLevels: boolean;
  tradeBars: boolean;
  tradeLevelLabels: boolean;
  hlLines: boolean;
  bosMarkers: boolean;
};

function localIndexForDate(ohlc: OhlcBar[], date: string): number {
  const exact = ohlc.findIndex((b) => b.date === date);
  if (exact >= 0) return exact;
  const d0 = date.slice(0, 10);
  const byDay = ohlc.findIndex((b) => String(b.date).startsWith(d0));
  return byDay;
}

function globalBarToLocal(g: number, off: number, n: number): number | null {
  const loc = g - off;
  if (loc >= 0 && loc < n) return loc;
  return null;
}

function mfePriceLevel(t: SdZoneTestTrade): number | null {
  const entry = t.entry_price;
  const r = t.R_unit;
  const mfeR = t.mfe_R;
  if (entry == null || r == null || mfeR == null) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(r) || !Number.isFinite(mfeR)) return null;
  const nm = String(t.zone_name ?? "");
  if (nm === "Demand") return entry + mfeR * r;
  if (nm === "Supply") return entry - mfeR * r;
  return null;
}

function maePriceLevel(t: SdZoneTestTrade): number | null {
  const entry = t.entry_price;
  const r = t.R_unit;
  const maeR = t.mae_R;
  if (entry == null || r == null || maeR == null) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(r) || !Number.isFinite(maeR)) return null;
  const nm = String(t.zone_name ?? "");
  if (nm === "Demand") return entry - maeR * r;
  if (nm === "Supply") return entry + maeR * r;
  return null;
}

export function buildSdZoneTestChartSpec(args: {
  ohlc: OhlcBar[];
  offset: number;
  selected: SdZoneTestTrade | null;
  markersHl: { date: string; type: string; value: number | null; bar_index?: number | string }[];
  linesHl: ViewLine[] | undefined;
  visibility?: Partial<SdZoneTestChartVisibility>;
}): { traces: any[]; layout: Record<string, unknown> } {
  const { ohlc: o, offset: off, selected, markersHl, linesHl } = args;
  const n = o.length;
  if (n === 0) return { traces: [], layout: {} };

  const vis: SdZoneTestChartVisibility = {
    zoneBox: true,
    zoneMeta: true,
    touchMarker: true,
    tradeLevels: true,
    tradeBars: true,
    tradeLevelLabels: true,
    hlLines: true,
    bosMarkers: true,
    ...(args.visibility ?? {}),
  };

  const indices = Array.from({ length: n }, (_, i) => i);
  const tickStep = Math.max(1, Math.floor(n / 8));
  const tickvals = Array.from({ length: Math.ceil(n / tickStep) + 1 }, (_, i) => Math.min(i * tickStep, n - 1));
  const ticktext = tickvals.map((i) => {
    const raw = o[i]?.date ?? "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const hasTime = /T\d{2}:\d{2}/.test(raw) || /\s\d{2}:\d{2}/.test(raw);
    return parsed.toLocaleString("cs-CZ", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  });

  const candlestick: any = {
    type: "candlestick",
    x: indices,
    open: o.map((b) => b.open),
    high: o.map((b) => b.high),
    low: o.map((b) => b.low),
    close: o.map((b) => b.close),
    increasing: { line: { color: "#10b981", width: 1 }, fillcolor: "#10b981" },
    decreasing: { line: { color: "#ef4444", width: 1 }, fillcolor: "#ef4444" },
    xperiodalignment: "middle",
    name: "OHLC",
    showlegend: false,
  };

  const shapes: Record<string, unknown>[] = [];
  const annotations: any[] = [];

  const winG0 = off;
  const winG1 = off + n - 1;

  if (selected && !selected.skip) {
    const zl = selected.zone_value_low;
    const zh = selected.zone_value_high;
    const zbs = selected.zone_bar_start;
    const zbe = selected.zone_bar_end;
    const hasZoneBand =
      zl != null && zh != null && Number.isFinite(zl) && Number.isFinite(zh) && zh !== zl;
    if (vis.zoneBox && hasZoneBand) {
      let g0 = winG0;
      let g1 = winG1;
      if (typeof zbs === "number" && typeof zbe === "number" && Number.isFinite(zbs) && Number.isFinite(zbe)) {
        const a = Math.min(zbs, zbe);
        const b = Math.max(zbs, zbe);
        g0 = Math.max(winG0, a);
        g1 = Math.min(winG1, b);
      }
      const x0 = g0 - off - 0.5;
      const x1 = g1 - off + 0.5;
      const isDemand = String(selected.zone_name ?? "").trim() === "Demand";
      shapes.push({
        type: "rect",
        x0,
        x1,
        y0: zl,
        y1: zh,
        fillcolor: isDemand ? ZONE_DEMAND_FILL : ZONE_SUPPLY_FILL,
        line: { width: 2, color: isDemand ? ZONE_DEMAND_LINE : ZONE_SUPPLY_LINE },
        layer: "below" as const,
        xref: "x",
        yref: "y",
      });
      const cx = (x0 + x1) / 2;
      const yTop = Math.max(zl, zh);
      // Keep the on-chart label short; the full zone_id is shown elsewhere in the UI.
      const meta = [selected.source_tf, selected.zone_name].filter(Boolean).join(" · ");
      if (vis.zoneMeta && meta) {
        annotations.push({
          x: cx,
          y: yTop,
          text: meta,
          showarrow: false,
          yanchor: "bottom",
          font: { size: 10, color: "#e4e4e7" },
          bgcolor: "rgba(24,24,27,0.75)",
          borderpad: 3,
        });
      }
    }

    const xL = -0.5;
    const xR = n - 0.5;
    const addHLine = (y: number | null | undefined, color: string, width: number, dash?: string) => {
      if (y == null || !Number.isFinite(y)) return;
      shapes.push({
        type: "line",
        x0: xL,
        x1: xR,
        y0: y,
        y1: y,
        line: { color, width, dash: dash as any },
        layer: "above" as const,
        xref: "x",
        yref: "y",
      });
    };

    if (vis.tradeLevels) {
      addHLine(selected.entry_price, ENTRY_COLOR, 2);
      addHLine(selected.stop_price, SL_COLOR, 2, "dash");
      if ((selected.mfe_R ?? 0) > 1e-6) addHLine(mfePriceLevel(selected), MFE_COLOR, 2, "dot");
      if ((selected.mae_R ?? 0) > 1e-6) addHLine(maePriceLevel(selected), MAE_COLOR, 1, "dot");
    }

    if (vis.tradeLevels && vis.tradeLevelLabels) {
      const entryPx = selected.entry_price;
      const slPx = selected.stop_price;
      const mfePx = (selected.mfe_R ?? 0) > 1e-6 ? mfePriceLevel(selected) : null;
      const maePx = (selected.mae_R ?? 0) > 1e-6 ? maePriceLevel(selected) : null;
      const labelAt = (y: number | null, text: string, color: string) => {
        if (y == null || !Number.isFinite(y)) return;
        annotations.push({
          xref: "paper",
          yref: "y",
          x: 0.995,
          y,
          xanchor: "right",
          yanchor: "middle",
          text,
          showarrow: false,
          font: {
            size: 10,
            color,
            family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          },
          bgcolor: "rgba(9,9,11,0.55)",
          bordercolor: "rgba(63,63,70,0.7)",
          borderwidth: 1,
          borderpad: 3,
        });
      };
      labelAt(entryPx ?? null, "ENTRY", ENTRY_COLOR);
      labelAt(slPx ?? null, "SL", SL_COLOR);
      labelAt(mfePx, "MFE", MFE_COLOR);
      labelAt(maePx, "MAE", MAE_COLOR);
    }

    const addVLine = (globalBar: number | null | undefined, color: string, width: number, dash?: string) => {
      if (globalBar == null || !Number.isFinite(globalBar)) return;
      const loc = globalBarToLocal(globalBar, off, n);
      if (loc == null) return;
      shapes.push({
        type: "line",
        x0: loc,
        x1: loc,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color, width, dash: dash as any },
        layer: "above" as const,
        xref: "x",
      });
    };

    if (vis.tradeBars) {
      addVLine(selected.entry_bar, ENTRY_COLOR, 2);
      addVLine(selected.mfe_bar, MFE_COLOR, 1, "dot");
      addVLine(selected.sl_hit_bar, SL_COLOR, 1);
      addVLine(selected.cap_hit_bar, "#a78bfa", 1, "dot");
    }

    // Info panel (paper coords) — jasně čitelný SL/MFE/MAE bez „loveni“ v legendě.
    const entryPx = selected.entry_price;
    const slPx = selected.stop_price;
    const mfePx = mfePriceLevel(selected);
    const maePx = maePriceLevel(selected);
    const infoLines = [
      selected.zone_id ? `zone_id: ${selected.zone_id}` : null,
      selected.source_tf ? `ZONE TF: ${selected.source_tf}` : null,
      selected.zone_name ? `zone: ${String(selected.zone_name).toUpperCase()}` : null,
      entryPx != null ? `ENTRY: ${Number(entryPx).toFixed(4)}` : null,
      slPx != null ? `SL: ${Number(slPx).toFixed(4)}` : null,
      selected.mfe_R != null && mfePx != null ? `MFE: ${Number(selected.mfe_R).toFixed(2)}R  (${Number(mfePx).toFixed(4)})` : null,
      selected.mae_R != null && maePx != null ? `MAE: ${Number(selected.mae_R).toFixed(2)}R  (${Number(maePx).toFixed(4)})` : null,
    ].filter((x): x is string => !!x);
    if (infoLines.length > 0) {
      annotations.push({
        xref: "paper",
        yref: "paper",
        x: 0.01,
        y: 0.99,
        xanchor: "left",
        yanchor: "top",
        align: "left",
        text: infoLines.join("<br>"),
        showarrow: false,
        font: { size: 11, color: "#e4e4e7", family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
        bgcolor: "rgba(9,9,11,0.72)",
        bordercolor: "rgba(63,63,70,0.9)",
        borderwidth: 1,
        borderpad: 6,
      });
    }
  }

  const traces: any[] = [candlestick];

  if (vis.hlLines && linesHl && linesHl.length > 0) {
    const lineColors = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4"];
    let li = 0;
    for (const line of linesHl) {
      if (isViewRegimeHistogramLine(line)) continue;
      const data = line.data ?? [];
      const pts: { idx: number; val: number }[] = [];
      for (const p of data) {
        const ix = localIndexForDate(o, p.date);
        if (ix < 0) continue;
        pts.push({ idx: ix, val: p.value });
      }
      pts.sort((a, b) => a.idx - b.idx);
      if (pts.length === 0) continue;
      const color = line.color ?? lineColors[li % lineColors.length];
      li++;
      traces.push({
        type: "scatter",
        mode: "lines",
        x: pts.map((p) => p.idx),
        y: pts.map((p) => p.val),
        line: { color, width: 2, shape: "linear" },
        name: line.name,
        showlegend: true,
        hovertemplate: "%{y:.4f}<extra></extra>",
      });
    }
  }

  const bosBullX: number[] = [];
  const bosBullY: number[] = [];
  const bosBearX: number[] = [];
  const bosBearY: number[] = [];
  if (vis.bosMarkers) {
    for (const m of markersHl) {
    const t = String(m.type ?? "").toLowerCase();
    if (t !== "bos_bullish" && t !== "bos_bearish") continue;
    const biRaw = m.bar_index;
    const bi =
      typeof biRaw === "number" ? biRaw : biRaw != null && biRaw !== "" ? Number(biRaw) : NaN;
    if (!Number.isFinite(bi)) continue;
    const loc = globalBarToLocal(bi, off, n);
    if (loc == null) continue;
    const val = m.value;
    if (val == null || !Number.isFinite(val)) continue;
    if (t === "bos_bullish") {
      bosBullX.push(loc);
      bosBullY.push(val);
    } else {
      bosBearX.push(loc);
      bosBearY.push(val);
    }
    }
  }
  if (bosBullX.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: bosBullX,
      y: bosBullY,
      marker: { size: 11, color: "#14b8a6", symbol: "triangle-up", line: { color: "#fff", width: 1 } },
      name: "BOS ↑",
      showlegend: true,
      hovertemplate: "BOS ↑ @ %{y:.4f}<extra></extra>",
    });
  }
  if (bosBearX.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      x: bosBearX,
      y: bosBearY,
      marker: { size: 11, color: "#c084fc", symbol: "triangle-down", line: { color: "#fff", width: 1 } },
      name: "BOS ↓",
      showlegend: true,
      hovertemplate: "BOS ↓ @ %{y:.4f}<extra></extra>",
    });
  }

  if (vis.touchMarker && selected && !selected.skip && selected.entry_bar != null && selected.entry_price != null) {
    const loc = globalBarToLocal(selected.entry_bar, off, n);
    if (loc != null) {
      traces.push({
        type: "scatter",
        mode: "markers",
        x: [loc],
        y: [selected.entry_price],
        marker: {
          size: 20,
          color: "#facc15",
          symbol: "circle",
          line: { color: "#111827", width: 2.5 },
        },
        name: "Touch / entry",
        showlegend: true,
        hovertemplate: `Entry touch<br>bar %{x}<br>%{y:.4f}<extra></extra>`,
      });
    }
  }

  const layout: Record<string, unknown> = {
    paper_bgcolor: VIEW_BG,
    plot_bgcolor: VIEW_BG,
    font: { color: "#a1a1aa", size: 11 },
    margin: { l: 56, r: 16, t: 44, b: 48 },
    xaxis: {
      type: "linear",
      range: [-0.5, n - 0.5],
      gridcolor: VIEW_GRID,
      tickvals,
      ticktext,
      rangeslider: { visible: false },
      fixedrange: false,
      title: undefined,
    },
    yaxis: {
      gridcolor: VIEW_GRID,
      tickformat: ".4f",
      fixedrange: false,
      rangemode: "normal",
    },
    shapes,
    annotations,
    title: selected
      ? `${selected.zone_name ?? ""} · touch #${(selected.touch_index ?? 0) + 1} · MFE ${(selected.mfe_R ?? 0).toFixed(2)}R`
      : "S/D touch analytics",
    showlegend: true,
    legend: { orientation: "h", yanchor: "bottom", y: 1.02, x: 0, font: { size: 10 } },
    height: 480,
    hovermode: "x unified",
  };

  return { traces, layout };
}
