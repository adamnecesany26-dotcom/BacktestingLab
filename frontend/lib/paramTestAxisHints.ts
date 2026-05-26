/**
 * České vysvětlení os a jednotek pro OAT (param_test) graf — hodnoty jsou vždy
 * přesně tak, jak je strategie bere v `main.py` / Pine (ne „normalizovaný“ 0–1 rozsah).
 */
export function paramTestAxisXHint(paramKey: string): string {
  const k = (paramKey || "").trim();
  const map: Record<string, string> = {
    atr_sl_pct:
      "Denní ATR × tento koeficient (stejné jako Pine). V UI strategie zadej 10–50 jako číslo procent (30 = 30 %), ne zlomek 0,3.",
    sl_mult: "Násobek vzdálenosti SL od vstupu (Pine i_slMult).",
    fixed_rr: "Cíl TP jako násobek R (|entry − stop|).",
    orb_minutes: "Délka opening range od první session svíčky (minuty).",
    contracts: "Počet kontraktů (režim Fixed Contracts).",
    risk_pct: "Riziko z účtu v % (režim % equity).",
    rel_vol_min: "Minimální relativní objem k průměru OR.",
  };
  return map[k] ?? "";
}

export function paramTestXTickFormat(xs: number[]): string {
  if (!xs.length) return ".3f";
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo;
  if (span <= 0) return ".4f";
  if (hi < 1.5 && lo >= 0 && span <= 1.1) {
    return ".2f";
  }
  if (span >= 100) return ".0f";
  if (span >= 20) return ".0f";
  if (span >= 2) return ".1f";
  return ".3f";
}
