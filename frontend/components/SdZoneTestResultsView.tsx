"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  getSdZoneSavedRunDocument,
  getSdZoneTagPresets,
  patchSdZoneSavedAnnotations,
  runSdZoneTestOrCached,
  saveSdZoneSavedRun,
  saveSdZoneTagPresets,
} from "@/lib/api";
import type {
  SdZoneTestResponse,
  SdZoneTestTrade,
  SdZoneTestRunBody,
  ViewLine,
  ViewZone,
} from "@/lib/api";
import { ViewLikeChart } from "@/components/charts/ViewLikeChart";
import { DEFAULT_VISIBILITY, type VisibilityKey } from "@/components/charts/viewLikeChartSpec";
import { remapViewMarkersBarIndexForWindow } from "@/lib/viewDemoObdobiSlice";
import { PriceContextChart } from "@/components/charts/PriceContextChart";
import { SdZoneJournalView } from "@/components/SdZoneJournalView";

function readJsonLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type Props = {
  result: SdZoneTestResponse;
  lastRequest: SdZoneTestRunBody | null;
  onRerunRequest: (req: SdZoneTestRunBody) => void;
  onResult: (res: SdZoneTestResponse) => void;
  onBack: () => void;
  savedRunId: string | null;
  onSavedRunId: (id: string | null) => void;
};

function tradeKey(t: SdZoneTestTrade, i: number): string {
  return `${t.zone_id ?? ""}-${t.entry_bar ?? ""}-${t.touch_index ?? ""}-${i}`;
}

function durationToMfeOrSlBars(t: SdZoneTestTrade): number | null {
  if (t.duration_to_mfe_or_sl_bars != null && Number.isFinite(Number(t.duration_to_mfe_or_sl_bars))) {
    return Math.max(0, Math.floor(Number(t.duration_to_mfe_or_sl_bars)));
  }
  const eb = t.entry_bar;
  if (eb == null || !Number.isFinite(Number(eb))) return null;
  const e = Math.floor(Number(eb));
  const mfeB = t.mfe_bar;
  const slB = t.sl_hit_bar;
  const mfe = mfeB != null && Number.isFinite(Number(mfeB)) ? Math.floor(Number(mfeB)) : null;
  const sl = slB != null && Number.isFinite(Number(slB)) ? Math.floor(Number(slB)) : null;
  if (mfe == null && sl == null) return null;
  const end = mfe == null ? sl! : sl == null ? mfe! : Math.min(mfe, sl);
  return Math.max(0, end - e);
}

