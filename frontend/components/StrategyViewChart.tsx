"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import {
  buildArtifactsStreaming,
  getArtifactStatus,
  getViewData,
  isViewRegimeHistogramLine,
  type ArtifactStatusResponse,
  type ArtifactBuildStreamEvent,
  type ViewInducement,
  type ViewLine,
  type ViewLineSeries,
  type ViewZone,
} from "@/lib/api";
import { getFileContent } from "@/lib/firestore";
import {
  coarsestZoneTfFromStrategyCode,
  parseViewParams,
  parseViewParamMeta,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";
import type { DataInstrument } from "@shared/types";
import type { FirestoreItem } from "@/lib/firestore";
import type { OhlcBar } from "@shared/types";
import {
  buildViewChartTimeframeOptionsCoarseFirst,
  effectiveViewDataTimeframe,
  shuffleWindowBarCount,
} from "@/lib/viewChartTimeframe";
import {
  filterZonesForSdZonesOnlyView,
  isSupplyDemandZonesModuleView,
} from "@/lib/viewModuleKinds";
import {
  coerceViewMarkerBarIndex,
  remapViewMarkersBarIndexForWindow,
} from "@/lib/viewDemoObdobiSlice";
import {
  HL_TREND_STATE_COLORS,
  lineDataHasTrendState,
  groupIndexedTrendSegments,
} from "@/lib/viewChartLines";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp } from "@/components/backtestFieldMeta";
import { ViewLikeChart } from "@/components/charts/ViewLikeChart";
import { DEFAULT_VISIBILITY, type VisibilityKey } from "@/components/charts/viewLikeChartSpec";

/** Musí odpovídat backend ``PRECOMPUTE_TF_LADDER`` (pořadí od hrubého k jemnému; bez 30m). */
const ARTIFACT_PRECOMPUTE_TF_OPTIONS = ["1M", "1w", "1d", "4h", "1h"] as const;

/** Sladěno s ``buildArtifactsStreaming`` / proxy (48 h) — časový dolní odhad průběhu. */
const ARTIFACT_BUILD_CLIENT_MAX_SEC = 48 * 3600;

function formatArtifactBuildElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ViewMarker = { date: string; type: string; value: number | null; bar_index?: number | string };

function formatMarkerValueCell(v: unknown): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function toModuleName(name: string): string {
  return (name || "module").replace(/\s+/g, "_").replace(/-/g, "_").replace(/\./g, "_") || "module";
}

