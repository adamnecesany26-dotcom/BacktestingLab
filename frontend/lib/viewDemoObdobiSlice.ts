/**
 * Demo / „Období“: po useknutí OHLC na tail je ``bar_index`` stále v souřadnicích
 * plné odpovědi API — musí se posunout o ``startIdx``, jinak mapMarkerToIndex omylem
 * použije globální index jako lokální (nebo datum nestačí).
 */

export type ViewMarkerForSlice = {
  date: string;
  type: string;
  value: number | null;
  bar_index?: number | string;
};

/** JSON někdy vrátí index jako řetězec — sjednotit na lokální celé číslo nebo null. */
export function coerceViewMarkerBarIndex(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const x = Number(raw);
    return Number.isFinite(x) ? Math.floor(x) : null;
  }
  return null;
}

/**
 * Přemapuje ``bar_index`` z globální soustavy (0..fullLen-1) na lokální okno [0, windowLen).
 * Pokud byl index mimo okno, ``bar_index`` se odebere — spolehne se na ``date``.
 */
export function remapViewMarkersBarIndexForWindow<T extends ViewMarkerForSlice>(
  markers: T[],
  startIdx: number,
  windowLen: number,
  /** Po přemapování indexu sjednotit `date` s viditelným OHLC (oprava špatného ISO z API). */
  windowOhlc?: { date: string }[]
): T[] {
  if (windowLen <= 0 || markers.length === 0) return markers;
  const si = Math.max(0, Math.floor(startIdx));
  return markers.map((m) => {
    const bi = coerceViewMarkerBarIndex(m.bar_index);
    if (bi === null) return m;
    const local = bi - si;
    if (local >= 0 && local < windowLen) {
      const ohlcDate = windowOhlc?.[local]?.date;
      if (ohlcDate && String(ohlcDate).trim()) {
        return { ...m, bar_index: local, date: String(ohlcDate) };
      }
      return { ...m, bar_index: local };
    }
    const { bar_index: _drop, ...rest } = m;
    return { ...rest } as T;
  });
}
