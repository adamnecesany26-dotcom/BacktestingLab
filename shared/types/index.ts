/**
 * Shared type definitions for frontend-backend communication.
 * Used by both Next.js frontend and FastAPI backend (via OpenAPI).
 */

/** Instrument type for backtest configuration */
export type InstrumentType = "futures" | "stocks" | "forex";

/** Filter instruments by type. Instruments without instrumentType default to "futures". */
export function filterInstrumentsByType(
  instruments: DataInstrument[],
  type: InstrumentType
): DataInstrument[] {
  return instruments.filter((i) => (i.instrumentType ?? "futures") === type);
}

/** Run request payload */
export interface RunRequest {
  /** Single-file mode: strategy code (main.py content) */
  code?: string;
  /** Multi-file mode: { "main.py": "...", "utils.py": "..." } - all files in strategy */
  files?: Record<string, string>;
  instrument: string;
  timeframe: string;
  years?: number;
  data_file?: string;
  /** Realistic simulation params */
  initial_capital?: number;
  slippage_perc?: number;
  commission_perc?: number;
  /** Instrument type and type-specific params */
  instrument_type?: InstrumentType;
  /** Futures: tick size, value per tick */
  tick_size?: number;
  value_per_tick?: number;
  /** Stocks: position size (shares) */
  share_size?: number;
  /** Forex: lot size, pip size, pip value */
  lot_size?: number;
  pip_size?: number;
  pip_value?: number;
  /** Strategy parameters (from PARAMS dict) - override values without editing code */
  params?: Record<string, number | boolean | string | Record<string, unknown>>;
  /** Applied modules for module outputs (markers, lines) after backtest */
  applied_modules?: { id: string; name: string; params?: Record<string, number | boolean | string> }[];
  /** Optional client-provided run correlation id */
  run_id?: string;
  /** Validation mode for edge-finding workflow */
  validation_mode?: "single" | "oos_split" | "walk_forward" | "param_test";
  validation_config?: Record<string, unknown>;
  quality_gates?: Record<string, unknown>;
  sweep_mode?: "grid" | "random";
  sweep_config?: Record<string, unknown>;
  monte_carlo?: Record<string, unknown>;
  regime_config?: Record<string, unknown>;
  portfolio_config?: Record<string, unknown>;
  execution_model?: Record<string, unknown>;
  experiment?: Record<string, unknown>;
  /** Sequential batch: { batch_id?, max_runs?, items: Partial<RunRequest>[] } */
  batch_config?: Record<string, unknown>;
  /** Wall-clock cap for engine run (seconds). Omit = server default. 0 = no limit (server must allow). */
  run_timeout_sec?: number;
  /** Max seconds without stream activity (stall detection). Omit = server default. 0 = disabled. */
  stream_idle_timeout_sec?: number;
}

/** Broker config for futures (tick, mult, margin) */
export interface BrokerConfig {
  tick_size?: number;
  tick_value?: number;
  mult?: number;
  margin?: number;
  commission_per_contract?: number;
}

/** Available data source */
export interface DataInstrument {
  instrument: string;
  displayName?: string;
  timeframe: string;
  file: string;
  minDate: string;
  maxDate: string;
  yearsAvailable: number;
  /** Instrument type - used to filter by Instrument Type in UI */
  instrumentType?: InstrumentType;
  /** Futures broker params - used when present */
  brokerConfig?: BrokerConfig;
  /** Strategy View: canonical NQ 2025 demo file — full series load + shuffle within file */
  viewDemo?: boolean;
}

/** Single trade record */
export interface Trade {
  date?: string;
  entryDate?: string;
  exitDate?: string;
  type: 'buy' | 'sell';
  price: number;
  size: number;
  pnl?: number;
  entryPrice?: number;
  exitPrice?: number;
  mfe?: number;
  mae?: number;
  mfePct?: number;
  maePct?: number;
  fees?: number;
  slippageCost?: number;
  barsHeld?: number;
  holdingMinutes?: number;
  entryReason?: string;
  exitReason?: string;
  /** Volitelná metadata ze strategie (např. S/D zóna) */
  zoneMeta?: Record<string, unknown>;
  /** Počáteční riziko obchodu v měně účtu (pokud engine doplní). */
  initialRiskUsd?: number;
  /** Realizovaný PnL v násobcích počátečního rizika (pokud engine doplní). */
  tradeR?: number;
}

/** Equity point with date */
export interface EquityPoint {
  date: string;
  value: number;
}

