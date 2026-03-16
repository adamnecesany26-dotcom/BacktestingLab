"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getViewData } from "@/lib/api";
import { getFileContent } from "@/lib/firestore";
import { parseViewParams, type StrategyParams } from "@/lib/strategyParams";
import type { DataInstrument } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { OhlcBar } from "@shared/types";

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
  height = 720,
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
  const [years, setYears] = useState(0.25);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [selectedItemType, setSelectedItemType] = useState<ViewItemType>(
    initialItemType ?? "module"
  );
  const [lines, setLines] = useState<{ name: string; data: { date: string; value: number }[] }[]>([]);
  const [zones, setZones] = useState<
    { date_start: string; date_end: string; value_low: number; value_high: number; fillcolor?: string; name?: string }[]
  >([]);
  const [viewParamsSchema, setViewParamsSchema] = useState<StrategyParams>({});
  const [viewParamsValues, setViewParamsValues] = useState<StrategyParams>({});
  const [paramsDrawerOpen, setParamsDrawerOpen] = useState(false);
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
      const res = await getViewData(dataFile, years, code, paramsToSend);
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
  }, [dataFile, years, selectedItemId, selectedItemType, instruments]);

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
  const internalHighMarkers = markers.filter((m) => m.type === "internal_high");
  const internalLowMarkers = markers.filter((m) => m.type === "internal_low");
  const otherMarkers = markers.filter(
    (m) =>
      m.type !== "high" &&
      m.type !== "low" &&
      m.type !== "internal_high" &&
      m.type !== "internal_low"
  );

  const mapMarkerToIndex = (m: ViewMarker) => {
    const idx = dateToIndex.get(m.date.slice(0, 10));
    return idx ?? -1;
  };

  const highMapped = highMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
  const lowMapped = lowMarkers.map((m) => ({ idx: mapMarkerToIndex(m), val: m.value })).filter((p) => p.idx >= 0);
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
  const lineTraces = lines
    .map((line, i) => {
      const pts = line.data
        .map((p) => ({ idx: dateToIndex.get(p.date.slice(0, 10)) ?? -1, val: p.value }))
        .filter((p) => p.idx >= 0)
        .sort((a, b) => a.idx - b.idx);
      const color = (line as { color?: string }).color ?? lineColors[i % lineColors.length];
      return {
        type: "scatter" as const,
        x: pts.map((p) => p.idx),
        y: pts.map((p) => p.val),
        mode: "lines" as const,
        line: { color, width: 2 },
        name: line.name,
      };
    })
    .filter((t) => t.x.length > 0);

  const zoneShapes: any[] = zones.map((z) => {
    const idxStart = dateToIndex.get(z.date_start.slice(0, 10)) ?? 0;
    const idxEnd = dateToIndex.get(z.date_end.slice(0, 10)) ?? n - 1;
    const fill = z.fillcolor ?? "rgba(59, 130, 246, 0.15)";
    return {
      type: "rect",
      x0: idxStart - 0.5,
      x1: idxEnd + 0.5,
      y0: z.value_low,
      y1: z.value_high,
      fillcolor: fill,
      line: { width: 1, color: "#3b82f6" },
      layer: "below",
    };
  });

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
        </div>
      </div>

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
