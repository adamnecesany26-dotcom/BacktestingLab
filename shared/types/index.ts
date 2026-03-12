/**
 * Shared type definitions for frontend-backend communication.
 * Used by both Next.js frontend and FastAPI backend (via OpenAPI).
 */

/** Run request payload */
export interface RunRequest {
  code: string;
  instrument: string;
  timeframe: string;
}

/** Single trade record */
export interface Trade {
  date: string;
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
  winRate?: number;
  totalReturn?: number;
}

/** Run response payload */
export interface RunResponse {
  equity: number[];
  metrics: BacktestMetrics;
  trades: Trade[];
}

/** Project structure for file tree */
export interface ProjectFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectFile[];
}