/** Backtest metrics */
export interface BacktestMetrics {
  finalEquity: number;
  maxEquity?: number;
  sharpeRatio: number;
  /** Max drawdown as percentage (0–100). Prefer `maxDrawdownPct` when both are set. */
  maxDrawdown: number;
  maxDrawdownPct?: number;
  maxDrawdownUsd?: number;
  commissionPerc?: number;
  tradeCount: number;
  longCount?: number;
  shortCount?: number;
  winRate?: number;
  totalReturn?: number;
  totalReturnUsd?: number;
  /** null when undefined (e.g. no losing trades); see profitFactorStatus */
  profitFactor?: number | null;
  expectancyUsd?: number;
  expectancyR?: number;
  rMultiple?: number;
  sortinoRatio?: number;
  calmarRatio?: number;
  marRatio?: number;
  ulcerIndex?: number;
  cagr?: number;
  /** Engine: defined | undefined_no_losing_trades | no_gross_activity */
  profitFactorStatus?: string;
  /** Backtrader SharpeRatio analyzer (legacy); headline sharpeRatio uses equity-based annualization */
  sharpeRatioLegacyAnalyzer?: number;
  grossProfitClosedTrades?: number;
  grossLossAbsClosedTrades?: number;
  riskAnnualizationPeriodsPerYear?: number;
  /** Longest drawdown period in bars (peak-to-recovery or end of data) */
  maxDrawdownDurationBars?: number;
  /** Longest drawdown period in calendar days */
  maxDrawdownDurationDays?: number | null;
  /** Bars from deepest trough back to preceding peak; null if not recovered */
  timeToRecoveryBars?: number | null;
  /** Days from deepest trough back to preceding peak; null if not recovered */
  timeToRecoveryDays?: number | null;
  /** Current DD % at end of equity curve (0 = at or above peak) */
  currentDrawdownPct?: number;
  /** Payoff ratio (AvgWin / AvgLoss); null when no losses */
  payoffRatio?: number | null;
  /** Edge per trade = WR×AvgWin - LR×AvgLoss */
  edgePerTrade?: number;
  /** Kelly fraction under i.i.d. assumption; null when payoffRatio unavailable */
  kellyFraction?: number | null;
}

/** OHLC bar for chart */
export interface OhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Zone/box for chart (support/resistance, price zones) */
export interface ModuleZone {
  date_start: string;
  date_end: string;
  value_low: number;
  value_high: number;
  fillcolor?: string;
  name?: string;
  base_length?: number;
  impulse_score?: number;
  inducements?: { date: string; value: number; type: string; index?: number }[];
  inducement_count?: number;
  inducement_points?: number;
  has_touch?: boolean;
  touch_bar_index?: number;
  touch_marker_price?: number;
  touch_date?: string;
  active_demand_zones_below?: number;
  has_gap?: boolean;
  gap_type?: string;
  gap_date?: string;
  gap_value_low?: number;
  gap_value_high?: number;
}

/** Bod indikátorové čáry; volitelně trend state/score z Swing HL */
export interface ModuleLinePoint {
  date: string;
  value: number;
  state?: string;
  score?: number;
}

/** Jedna řada z get_line — běžná čára nebo režimový histogram (View / run výstup) */
export type ModuleLineOutput =
  | { name: string; data: ModuleLinePoint[]; color?: string }
  | {
      name: string;
      regime_histogram: true;
      data: { date: string; trend: number; chop: number; high_vol: number }[];
    };

/** Module output (markers, lines, zones from detect/get_line/get_zones) */
export interface ModuleOutput {
  markers?: { date: string; type: string; value: number }[];
  lines?: ModuleLineOutput[];
  zones?: ModuleZone[];
}

/** Run response payload */
export interface RunResponse {
  equity: number[];
  equityCurve?: EquityPoint[];
  metrics: BacktestMetrics;
  trades: Trade[];
  ohlc?: OhlcBar[];
  /** Outputs from applied modules (detect, get_line) - keyed by module name */
  moduleOutputs?: Record<string, ModuleOutput>;
  /** Backend generated run id for audit trail */
  runId?: string;
  /** Snapshot metadata for reproducibility */
  manifest?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  robustness?: Record<string, unknown>;
  monteCarlo?: Record<string, unknown>;
  regimeAnalysis?: Record<string, unknown>;
  portfolio?: Record<string, unknown>;
  executionSummary?: Record<string, unknown>;
  qualityGate?: Record<string, unknown>;
  experiment?: Record<string, unknown>;
  batchSummary?: Record<string, unknown>;
  /** Extended drawdown analysis: duration, recovery, underwater integral */
  drawdownAnalysis?: Record<string, unknown>;
  /** Trade PnL distribution: histogram, percentiles, tail CVaR, concentration */
  tradePnlDistribution?: Record<string, unknown>;
  /** Bootstrap 95% CI for key metrics (trade-level resampling) */
  bootstrapCI?: Record<string, unknown>;
  /** Edge decomposition: win rate vs payoff ratio, Kelly fraction */
  payoffDecomposition?: Record<string, unknown>;
  /** Trial count and multiple testing awareness */
  overfittingSignals?: Record<string, unknown>;
  /** Prop-level red flags and trust assessment */
  propRedFlags?: Record<string, unknown>;
  /** Plné výsledky každého dílčího běhu dávky (jen pokud runů ≤ serverový limit, typicky 12) */
  batchRuns?: RunResponse[];
}

/** Project structure for file tree */
export interface ProjectFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectFile[];
}
