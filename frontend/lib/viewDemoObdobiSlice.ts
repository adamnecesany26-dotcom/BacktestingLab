/**
 * Demo / „Období“: po useknutí OHLC na tail je ``bar_index`` stále v souřadnicích
 * plné odpovědi API — musí se posunout o ``startIdx``, jinak mapMarkerToIndex omylem
 * použije globální index jako lokální (nebo datum nestačí).
 */

export type ViewMarkerForSlice = {
  date: string;
  type: string;
  value: number;
  bar_index?: number;
};

/**
 * Přemapuje ``bar_index`` z globální soustavy (0..fullLen-1) na lokální okno [0, windowLen).
 * Pokud byl index mimo okno, ``bar_index`` se odebere — spolehne se na ``date``.
 */
export function remapViewMarkersBarIndexForWindow<T extends ViewMarkerForSlice>(
  markers: T[],
  startIdx: number,
  windowLen: number
): T[] {
  if (windowLen <= 0 || markers.length === 0) return markers;
  const si = Math.max(0, Math.floor(startIdx));
  return markers.map((m) => {
    if (typeof m.bar_index !== "number" || !Number.isFinite(m.bar_index)) return m;
    const local = Math.floor(m.bar_index) - si;
    if (local >= 0 && local < windowLen) {
      return { ...m, bar_index: local };
    }
    const { bar_index: _drop, ...rest } = m;
    return { ...rest } as T;
  });
}
