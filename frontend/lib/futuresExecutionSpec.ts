/**
 * CME-style futures tick spec (USD tick value) + typický „normální“ slippage jako zlomek ceny.
 * Slouží pro RunRequest.tick_size / value_per_tick / slippage_perc default a pro batch položky.
 *
 * Slippage: střed hodnot z rozmezí v produktovém briefu (např. 0.01–0.03 % → 0.02 % = 0.0002).
 */

export type FuturesExecutionSpec = {
  tickSize: number;
  valuePerTick: number;
  /** Zlomek ceny, např. 0.0002 = 0.02 % */
  defaultSlippagePerc: number;
};

const SPEC: Record<string, FuturesExecutionSpec> = {
  MNQ: { tickSize: 0.25, valuePerTick: 0.5, defaultSlippagePerc: 0.0002 },
  NQ: { tickSize: 0.25, valuePerTick: 5, defaultSlippagePerc: 0.000125 },
  // British Pound — v datech často BP
  "6B": { tickSize: 0.0001, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  BP: { tickSize: 0.0001, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  CL: { tickSize: 0.01, valuePerTick: 10, defaultSlippagePerc: 0.0003 },
  "6J": { tickSize: 0.0000005, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  JY: { tickSize: 0.0000005, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  ES: { tickSize: 0.25, valuePerTick: 12.5, defaultSlippagePerc: 0.00006 },
  "6E": { tickSize: 0.00005, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  EU: { tickSize: 0.00005, valuePerTick: 6.25, defaultSlippagePerc: 0.000125 },
  ZF: { tickSize: 0.0078125, valuePerTick: 7.8125, defaultSlippagePerc: 0.00005 },
  FV: { tickSize: 0.0078125, valuePerTick: 7.8125, defaultSlippagePerc: 0.00005 },
  ZN: { tickSize: 0.015625, valuePerTick: 15.625, defaultSlippagePerc: 0.00005 },
  TY: { tickSize: 0.015625, valuePerTick: 15.625, defaultSlippagePerc: 0.00005 },
  ZB: { tickSize: 0.03125, valuePerTick: 31.25, defaultSlippagePerc: 0.000065 },
  US: { tickSize: 0.03125, valuePerTick: 31.25, defaultSlippagePerc: 0.000065 },
  GC: { tickSize: 0.1, valuePerTick: 10, defaultSlippagePerc: 0.00025 },
};

const FALLBACK: FuturesExecutionSpec = {
  tickSize: 0.25,
  valuePerTick: 5,
  defaultSlippagePerc: 0.000125,
};

export function getFuturesExecutionSpec(instrument: string): FuturesExecutionSpec {
  const k = (instrument || "").trim().toUpperCase();
  return SPEC[k] ?? FALLBACK;
}

/** Parquet MNQ 1m — nelze míchat s futures_30m v jedné dávce. */
export function isMnqParquetDataFile(file: string): boolean {
  return (file || "").startsWith("futures_mnq/");
}
