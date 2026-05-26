"use client";

import { useState } from "react";
import { getFuturesExecutionSpec } from "@/lib/futuresExecutionSpec";

export type BacktestExecutionParamsState = {
  initialCapital: number;
  slippagePerc: number;
  /** USD za kontrakt za stranu (vždy tento režim v UI). */
  commissionPerContract: number;
  tickSize?: number;
  valuePerTick?: number;
};

const _boot = getFuturesExecutionSpec("NQ");

export const DEFAULT_BACKTEST_EXECUTION_PARAMS: BacktestExecutionParamsState = {
  initialCapital: 100000,
  slippagePerc: _boot.defaultSlippagePerc,
  commissionPerContract: 0,
  tickSize: _boot.tickSize,
  valuePerTick: _boot.valuePerTick,
};

/** Základní execution / broker parametry pro `RunRequest` (Basic panel). */
export function useBacktestExecutionParams() {
  return useState<BacktestExecutionParamsState>(() => ({
    ...DEFAULT_BACKTEST_EXECUTION_PARAMS,
  }));
}
