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
  params?: Record<string, number | boolean | string>;
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
  timeframe: string;
  file: string;
  minDate: string;
  maxDate: string;
  yearsAvailable: number;
  /** Instrument type - used to filter by Instrument Type in UI */
  instrumentType?: InstrumentType;
  /** Futures broker params - used when present */
  brokerConfig?: BrokerConfig;
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
}

/** Equity point with date */
export interface EquityPoint {
  date: string;
  value: number;
}

/** Backtest metrics */
export interface BacktestMetrics {
  finalEquity: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradeCount: number;
  longCount?: number;
  shortCount?: number;
  winRate?: number;
  totalReturn?: number;
  totalReturnUsd?: number;
  profitFactor?: number;
  expectancyUsd?: number;
  expectancyR?: number;
  rMultiple?: number;
}

/** OHLC bar for chart */
export interface OhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Run response payload */
export interface RunResponse {
  equity: number[];
  equityCurve?: EquityPoint[];
  metrics: BacktestMetrics;
  trades: Trade[];
  ohlc?: OhlcBar[];
}

/** Project structure for file tree */
export interface ProjectFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectFile[];
}
