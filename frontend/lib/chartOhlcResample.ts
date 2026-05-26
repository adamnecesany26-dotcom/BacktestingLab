import type { OhlcBar } from "@shared/types";
import { instrumentTimeframeToMinutes } from "@/lib/viewChartTimeframe";

const TF_TO_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

/** Map manifest / run timeframe řetězce na klíč agregace v grafu (shodné s TF_TO_MS). */
export function manifestTfToChartKey(tf: string | null | undefined): keyof typeof TF_TO_MS | null {
  const t = (tf ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t in TF_TO_MS) return t as keyof typeof TF_TO_MS;
  if (t === "60m" || t === "60") return "1h";
  if (t === "1h" || t === "1hr" || t === "h1") return "1h";
  if (t === "4h" || t === "240m") return "4h";
  if (t === "1d" || t === "d1" || t === "daily" || t === "day") return "1d";
  if (t === "1w" || t === "w1" || t === "weekly") return "1w";
  return null;
}

/**
 * Výchozí výběr TF na záložce Graf detail: shodný s barami strategie (`workTimeframe`),
 * pokud je ze souboru agregovaný; jinak nativní dataset (`source`).
 */
export function defaultDetailedChartTfFromManifest(
  dataFileTf: string | null | undefined,
  strategyWorkTf: string | null | undefined
): string {
  const dk = manifestTfToChartKey(dataFileTf);
  const wk = manifestTfToChartKey(strategyWorkTf);
  if (!wk || !dk) return "source";
  if (wk === dk) return "source";
  const dMin = instrumentTimeframeToMinutes(dataFileTf ?? "");
  const wMin = instrumentTimeframeToMinutes(strategyWorkTf ?? "");
  if (wMin > dMin && TF_TO_MS[wk] != null) return wk;
  return "source";
}

/** Délka jedné svíčky (ms) pro osu X v Plotly — vždy podle **zobrazovaného** TF, ne medián mezer v datech. */
export function barPeriodMsForChartSelection(chartTf: string, dataFileNativeTf: string | null | undefined): number | null {
  if (chartTf !== "source") {
    const ms = TF_TO_MS[chartTf];
    return ms != null ? ms : null;
  }
  return nativeBarMsFromManifest(dataFileNativeTf);
}

/** Median spacing between consecutive bars (ms). */
export function inferMedianBarMs(ohlc: OhlcBar[]): number {
  if (!ohlc || ohlc.length < 2) return 24 * 60 * 60_000;
  const n = Math.min(ohlc.length - 1, 300);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Date.parse(ohlc[i]!.date);
    const b = Date.parse(ohlc[i + 1]!.date);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) diffs.push(b - a);
  }
  if (!diffs.length) return 24 * 60 * 60_000;
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(diffs.length / 2)]!;
}

