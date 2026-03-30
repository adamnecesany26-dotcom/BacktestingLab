import type { ModuleZone, OhlcBar } from "@shared/types";

function toDateKey(s: string): string {
  const raw = (s || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.slice(0, 10);
}

/**
 * When zone bounds are calendar dates (YYYY-MM-DD) but the chart is intraday,
 * stretch the rectangle to the first/last OHLC bar that falls on those days so
 * the box lines up with candles. Full ISO bounds are left unchanged.
 */
export function zoneTimeBoundsForOhlc(z: ModuleZone, ohlc: OhlcBar[]): { x0: string; x1: string } {
  const ds = z.date_start?.trim() ?? "";
  const de = z.date_end?.trim() ?? "";
  if (!ohlc.length) return { x0: ds, x1: de };

  const dayOnly =
    ds.length > 0 &&
    de.length > 0 &&
    ds.length <= 10 &&
    de.length <= 10 &&
    !ds.includes("T") &&
    !de.includes("T");

  if (!dayOnly) {
    return { x0: ds, x1: de };
  }

  const k0 = toDateKey(ds);
  const k1 = toDateKey(de);
  let x0: string | null = null;
  let x1: string | null = null;
  for (const b of ohlc) {
    const k = toDateKey(b.date);
    if (k >= k0 && k <= k1) {
      if (x0 === null) x0 = b.date;
      x1 = b.date;
    }
  }
  if (x0 !== null && x1 !== null) return { x0, x1 };
  return { x0: ds, x1: de };
}
