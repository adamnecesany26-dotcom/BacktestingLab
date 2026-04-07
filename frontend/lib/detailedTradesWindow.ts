import type { ModuleLineOutput, ModuleOutput, ModuleZone, OhlcBar, Trade } from "@shared/types";

export type DetailedViewMode = "by_trades" | "by_months";

function parseBarMs(s: string | undefined): number {
  if (!s) return NaN;
  return Date.parse(s);
}

/** Stejné parsování času jako u řady OHLC — vyhnout se posunu oproti `toISOString()` u naivních řetězců. */
function formatMsAlignedToOhlc(ms: number, windowOhlc: OhlcBar[]): string {
  const sample = windowOhlc.find((b) => b.date && b.date.length >= 10)?.date ?? "";
  const hasExplicitTz =
    /Z$/i.test(sample) || /[+-]\d{2}:\d{2}$/.test(sample) || /[+-]\d{4}$/.test(sample);
  if (hasExplicitTz || !sample) {
    return new Date(ms).toISOString();
  }
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** OHLC výřez + viditelné obchody pro Detailed záložku (výkon). */
export function computeDetailedChartWindow(
  ohlc: OhlcBar[],
  trades: Trade[],
  mode: DetailedViewMode,
  page: number,
  tradesPerView: number,
  monthsPerView: number
): {
  windowOhlc: OhlcBar[];
  visibleTrades: Trade[];
  summary: string;
  hasPrev: boolean;
  hasNext: boolean;
} {
  if (!ohlc.length) {
    return {
      windowOhlc: [],
      visibleTrades: [],
      summary: "Žádná OHLC data",
      hasPrev: false,
      hasNext: false,
    };
  }

  if (mode === "by_trades") {
    const per = Math.max(1, Math.min(100, Math.floor(tradesPerView)));
    const startIdx = page * per;
    const visible = trades.slice(startIdx, startIdx + per);
    const hasPrev = startIdx > 0;
    const hasNext = startIdx + per < trades.length;

    if (visible.length === 0) {
      return {
        windowOhlc: ohlc,
        visibleTrades: [],
        summary: `Žádné obchody na stránce ${page + 1}`,
        hasPrev,
        hasNext: false,
      };
    }

    let minT = Infinity;
    let maxT = -Infinity;
    for (const t of visible) {
      const e = parseBarMs(t.entryDate ?? t.date);
      const x = parseBarMs(t.exitDate ?? t.date);
      if (Number.isFinite(e)) {
        minT = Math.min(minT, e);
        maxT = Math.max(maxT, e);
      }
      if (Number.isFinite(x)) {
        minT = Math.min(minT, x);
        maxT = Math.max(maxT, x);
      }
    }
    if (!Number.isFinite(minT)) {
      return {
        windowOhlc: ohlc,
        visibleTrades: visible,
        summary: `Obchody ${startIdx + 1}–${startIdx + visible.length} z ${trades.length}`,
        hasPrev,
        hasNext,
      };
    }
    const span = Math.max(maxT - minT, 24 * 3600 * 1000);
    const pad = span * 0.12 + 3 * 24 * 3600 * 1000;
    const lo = minT - pad;
    const hi = maxT + pad;
    const win = ohlc.filter((b) => {
      const tt = parseBarMs(b.date);
      return Number.isFinite(tt) && tt >= lo && tt <= hi;
    });
    const windowOhlc = win.length > 0 ? win : ohlc;
    return {
      windowOhlc,
      visibleTrades: visible,
      summary: `Obchody ${startIdx + 1}–${startIdx + visible.length} z ${trades.length} · ${windowOhlc.length} svíček`,
      hasPrev,
      hasNext,
    };
  }

  /* by_months */
  const months = Math.max(1, Math.min(36, Math.floor(monthsPerView)));
  const anchor = new Date(ohlc[0].date);
  if (Number.isNaN(anchor.getTime())) {
    return {
      windowOhlc: ohlc,
      visibleTrades: trades,
      summary: "Neplatné datum v OHLC",
      hasPrev: false,
      hasNext: false,
    };
  }
  const start = new Date(anchor);
  start.setMonth(start.getMonth() + page * months);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  const windowOhlc = ohlc.filter((b) => {
    const t = new Date(b.date);
    return !Number.isNaN(t.getTime()) && t >= start && t < end;
  });

  const lastBar = new Date(ohlc[ohlc.length - 1].date);
  const hasPrev = page > 0;
  const hasNext = Number.isFinite(lastBar.getTime()) && lastBar >= end;

  const visibleTrades = trades.filter((tr) => {
    const e = parseBarMs(tr.entryDate ?? tr.date);
    const x = parseBarMs(tr.exitDate ?? tr.date);
    if (!Number.isFinite(e) && !Number.isFinite(x)) return false;
    const e0 = Number.isFinite(e) ? e : x;
    const e1 = Number.isFinite(x) ? x : e;
    const lo = Math.min(e0, e1);
    const hi = Math.max(e0, e1);
    return hi >= start.getTime() && lo < end.getTime();
  });

  const wo =
    windowOhlc.length > 0
      ? windowOhlc
      : ohlc.slice(0, Math.min(80, ohlc.length));
  const sumExtra = windowOhlc.length === 0 ? " · v tomto měsíci žádné svíčky (náhled začátku dat)" : "";
  return {
    windowOhlc: wo,
    visibleTrades,
    summary: `Období ${start.toLocaleDateString("cs-CZ")} – ${end.toLocaleDateString("cs-CZ")} · ${visibleTrades.length} obch. · ${windowOhlc.length} svíček${sumExtra}`,
    hasPrev,
    hasNext,
  };
}

/** Omezí markery/čáry/zóny na časové okno OHLC (Detailed výkon + nerozšiřovat osu X). */
export function filterModuleOutputToOhlcWindow(
  output: ModuleOutput,
  windowOhlc: OhlcBar[]
): ModuleOutput {
  if (!windowOhlc.length) {
    return { markers: [], lines: [], zones: [] };
  }
  const loMs = Date.parse(windowOhlc[0].date);
  const hiMs = Date.parse(windowOhlc[windowOhlc.length - 1].date);
  if (!Number.isFinite(loMs) || !Number.isFinite(hiMs)) {
    return output;
  }

  const markers = (output.markers ?? []).filter((m) => {
    const t = Date.parse(m.date);
    return Number.isFinite(t) && t >= loMs && t <= hiMs;
  });

  const lines: ModuleLineOutput[] = (output.lines ?? [])
    .map((line): ModuleLineOutput | null => {
      const inWin = (date: string) => {
        const t = Date.parse(date);
        return Number.isFinite(t) && t >= loMs && t <= hiMs;
      };
      if ("regime_histogram" in line && line.regime_histogram) {
        const data = line.data.filter((p) => inWin(p.date));
        return data.length
          ? { name: line.name, regime_histogram: true as const, data }
          : null;
      }
      const series = line as { name: string; data: { date: string; value: number }[]; color?: string };
      const data = series.data.filter((p) => inWin(p.date));
      if (!data.length) return null;
      return series.color
        ? { name: series.name, data, color: series.color }
        : { name: series.name, data };
    })
    .filter((l): l is ModuleLineOutput => l != null);

  const zones: ModuleZone[] = [];
  for (const z of output.zones ?? []) {
    const t0 = Date.parse(z.date_start);
    const t1 = Date.parse(z.date_end);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
      zones.push(z);
      continue;
    }
    const zLo = Math.min(t0, t1);
    const zHi = Math.max(t0, t1);
    if (zHi < loMs || zLo > hiMs) continue;
    const newLo = Math.max(zLo, loMs);
    const newHi = Math.min(zHi, hiMs);
    const startStr = newLo === zLo ? z.date_start : formatMsAlignedToOhlc(newLo, windowOhlc);
    const endStr = newHi === zHi ? z.date_end : formatMsAlignedToOhlc(newHi, windowOhlc);
    zones.push({
      ...z,
      date_start: startStr,
      date_end: endStr,
    });
  }

  return { markers, lines, zones };
}