function medianNums(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : ((s[m - 1]! + s[m]!) / 2);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function chartTfToSeconds(tf: string): number | null {
  const t = String(tf || "").trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (low === "30m") return 30 * 60;
  if (low === "1h") return 60 * 60;
  if (low === "4h") return 4 * 60 * 60;
  if (low === "1d" || low === "1d") return 24 * 60 * 60;
  if (low === "1w") return 7 * 24 * 60 * 60;
  if (low === "1mo" || low === "1m") return 30 * 24 * 60 * 60;
  return null;
}

const SD_ZONE_TF_OPTIONS = ["", "1h", "4h", "1d", "1w", "1M"] as const;
const CHART_TF_OPTIONS = ["native", "30m", "1h", "4h", "1D", "1W", "1Mo"] as const;
/** Min. výška oblasti grafu (px); statistiky pod ním pak scrollují v levém panelu. */
const MIN_CHART_AREA_PX = 420;

export function SdZoneTestResultsView({
  result,
  lastRequest,
  onRerunRequest,
  onResult,
  onBack,
  savedRunId,
  onSavedRunId,
}: Props) {
  const [mainTab, setMainTab] = useState<"backtest" | "journal">("backtest");
  /** Scroll viewport (graf + statistiky); výška grafu se odvíjí od něj, ne od Plotly — žádná RO zpětná vazba. */
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const [chartHeight, setChartHeight] = useState(MIN_CHART_AREA_PX);

  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    const compute = () => {
      const h = Math.floor(el.clientHeight);
      if (h < 1) return;
      setChartHeight(Math.max(MIN_CHART_AREA_PX, h - 12));
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0);
  // View-like layers
  const [viewVis, setViewVis] = useState<Record<VisibilityKey, boolean>>(() => ({ ...DEFAULT_VISIBILITY, lines: false }));
  // Trade overlay layers
  const [tradeVis, setTradeVis] = useState({
    zoneMeta: true,
    touchMarker: true,
    tradeLevels: true,
    // Cílový vizuál = primárně horizontální úrovně; svislé event čáry jsou jen volitelný debug.
    tradeBars: false,
    tradeLevelLabels: true,
  });

  // Table filters
  const [tfSelected, setTfSelected] = useState<string[]>([]);
  const [mfeMin, setMfeMin] = useState<number | null>(null);
  const [mfeMax, setMfeMax] = useState<number | null>(null);
  /** true = MFE musí být mezi min a max; false = MFE musí dosáhnout alespoň „rozsahu“ (viz inMfeRange). */
  const [mfeRangeStrict, setMfeRangeStrict] = useState(true);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [losersOnly, setLosersOnly] = useState(false);
  const [ge1, setGe1] = useState(false);
  const [ge15, setGe15] = useState(false);
  const [ge2, setGe2] = useState(false);
  const [ge3, setGe3] = useState(false);
  /** Konfigurace: zobrazit jen obchody s MFE ≥ R; statistiky se přepočítají na tuto podmnožinu. */
  const [configMinMfeR, setConfigMinMfeR] = useState<number | null>(null);
  const [statsTab, setStatsTab] = useState<"overview" | "r_multiple" | "sl" | "prop" | "zones">("overview");
  const [slTabSelected, setSlTabSelected] = useState<number | null>(null);
  const [propRiskPct, setPropRiskPct] = useState(1.0);
  /** Cílový zisk v % účtu na obchod (bank), pokud cena dosáhne této úrovně před SL. */
  const [propProfitTakePct, setPropProfitTakePct] = useState(1.5);
  const [propTargetPct, setPropTargetPct] = useState(8.0);
  const [propMaxDdPct, setPropMaxDdPct] = useState(5.0);
  const [propConsistencyPct, setPropConsistencyPct] = useState(50.0);
  const [propRuns, setPropRuns] = useState(300);
  const [propSeed, setPropSeed] = useState(1337);

  const slSweep = result.sl_sweep ?? null;
  const slSweepItems = useMemo(() => {
    const items = slSweep?.items ?? [];
    return items.filter((x) => Number.isFinite(Number(x.sl_mult)));
  }, [slSweep]);
  const slSweepBest = useMemo(() => {
    const b = slSweep?.best ?? null;
    return b && Number.isFinite(Number(b.sl_mult)) ? Number(b.sl_mult) : null;
  }, [slSweep]);

  useEffect(() => {
    if (!slSweepItems.length) return;
    const fallback = slSweepBest ?? slSweepItems[0]!.sl_mult;
    setSlTabSelected((prev) => (prev == null ? fallback : prev));
  }, [slSweepBest, slSweepItems]);

  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const [saveBacktestBusy, setSaveBacktestBusy] = useState(false);
  const [saveBacktestError, setSaveBacktestError] = useState<string | null>(null);

  const [annotationTags, setAnnotationTags] = useState<string[]>([]);
  const [tagPreset, setTagPreset] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [annotationComment, setAnnotationComment] = useState("");
  const [annotationLoadBusy, setAnnotationLoadBusy] = useState(false);
  const [annotationSaveBusy, setAnnotationSaveBusy] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);

  const currentChartTf = (lastRequest?.chart_timeframe ?? null) === null ? "native" : String(lastRequest?.chart_timeframe);
  const currentZoneTfs = useMemo(() => {
    const xs = (lastRequest as any)?.zone_timeframes as unknown;
    if (Array.isArray(xs)) return xs.map((x) => String(x)).filter((x) => x.trim());
    const z = String(lastRequest?.zone_timeframe ?? "").trim();
    return z ? [z] : [];
  }, [lastRequest]);

  const barSeconds = useMemo(() => {
    const secFixed = currentChartTf !== "native" ? chartTfToSeconds(currentChartTf) : null;
    if (secFixed != null && Number.isFinite(secFixed) && secFixed > 0) return secFixed;
    const ohlc = result.ohlc ?? [];
    if (ohlc.length < 3) return null;
    const diffs: number[] = [];
    for (let i = 1; i < Math.min(ohlc.length, 250); i++) {
      const a = Date.parse(String(ohlc[i - 1]?.date ?? ""));
      const b = Date.parse(String(ohlc[i]?.date ?? ""));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const d = Math.abs(b - a) / 1000;
      if (Number.isFinite(d) && d > 0) diffs.push(d);
    }
    const med = medianNums(diffs);
    return med != null && Number.isFinite(med) && med > 0 ? med : null;
  }, [currentChartTf, result.ohlc]);

  const doRerun = useCallback(
    async (patch: Partial<SdZoneTestRunBody>) => {
      if (!lastRequest) return;
      const next: SdZoneTestRunBody = { ...lastRequest, ...patch };
      // If user changes Zone TF, default candle TF to match it (unless they explicitly changed candles too).
      if ("zone_timeframe" in patch && !("chart_timeframe" in patch)) {
        const z = String(next.zone_timeframe ?? "").trim().toLowerCase();
        if (z === "1h" || z === "4h") next.chart_timeframe = z;
        else if (z === "1d") next.chart_timeframe = "1D";
        else if (z === "1w") next.chart_timeframe = "1W";
        else if (z === "1m") next.chart_timeframe = "1Mo";
      }
      onRerunRequest(next);
      setRerunBusy(true);
      setRerunError(null);
      try {
        const { result: res, savedRunId: sid } = await runSdZoneTestOrCached(next);
        onSavedRunId(sid);
        onResult(res);
      } catch (e) {
        setRerunError(e instanceof Error ? e.message : String(e));
      } finally {
        setRerunBusy(false);
      }
    },
    [lastRequest, onRerunRequest, onResult, onSavedRunId],
  );

  const trades = result.trades ?? [];
  const executed = useMemo(
    () =>
      trades
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => !t.skip),
    [trades]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byText = (row: { t: SdZoneTestTrade; i: number }) => {
      if (!q) return true;
      const { t } = row;
      const id = String(t.zone_id ?? "").toLowerCase();
      const nm = String(t.zone_name ?? "").toLowerCase();
      const tf = String(t.source_tf ?? "").toLowerCase();
      return id.includes(q) || nm.includes(q) || tf.includes(q);
    };
    const ohlc = result.ohlc ?? [];
    const getDate = (t: SdZoneTestTrade) => {
      const eb = typeof t.entry_bar === "number" ? t.entry_bar : Number(t.entry_bar);
      if (!Number.isFinite(eb)) return "";
      return ohlc[Math.max(0, Math.min(ohlc.length - 1, eb))]?.date ?? "";
    };
    const inDateRange = (t: SdZoneTestTrade) => {
      const d = getDate(t).slice(0, 10);
      if (!d) return true;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    };
    const inMfeRange = (t: SdZoneTestTrade) => {
      const hasMin = mfeMin != null && Number.isFinite(Number(mfeMin));
      const hasMax = mfeMax != null && Number.isFinite(Number(mfeMax));
      const v = t.mfe_R;
      if (v == null || !Number.isFinite(Number(v))) return !hasMin && !hasMax;
      const x = Number(v);
      if (!hasMin && !hasMax) return true;
      const lo = hasMin && hasMax ? Math.min(Number(mfeMin), Number(mfeMax)) : hasMin ? Number(mfeMin) : Number(mfeMax);
      const hi = hasMin && hasMax ? Math.max(Number(mfeMin), Number(mfeMax)) : hasMin ? Number(mfeMin) : Number(mfeMax);
      if (mfeRangeStrict) {
        if (hasMin && hasMax) return x >= lo && x <= hi;
        if (hasMin) return x >= Number(mfeMin);
        return x <= Number(mfeMax);
      }
      // „Alespoň rozmezí“: obchod dosáhl aspoň horní úrovně uvedeného pásma (oba vstupy → MFE ≥ max z nich).
      if (hasMin && hasMax) return x >= hi;
      if (hasMin) return x >= Number(mfeMin);
      return x >= Number(mfeMax);
    };
    const matchesTf = (t: SdZoneTestTrade) => {
      if (tfSelected.length === 0) return true;
      const tf = String(t.source_tf ?? "");
      return tfSelected.includes(tf);
    };
    const matchesWinLoss = (t: SdZoneTestTrade) => {
      const isWinnerComputed = t.is_winner != null;
      const isLoserByRule = isWinnerComputed ? t.is_winner === false : t.sl_hit_bar != null;
      if (losersOnly && !isLoserByRule) return false;
      const mfe = t.mfe_R != null ? Number(t.mfe_R) : null;
      if (ge1 && (mfe == null || mfe < 1)) return false;
      if (ge15 && (mfe == null || mfe < 1.5)) return false;
      if (ge2 && (mfe == null || mfe < 2)) return false;
      if (ge3 && (mfe == null || mfe < 3)) return false;
      return true;
    };
    const matchesConfigMinR = (t: SdZoneTestTrade) => {
      if (configMinMfeR == null || !Number.isFinite(configMinMfeR)) return true;
      const mfe = t.mfe_R != null ? Number(t.mfe_R) : null;
      if (mfe == null || !Number.isFinite(mfe)) return false;
      return mfe >= configMinMfeR;
    };
    return executed.filter(({ t, i }) => {
      return (
        byText({ t, i }) &&
        matchesTf(t) &&
        inMfeRange(t) &&
        inDateRange(t) &&
        matchesWinLoss(t) &&
        matchesConfigMinR(t)
      );
    });
  }, [
    executed,
    filter,
    tfSelected,
    mfeMin,
    mfeMax,
    mfeRangeStrict,
    dateFrom,
    dateTo,
    losersOnly,
    ge1,
    ge15,
    ge2,
    ge3,
    configMinMfeR,
    result.ohlc,
  ]);

  useEffect(() => {
    setSelectedIdx((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  const selected = filtered[selectedIdx]?.t ?? null;
  const selectedListIdx = filtered[selectedIdx]?.i ?? 0;
  const ohlcFull = result.ohlc ?? [];

  const selectedTradeId = selected ? tradeKey(selected, selectedListIdx) : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getSdZoneTagPresets();
        if (cancelled) return;
        const xs = Array.isArray(p.tags) ? p.tags : [];
        setTagPreset(xs.map((x) => String(x).trim()).filter((x) => x.length > 0));
      } catch {
        // Preset je volitelný; ignoruj chybu.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!savedRunId || !selected?.zone_id) {
      setAnnotationTags([]);
      setAnnotationComment("");
      setAnnotationLoadBusy(false);
      setAnnotationError(null);
      return;
    }
    let cancelled = false;
    setAnnotationLoadBusy(true);
    setAnnotationError(null);
    const tid = tradeKey(selected!, selectedListIdx);
    (async () => {
      try {
        const doc = await getSdZoneSavedRunDocument(savedRunId);
        if (cancelled) return;
        const anns = Object.values(doc.annotations ?? {});
        const ann = anns.find(
          (a) =>
            String(a.zone_id) === String(selected!.zone_id) &&
            String(a.source_tf ?? "") === String(selected!.source_tf ?? "") &&
            String(a.trade_id) === tid,
        );
        if (ann) {
          const tags = Array.isArray((ann as any).tags)
            ? (ann as any).tags.map((x: any) => String(x).trim()).filter((x: string) => x.length > 0)
            : [];
          if (tags.length > 0) {
            setAnnotationTags(tags);
          } else {
            // Legacy: derive from checked checkbox items
            const legacy = Array.isArray((ann as any).items) ? (ann as any).items : [];
            const derived = legacy
              .filter((x: any) => x && typeof x === "object" && Boolean(x.checked))
              .map((x: any) => String(x.label ?? "").trim())
              .filter((x: string) => x.length > 0);
            setAnnotationTags(Array.from(new Set(derived)));
          }
          setAnnotationComment(ann.comment ?? "");
        } else {
          setAnnotationTags(tagPreset);
          const legacyKey = `sdZoneNotes:v1:${result.dataset_id ?? "run"}`;
          const legacy = readJsonLocal<Record<string, string>>(legacyKey, {});
          setAnnotationComment(legacy[String(selected!.zone_id)] ?? "");
        }
      } catch (e) {
        if (!cancelled) setAnnotationError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAnnotationLoadBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedRunId, selected, selectedListIdx, result.dataset_id, tagPreset]);

  const handleSaveBacktest = useCallback(async () => {
    if (!lastRequest) return;
    setSaveBacktestError(null);
    setSaveBacktestBusy(true);
    try {
      const out = await saveSdZoneSavedRun(lastRequest, result);
      onSavedRunId(out.run_id);
    } catch (e) {
      setSaveBacktestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBacktestBusy(false);
    }
  }, [lastRequest, onSavedRunId, result]);

  const handleSaveAnnotation = useCallback(async () => {
    if (!savedRunId || !selected?.zone_id) return;
    setAnnotationError(null);
    setAnnotationSaveBusy(true);
    try {
      await patchSdZoneSavedAnnotations(savedRunId, {
        zone_id: String(selected.zone_id),
        zone_name: String(selected.zone_name ?? ""),
        source_tf: String(selected.source_tf ?? ""),
        trade_id: tradeKey(selected, selectedListIdx),
        trade_index: Number.isFinite(Number(selectedListIdx)) ? Number(selectedListIdx) : null,
        entry_bar:
          selected.entry_bar != null && Number.isFinite(Number(selected.entry_bar))
            ? Math.floor(Number(selected.entry_bar))
            : null,
        touch_index:
          selected.touch_index != null && Number.isFinite(Number(selected.touch_index))
            ? Math.floor(Number(selected.touch_index))
            : null,
        tags: annotationTags,
        comment: annotationComment,
      });
      if (annotationTags.length > 0) {
        const merged = Array.from(new Set([...tagPreset, ...annotationTags])).sort((a, b) => a.localeCompare(b));
        const out = await saveSdZoneTagPresets(merged);
        setTagPreset(Array.isArray(out.tags) ? out.tags : merged);
      }
    } catch (e) {
      setAnnotationError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnnotationSaveBusy(false);
    }
  }, [annotationComment, annotationTags, tagPreset, savedRunId, selected, selectedListIdx]);

  const canSaveBacktest =
    Boolean(lastRequest) && currentZoneTfs.length === 1 && !saveBacktestBusy;

  const windowSlice = useMemo(() => {
    if (!selected?.chart_window || ohlcFull.length === 0) {
      return { ohlc: ohlcFull, offset: 0 };
    }
    const { from_bar, to_bar } = selected.chart_window;
    const lo = Math.max(0, from_bar);
    const hi = Math.min(ohlcFull.length - 1, to_bar);
    return { ohlc: ohlcFull.slice(lo, hi + 1), offset: lo };
  }, [selected, ohlcFull]);

  const lwContextSlice = useMemo(() => {
    if (!selected?.chart_window || ohlcFull.length === 0) {
      return { ohlc: ohlcFull, entryIso: "" };
    }
    const { from_bar, to_bar } = selected.chart_window;
    const lo = Math.max(0, from_bar);
    const hi = Math.min(ohlcFull.length - 1, to_bar);
    const span = Math.max(1, hi - lo + 1);
    // "2× historie": show twice the current window on each side when possible.
    const lo2 = Math.max(0, lo - span);
    const hi2 = Math.min(ohlcFull.length - 1, hi + span);
    const entryAbs = typeof selected.entry_bar === "number" ? selected.entry_bar : Number(selected.entry_bar);
    const entryIdx = Number.isFinite(entryAbs) ? Math.max(0, Math.min(ohlcFull.length - 1, Math.floor(entryAbs))) : -1;
    const entryIso = entryIdx >= 0 ? (ohlcFull[entryIdx]?.date ?? "") : "";
    return { ohlc: ohlcFull.slice(lo2, hi2 + 1), entryIso };
  }, [selected, ohlcFull]);

  const viewPayload = useMemo(() => {
    const markers = result.markers_view ?? result.markers_hl ?? [];
    const lines = (result.lines_view ?? result.lines_hl ?? []) as ViewLine[];
    const zones = (result.zones_view ?? []) as ViewZone[];
    return { markers, lines, zones };
  }, [result.markers_view, result.markers_hl, result.lines_view, result.lines_hl, result.zones_view]);

  const viewDataInWindow = useMemo(() => {
    const windowOhlc = windowSlice.ohlc;
    const startIdx = windowSlice.offset;
    const windowLen = windowOhlc.length;
    const startIso = windowOhlc[0]?.date ?? "";
    const endIso = windowOhlc[windowLen - 1]?.date ?? "";
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    const inRange = (d: string) => {
      const ts = Date.parse(d);
      if (Number.isFinite(ts) && Number.isFinite(startMs) && Number.isFinite(endMs)) {
        return ts >= startMs && ts <= endMs;
      }
      const ds = d.slice(0, 10);
      const sd = startIso.slice(0, 10);
      const ed = endIso.slice(0, 10);
      return ds >= sd && ds <= ed;
    };

    const markersInWindow = (viewPayload.markers ?? []).filter((m) => {
      const bi0 = typeof m.bar_index === "number" ? m.bar_index : Number(m.bar_index);
      if (Number.isFinite(bi0)) {
        return bi0 >= startIdx && bi0 < startIdx + windowLen;
      }
      return inRange(m.date);
    });
    const markersRemapped = remapViewMarkersBarIndexForWindow(
      markersInWindow,
      startIdx,
      windowLen,
      windowOhlc,
    );

    const linesInWindow = (viewPayload.lines ?? [])
      .map((line) => {
        if ("regime_histogram" in line && (line as any).regime_histogram === true) {
          const data = ((line as any).data ?? []).filter((p: any) => inRange(p.date));
          return data.length ? { ...(line as any), data } : null;
        }
        const data = (line.data ?? []).filter((p) => inRange(p.date));
        return data.length ? { ...line, data } : null;
      })
      .filter((x): x is ViewLine => x != null);

    const zonesInWindow = (viewPayload.zones ?? []).filter((z) => {
      const zStart = Date.parse(z.date_start);
      const zEnd = Date.parse(z.date_end);
      if (Number.isFinite(zStart) && Number.isFinite(zEnd) && Number.isFinite(startMs) && Number.isFinite(endMs)) {
        return (
          (zStart >= startMs && zStart <= endMs) ||
          (zEnd >= startMs && zEnd <= endMs) ||
          (zStart <= startMs && zEnd >= endMs)
        );
      }
      return inRange(z.date_start) || inRange(z.date_end);
    });
    const zonesRemapped = zonesInWindow.map((z) => {
      const out: any = { ...z };
      if (typeof out.touch_bar_index === "number" && Number.isFinite(out.touch_bar_index)) {
        const ri = Math.round(out.touch_bar_index - startIdx);
        if (ri < 0 || ri >= windowLen) {
          out.has_touch = false;
          delete out.touch_bar_index;
        } else {
          out.touch_bar_index = ri;
        }
      }
      if (out.inducements?.length) {
        out.inducements = out.inducements
          .map((ind: any) => {
            if (typeof ind.index !== "number" || Number.isNaN(ind.index)) return ind;
            const ni = ind.index - startIdx;
            if (ni < 0 || ni >= windowLen) return null;
            return { ...ind, index: ni };
          })
          .filter((x: any) => x != null);
      }
      return out;
    });

    // Focus only a single zone: keep just the zone matching selected trade (by kind + price band).
    const zonesFocused = selected
      ? zonesRemapped.filter((z: any) => {
          const wantName = String(selected.zone_name ?? "").trim();
          if (wantName && String(z.name ?? "").trim() !== wantName) return false;
          const zl = Number(selected.zone_value_low);
          const zh = Number(selected.zone_value_high);
          if (!Number.isFinite(zl) || !Number.isFinite(zh)) return true;
          const a0 = Math.min(zl, zh);
          const a1 = Math.max(zl, zh);
          const b0 = Math.min(Number(z.value_low), Number(z.value_high));
          const b1 = Math.max(Number(z.value_low), Number(z.value_high));
          if (!Number.isFinite(b0) || !Number.isFinite(b1)) return false;
          // Prefer overlap match; if price bands are close, treat as match.
          const overlap = !(b1 < a0 || b0 > a1);
          const tol = Math.max(1e-6, 0.01 * Math.max(Math.abs(a0), Math.abs(a1), 1));
          const close = Math.abs(a0 - b0) <= tol || Math.abs(a1 - b1) <= tol;
          return overlap || close;
        })
      : zonesRemapped;

    return {
      markers: markersRemapped,
      lines: linesInWindow,
      zones: selected && zonesFocused.length === 0 ? zonesRemapped : zonesFocused,
    };
  }, [viewPayload, windowSlice, selected]);

  const tradeOverlay = useMemo(() => {
    const o = windowSlice.ohlc;
    const n = o.length;
    if (!selected || selected.skip || n <= 0) return { extraShapes: [], extraAnnotations: [], extraTraces: [] };
    const off = windowSlice.offset;
    const loc = (g: number | null | undefined) => {
      if (g == null) return null;
      const x = g - off;
      return x >= 0 && x < n ? x : null;
    };
    const entryBarLoc = loc(selected.entry_bar ?? null);
    const x0 = entryBarLoc != null ? Math.max(-0.5, entryBarLoc - 10) : -0.5;
    const x1 = entryBarLoc != null ? Math.min(n - 0.5, entryBarLoc + 10) : n - 0.5;
    const shapes: any[] = [];
    const ann: any[] = [];
    const traces: any[] = [];

    const addH = (y: number | null | undefined, color: string, width: number, dash?: string, label?: string) => {
      if (!tradeVis.tradeLevels) return;
      if (y == null || !Number.isFinite(y)) return;
      shapes.push({
        type: "line",
        x0,
        x1,
        y0: y,
        y1: y,
        xref: "x",
        yref: "y",
        line: { color, width, dash: dash ?? "solid" },
        layer: "above",
      });
      if (tradeVis.tradeLevelLabels && label) {
        ann.push({
          xref: "paper",
          yref: "y",
          x: 0.995,
          y,
          xanchor: "right",
          yanchor: "middle",
          text: label,
          showarrow: false,
          font: { size: 10, color, family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
          bgcolor: "rgba(9,9,11,0.55)",
          bordercolor: "rgba(63,63,70,0.7)",
          borderwidth: 1,
          borderpad: 3,
        });
      }
    };
    const addV = (g: number | null | undefined, color: string, width: number, dash?: string) => {
      if (!tradeVis.tradeBars) return;
      const x = loc(g);
      if (x == null) return;
      shapes.push({
        type: "line",
        x0: x,
        x1: x,
        y0: 0,
        y1: 1,
        xref: "x",
        yref: "paper",
        line: { color, width, dash: dash ?? "solid" },
        layer: "above",
      });
    };

    const ENTRY_COLOR = "#38bdf8";
    const SL_COLOR = "#f87171";
    const MFE_COLOR = "#fbbf24";
    const MAE_COLOR = "#94a3b8";
    const ZONE_DEMAND_FILL = "rgba(34, 197, 94, 0.28)";
    const ZONE_SUPPLY_FILL = "rgba(239, 68, 68, 0.28)";
    const ZONE_DEMAND_LINE = "rgba(34, 197, 94, 0.95)";
    const ZONE_SUPPLY_LINE = "rgba(239, 68, 68, 0.95)";

    // Always draw trade's zone box as overlay (stable focus even if zones_view filter yields none).
    if (selected.zone_value_low != null && selected.zone_value_high != null) {
      const zl = Number(selected.zone_value_low);
      const zh = Number(selected.zone_value_high);
      if (Number.isFinite(zl) && Number.isFinite(zh) && zl !== zh) {
        const g0 = typeof selected.zone_bar_start === "number" ? selected.zone_bar_start : null;
        const g1 = typeof selected.zone_bar_end === "number" ? selected.zone_bar_end : null;
        const xb0 =
          g0 != null && Number.isFinite(g0) ? Math.max(-0.5, Math.min(n - 0.5, g0 - off - 0.5)) : -0.5;
        const xb1 =
          g1 != null && Number.isFinite(g1) ? Math.max(-0.5, Math.min(n - 0.5, g1 - off + 0.5)) : n - 0.5;
        const isDemand = String(selected.zone_name ?? "").trim() === "Demand";
        shapes.push({
          type: "rect",
          x0: Math.min(xb0, xb1),
          x1: Math.max(xb0, xb1),
          y0: zl,
          y1: zh,
          xref: "x",
          yref: "y",
          fillcolor: isDemand ? ZONE_DEMAND_FILL : ZONE_SUPPLY_FILL,
          line: { width: 2, color: isDemand ? ZONE_DEMAND_LINE : ZONE_SUPPLY_LINE },
          layer: "below",
        });
      }
    }

    const entryTouch = selected.entry_touch_price ?? selected.entry_price;
    const mfePx = entryTouch != null && selected.R_unit != null && selected.mfe_R != null
      ? (String(selected.zone_name ?? "") === "Demand"
          ? Number(entryTouch) + Number(selected.R_unit) * Number(selected.mfe_R)
          : Number(entryTouch) - Number(selected.R_unit) * Number(selected.mfe_R))
      : null;
    // Single MAE semantics:
    // - backend sets `mae_R` to MAE-before-win for winners
    // - otherwise `mae_R` is the "full path" adverse (often 1R when SL is hit)
    const maeRForLevels =
      selected.mae_R != null && Number.isFinite(Number(selected.mae_R))
        ? Number(selected.mae_R)
        : null;
    const maePx = entryTouch != null && selected.R_unit != null && maeRForLevels != null
      ? (String(selected.zone_name ?? "") === "Demand"
          ? Number(entryTouch) - Number(selected.R_unit) * maeRForLevels
          : Number(entryTouch) + Number(selected.R_unit) * maeRForLevels)
      : null;
    const winnerThrR =
      (lastRequest as any)?.winner_rr != null && Number.isFinite(Number((lastRequest as any).winner_rr))
        ? Number((lastRequest as any).winner_rr)
        : selected.winner_rr_used != null && Number.isFinite(Number(selected.winner_rr_used))
          ? Number(selected.winner_rr_used)
          : null;
    const targetPx =
      entryTouch != null && selected.R_unit != null && winnerThrR != null
        ? (String(selected.zone_name ?? "") === "Demand"
            ? Number(entryTouch) + Number(selected.R_unit) * winnerThrR
            : Number(entryTouch) - Number(selected.R_unit) * winnerThrR)
        : null;

    // Levels should span the full chart for visibility.
    const fullX0 = -0.5;
    const fullX1 = n - 0.5;
    const addHFull = (y: number | null | undefined, color: string, width: number, dash?: string, label?: string) => {
      if (!tradeVis.tradeLevels) return;
      if (y == null || !Number.isFinite(y)) return;
      shapes.push({
        type: "line",
        x0: fullX0,
        x1: fullX1,
        y0: y,
        y1: y,
        xref: "x",
        yref: "y",
        line: { color, width, dash: dash ?? "solid" },
        layer: "above",
      });
      if (tradeVis.tradeLevelLabels && label) {
        ann.push({
          xref: "paper",
          yref: "y",
          x: 0.995,
          y,
          xanchor: "right",
          yanchor: "middle",
          text: label,
          showarrow: false,
          font: { size: 10, color, family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
          bgcolor: "rgba(9,9,11,0.55)",
          bordercolor: "rgba(63,63,70,0.7)",
          borderwidth: 1,
          borderpad: 3,
        });
      }
    };

    const riskUsd = selected.notional_risk_usd != null ? Number(selected.notional_risk_usd) : null;
    const fmtR = (x: number | null | undefined) => (x == null || !Number.isFinite(Number(x)) ? "" : `${Number(x).toFixed(2)}R`);
    const fmtUsd = (x: number | null | undefined) => (x == null || !Number.isFinite(Number(x)) ? "" : `$${Number(x).toFixed(0)}`);

    addHFull(entryTouch, ENTRY_COLOR, 2, "solid", "ENTRY");
    addHFull(
      selected.stop_price,
      SL_COLOR,
      2,
      "dash",
      riskUsd != null ? `SL (1.00R, ${fmtUsd(riskUsd)})` : "SL (1.00R)",
    );
    if ((selected.mfe_R ?? 0) > 1e-6)
      addHFull(
        mfePx,
        MFE_COLOR,
        2,
        "dot",
        selected.mfe_usd != null ? `MFE (${fmtR(selected.mfe_R)}, ${fmtUsd(selected.mfe_usd)})` : `MFE (${fmtR(selected.mfe_R)})`,
      );
    if (winnerThrR != null && Number.isFinite(winnerThrR) && winnerThrR > 0)
      addHFull(
        targetPx,
        "#a78bfa",
        2,
        "dash",
        `TARGET (${winnerThrR.toFixed(2)}R)`,
      );
    if ((maeRForLevels ?? 0) > 1e-6)
      addHFull(
        maePx,
        MAE_COLOR,
        1,
        "dot",
        selected.mae_usd != null
          ? `MAE (${fmtR(maeRForLevels)}, ${fmtUsd(selected.mae_usd)})`
          : `MAE (${fmtR(maeRForLevels)})`,
      );

    addV(selected.entry_bar, ENTRY_COLOR, 2);
    addV(selected.mfe_bar, MFE_COLOR, 1, "dot");
    addV(selected.sl_hit_bar, SL_COLOR, 1);
    addV(selected.cap_hit_bar, "#a78bfa", 1, "dot");

    if (tradeVis.touchMarker && entryBarLoc != null && entryTouch != null) {
      traces.push({
        type: "scatter",
        mode: "markers",
        x: [entryBarLoc],
        y: [entryTouch],
        marker: { size: 18, color: "#facc15", symbol: "circle", line: { color: "#111827", width: 2.5 } },
        name: "Touch / entry",
        showlegend: true,
        hovertemplate: "Entry touch<br>bar %{x}<br>%{y:.4f}<extra></extra>",
      });
    }

    if (tradeVis.zoneMeta) {
      const meta = [selected.source_tf, selected.zone_name].filter(Boolean).join(" · ");
      if (meta) {
        ann.push({
          x: entryBarLoc ?? 0,
          y: Math.max(Number(selected.zone_value_low ?? 0), Number(selected.zone_value_high ?? 0)),
          xref: "x",
          yref: "y",
          text: meta,
          showarrow: false,
          yanchor: "bottom",
          font: { size: 10, color: "#e4e4e7" },
          bgcolor: "rgba(24,24,27,0.75)",
          borderpad: 3,
        });
      }
    }

    return { extraShapes: shapes, extraAnnotations: ann, extraTraces: traces };
  }, [selected, windowSlice, tradeVis]);

  useEffect(() => {
    setRevision((r) => r + 1);
  }, [selectedIdx, windowSlice.offset, filter]);

  const tfCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const { t } of executed) {
      const tf = String(t.source_tf ?? "").trim();
      if (!tf) continue;
      m.set(tf, (m.get(tf) ?? 0) + 1);
    }
    return m;
  }, [executed]);

  const tfOptions = useMemo(() => {
    // UI: zobraz vždy standardní TF + cokoliv navíc z dat. I když je count=0, uživatel chce možnost vybrat.
    const STANDARD = [
      "1M",
      "1Mo",
      "1w",
      "1W",
      "1d",
      "1D",
      "4h",
      "1h",
      "30m",
      "15m",
      "5m",
      "1m",
    ] as const;
    const set = new Set<string>(STANDARD);
    tfCounts.forEach((_v, k) => set.add(k));
    const all = Array.from(set);
    const order = new Map<string, number>();
    STANDARD.forEach((tf, i) => order.set(tf, i));
    return all.sort((a, b) => {
      const oa = order.get(a);
      const ob = order.get(b);
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1;
      if (ob != null) return 1;
      return a.localeCompare(b);
    });
  }, [tfCounts]);

  useEffect(() => {
    if (tfSelected.length === 0 && tfOptions.length > 0) setTfSelected(tfOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tfOptions.join("|")]);

  const goPrev = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setSelectedIdx((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
  }, [filtered.length]);

  const exportJson = useCallback(() => {
    const payload = {
      ...result,
      exported_at_utc: new Date().toISOString(),
      saved_run_id: savedRunId,
      export_ui_filters: {
        config_min_mfe_R: configMinMfeR,
        tf_selected: tfSelected,
        mfe_min: mfeMin,
        mfe_max: mfeMax,
        mfe_range_strict: mfeRangeStrict,
        date_from: dateFrom,
        date_to: dateTo,
        losers_only: losersOnly,
        ge_1R: ge1,
        ge_1_5R: ge15,
        ge_2R: ge2,
        ge_3R: ge3,
        text_filter: filter.trim() || null,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sd-zone-test-${result.dataset_id ?? "run"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    configMinMfeR,
    dateFrom,
    dateTo,
    filter,
    ge1,
    ge15,
    ge2,
    ge3,
    losersOnly,
    mfeMax,
    mfeMin,
    mfeRangeStrict,
    result,
    savedRunId,
    tfSelected,
  ]);

  const viewCounts = useMemo(() => {
    const zones = viewDataInWindow.zones ?? [];
    const markersAll = viewDataInWindow.markers ?? [];
    const markersDisplayed = viewVis.swing_hl
      ? markersAll
      : markersAll.filter(
          (m) => !["high", "low", "major_high", "major_low", "internal_high", "internal_low", "bos_bullish", "bos_bearish"].includes(String(m.type)),
        );

    const dsZones = zones.filter((z: any) => z?.name === "Demand" || z?.name === "Supply");
    const bosZones = zones.filter((z: any) => String(z?.name ?? "").toLowerCase().startsWith("bos"));
    const touches = zones.filter((z: any) => Boolean(z?.has_touch) || typeof z?.touch_bar_index === "number");
    const inducementPoints = zones.reduce((s: number, z: any) => s + ((z?.inducements?.length as number | undefined) ?? 0), 0);

    const swingAndBosMarkers = markersAll.filter((m: any) =>
      ["high", "low", "major_high", "major_low", "internal_high", "internal_low", "bos_bullish", "bos_bearish"].includes(String(m?.type)),
    );

    return {
      zones_total: zones.length,
      zones_ds: dsZones.length,
      zones_bos: bosZones.length,
      touches: touches.length,
      inducement_points: inducementPoints,
      markers_total: markersDisplayed.length,
      markers_swing_bos: swingAndBosMarkers.length,
      lines_total: (viewDataInWindow.lines ?? []).length,
    };
  }, [viewDataInWindow.lines, viewDataInWindow.markers, viewDataInWindow.zones, viewVis.swing_hl]);

  const displayStats = useMemo(() => {
    const rows = filtered.map(({ t }) => t);
    const n = rows.length;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const reachBeforeSl = (t: SdZoneTestTrade): number => {
      const v =
        t.mfe_before_sl_R != null && Number.isFinite(Number(t.mfe_before_sl_R))
          ? Number(t.mfe_before_sl_R)
          : t.mfe_R != null && Number.isFinite(Number(t.mfe_R))
            ? Number(t.mfe_R)
            : Number.NaN;
      return v;
    };
    const mfeVals = rows.map((t) => Number(t.mfe_R)).filter((x) => Number.isFinite(x));
    const maeVals = rows.map((t) => Number(t.mae_R)).filter((x) => Number.isFinite(x));
    const maeWinnerVals = rows
      .filter((t) => t.is_winner === true)
      .map((t) => {
        const v = (t as any).mae_before_thr_R;
        return v != null && Number.isFinite(Number(v)) ? Number(v) : Number(t.mae_R);
      })
      .filter((x) => Number.isFinite(x));
    const durVals = rows
      .map((t) => (t.duration_bars != null ? Number(t.duration_bars) : NaN))
      .filter((x) => Number.isFinite(x));
    const dmfeSl = rows.map((t) => durationToMfeOrSlBars(t)).filter((x): x is number => x != null);
    const isLoserByRule = (t: SdZoneTestTrade): boolean =>
      t.is_winner != null ? t.is_winner === false : t.sl_hit_bar != null;
    const losers = rows.filter((t) => isLoserByRule(t)).length;
    const thr = (th: number) => {
      if (!mfeVals.length) return { c: 0, p: null as number | null };
      const c = mfeVals.filter((x) => x >= th).length;
      return { c, p: c / mfeVals.length };
    };
    const avgBarsToReach = (th: number) => {
      if (!rows.length) return null as number | null;
      const key = th % 1 === 0 ? String(Math.round(th)) : th.toFixed(1).replace(/\.0$/, "");
      const ds = rows
        .map((t) => (t.bars_to_reach_R && t.bars_to_reach_R[key] != null ? Number(t.bars_to_reach_R[key]) : Number.NaN))
        .filter((x) => Number.isFinite(x) && x >= 0);
      return avg(ds);
    };

    const expectancyAt = (th: number) => {
      if (!rows.length) return null as number | null;
      let sum = 0;
      let used = 0;
      for (const t of rows) {
        const reach = reachBeforeSl(t);
        const hit = Number.isFinite(reach) && reach >= th;
        sum += hit ? th : -1;
        used += 1;
      }
      return used ? sum / used : null;
    };

    const rawCap =
      (lastRequest as any)?.max_mfe_R != null && Number.isFinite(Number((lastRequest as any).max_mfe_R))
        ? Number((lastRequest as any).max_mfe_R)
        : null;
    const cap = rawCap != null ? Math.max(1, Math.min(10, Math.floor(rawCap))) : 10;
    const thrList: number[] = [];
    for (let r = 1.0; r <= Math.min(3.0, cap) + 1e-9; r += 0.5) thrList.push(Number(r.toFixed(1)));
    for (let r = 4; r <= cap; r += 1) thrList.push(r);
    const thresholdCards = thrList.map((th) => {
      const tp = thr(th);
      return { th, c: tp.c, p: tp.p, avgBars: avgBarsToReach(th), expR: expectancyAt(th) };
    });

    const winnersNoSl = n - losers;
    const overallWinRatePct = n > 0 ? (winnersNoSl / n) * 100 : null;

    const byZone = (kind: "Demand" | "Supply") => {
      const zs = rows.filter((t) => String(t.zone_name ?? "").trim() === kind);
      const zN = zs.length;
      if (!zN) return { n: 0, winners: 0, winRatePct: null as number | null, avgMfe: null as number | null };
      const zLosers = zs.filter((t) => isLoserByRule(t)).length;
      const zWinners = zN - zLosers;
      const zMfe = zs.map((t) => Number(t.mfe_R)).filter((x) => Number.isFinite(x));
      return { n: zN, winners: zWinners, winRatePct: (zWinners / zN) * 100, avgMfe: avg(zMfe) };
    };
    const demand = byZone("Demand");
    const supply = byZone("Supply");

    return {
      n,
      avgMfe: avg(mfeVals),
      medMfe: medianNums(mfeVals),
      avgMae: avg(maeVals),
      medMae: medianNums(maeVals),
      avgMaeWinners: avg(maeWinnerVals),
      avgDur: avg(durVals),
      medDur: medianNums(durVals),
      avgDurMfeSl: avg(dmfeSl),
      medDurMfeSl: medianNums(dmfeSl),
      losers,
      winnersNoSl,
      overallWinRatePct,
      demandWinRatePct: demand.winRatePct,
      demandN: demand.n,
      demandAvgMfe: demand.avgMfe,
      supplyWinRatePct: supply.winRatePct,
      supplyN: supply.n,
      supplyAvgMfe: supply.avgMfe,
      thresholdCards,
      thresholdCapR: cap,
    };
  }, [filtered, lastRequest]);

  const rMultipleTargets = useMemo(() => {
    const rows = filtered.map(({ t }) => t);
    const n = rows.length;
    const getReachBeforeSl = (t: SdZoneTestTrade): number => {
      const v =
        t.mfe_before_sl_R != null && Number.isFinite(Number(t.mfe_before_sl_R))
          ? Number(t.mfe_before_sl_R)
          : t.mfe_R != null && Number.isFinite(Number(t.mfe_R))
            ? Number(t.mfe_R)
            : Number.NaN;
      return v;
    };
    const xs = Array.from({ length: 10 }, (_, i) => i + 1);
    const points = xs.map((targetR) => {
      if (!n) return { targetR, expectancyR: 0, winRate: 0, winners: 0, cumulativeR: 0 };
      let wins = 0;
      let sum = 0; // cumulative R across all trades
      for (const tr of rows) {
        const reach = getReachBeforeSl(tr);
        const isWin = Number.isFinite(reach) && reach >= targetR;
        if (isWin) {
          wins += 1;
          sum += targetR;
        } else {
          sum += -1;
        }
      }
      return { targetR, expectancyR: sum / n, winRate: wins / n, winners: wins, cumulativeR: sum };
    });
    const best = points.reduce(
      (acc, p) => (p.expectancyR > acc.expectancyR ? p : acc),
      points[0] ?? { targetR: 1, expectancyR: 0, winRate: 0, winners: 0, cumulativeR: 0 },
    );
    return { n, points, best };
  }, [filtered]);

  const zonesByTf = useMemo(() => {
    const rows = filtered.map(({ t }) => t);
    const getReachBeforeSl = (t: SdZoneTestTrade): number => {
      const v =
        t.mfe_before_sl_R != null && Number.isFinite(Number(t.mfe_before_sl_R))
          ? Number(t.mfe_before_sl_R)
          : t.mfe_R != null && Number.isFinite(Number(t.mfe_R))
            ? Number(t.mfe_R)
            : Number.NaN;
      return v;
    };
    const targets = Array.from({ length: 10 }, (_, i) => i + 1);
    const by: Record<string, SdZoneTestTrade[]> = {};
    for (const t of rows) {
      const tf = String(t.source_tf ?? "").trim() || "unknown";
      if (!by[tf]) by[tf] = [];
      by[tf]!.push(t);
    }
    const tfs = Object.keys(by).sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return a.localeCompare(b);
    });
    const items = tfs.map((tf) => {
      const grp = by[tf] ?? [];
      const n = grp.length;
      const points = targets.map((targetR) => {
        if (!n) return { targetR, expectancyR: 0, winRate: 0, winners: 0, cumulativeR: 0 };
        let wins = 0;
        let sum = 0;
        for (const tr of grp) {
          const reach = getReachBeforeSl(tr);
          const isWin = Number.isFinite(reach) && reach >= targetR;
          if (isWin) {
            wins += 1;
            sum += targetR;
          } else {
            sum += -1;
          }
        }
        return { targetR, expectancyR: sum / n, winRate: wins / n, winners: wins, cumulativeR: sum };
      });
      const best = points.reduce(
        (acc, p) => (p.expectancyR > acc.expectancyR ? p : acc),
        points[0] ?? { targetR: 1, expectancyR: 0, winRate: 0, winners: 0, cumulativeR: 0 },
      );
      return { tf, n, points, best };
    });
    return items;
  }, [filtered]);

  const propSim = useMemo(() => {
    const rows = filtered.map(({ t }) => t);
    const n = rows.length;
    const riskPct = Math.max(0.01, Number(propRiskPct) || 0);
    const profitTakePct = Math.max(0.01, Number(propProfitTakePct) || 0);
    const targetPct = Math.max(0.01, Number(propTargetPct) || 0);
    const maxDdPct = Math.max(0.01, Number(propMaxDdPct) || 0);
    const consistencyPct = Math.max(0, Math.min(100, Number(propConsistencyPct) || 0));
    const runs = Math.max(10, Math.min(3000, Math.floor(Number(propRuns) || 300)));
    const seed = Math.floor(Number(propSeed) || 1337);

    /** R potřebné k dosažení zvoleného zisku v % (1R = riskPct % účtu). */
    const profitTakeR = profitTakePct / riskPct;

    const getReachBeforeSl = (t: SdZoneTestTrade): number => {
      const v =
        t.mfe_before_sl_R != null && Number.isFinite(Number(t.mfe_before_sl_R))
          ? Number(t.mfe_before_sl_R)
          : t.mfe_R != null && Number.isFinite(Number(t.mfe_R))
            ? Number(t.mfe_R)
            : Number.NaN;
      return v;
    };
    const fmtRKey = (x: number): string => {
      if (!Number.isFinite(x)) return String(x);
      if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
      return x.toFixed(1).replace(/\.0$/, "");
    };
    /** Max zisk v % účtu na jeden obchod (consistency × celkový target challenge). */
    const capWinPctOfAccount = (consistencyPct / 100) * targetPct;

    const lossFracOfAccount = (t: SdZoneTestTrade): number => {
      const mae = t.mae_R != null && Number.isFinite(Number(t.mae_R)) ? Math.min(1, Math.max(0, Number(t.mae_R))) : 1;
      return -(mae * riskPct) / 100;
    };

    const samples = rows
      .map((t) => {
        const reach = getReachBeforeSl(t);
        const hit = Number.isFinite(reach) && reach >= profitTakeR;
        let pnlFrac: number;
        if (hit) {
          const rBank = Math.min(reach, profitTakeR);
          let winPctOfAccount = (rBank * riskPct) / 100;
          if (Number.isFinite(capWinPctOfAccount) && capWinPctOfAccount > 0) {
            winPctOfAccount = Math.min(winPctOfAccount, capWinPctOfAccount / 100);
          }
          pnlFrac = winPctOfAccount;
        } else {
          pnlFrac = lossFracOfAccount(t);
        }

        let bars = durationToMfeOrSlBars(t);
        if (hit) {
          const key = fmtRKey(profitTakeR);
          const b =
            t.bars_to_reach_R && (t.bars_to_reach_R as Record<string, number>)[key] != null
              ? Number((t.bars_to_reach_R as Record<string, number>)[key])
              : Number.NaN;
          if (Number.isFinite(b) && b >= 0) bars = Math.floor(b);
        }
        if (bars == null || !Number.isFinite(bars) || bars < 0) bars = 0;
        return { pnlFrac, bars };
      })
      .filter((x) => Number.isFinite(x.pnlFrac));

    if (!n || samples.length === 0) {
      return {
        ok: false as const,
        reason: "Žádné obchody pro simulaci (filtry jsou moc přísné).",
        runs,
        targetPct,
        maxDdPct,
        riskPct,
        profitTakePct,
        consistencyPct,
        successProb: 0,
        avgBarsToSuccess: null as number | null,
        avgDaysToSuccess: null as number | null,
        curves: [] as number[][],
      };
    }

    const rng = mulberry32(seed);
    const maxTrades = 5000;
    const curves: number[][] = [];
    let successes = 0;
    const barsToSuccess: number[] = [];

    for (let r = 0; r < runs; r++) {
      let pnlFrac = 0;
      let peakFrac = 0;
      let bars = 0;
      const curve: number[] = [0];
      let done = false;

      for (let k = 0; k < maxTrades; k++) {
        const idx = Math.floor(rng() * samples.length);
        const s = samples[Math.max(0, Math.min(samples.length - 1, idx))]!;
        pnlFrac += s.pnlFrac;
        bars += s.bars;
        peakFrac = Math.max(peakFrac, pnlFrac);
        const ddFrac = peakFrac - pnlFrac;
        curve.push(pnlFrac * 100);

        if (ddFrac * 100 >= maxDdPct) {
          done = true;
          break;
        }
        if (pnlFrac * 100 >= targetPct) {
          successes += 1;
          barsToSuccess.push(bars);
          done = true;
          break;
        }
      }
      curves.push(curve);
    }

    const avgBars = barsToSuccess.length ? barsToSuccess.reduce((a, b) => a + b, 0) / barsToSuccess.length : null;
    const avgDays =
      avgBars != null && barSeconds != null && Number.isFinite(barSeconds)
        ? (avgBars * Number(barSeconds)) / 86400
        : null;

    return {
      ok: true as const,
      runs,
      targetPct,
      maxDdPct,
      riskPct,
      profitTakePct,
      consistencyPct,
      successProb: successes / runs,
      avgBarsToSuccess: avgBars,
      avgDaysToSuccess: avgDays,
      curves,
    };
  }, [
    barSeconds,
    filtered,
    propConsistencyPct,
    propMaxDdPct,
    propRiskPct,
    propProfitTakePct,
    propRuns,
    propSeed,
    propTargetPct,
  ]);

  const fmt = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const fmtPct = (p: number | null) => (p == null || !Number.isFinite(p) ? "" : ` (${(p * 100).toFixed(1)}%)`);

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 text-zinc-100">
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700"
        >
          Zpět
        </button>
        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
          <button
            type="button"
            onClick={() => setMainTab("backtest")}
            className={`px-3 py-1.5 text-sm ${
              mainTab === "backtest"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
            }`}
          >
            Backtest
          </button>
          <button
            type="button"
            onClick={() => setMainTab("journal")}
            className={`px-3 py-1.5 text-sm ${
              mainTab === "journal"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
            }`}
          >
            Journal
          </button>
        </div>
        <button
          type="button"
          onClick={exportJson}
          className="rounded-lg px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700"
        >
          Export JSON
        </button>
        <button
          type="button"
          disabled={!canSaveBacktest}
          title={
            !lastRequest || currentZoneTfs.length !== 1
              ? "Uložit backtest lze jen při právě jednom Zone TF."
              : "Uloží výsledky tohoto běhu na backend (jeden Zone TF)."
          }
          onClick={() => void handleSaveBacktest()}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            canSaveBacktest ? "bg-emerald-800 hover:bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          {saveBacktestBusy ? "Ukládám…" : "Uložit backtest"}
        </button>
        {lastRequest && mainTab === "backtest" && (
          <div className="flex flex-wrap items-end gap-2 text-xs text-zinc-300">
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">TF svíček</div>
              <select
                value={currentChartTf}
                onChange={(e) => void doRerun({ chart_timeframe: e.target.value === "native" ? null : e.target.value })}
                disabled={rerunBusy}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
              >
                {CHART_TF_OPTIONS.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">Zone TF</div>
              <div className="flex flex-wrap gap-1.5">
                {(["1Mo", "1W", "1D", "4h", "1h"] as const).map((tf) => {
                  const on = currentZoneTfs.includes(tf);
                  return (
                    <button
                      key={tf}
                      type="button"
                      disabled={rerunBusy}
                      onClick={() => {
                        const next = on ? currentZoneTfs.filter((x) => x !== tf) : [...currentZoneTfs, tf];
                        void doRerun({ zone_timeframe: null, zone_timeframes: next.length ? next : null });
                      }}
                      className={`px-2 py-1 rounded border text-[11px] font-mono ${
                        on
                          ? "border-emerald-700/60 bg-emerald-950/35 text-emerald-200"
                          : "border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:bg-zinc-900/50"
                      } ${rerunBusy ? "opacity-60 cursor-not-allowed" : ""}`}
                      title="Klikem zap/vyp"
                    >
                      {tf}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={rerunBusy}
                  onClick={() => void doRerun({ zone_timeframe: null, zone_timeframes: null })}
                  className={`px-2 py-1 rounded border border-zinc-800 bg-zinc-950/20 text-[11px] text-zinc-500 hover:text-zinc-300 ${
                    rerunBusy ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                  title="Auto (všechny TF z buildu)"
                >
                  auto
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={rerunBusy}
              onClick={() => void doRerun({})}
              className="rounded px-2.5 py-1 border border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/70 disabled:opacity-50"
              title="Znovu načíst s aktuálními volbami"
            >
              {rerunBusy ? "Načítám…" : "Refresh"}
            </button>
          </div>
        )}
        <span className="text-xs text-zinc-500">
          {String(result.chartHints?.artifact_banner ?? "").slice(0, 120)}
        </span>
      </div>
      {rerunError && (
        <div className="shrink-0 px-4 py-2 text-xs text-rose-300 bg-rose-950/30 border-b border-rose-900/50">
          {rerunError}
        </div>
      )}
      {saveBacktestError && (
        <div className="shrink-0 px-4 py-2 text-xs text-rose-300 bg-rose-950/30 border-b border-rose-900/50">
          {saveBacktestError}
        </div>
      )}

      {mainTab === "journal" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SdZoneJournalView />
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div className="shrink-0 w-full lg:w-[288px] flex flex-col border-b lg:border-b-0 lg:border-r border-zinc-800 bg-zinc-950/95 min-h-0 max-h-[min(420px,50vh)] lg:max-h-none overflow-hidden">
          <div className="shrink-0 px-3 py-2 border-b border-zinc-800/90">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Anotace k obchodu</div>
            <div className="mt-1 text-[11px] text-zinc-400 leading-snug break-all">
              {savedRunId ? (
                <>
                  <span className="text-zinc-500">Backtest:</span>{" "}
                  <span className="font-mono text-zinc-200">
                    {(lastRequest?.data_file ?? "").split(/[/\\]/).pop() ?? "—"} · {currentZoneTfs[0] ?? "—"} ·{" "}
                    {savedRunId.slice(0, 8)}…
                  </span>
                </>
              ) : (
                <span className="text-amber-200/90">Nejdříve uložte backtest (tlačítko „Uložit backtest“ nahoře).</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 text-xs">
            {!selected?.zone_id ? (
              <div className="text-zinc-500">Vyberte obchod v tabulce vpravo.</div>
            ) : (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2">
                  <div className="grid grid-cols-3 gap-x-2 gap-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Zone TF</div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Typ zóny</div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Verdikt</div>
                    <div className="font-mono text-[12px] text-zinc-200">
                      {String(selected.source_tf ?? "").trim() || "—"}
                    </div>
                    <div className="font-mono text-[12px] text-zinc-200">
                      {String(selected.zone_name ?? "").trim() || "—"}
                    </div>
                    <div className="font-mono text-[12px]">
                      {(() => {
                        const v = (selected as any)?.is_winner;
                        if (typeof v === "boolean") {
                          return v ? (
                            <span className="text-emerald-300">winner</span>
                          ) : (
                            <span className="text-rose-300">loser</span>
                          );
                        }
                        // Fallback: older payloads — treat SL hit as loser, otherwise unknown.
                        const sl = (selected as any)?.sl_hit_bar;
                        if (sl != null) return <span className="text-rose-300">loser</span>;
                        return <span className="text-zinc-500">—</span>;
                      })()}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">Pořadí</div>
                    <div className="col-span-2 text-[10px] uppercase tracking-wider text-zinc-500 mt-1">Z celkem</div>
                    <div className="font-mono text-[12px] text-zinc-200">
                      {filtered.length > 0 ? selectedIdx + 1 : "—"}
                    </div>
                    <div className="col-span-2 font-mono text-[12px] text-zinc-200">
                      {filtered.length > 0 ? `/${filtered.length}` : "—"}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">TradeID</div>
                  <code className="block text-[11px] text-emerald-200/95 font-mono break-all bg-zinc-900/80 rounded px-2 py-1 border border-zinc-800">
                    {selectedTradeId}
                  </code>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-zinc-500">Tagy</span>
                    <button
                      type="button"
                      disabled={!tagInput.trim()}
                      className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                      onClick={() => {
                        const t = tagInput.trim();
                        if (!t) return;
                        setAnnotationTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
                        setTagPreset((prev) => (prev.includes(t) ? prev : [...prev, t].sort((a, b) => a.localeCompare(b))));
                        setTagInput("");
                      }}
                      title="Přidat tag"
                    >
                      + tag
                    </button>
                  </div>
                  {annotationLoadBusy ? (
                    <div className="text-zinc-500 py-2">Načítám…</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select
                          multiple
                          value={annotationTags}
                          onChange={(e) => {
                            const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
                            setAnnotationTags(vals);
                          }}
                          disabled={!savedRunId}
                          className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 h-24"
                          title="Vyber více tagů (Ctrl/Shift)"
                        >
                          {tagPreset.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <div className="w-28 shrink-0">
                          <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="Nový tag"
                            disabled={!savedRunId}
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200"
                          />
                          <div className="text-[10px] text-zinc-500 mt-1">Ctrl/Shift pro výběr</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {annotationTags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setAnnotationTags((prev) => prev.filter((x) => x !== t))}
                            className="px-2 py-1 rounded-full text-[11px] border border-emerald-600/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                            title="Odebrat tag"
                          >
                            {t} <span className="text-emerald-300/80">✕</span>
                          </button>
                        ))}
                        {annotationTags.length === 0 && <span className="text-[11px] text-zinc-600 italic">žádné tagy</span>}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">Komentář</div>
                  <textarea
                    value={annotationComment}
                    onChange={(e) => setAnnotationComment(e.target.value)}
                    disabled={!savedRunId}
                    placeholder={savedRunId ? "Poznámka k tomuto obchodu…" : "Nejdříve uložte backtest…"}
                    className="w-full min-h-[100px] resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-[12px] text-zinc-100 leading-relaxed placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-700/40 disabled:opacity-50"
                  />
                </div>
                {annotationError && <div className="text-rose-300 text-[11px]">{annotationError}</div>}
                <button
                  type="button"
                  disabled={!savedRunId || !selected?.zone_id || annotationSaveBusy}
                  onClick={() => void handleSaveAnnotation()}
                  className={`w-full rounded-lg py-2 text-sm font-medium ${
                    savedRunId && selected?.zone_id
                      ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  }`}
                >
                  {annotationSaveBusy ? "Ukládám…" : "Uložit anotaci"}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 flex flex-col min-w-0 min-h-0 border-b lg:border-b-0 lg:border-r border-zinc-800 overflow-hidden">
          <div
            ref={chartScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain"
          >
          <div
            style={{ minHeight: MIN_CHART_AREA_PX, height: chartHeight }}
            className="shrink-0 min-w-0 p-2 relative box-border"
          >
            <ViewLikeChart
              ohlc={windowSlice.ohlc}
              markers={
                viewVis.swing_hl
                  ? viewDataInWindow.markers
                  : viewDataInWindow.markers.filter(
                      (m) =>
                        !["high", "low", "major_high", "major_low", "internal_high", "internal_low", "bos_bullish", "bos_bearish"].includes(String(m.type)),
                    )
              }
              lines={viewDataInWindow.lines}
              zones={viewDataInWindow.zones}
              height={chartHeight}
              visibility={viewVis}
              extraShapes={tradeOverlay.extraShapes}
              extraAnnotations={tradeOverlay.extraAnnotations}
              extraTraces={tradeOverlay.extraTraces}
              revision={revision}
            />
            {rerunBusy && (
              <div className="absolute inset-2 z-10 flex items-center justify-center rounded bg-zinc-950/70 backdrop-blur-[1px] border border-zinc-800">
                <div className="px-4 py-2 rounded-lg bg-zinc-900/90 border border-zinc-700 text-sm text-zinc-200 shadow">
                  Načítám graf (nový timeframe)…
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-zinc-800/90 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900/90 px-4 py-5">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold tracking-tight text-zinc-100">Statistiky</h3>
                  <div className="inline-flex rounded-lg border border-zinc-700/70 bg-zinc-900/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setStatsTab("overview")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        statsTab === "overview" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatsTab("r_multiple")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        statsTab === "r_multiple" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      R-multiple
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatsTab("sl")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        statsTab === "sl" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      SL
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatsTab("prop")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        statsTab === "prop" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      Prop firm
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatsTab("zones")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        statsTab === "zones" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      Zones
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1 max-w-xl leading-relaxed">
                  Hodnoty odpovídají <span className="text-zinc-400">aktuálně vyfiltrovaným obchodům</span> (
                  <span className="font-mono text-emerald-400/90">{displayStats.n}</span>). Délky v barech používají TF
                  svíček <span className="font-mono text-zinc-400">{currentChartTf}</span>.
                </p>
              </div>
              {configMinMfeR != null && Number.isFinite(configMinMfeR) ? (
                <span className="text-[11px] px-3 py-1 rounded-full bg-violet-950/55 border border-violet-800/45 text-violet-200 font-mono shrink-0">
                  min MFE ≥ {configMinMfeR}R
                </span>
              ) : null}
            </div>
            {statsTab === "overview" && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Obchody</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{displayStats.n}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Průměr MFE (R)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">{fmt(displayStats.avgMfe, 3)}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Medián MFE (R)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-100/90">{fmt(displayStats.medMfe, 3)}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Průměr MAE (R)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-200/90">{fmt(displayStats.avgMae, 3)}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Medián MAE (R)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-100/85">{fmt(displayStats.medMae, 3)}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø MAE (winners)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-200/90">
                  {fmt(displayStats.avgMaeWinners, 3)}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">MAE pouze pro obchody s is_winner=true</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Losers (SL)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-300">{displayStats.n ? String(displayStats.losers) : "—"}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Winners (bez SL)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-300/90">
                  {displayStats.n ? String(displayStats.winnersNoSl) : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Win rate</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                  {displayStats.n && displayStats.overallWinRatePct != null ? `${displayStats.overallWinRatePct.toFixed(1)}%` : "—"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">stejné pravidlo jako Winners / Losers</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Win rate (Demand)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                  {displayStats.demandN && displayStats.demandWinRatePct != null ? `${displayStats.demandWinRatePct.toFixed(1)}%` : "—"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">n={displayStats.demandN}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Win rate (Supply)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                  {displayStats.supplyN && displayStats.supplyWinRatePct != null ? `${displayStats.supplyWinRatePct.toFixed(1)}%` : "—"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">n={displayStats.supplyN}</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø MFE (Demand)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                  {displayStats.demandN && displayStats.demandAvgMfe != null ? fmt(displayStats.demandAvgMfe, 3) : "—"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">R · průměr z {displayStats.demandN} touchů</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø MFE (Supply)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                  {displayStats.supplyN && displayStats.supplyAvgMfe != null ? fmt(displayStats.supplyAvgMfe, 3) : "—"}
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">R · průměr z {displayStats.supplyN} touchů</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø duration (bary)</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-sky-200/90">{fmt(displayStats.avgDur, 1)}</div>
                <div className="mt-1 text-[10px] text-zinc-600">celá cesta do konce měření</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-violet-950/25">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø barů do max MFE nebo SL</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-violet-200/95">{fmt(displayStats.avgDurMfeSl, 1)}</div>
                <div className="mt-1 text-[10px] text-zinc-600">dřívější z vrcholu MFE a prvního SL</div>
              </div>
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-violet-950/25">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Medián barů do max MFE nebo SL</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-violet-100/90">{fmt(displayStats.medDurMfeSl, 1)}</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Dosažené R (cap {displayStats.thresholdCapR}R)
                </div>
                <div className="text-[10px] text-zinc-600">
                  vpravo: Ø barů do dosažení daného R
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(displayStats.thresholdCards ?? []).map((t) => {
                  const label = (t.th % 1 === 0 ? String(t.th) : String(t.th).replace(".", ",")) + "R";
                  return (
                    <div
                      key={String(t.th)}
                      className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
                      <div className="mt-2 flex items-baseline justify-between gap-3">
                        <div className="text-2xl font-semibold tabular-nums text-zinc-50">
                          {displayStats.n ? `${t.c}${fmtPct(t.p)}` : "—"}
                        </div>
                        <div className="text-xs text-zinc-500 font-mono tabular-nums whitespace-nowrap">
                          Ø {fmt(t.avgBars, 1)}b
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        exp <span className="font-mono text-zinc-300">{fmt(t.expR ?? null, 3)}</span>R / trade
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {selected && lwContextSlice.ohlc.length > 1 && lwContextSlice.entryIso.trim() && (
              <div className="mt-5 rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-3 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Price context (LW chart) — 2× historie · marker: entry
                </div>
                <PriceContextChart
                  ohlc={lwContextSlice.ohlc}
                  entryIso={lwContextSlice.entryIso}
                  side={String(selected.zone_name ?? "").toLowerCase() === "supply" ? "short" : "long"}
                  height={320}
                />
              </div>
            )}
              </>
            )}

            {statsTab === "r_multiple" && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Expectancy podle targetu</div>
                    <div className="mt-1 text-sm text-zinc-300">
                      Vyhodnocení: pro target \(R\) platí <span className="font-mono text-zinc-200">+R</span> pokud bylo dosaženo před SL, jinak{" "}
                      <span className="font-mono text-zinc-200">−1R</span>. Graf ukazuje <span className="font-mono text-zinc-200">expectancy</span> = průměrný výsledek v \(R\) na trade.
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Best:{" "}
                    <span className="font-mono text-emerald-300">
                      {rMultipleTargets.best?.targetR ?? 1}R
                    </span>{" "}
                    · exp{" "}
                    <span className="font-mono text-zinc-200">
                      {Number.isFinite(rMultipleTargets.best?.expectancyR) ? rMultipleTargets.best!.expectancyR.toFixed(3) : "—"}
                    </span>{" "}
                    · win{" "}
                    <span className="font-mono text-zinc-200">
                      {Number.isFinite(rMultipleTargets.best?.winRate) ? `${(rMultipleTargets.best!.winRate * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>

                {rMultipleTargets.n === 0 ? (
                  <div className="py-10 text-center text-sm text-zinc-500">Žádné obchody pro výpočet (filtry jsou moc přísné).</div>
                ) : (
                  <div className="w-full">
                    {(() => {
                      const pts = rMultipleTargets.points;
                      const ys = pts.map((p) => p.expectancyR);
                      const yMin = Math.min(...ys, 0);
                      const yMax = Math.max(...ys, 0);
                      const pad = Math.max(0.15, (yMax - yMin) * 0.08);
                      const lo = yMin - pad;
                      const hi = yMax + pad;
                      const w = 840;
                      const h = 220;
                      const padL = 52;
                      const padR = 10;
                      const padT = 10;
                      const padB = 18;
                      const plotW = Math.max(1, w - padL - padR);
                      const plotH = Math.max(1, h - padT - padB);
                      const xFor = (i: number) => padL + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * plotW);
                      const yFor = (v: number) => {
                        if (hi - lo < 1e-9) return padT + plotH / 2;
                        return padT + (plotH - ((v - lo) / (hi - lo)) * plotH);
                      };
                      const zeroY = yFor(0);
                      const path = pts
                        .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.expectancyR).toFixed(2)}`)
                        .join(" ");
                      const bestIdx = pts.findIndex((p) => p.targetR === rMultipleTargets.best.targetR);
                      const yTicks = 5;
                      const tickVals: number[] = Array.from({ length: yTicks }, (_, i) => lo + (i / (yTicks - 1)) * (hi - lo));
                      return (
                        <div className="overflow-x-auto">
                          <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[680px] h-[220px]">
                            <rect x="0" y="0" width={w} height={h} fill="rgba(24,24,27,0.35)" />
                            {/* Y-axis grid + labels */}
                            {tickVals.map((v, i) => {
                              const y = yFor(v);
                              const isZero = Math.abs(v) < Math.max(1e-9, (hi - lo) * 0.02);
                              return (
                                <g key={i}>
                                  <line
                                    x1={padL}
                                    y1={y}
                                    x2={w - padR}
                                    y2={y}
                                    stroke={isZero ? "rgba(161,161,170,0.45)" : "rgba(113,113,122,0.25)"}
                                    strokeWidth={isZero ? 1.2 : 1}
                                  />
                                  <text
                                    x={padL - 8}
                                    y={y}
                                    textAnchor="end"
                                    dominantBaseline="middle"
                                    fill="rgba(161,161,170,0.75)"
                                    fontSize="10"
                                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                  >
                                    {v.toFixed(2)}
                                  </text>
                                </g>
                              );
                            })}
                            {/* Y-axis title */}
                            <text
                              x="14"
                              y={padT + plotH / 2}
                              transform={`rotate(-90 14 ${padT + plotH / 2})`}
                              textAnchor="middle"
                              fill="rgba(161,161,170,0.85)"
                              fontSize="11"
                              fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
                            >
                              Expectancy (R/trade)
                            </text>

                            <path d={path} fill="none" stroke="rgba(16,185,129,0.9)" strokeWidth="2.5" />
                            {pts.map((p, i) => {
                              const cx = xFor(i);
                              const cy = yFor(p.expectancyR);
                              const isBest = i === bestIdx;
                              return (
                                <g key={p.targetR}>
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={isBest ? 6 : 4}
                                    fill={isBest ? "rgba(251,191,36,0.95)" : "rgba(16,185,129,0.9)"}
                                    stroke="rgba(0,0,0,0.35)"
                                    strokeWidth="1"
                                  >
                                    <title>{`Target ${p.targetR}R\nExpectancy ${p.expectancyR.toFixed(3)}R\nWin ${(p.winRate * 100).toFixed(1)}%`}</title>
                                  </circle>
                                </g>
                              );
                            })}
                          </svg>
                          <div className="mt-2 grid grid-cols-5 sm:grid-cols-10 gap-1 text-[10px] text-zinc-500">
                            {rMultipleTargets.points.map((p) => (
                              <div
                                key={p.targetR}
                                className={`text-center font-mono px-1 py-0.5 rounded border ${
                                  p.targetR === rMultipleTargets.best.targetR
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                                    : "border-zinc-800/80 bg-zinc-950/20"
                                }`}
                                title={`Expectancy ${p.expectancyR.toFixed(3)}R · Win ${(p.winRate * 100).toFixed(1)}%`}
                              >
                                {p.targetR}R
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
                      Osa X: cílové \(R\) (1–10). Osa Y: expectancy v \(R\) na trade (winners \(+R\), zbytek \(−1R\)).
                    </div>
                  </div>
                )}
              </div>
            )}

            {statsTab === "sl" && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">SL sweep</div>
                    <div className="mt-1 text-sm text-zinc-300">
                      Osa X: <span className="font-mono text-zinc-200">SL mult</span> · Osa Y:{" "}
                      <span className="font-mono text-zinc-200">expectancy (R)</span> pro target{" "}
                      <span className="font-mono text-zinc-200">{Number(slSweep?.winner_rr ?? lastRequest?.winner_rr ?? 1.5)}</span>
                      R: <span className="font-mono text-zinc-200">+R</span> pokud dosaženo před SL, jinak{" "}
                      <span className="font-mono text-zinc-200">−1R</span>.
                    </div>
                  </div>
                  {slSweepItems.length ? (
                    <div className="text-xs text-zinc-400">
                      Best:{" "}
                      <span className="font-mono text-emerald-300">{slSweepBest ?? "—"}</span> · step{" "}
                      <span className="font-mono text-zinc-200">{slSweep?.step ?? 0.05}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">Sweep není zapnutý v nastavení.</div>
                  )}
                </div>

                {!slSweepItems.length ? (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    Zapni <span className="font-mono text-zinc-300">SL sweep</span> v nastavení a spusť backtest znovu.
                  </div>
                ) : (
                  <div className="w-full">
                    {(() => {
                      const pts = slSweepItems;
                      const ys = pts.map((p) => (p.expectancy_r == null ? 0 : Number(p.expectancy_r)));
                      const yMin = Math.min(...ys, 0);
                      const yMax = Math.max(...ys, 0);
                      const pad = Math.max(0.15, (yMax - yMin) * 0.08);
                      const lo = yMin - pad;
                      const hi = yMax + pad;
                      const w = 840;
                      const h = 240;
                      const padL = 56;
                      const padR = 12;
                      const padT = 12;
                      const padB = 34;
                      const plotW = Math.max(1, w - padL - padR);
                      const plotH = Math.max(1, h - padT - padB);
                      const xFor = (i: number) => padL + (pts.length <= 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
                      const yFor = (v: number) => {
                        if (hi - lo < 1e-9) return padT + plotH / 2;
                        return padT + (plotH - ((v - lo) / (hi - lo)) * plotH);
                      };
                      const zeroY = yFor(0);
                      const path = pts
                        .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(Number(p.expectancy_r ?? 0)).toFixed(2)}`)
                        .join(" ");
                      const sel = slTabSelected;
                      const selIdx = sel == null ? -1 : pts.findIndex((p) => Number(p.sl_mult) === Number(sel));
                      const bestIdx = slSweepBest == null ? -1 : pts.findIndex((p) => Number(p.sl_mult) === Number(slSweepBest));
                      const onPick = (i: number) => {
                        const v = pts[i]?.sl_mult;
                        if (v == null) return;
                        setSlTabSelected(Number(v));
                      };
                      const selectedRow = selIdx >= 0 ? pts[selIdx] : pts[0]!;
                      const yTicks = 5;
                      const tickVals: number[] = Array.from({ length: yTicks }, (_, i) => lo + (i / (yTicks - 1)) * (hi - lo));
                      const xLabelStride = Math.max(1, Math.ceil(pts.length / 12));
                      return (
                        <>
                          <div className="overflow-x-auto">
                            <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[720px] h-[240px]">
                              <rect x="0" y="0" width={w} height={h} fill="rgba(24,24,27,0.35)" />
                              {/* Y-axis grid + labels */}
                              {tickVals.map((v, i) => {
                                const y = yFor(v);
                                const isZero = Math.abs(v) < Math.max(1e-9, (hi - lo) * 0.02);
                                return (
                                  <g key={`yt-${i}`}>
                                    <line
                                      x1={padL}
                                      y1={y}
                                      x2={w - padR}
                                      y2={y}
                                      stroke={isZero ? "rgba(161,161,170,0.45)" : "rgba(113,113,122,0.22)"}
                                      strokeWidth={isZero ? 1.2 : 1}
                                    />
                                    <text
                                      x={padL - 8}
                                      y={y}
                                      textAnchor="end"
                                      dominantBaseline="middle"
                                      fill="rgba(161,161,170,0.8)"
                                      fontSize="10"
                                      fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                    >
                                      {v.toFixed(2)}
                                    </text>
                                  </g>
                                );
                              })}
                              <text
                                x="12"
                                y={padT + plotH / 2}
                                transform={`rotate(-90 12 ${padT + plotH / 2})`}
                                textAnchor="middle"
                                fill="rgba(161,161,170,0.85)"
                                fontSize="11"
                                fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
                              >
                                Expectancy (R)
                              </text>
                              {/* Plot frame */}
                              <line
                                x1={padL}
                                y1={padT + plotH}
                                x2={w - padR}
                                y2={padT + plotH}
                                stroke="rgba(82,82,91,0.55)"
                                strokeWidth={1}
                              />
                              {lo <= 0 && hi >= 0 ? (
                                <line
                                  x1={padL}
                                  y1={zeroY}
                                  x2={w - padR}
                                  y2={zeroY}
                                  stroke="rgba(161,161,170,0.5)"
                                  strokeWidth={1.2}
                                />
                              ) : null}
                              <path d={path} fill="none" stroke="rgba(16,185,129,0.9)" strokeWidth={2.25} />
                              {pts.map((p, i) => {
                                const x = xFor(i);
                                const y = yFor(Number(p.expectancy_r ?? 0));
                                const isSel = i === selIdx;
                                const isBest = i === bestIdx;
                                const r = isSel ? 5 : 3.5;
                                const fill = isBest ? "rgba(34,197,94,0.95)" : isSel ? "rgba(56,189,248,0.95)" : "rgba(244,244,245,0.55)";
                                const exp = p.expectancy_r == null ? "—" : Number(p.expectancy_r).toFixed(3);
                                return (
                                  <g key={String(p.sl_mult)} onClick={() => onPick(i)} style={{ cursor: "pointer" }}>
                                    <circle cx={x} cy={y} r={r} fill={fill} stroke="rgba(0,0,0,0.35)" strokeWidth={1}>
                                      <title>{`SL mult ${Number(p.sl_mult).toFixed(2)}\nExpectancy ${exp} R\nWin ${p.win_rate == null ? "—" : `${(Number(p.win_rate) * 100).toFixed(1)}%`}`}</title>
                                    </circle>
                                    {i % xLabelStride === 0 || i === pts.length - 1 ? (
                                      <text
                                        x={x}
                                        y={padT + plotH + 14}
                                        textAnchor="middle"
                                        fill="rgba(161,161,170,0.85)"
                                        fontSize="9"
                                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                      >
                                        {Number(p.sl_mult).toFixed(2)}
                                      </text>
                                    ) : null}
                                  </g>
                                );
                              })}
                              <text
                                x={padL + plotW / 2}
                                y={h - 4}
                                textAnchor="middle"
                                fill="rgba(161,161,170,0.85)"
                                fontSize="11"
                                fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
                              >
                                SL mult
                              </text>
                            </svg>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-zinc-400">
                              Vybráno: <span className="font-mono text-zinc-100">{Number(selectedRow.sl_mult).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={Number(selectedRow.sl_mult)}
                                onChange={(e) => setSlTabSelected(Number(e.target.value))}
                                className="text-xs rounded border border-zinc-700 bg-zinc-950/40 px-2 py-1 text-zinc-200 font-mono"
                              >
                                {pts.map((p) => (
                                  <option key={String(p.sl_mult)} value={Number(p.sl_mult)}>
                                    {Number(p.sl_mult).toFixed(2)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Expectancy (R)</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">
                                {selectedRow.expectancy_r == null ? "—" : Number(selectedRow.expectancy_r).toFixed(3)}
                              </div>
                            </div>
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Win rate</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                                {selectedRow.win_rate == null ? "—" : `${(Number(selectedRow.win_rate) * 100).toFixed(1)}%`}
                              </div>
                            </div>
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Touches</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{selectedRow.touch_count ?? 0}</div>
                            </div>
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø bars to target</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-sky-200/90">
                                {selectedRow.avg_bars_to_target == null ? "—" : Number(selectedRow.avg_bars_to_target).toFixed(1)}
                              </div>
                            </div>
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø MFE (R)</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-100/90">
                                {selectedRow.avg_mfe_r == null ? "—" : Number(selectedRow.avg_mfe_r).toFixed(3)}
                              </div>
                            </div>
                            <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø MAE (R)</div>
                              <div className="mt-2 text-2xl font-semibold tabular-nums text-rose-100/85">
                                {selectedRow.avg_mae_r == null ? "—" : Number(selectedRow.avg_mae_r).toFixed(3)}
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {statsTab === "prop" && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Prop firm simulator (Monte Carlo)</div>
                    <div className="mt-1 text-sm text-zinc-300">
                      Vše v <span className="font-mono text-zinc-200">%</span> účtu: zisk z <span className="font-mono text-zinc-200">MFE</span> před SL (omezeno na target profit), ztráta z{" "}
                      <span className="font-mono text-zinc-200">MAE</span> (až 1× risk).{" "}
                      Risk 1R = <span className="font-mono text-zinc-200">{propSim.riskPct.toFixed(2)}%</span>. Kap výhry: max{" "}
                      <span className="font-mono text-zinc-200">{propSim.consistencyPct.toFixed(0)}%</span> z challenge targetu na jeden obchod.
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Runs: <span className="font-mono text-zinc-200">{propSim.runs}</span> · seed{" "}
                    <span className="font-mono text-zinc-200">{propSeed}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Target profit %</div>
                    <input
                      type="number"
                      step={0.05}
                      min={0.05}
                      max={100}
                      value={propProfitTakePct}
                      onChange={(e) => setPropProfitTakePct(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                    <div className="mt-1 text-[10px] text-zinc-600">
                      Bank, pokud <span className="font-mono">MFE</span> dosáhne před SL (≈{" "}
                      <span className="font-mono">{(propProfitTakePct / Math.max(0.01, propRiskPct)).toFixed(2)}</span>
                      R při risk {propRiskPct}%)
                    </div>
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Risk %</div>
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      value={propRiskPct}
                      onChange={(e) => setPropRiskPct(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Target %</div>
                    <input
                      type="number"
                      step={0.25}
                      min={0.25}
                      value={propTargetPct}
                      onChange={(e) => setPropTargetPct(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Max DD %</div>
                    <input
                      type="number"
                      step={0.25}
                      min={0.25}
                      value={propMaxDdPct}
                      onChange={(e) => setPropMaxDdPct(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Consistency %</div>
                    <input
                      type="number"
                      step={1}
                      min={0}
                      max={100}
                      value={propConsistencyPct}
                      onChange={(e) => setPropConsistencyPct(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Runs</div>
                    <input
                      type="number"
                      step={50}
                      min={50}
                      max={3000}
                      value={propRuns}
                      onChange={(e) => setPropRuns(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                  <label className="rounded-lg border border-zinc-700/70 bg-zinc-950/20 px-3 py-2 text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Seed</div>
                    <input
                      type="number"
                      step={1}
                      value={propSeed}
                      onChange={(e) => setPropSeed(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                    />
                  </label>
                </div>

                {!propSim.ok ? (
                  <div className="py-10 text-center text-sm text-zinc-500">{propSim.reason}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Chance to pass</div>
                        <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-200/95">
                          {(propSim.successProb * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø time to pass (bars)</div>
                        <div className="mt-2 text-2xl font-semibold tabular-nums text-sky-200/90">
                          {propSim.avgBarsToSuccess == null ? "—" : propSim.avgBarsToSuccess.toFixed(1)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ø time to pass (days)</div>
                        <div className="mt-2 text-2xl font-semibold tabular-nums text-violet-200/90">
                          {propSim.avgDaysToSuccess == null ? "—" : propSim.avgDaysToSuccess.toFixed(1)}
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-600">
                          TF: <span className="font-mono">{currentChartTf}</span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 ring-1 ring-zinc-800/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Rules</div>
                        <div className="mt-2 text-xs text-zinc-300 leading-relaxed">
                          Pass: kumulativní zisk ≥ challenge target. Fail: DD od peaku ≥{" "}
                          <span className="font-mono">{propSim.maxDdPct.toFixed(2)}%</span>. Vzorky = náhodné obchody z filtru; PnL jen z % (MFE/MAE).
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const curves = propSim.curves;
                      const showN = Math.min(60, curves.length);
                      const pick = curves.slice(0, showN);
                      const w = 840;
                      const h = 240;
                      const padL = 52;
                      const padR = 10;
                      const padT = 10;
                      const padB = 22;
                      const plotW = Math.max(1, w - padL - padR);
                      const plotH = Math.max(1, h - padT - padB);
                      const allY = pick.flatMap((c) => c);
                      const yMin = Math.min(...allY, -propSim.maxDdPct, 0);
                      const yMax = Math.max(...allY, propSim.targetPct, 0);
                      const padY = Math.max(0.5, (yMax - yMin) * 0.08);
                      const lo = yMin - padY;
                      const hi = yMax + padY;
                      const yFor = (v: number) => {
                        if (hi - lo < 1e-9) return padT + plotH / 2;
                        return padT + (plotH - ((v - lo) / (hi - lo)) * plotH);
                      };
                      const maxLen = Math.max(...pick.map((c) => c.length));
                      const xFor = (i: number) => padL + (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * plotW);
                      const targetY = yFor(propSim.targetPct);
                      const ddY = yFor(-propSim.maxDdPct);
                      const zeroY = yFor(0);
                      const ticks = 5;
                      const tickVals: number[] = Array.from({ length: ticks }, (_, i) => lo + (i / (ticks - 1)) * (hi - lo));
                      const mkPath = (c: number[]) =>
                        c.map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(v).toFixed(2)}`).join(" ");
                      return (
                        <div className="overflow-x-auto">
                          <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[720px] h-[240px]">
                            <rect x="0" y="0" width={w} height={h} fill="rgba(24,24,27,0.35)" />
                            {tickVals.map((v, i) => (
                              <g key={i}>
                                <line x1={padL} y1={yFor(v)} x2={w - padR} y2={yFor(v)} stroke="rgba(113,113,122,0.25)" strokeWidth={1} />
                                <text
                                  x={padL - 8}
                                  y={yFor(v)}
                                  textAnchor="end"
                                  dominantBaseline="middle"
                                  fill="rgba(161,161,170,0.75)"
                                  fontSize="10"
                                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                >
                                  {v.toFixed(0)}%
                                </text>
                              </g>
                            ))}
                            <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="rgba(161,161,170,0.35)" strokeWidth={1} />
                            <line x1={padL} y1={targetY} x2={w - padR} y2={targetY} stroke="rgba(34,197,94,0.55)" strokeWidth={1.2} strokeDasharray="5 4" />
                            <line x1={padL} y1={ddY} x2={w - padR} y2={ddY} stroke="rgba(244,63,94,0.55)" strokeWidth={1.2} strokeDasharray="5 4" />

                            {pick.map((c, i) => (
                              <path key={i} d={mkPath(c)} fill="none" stroke="rgba(56,189,248,0.18)" strokeWidth={1.2} />
                            ))}

                            <text
                              x="14"
                              y={padT + plotH / 2}
                              transform={`rotate(-90 14 ${padT + plotH / 2})`}
                              textAnchor="middle"
                              fill="rgba(161,161,170,0.85)"
                              fontSize="11"
                              fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
                            >
                              Equity % (from start)
                            </text>
                          </svg>
                          <div className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                            Každá čára = 1 run (prvních {showN}). Osa Y = kumulativní % účtu od startu. Zelená = challenge target, červená = max DD.
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            {statsTab === "zones" && (
              <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/45 p-4 shadow-lg shadow-black/25 ring-1 ring-zinc-800/40">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Zones — best R target podle TF zóny</div>
                    <div className="mt-1 text-sm text-zinc-300">
                      Každý TF má vlastní křivku <span className="font-mono text-zinc-200">targetR 1–10 → expectancy (R/trade)</span>, kde win = \(+\)R (hit před SL), jinak \(−1R\).
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400">
                    TFs: <span className="font-mono text-zinc-200">{zonesByTf.length}</span>
                  </div>
                </div>

                {!zonesByTf.length ? (
                  <div className="py-10 text-center text-sm text-zinc-500">Žádná data (filtry jsou moc přísné).</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {zonesByTf.map((z) => {
                      const pts = z.points;
                      const ys = pts.map((p) => p.expectancyR);
                      const yMin = Math.min(...ys, 0);
                      const yMax = Math.max(...ys, 0);
                      const pad = Math.max(0.15, (yMax - yMin) * 0.08);
                      const lo = yMin - pad;
                      const hi = yMax + pad;
                      const w = 520;
                      const h = 170;
                      const padL = 44;
                      const padR = 10;
                      const padT = 10;
                      const padB = 18;
                      const plotW = Math.max(1, w - padL - padR);
                      const plotH = Math.max(1, h - padT - padB);
                      const xFor = (i: number) => padL + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * plotW);
                      const yFor = (v: number) => {
                        if (hi - lo < 1e-9) return padT + plotH / 2;
                        return padT + (plotH - ((v - lo) / (hi - lo)) * plotH);
                      };
                      const zeroY = yFor(0);
                      const path = pts
                        .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.expectancyR).toFixed(2)}`)
                        .join(" ");
                      const bestIdx = pts.findIndex((p) => p.targetR === z.best.targetR);
                      const ticks = 3;
                      const tickVals: number[] = Array.from({ length: ticks }, (_, i) => lo + (i / (ticks - 1)) * (hi - lo));
                      return (
                        <div key={z.tf} className="rounded-xl border border-zinc-700/70 bg-zinc-950/30 p-4 ring-1 ring-zinc-800/40">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <div className="text-xs font-semibold text-zinc-100 font-mono">{z.tf}</div>
                              <div className="mt-0.5 text-[11px] text-zinc-500">
                                n=<span className="font-mono text-zinc-300">{z.n}</span> · best{" "}
                                <span className="font-mono text-emerald-300">{z.best.targetR}R</span> · exp{" "}
                                <span className="font-mono text-zinc-200">{z.best.expectancyR.toFixed(3)}</span> · win{" "}
                                <span className="font-mono text-zinc-200">{(z.best.winRate * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[520px] h-[170px]">
                              <rect x="0" y="0" width={w} height={h} fill="rgba(24,24,27,0.25)" />
                              {tickVals.map((v, i) => (
                                <g key={i}>
                                  <line x1={padL} y1={yFor(v)} x2={w - padR} y2={yFor(v)} stroke="rgba(113,113,122,0.22)" strokeWidth={1} />
                                  <text
                                    x={padL - 6}
                                    y={yFor(v)}
                                    textAnchor="end"
                                    dominantBaseline="middle"
                                    fill="rgba(161,161,170,0.72)"
                                    fontSize="10"
                                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                  >
                                    {v.toFixed(1)}
                                  </text>
                                </g>
                              ))}
                              <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="rgba(161,161,170,0.35)" strokeWidth={1} />
                              <path d={path} fill="none" stroke="rgba(56,189,248,0.85)" strokeWidth={2.2} />
                              {pts.map((p, i) => {
                                const cx = xFor(i);
                                const cy = yFor(p.expectancyR);
                                const isBest = i === bestIdx;
                                return (
                                  <g key={p.targetR}>
                                    <circle
                                      cx={cx}
                                      cy={cy}
                                      r={isBest ? 5.5 : 3.5}
                                      fill={isBest ? "rgba(34,197,94,0.95)" : "rgba(56,189,248,0.85)"}
                                      stroke="rgba(0,0,0,0.35)"
                                      strokeWidth="1"
                                    >
                                      <title>{`TF ${z.tf}\nTarget ${p.targetR}R\nExpectancy ${p.expectancyR.toFixed(3)}R\nWin ${(p.winRate * 100).toFixed(1)}%`}</title>
                                    </circle>
                                  </g>
                                );
                              })}
                              <text
                                x="14"
                                y={padT + plotH / 2}
                                transform={`rotate(-90 14 ${padT + plotH / 2})`}
                                textAnchor="middle"
                                fill="rgba(161,161,170,0.82)"
                                fontSize="10.5"
                                fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
                              >
                                Expectancy (R/trade)
                              </text>
                            </svg>
                          </div>
                          <div className="mt-2 grid grid-cols-5 sm:grid-cols-10 gap-1 text-[10px] text-zinc-500">
                            {pts.map((p) => (
                              <div
                                key={p.targetR}
                                className={`text-center font-mono px-1 py-0.5 rounded border ${
                                  p.targetR === z.best.targetR
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                    : "border-zinc-800/80 bg-zinc-950/20"
                                }`}
                                title={`Expectancy ${p.expectancyR.toFixed(3)}R · Win ${(p.winRate * 100).toFixed(1)}%`}
                              >
                                {p.targetR}R
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </div>
        <div className="shrink-0 lg:w-[420px] flex flex-col min-h-0 max-h-[50vh] lg:max-h-none">
          <details open className="border-b border-zinc-800">
            <summary className="p-2 cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200">
              Zobrazení (klikem zap/vyp)
            </summary>
            <div className="px-2 pb-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-300">
                {(
                  [
                    ["demand_supply_zones", `Demand/Supply zóny (${viewCounts.zones_ds})`] as const,
                    ["bos_levels", `BOS zóny (levels) (${viewCounts.zones_bos})`] as const,
                    ["swing_hl", `Swing HL + BOS markery (${viewCounts.markers_swing_bos})`] as const,
                    ["inducement_points", `Inducement points (${viewCounts.inducement_points})`] as const,
                    ["lines", `Čáry (indikátory) (${viewCounts.lines_total})`] as const,
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={viewVis[key]}
                      onChange={(e) => setViewVis((v) => ({ ...v, [key]: e.target.checked }))}
                      className="accent-emerald-600"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>

          <details open className="border-b border-zinc-800">
            <summary className="p-2 cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200">
              Trade overlay
            </summary>
            <div className="px-2 pb-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-300">
                {(
                  [
                    ["zoneMeta", "Metadata zóny"] as const,
                    ["touchMarker", "Touch marker"] as const,
                    ["tradeLevels", "Entry/SL/MFE/MAE (úrovně)"] as const,
                    ["tradeBars", "Entry/MFE/SL (svisle)"] as const,
                    ["tradeLevelLabels", "Popisky úrovní"] as const,
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(tradeVis as any)[key]}
                      onChange={(e) => setTradeVis((v) => ({ ...v, [key]: e.target.checked } as any))}
                      className="accent-emerald-600"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
          <div className="p-2 flex items-center gap-2 border-b border-zinc-800">
            <button type="button" className="px-2 py-1 rounded bg-zinc-800 text-xs" onClick={goPrev} disabled={selectedIdx <= 0}>
              ←
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded bg-zinc-800 text-xs"
              onClick={goNext}
              disabled={selectedIdx >= filtered.length - 1}
            >
              →
            </button>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtr zone_id / TF…"
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
            />
          </div>
          {selected && (
            <div className="px-3 py-2 text-[11px] text-zinc-400 space-y-0.5 border-b border-zinc-800 shrink-0">
              <div>
                Entry bar {selected.entry_bar} · price {selected.entry_price?.toFixed?.(4) ?? selected.entry_price}
              </div>
              <div>
                SL {selected.stop_price?.toFixed?.(4) ?? selected.stop_price} · MFE {selected.mfe_R?.toFixed?.(2)}R · MAE{" "}
                {selected.mae_R?.toFixed?.(2)}R
              </div>
              {selected.duration_bars != null && (
                <div>Duration {selected.duration_bars} bars</div>
              )}
              {selected.mfe_usd != null && (
                <div>
                  MFE USD {selected.mfe_usd.toFixed(2)} · MAE USD {selected.mae_usd?.toFixed?.(2)}
                </div>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto text-xs">
            <details open className="border-b border-zinc-800">
              <summary className="p-2 cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200">
                Filtry
              </summary>
              <div className="px-2 pb-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-zinc-500">Nastavení filtrů</div>
                  <button
                    type="button"
                    onClick={() => {
                      setTfSelected(tfOptions);
                      setMfeMin(null);
                      setMfeMax(null);
                      setMfeRangeStrict(true);
                      setDateFrom("");
                      setDateTo("");
                      setLosersOnly(false);
                      setGe1(false);
                      setGe15(false);
                      setGe2(false);
                      setGe3(false);
                      setConfigMinMfeR(null);
                    }}
                    className="px-2 py-1 rounded text-[11px] border bg-zinc-900/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800/70"
                  >
                    Reset
                  </button>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
                  <div className="text-[11px] text-zinc-500 mb-1.5">Konfigurace: min. dosažené MFE (R)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12px] font-mono text-zinc-200"
                      placeholder="např. 2"
                      value={configMinMfeR ?? ""}
                      onChange={(e) => {
                        const s = e.target.value.trim();
                        if (s === "") {
                          setConfigMinMfeR(null);
                          return;
                        }
                        const n = Number(s);
                        setConfigMinMfeR(Number.isFinite(n) ? n : null);
                      }}
                      lang="en"
                      type="number"
                      step={0.25}
                      min={0}
                    />
                    <div className="flex flex-wrap gap-1">
                      {([1, 1.5, 2, 3] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setConfigMinMfeR(v)}
                          className={`px-2 py-1 rounded text-[11px] border font-mono ${
                            configMinMfeR === v
                              ? "bg-violet-900/50 border-violet-600/50 text-violet-100"
                              : "bg-zinc-900/70 border-zinc-700 text-zinc-300 hover:bg-zinc-800/70"
                          }`}
                        >
                          {v}R
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setConfigMinMfeR(null)}
                        className="px-2 py-1 rounded text-[11px] border border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:bg-zinc-800/70"
                      >
                        Vše
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1.5 leading-snug">
                    Zobrazí jen obchody s MFE ≥ zadané R; statistiky pod grafem se přepočítají na stejnou podmnožinu.
                  </p>
                </div>

                <details open className="rounded border border-zinc-800 bg-zinc-950/20">
                  <summary className="px-2 py-1.5 cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center justify-between">
                    <span>Timeframes</span>
                    <span className="text-zinc-600 font-mono">{tfSelected.length}/{tfOptions.length}</span>
                  </summary>
                  <div className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {tfOptions.map((tf) => {
                        const on = tfSelected.includes(tf);
                        const cnt = tfCounts.get(tf) ?? 0;
                        const disabled = cnt === 0;
                        return (
                          <button
                            key={tf}
                            type="button"
                            disabled={disabled}
                            title={disabled ? "V datech nejsou žádné obchody pro tento TF" : `${cnt} tradeů`}
                            onClick={() =>
                              setTfSelected((prev) =>
                                prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf]
                              )
                            }
                            className={`px-2 py-1 rounded text-[11px] border font-mono ${
                              disabled
                                ? "bg-zinc-950/40 border-zinc-800 text-zinc-700 cursor-not-allowed"
                                : on
                                  ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-200"
                                  : "bg-zinc-900/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800/60"
                            }`}
                          >
                            {tf}
                            {!disabled ? <span className="text-zinc-500"> · {cnt}</span> : null}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setTfSelected(tfOptions.filter((tf) => (tfCounts.get(tf) ?? 0) > 0))}
                        className="px-2 py-1 rounded text-[11px] border bg-zinc-900/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800/70"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setTfSelected([])}
                        className="px-2 py-1 rounded text-[11px] border bg-zinc-900/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800/70"
                      >
                        None
                      </button>
                    </div>
                  </div>
                </details>

                <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">MFE (R)</div>
                  <div className="flex gap-2">
                    <input
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-mono"
                      placeholder="min"
                      value={mfeMin ?? ""}
                      onChange={(e) => setMfeMin(e.target.value.trim() === "" ? null : Number(e.target.value))}
                      lang="en"
                      type="number"
                      step={0.1}
                    />
                    <input
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-mono"
                      placeholder="max"
                      value={mfeMax ?? ""}
                      onChange={(e) => setMfeMax(e.target.value.trim() === "" ? null : Number(e.target.value))}
                      lang="en"
                      type="number"
                      step={0.1}
                    />
                  </div>
                  <label className="mt-2 flex items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mfeRangeStrict}
                      onChange={(e) => setMfeRangeStrict(e.target.checked)}
                      className="accent-emerald-600 mt-0.5 shrink-0"
                    />
                    <span className="text-[10px] text-zinc-400 leading-snug">
                      <span className="text-zinc-300">Pouze v rozpětí</span> — MFE musí ležet mezi min a max (uzavřený interval).
                      <span className="block mt-1 text-zinc-500">
                        Vypnuto = <span className="text-zinc-400">alespoň rozmezí</span>: při dvou hodnotách platí{" "}
                        <span className="font-mono text-emerald-600/90">MFE ≥ vyšší z min/max</span>; jen min →{" "}
                        <span className="font-mono text-emerald-600/90">MFE ≥ min</span>; jen max →{" "}
                        <span className="font-mono text-emerald-600/90">MFE ≥ max</span>.
                      </span>
                    </span>
                  </label>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">Datum</div>
                  <div className="flex gap-2">
                    <input
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-mono"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      type="date"
                    />
                    <input
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] font-mono"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      type="date"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Prahy</div>
                <div className="flex flex-wrap gap-3 text-[11px] text-zinc-300">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={losersOnly}
                      onChange={(e) => setLosersOnly(e.target.checked)}
                      className="accent-emerald-600"
                    />
                    losers
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={ge1} onChange={(e) => setGe1(e.target.checked)} className="accent-emerald-600" />
                    ≥1R
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={ge15} onChange={(e) => setGe15(e.target.checked)} className="accent-emerald-600" />
                    ≥1.5R
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={ge2} onChange={(e) => setGe2(e.target.checked)} className="accent-emerald-600" />
                    ≥2R
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={ge3} onChange={(e) => setGe3(e.target.checked)} className="accent-emerald-600" />
                    ≥3R
                  </label>
                </div>
              </div>
              </div>
            </details>

            <details open>
              <summary className="p-2 cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center justify-between">
                <span>Tabulka tradeů</span>
                <span className="text-zinc-600 font-mono">{filtered.length}</span>
              </summary>
              <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-zinc-900 z-10">
                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                  <th className="p-1.5">TF</th>
                  <th className="p-1.5">date</th>
                  <th className="p-1.5">entry</th>
                  <th className="p-1.5">SL</th>
                  <th className="p-1.5">MFE R</th>
                  <th className="p-1.5">MAE R</th>
                  <th className="p-1.5">dur</th>
                  <th className="p-1.5" title="Bary od entry do dřívějšího z max MFE a SL">
                    ΔMFE/SL
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ t, i }, rowPos) => {
                  const dMfeSl = durationToMfeOrSlBars(t);
                  const isLoser = t.sl_hit_bar != null;
                  const selected = rowPos === selectedIdx;
                  const rowBg = selected
                    ? "bg-emerald-950/45 ring-1 ring-inset ring-emerald-600/45"
                    : isLoser
                      ? "bg-rose-500/[0.07] hover:bg-rose-500/[0.11]"
                      : "bg-emerald-500/[0.07] hover:bg-emerald-500/[0.11]";
                  return (
                    <tr
                      key={tradeKey(t, i)}
                      className={`border-b border-zinc-800/80 cursor-pointer ${rowBg}`}
                      onClick={() => setSelectedIdx(rowPos)}
                    >
                      <td className="p-1.5 font-mono text-zinc-400">{t.source_tf}</td>
                      <td className="p-1.5 font-mono text-zinc-400">
                        {t.entry_bar != null && ohlcFull.length > 0
                          ? (ohlcFull[Math.max(0, Math.min(ohlcFull.length - 1, Number(t.entry_bar)))]?.date ?? "").slice(0, 10)
                          : "—"}
                      </td>
                      <td className="p-1.5 font-mono">{t.entry_price != null ? Number(t.entry_price).toFixed(4) : "—"}</td>
                      <td className="p-1.5 font-mono">{t.stop_price != null ? Number(t.stop_price).toFixed(4) : "—"}</td>
                      <td className="p-1.5 font-mono">{t.mfe_R != null ? Number(t.mfe_R).toFixed(2) : "—"}</td>
                      <td className="p-1.5 font-mono">{t.mae_R != null ? Number(t.mae_R).toFixed(2) : "—"}</td>
                      <td className="p-1.5 font-mono text-zinc-400">{t.duration_bars != null ? String(t.duration_bars) : "—"}</td>
                      <td className="p-1.5 font-mono text-zinc-500">{dMfeSl != null ? String(dMfeSl) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </details>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
