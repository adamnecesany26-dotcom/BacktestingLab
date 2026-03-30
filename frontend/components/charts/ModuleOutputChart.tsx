"use client";

import { useEffect, useState } from "react";
import { isViewRegimeHistogramLine } from "@/lib/api";
import {
  HL_TREND_STATE_COLORS,
  lineDataHasTrendState,
  groupDateTrendSegments,
} from "@/lib/viewChartLines";
import type { OhlcBar, ModuleOutput, ModuleZone, Trade } from "@shared/types";
import { zoneTimeBoundsForOhlc } from "@/lib/zoneChartAlign";

type VisibilityKey =
  | "entry_markers"
  | "exit_markers"
  | "trade_rrr_body"
  | "trade_mfe"
  | "trade_mae"
  | "swing_hl"
  | "internal_hl"
  | "major_hl"
  | "bos_levels"
  | "inducement_points"
  | "demand_supply_zones"
  | "support_resistance_zones"
  | "premium_discount_zones"
  | "lines";

const DEFAULT_VISIBILITY: Record<VisibilityKey, boolean> = {
  entry_markers: true,
  exit_markers: true,
  trade_rrr_body: true,
  trade_mfe: true,
  trade_mae: true,
  swing_hl: true,
  internal_hl: true,
  major_hl: true,
  bos_levels: true,
  inducement_points: true,
  demand_supply_zones: true,
  support_resistance_zones: true,
  premium_discount_zones: true,
  lines: true,
};

function toDateKey(s: string): string {
  const raw = (s || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.slice(0, 10);
}

function findBarDate(ohlc: OhlcBar[], tradeDate: string): string | null {
  if (!tradeDate) return null;
  const exact = tradeDate.trim();
  if (exact) {
    const exactMatch = ohlc.find((bar) => bar.date === exact);
    if (exactMatch) return exactMatch.date;
  }
  const key = toDateKey(tradeDate);
  for (const bar of ohlc) {
    if (toDateKey(bar.date) === key) return bar.date;
  }
  return null;
}

/** Nejbližší bar podle času (intraday) – stejná idea jako Trade Highlight. */
function findNearestBarDate(ohlc: OhlcBar[], tradeDate: string): string | null {
  if (!ohlc.length || !tradeDate.trim()) return findBarDate(ohlc, tradeDate);
  const target = Date.parse(tradeDate);
  if (!Number.isFinite(target)) return findBarDate(ohlc, tradeDate);
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const bar of ohlc) {
    const t = Date.parse(bar.date);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = bar.date;
    }
  }
  return best ?? findBarDate(ohlc, tradeDate);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "").trim();
  if (m.length !== 6 || !/^[0-9a-fA-F]+$/.test(m)) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function resolveInducementBarIndex(
  ohlc: OhlcBar[],
  ind: { date?: string; index?: number }
): number {
  const raw = ind.index;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return Math.max(0, Math.min(Math.floor(raw), ohlc.length - 1));
  }
  const d = (ind.date ?? "").trim();
  if (!d) return -1;
  const barDate = findNearestBarDate(ohlc, d);
  if (!barDate) return -1;
  return ohlc.findIndex((b) => b.date === barDate);
}

