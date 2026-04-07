"use client";

import { useState } from "react";
import type { CommissionMode } from "@/components/BacktestSettings";
import type { InstrumentType } from "@shared/types";

export type BacktestExecutionParamsState = {
  initialCapital: number;
  slippagePerc: number;
  commissionPerc: number;
  commissionMode: CommissionMode;
  commissionPerContract: number;
  instrumentType: InstrumentType;
  tickSize?: number;
  valuePerTick?: number;
  shareSize?: number;
  lotSize?: number;
  pipSize?: number;
  pipValue?: number;
  runTimeoutSec: number;
};

export const DEFAULT_BACKTEST_EXECUTION_PARAMS: BacktestExecutionParamsState = {
  initialCapital: 100000,
  slippagePerc: 0.001,
  commissionPerc: 0.0,
  commissionMode: "percentage",
  commissionPerContract: 2.25,
  instrumentType: "futures",
  tickSize: 0.25,
  valuePerTick: 5,
  shareSize: 100,
  lotSize: 1,
  pipSize: 0.0001,
  pipValue: 10,
  runTimeoutSec: 3600,
};

/** Základní execution / broker parametry pro `RunRequest` (Basic panel). */
export function useBacktestExecutionParams() {
  return useState<BacktestExecutionParamsState>(() => ({
    ...DEFAULT_BACKTEST_EXECUTION_PARAMS,
  }));
}
