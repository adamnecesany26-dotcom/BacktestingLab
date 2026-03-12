/**
 * Shared type definitions for frontend-backend communication.
 * Used by both Next.js frontend and FastAPI backend (via OpenAPI).
 */

/** Run request payload */
export interface RunRequest {
  code: string;
  instrument: string;
  timeframe: string;
  years?: number;
  data_file?: string;
  /** Realistic simulation params */
  initial_capital?: number;
  commission_perc?: number;
  slippage_perc?: number;
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
