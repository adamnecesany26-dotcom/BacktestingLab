/**
 * View mode: chart candle timeframe ladder (coarser than native only).
 * IDs match backend /api/view `chart_timeframe` (1Mo = 1 calendar month).
 */

export const VIEW_CHART_TF_LADDER: { id: string; label: string; minutes: number }[] = [
  { id: "1m", label: "1m", minutes: 1 },
  { id: "5m", label: "5m", minutes: 5 },
  { id: "15m", label: "15m", minutes: 15 },
  { id: "30m", label: "30m", minutes: 30 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "2h", label: "2h", minutes: 120 },
  { id: "4h", label: "4h", minutes: 240 },
  { id: "1D", label: "1D", minutes: 1440 },
  { id: "1W", label: "1W", minutes: 10080 },
  { id: "1Mo", label: "1M (měsíc)", minutes: 43200 },
];

/** Parse instrument.timeframe from API (e.g. 30m, 1d) to approximate minutes. */
export function instrumentTimeframeToMinutes(tf: string | undefined | null): number {
  const t = (tf ?? "").trim().toLowerCase();
  if (!t) return 30;
  const mNum = /^(\d+)m$/.exec(t);
  if (mNum) return Math.max(1, parseInt(mNum[1], 10));
  if (t === "1h" || t === "60m") return 60;
  if (t === "2h") return 120;
  if (t === "4h") return 240;
  if (t === "1d" || t === "1day" || t === "daily") return 1440;
  if (t === "1w" || t === "1week") return 10080;
  if (t === "1mo" || t === "1month" || t === "1me") return 43200;
  return 1440;
}

/**
 * Options for select: always "Původní (native)" then ladder rungs strictly coarser than native.
 */
export function buildViewChartTimeframeOptions(nativeTf: string | undefined | null): { value: string; label: string }[] {
  const nativeMin = instrumentTimeframeToMinutes(nativeTf);
  const nativeLabel = (nativeTf ?? "data").trim() || "data";
  const out: { value: string; label: string }[] = [
    { value: "native", label: `Původní (${nativeLabel})` },
  ];
  for (const rung of VIEW_CHART_TF_LADDER) {
    if (rung.minutes > nativeMin) {
      out.push({ value: rung.id, label: rung.label });
    }
  }
  return out;
}