function closestTfLabel(ms: number): string {
  let best = "30m";
  let bestD = Infinity;
  for (const [k, v] of Object.entries(TF_TO_MS)) {
    const d = Math.abs(Math.log(ms + 1) - Math.log(v + 1));
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Native bar size (ms): manifest / run TF, not spacing of downsampled `ohlc` in API (MAX_OHLC_EXPORT_BARS). */
function nativeBarMsFromManifest(nativeTf: string | undefined | null): number | null {
  const t = (nativeTf ?? "").trim();
  if (!t) return null;
  const m = instrumentTimeframeToMinutes(t);
  if (!Number.isFinite(m) || m <= 0) return null;
  return m * 60 * 1000;
}

/** Dropdown options: always "source", plus coarser standard TFs than **native** data TF. */
export function getChartTfSelectOptions(
  ohlc: OhlcBar[],
  nativeTf?: string | null,
  strategyWorkTf?: string | null
): { value: string; label: string }[] {
  const inferredMs = inferMedianBarMs(ohlc);
  const fromManifest = nativeBarMsFromManifest(nativeTf);
  const src = fromManifest ?? inferredMs;
  const nativeLabel = (nativeTf ?? "").trim();
  const approxLabel = closestTfLabel(inferredMs);
  const workKey = strategyWorkTf ? manifestTfToChartKey(strategyWorkTf) : null;
  const out: { value: string; label: string }[] = [
    {
      value: "source",
      label: nativeLabel ? `Dataset (${nativeLabel})` : `Dataset (~${approxLabel})`,
    },
  ];
  const order = ["5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
  for (const tf of order) {
    const ms = TF_TO_MS[tf];
    if (ms == null) continue;
    if (ms > src * 1.35) {
      const label = workKey === tf ? `${tf} (strategie)` : tf;
      out.push({ value: tf, label });
    }
  }
  return out;
}

function bucketKey(t: number, barMs: number): number {
  return Math.floor(t / barMs) * barMs;
}

/** Aggregate OHLC to coarser bars (time-bucket OHLC). */
export function resampleOhlcToBarMs(ohlc: OhlcBar[], barMs: number, srcMsOverride?: number): OhlcBar[] {
  if (!ohlc.length || barMs <= 0) return ohlc;
  const srcMs = srcMsOverride ?? inferMedianBarMs(ohlc);
  if (barMs <= srcMs * 1.05) return ohlc;

  const buckets = new Map<number, OhlcBar[]>();
  for (const b of ohlc) {
    const t = Date.parse(b.date);
    if (!Number.isFinite(t)) continue;
    const k = bucketKey(t, barMs);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(b);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keys.map((k) => {
    const bars = buckets.get(k)!;
    const first = bars[0]!;
    const last = bars[bars.length - 1]!;
    return {
      date: new Date(k).toISOString(),
      open: first.open,
      high: Math.max(...bars.map((x) => x.high)),
      low: Math.min(...bars.map((x) => x.low)),
      close: last.close,
    };
  });
}

export function resampleOhlcForChartChoice(
  ohlc: OhlcBar[],
  choice: string,
  nativeTf?: string | null
): OhlcBar[] {
  if (!ohlc.length || choice === "source") return ohlc;
  const ms = TF_TO_MS[choice];
  if (ms == null) return ohlc;
  const srcOverride = nativeBarMsFromManifest(nativeTf);
  return resampleOhlcToBarMs(ohlc, ms, srcOverride ?? undefined);
}

const DEFAULT_INTRADAY_STEP_SEC = 1800;

/**
 * Striktně rostoucí čas (sekundy od epoch) pro lightweight-charts candlestick/line.
 *
 * Když `date` nemá část dne nebo má duplicitní timestamp po sekundách, časová osa by jinak
 * dávala mezery řádu dnů (viz screenshot) – rozloží se podle mediánu kroku reálných sousedů,
 * jinak 30m jako bezpečný výchozí intraday krok.
 */
export function prepareOhlcUtcSecondsSeries(ohlc: OhlcBar[]): number[] {
  if (!ohlc.length) return [];
  const rawSec = ohlc.map((b) => {
    const ms = Date.parse(b.date);
    return Number.isFinite(ms) ? ms / 1000 : Number.NaN;
  });
  const diffs: number[] = [];
  for (let i = 1; i < rawSec.length; i++) {
    const a = rawSec[i - 1]!;
    const b = rawSec[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = b - a;
    if (d > 0.5 && d < 86400 * 7) diffs.push(d);
  }
  let stepSec = DEFAULT_INTRADAY_STEP_SEC;
  if (diffs.length > 0) {
    diffs.sort((x, y) => x - y);
    stepSec = diffs[Math.floor(diffs.length / 2)]!;
  }
  const tieBreak = Math.min(1e-3, stepSec * 1e-9);
  const out: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < rawSec.length; i++) {
    let t = Number.isFinite(rawSec[i]!)
      ? rawSec[i]!
      : Math.floor(Date.UTC(2020, 0, 1 + i) / 1000);
    if (t <= prev) t = prev + stepSec;
    if (t <= prev) t = prev + tieBreak;
    out.push(t);
    prev = t;
  }
  return out;
}

/** Text na osu času – vždy UTC z epochy, ať se neliší od skutečného uložení dat. */
export function formatChartAxisUtcLabel(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
