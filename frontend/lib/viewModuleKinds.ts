/**
 * View: rozlišení modulu S/D zón vs. čistě strukturální H/L — aby šlo zobrazit jen zóny.
 */

const SD_ONLY_MARKER_TYPES = new Set([
  "high",
  "low",
  "major_high",
  "major_low",
  "internal_high",
  "internal_low",
  "bos_bullish",
  "bos_bearish",
]);

/** Odstraní swing / BOS markery (živý běh modulu + případné injekce z dependency). */
export function filterMarkersForSdZonesOnlyView<T extends { type: string }>(markers: T[]): T[] {
  return markers.filter((m) => !SD_ONLY_MARKER_TYPES.has(m.type));
}

/**
 * Ve View pro S/D modul ponechat jen zóny Demand/Supply (bez BOS čar, PD/SR z jiných vrstev).
 * Doteky a inducement zůstávají uvnitř objektů zón.
 */
export function filterZonesForSdZonesOnlyView<T extends { name?: string | null }>(zones: T[]): T[] {
  return zones.filter((z) => {
    const n = String(z.name ?? "").trim();
    return n === "Demand" || n === "Supply";
  });
}

/**
 * True pokud jde o kanonický S/D modul (get_zones + heuristika názvu / obsahu).
 * Swing_HL obvykle get_zones nemá.
 */
export function isSupplyDemandZonesModuleView(
  code: string | null,
  moduleName: string | null | undefined
): boolean {
  if (!code || !/\bdef\s+get_zones\b/m.test(code)) return false;
  const rawName = moduleName || "";
  const nm = rawName.toLowerCase();
  if (
    /\b(s\/d|s_d|sd[\s_-]*zone)\b/i.test(rawName) ||
    /\b(supply|demand)\b/i.test(rawName) ||
    nm.includes("s_d_zone") ||
    nm.includes("sd zone") ||
    nm.includes("sd_zones")
  ) {
    return true;
  }
  const head = code.slice(0, 12000);
  if (
    /\bdef\s+get_zones\b/m.test(head) &&
    /sd_zones|examples\/sd_zones|S_D_Zones|Supply\/Demand|supply.?demand|get_zones\(\s*ohlc/i.test(head)
  ) {
    return true;
  }
  return false;
}
