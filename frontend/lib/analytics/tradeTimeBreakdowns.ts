import type { Trade } from "@shared/types";

export type TimeBucketStat = {
  key: string;
  label: string;
  tradeCount: number;
  pnlSum: number;
  wins: number;
};

function exitMs(t: Trade): number | null {
  const s = t.exitDate ?? t.date ?? "";
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const CS_WD = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

export function tradesByWeekday(trades: Trade[]): TimeBucketStat[] {
  const acc = new Map<number, { pnl: number; n: number; w: number }>();
  for (let i = 0; i < 7; i++) acc.set(i, { pnl: 0, n: 0, w: 0 });
  for (const t of trades) {
    const ms = exitMs(t);
    if (ms == null) continue;
    const d = new Date(ms);
    const wd = d.getDay();
    const pnl = t.pnl ?? 0;
    const cur = acc.get(wd)!;
    cur.n++;
    cur.pnl += pnl;
    if (pnl > 0) cur.w++;
  }
  // Monday-first display: Po–Ne
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((wd) => {
    const cur = acc.get(wd)!;
    return {
      key: String(wd),
      label: CS_WD[wd] ?? String(wd),
      tradeCount: cur.n,
      pnlSum: cur.pnl,
      wins: cur.w,
    };
  });
}

export function tradesByHourLocal(trades: Trade[]): TimeBucketStat[] {
  const acc = new Map<number, { pnl: number; n: number; w: number }>();
  for (let h = 0; h < 24; h++) acc.set(h, { pnl: 0, n: 0, w: 0 });
  for (const t of trades) {
    const ms = exitMs(t);
    if (ms == null) continue;
    const h = new Date(ms).getHours();
    const pnl = t.pnl ?? 0;
    const cur = acc.get(h)!;
    cur.n++;
    cur.pnl += pnl;
    if (pnl > 0) cur.w++;
  }
  return Array.from({ length: 24 }, (_, h) => {
    const cur = acc.get(h)!;
    return {
      key: String(h),
      label: `${h}:00`,
      tradeCount: cur.n,
      pnlSum: cur.pnl,
      wins: cur.w,
    };
  });
}

export type CalendarPeriod = "day" | "week" | "month";

function startOfWeekIso(d: Date): string {
  const x = new Date(d.getTime());
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x.toISOString().slice(0, 10);
}

export function tradesByCalendarPeriod(trades: Trade[], period: CalendarPeriod): TimeBucketStat[] {
  const map = new Map<string, { pnl: number; n: number; w: number }>();
  for (const t of trades) {
    const ms = exitMs(t);
    if (ms == null) continue;
    const d = new Date(ms);
    let key: string;
    let label: string;
    if (period === "day") {
      key = d.toISOString().slice(0, 10);
      label = key;
    } else if (period === "week") {
      key = startOfWeekIso(d);
      label = `Týden ${key}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = key;
    }
    if (!map.has(key)) map.set(key, { pnl: 0, n: 0, w: 0 });
    const cur = map.get(key)!;
    const pnl = t.pnl ?? 0;
    cur.n++;
    cur.pnl += pnl;
    if (pnl > 0) cur.w++;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cur]) => ({
      key,
      label: period === "week" ? `Týden od ${key}` : key,
      tradeCount: cur.n,
      pnlSum: cur.pnl,
      wins: cur.w,
    }));
}

/** Histogram násobků R (rovnoměrné přihrádky + ocasy). */
export function rHistogramBuckets(
  rValues: number[],
  opts?: { min?: number; max?: number; binWidth?: number },
): { label: string; count: number }[] {
  const min = opts?.min ?? -5;
  const max = opts?.max ?? 5;
  const binWidth = opts?.binWidth ?? 0.5;
  const nBins = Math.max(1, Math.ceil((max - min) / binWidth));
  const bins: { label: string; count: number }[] = [];
  for (let i = 0; i < nBins; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    bins.push({
      label: `${lo.toFixed(1)}–${hi.toFixed(1)}`,
      count: 0,
    });
  }
  let tailLow = 0;
  let tailHigh = 0;
  for (const r of rValues) {
    if (!Number.isFinite(r)) continue;
    if (r < min) tailLow++;
    else if (r >= max) tailHigh++;
    else {
      const idx = Math.min(nBins - 1, Math.floor((r - min) / binWidth));
      bins[idx]!.count++;
    }
  }
  const out: { label: string; count: number }[] = [];
  if (tailLow) out.push({ label: `< ${min}`, count: tailLow });
  out.push(...bins);
  if (tailHigh) out.push({ label: `≥ ${max}`, count: tailHigh });
  return out;
}
