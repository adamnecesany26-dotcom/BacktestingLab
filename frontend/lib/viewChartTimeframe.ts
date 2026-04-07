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
  if (t === "4h") return 240;
  if (t === "1d" || t === "1day" || t === "daily") return 1440;
  if (t === "1w" || t === "1week") return 10080;
  if (t === "1mo" || t === "1month" || t === "1me") return 43200;
  return 1440;
}

/**
 * Po agregaci svíček ve View musí `data_timeframe` odpovídat **skutečnému** rozestupu OHLC v requestu,
 * ne rozlišení souboru — jinak Swing HL předpokládá jemnější bary než dostane a může vrátit prázdné swingy.
 */
export function effectiveViewDataTimeframe(
  chartTimeframe: string,
  instrumentTimeframe: string | undefined | null
): string {
  const native = (instrumentTimeframe ?? "").trim() || "1d";
  if (!chartTimeframe || chartTimeframe === "native") return native;
  const id = chartTimeframe.trim();
  if (id === "1D") return "1d";
  if (id === "1W") return "1w";
  if (id === "1Mo") return "1M";
  return id.toLowerCase();
}

const TRADING_DAYS_PER_YEAR = 252;
const MINUTES_PER_DAY = 1440;

/** Max. podíl načtené řady jako šířka shuffle okna — zbytek je rezerva pro náhodný posun začátku. */
const SHUFFLE_WINDOW_MAX_FRAC = 0.62;

/**
 * Počet svíček pro Shuffle okno — odpovídá výběru „Období“ (years) a TF grafu.
 * Okno se nikdy nevezme jako téměř celá řada (jinak maxStart ≈ 0 a shuffle skočí jen o pár barů).
 */
export function shuffleWindowBarCount(
  fullLen: number,
  yearsSelected: number,
  chartTimeframe: string,
  nativeTf?: string | null
): number {
  if (fullLen < 2) return fullLen;
  const capBySeries = Math.max(20, Math.floor(fullLen * SHUFFLE_WINDOW_MAX_FRAC));

  if (yearsSelected <= 0) {
    const quarter = Math.max(200, Math.floor(fullLen * 0.25));
    return Math.min(fullLen, quarter, capBySeries);
  }

  let chartMinutes: number;
  if (!chartTimeframe || chartTimeframe === "native") {
    chartMinutes = instrumentTimeframeToMinutes(nativeTf);
  } else {
    const rung = VIEW_CHART_TF_LADDER.find((x) => x.id === chartTimeframe);
    chartMinutes = rung?.minutes ?? MINUTES_PER_DAY;
  }

  let barsPerYear: number;
  if (chartMinutes >= 40000) {
    barsPerYear = 12;
  } else if (chartMinutes >= 8000) {
    barsPerYear = 52;
  } else if (chartMinutes >= MINUTES_PER_DAY - 60) {
    barsPerYear = TRADING_DAYS_PER_YEAR;
  } else {
    barsPerYear = Math.max(
      TRADING_DAYS_PER_YEAR,
      Math.round((TRADING_DAYS_PER_YEAR * MINUTES_PER_DAY) / chartMinutes)
    );
  }

  const want = Math.ceil(yearsSelected * barsPerYear);
  const target = Math.max(20, want);
  return Math.min(fullLen, target, capBySeries);
}

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

/**
 * View toolbar: od hrubších svíček k jemnějším (1M měsíc → … → původní rozlišení souboru).
 * Nelze agregovat jemněji než nativní data — nejmenší krok je vždy „Původní“.
 */
export function buildViewChartTimeframeOptionsCoarseFirst(
  nativeTf: string | undefined | null
): { value: string; label: string }[] {
  const nativeMin = instrumentTimeframeToMinutes(nativeTf);
  const nativeLabel = (nativeTf ?? "data").trim() || "data";
  /** Jen hrubší než nativní — nejmenší krok je vždy „Původní“, bez duplicitního 30m. */
  const coarseFirst = VIEW_CHART_TF_LADDER.filter((r) => r.minutes > nativeMin).sort(
    (a, b) => b.minutes - a.minutes
  );
  const out = coarseFirst.map((r) => ({ value: r.id, label: r.label }));
  out.push({ value: "native", label: `Původní (${nativeLabel})` });
  return out;
}
