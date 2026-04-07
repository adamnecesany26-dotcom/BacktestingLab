/**
 * Rozsah historie v run requestu: backend používá `years` jako float (např. 0,25 = 3 měsíce).
 */

/** Nejkratší okno v UI (1 měsíc). */
export const MIN_BACKTEST_YEARS = 1 / 12;

/** Rychlé testy — přesné zlomky roku pro stabilní cache klíče. */
export const QUICK_RANGE_MONTHS_YEARS = {
  1: 1 / 12,
  3: 0.25,
  6: 0.5,
} as const;
