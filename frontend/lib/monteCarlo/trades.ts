export type McMarketRegime = "up" | "down" | "range";

export interface NormalizedMcTrade {
  pnl: number;
  /** ISO date prefix YYYY-MM-DD for exit (fallback `unknown`). */
  dayKey: string;
  /** Maximum favorable excursion (USD) during trade, if known. */
  mfeUsd: number | null;
  /** Maximum adverse excursion (USD, positive = adverse move in USD). */
  maeUsd: number | null;
  /** Risk at entry in account currency, if engine provided it. */
  initialRiskUsd: number | null;
  /** Realized R = pnl / risk when risk known (informational). */
  tradeR: number | null;
  /** Entry-time market regime when regime segmentation was enabled. */
  regime: McMarketRegime | null;
}

function parseRegimeString(raw: unknown): McMarketRegime | null {
  if (typeof raw !== "string") return null;
  const x = raw.toLowerCase().trim();
  if (x === "up" || x === "uptrend") return "up";
  if (x === "down" || x === "downtrend") return "down";
  if (x === "range" || x === "sideways") return "range";
  return null;
}

function regimeForTradeIndex(
  o: Record<string, unknown>,
  index: number,
  regimeAnalysis: Record<string, unknown> | null | undefined,
): McMarketRegime | null {
  const fromTrade = parseRegimeString(o.marketRegime ?? o.regime);
  if (fromTrade) return fromTrade;
  const tr = regimeAnalysis?.tradeRegimes;
  if (Array.isArray(tr) && typeof tr[index] === "string") {
    return parseRegimeString(tr[index]);
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeTradesFromRun(
  trades: unknown[] | undefined,
  regimeAnalysis?: Record<string, unknown> | null,
): NormalizedMcTrade[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const out: NormalizedMcTrade[] = [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const pnl = Number(o.pnl);
    if (!Number.isFinite(pnl)) continue;
    const dayRaw = (o.exitDate ?? o.date ?? o.entryDate) as string | undefined;
    const dayKey =
      typeof dayRaw === "string" && dayRaw.length >= 10 ? dayRaw.slice(0, 10) : "unknown";

    let mfeUsd = numOrNull(o.mfeUsd);
    let maeUsd = numOrNull(o.maeUsd);
    if (maeUsd != null && maeUsd < 0) maeUsd = -maeUsd;

    if (mfeUsd == null || maeUsd == null) {
      const mfePx = numOrNull(o.mfe);
      const maeRaw = numOrNull(o.mae);
      const entryPx = numOrNull(o.entryPrice);
      const exitPx = numOrNull(o.exitPrice);
      const dPx =
        entryPx != null && exitPx != null && Math.abs(exitPx - entryPx) > 1e-12 ? exitPx - entryPx : null;
      const k = dPx != null && Math.abs(dPx) > 1e-12 && Number.isFinite(pnl / dPx) ? pnl / dPx : null;
      if (mfeUsd == null && mfePx != null && mfePx >= 0) {
        mfeUsd = k != null && Number.isFinite(k) ? Math.abs(mfePx * k) : null;
      }
      if (maeUsd == null) {
        const maePx = maeRaw != null && maeRaw < 0 ? -maeRaw : maeRaw;
        maeUsd = maePx != null && maePx >= 0 && k != null && Number.isFinite(k) ? Math.abs(maePx * k) : null;
      }
    }

    let initialRiskUsd = numOrNull(o.initialRiskUsd);
    const tradeRNum = numOrNull(o.tradeR);
    if ((initialRiskUsd == null || initialRiskUsd <= 0) && tradeRNum != null && Math.abs(tradeRNum) > 1e-9) {
      initialRiskUsd = Math.abs(pnl / tradeRNum);
    }
    if (mfeUsd != null && mfeUsd < 0) mfeUsd = -mfeUsd;

    let tradeR: number | null = tradeRNum;
    if (tradeR == null && initialRiskUsd != null && initialRiskUsd > 1e-9) {
      tradeR = pnl / initialRiskUsd;
    }

    out.push({
      pnl,
      dayKey,
      mfeUsd: mfeUsd != null && mfeUsd >= 0 ? mfeUsd : null,
      maeUsd: maeUsd != null && maeUsd >= 0 ? maeUsd : null,
      initialRiskUsd: initialRiskUsd != null && initialRiskUsd > 0 ? initialRiskUsd : null,
      tradeR,
      regime: regimeForTradeIndex(o, i, regimeAnalysis),
    });
  }
  return out;
}

const REGIME_KEYS: McMarketRegime[] = ["up", "down", "range"];

export function splitTradesByRegime(trades: NormalizedMcTrade[]): Record<McMarketRegime, NormalizedMcTrade[]> {
  const acc: Record<McMarketRegime, NormalizedMcTrade[]> = { up: [], down: [], range: [] };
  for (const t of trades) {
    const k = t.regime;
    if (k === "up" || k === "down" || k === "range") acc[k].push(t);
  }
  return acc;
}

export function regimesWithTrades(trades: NormalizedMcTrade[]): McMarketRegime[] {
  const s = splitTradesByRegime(trades);
  return REGIME_KEYS.filter((k) => (s[k]?.length ?? 0) > 0);
}

export function medianPositive(values: number[], fallback: number): number {
  const pos = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return fallback;
  const m = Math.floor(pos.length / 2);
  return pos.length % 2 ? pos[m]! : (pos[m - 1]! + pos[m]!) / 2;
}

export function medianAbsPnls(trades: NormalizedMcTrade[]): number {
  const abs = trades.map((t) => Math.abs(t.pnl)).sort((a, b) => a - b);
  if (abs.length === 0) return 1;
  const m = Math.floor(abs.length / 2);
  return abs.length % 2 ? abs[m]! : (abs[m - 1]! + abs[m]!) / 2;
}

export function getInitialCapitalFromManifest(manifest: Record<string, unknown> | null | undefined): number {
  if (!manifest) return 100_000;
  const a = Number(manifest.initial_capital ?? manifest.initialCapital);
  return Number.isFinite(a) && a > 0 ? a : 100_000;
}
