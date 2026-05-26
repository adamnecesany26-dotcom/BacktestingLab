/**
 * UI defaults + API payload for prop firm sequential backtest (matches backend `prop_firm_backtest`).
 */

export type PropFirmPresetId = "apex_50k" | "topstep_50k" | "mff_custom_50k" | "custom";

export type PropFirmSimMode = "challenges_only" | "challenge_then_pa";

export type PropDrawdownModel = "intraday_trailing" | "eod_trailing" | "static_floor";

export interface PropFirmBacktestFormState {
  mode: PropFirmSimMode;
  presetId: PropFirmPresetId;
  accountSize: number;
  profitTargetUsd: number;
  maxDrawdownUsd: number;
  drawdownModel: PropDrawdownModel;
  dailyLossLimitUsd: number;
  dailyDrawdownPct: number;
  minTradingDays: number;
  /** 0 = vypnuto; např. 50 = největší denní zisk ≤ 50 % celkového zisku (Topstep). */
  consistencyBestDayMaxPct: number;
  performanceStartingBalance: number;
  /** Prázdné = stejné jako eval max DD. */
  performanceMaxDrawdownUsd: string;
}

const BASE: Omit<PropFirmBacktestFormState, "presetId"> = {
  mode: "challenges_only",
  accountSize: 50_000,
  profitTargetUsd: 3_000,
  maxDrawdownUsd: 2_500,
  drawdownModel: "intraday_trailing",
  dailyLossLimitUsd: 0,
  dailyDrawdownPct: 0,
  minTradingDays: 0,
  consistencyBestDayMaxPct: 0,
  performanceStartingBalance: 50_000,
  performanceMaxDrawdownUsd: "",
};

/** Úpravitelné defaulty podle tabulky ~50k evaluation (zjednodušeně). */
export const PROP_FIRM_PRESET_DEFAULTS: Record<Exclude<PropFirmPresetId, "custom">, PropFirmBacktestFormState> = {
  apex_50k: {
    ...BASE,
    presetId: "apex_50k",
    drawdownModel: "intraday_trailing",
    maxDrawdownUsd: 2_500,
    dailyLossLimitUsd: 0,
    minTradingDays: 7,
    consistencyBestDayMaxPct: 0,
  },
  topstep_50k: {
    ...BASE,
    presetId: "topstep_50k",
    drawdownModel: "eod_trailing",
    maxDrawdownUsd: 1_750,
    dailyLossLimitUsd: 1_000,
    minTradingDays: 0,
    consistencyBestDayMaxPct: 50,
  },
  mff_custom_50k: {
    ...BASE,
    presetId: "mff_custom_50k",
    drawdownModel: "eod_trailing",
    maxDrawdownUsd: 2_000,
    dailyLossLimitUsd: 1_000,
    minTradingDays: 0,
    consistencyBestDayMaxPct: 0,
  },
};

export function defaultPropFirmForm(): PropFirmBacktestFormState {
  return { ...PROP_FIRM_PRESET_DEFAULTS.apex_50k };
}

export function applyPropFirmPreset(
  preset: Exclude<PropFirmPresetId, "custom">,
  prev: PropFirmBacktestFormState,
): PropFirmBacktestFormState {
  const d = PROP_FIRM_PRESET_DEFAULTS[preset];
  return {
    ...d,
    mode: prev.mode,
    performanceMaxDrawdownUsd: prev.performanceMaxDrawdownUsd,
  };
}

export function buildPropFirmBacktestRequestPayload(form: PropFirmBacktestFormState): Record<string, unknown> {
  const pmd = form.performanceMaxDrawdownUsd.trim();
  let performanceMax: number | null = null;
  if (pmd !== "") {
    const n = Number(pmd);
    if (Number.isFinite(n) && n > 0) performanceMax = n;
  }
  return {
    enabled: true,
    mode: form.mode,
    preset_id: form.presetId,
    account_size: form.accountSize,
    profit_target_usd: form.profitTargetUsd,
    max_drawdown_usd: form.maxDrawdownUsd,
    drawdown_model: form.drawdownModel,
    daily_loss_limit_usd: form.dailyLossLimitUsd,
    daily_drawdown_pct: form.dailyDrawdownPct,
    min_trading_days: form.minTradingDays,
    consistency_best_day_max_pct: form.consistencyBestDayMaxPct,
    performance_starting_balance: form.performanceStartingBalance,
    performance_max_drawdown_usd: performanceMax,
  };
}
