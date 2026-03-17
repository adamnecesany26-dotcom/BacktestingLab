"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getViewData } from "@/lib/api";
import { getFileContent } from "@/lib/firestore";
import { parseViewParams, type StrategyParams } from "@/lib/strategyParams";
import type { DataInstrument } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { OhlcBar } from "@shared/types";

function toModuleName(name: string): string {
  return (name || "module").replace(/\s+/g, "_").replace(/-/g, "_").replace(/\./g, "_") || "module";
}

function parseViewDependencies(code: string): string[] {
  const m = code.match(/#\s*VIEW_DEPENDENCIES:\s*(.+)/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

async function resolveModuleDependencies(
  depNames: string[],
  modules: FirestoreItem[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const usedIds = new Set<string>();

  for (const name of depNames) {
    let mod = modules.find((m) => m.name === name && !usedIds.has(m.id));
    if (!mod) {
      const lower = name.toLowerCase();
      const isSwing =
        (lower.includes("swing") && (lower.includes("hl") || lower.includes("high"))) ||
        (lower.includes("hl") && lower.includes("identificator"));
      if (isSwing) {
        mod = modules.find(
          (m) =>
            !usedIds.has(m.id) &&
            (m.name.toLowerCase().includes("swing") ||
              (m.name.toLowerCase().includes("hl") && m.name.toLowerCase().includes("identificator")))
        );
      }
    }
    if (!mod) continue;
    usedIds.add(mod.id);
    const content = await getFileContent("modules", mod.id, "main.py");
    if (content) out["Swing_HL"] = content;
  }
  return out;
}

const TIMEFRAMES = [
  { label: "1M", years: 0.083 },
  { label: "3M", years: 0.25 },
  { label: "6M", years: 0.5 },
  { label: "1Y", years: 1 },
  { label: "2Y", years: 2 },
  { label: "3Y", years: 3 },
  { label: "4Y", years: 4 },
  { label: "5Y", years: 5 },
  { label: "Max", years: 0 },
] as const;

type ViewItemType = "module" | "indicator" | "strategy";

interface StrategyViewChartProps {
  instruments: DataInstrument[];
  modules: FirestoreItem[];
  indicators: FirestoreItem[];
  strategies: FirestoreItem[];
  defaultDataFile?: string;
  initialItemId?: string;
  initialItemType?: ViewItemType;
  height?: number;
}

type ViewMarker = { date: string; type: string; value: number };

export function StrategyViewChart({
  instruments,
  modules,
  indicators,
  strategies,
  defaultDataFile = "mock/NQ_5Y.csv",
  initialItemId,
  initialItemType,
  height = 960,
}: StrategyViewChartProps) {
  const [Plot, setPlot] = useState<React.ComponentType<any> | null>(null);
  const [ohlc, setOhlc] = useState<OhlcBar[]>([]);
  const [markers, setMarkers] = useState<ViewMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataFile, setDataFile] = useState(defaultDataFile);

  useEffect(() => {
    if (instruments.length > 0 && !instruments.some((i) => i.file === dataFile)) {
      setDataFile(instruments[0].file);
    }
  }, [instruments, dataFile]);
  const [years, setYears] = useState(0.5);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [selectedItemType, setSelectedItemType] = useState<ViewItemType>(
    initialItemType ?? "module"
  );
  const [lines, setLines] = useState<{ name: string; data: { date: string; value: number }[] }[]>([]);
  const [zones, setZones] = useState<
    { date_start: string; date_end: string; value_low: number; value_high: number; fillcolor?: string; name?: string; base_length?: number; impulse_score?: number; touches?: number; strength?: number }[]
  >([]);
  const [viewParamsSchema, setViewParamsSchema] = useState<StrategyParams>({});
  const [viewParamsValues, setViewParamsValues] = useState<StrategyParams>({});
  const [paramsDrawerOpen, setParamsDrawerOpen] = useState(false);
  const [valuesModalOpen, setValuesModalOpen] = useState(false);
  const viewParamsRef = useRef<StrategyParams>({});
  useEffect(() => {
    viewParamsRef.current = viewParamsValues;
  }, [viewParamsValues]);

  useEffect(() => {
    if (initialItemId && initialItemType) {
      setSelectedItemId(initialItemId);
      setSelectedItemType(initialItemType);
    }
  }, [initialItemId, initialItemType]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let code: string | null = null;
      let paramsToSend: StrategyParams | null = null;
      if (selectedItemId) {
        const type =
          selectedItemType === "module"
            ? "modules"
            : selectedItemType === "indicator"
              ? "indicators"
              : "strategies";
        code = await getFileContent(type, selectedItemId, "main.py");
        if (code) {
          const schema = parseViewParams(code);
          setViewParamsSchema(schema);
          const merged: StrategyParams = { ...schema };
          if ("timeframe" in schema && instruments.length > 0) {
            const inv = instruments.find((i) => i.file === dataFile);
            if (inv) merged["timeframe"] = inv.timeframe;
          }
          const current = viewParamsRef.current;
          for (const k of Object.keys(current)) {
            if (k in schema) merged[k] = current[k];
          }
          setViewParamsValues(merged);
          paramsToSend = Object.keys(merged).length > 0 ? merged : null;
        }
      } else {
        setViewParamsSchema({});
        setViewParamsValues({});
      }
      const depNames = code ? parseViewDependencies(code) : [];
      const moduleDeps =
        depNames.length > 0 ? await resolveModuleDependencies(depNames, modules) : undefined;
      const res = await getViewData(dataFile, years, code, paramsToSend, moduleDeps);
      setOhlc(res.ohlc);
      setMarkers(res.markers);
      setLines(res.lines ?? []);
      setZones(res.zones ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOhlc([]);
      setMarkers([]);
      setZones([]);
    } finally {
      setLoading(false);
    }
  }, [dataFile, years, selectedItemId, selectedItemType, instruments, modules]);

  const handleShuffle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let code: string | null = null;
      let paramsToSend: StrategyParams | null = null;
      if (selectedItemId) {
        const type =
          selectedItemType === "module"
            ? "modules"
            : selectedItemType === "indicator"
              ? "indicators"
              : "strategies";
        code = await getFileContent(type, selectedItemId, "main.py");
        if (code) {
          const schema = parseViewParams(code);
          const merged: StrategyParams = { ...schema };
          if ("timeframe" in schema && instruments.length > 0) {
            const inv = instruments.find((i) => i.file === dataFile);
            if (inv) merged["timeframe"] = inv.timeframe;
          }
          const current = viewParamsRef.current;
          for (const k of Object.keys(current)) {
            if (k in schema) merged[k] = current[k];
          }
          paramsToSend = Object.keys(merged).length > 0 ? merged : null;
        }
      }
      const depNames = code ? parseViewDependencies(code) : [];
      const moduleDeps =
        depNames.length > 0 ? await resolveModuleDependencies(depNames, modules) : undefined;
      const res = await getViewData(dataFile, 0, code, paramsToSend, moduleDeps);
      const fullOhlc = res.ohlc;
      const fullMarkers = res.markers ?? [];
      const fullLines = res.lines ?? [];
      const fullZones = res.zones ?? [];

      if (fullOhlc.length < 2) {
        setOhlc(fullOhlc);
        setMarkers(fullMarkers);
        setLines(fullLines);
        setZones(fullZones);
        return;
      }

      const windowBars = Math.min(126, Math.max(20, Math.floor(fullOhlc.length * 0.2)));
      const maxStart = Math.max(0, fullOhlc.length - windowBars);
      const startIdx = Math.floor(Math.random() * (maxStart + 1));
      const endIdx = Math.min(startIdx + windowBars, fullOhlc.length);
      const windowOhlc = fullOhlc.slice(startIdx, endIdx);
      const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
      const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";

      const inRange = (d: string) => {
        const ds = d.slice(0, 10);
        return ds >= startDate && ds <= endDate;
      };

      setOhlc(windowOhlc);
      setMarkers(fullMarkers.filter((m) => inRange(m.date)));
      setLines(
        fullLines.map((line) => ({
          ...line,
          data: (line.data ?? []).filter((p) => inRange(p.date)),
        })).filter((line) => line.data.length > 0)
      );
      setZones(
        fullZones.filter(
          (z) =>
            (z.date_start.slice(0, 10) >= startDate && z.date_start.slice(0, 10) <= endDate) ||
            (z.date_end.slice(0, 10) >= startDate && z.date_end.slice(0, 10) <= endDate) ||
            (z.date_start.slice(0, 10) <= startDate && z.date_end.slice(0, 10) >= endDate)
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dataFile, selectedItemId, selectedItemType, instruments]);

  useEffect(() => {
    import("react-plotly.js").then((mod) => setPlot(() => mod.default));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const inputClass = "px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm";

  if (!Plot) {
    return (
      <div className="flex items-center justify-center text-zinc-500" style={{ height }}>
        Načítání Plotly...
      </div>
    );
  }

  const n = ohlc.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const dateToIndex = new Map(ohlc.map((b, i) => [b.date.slice(0, 10), i]));
  const opens = ohlc.map((b) => b.open);
  const highs = ohlc.map((b) => b.high);
  const lows = ohlc.map((b) => b.low);
  const closes = ohlc.map((b) => b.close);

  const tickStep = Math.max(1, Math.floor(n / 8));
  const tickvals = Array.from({ length: Math.ceil(n / tickStep) + 1 }, (_, i) =>
    Math.min(i * tickStep, n - 1)
  );
  const ticktext = tickvals.map((i) => ohlc[i]?.date?.slice(0, 10) ?? "");

  const candlestickTrace: any = {
    type: "candlestick",
    x: indices,
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    increasing: { line: { color: "#10b981", width: 1 }, fillcolor: "#10b981" },
    decreasing: { line: { color: "#ef4444", width: 1 }, fillcolor: "#ef4444" },
    xperiodalignment: "middle",
    name: "OHLC",
  };

  const highMarkers = markers.filter((m) => m.type === "high");
  const lowMarkers = markers.filter((m) => m.type === "low");
  const majorHighMarkers = markers.filter((m) => m.type === "major_high");
  const majorLowMarkers = markers.filter((m) => m.type === "major_low");
  const internalHighMarkers = markers.filter((m) => m.type === "internal_high");
  const internalLowMarkers = markers.filter((m) => m.type === "internal_low");
  const otherMarkers = markers.filter(
    (m) =>
      m.type !== "high" &&
      m.type !== "low" &&
      m.type !== "major_high" &&
      m.type !== "major_low" &&
      m.type !== "internal_high" &&
      m.type !== "internal_low"
  );

  const mapMarkerToIndex = (m: ViewMarker) => {
    const idx = dateToIndex.get(m.date.slice(0, 10));
    return idx ?? -1;
  };

  const highMapped = highMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
  const lowMapped = lowMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
  const majorHighMapped = majorHighMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
  const majorLowMapped = majorLowMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
  const internalHighMapped = internalHighMarkers
    .map((m) => ({ idx: mapMarkerToIndex(m), val: m.value }))
    .filter((p) => p.idx >= 0);
  const internalLowMapped = internalLowMarkers
    .map((m) => ({ idx: mapMarkerToIndex(m), val: m.value }))
    .filter((p) => p.idx >= 0);
  const otherMapped = otherMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);

  const highTrace: any = {
    type: "scatter",
    x: highMapped.map((p) => p.idx),
    y: highMapped.map((p) => p.val),
    mode: "markers",
    marker: {
      size: 10,
      color: "#10b981",
      symbol: "circle",
      line: { color: "#fff", width: 1 },
    },
    name: "High",
    showlegend: highMarkers.length > 0,
  };

  const lowTrace: any = {
    type: "scatter",
    x: lowMapped.map((p) => p.idx),
    y: lowMapped.map((p) => p.val),
    mode: "markers",
    marker: {
      size: 10,
      color: "#ef4444",
      symbol: "circle",
      line: { color: "#fff", width: 1 },
    },
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
          marker: {
            size: 14,
            color: "#fbbf24",
            symbol: "diamond",
            line: { color: "#fff", width: 1.5 },
          },
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
          marker: {
            size: 14,
            color: "#f59e0b",
            symbol: "diamond",
            line: { color: "#fff", width: 1.5 },
          },
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
          marker: {
            size: 4,
            color: "#6ee7b7",
            symbol: "circle",
            line: { color: "#10b981", width: 0.5 },
          },
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
          marker: {
            size: 4,
            color: "#fca5a5",
            symbol: "circle",
            line: { color: "#ef4444", width: 0.5 },
          },
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
          marker: {
            size: 10,
            color: "#3b82f6",
            symbol: "diamond",
            line: { color: "#fff", width: 1 },
          },
          name: "Signal",
          showlegend: true,
        }
      : null;

  const lineColors = ["#3b82f6", "#f97316", "#a855f7", "#06b6d4"];
  const trendNameCount = new Map<string, number>();
  const lineTraces = lines
    .map((line, i) => {
      const pts = line.data
        .map((p) => ({ idx: dateToIndex.get(p.date.slice(0, 10)) ?? -1, val: p.value }))
        .filter((p) => p.idx >= 0)
        .sort((a, b) => a.idx - b.idx);
      const color = (line as { color?: string }).color ?? lineColors[i % lineColors.length];
      const count = (trendNameCount.get(line.name) ?? 0) + 1;
      trendNameCount.set(line.name, count);
      return {
        type: "scatter" as const,
        x: pts.map((p) => p.idx),
        y: pts.map((p) => p.val),
        mode: "lines" as const,
        line: { color, width: 2, shape: "linear" },
        connectgaps: true,
        name: line.name,
        legendgroup: line.name,
        showlegend: count === 1,
      };
    })
    .filter((t) => t.x.length > 0);

  const zoneShapes: any[] = [];
  const zoneAnnotations: any[] = [];
  for (const z of zones) {
    const idxStart = dateToIndex.get(z.date_start.slice(0, 10)) ?? 0;
    const idxEnd = dateToIndex.get(z.date_end.slice(0, 10)) ?? n - 1;
    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    const isLine = z.value_low === z.value_high;
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
                : "#3b82f6";

    if (isLine) {
      zoneShapes.push({
        type: "line",
        x0: idxStart - 0.5,
        x1: idxEnd + 0.5,
        y0: z.value_low,
        y1: z.value_high,
        line: { width: 2, color: lineColor, dash: "solid" },
        layer: "below",
      });
    } else {
      zoneShapes.push({
        type: "rect",
        x0: idxStart - 0.5,
        x1: idxEnd + 0.5,
        y0: z.value_low,
        y1: z.value_high,
        fillcolor: fill,
        line: { width: 1, color: lineColor },
        layer: "below",
      });
    }

    if (z.name) {
      let label =
        z.name === "Demand"
          ? "D"
          : z.name === "Supply"
            ? "S"
            : z.name === "Support"
              ? "Sup"
              : z.name === "Resistance"
                ? "Res"
                : z.name === "BOS (M)"
                  ? "BOS M"
                  : z.name;
      const imp = typeof z.impulse_score === "number" && z.impulse_score > 0 ? z.impulse_score : null;
      const touches = typeof z.touches === "number" && z.touches > 0 ? z.touches : null;
      if (imp !== null) label += ` ${imp}`;
      if (touches !== null && (z.name === "Support" || z.name === "Resistance")) label += ` (${touches})`;
      const yCenter = isLine ? z.value_low : (z.value_low + z.value_high) / 2;
      zoneAnnotations.push({
        x: (idxStart + idxEnd) / 2,
        y: yCenter,
        text: label,
        showarrow: false,
        font: { size: 11, color: lineColor },
        xanchor: "center",
        yanchor: "middle",
      });
    }
  }

  const layout: any = {
    height,
    margin: { t: 50, r: 40, b: 60, l: 60 },
    paper_bgcolor: "#18181b",
    plot_bgcolor: "#18181b",
    font: { color: "#a1a1aa", size: 11 },
    xaxis: {
      type: "linear",
      range: [-0.5, n - 0.5],
      gridcolor: "#27272a",
      tickvals,
      ticktext,
      rangeslider: { visible: true, thickness: 0.05, bgcolor: "#27272a" },
      fixedrange: false,
    },
    yaxis: {
      gridcolor: "#27272a",
      tickformat: ".2f",
      fixedrange: false,
    },
    dragmode: "zoom",
    legend: { x: 0, y: 1.1, orientation: "h" },
    shapes: zoneShapes,
    annotations: zoneAnnotations,
  };

  const config: any = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  const traces: any[] = [candlestickTrace];
  if (highMarkers.length > 0) traces.push(highTrace);
  if (lowMarkers.length > 0) traces.push(lowTrace);
  if (majorHighTrace) traces.push(majorHighTrace);
  if (majorLowTrace) traces.push(majorLowTrace);
  if (internalHighTrace) traces.push(internalHighTrace);
  if (internalLowTrace) traces.push(internalLowTrace);
  if (otherTrace) traces.push(otherTrace);
  traces.push(...lineTraces);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap gap-3 pb-3 shrink-0">
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Instrument</label>
          <select
            value={dataFile}
            onChange={(e) => setDataFile(e.target.value)}
            className={inputClass}
          >
            {instruments.length === 0 && (
              <option value={defaultDataFile}>{defaultDataFile}</option>
            )}
            {instruments.map((inv) => (
              <option key={inv.file} value={inv.file}>
                {inv.instrument} ({inv.yearsAvailable}y)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Období</label>
          <select
            value={years}
            onChange={(e) => setYears(parseFloat(e.target.value))}
            className={inputClass}
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.label} value={tf.years}>
                {tf.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Modul / Indikátor / Strategie</label>
          <select
            value={selectedItemId ? `${selectedItemType}:${selectedItemId}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                setSelectedItemId(null);
                return;
              }
              const [type, id] = v.split(":");
              setSelectedItemType(type as ViewItemType);
              setSelectedItemId(id);
            }}
            className={inputClass}
          >
            <option value="">— Žádný —</option>
            {strategies.map((s) => (
              <option key={`strategy:${s.id}`} value={`strategy:${s.id}`}>
                📋 {s.name}
              </option>
            ))}
            {modules.map((m) => (
              <option key={`module:${m.id}`} value={`module:${m.id}`}>
                📦 {m.name}
              </option>
            ))}
            {indicators.map((i) => (
              <option key={`indicator:${i.id}`} value={`indicator:${i.id}`}>
                📊 {i.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-50"
          >
            {loading ? "Načítám..." : "Obnovit"}
          </button>
          <button
            onClick={handleShuffle}
            disabled={loading}
            title="Náhodné 6M okno z dat"
            className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-50"
          >
            Shuffle
          </button>
          {selectedItemId && (
            <button
              onClick={() => setParamsDrawerOpen(true)}
              title="View params"
              className={`p-2 rounded text-zinc-300 disabled:opacity-50 ${
                Object.keys(viewParamsSchema).length > 0
                  ? "bg-zinc-700 hover:bg-zinc-600"
                  : "bg-zinc-800 hover:bg-zinc-700"
              }`}
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
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
                <circle cx="4" cy="6" r="1.5" fill="currentColor" />
                <circle cx="4" cy="12" r="1.5" fill="currentColor" />
                <circle cx="4" cy="18" r="1.5" fill="currentColor" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setValuesModalOpen(true)}
            title="Zobrazit hodnoty z algoritmu"
            className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-300 disabled:opacity-50"
          >
            Values
          </button>
        </div>
      </div>

      {valuesModalOpen && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setValuesModalOpen(false)}
        >
          <div
            className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 shrink-0">
              <h3 className="text-lg font-semibold text-zinc-100">Hodnoty z algoritmu</h3>
              <button
                onClick={() => setValuesModalOpen(false)}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                aria-label="Zavřít"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-6">
              <div>
                <h4 className="text-sm font-medium text-emerald-400/90 mb-2">Swing H/L (markers)</h4>
                <p className="text-xs text-zinc-500 mb-2">Bodové značky – kde algoritmus určil swing high / swing low</p>
                {markers.length === 0 ? (
                  <p className="text-sm text-zinc-500 italic">Žádné markery</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-700">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-800/80">
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">Datum</th>
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">Typ</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-medium">Hodnota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {markers.map((m, i) => (
                          <tr key={i} className="border-t border-zinc-700/50">
                            <td className="px-3 py-2 text-zinc-200">{m.date}</td>
                            <td className="px-3 py-2 text-zinc-300">{m.type}</td>
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{m.value.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-sm font-medium text-amber-400/90 mb-2">S/D zóny</h4>
                <p className="text-xs text-zinc-500 mb-2">Demand (zelená), Supply (červená). Zóny vznikají na základě BOS.</p>
                <p className="text-xs text-zinc-500 mb-2">
                  <span className="text-amber-400/80 font-medium">Silnost move ze zóny (Impulse):</span> 1–4 (4=velmi silný, 3=silný, 2=průměrný, 1=slabý). Sloupec Impulse u každé zóny.
                  {zones.length > 0 && (() => {
                    const withImpulse = zones.filter((z) => typeof z.impulse_score === "number" && z.impulse_score > 0);
                    if (withImpulse.length === 0) return null;
                    const avg = Math.round(withImpulse.reduce((s, z) => s + (z.impulse_score ?? 0), 0) / withImpulse.length);
                    const maxZ = withImpulse.reduce((a, b) => ((a.impulse_score ?? 0) > (b.impulse_score ?? 0) ? a : b));
                    return (
                      <span className="block mt-1 text-amber-300/90">
                        Průměr: {avg}/4 · Nejsilnější: {maxZ.name} {maxZ.impulse_score}/4
                      </span>
                    );
                  })()}
                </p>
                {zones.length === 0 ? (
                  <div className="space-y-1">
                    <p className="text-sm text-zinc-500 italic">Žádné zóny</p>
                    <p className="text-xs text-zinc-600">
                      S/D Zones vyžaduje modul Swing HL. Zkontrolujte, že máte modul s názvem &quot;Swing HL&quot; nebo &quot;HL identificator&quot; v sekci Moduly.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-700">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-800/80">
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">Swing (od)</th>
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">BOS (do)</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-medium">Low</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-medium">High</th>
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">Název</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-medium">Base</th>
                          <th className="px-3 py-2 text-right text-zinc-400 font-medium">Impulse</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zones.map((z, i) => (
                          <tr key={i} className="border-t border-zinc-700/50">
                            <td className="px-3 py-2 text-zinc-200">{z.date_start}</td>
                            <td className="px-3 py-2 text-zinc-200">{z.date_end}</td>
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{z.value_low.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{z.value_high.toFixed(2)}</td>
                            <td className="px-3 py-2 text-zinc-300">{z.name ?? "—"}</td>
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{z.base_length ?? "—"}</td>
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{z.impulse_score ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {lines.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-blue-400/90 mb-2">Čáry (lines)</h4>
                  <p className="text-xs text-zinc-500 mb-2">Indikátory – čáry</p>
                  {lines.map((line, i) => (
                    <div key={i} className="mb-3">
                      <p className="text-xs text-zinc-400 mb-1">{line.name}</p>
                      <p className="text-xs text-zinc-500 font-mono">
                        {line.data?.length ?? 0} bodů
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {paramsDrawerOpen && selectedItemId && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setParamsDrawerOpen(false)}
            aria-hidden
          />
          <div className="fixed top-0 right-0 h-full w-80 max-w-[90vw] bg-zinc-900 border-l border-zinc-700 shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
              <h3 className="text-sm font-medium text-zinc-200">View params</h3>
              <button
                onClick={() => setParamsDrawerOpen(false)}
                className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                aria-label="Zavřít"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {Object.keys(viewParamsSchema).length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Tento modul/indikátor nemá VIEW_PARAMS. Přidej do kódu např.:
                  <code className="block mt-2 p-2 rounded bg-zinc-800 text-xs text-zinc-400">
                    VIEW_PARAMS = &#123;&quot;period&quot;: 20, &quot;color&quot;: &quot;#3b82f6&quot;&#125;
                  </code>
                </p>
              ) : (
              Object.entries(viewParamsValues).map(([key, value]) => (
                <div key={key}>
                  <label className="text-xs text-zinc-500 block mb-1">{key}</label>
                  {typeof value === "number" ? (
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isNaN(v)) {
                          setViewParamsValues((prev) => ({ ...prev, [key]: v }));
                        }
                      }}
                      step={Number.isInteger(value) ? 1 : 0.01}
                      className={inputClass}
                    />
                  ) : typeof value === "boolean" ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) =>
                          setViewParamsValues((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        className="rounded"
                      />
                      <span className="text-sm text-zinc-300">{value ? "Ano" : "Ne"}</span>
                    </label>
                  ) : (
                    <input
                      type="text"
                      value={String(value)}
                      onChange={(e) =>
                        setViewParamsValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className={inputClass}
                    />
                  )}
                </div>
              ))
              )}
            </div>
            {Object.keys(viewParamsSchema).length > 0 && (
              <div className="p-4 border-t border-zinc-700 shrink-0">
                <button
                  onClick={() => {
                    fetchData();
                    setParamsDrawerOpen(false);
                  }}
                  disabled={loading}
                  className="w-full px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
                >
                  {loading ? "Načítám..." : "Použít"}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-rose-500/20 text-rose-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {loading && ohlc.length === 0 ? (
          <div className="flex items-center justify-center text-zinc-500" style={{ height }}>
            Načítání dat...
          </div>
        ) : ohlc.length === 0 ? (
          <div className="flex items-center justify-center text-zinc-500" style={{ height }}>
            Žádná data
          </div>
        ) : (
          <Plot
            data={traces}
            layout={layout}
            config={config}
            style={{ width: "100%" }}
            useResizeHandler
          />
        )}
      </div>
    </div>
  );
}
