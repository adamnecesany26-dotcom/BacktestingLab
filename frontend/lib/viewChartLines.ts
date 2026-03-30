/**
 * Trend čára ze Swing HL / HL_identificator — barvy shodné s examples/swing_hl_detector.py (TREND_COLORS).
 */

export const HL_TREND_STATE_COLORS: Record<string, string> = {
  STRONG_BULL: "#22c55e",
  WEAK_BULL: "#86efac",
  RANGE: "#71717a",
  WEAK_BEAR: "#fca5a5",
  STRONG_BEAR: "#ef4444",
};

export type ViewLinePoint = {
  date: string;
  value: number;
  state?: string;
  score?: number;
};

/** True pokud má řada stav trendu (barevné segmenty). */
export function lineDataHasTrendState(data: ViewLinePoint[]): boolean {
  return data.some((p) => p.state != null && String(p.state).length > 0);
}

type IndexedRow = { idx: number; val: number; state: string; score?: number };

function rowsIndexed(
  data: ViewLinePoint[],
  dateToIndex: Map<string, number>,
  dayToIndex: Map<string, number>
): IndexedRow[] {
  return data
    .map((p) => {
      const idx = dateToIndex.get(p.date) ?? dayToIndex.get(p.date.slice(0, 10)) ?? -1;
      return {
        idx,
        val: p.value,
        state: p.state && String(p.state).length > 0 ? String(p.state) : "RANGE",
        score: p.score,
      };
    })
    .filter((r) => r.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
}

/** Sousední body se stejným state → jeden segment (indexová osa x). */
export function groupIndexedTrendSegments(
  data: ViewLinePoint[],
  dateToIndex: Map<string, number>,
  dayToIndex: Map<string, number>
): { x: number[]; y: number[]; state: string; text: string[] }[] {
  const rows = rowsIndexed(data, dateToIndex, dayToIndex);
  if (rows.length === 0) return [];
  const groups: IndexedRow[][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (!last || last[0].state !== r.state) groups.push([r]);
    else last.push(r);
  }
  return groups.map((g) => ({
    x: g.map((r) => r.idx),
    y: g.map((r) => r.val),
    state: g[0].state,
    text: g.map((r) => {
      if (r.score != null && Number.isFinite(r.score)) {
        return `${r.state} · ${r.score.toFixed(0)}<extra></extra>`;
      }
      return `${r.state}<extra></extra>`;
    }),
  }));
}

/** Stejné segmenty pro osu x = datum (ISO řetězec). */
export function groupDateTrendSegments(data: ViewLinePoint[]): { x: string[]; y: number[]; state: string; text: string[] }[] {
  const rows = data
    .map((p) => ({
      date: p.date,
      val: p.value,
      state: p.state && String(p.state).length > 0 ? String(p.state) : "RANGE",
      score: p.score,
    }))
    .filter((r) => r.date);
  if (rows.length === 0) return [];
  const groups: typeof rows[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (!last || last[0].state !== r.state) groups.push([r]);
    else last.push(r);
  }
  return groups.map((g) => ({
    x: g.map((r) => r.date),
    y: g.map((r) => r.val),
    state: g[0].state,
    text: g.map((r) => {
      if (r.score != null && Number.isFinite(r.score)) {
        return `${r.state} · ${r.score.toFixed(0)}<extra></extra>`;
      }
      return `${r.state}<extra></extra>`;
    }),
  }));
}
