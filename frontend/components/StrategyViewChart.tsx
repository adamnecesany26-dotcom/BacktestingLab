"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  getViewData,
  isViewRegimeHistogramLine,
  type ViewLine,
  type ViewLineSeries,
} from "@/lib/api";
import { getFileContent } from "@/lib/firestore";
import {
  parseViewParams,
  parseViewParamMeta,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";
import type { DataInstrument } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { OhlcBar } from "@shared/types";
import {
  buildViewChartTimeframeOptions,
  effectiveViewDataTimeframe,
  shuffleWindowBarCount,
} from "@/lib/viewChartTimeframe";

function toModuleName(name: string): string {
  return (name || "module").replace(/\s+/g, "_").replace(/-/g, "_").replace(/\./g, "_") || "module";
}

function parseViewDependencies(code: string): string[] {
  const m = code.match(/#\s*VIEW_DEPENDENCIES:\s*(.+)/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "").trim();
  if (m.length !== 6 || !/^[0-9a-fA-F]+$/.test(m)) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Barvy režimů (histogram ve spodním panelu) — konzistentní s dokumentací indikátoru */
const REGIME_HISTOGRAM_COLORS = {
  trend: "rgba(0, 200, 0, 0.85)",
  chop: "rgba(120, 120, 120, 0.65)",
  high_vol: "rgba(220, 0, 0, 0.85)",
} as const;

/** Inducement přímo u cenové úrovně (kruhy), ne horizontální úsečky přes celý graf. */
function buildInducementMarkerTrace(
  points: { idx: number; val: number }[],
  colorHex: string,
  name: string,
  numBars: number
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

/** Dotyk S/D zóny: Low/High svíčky podle modulu (View). */
function buildZoneTouchMarkerTrace(
  zones: {
    has_touch?: boolean;
    touch_bar_index?: number;
    touch_marker_price?: number;
  }[],
  numBars: number
): any | null {
  if (numBars < 1) return null;
  const pts: { idx: number; val: number }[] = [];
  for (const z of zones) {
    if (!z.has_touch) continue;
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
      color: "rgba(147, 197, 253, 0.55)",
      line: { color: "rgba(191, 219, 254, 0.9)", width: 1.5 },
    },
    name: "Touch zóny",
    showlegend: true,
    hovertemplate: "Touch zóny %{y:.4f}<extra></extra>",
  };
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
    if (content) out[toModuleName(name)] = content;
  }
  return out;
}

/** Klíče pro přepínání viditelnosti – rozšířitelné pro další moduly */
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

const DEFAULT_VISIBILITY: Record<VisibilityKey, boolean> = {
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
  /** Candle bar size for chart + module OHLC: native = instrument resolution; else server-side resample */
  const [chartTimeframe, setChartTimeframe] = useState<string>("native");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [selectedItemType, setSelectedItemType] = useState<ViewItemType>(
    initialItemType ?? "module"
  );
  const [lines, setLines] = useState<ViewLine[]>([]);
  const [zones, setZones] = useState<
    {
      date_start: string;
      date_end: string;
      value_low: number;
      value_high: number;
      fillcolor?: string;
      name?: string;
      base_length?: number;
      impulse_score?: number;
      touches?: number;
      strength?: number;
      inducements?: { date: string; value: number; type: string; index?: number }[];
      inducement_count?: number;
      inducement_points?: number;
      has_touch?: boolean;
      touch_bar_index?: number;
      touch_marker_price?: number;
      touch_date?: string;
      active_demand_zones_below?: number;
      has_gap?: boolean;
      gap_type?: string;
      gap_date?: string;
      gap_value_low?: number;
      gap_value_high?: number;
    }[]
  >([]);
  const [viewParamsSchema, setViewParamsSchema] = useState<StrategyParams>({});
  const [viewParamsMeta, setViewParamsMeta] = useState<StrategyParamsMeta>({});
  const [viewParamsValues, setViewParamsValues] = useState<StrategyParams>({});
  const [paramsDrawerOpen, setParamsDrawerOpen] = useState(false);
  const [visibilityPanelOpen, setVisibilityPanelOpen] = useState(false);
  const [valuesModalOpen, setValuesModalOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<VisibilityKey, boolean>>(() => ({ ...DEFAULT_VISIBILITY }));
  const viewParamsRef = useRef<StrategyParams>({});
  /** Zvyšuje se při každém novém fetchi; starší async odpověď nesmí přepsat stav (Strict Mode / rychlé přepnutí modulu). */
  const viewRequestGenRef = useRef(0);
  /** Plotly někdy neaplikuje layout.shapes při prvním vykreslení; změna revision vynutí Plotly.react. */
  const [plotRevision, setPlotRevision] = useState(0);
  useEffect(() => {
    viewParamsRef.current = viewParamsValues;
  }, [viewParamsValues]);

  const selectedInstrument = useMemo(
    () => instruments.find((i) => i.file === dataFile),
    [instruments, dataFile]
  );
  const chartTfOptions = useMemo(
    () => buildViewChartTimeframeOptions(selectedInstrument?.timeframe),
    [selectedInstrument?.timeframe]
  );

  useEffect(() => {
    if (!chartTfOptions.some((o) => o.value === chartTimeframe)) {
      setChartTimeframe("native");
    }
  }, [chartTfOptions, chartTimeframe]);

  useEffect(() => {
    if (initialItemId && initialItemType) {
      setSelectedItemId(initialItemId);
      setSelectedItemType(initialItemType);
    }
  }, [initialItemId, initialItemType]);

  const fetchData = useCallback(async () => {
    const gen = ++viewRequestGenRef.current;
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
          setViewParamsMeta(parseViewParamMeta(code));
          const merged: StrategyParams = { ...schema };
          if (instruments.length > 0) {
            const inv = instruments.find((i) => i.file === dataFile);
            if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
              merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
            }
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
      const res = await getViewData(dataFile, years, code, paramsToSend, moduleDeps, chartTimeframe);
      if (gen !== viewRequestGenRef.current) return;
      setOhlc(res.ohlc);
      setMarkers(res.markers);
      setLines(res.lines ?? []);
      setZones(res.zones ?? []);
      setPlotRevision((r) => r + 1);
    } catch (e) {
      if (gen !== viewRequestGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setOhlc([]);
      setMarkers([]);
      setLines([]);
      setZones([]);
    } finally {
      if (gen === viewRequestGenRef.current) {
        setLoading(false);
      }
    }
  }, [dataFile, years, chartTimeframe, selectedItemId, selectedItemType, instruments, modules]);

  const handleShuffle = useCallback(async () => {
    const gen = ++viewRequestGenRef.current;
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
          if (instruments.length > 0) {
            const inv = instruments.find((i) => i.file === dataFile);
            if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
              merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
            }
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
      const res = await getViewData(dataFile, 0, code, paramsToSend, moduleDeps, chartTimeframe);
      if (gen !== viewRequestGenRef.current) return;
      const fullOhlc = res.ohlc;
      const fullMarkers = res.markers ?? [];
      const fullLines = res.lines ?? [];
      const fullZones = res.zones ?? [];

      if (fullOhlc.length < 2) {
        setOhlc(fullOhlc);
        setMarkers(fullMarkers);
        setLines(fullLines);
        setZones(fullZones);
        setPlotRevision((r) => r + 1);
        return;
      }

      const windowBars = shuffleWindowBarCount(
        fullOhlc.length,
        years,
        chartTimeframe,
        selectedInstrument?.timeframe
      );
      const maxStart = Math.max(0, fullOhlc.length - windowBars);
      const startIdx = Math.floor(Math.random() * (maxStart + 1));
      const endIdx = Math.min(startIdx + windowBars, fullOhlc.length);
      const windowOhlc = fullOhlc.slice(startIdx, endIdx);
      const startTime = Date.parse(windowOhlc[0]?.date ?? "");
      const endTime = Date.parse(windowOhlc[windowOhlc.length - 1]?.date ?? "");

      const inRange = (d: string) => {
        const ts = Date.parse(d);
        if (Number.isFinite(ts) && Number.isFinite(startTime) && Number.isFinite(endTime)) {
          return ts >= startTime && ts <= endTime;
        }
        const ds = d.slice(0, 10);
        const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
        const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
        return ds >= startDate && ds <= endDate;
      };

      setOhlc(windowOhlc);
      setMarkers(fullMarkers.filter((m) => inRange(m.date)));
      setLines(
        fullLines
          .map((line) => {
            if (isViewRegimeHistogramLine(line)) {
              const data = (line.data ?? []).filter((p) => inRange(p.date));
              return data.length ? { ...line, data } : null;
            }
            const data = (line.data ?? []).filter((p) => inRange(p.date));
            return data.length ? { ...line, data } : null;
          })
          .filter((line): line is ViewLine => line != null)
      );
      setZones(
        fullZones.filter(
          (z) => {
            const zStart = Date.parse(z.date_start);
            const zEnd = Date.parse(z.date_end);
            if (Number.isFinite(zStart) && Number.isFinite(zEnd) && Number.isFinite(startTime) && Number.isFinite(endTime)) {
              return (zStart >= startTime && zStart <= endTime) || (zEnd >= startTime && zEnd <= endTime) || (zStart <= startTime && zEnd >= endTime);
            }
            const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
            const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
            return (
              (z.date_start.slice(0, 10) >= startDate && z.date_start.slice(0, 10) <= endDate) ||
              (z.date_end.slice(0, 10) >= startDate && z.date_end.slice(0, 10) <= endDate) ||
              (z.date_start.slice(0, 10) <= startDate && z.date_end.slice(0, 10) >= endDate)
            );
          }
        )
      );
      setPlotRevision((r) => r + 1);
    } catch (e) {
      if (gen !== viewRequestGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setOhlc([]);
      setMarkers([]);
      setLines([]);
      setZones([]);
    } finally {
      if (gen === viewRequestGenRef.current) {
        setLoading(false);
      }
    }
  }, [
    dataFile,
    years,
    chartTimeframe,
    selectedItemId,
    selectedItemType,
    selectedInstrument?.timeframe,
    instruments,
    modules,
  ]);

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
  const dateToIndex = new Map(ohlc.map((b, i) => [b.date, i]));
  const dayToIndex = new Map(ohlc.map((b, i) => [b.date.slice(0, 10), i]));
  const opens = ohlc.map((b) => b.open);
  const highs = ohlc.map((b) => b.high);
  const lows = ohlc.map((b) => b.low);
  const closes = ohlc.map((b) => b.close);

  const tickStep = Math.max(1, Math.floor(n / 8));
  const tickvals = Array.from({ length: Math.ceil(n / tickStep) + 1 }, (_, i) =>
    Math.min(i * tickStep, n - 1)
  );
  const ticktext = tickvals.map((i) => {
    const raw = ohlc[i]?.date ?? "";
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

  const chartTimeSpanMs = (() => {
    if (n < 2) return 7 * 86400000;
    const a = Date.parse(ohlc[0]?.date ?? "");
    const b = Date.parse(ohlc[n - 1]?.date ?? "");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 7 * 86400000;
    return Math.abs(b - a) + 86400000;
  })();

  const mapMarkerToIndex = (m: ViewMarker) => {
    const exact = dateToIndex.get(m.date);
    if (exact !== undefined && exact >= 0) return exact;
    const t = Date.parse(m.date);
    const dayKey = (m.date || "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey) && Number.isFinite(t) && n > 0) {
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
    if (!Number.isFinite(t) || n <= 0) return -1;
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
    const maxMs = Math.max(7 * 86400000, chartTimeSpanMs);
    return best >= 0 && bestAbs <= maxMs ? best : -1;
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

  const inducementPointsByZone = zones.flatMap((z) =>
    (z.inducements ?? []).map((ind) => {
      const rawIndex = (ind as { index?: number }).index;
      let idx: number;
      if (typeof rawIndex === "number" && !Number.isNaN(rawIndex)) {
        idx = Math.max(0, Math.min(rawIndex, n - 1));
      } else {
        idx = mapMarkerToIndex({
          date: ind.date ?? "",
          type: "high",
          value: ind.value,
        });
      }
      return { idx, val: ind.value, zoneName: z.name };
    })
  ).filter((p): p is { idx: number; val: number; zoneName: string } => p.idx >= 0);

  const inducementDemand = inducementPointsByZone.filter((p) => p.zoneName === "Demand");
  const inducementSupply = inducementPointsByZone.filter((p) => p.zoneName === "Supply");
  const inducementOther = inducementPointsByZone.filter((p) => p.zoneName !== "Demand" && p.zoneName !== "Supply");
  const inducementPoints = inducementPointsByZone;

  const inducementDemandTrace = buildInducementMarkerTrace(
    inducementDemand.map((p) => ({ idx: p.idx, val: p.val })),
    "#3b82f6",
    "Inducement (D)",
    n
  );

  const inducementSupplyTrace = buildInducementMarkerTrace(
    inducementSupply.map((p) => ({ idx: p.idx, val: p.val })),
    "#a855f7",
    "Inducement (S)",
    n
  );

  const inducementOtherTrace = buildInducementMarkerTrace(
    inducementOther.map((p) => ({ idx: p.idx, val: p.val })),
    "#64748b",
    "Inducement",
    n
  );

  const zoneTouchTrace = buildZoneTouchMarkerTrace(zones, n);

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
  const standardLines = lines.filter((line): line is ViewLineSeries => !isViewRegimeHistogramLine(line));
  const regimeHistogramLine = lines.find(isViewRegimeHistogramLine);

  const lineTraces = standardLines
    .map((line, i) => {
      const pts = line.data
        .map((p) => ({ idx: dateToIndex.get(p.date) ?? dayToIndex.get(p.date.slice(0, 10)) ?? -1, val: p.value }))
        .filter((p) => p.idx >= 0)
        .sort((a, b) => a.idx - b.idx);
      const color = line.color ?? lineColors[i % lineColors.length];
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
      const idx = mapMarkerToIndex({ date: p.date, type: "high", value: 0 });
      if (idx < 0) continue;
      const t = p.trend;
      const c = p.chop;
      const h = p.high_vol;
      const dom = dominantRegime(t, c, h);
      xs.push(idx);
      ys.push(Math.max(t, c, h));
      colors.push(REGIME_HISTOGRAM_COLORS[dom]);
      const label = dom === "trend" ? "Trend" : dom === "high_vol" ? "High vol" : "Chop";
      texts.push(
        `${label}<br>Trend: ${t.toFixed(3)} | Chop: ${c.toFixed(3)} | High vol: ${h.toFixed(3)}<extra></extra>`
      );
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

  const zoneShapes: any[] = [];
  const zoneAnnotations: any[] = [];
  for (const z of zones) {
    if (isBosZone(z.name) && !visibility.bos_levels) continue;
    if (isDemandSupplyZone(z.name) && !visibility.demand_supply_zones) continue;
    if (isSupportResistanceZone(z.name) && !visibility.support_resistance_zones) continue;
    if ((z.name === "Discount" || z.name === "Mid" || z.name === "Premium") && !visibility.premium_discount_zones) continue;

    const idxStart = dateToIndex.get(z.date_start) ?? dayToIndex.get(z.date_start.slice(0, 10)) ?? 0;
    const idxEnd = dateToIndex.get(z.date_end) ?? dayToIndex.get(z.date_end.slice(0, 10)) ?? n - 1;
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
                  : z.name === "Discount"
                    ? "Disc"
                    : z.name === "Premium"
                      ? "Prem"
                      : z.name === "Mid"
                        ? "Mid"
                        : z.name;
      const base = typeof z.base_length === "number" && z.base_length >= 0 ? z.base_length : null;
      const im = typeof z.impulse_score === "number" && z.impulse_score > 0 ? z.impulse_score : null;
      const ipCount = Math.max(0, (z as { inducement_count?: number }).inducement_count ?? 0);
      const ipPoints = Math.max(0, z.inducement_points ?? 0);
      const hasIp = (ipCount > 0 || ipPoints > 0) && (z.name === "Demand" || z.name === "Supply");
      const touches = typeof z.touches === "number" && z.touches > 0 ? z.touches : null;
      const adBelow = Math.max(0, (z as { active_demand_zones_below?: number }).active_demand_zones_below ?? 0);
      if (base !== null && (z.name === "Demand" || z.name === "Supply")) label += ` B:${base}`;
      if (im !== null && (z.name === "Demand" || z.name === "Supply")) label += ` IM:${im}`;
      if (hasIp) label += ` IP:${ipCount},${ipPoints}`;
      if (z.name === "Demand" && adBelow > 0) label += ` ↓${adBelow}`;
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
      ...(showRegimeHistogram
        ? { domain: [0, 1], anchor: "y", showticklabels: false }
        : { showticklabels: true }),
      rangeslider: {
        visible: !showRegimeHistogram,
        thickness: 0.05,
        bgcolor: "#27272a",
      },
      fixedrange: false,
    },
    yaxis: {
      ...(showRegimeHistogram ? { domain: [mainY0, 1], anchor: "x" } : {}),
      gridcolor: "#27272a",
      tickformat: ".2f",
      fixedrange: false,
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

  const traces: any[] = [{ ...candlestickTrace, ...pax }];
  if (visibility.swing_hl && highMapped.length > 0) traces.push({ ...highTrace, ...pax });
  if (visibility.swing_hl && lowMapped.length > 0) traces.push({ ...lowTrace, ...pax });
  if (visibility.major_hl && majorHighTrace) traces.push({ ...majorHighTrace, ...pax });
  if (visibility.major_hl && majorLowTrace) traces.push({ ...majorLowTrace, ...pax });
  if (visibility.internal_hl && internalHighTrace) traces.push({ ...internalHighTrace, ...pax });
  if (visibility.internal_hl && internalLowTrace) traces.push({ ...internalLowTrace, ...pax });
  if (otherTrace) traces.push({ ...otherTrace, ...pax });
  if (visibility.inducement_points) {
    if (inducementDemandTrace) traces.push({ ...inducementDemandTrace, ...pax });
    if (inducementSupplyTrace) traces.push({ ...inducementSupplyTrace, ...pax });
    if (inducementOtherTrace) traces.push({ ...inducementOtherTrace, ...pax });
  }
  if (visibility.demand_supply_zones && zoneTouchTrace) {
    traces.push({ ...zoneTouchTrace, ...pax });
  }
  if (visibility.lines) traces.push(...lineTraces.map((t) => ({ ...t, ...pax })));
  if (showRegimeHistogram && regimeBarTrace) traces.push(regimeBarTrace);

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
                {inv.displayName ? `${inv.instrument} - ${inv.displayName}` : inv.instrument} ({inv.timeframe}, {inv.yearsAvailable}y)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            className="text-xs text-zinc-500 block mb-1"
            title="Agregace OHLC na serveru (pandas resample) před vykreslením i před voláním detect/get_line/get_zones. Nelze zjemnit pod rozlišení souboru."
          >
            Timeframe svíček
          </label>
          <select
            value={chartTimeframe}
            onChange={(e) => setChartTimeframe(e.target.value)}
            className={inputClass}
          >
            {chartTfOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
            title="Načte celou historii (years=0), pak náhodný úsek o šířce podle Období a TF grafu (např. 6M + 1D ≈ 126 svíček)"
            className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-50"
          >
            Shuffle
          </button>
          <button
            onClick={() => setVisibilityPanelOpen(true)}
            title="Viditelnost prvků"
            className="p-2 rounded text-zinc-300 disabled:opacity-50 bg-zinc-700 hover:bg-zinc-600"
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
                          <th className="px-3 py-2 text-left text-zinc-400 font-medium">Gap</th>
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
                            <td className="px-3 py-2 text-zinc-300 text-xs">
                              {z.has_gap ? (
                                <span title={`${z.gap_type === "up" ? "Gap up" : "Gap down"} ${z.gap_date ?? ""} ${z.gap_value_low != null && z.gap_value_high != null ? `(${z.gap_value_low.toFixed(2)}–${z.gap_value_high.toFixed(2)})` : ""}`}>
                                  {z.gap_type === "up" ? "↑" : "↓"} {z.gap_date ?? ""}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
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
                        {isViewRegimeHistogramLine(line)
                          ? `${line.data.length} barů · pravděpodobnosti trend / chop / high_vol`
                          : `${(line as { data?: unknown[] }).data?.length ?? 0} bodů`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
              <p className="text-xs text-zinc-500 leading-relaxed pb-2 border-b border-zinc-800">
                Swing / Internal / Major HL berou markery z <span className="text-zinc-400">detect</span> vybraného
                modulu. Demand, Supply a inducementy přicházejí jen z modulu typu S/D Zóny (
                <span className="text-zinc-400">get_zones</span> s D/S logikou). Modul Swing HL ve View kreslí v
                zónách jen BOS úrovně — bez D/S.
              </p>
              {[
                {
                  key: "swing_hl" as const,
                  label: "Swing HL",
                  hasData: highMapped.length > 0 || lowMapped.length > 0,
                },
                {
                  key: "internal_hl" as const,
                  label: "Internal HL",
                  hasData: internalHighMarkers.length > 0 || internalLowMarkers.length > 0,
                },
                {
                  key: "major_hl" as const,
                  label: "Major HL",
                  hasData: majorHighMarkers.length > 0 || majorLowMarkers.length > 0,
                },
                {
                  key: "bos_levels" as const,
                  label: "BOS úrovně",
                  hasData: zones.some((z) => z.name === "BOS" || z.name === "BOS (M)"),
                },
                {
                  key: "inducement_points" as const,
                  label: "Inducement points",
                  hasData:
                    inducementPoints.length > 0 ||
                    zones.some((z) => (z.inducements?.length ?? 0) > 0),
                },
                {
                  key: "demand_supply_zones" as const,
                  label: "Demand / Supply zóny",
                  hasData: zones.some((z) => z.name === "Demand" || z.name === "Supply"),
                },
                {
                  key: "support_resistance_zones" as const,
                  label: "Support / Resistance zóny",
                  hasData: zones.some((z) => z.name === "Support" || z.name === "Resistance"),
                },
                {
                  key: "premium_discount_zones" as const,
                  label: "Premium / Mid / Discount",
                  hasData: zones.some(
                    (z) => z.name === "Discount" || z.name === "Mid" || z.name === "Premium"
                  ),
                },
                {
                  key: "lines" as const,
                  label: "Čáry (indikátory)",
                  hasData: lines.length > 0,
                },
              ].map(({ key, label, hasData }) => (
                <label
                  key={key}
                  className={`flex items-center gap-3 cursor-pointer py-1.5 ${
                    !hasData && !loading ? "opacity-50 cursor-not-allowed" : ""
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
                    <span className="text-xs text-zinc-500 ml-auto">
                      {loading ? "(načítám…)" : "(žádná data)"}
                    </span>
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
              Object.entries(viewParamsValues).map(([key, value]) => {
                const meta = viewParamsMeta[key];
                const label = meta?.title?.trim() || key;
                return (
                <div key={key} className="border-b border-zinc-800/80 pb-4 last:border-0 last:pb-0">
                  <label className="text-sm font-medium text-zinc-200 block mb-0.5">{label}</label>
                  {meta?.title?.trim() ? (
                    <span className="text-[10px] text-zinc-600 font-mono block mb-1">{key}</span>
                  ) : null}
                  {meta?.whatItMeans && (
                    <p className="text-xs text-zinc-500 mb-2 leading-relaxed">{meta.whatItMeans}</p>
                  )}
                  {meta?.howToUse && meta.howToUse.length > 0 && (
                    <ul className="text-xs text-zinc-500 mb-2 list-disc pl-4 space-y-0.5">
                      {meta.howToUse.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
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
              );
              })
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
            Načítání dat (OHLC, markery, zóny)…
          </div>
        ) : ohlc.length === 0 ? (
          <div className="flex items-center justify-center text-zinc-500" style={{ height }}>
            Žádná data
          </div>
        ) : (
          <div className="relative w-full flex-1 min-h-0 flex flex-col">
            <Plot
              data={traces}
              layout={layout}
              config={config}
              revision={plotRevision}
              style={{ width: "100%" }}
              useResizeHandler
            />
            {showRegimeHistogram && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-1 pb-0.5 text-[11px] text-zinc-400 border-t border-zinc-800/80 shrink-0">
                <span className="text-zinc-500 mr-1">Režim (barva sloupce = dominantní stav):</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: REGIME_HISTOGRAM_COLORS.trend }} />
                  Trend (0–1 = pravděpodobnost)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: REGIME_HISTOGRAM_COLORS.chop }} />
                  Chop / konsolidace
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: REGIME_HISTOGRAM_COLORS.high_vol }} />
                  High vol
                </span>
                <span className="text-zinc-600">Výška sloupce = max(trend, chop, high_vol)</span>
              </div>
            )}
            {loading && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center rounded bg-zinc-950/75 backdrop-blur-[1px]"
                aria-busy="true"
                aria-label="Načítání"
              >
                <span className="text-sm text-zinc-200 px-4 py-2 rounded-lg bg-zinc-800/95 border border-zinc-600 shadow-lg">
                  Načítám modul (markery, čáry, zóny)…
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