function buildInducementMarkerTraceDateAxis(
  ohlc: OhlcBar[],
  items: { value: number; date?: string; index?: number }[],
  colorHex: string,
  name: string
): any | null {
  if (!ohlc.length || items.length === 0) return null;
  const x: string[] = [];
  const y: number[] = [];
  for (const item of items) {
    const idx = resolveInducementBarIndex(ohlc, { date: item.date, index: item.index });
    if (idx < 0) continue;
    x.push(ohlc[idx].date);
    y.push(item.value);
  }
  if (x.length === 0) return null;
  return {
    type: "scatter",
    mode: "markers",
    x,
    y,
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

function buildZoneTouchMarkerTraceDateAxis(ohlc: OhlcBar[], zones: ModuleZone[] | undefined): any | null {
  if (!ohlc.length || !zones?.length) return null;
  const x: string[] = [];
  const y: number[] = [];
  for (const z of zones) {
    if (!z.has_touch) continue;
    const bi = z.touch_bar_index;
    const pr = z.touch_marker_price;
    if (typeof bi !== "number" || typeof pr !== "number" || !Number.isFinite(pr)) continue;
    const idx = Math.max(0, Math.min(Math.floor(bi), ohlc.length - 1));
    x.push(ohlc[idx].date);
    y.push(pr);
  }
  if (x.length === 0) return null;
  return {
    type: "scatter",
    mode: "markers",
    x,
    y,
    marker: {
      size: 14,
      symbol: "circle",
      color: "rgba(147, 197, 253, 0.55)",
      line: { color: "rgba(191, 219, 254, 0.9)", width: 1.5 },
    },
    name: "Touch zóny",
    showlegend: true,
    hovertemplate: "Touch zóny %{y:.4f}<extra></extra>",
  };
}

function zoneMetaPrice(zm: unknown, keys: string[]): number | null {
  if (!zm || typeof zm !== "object") return null;
  const o = zm as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

interface ModuleOutputChartProps {
  ohlc: OhlcBar[];
  moduleName: string;
  output: ModuleOutput;
  trades?: Trade[];
  height?: number;
  /** RRR styl: kruhy entry/exit, tělo obchodu + MFE (modře) + MAE (fialově) z polí trade.mfe / trade.mae */
  rrrTradeStyle?: boolean;
  /**
   * Detailed view: bez MFE/MAE; entry/exit + stop / take profit z zoneMeta (stopPrice, targetPrice, …).
   * Čáry / zóny z moduleOutputs zůstávají (RSI, S/D, …).
   */
  orderLevelsMode?: boolean;
  /**
   * Touch markery z touch_bar_index jsou indexy do aktuálního OHLC pole — po agregaci TF jsou nesmyslné.
   */
  showZoneTouchByIndex?: boolean;
}

const MARKER_COLORS: Record<string, string> = {
  high: "#10b981",
  low: "#ef4444",
  major_high: "#fbbf24",
  major_low: "#f59e0b",
  internal_high: "#6ee7b7",
  internal_low: "#fca5a5",
};

function getZoneLineColor(name?: string): string {
  if (name === "Demand") return "#22c55e";
  if (name === "Supply") return "#ef4444";
  if (name === "Support") return "#22c55e";
  if (name === "Resistance") return "#ef4444";
  if (name === "BOS (M)") return "#fbbf24";
  if (name === "BOS") return "#f59e0b";
  if (name === "Discount") return "#22c55e";
  if (name === "Premium") return "#ef4444";
  if (name === "Mid") return "#a1a1aa";
  return "#3b82f6";
}

/** Odvodí počet desetinných míst z OHLC (forex / jemné ceny). */
function inferPriceDecimalPlaces(ohlc: OhlcBar[]): number {
  let maxDec = 2;
  const slice = ohlc.length > 400 ? ohlc.slice(0, 400) : ohlc;
  for (const b of slice) {
    for (const v of [b.open, b.high, b.low, b.close]) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const frac = String(v).split(".")[1];
      if (frac) maxDec = Math.max(maxDec, Math.min(8, frac.length));
    }
  }
  return maxDec;
}

export function ModuleOutputChart({
  ohlc,
  moduleName,
  output,
  trades = [],
  height = 480,
  rrrTradeStyle = false,
  orderLevelsMode = false,
  showZoneTouchByIndex = true,
}: ModuleOutputChartProps) {
  const [Plot, setPlot] = useState<React.ComponentType<any> | null>(null);
  const [visibilityPanelOpen, setVisibilityPanelOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<VisibilityKey, boolean>>(() => ({ ...DEFAULT_VISIBILITY }));

  useEffect(() => {
    import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

  useEffect(() => {
    if (!orderLevelsMode) return;
    setVisibility((prev) => ({
      ...prev,
      trade_mfe: false,
      trade_mae: false,
    }));
  }, [orderLevelsMode]);

  if (!Plot || ohlc.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-zinc-500 text-sm"
        style={{ height }}
      >
        {!Plot ? "Načítání..." : "Žádná OHLC data"}
      </div>
    );
  }

  const dates = ohlc.map((b) => b.date);
  const opens = ohlc.map((b) => b.open);
  const highs = ohlc.map((b) => b.high);
  const lows = ohlc.map((b) => b.low);
  const closes = ohlc.map((b) => b.close);
  const candlestickTrace: any = {
    type: "candlestick",
    x: dates,
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    increasing: { line: { color: "#10b981", width: 1 }, fillcolor: "#10b981" },
    decreasing: { line: { color: "#ef4444", width: 1 }, fillcolor: "#ef4444" },
    xperiodalignment: "middle",
    name: "OHLC",
  };

  const traces: any[] = [candlestickTrace];

  const entryX: string[] = [];
  const entryY: number[] = [];
  const entryMarkerColors: string[] = [];
  const exitX: string[] = [];
  const exitY: number[] = [];
  const exitMarkerColors: string[] = [];
  const tradeShapes: any[] = [];
  const EPS = 1e-9;

  const useNearestBar = rrrTradeStyle || orderLevelsMode;
  const resolveBar = (iso: string) => (useNearestBar ? findNearestBarDate(ohlc, iso) : findBarDate(ohlc, iso));

  for (const t of trades) {
    const entryDate = t.entryDate ?? t.date ?? "";
    const exitDate = t.exitDate ?? t.date ?? "";
    const entryP = t.entryPrice ?? t.price;
    const exitP = t.exitPrice ?? t.price;
    if (!Number.isFinite(entryP) || !Number.isFinite(exitP)) continue;

    const entryBarDate = resolveBar(entryDate);
    const exitBarDate = resolveBar(exitDate);
    if (entryBarDate) {
      entryX.push(entryBarDate);
      entryY.push(entryP);
      entryMarkerColors.push(
        rrrTradeStyle ? (t.type === "buy" ? "#22c55e" : "#ef4444") : "#3b82f6"
      );
    }
    if (exitBarDate) {
      exitX.push(exitBarDate);
      exitY.push(exitP);
      exitMarkerColors.push(
        rrrTradeStyle ? (t.type === "buy" ? "#ef4444" : "#22c55e") : "#f97316"
      );
    }
    if (!entryBarDate || !exitBarDate) continue;

    const entryTs = new Date(entryBarDate).getTime();
    const exitTs = new Date(exitBarDate).getTime();
    if (!Number.isFinite(entryTs) || !Number.isFinite(exitTs)) continue;

    const x0 = entryTs <= exitTs ? entryBarDate : exitBarDate;
    const x1 = entryTs <= exitTs ? exitBarDate : entryBarDate;

    if (rrrTradeStyle && !orderLevelsMode) {
      const isLong = t.type === "buy";
      const mfe = typeof t.mfe === "number" && Number.isFinite(t.mfe) ? t.mfe : 0;
      const mae = typeof t.mae === "number" && Number.isFinite(t.mae) ? t.mae : 0;
      const pnl = t.pnl ?? 0;
      const peakLong = entryP + mfe;
      const troughLong = entryP - mae;
      const troughShort = entryP - mfe;
      const peakShort = entryP + mae;
      const coreLo = Math.min(entryP, exitP);
      const coreHi = Math.max(entryP, exitP);

      /** MFE / MAE jen mimo úsek entry–exit: modrá = čistě příznivý výkyv, fialová = čistě nepříznivý; zelená/červená = realizace. */
      const bodyHi = coreHi;
      const bodyLo = coreLo;

      if (visibility.trade_mae) {
        if (isLong && troughLong < bodyLo - EPS) {
          tradeShapes.push({
            type: "rect",
            x0,
            x1,
            y0: troughLong,
            y1: bodyLo,
            fillcolor: "rgba(168, 85, 247, 0.28)",
            line: { width: 0 },
            layer: "below",
          });
        } else if (!isLong && peakShort > bodyHi + EPS) {
          tradeShapes.push({
            type: "rect",
            x0,
            x1,
            y0: bodyHi,
            y1: peakShort,
            fillcolor: "rgba(168, 85, 247, 0.28)",
            line: { width: 0 },
            layer: "below",
          });
        }
      }

      if (visibility.trade_mfe) {
        if (isLong && peakLong > bodyHi + EPS) {
          tradeShapes.push({
            type: "rect",
            x0,
            x1,
            y0: bodyHi,
            y1: peakLong,
            fillcolor: "rgba(59, 130, 246, 0.28)",
            line: { width: 0 },
            layer: "below",
          });
        } else if (!isLong && troughShort < bodyLo - EPS) {
          tradeShapes.push({
            type: "rect",
            x0,
            x1,
            y0: troughShort,
            y1: bodyLo,
            fillcolor: "rgba(59, 130, 246, 0.28)",
            line: { width: 0 },
            layer: "below",
          });
        }
      }

      if (visibility.trade_rrr_body) {
        tradeShapes.push({
          type: "rect",
          x0,
          x1,
          y0: coreLo,
          y1: coreHi,
          fillcolor: pnl >= 0 ? "rgba(34, 197, 94, 0.28)" : "rgba(239, 68, 68, 0.28)",
          line: { width: 1, color: pnl >= 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)" },
          layer: "below",
        });
      }
    } else {
      const y0 = Math.min(entryP, exitP);
      const y1 = Math.max(entryP, exitP);
      tradeShapes.push({
        type: "rect",
        x0,
        x1,
        y0,
        y1,
        fillcolor: (t.pnl ?? 0) >= 0 ? "rgba(34, 197, 94, 0.20)" : "rgba(239, 68, 68, 0.20)",
        line: { width: 0 },
        layer: "below",
      });
    }

    if (orderLevelsMode) {
      const sl = zoneMetaPrice(t.zoneMeta, ["stopPrice", "stop_loss", "sl", "stop"]);
      const tp = zoneMetaPrice(t.zoneMeta, ["targetPrice", "takeProfit", "tp", "target"]);
      if (sl != null) {
        tradeShapes.push({
          type: "line",
          x0,
          x1,
          y0: sl,
          y1: sl,
          line: { color: "rgba(248, 113, 113, 0.95)", width: 2, dash: "6px,4px" },
          layer: "below",
        });
      }
      if (tp != null) {
        tradeShapes.push({
          type: "line",
          x0,
          x1,
          y0: tp,
          y1: tp,
          line: { color: "rgba(74, 222, 128, 0.95)", width: 2, dash: "6px,4px" },
          layer: "below",
        });
      }
    }
  }

  if (visibility.entry_markers && entryX.length > 0) {
    const entryTrace: any = {
      type: "scatter",
      x: entryX,
      y: entryY,
      mode: rrrTradeStyle || orderLevelsMode ? "markers+text" : "markers",
      marker: {
        size: rrrTradeStyle || orderLevelsMode ? 11 : 10,
        color: rrrTradeStyle ? entryMarkerColors : "#3b82f6",
        symbol: rrrTradeStyle || orderLevelsMode ? "circle" : "triangle-up",
        line: { color: "#fff", width: 1 },
      },
      name: "Entry",
      showlegend: true,
    };
    if (rrrTradeStyle || orderLevelsMode) {
      entryTrace.text = entryX.map(() => "entry");
      entryTrace.textposition = "top center";
      entryTrace.textfont = { size: 9, color: "#d4d4d8", family: "system-ui, sans-serif" };
    }
    traces.push(entryTrace);
  }
  if (visibility.exit_markers && exitX.length > 0) {
    const exitTrace: any = {
      type: "scatter",
      x: exitX,
      y: exitY,
      mode: rrrTradeStyle || orderLevelsMode ? "markers+text" : "markers",
      marker: {
        size: rrrTradeStyle || orderLevelsMode ? 11 : 10,
        color: rrrTradeStyle ? exitMarkerColors : "#f97316",
        symbol: rrrTradeStyle || orderLevelsMode ? "circle" : "triangle-down",
        line: { color: "#fff", width: 1 },
      },
      name: "Exit",
      showlegend: true,
    };
    if (rrrTradeStyle || orderLevelsMode) {
      exitTrace.text = exitX.map(() => "exit");
      exitTrace.textposition = "bottom center";
      exitTrace.textfont = { size: 9, color: "#d4d4d8", family: "system-ui, sans-serif" };
    }
    traces.push(exitTrace);
  }

  const markers = output.markers ?? [];
  const highMarkers = markers.filter((m) => m.type === "high");
  const lowMarkers = markers.filter((m) => m.type === "low");
  const majorHighMarkers = markers.filter((m) => m.type === "major_high");
  const majorLowMarkers = markers.filter((m) => m.type === "major_low");
  const internalHighMarkers = markers.filter((m) => m.type === "internal_high");
  const internalLowMarkers = markers.filter((m) => m.type === "internal_low");
  const otherMarkers = markers.filter(
    (m) =>
      !["high", "low", "major_high", "major_low", "internal_high", "internal_low"].includes(m.type)
  );

  if (visibility.swing_hl && highMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: highMarkers.map((m) => m.date),
      y: highMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 10, color: MARKER_COLORS.high, symbol: "circle", line: { color: "#fff", width: 1 } },
      name: "High",
      showlegend: true,
    });
  }
  if (visibility.swing_hl && lowMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: lowMarkers.map((m) => m.date),
      y: lowMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 10, color: MARKER_COLORS.low, symbol: "circle", line: { color: "#fff", width: 1 } },
      name: "Low",
      showlegend: true,
    });
  }
  if (visibility.major_hl && majorHighMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: majorHighMarkers.map((m) => m.date),
      y: majorHighMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 14, color: MARKER_COLORS.major_high, symbol: "diamond", line: { color: "#fff", width: 1.5 } },
      name: "Major High",
      showlegend: true,
    });
  }
  if (visibility.major_hl && majorLowMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: majorLowMarkers.map((m) => m.date),
      y: majorLowMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 14, color: MARKER_COLORS.major_low, symbol: "diamond", line: { color: "#fff", width: 1.5 } },
      name: "Major Low",
      showlegend: true,
    });
  }
  if (visibility.internal_hl && internalHighMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: internalHighMarkers.map((m) => m.date),
      y: internalHighMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 4, color: MARKER_COLORS.internal_high, symbol: "circle", line: { color: "#10b981", width: 0.5 } },
      name: "Internal High",
      showlegend: true,
    });
  }
  if (visibility.internal_hl && internalLowMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: internalLowMarkers.map((m) => m.date),
      y: internalLowMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 4, color: MARKER_COLORS.internal_low, symbol: "circle", line: { color: "#ef4444", width: 0.5 } },
      name: "Internal Low",
      showlegend: true,
    });
  }
  if (otherMarkers.length > 0) {
    traces.push({
      type: "scatter",
      x: otherMarkers.map((m) => m.date),
      y: otherMarkers.map((m) => m.value),
      mode: "markers",
      marker: { size: 10, color: "#3b82f6", symbol: "diamond", line: { color: "#fff", width: 1 } },
      name: "Signal",
      showlegend: true,
    });
  }

  const zones = output.zones ?? [];
  const inducementPointsByZone = zones.flatMap((z) =>
    (z.inducements ?? []).map((ind) => ({
      date: ind.date ?? "",
      value: ind.value,
      zoneName: z.name ?? "",
      index: (ind as { index?: number }).index,
    }))
  );
  const inducementDemand = inducementPointsByZone.filter((p) => p.zoneName === "Demand");
  const inducementSupply = inducementPointsByZone.filter((p) => p.zoneName === "Supply");
  const inducementOther = inducementPointsByZone.filter((p) => p.zoneName !== "Demand" && p.zoneName !== "Supply");

  if (visibility.inducement_points) {
    const tD = buildInducementMarkerTraceDateAxis(ohlc, inducementDemand, "#3b82f6", "Inducement (D)");
    if (tD) traces.push(tD);
    const tS = buildInducementMarkerTraceDateAxis(ohlc, inducementSupply, "#a855f7", "Inducement (S)");
    if (tS) traces.push(tS);
    const tO = buildInducementMarkerTraceDateAxis(ohlc, inducementOther, "#64748b", "Inducement");
    if (tO) traces.push(tO);
  }
  if (visibility.demand_supply_zones && showZoneTouchByIndex) {
    const tt = buildZoneTouchMarkerTraceDateAxis(ohlc, zones);
    if (tt) traces.push(tt);
  }

  const lines = output.lines ?? [];
  const lineColors = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4"];
  if (visibility.lines) {
    lines.forEach((line, i) => {
      if (isViewRegimeHistogramLine(line)) return;
      const pts = line.data ?? [];
      if (pts.length === 0) return;
      const fallback = line.color ?? lineColors[i % lineColors.length];
      if (line.color) {
        const text = pts.map((p) => {
          const st = (p as { state?: string; score?: number }).state;
          const sc = (p as { state?: string; score?: number }).score;
          if (st != null && String(st).length > 0) {
            return sc != null && Number.isFinite(Number(sc))
              ? `${st} · ${Number(sc).toFixed(0)}<extra></extra>`
              : `${st}<extra></extra>`;
          }
          return "%{y:.4f}<extra></extra>";
        });
        traces.push({
          type: "scatter",
          x: pts.map((p: { date: string }) => p.date),
          y: pts.map((p: { value: number }) => p.value),
          mode: "lines",
          line: { color: line.color, width: 2 },
          name: line.name ?? "line",
          legendgroup: line.name ?? "line",
          showlegend: true,
          hovertemplate: "%{text}",
          text,
        });
        return;
      }
      if (lineDataHasTrendState(pts)) {
        const segs = groupDateTrendSegments(pts);
        segs.forEach((seg, si) => {
          traces.push({
            type: "scatter",
            x: seg.x,
            y: seg.y,
            mode: "lines",
            line: { color: HL_TREND_STATE_COLORS[seg.state] ?? fallback, width: 2 },
            name: line.name ?? "line",
            legendgroup: line.name ?? "line",
            showlegend: si === 0,
            hovertemplate: "%{text}",
            text: seg.text,
          });
        });
        return;
      }
      traces.push({
        type: "scatter",
        x: pts.map((p: { date: string }) => p.date),
        y: pts.map((p: { value: number }) => p.value),
        mode: "lines",
        line: { color: fallback, width: 2 },
        name: line.name ?? "line",
        legendgroup: line.name ?? "line",
        showlegend: true,
      });
    });
  }

  const isBosZone = (name?: string) => name === "BOS" || name === "BOS (M)";
  const isDemandSupplyZone = (name?: string) => name === "Demand" || name === "Supply";
  const isSupportResistanceZone = (name?: string) => name === "Support" || name === "Resistance";
  const isPremiumDiscountZone = (name?: string) =>
    name === "Discount" || name === "Mid" || name === "Premium";

  const zoneShapes: any[] = [];
  const zoneAnnotations: any[] = [];
  for (const z of zones) {
    if (isBosZone(z.name) && !visibility.bos_levels) continue;
    if (isDemandSupplyZone(z.name) && !visibility.demand_supply_zones) continue;
    if (isSupportResistanceZone(z.name) && !visibility.support_resistance_zones) continue;
    if (isPremiumDiscountZone(z.name) && !visibility.premium_discount_zones) continue;

    const { x0, x1 } = zoneTimeBoundsForOhlc(z, ohlc);
    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    const isLine = z.value_low === z.value_high;
    const lineColor = getZoneLineColor(z.name);

    if (isLine) {
      zoneShapes.push({
        type: "line",
        x0,
        x1,
        y0: z.value_low,
        y1: z.value_high,
        line: { width: 2, color: lineColor, dash: "solid" },
        layer: "below",
      });
    } else {
      zoneShapes.push({
        type: "rect",
        x0,
        x1,
        y0: z.value_low,
        y1: z.value_high,
        fillcolor: fill,
        line: { width: 1, color: lineColor },
        layer: "below",
      });
    }

    if (z.name) {
      let label =
        z.name === "Demand" ? "D" :
        z.name === "Supply" ? "S" :
        z.name === "Support" ? "Sup" :
        z.name === "Resistance" ? "Res" :
        z.name === "BOS (M)" ? "BOS M" :
        z.name === "Discount" ? "Disc" :
        z.name === "Premium" ? "Prem" :
        z.name === "Mid" ? "Mid" : z.name;
      const base = typeof z.base_length === "number" && z.base_length >= 0 ? z.base_length : null;
      const im = typeof z.impulse_score === "number" && z.impulse_score > 0 ? z.impulse_score : null;
      const ipCount = z.inducement_count ?? 0;
      const ipPoints = z.inducement_points ?? 0;
      const hasIp = (ipCount > 0 || ipPoints > 0) && (z.name === "Demand" || z.name === "Supply");
      const adBelow = Math.max(0, z.active_demand_zones_below ?? 0);
      if (base !== null && (z.name === "Demand" || z.name === "Supply")) label += ` B:${base}`;
      if (im !== null && (z.name === "Demand" || z.name === "Supply")) label += ` IM:${im}`;
      if (hasIp) label += ` IP:${ipCount},${ipPoints}`;
      if (z.name === "Demand" && adBelow > 0) label += ` ↓${adBelow}`;
      const t1 = new Date(x0).getTime();
      const t2 = new Date(x1).getTime();
      const midDate =
        Number.isFinite(t1) && Number.isFinite(t2)
          ? new Date((t1 + t2) / 2).toISOString()
          : x0;
      const yCenter = isLine ? z.value_low : (z.value_low + z.value_high) / 2;
      zoneAnnotations.push({
        x: midDate,
        y: yCenter,
        text: label,
        showarrow: false,
        font: { size: 11, color: lineColor },
        xanchor: "center",
        yanchor: "middle",
      });
    }
  }

  const rrrVisibilityOptions: { key: VisibilityKey; label: string; hasData: boolean }[] =
    rrrTradeStyle && !orderLevelsMode
      ? [
          { key: "trade_rrr_body", label: "RRR: realizace (zelená / červená)", hasData: trades.length > 0 },
          { key: "trade_mfe", label: "RRR: MFE jen mimo tělo (modře)", hasData: trades.length > 0 },
          { key: "trade_mae", label: "RRR: MAE jen mimo tělo (fialově)", hasData: trades.length > 0 },
        ]
      : [];

  const visibilityOptions: { key: VisibilityKey; label: string; hasData: boolean }[] = [
    { key: "entry_markers", label: "Entry (vstupy)", hasData: entryX.length > 0 },
    { key: "exit_markers", label: "Exit (výstupy)", hasData: exitX.length > 0 },
    ...rrrVisibilityOptions,
    { key: "swing_hl", label: "Swing HL", hasData: highMarkers.length > 0 || lowMarkers.length > 0 },
    { key: "internal_hl", label: "Internal HL", hasData: internalHighMarkers.length > 0 || internalLowMarkers.length > 0 },
    { key: "major_hl", label: "Major HL", hasData: majorHighMarkers.length > 0 || majorLowMarkers.length > 0 },
    { key: "bos_levels", label: "BOS úrovně", hasData: zones.some((z) => isBosZone(z.name)) },
    { key: "inducement_points", label: "Inducement points", hasData: inducementPointsByZone.length > 0 },
    { key: "demand_supply_zones", label: "Demand / Supply zóny", hasData: zones.some((z) => isDemandSupplyZone(z.name)) },
    { key: "support_resistance_zones", label: "Support / Resistance", hasData: zones.some((z) => isSupportResistanceZone(z.name)) },
    { key: "premium_discount_zones", label: "Premium / Mid / Discount", hasData: zones.some((z) => isPremiumDiscountZone(z.name)) },
    { key: "lines", label: "Čáry (indikátory)", hasData: lines.length > 0 },
  ];

  const layout: any = {
    height,
    title: { text: moduleName, font: { size: 14 } },
    margin: { t: 50, r: 40, b: 40, l: 60 },
    paper_bgcolor: "#18181b",
    plot_bgcolor: "#18181b",
    font: { color: "#a1a1aa", size: 11 },
    xaxis: {
      type: "date",
      gridcolor: "#27272a",
      rangeslider: { visible: true, thickness: 0.05, bgcolor: "#27272a" },
      fixedrange: false,
      ...((rrrTradeStyle || orderLevelsMode)
        ? {
            rangebreaks: [{ bounds: ["sat", "mon"] }],
          }
        : {}),
    },
    yaxis: {
      gridcolor: "#27272a",
      tickformat: rrrTradeStyle || orderLevelsMode ? `.${inferPriceDecimalPlaces(ohlc)}f` : ".2f",
      fixedrange: false,
    },
    dragmode: "zoom",
    showlegend: traces.length > 1,
    legend: { x: 0, y: 1.02, orientation: "h" },
    shapes: [...zoneShapes, ...tradeShapes],
    annotations: zoneAnnotations,
  };

  const config: any = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  return (
    <div className="w-full relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-400">{moduleName}</span>
        <button
          onClick={() => setVisibilityPanelOpen(true)}
          title="Viditelnost prvků (Hide & Show)"
          className="p-2 rounded text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: "100%" }}
        useResizeHandler
      />

      {visibilityPanelOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setVisibilityPanelOpen(false)}
            aria-hidden
          />
          <div className="fixed top-0 right-0 h-full w-72 max-w-[90vw] bg-zinc-900 border-l border-zinc-700 shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
              <h3 className="text-sm font-medium text-zinc-200">Viditelnost prvků</h3>
              <button
                onClick={() => setVisibilityPanelOpen(false)}
                className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                aria-label="Zavřít"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {visibilityOptions.map(({ key, label, hasData }) => (
                <label
                  key={key}
                  className={`flex items-center gap-3 cursor-pointer py-1.5 ${
                    !hasData ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={visibility[key]}
                    onChange={(e) =>
                      setVisibility((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    disabled={!hasData}
                    className="rounded"
                  />
                  <span className="text-sm text-zinc-300">{label}</span>
                  {!hasData && (
                    <span className="text-xs text-zinc-500 ml-auto">(žádná data)</span>
                  )}
                </label>
              ))}
            </div>
            <div className="p-4 border-t border-zinc-700 shrink-0">
              <button
                onClick={() => setVisibility({ ...DEFAULT_VISIBILITY })}
                className="w-full px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-300"
              >
                Obnovit výchozí
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
