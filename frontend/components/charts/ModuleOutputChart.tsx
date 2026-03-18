"use client";

import { useEffect, useState } from "react";
import type { OhlcBar, ModuleOutput, Trade } from "@shared/types";

type VisibilityKey =
  | "entry_markers"
  | "exit_markers"
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

interface ModuleOutputChartProps {
  ohlc: OhlcBar[];
  moduleName: string;
  output: ModuleOutput;
  trades?: Trade[];
  height?: number;
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

export function ModuleOutputChart({
  ohlc,
  moduleName,
  output,
  trades = [],
  height = 480,
}: ModuleOutputChartProps) {
  const [Plot, setPlot] = useState<React.ComponentType<any> | null>(null);
  const [visibilityPanelOpen, setVisibilityPanelOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<VisibilityKey, boolean>>(() => ({ ...DEFAULT_VISIBILITY }));

  useEffect(() => {
    import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

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
  const exitX: string[] = [];
  const exitY: number[] = [];
  const tradeShapes: any[] = [];
  for (const t of trades) {
    const entryDate = t.entryDate ?? t.date ?? "";
    const exitDate = t.exitDate ?? t.date ?? "";
    const entryPrice = t.entryPrice ?? t.price;
    const exitPrice = t.exitPrice ?? t.price;
    if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) continue;
    const entryBarDate = findBarDate(ohlc, entryDate);
    const exitBarDate = findBarDate(ohlc, exitDate);
    if (entryBarDate) {
      entryX.push(entryBarDate);
      entryY.push(entryPrice);
    }
    if (exitBarDate) {
      exitX.push(exitBarDate);
      exitY.push(exitPrice);
    }
    if (!entryBarDate || !exitBarDate) continue;

    const entryTs = new Date(entryBarDate).getTime();
    const exitTs = new Date(exitBarDate).getTime();
    if (!Number.isFinite(entryTs) || !Number.isFinite(exitTs)) continue;

    const x0 = entryTs <= exitTs ? entryBarDate : exitBarDate;
    const x1 = entryTs <= exitTs ? exitBarDate : entryBarDate;
    const y0 = Math.min(entryPrice, exitPrice);
    const y1 = Math.max(entryPrice, exitPrice);
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
  if (visibility.entry_markers && entryX.length > 0) {
    traces.push({
      type: "scatter",
      x: entryX,
      y: entryY,
      mode: "markers",
      marker: { size: 10, color: "#3b82f6", symbol: "triangle-up", line: { color: "#fff", width: 1 } },
      name: "Entry",
      showlegend: true,
    });
  }
  if (visibility.exit_markers && exitX.length > 0) {
    traces.push({
      type: "scatter",
      x: exitX,
      y: exitY,
      mode: "markers",
      marker: { size: 10, color: "#f97316", symbol: "triangle-down", line: { color: "#fff", width: 1 } },
      name: "Exit",
      showlegend: true,
    });
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
    }))
  ).filter((p) => p.date);
  const inducementDemand = inducementPointsByZone.filter((p) => p.zoneName === "Demand");
  const inducementSupply = inducementPointsByZone.filter((p) => p.zoneName === "Supply");
  const inducementOther = inducementPointsByZone.filter((p) => p.zoneName !== "Demand" && p.zoneName !== "Supply");

  if (visibility.inducement_points && inducementDemand.length > 0) {
    traces.push({
      type: "scatter",
      x: inducementDemand.map((p) => p.date),
      y: inducementDemand.map((p) => p.value),
      mode: "markers",
      marker: { size: 10, color: "#3b82f6", symbol: "diamond", line: { color: "#fff", width: 1 } },
      name: "Inducement (D)",
      showlegend: true,
    });
  }
  if (visibility.inducement_points && inducementSupply.length > 0) {
    traces.push({
      type: "scatter",
      x: inducementSupply.map((p) => p.date),
      y: inducementSupply.map((p) => p.value),
      mode: "markers",
      marker: { size: 10, color: "#a855f7", symbol: "diamond", line: { color: "#fff", width: 1 } },
      name: "Inducement (S)",
      showlegend: true,
    });
  }
  if (visibility.inducement_points && inducementOther.length > 0) {
    traces.push({
      type: "scatter",
      x: inducementOther.map((p) => p.date),
      y: inducementOther.map((p) => p.value),
      mode: "markers",
      marker: { size: 10, color: "#64748b", symbol: "diamond", line: { color: "#fff", width: 1 } },
      name: "Inducement",
      showlegend: true,
    });
  }

  const lines = output.lines ?? [];
  const lineColors = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4"];
  if (visibility.lines) {
    lines.forEach((line, i) => {
      const pts = line.data ?? [];
      if (pts.length > 0) {
        traces.push({
          type: "scatter",
          x: pts.map((p: { date: string }) => p.date),
          y: pts.map((p: { value: number }) => p.value),
          mode: "lines",
          line: { color: line.color ?? lineColors[i % lineColors.length], width: 2 },
          name: line.name ?? "line",
          legendgroup: line.name ?? "line",
          showlegend: true,
        });
      }
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

    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    const isLine = z.value_low === z.value_high;
    const lineColor = getZoneLineColor(z.name);

    if (isLine) {
      zoneShapes.push({
        type: "line",
        x0: z.date_start,
        x1: z.date_end,
        y0: z.value_low,
        y1: z.value_high,
        line: { width: 2, color: lineColor, dash: "solid" },
        layer: "below",
      });
    } else {
      zoneShapes.push({
        type: "rect",
        x0: z.date_start,
        x1: z.date_end,
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
      if (base !== null && (z.name === "Demand" || z.name === "Supply")) label += ` B:${base}`;
      if (im !== null && (z.name === "Demand" || z.name === "Supply")) label += ` IM:${im}`;
      if (hasIp) label += ` IP:${ipCount},${ipPoints}`;
      const t1 = new Date(z.date_start).getTime();
      const t2 = new Date(z.date_end).getTime();
      const midDate = new Date((t1 + t2) / 2).toISOString();
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

  const visibilityOptions: { key: VisibilityKey; label: string; hasData: boolean }[] = [
    { key: "entry_markers", label: "Entry (vstupy)", hasData: entryX.length > 0 },
    { key: "exit_markers", label: "Exit (výstupy)", hasData: exitX.length > 0 },
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
    },
    yaxis: {
      gridcolor: "#27272a",
      tickformat: ".2f",
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