function parseViewDependencies(code: string): string[] {
  const m = code.match(/#\s*VIEW_DEPENDENCIES:\s*(.+)/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Mapuje date_start / date_end zóny na indexy svíček v aktuálním okně OHLC.
 * Na rozdíl od mapMarkerToIndex funguje i když začátek leží před první viditelnou svíčkou
 * (BOS od swingu mimo okno) — úsek ořízne na [0, n−1].
 */
function zoneEndpointsToBarIndices(
  z: Pick<ViewZone, "date_start" | "date_end">,
  ohlc: OhlcBar[],
  n: number
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

/** Po slice(startIdx) drží bar indexy relativní k oknu (0…len−1). */
function remapViewZonesToWindow(zones: ViewZone[], startIdx: number, windowLen: number): ViewZone[] {
  if (startIdx === 0 || windowLen < 1) return zones;
  return zones.map((z) => {
    const copy: ViewZone = { ...z };
    if (typeof z.touch_bar_index === "number" && Number.isFinite(z.touch_bar_index)) {
      const ri = Math.round(z.touch_bar_index - startIdx);
      if (ri < 0 || ri >= windowLen) {
        copy.has_touch = false;
        delete copy.touch_bar_index;
      } else {
        copy.touch_bar_index = ri;
      }
    }
    if (z.inducements?.length) {
      copy.inducements = z.inducements
        .map((ind) => {
          if (typeof ind.index !== "number" || Number.isNaN(ind.index)) return ind;
          const ni = ind.index - startIdx;
          if (ni < 0 || ni >= windowLen) return null;
          return { ...ind, index: ni } as ViewInducement;
        })
        .filter((x): x is ViewInducement => x != null);
    }
    return copy;
  });
}

/**
 * View demo: API počítá na celé sérii (years=0), graf zúžíme na posledních N svíček jako u Shuffle — jen tail bez náhodného posunu.
 */
function applyViewDemoObdobiSlice(
  fullOhlc: OhlcBar[],
  fullMarkers: ViewMarker[],
  fullLines: ViewLine[],
  fullZones: ViewZone[],
  yearsSelected: number,
  chartTimeframe: string,
  nativeTf: string | undefined | null
): { ohlc: OhlcBar[]; markers: ViewMarker[]; lines: ViewLine[]; zones: ViewZone[] } {
  if (fullOhlc.length < 2) {
    return { ohlc: fullOhlc, markers: fullMarkers, lines: fullLines, zones: fullZones };
  }
  const windowBars = shuffleWindowBarCount(
    fullOhlc.length,
    yearsSelected,
    chartTimeframe,
    nativeTf
  );
  if (windowBars >= fullOhlc.length) {
    return { ohlc: fullOhlc, markers: fullMarkers, lines: fullLines, zones: fullZones };
  }
  const startIdx = fullOhlc.length - windowBars;
  const windowOhlc = fullOhlc.slice(startIdx);
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

  const markersInWindow = fullMarkers.filter((m) => {
    const gi = coerceViewMarkerBarIndex(m.bar_index);
    if (gi !== null) {
      return gi >= startIdx && gi < fullOhlc.length;
    }
    return inRange(m.date);
  });
  const markers = remapViewMarkersBarIndexForWindow(markersInWindow, startIdx, windowOhlc.length, windowOhlc);
  const lines = fullLines
    .map((line) => {
      if (isViewRegimeHistogramLine(line)) {
        const data = (line.data ?? []).filter((p) => inRange(p.date));
        return data.length ? { ...line, data } : null;
      }
      const data = (line.data ?? []).filter((p) => inRange(p.date));
      return data.length ? { ...line, data } : null;
    })
    .filter((line): line is ViewLine => line != null);
  const zonesInWindow = fullZones.filter((z) => {
    const zStart = Date.parse(z.date_start);
    const zEnd = Date.parse(z.date_end);
    if (Number.isFinite(zStart) && Number.isFinite(zEnd) && Number.isFinite(startTime) && Number.isFinite(endTime)) {
      return (
        (zStart >= startTime && zStart <= endTime) ||
        (zEnd >= startTime && zEnd <= endTime) ||
        (zStart <= startTime && zEnd >= endTime)
      );
    }
    const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
    const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
    return (
      (z.date_start.slice(0, 10) >= startDate && z.date_start.slice(0, 10) <= endDate) ||
      (z.date_end.slice(0, 10) >= startDate && z.date_end.slice(0, 10) <= endDate) ||
      (z.date_start.slice(0, 10) <= startDate && z.date_end.slice(0, 10) >= endDate)
    );
  });
  return {
    ohlc: windowOhlc,
    markers,
    lines,
    zones: remapViewZonesToWindow(zonesInWindow, startIdx, windowOhlc.length),
  };
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

// VisibilityKey + DEFAULT_VISIBILITY moved to shared View-like chart spec (to reuse in S/D results).

/** Období zobrazení na grafu: Max → nejužší okno (řazeno od celé řady dolů k 1 měsíci). */
const VIEW_DISPLAY_PERIODS = [
  { label: "Max", years: 0 },
  { label: "5Y", years: 5 },
  { label: "4Y", years: 4 },
  { label: "3Y", years: 3 },
  { label: "2Y", years: 2 },
  { label: "1Y", years: 1 },
  { label: "6M", years: 0.5 },
  { label: "3M", years: 0.25 },
  { label: "1M", years: 0.083 },
] as const;

/** Výchozí View: 6M, denní svíčky (když TF v žebříku není — např. nativně denní data — efekt přepne na native). */
const VIEW_DEFAULT_DISPLAY_YEARS = 0.5;
const VIEW_DEFAULT_CHART_TIMEFRAME = "1D";

function pickViewDefaultDataFile(
  list: DataInstrument[],
  preferredFile: string | undefined
): string {
  if (preferredFile && list.some((i) => i.file === preferredFile)) return preferredFile;
  const nq = list.find((i) => String(i.instrument ?? "").trim().toUpperCase() === "NQ");
  if (nq) return nq.file;
  return list[0]?.file ?? "";
}

function artifactOverallBadgeClass(overall: string | undefined): string {
  switch (overall) {
    case "fresh":
      return "bg-emerald-950/60 text-emerald-200/95 border-emerald-700/45";
    case "missing_hl":
    case "missing_sd":
      return "bg-amber-950/50 text-amber-100/90 border-amber-600/40";
    case "stale_data":
    case "stale_code":
      return "bg-orange-950/55 text-orange-100/90 border-orange-600/40";
    case "error":
      return "bg-rose-950/50 text-rose-100/90 border-rose-600/40";
    default:
      return "bg-zinc-800/80 text-zinc-400 border-zinc-600/50";
  }
}

/** Mapování stavu jedné vrstvy (hl/sd) na „overall“ klíč pro barvy badge. */
function artifactLayerStateToPseudoOverall(
  kind: "hl" | "sd",
  state: string | undefined
): string {
  switch (state) {
    case "fresh":
      return "fresh";
    case "missing":
      return kind === "sd" ? "missing_sd" : "missing_hl";
    case "stale_data":
    case "stale_code":
      return state;
    case "error":
      return "error";
    default:
      return "";
  }
}

function artifactLayerBadgeLabel(kind: "hl" | "sd", state: string | undefined): string {
  const prefix = kind === "hl" ? "H/L" : "S/D";
  switch (state) {
    case "fresh":
      return `${prefix}: Fresh`;
    case "missing":
      return `${prefix}: chybí`;
    case "stale_data":
      return `${prefix}: stale (data)`;
    case "stale_code":
      return `${prefix}: stale (code)`;
    case "error":
      return `${prefix}: chyba`;
    default:
      return `${prefix}: —`;
  }
}

function isViewDemoDataFile(file: string): boolean {
  const f = (file || "").toLowerCase().replace(/\\/g, "/");
  return f.includes("nq_view_demo") || f.includes("view_demo");
}

type ViewItemType = "module" | "indicator" | "strategy";

interface StrategyViewChartProps {
  instruments: DataInstrument[];
  modules: FirestoreItem[];
  indicators: FirestoreItem[];
  strategies: FirestoreItem[];
  /** Výchozí data_file po mountu, pokud je v katalogu instrumentů. */
  defaultDataFile?: string;
  initialItemId?: string;
  initialItemType?: ViewItemType;
  height?: number;
  /** When the editor has a strategy file open, pass its source to seed S/D `timeframe` from PARAMS.zone_timeframes. */
  strategyZoneSyncCode?: string | null;
}

export function StrategyViewChart({
  instruments,
  modules,
  indicators,
  strategies,
  defaultDataFile,
  initialItemId,
  initialItemType,
  height = 960,
  strategyZoneSyncCode = null,
}: StrategyViewChartProps) {
  const [ohlc, setOhlc] = useState<OhlcBar[]>([]);
  const [markers, setMarkers] = useState<ViewMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataFile, setDataFile] = useState("");

  useEffect(() => {
    if (instruments.length === 0) return;
    setDataFile((prev) => {
      if (prev && instruments.some((i) => i.file === prev)) return prev;
      return pickViewDefaultDataFile(instruments, defaultDataFile);
    });
  }, [instruments, defaultDataFile]);
  const [years, setYears] = useState(VIEW_DEFAULT_DISPLAY_YEARS);
  /** Candle bar size for chart + module OHLC: native = instrument resolution; else server-side resample */
  const [chartTimeframe, setChartTimeframe] = useState<string>(VIEW_DEFAULT_CHART_TIMEFRAME);
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
  const selectedItemLabel = useMemo(() => {
    if (!selectedItemId) return null;
    if (selectedItemType === "module") return modules.find((m) => m.id === selectedItemId)?.name ?? null;
    if (selectedItemType === "indicator") return indicators.find((m) => m.id === selectedItemId)?.name ?? null;
    if (selectedItemType === "strategy") return strategies.find((m) => m.id === selectedItemId)?.name ?? null;
    return null;
  }, [selectedItemId, selectedItemType, modules, indicators, strategies]);

  const [viewParamsSchema, setViewParamsSchema] = useState<StrategyParams>({});
  const [viewParamsMeta, setViewParamsMeta] = useState<StrategyParamsMeta>({});
  const [viewParamsValues, setViewParamsValues] = useState<StrategyParams>({});
  const [paramsDrawerOpen, setParamsDrawerOpen] = useState(false);
  const [visibilityPanelOpen, setVisibilityPanelOpen] = useState(false);
  const [valuesModalOpen, setValuesModalOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<VisibilityKey, boolean>>(() => ({ ...DEFAULT_VISIBILITY }));
  /** Fáze 5: načíst H/L + S/D z backendu .backtest_artifacts místo view_engine. */
  const [useArtifactLayer, setUseArtifactLayer] = useState(false);
  const [artifactBanner, setArtifactBanner] = useState<string | null>(null);
  /** Fáze 6: stav cache + build */
  const [artifactStatus, setArtifactStatus] = useState<ArtifactStatusResponse | null>(null);
  const [artifactStatusLoading, setArtifactStatusLoading] = useState(false);
  const [artifactBuilding, setArtifactBuilding] = useState(false);
  const [artifactBuildError, setArtifactBuildError] = useState<string | null>(null);
  const [artifactBuildProgressPct, setArtifactBuildProgressPct] = useState(0);
  const [artifactBuildPhaseLabel, setArtifactBuildPhaseLabel] = useState("");
  const [artifactBuildPulseCount, setArtifactBuildPulseCount] = useState(0);
  const [artifactBuildLastServerEventAt, setArtifactBuildLastServerEventAt] = useState<number>(0);
  const [artifactBuildRecentEvents, setArtifactBuildRecentEvents] = useState<
    { at: number; phase: string; message: string; pct?: number }[]
  >([]);
  /** Nutné kvůli odvozenému uběhu času i při throttlingu záložky (interval + Date.now). */
  const [artifactBuildUiPulse, setArtifactBuildUiPulse] = useState(0);
  const artifactBuildWallT0Ref = useRef<number>(0);
  /** Čas posledního serverového `pct` — mezi milníky jemně přidáme creep (jeden TF může trvat dlouho). */
  const artifactBuildLastServerPctAtRef = useRef<number>(0);
  const [artifactBuildTimeframes, setArtifactBuildTimeframes] = useState<string[]>(() => [
    ...ARTIFACT_PRECOMPUTE_TF_OPTIONS,
  ]);
  /** Co spustit v POST /api/artifacts/build — výběr uživatele (ne podle modulu ve View). */
  const [artifactBuildIncludeHl, setArtifactBuildIncludeHl] = useState(true);
  const [artifactBuildIncludeSd, setArtifactBuildIncludeSd] = useState(true);
  const viewParamsRef = useRef<StrategyParams>({});
  /** Poslední úspěšně načtený main.py pro View (pro badge artefaktů podle typu modulu). */
  const [viewMainPyCode, setViewMainPyCode] = useState<string | null>(null);
  /** Zvyšuje se při každém novém fetchi; starší async odpověď nesmí přepsat stav (Strict Mode / rychlé přepnutí modulu). */
  const viewRequestGenRef = useRef(0);
  /** Plotly někdy neaplikuje layout.shapes při prvním vykreslení; změna revision vynutí Plotly.react. */
  const [plotRevision, setPlotRevision] = useState(0);
  useEffect(() => {
    viewParamsRef.current = viewParamsValues;
  }, [viewParamsValues]);

  const valuesCounts = useMemo(() => {
    const zonesAny = zones ?? [];
    const markersAny = (markers as any[]) ?? [];
    const linesAny = lines ?? [];

    const dsZones = zonesAny.filter((z: any) => z?.name === "Demand" || z?.name === "Supply");
    const bosZones = zonesAny.filter((z: any) => String(z?.name ?? "").toLowerCase().startsWith("bos"));
    const touches = zonesAny.filter((z: any) => Boolean(z?.has_touch) || typeof z?.touch_bar_index === "number");
    const inducementPoints = zonesAny.reduce((s: number, z: any) => s + ((z?.inducements?.length as number | undefined) ?? 0), 0);

    const swingMarkers = markersAny.filter((m: any) => ["high", "low"].includes(String(m?.type)));
    const majorMarkers = markersAny.filter((m: any) => ["major_high", "major_low"].includes(String(m?.type)));
    const internalMarkers = markersAny.filter((m: any) => ["internal_high", "internal_low"].includes(String(m?.type)));
    const bosMarkers = markersAny.filter((m: any) => ["bos_bullish", "bos_bearish"].includes(String(m?.type)));

    const linePointCount = linesAny.reduce((s: number, l: any) => s + (((l?.data as any[])?.length as number | undefined) ?? 0), 0);

    return {
      zones_total: zonesAny.length,
      zones_ds: dsZones.length,
      zones_bos: bosZones.length,
      touches: touches.length,
      inducement_points: inducementPoints,
      markers_total: markersAny.length,
      markers_swing: swingMarkers.length,
      markers_major: majorMarkers.length,
      markers_internal: internalMarkers.length,
      markers_bos: bosMarkers.length,
      lines_total: linesAny.length,
      line_points: linePointCount,
    };
  }, [lines, markers, zones]);

  const selectedInstrument = useMemo((): DataInstrument | undefined => {
    const found = instruments.find((i) => i.file === dataFile);
    if (found) return found;
    if (isViewDemoDataFile(dataFile)) {
      return {
        instrument: "NQ",
        displayName: "Nasdaq-100 E-mini — View demo (2025)",
        timeframe: "30m",
        file: dataFile,
        minDate: "2025-01-01",
        maxDate: "2025-12-31",
        yearsAvailable: 1,
        instrumentType: "futures",
        viewDemo: true,
      };
    }
    return undefined;
  }, [instruments, dataFile]);

  useEffect(() => {
    if (!selectedInstrument) return;
    const cap = selectedInstrument.yearsAvailable;
    setYears((y) => {
      if (y <= 0) return y;
      if (cap > 0 && y > cap) return cap;
      return y;
    });
  }, [selectedInstrument?.file, selectedInstrument?.yearsAvailable]);

  const chartTfOptions = useMemo(
    () => buildViewChartTimeframeOptionsCoarseFirst(selectedInstrument?.timeframe),
    [selectedInstrument?.timeframe]
  );

  const needsDemoStyleClientSlice = useMemo(() => {
    return (
      selectedInstrument?.viewDemo === true ||
      (dataFile.length > 0 && isViewDemoDataFile(dataFile))
    );
  }, [selectedInstrument?.viewDemo, dataFile]);

  const viewDataSourceHint = useMemo(() => {
    if (useArtifactLayer) {
      return "Zdroj vrstev: předpočtené artefakty (H/L + S/D z .backtest_artifacts, pokud jsou k dispozici a fresh). OHLC a tělo požadavku stále připraví API; při chybějících nebo zastaralých vrstvách může server část dopočítat.";
    }
    return "Zdroj: živý výpočet na serveru — modul nad načtenými daty bez vrstev z Parquet cache (pokud nejsou zapnuté artefakty).";
  }, [useArtifactLayer]);

  const toggleArtifactBuildTf = useCallback((tf: string) => {
    setArtifactBuildTimeframes((prev: string[]) => {
      const nextHas = new Set(prev);
      if (nextHas.has(tf)) nextHas.delete(tf);
      else nextHas.add(tf);
      if (nextHas.size === 0) return prev;
      return ARTIFACT_PRECOMPUTE_TF_OPTIONS.filter((o) => nextHas.has(o));
    });
  }, []);

  const selectAllArtifactBuildTfs = useCallback(() => {
    setArtifactBuildTimeframes([...ARTIFACT_PRECOMPUTE_TF_OPTIONS]);
  }, []);

  const refreshArtifactStatus = useCallback(async () => {
    if (!dataFile) return;
    setArtifactStatusLoading(true);
    try {
      const st = await getArtifactStatus(dataFile, 0, null);
      setArtifactStatus(st);
    } catch (e) {
      setArtifactStatus({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        overall: "error",
        overall_label: "Error",
      });
    } finally {
      setArtifactStatusLoading(false);
    }
  }, [dataFile]);

  useEffect(() => {
    void refreshArtifactStatus();
  }, [refreshArtifactStatus]);

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

  useEffect(() => {
    setViewMainPyCode(null);
  }, [selectedItemId, selectedItemType]);

  const fetchData = useCallback(async () => {
    const gen = ++viewRequestGenRef.current;
    setLoading(true);
    setError(null);
    if (!dataFile) {
      setLoading(false);
      return;
    }
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
          const inv = selectedInstrument;
          if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
            merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (
            inv &&
            "timeframe" in schema &&
            "data_timeframe" in schema &&
            !strategyZoneSyncCode
          ) {
            merged["timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          const seedTf = strategyZoneSyncCode ? coarsestZoneTfFromStrategyCode(strategyZoneSyncCode) : null;
          if (seedTf && "timeframe" in merged && strategyZoneSyncCode) {
            merged["timeframe"] = seedTf;
          }
          const current = viewParamsRef.current;
          for (const k of Object.keys(current)) {
            if (k in schema) merged[k] = current[k];
          }
          // Po merge UI hodnot musí znovu vyhrát rozlišení svíček grafu — jinak zůstane např. 4h v refi
          // při native 30m a Swing HL vrátí prázdné swingy / zóny.
          if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
            merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (
            inv &&
            "timeframe" in schema &&
            "data_timeframe" in schema &&
            !strategyZoneSyncCode
          ) {
            merged["timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (seedTf && "timeframe" in merged && strategyZoneSyncCode) {
            merged["timeframe"] = seedTf;
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
      const effectiveYears = needsDemoStyleClientSlice ? 0 : years;
      const selMod =
        selectedItemType === "module" && selectedItemId
          ? modules.find((m) => m.id === selectedItemId)
          : null;
      const sdZonesOnlyView = isSupplyDemandZonesModuleView(code, selMod?.name);
      const res = await getViewData(
        dataFile,
        effectiveYears,
        code,
        paramsToSend,
        moduleDeps,
        chartTimeframe,
        null,
        useArtifactLayer
          ? {
              useArtifacts: true,
              artifactIncludeHl: !sdZonesOnlyView,
            }
          : undefined
      );
      if (gen !== viewRequestGenRef.current) return;
      setViewMainPyCode(code);
      setArtifactBanner(useArtifactLayer ? (res.artifact_banner ?? null) : null);
      let nextOhlc = res.ohlc;
      let nextMarkers = res.markers ?? [];
      let nextLines = res.lines ?? [];
      let nextZones = res.zones ?? [];
      if (sdZonesOnlyView) {
        nextMarkers = [];
        nextLines = [];
        nextZones = filterZonesForSdZonesOnlyView(nextZones);
      }
      if (needsDemoStyleClientSlice && years > 0) {
        const fromApiCount = nextMarkers.length;
        const sliced = applyViewDemoObdobiSlice(
          nextOhlc,
          nextMarkers,
          nextLines,
          nextZones,
          years,
          chartTimeframe,
          selectedInstrument?.timeframe
        );
        nextOhlc = sliced.ohlc;
        nextMarkers = sliced.markers;
        nextLines = sliced.lines;
        nextZones = sliced.zones;
        if (process.env.NODE_ENV === "development") {
          console.debug("[view] markers tail slice", {
            useArtifacts: useArtifactLayer,
            fromApi: fromApiCount,
            afterSlice: nextMarkers.length,
            ohlcBars: nextOhlc.length,
          });
        }
      }
      setOhlc(nextOhlc);
      setMarkers(nextMarkers);
      setLines(nextLines);
      setZones(nextZones);
      setPlotRevision((r) => r + 1);
    } catch (e) {
      if (gen !== viewRequestGenRef.current) return;
      setViewMainPyCode(null);
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
    selectedInstrument,
    modules,
    strategyZoneSyncCode,
    useArtifactLayer,
    needsDemoStyleClientSlice,
  ]);

  useEffect(() => {
    if (!artifactBuilding) return;
    const id = window.setInterval(() => setArtifactBuildUiPulse((x) => x + 1), 400);
    return () => window.clearInterval(id);
  }, [artifactBuilding]);

  const artifactBuildElapsedSec = artifactBuilding
    ? Math.max(0, Math.floor((Date.now() - artifactBuildWallT0Ref.current) / 1000))
    : 0;

  const artifactBuildLastServerEventAgeSec = artifactBuilding
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - (artifactBuildLastServerEventAt || artifactBuildWallT0Ref.current)) / 1000
        )
      )
    : 0;

  const artifactBuildDisplayPct = useMemo(() => {
    if (!artifactBuilding) return 0;
    const sinceSec = Math.max(0, (Date.now() - artifactBuildLastServerPctAtRef.current) / 1000);
    // +1 % cca každých 75 s od posledního serverového milníku, max. +8 % (vnitř jednoho TF / tiché fáze).
    const creep = Math.min(8, sinceSec / 75);
    const blended = artifactBuildProgressPct + creep;
    const timeSynth = Math.min(
      94,
      1 + (artifactBuildElapsedSec / ARTIFACT_BUILD_CLIENT_MAX_SEC) * 93
    );
    // Starý max(server, timeSynth) při dlouhém běhu a serveru na 8 % dával jen 8 % po hodiny (48h okno).
    return Math.round(Math.min(94, Math.max(blended, timeSynth)) * 10) / 10;
  }, [artifactBuilding, artifactBuildElapsedSec, artifactBuildProgressPct, artifactBuildUiPulse]);

  const artifactBuildButtonLabel = useMemo(() => {
    if (artifactBuildIncludeHl && artifactBuildIncludeSd) return "Build features";
    if (artifactBuildIncludeHl) return "Build H/L";
    return "Build S/D";
  }, [artifactBuildIncludeHl, artifactBuildIncludeSd]);

  const artifactBuildButtonTitle = useMemo(() => {
    const fileHint = dataFile ? `Dataset = aktuální instrument (${dataFile}). ` : "";
    if (artifactBuildIncludeHl && artifactBuildIncludeSd) {
      return (
        fileHint +
        "Precompute H/L a S/D na celý soubor; TF níže. Výstup do .backtest_artifacts. Období ve View jen zobrazení."
      );
    }
    if (artifactBuildIncludeHl) {
      return fileHint + "Jen H/L (swingy, BOS, trend). S/D Parquet se nemění. TF níže platí pro H/L.";
    }
    return (
      fileHint +
      "Jen S/D zóny z repozitářového examples/sd_zones — H/L se přeskakuje; musí existovat platný H/L artefakt. TF níže platí pro S/D."
    );
  }, [dataFile, artifactBuildIncludeHl, artifactBuildIncludeSd]);

  const handleBuildArtifacts = useCallback(async () => {
    if (!dataFile) return;
    if (!artifactBuildIncludeHl && !artifactBuildIncludeSd) {
      setArtifactBuildError("Vyber aspoň jednu vrstvu (H/L nebo S/D).");
      return;
    }
    artifactBuildWallT0Ref.current = Date.now();
    artifactBuildLastServerPctAtRef.current = Date.now();
    setArtifactBuilding(true);
    setArtifactBuildError(null);
    setArtifactBuildProgressPct(1);
    setArtifactBuildPhaseLabel(
      artifactBuildIncludeHl && artifactBuildIncludeSd
        ? "Navazuji spojení (H/L + S/D)…"
        : artifactBuildIncludeHl
          ? "Navazuji spojení (jen H/L)…"
          : "Navazuji spojení (jen S/D)…"
    );
    setArtifactBuildPulseCount(0);
    setArtifactBuildLastServerEventAt(Date.now());
    setArtifactBuildRecentEvents([]);

    try {
      await buildArtifactsStreaming(
        dataFile,
        {
          years: 0,
          precomputeTimeframes:
            artifactBuildTimeframes.length > 0 &&
            artifactBuildTimeframes.length < ARTIFACT_PRECOMPUTE_TF_OPTIONS.length
              ? artifactBuildTimeframes
              : undefined,
          skipHl: !artifactBuildIncludeHl,
          skipSd: !artifactBuildIncludeSd,
        },
        (ev: ArtifactBuildStreamEvent) => {
          if (ev.type !== "phase") return;
          flushSync(() => {
            const now = Date.now();
            setArtifactBuildLastServerEventAt(now);
            setArtifactBuildRecentEvents((prev) => {
              const msg = (ev.message || ev.phase || "").trim();
              const item = {
                at: now,
                phase: ev.phase || "phase",
                message: msg || "(bez zprávy)",
                pct: typeof ev.pct === "number" ? ev.pct : undefined,
              };
              const next = [...prev, item];
              return next.length > 18 ? next.slice(next.length - 18) : next;
            });
            // Pulz nesmí přepsat konkrétní fázi (např. „H/L · 30m (6/6) — výpočet…“).
            if (ev.phase !== "pulse") {
              if (ev.message) setArtifactBuildPhaseLabel(ev.message);
              else if (ev.phase) setArtifactBuildPhaseLabel(ev.phase);
            } else {
              setArtifactBuildPulseCount((x) => x + 1);
            }
            if (typeof ev.pct === "number") {
              artifactBuildLastServerPctAtRef.current = Date.now();
              setArtifactBuildProgressPct(ev.pct);
            }
          });
        }
      );
      await refreshArtifactStatus();
      if (useArtifactLayer) {
        await fetchData();
      }
    } catch (e) {
      setArtifactBuildError(e instanceof Error ? e.message : String(e));
    } finally {
      setArtifactBuilding(false);
      setArtifactBuildProgressPct(0);
      setArtifactBuildPhaseLabel("");
    }
  }, [
    dataFile,
    artifactBuildTimeframes,
    artifactBuildIncludeHl,
    artifactBuildIncludeSd,
    refreshArtifactStatus,
    useArtifactLayer,
    fetchData,
  ]);

  const handleShuffle = useCallback(async () => {
    const gen = ++viewRequestGenRef.current;
    setLoading(true);
    setError(null);
    if (!dataFile) {
      setLoading(false);
      return;
    }
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
          const inv = selectedInstrument;
          if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
            merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (
            inv &&
            "timeframe" in schema &&
            "data_timeframe" in schema &&
            !strategyZoneSyncCode
          ) {
            merged["timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          const seedTfShuffle = strategyZoneSyncCode
            ? coarsestZoneTfFromStrategyCode(strategyZoneSyncCode)
            : null;
          if (seedTfShuffle && "timeframe" in merged && strategyZoneSyncCode) {
            merged["timeframe"] = seedTfShuffle;
          }
          const current = viewParamsRef.current;
          for (const k of Object.keys(current)) {
            if (k in schema) merged[k] = current[k];
          }
          if (inv && ("timeframe" in schema || "data_timeframe" in schema)) {
            merged["data_timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (
            inv &&
            "timeframe" in schema &&
            "data_timeframe" in schema &&
            !strategyZoneSyncCode
          ) {
            merged["timeframe"] = effectiveViewDataTimeframe(chartTimeframe, inv.timeframe);
          }
          if (seedTfShuffle && "timeframe" in merged && strategyZoneSyncCode) {
            merged["timeframe"] = seedTfShuffle;
          }
          paramsToSend = Object.keys(merged).length > 0 ? merged : null;
        }
      }
      const depNames = code ? parseViewDependencies(code) : [];
      const moduleDeps =
        depNames.length > 0 ? await resolveModuleDependencies(depNames, modules) : undefined;
      // Na shuffle načti širší řez než jen „Období“ — jinak je fullLen ≈ šířka okna a posun je ~0–1 bar.
      // U 6M view načteme např. ~2× období (strop yearsAvailable / 12 let), pak náhodně vybereme okno šířky 6M.
      const capAvail = selectedInstrument?.yearsAvailable ?? 12;
      const shuffleLoadYears = needsDemoStyleClientSlice
        ? 0
        : years > 0
          ? Math.min(capAvail, 12, Math.max(years * 2.5, years + 0.75))
          : Math.min(capAvail, 10);
      const selModShuffle =
        selectedItemType === "module" && selectedItemId
          ? modules.find((m) => m.id === selectedItemId)
          : null;
      const sdZonesOnlyShuffle = isSupplyDemandZonesModuleView(code, selModShuffle?.name);
      const res = await getViewData(
        dataFile,
        shuffleLoadYears,
        code,
        paramsToSend,
        moduleDeps,
        chartTimeframe,
        null,
        useArtifactLayer
          ? { useArtifacts: true, artifactIncludeHl: !sdZonesOnlyShuffle }
          : undefined
      );
      if (gen !== viewRequestGenRef.current) return;
      setViewMainPyCode(code);
      setArtifactBanner(useArtifactLayer ? (res.artifact_banner ?? null) : null);
      const fullOhlc = res.ohlc;
      let fullMarkers = res.markers ?? [];
      let fullLines = res.lines ?? [];
      let fullZones = res.zones ?? [];
      if (sdZonesOnlyShuffle) {
        fullMarkers = [];
        fullLines = [];
        fullZones = filterZonesForSdZonesOnlyView(fullZones);
      }

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
      const SMART_SHUFFLE_ATTEMPTS = 15;
      let startIdx = 0;
      let windowOhlc = fullOhlc;

      for (let attempt = 0; attempt < SMART_SHUFFLE_ATTEMPTS; attempt++) {
        startIdx = maxStart === 0 ? 0 : Math.floor(Math.random() * (maxStart + 1));
        const endIdx = Math.min(startIdx + windowBars, fullOhlc.length);
        windowOhlc = fullOhlc.slice(startIdx, endIdx);
        const startTime = Date.parse(windowOhlc[0]?.date ?? "");
        const endTime = Date.parse(windowOhlc[windowOhlc.length - 1]?.date ?? "");

        const inRangeProbe = (d: string) => {
          const ts = Date.parse(d);
          if (Number.isFinite(ts) && Number.isFinite(startTime) && Number.isFinite(endTime)) {
            return ts >= startTime && ts <= endTime;
          }
          const ds = d.slice(0, 10);
          const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
          const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
          return ds >= startDate && ds <= endDate;
        };

        const mCount = fullMarkers.filter((m) => {
          const gi = coerceViewMarkerBarIndex(m.bar_index);
          if (gi !== null) {
            return gi >= startIdx && gi < endIdx;
          }
          return inRangeProbe(m.date);
        }).length;
        const zCount = fullZones.filter((z) => {
          const zStart = Date.parse(z.date_start);
          const zEnd = Date.parse(z.date_end);
          if (
            Number.isFinite(zStart) &&
            Number.isFinite(zEnd) &&
            Number.isFinite(startTime) &&
            Number.isFinite(endTime)
          ) {
            return (
              (zStart >= startTime && zStart <= endTime) ||
              (zEnd >= startTime && zEnd <= endTime) ||
              (zStart <= startTime && zEnd >= endTime)
            );
          }
          const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
          const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
          return (
            (z.date_start.slice(0, 10) >= startDate && z.date_start.slice(0, 10) <= endDate) ||
            (z.date_end.slice(0, 10) >= startDate && z.date_end.slice(0, 10) <= endDate) ||
            (z.date_start.slice(0, 10) <= startDate && z.date_end.slice(0, 10) >= endDate)
          );
        }).length;

        const hasContent = mCount > 0 || zCount > 0;
        const lastAttempt = attempt === SMART_SHUFFLE_ATTEMPTS - 1;
        if (hasContent || maxStart === 0 || lastAttempt) {
          break;
        }
      }

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
      setMarkers(
        remapViewMarkersBarIndexForWindow(
          fullMarkers.filter((m) => {
            const gi = coerceViewMarkerBarIndex(m.bar_index);
            if (gi !== null) {
              return gi >= startIdx && gi < fullOhlc.length;
            }
            return inRange(m.date);
          }),
          startIdx,
          windowOhlc.length,
          windowOhlc
        )
      );
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
      const zonesInWindow = fullZones.filter((z) => {
        const zStart = Date.parse(z.date_start);
        const zEnd = Date.parse(z.date_end);
        if (Number.isFinite(zStart) && Number.isFinite(zEnd) && Number.isFinite(startTime) && Number.isFinite(endTime)) {
          return (
            (zStart >= startTime && zStart <= endTime) ||
            (zEnd >= startTime && zEnd <= endTime) ||
            (zStart <= startTime && zEnd >= endTime)
          );
        }
        const startDate = windowOhlc[0]?.date?.slice(0, 10) ?? "";
        const endDate = windowOhlc[windowOhlc.length - 1]?.date?.slice(0, 10) ?? "";
        return (
          (z.date_start.slice(0, 10) >= startDate && z.date_start.slice(0, 10) <= endDate) ||
          (z.date_end.slice(0, 10) >= startDate && z.date_end.slice(0, 10) <= endDate) ||
          (z.date_start.slice(0, 10) <= startDate && z.date_end.slice(0, 10) >= endDate)
        );
      });
      setZones(remapViewZonesToWindow(zonesInWindow, startIdx, windowOhlc.length));
      setPlotRevision((r) => r + 1);
    } catch (e) {
      if (gen !== viewRequestGenRef.current) return;
      setViewMainPyCode(null);
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
    selectedInstrument,
    modules,
    strategyZoneSyncCode,
    useArtifactLayer,
    needsDemoStyleClientSlice,
  ]);

  const sdZonesOnlyViewForArtifactBadge = useMemo(
    () =>
      selectedItemType === "module" && viewMainPyCode
        ? isSupplyDemandZonesModuleView(viewMainPyCode, selectedItemLabel)
        : false,
    [selectedItemType, viewMainPyCode, selectedItemLabel]
  );

  const artifactDatasetBadge = useMemo(() => {
    if (!artifactStatus) {
      return {
        pseudoOverall: undefined as string | undefined,
        label: undefined as string | undefined,
        title: undefined as string | undefined,
      };
    }
    if (!artifactStatus.ok) {
      return {
        pseudoOverall: artifactStatus.overall,
        label: artifactStatus.overall_label ?? artifactStatus.overall,
        title: artifactStatus.error ?? undefined,
      };
    }
    const focusOverall =
      !useArtifactLayer || selectedItemType !== "module" || !viewMainPyCode;
    if (focusOverall) {
      return {
        pseudoOverall: artifactStatus.overall,
        label: artifactStatus.overall_label ?? artifactStatus.overall,
        title:
          [artifactStatus.hl?.detail, artifactStatus.sd?.detail].filter(Boolean).join(" · ") ||
          undefined,
      };
    }
    if (sdZonesOnlyViewForArtifactBadge) {
      const st = artifactStatus.sd?.state;
      return {
        pseudoOverall: artifactLayerStateToPseudoOverall("sd", st),
        label: artifactLayerBadgeLabel("sd", st),
        title:
          [
            artifactStatus.sd?.detail,
            artifactStatus.hl?.detail ? `H/L: ${artifactStatus.hl.detail}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      };
    }
    const st = artifactStatus.hl?.state;
    return {
      pseudoOverall: artifactLayerStateToPseudoOverall("hl", st),
      label: artifactLayerBadgeLabel("hl", st),
      title:
        [
          artifactStatus.hl?.detail,
          artifactStatus.sd?.detail ? `S/D: ${artifactStatus.sd.detail}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    };
  }, [
    artifactStatus,
    useArtifactLayer,
    selectedItemType,
    viewMainPyCode,
    sdZonesOnlyViewForArtifactBadge,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const inputClass = "px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm";

  // Chart rendering moved to shared `ViewLikeChart` to ensure identical visuals across View and S/D results.
  const highMarkers = useMemo(() => markers.filter((m) => m.type === "high"), [markers]);
  const lowMarkers = useMemo(() => markers.filter((m) => m.type === "low"), [markers]);
  const majorHighMarkers = useMemo(() => markers.filter((m) => m.type === "major_high"), [markers]);
  const majorLowMarkers = useMemo(() => markers.filter((m) => m.type === "major_low"), [markers]);
  const internalHighMarkers = useMemo(() => markers.filter((m) => m.type === "internal_high"), [markers]);
  const internalLowMarkers = useMemo(() => markers.filter((m) => m.type === "internal_low"), [markers]);
  const inducementPoints = useMemo(
    () => zones.flatMap((z) => z.inducements ?? []),
    [zones],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-end gap-3 pb-3 shrink-0 border-b border-zinc-800/60">
        <div className="min-w-[14rem] flex-1">
          <label className="text-xs text-zinc-500 block mb-1">Instrument</label>
          <select
            value={dataFile}
            onChange={(e) => setDataFile(e.target.value)}
            className={`${inputClass} w-full max-w-xl`}
            disabled={instruments.length === 0}
            title="Build features i běh modulu používají tento data_file. Pro shodu s backtestem zvol stejný soubor jako v Basic."
          >
            {instruments.map((i) => (
              <option key={i.file} value={i.file}>
                {i.instrument} — {i.displayName} ({i.timeframe})
              </option>
            ))}
          </select>
          {instruments.length === 0 ? (
            <p className="text-xs text-amber-400/90 mt-1 max-w-xl">
              Katalog je prázdný — zkontrolujte backend a složku <code className="text-zinc-400">data/</code>.
            </p>
          ) : null}
        </div>
        <div>
          <label
            className="text-xs text-zinc-500 block mb-1"
            title="Agregace OHLC na serveru. Pořadí od hrubších svíček k původnímu rozlišení souboru."
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
          <label
            className="text-xs text-zinc-500 block mb-1"
            title="Max = celá řada v souboru. Kratší = poslední roky/měsíce (server); u krátkého demo souboru může následovat ještě klientský ořez okna."
          >
            Období zobrazení
          </label>
          <select
            value={years}
            onChange={(e) => setYears(parseFloat(e.target.value))}
            className={inputClass}
          >
            {VIEW_DISPLAY_PERIODS.map((tf) => (
              <option key={tf.label} value={tf.years}>
                {tf.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[12rem]">
          <label className="text-xs text-zinc-500 block mb-1">Modul / indikátor / strategie</label>
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
            className={`${inputClass} w-full max-w-sm`}
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
        <div className="flex items-center gap-1 pb-0.5">
          <label
            className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none max-w-[13rem] leading-snug"
            title="Při zvoleném modulu S/D zón z cache jen zóny (bez swingů/BOS/trend z H/L). Badge Fresh u datasetu může platit z dřívějšího H/L buildu."
          >
            <input
              type="checkbox"
              className="rounded border-zinc-600 shrink-0"
              checked={useArtifactLayer}
              onChange={(e) => setUseArtifactLayer(e.target.checked)}
            />
            H/L + S/D z&nbsp;cache
          </label>
          <FieldHelpPopover help={backtestFieldHelp.artifactViewHlSdCache} />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <button
            onClick={fetchData}
            disabled={loading || !dataFile}
            className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-50"
          >
            {loading ? "Načítám..." : "Obnovit"}
          </button>
          <button
            onClick={handleShuffle}
            disabled={loading || years <= 0}
            title={
              years <= 0
                ? "Shuffle je vypnutý při období Max — zvolte kratší okno."
                : needsDemoStyleClientSlice
                  ? "Náhodný výřez stejné šířky jako období uvnitř načtené řady (demo: celý soubor na serveru, pak výřez)."
                  : "Širší načtení, výpočet modulu na delší historii, pak náhodné okno šířky zvoleného období (~15 pokusů s obsahem)."
            }
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

      <div className="flex flex-col gap-2 py-2 px-2 shrink-0 rounded-md border border-zinc-800/60 bg-zinc-900/35 mb-2">
        <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-violet-600/45 pl-2">
          <span className="text-zinc-300 font-medium">Zdroj vrstev: </span>
          {viewDataSourceHint}
          {useArtifactLayer && artifactBanner ? (
            <span className="text-amber-200/85"> — {artifactBanner}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500 shrink-0 inline-flex items-center gap-1">
            Artefakty (dataset)
            <FieldHelpPopover help={backtestFieldHelp.artifactViewDatasetStatus} />
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded border shrink-0 ${artifactOverallBadgeClass(
              artifactDatasetBadge.pseudoOverall ?? artifactStatus?.overall
            )}`}
            title={artifactDatasetBadge.title}
          >
            {artifactStatusLoading
              ? "Načítám stav…"
              : artifactBuilding
                ? "Building…"
                : artifactDatasetBadge.label ?? artifactStatus?.overall_label ?? artifactStatus?.overall ?? "—"}
          </span>
          {artifactStatus?.dataset_id ? (
            <code
              className="text-[10px] text-zinc-500 font-mono truncate max-w-[12rem]"
              title={artifactStatus.dataset_id}
            >
              {artifactStatus.dataset_id.slice(0, 14)}…
            </code>
          ) : null}
          <span className="inline-flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void handleBuildArtifacts()}
              disabled={
                artifactBuilding ||
                artifactStatusLoading ||
                !dataFile ||
                (!artifactBuildIncludeHl && !artifactBuildIncludeSd)
              }
              title={artifactBuildButtonTitle}
              className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-xs font-medium disabled:opacity-50"
            >
              {artifactBuilding ? "Build…" : artifactBuildButtonLabel}
            </button>
            <FieldHelpPopover help={backtestFieldHelp.artifactViewBuildFeatures} />
          </span>
          <button
            type="button"
            onClick={() => void refreshArtifactStatus()}
            disabled={artifactStatusLoading || artifactBuilding}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-400 disabled:opacity-50 shrink-0"
          >
            Obnovit stav
          </button>
          {artifactBuildError ? (
            <span className="text-xs text-rose-400 shrink-0 max-w-md truncate" title={artifactBuildError}>
              {artifactBuildError}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-0.5 border-t border-zinc-800/50 pt-2 mt-0.5">
          <span className="text-[10px] text-zinc-500 shrink-0">Kroky buildu (multiselect):</span>
          <label className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
              checked={artifactBuildIncludeHl}
              disabled={artifactBuilding || artifactStatusLoading}
              onChange={(e) => {
                const v = e.target.checked;
                if (!v && !artifactBuildIncludeSd) return;
                setArtifactBuildIncludeHl(v);
              }}
            />
            H/L
          </label>
          <label className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
              checked={artifactBuildIncludeSd}
              disabled={artifactBuilding || artifactStatusLoading}
              onChange={(e) => {
                const v = e.target.checked;
                if (!v && !artifactBuildIncludeHl) return;
                setArtifactBuildIncludeSd(v);
              }}
            />
            S/D zóny
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5 border-t border-zinc-800/40 pt-2 mt-0.5">
          <span className="text-[10px] text-zinc-500 shrink-0">
            TF precomputu
            {!artifactBuildIncludeHl && artifactBuildIncludeSd
              ? " (S/D)"
              : artifactBuildIncludeHl && !artifactBuildIncludeSd
                ? " (H/L)"
                : " (H/L + S/D)"}
            :
          </span>
          <button
            type="button"
            className="text-[10px] text-violet-400 hover:text-violet-300 disabled:opacity-50"
            onClick={selectAllArtifactBuildTfs}
            disabled={artifactBuilding || artifactStatusLoading}
          >
            Vše
          </button>
          {ARTIFACT_PRECOMPUTE_TF_OPTIONS.map((tf) => (
            <label
              key={tf}
              className="inline-flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                className="rounded border-zinc-600 bg-zinc-900"
                checked={artifactBuildTimeframes.includes(tf)}
                onChange={() => toggleArtifactBuildTf(tf)}
                disabled={artifactBuilding || artifactStatusLoading}
              />
              {tf}
            </label>
          ))}
        </div>
      </div>

      {artifactBuilding ? (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4">
          <div
            className="bg-zinc-900 border border-violet-800/45 rounded-xl shadow-2xl p-6 w-full max-w-md"
            role="dialog"
            aria-busy="true"
            aria-live="polite"
            aria-label="Probíhá build artefaktů"
          >
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">Build artefaktů</h3>
            <p className="text-[11px] text-zinc-500 font-mono mb-3 truncate" title={dataFile || ""}>
              {dataFile || "—"}
            </p>
            <div className="flex items-end justify-between gap-3 mb-4">
              <div
                className="text-5xl font-bold tabular-nums leading-none tracking-tight text-violet-300"
                title="Kombinace milníků ze serveru a časového odhadu (během H/L často dlouho žádná nová %) — viz popis níže."
              >
                {Math.min(100, Math.round(artifactBuildDisplayPct))}
                <span className="text-2xl font-semibold text-violet-400/90 align-top ml-0.5">%</span>
              </div>
              <div className="text-right text-[11px] text-zinc-500 tabular-nums pb-1">
                <div className="text-zinc-400">Uběhlo</div>
                <div className="text-sm text-zinc-300 font-mono">
                  {formatArtifactBuildElapsed(artifactBuildElapsedSec)}
                </div>
                <div className="mt-1">
                  <div className="text-zinc-400">Poslední zpráva ze serveru</div>
                  <div
                    className={`text-sm font-mono ${
                      artifactBuildLastServerEventAgeSec >= 90 ? "text-rose-300" : "text-zinc-300"
                    }`}
                    title="Čas od posledního SSE eventu. Pokud roste bez pulzů, může být spojení přerušené nebo server zaseknutý."
                  >
                    {artifactBuildLastServerEventAgeSec}s
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Pulzy: <span className="text-zinc-400 font-mono">{artifactBuildPulseCount}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-3 rounded-full bg-zinc-800 overflow-hidden mb-1 ring-1 ring-zinc-700/80">
              <div
                className="h-full bg-gradient-to-r from-violet-700 via-fuchsia-600 to-violet-500 transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(1, artifactBuildDisplayPct))}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 tabular-nums mb-3">
              <span>Milník ze serveru: {Math.round(artifactBuildProgressPct)}%</span>
              <span>Časový odhad (48 h): → 94%</span>
            </div>
            {artifactBuildLastServerEventAgeSec >= 180 ? (
              <div className="mb-3 px-3 py-2 rounded border border-rose-600/35 bg-rose-950/35 text-rose-200/90 text-[11px] leading-snug">
                Žádná zpráva ze serveru už <span className="font-mono">{artifactBuildLastServerEventAgeSec}s</span>. To
                obvykle znamená, že se proces zasekl (nebo spadlo SSE spojení). Zkontroluj backend log / případný lock
                a jestli stále běží uvicorn.
              </div>
            ) : null}
            <p className="text-sm text-violet-200/90 min-h-[2.75rem] leading-snug border-t border-zinc-800/80 pt-3">
              {artifactBuildPhaseLabel || "Navazuji stream…"}
            </p>
            {artifactBuildRecentEvents.length > 0 ? (
              <div className="mt-3 rounded-lg border border-zinc-800/70 bg-zinc-950/30">
                <div className="px-3 py-2 border-b border-zinc-800/70 flex items-center justify-between">
                  <div className="text-[10px] text-zinc-500">Timeline (poslední kroky)</div>
                  <div className="text-[10px] text-zinc-600 font-mono">
                    {artifactBuildRecentEvents.length} eventů
                  </div>
                </div>
                <div className="max-h-32 overflow-auto">
                  {artifactBuildRecentEvents
                    .slice()
                    .reverse()
                    .map((e, i) => {
                      const ageSec = Math.max(0, Math.floor((Date.now() - e.at) / 1000));
                      return (
                        <div
                          key={`${e.at}-${i}`}
                          className="px-3 py-1.5 border-t border-zinc-900/60 text-[11px] text-zinc-300 flex items-center gap-2"
                        >
                          <span className="text-zinc-500 font-mono w-10 shrink-0">{ageSec}s</span>
                          <span className="text-zinc-400 font-mono w-14 shrink-0">{e.phase}</span>
                          <span className="truncate flex-1" title={e.message}>
                            {e.message}
                          </span>
                          {typeof e.pct === "number" ? (
                            <span className="text-zinc-500 font-mono shrink-0">{Math.round(e.pct)}%</span>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : null}
            <p className="text-[10px] text-zinc-500 leading-snug mt-2">
              Server hlásí každý timeframe H/L a S/D (start + hotovo). 30m se v artefaktech nepočítá
              (žebříček do 1h); u 1h na velkém intraday souboru může krok trvat dlouho — očekávané. Velké číslo nahoře doplňuje drobný časový
              creep oproti „Milník ze serveru“. Zápis: <span className="font-mono text-zinc-400">.backtest_artifacts/</span>
              {" "}
              (kořen projektu, v <span className="font-mono text-zinc-400">.gitignore</span>) — podsložka pod{" "}
              <span className="font-mono text-zinc-400">dataset_id</span>, soubory{" "}
              <span className="font-mono text-zinc-400">hl/v1/*.parquet</span>,{" "}
              <span className="font-mono text-zinc-400">sd/v1/zones.parquet</span>. Kontrolní pulz každých ~12 s.
            </p>
          </div>
        </div>
      ) : null}

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
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-zinc-100">Hodnoty z algoritmu</h3>
                <div className="text-[11px] text-zinc-500 font-mono truncate">
                  Zóny {valuesCounts.zones_total} (D/S {valuesCounts.zones_ds}, BOS {valuesCounts.zones_bos}) · touches{" "}
                  {valuesCounts.touches} · IP {valuesCounts.inducement_points} · markery {valuesCounts.markers_total} (swing{" "}
                  {valuesCounts.markers_swing}, major {valuesCounts.markers_major}, internal {valuesCounts.markers_internal}, BOS{" "}
                  {valuesCounts.markers_bos}) · čáry {valuesCounts.lines_total} ({valuesCounts.line_points} bodů)
                </div>
              </div>
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
                            <td className="px-3 py-2 text-right text-zinc-200 font-mono">{formatMarkerValueCell(m.value)}</td>
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
                  hasData: highMarkers.length > 0 || lowMarkers.length > 0,
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
                  {meta?.booleanWidget && typeof value === "number" && (value === 0 || value === 1) ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value === 1}
                        onChange={(e) =>
                          setViewParamsValues((prev) => ({
                            ...prev,
                            [key]: e.target.checked ? 1 : 0,
                          }))
                        }
                        className="rounded"
                      />
                      <span className="text-sm text-zinc-300">{value === 1 ? "Zapnuto" : "Vypnuto"}</span>
                    </label>
                  ) : typeof value === "number" ? (
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

      {artifactBanner && (
        <div className="mb-3 px-3 py-2 rounded border border-amber-500/35 bg-amber-950/50 text-amber-100/90 text-sm shrink-0">
          {artifactBanner}
        </div>
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
            <ViewLikeChart
              ohlc={ohlc}
              markers={markers}
              lines={lines}
              zones={zones as any}
              height={height}
              visibility={visibility}
              revision={plotRevision}
            />
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
