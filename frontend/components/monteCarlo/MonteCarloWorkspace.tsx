"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import type { SavedBacktestRun } from "@/lib/firestore";
import {
  aggregateShuffleEquityBands,
  getInitialCapitalFromManifest,
  normalizeTradesFromRun,
  runBatched,
  runSinglePropFirmSim,
  runSingleShuffleSim,
  sampleEquityCurves,
  splitTradesByRegime,
  regimesWithTrades,
  type McMarketRegime,
  type PropFirmConfig,
  type PropFirmFailReason,
  type PropFirmRunResult,
  type ShuffleSimRunResult,
  propFailReasonLabel,
} from "@/lib/monteCarlo";

type SimKind = "shuffle" | "prop_firm";
type McScope = "global" | "per_regime";

const REGIME_DISPLAY: Record<McMarketRegime, string> = {
  up: "Uptrend",
  down: "Downtrend",
  range: "Range",
};

function formatRunDate(run: SavedBacktestRun): string {
  const s = run.savedAt?.seconds;
  if (typeof s === "number") {
    try {
      return new Date(s * 1000).toLocaleString();
    } catch {
      return run.id;
    }
  }
  return run.id;
}

interface MonteCarloWorkspaceProps {
  runs: SavedBacktestRun[];
  strategyOpen: boolean;
  strategyName?: string;
}

const defaultPropConfig = (): PropFirmConfig => ({
  profitTargetPct: 10,
  maxDdMode: "percent",
  maxDdValue: 10,
  overallDrawdownMode: "trailing",
  dailyDdLimitPct: 0,
  maxDailyLossUsd: 0,
  consistencyMaxDayProfitPct: 0,
  riskMode: "percent",
  riskPercent: 1,
  riskFixedUsd: 500,
  riskNormalizeMode: "as_backtest",
  riskNormFixedUsd: 500,
  riskNormRangeMinUsd: 400,
  riskNormRangeMaxUsd: 500,
  stressAvgRPct: 0,
  stressWinRatePts: 0,
});

function buildPropStats(propResults: PropFirmRunResult[]) {
  const passed = propResults.filter((r) => r.passed);
  const failed = propResults.filter((r) => !r.passed);
  const passRate = propResults.length ? passed.length / propResults.length : 0;
  const failCounts: Record<PropFirmFailReason, number> = {
    max_drawdown: 0,
    daily_drawdown: 0,
    max_daily_loss_usd: 0,
    incomplete: 0,
    consistency: 0,
  };
  for (const r of propResults) {
    if (!r.passed && r.failReason) {
      failCounts[r.failReason] += 1;
    }
  }
  const tradesToPass = passed.map((r) => r.tradesToPass).filter((x): x is number => x != null);
  const avgTrades =
    tradesToPass.length > 0 ? tradesToPass.reduce((a, b) => a + b, 0) / tradesToPass.length : null;

  const finalEq = propResults.map((r) => r.finalEquity);
  const maxDds = propResults.map((r) => r.maxDrawdownPct);
  const returns = propResults.map((r) => r.totalReturnPct);

  const median = (xs: number[]) => sampleQuantile(xs, 0.5);
  const maxDdPass = passed.map((r) => r.maxDrawdownPct);
  const maxDdFail = failed.map((r) => r.maxDrawdownPct);
  const retPass = passed.map((r) => r.totalReturnPct);
  const retFail = failed.map((r) => r.totalReturnPct);

  let wilson: { low: number; high: number } | null = null;
  if (propResults.length > 0) {
    wilson = wilson95PassRate(passed.length, propResults.length);
  }

  return {
    passRate,
    failCounts,
    avgTrades,
    passedN: passed.length,
    simCount: propResults.length,
    tradesPassP10: tradesToPass.length ? sampleQuantile(tradesToPass, 0.1) : null,
    tradesPassP50: tradesToPass.length ? sampleQuantile(tradesToPass, 0.5) : null,
    tradesPassP90: tradesToPass.length ? sampleQuantile(tradesToPass, 0.9) : null,
    finalEquityP10: sampleQuantile(finalEq, 0.1),
    finalEquityP50: sampleQuantile(finalEq, 0.5),
    finalEquityP90: sampleQuantile(finalEq, 0.9),
    maxDdP50All: sampleQuantile(maxDds, 0.5),
    medianMaxDdPass: maxDdPass.length ? median(maxDdPass) : null,
    medianMaxDdFail: maxDdFail.length ? median(maxDdFail) : null,
    medianReturnPass: retPass.length ? median(retPass) : null,
    medianReturnFail: retFail.length ? median(retFail) : null,
    returnP10: sampleQuantile(returns, 0.1),
    returnP50: sampleQuantile(returns, 0.5),
    returnP90: sampleQuantile(returns, 0.9),
    wilson,
  };
}

/** Kvantil z výběru (0–1). */
function sampleQuantile(xs: number[], q: number): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (hi - pos) + s[hi]! * (pos - lo);
}

/** Wilsonův interval pro binomické p (pas rate), z=1.96 ~ 95 %. */
function wilson95PassRate(successes: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const rad = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - rad), high: Math.min(1, center + rad) };
}

function runHasRegimeForMc(run: SavedBacktestRun): boolean {
  const ra = run.regimeAnalysis as Record<string, unknown> | null | undefined;
  if (ra?.segmentation === "per_regime_ema_atr_v1") return true;
  if (ra?.byRegime && typeof ra.byRegime === "object") return true;
  const tr = run.trades;
  if (Array.isArray(tr) && tr.some((t) => t && typeof t === "object" && "marketRegime" in (t as object))) return true;
  if (Array.isArray(ra?.tradeRegimes)) return true;
  return false;
}

export function MonteCarloWorkspace({ runs, strategyOpen, strategyName }: MonteCarloWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simKind, setSimKind] = useState<SimKind>("shuffle");
  const [mcScope, setMcScope] = useState<McScope>("global");
  const [shuffleCount, setShuffleCount] = useState(500);
  const [propCount, setPropCount] = useState(500);
  const [propCfg, setPropCfg] = useState<PropFirmConfig>(defaultPropConfig);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const [shuffleResults, setShuffleResults] = useState<ShuffleSimRunResult[] | null>(null);
  const [shuffleByRegime, setShuffleByRegime] = useState<Partial<
    Record<McMarketRegime, ShuffleSimRunResult[]>
  > | null>(null);
  const [propResults, setPropResults] = useState<PropFirmRunResult[] | null>(null);
  const [propByRegime, setPropByRegime] = useState<Partial<Record<McMarketRegime, PropFirmRunResult[]>> | null>(
    null,
  );

  const [Plot, setPlot] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("react-plotly.js")
      .then((mod) => {
        if (!cancelled) setPlot(() => mod.default);
      })
      .catch(() => {
        if (!cancelled) setPlot(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => (prev && runs.some((r) => r.id === prev) ? prev : runs[0]!.id));
  }, [runs]);

  const selectedRun = useMemo(
    () => (selectedId ? runs.find((r) => r.id === selectedId) ?? null : null),
    [runs, selectedId],
  );

  const hasRegimeMc = useMemo(() => (selectedRun ? runHasRegimeForMc(selectedRun) : false), [selectedRun]);

  useEffect(() => {
    if (!hasRegimeMc && mcScope === "per_regime") setMcScope("global");
  }, [hasRegimeMc, mcScope]);

  useEffect(() => {
    setShuffleByRegime(null);
    setShuffleResults(null);
    setPropByRegime(null);
    setPropResults(null);
  }, [mcScope]);

  useEffect(() => {
    setShuffleByRegime(null);
    setShuffleResults(null);
    setPropByRegime(null);
    setPropResults(null);
  }, [selectedId]);

  const normalizedInput = useMemo(() => {
    if (!selectedRun) return null;
    const ra =
      selectedRun.regimeAnalysis && typeof selectedRun.regimeAnalysis === "object"
        ? (selectedRun.regimeAnalysis as Record<string, unknown>)
        : null;
    const trades = normalizeTradesFromRun(selectedRun.trades as unknown[] | undefined, ra);
    const initial = getInitialCapitalFromManifest(selectedRun.manifest as Record<string, unknown> | null | undefined);
    return { trades, initial };
  }, [selectedRun]);

  const runShuffle = useCallback(async () => {
    if (!normalizedInput || normalizedInput.trades.length === 0) return;
    setRunning(true);
    setProgress(0);
    setPropResults(null);
    setPropByRegime(null);
    const { trades, initial } = normalizedInput;
    const baseSeed = (Date.now() ^ 0x5bd1e995) >>> 0;
    try {
      if (mcScope === "global") {
        setProgressTotal(shuffleCount);
        setShuffleByRegime(null);
        const results = await runBatched(
          shuffleCount,
          (i) => runSingleShuffleSim(trades, initial, (baseSeed + i * 977) >>> 0),
          (done) => setProgress(done),
          12,
        );
        setShuffleResults(results);
      } else {
        const split = splitTradesByRegime(trades);
        const keys = regimesWithTrades(trades);
        if (keys.length === 0) {
          setShuffleResults(null);
          setShuffleByRegime(null);
          return;
        }
        setShuffleResults(null);
        setProgressTotal(shuffleCount * keys.length);
        const out: Partial<Record<McMarketRegime, ShuffleSimRunResult[]>> = {};
        let off = 0;
        for (const k of keys) {
          const slice = split[k]!;
          const results = await runBatched(
            shuffleCount,
            (i) => runSingleShuffleSim(slice, initial, (baseSeed + i * 977 + off) >>> 0),
            (done) => setProgress(off + done),
            12,
          );
          out[k] = results;
          off += shuffleCount;
        }
        setShuffleByRegime(out);
      }
    } finally {
      setRunning(false);
      setProgress(0);
      setProgressTotal(0);
    }
  }, [normalizedInput, shuffleCount, mcScope]);

  const runProp = useCallback(async () => {
    if (!normalizedInput || normalizedInput.trades.length === 0) return;
    setRunning(true);
    setProgress(0);
    setShuffleResults(null);
    setShuffleByRegime(null);
    const { trades, initial } = normalizedInput;
    const baseSeed = (Date.now() ^ 0x85ebca6b) >>> 0;
    try {
      if (mcScope === "global") {
        setProgressTotal(propCount);
        setPropByRegime(null);
        const results = await runBatched(
          propCount,
          (i) => runSinglePropFirmSim(trades, initial, propCfg, (baseSeed + i * 993) >>> 0),
          (done) => setProgress(done),
          12,
        );
        setPropResults(results);
      } else {
        const split = splitTradesByRegime(trades);
        const keys = regimesWithTrades(trades);
        if (keys.length === 0) {
          setPropResults(null);
          setPropByRegime(null);
          return;
        }
        setPropResults(null);
        setProgressTotal(propCount * keys.length);
        const out: Partial<Record<McMarketRegime, PropFirmRunResult[]>> = {};
        let off = 0;
        for (const k of keys) {
          const slice = split[k]!;
          const results = await runBatched(
            propCount,
            (i) => runSinglePropFirmSim(slice, initial, propCfg, (baseSeed + i * 993 + off) >>> 0),
            (done) => setProgress(off + done),
            12,
          );
          out[k] = results;
          off += propCount;
        }
        setPropByRegime(out);
      }
    } finally {
      setRunning(false);
      setProgress(0);
      setProgressTotal(0);
    }
  }, [normalizedInput, propCount, propCfg, mcScope]);

  const shuffleBands = useMemo(() => {
    if (!shuffleResults || shuffleResults.length === 0) return null;
    return aggregateShuffleEquityBands(shuffleResults);
  }, [shuffleResults]);

  const propStats = useMemo(() => {
    if (!propResults || propResults.length === 0) return null;
    return buildPropStats(propResults);
  }, [propResults]);

  const propStatsByRegime = useMemo(() => {
    if (!propByRegime) return null;
    const keys: McMarketRegime[] = ["up", "down", "range"];
    const out: Partial<Record<McMarketRegime, ReturnType<typeof buildPropStats>>> = {};
    for (const k of keys) {
      const arr = propByRegime[k];
      if (arr && arr.length) out[k] = buildPropStats(arr);
    }
    return Object.keys(out).length ? out : null;
  }, [propByRegime]);

  const passCurves = useMemo(() => {
    if (!propResults) return [];
    return sampleEquityCurves(propResults, true, 12);
  }, [propResults]);

  const failCurves = useMemo(() => {
    if (!propResults) return [];
    return sampleEquityCurves(propResults, false, 12);
  }, [propResults]);

  const propCurvesByRegime = useMemo(() => {
    if (!propByRegime) return null;
    const out: Partial<Record<McMarketRegime, { pass: number[][]; fail: number[][] }>> = {};
    for (const k of ["up", "down", "range"] as const) {
      const arr = propByRegime[k];
      if (!arr?.length) continue;
      out[k] = {
        pass: sampleEquityCurves(arr, true, 8),
        fail: sampleEquityCurves(arr, false, 8),
      };
    }
    return Object.keys(out).length ? out : null;
  }, [propByRegime]);

  if (!strategyOpen) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-zinc-400">
        Otevři strategii v postranním panelu — Monte Carlo pracuje s uloženými výsledky backtestu dané strategie.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 border-t border-zinc-800 md:flex-row">
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-zinc-800 bg-zinc-950/80 md:w-72 md:border-b-0 md:border-r">
        <div className="border-b border-zinc-800 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Zdroj dat</div>
          <div className="mt-1 text-xs text-zinc-300">
            {strategyName ? <span className="font-medium text-zinc-100">{strategyName}</span> : "Strategie"}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Vyber jeden uložený run. Použijí se <code className="text-zinc-400">pnl</code>, datum ukončení, volitelně{" "}
            <code className="text-zinc-400">mfe</code>/<code className="text-zinc-400">mae</code> a{" "}
            <code className="text-zinc-400">initialRiskUsd</code> (nebo <code className="text-zinc-400">tradeR</code>) z
            engine — trailing drawdown v prop simulaci využívá MAE/MFE jako intra-trade body.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {runs.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-500">Žádné uložené výsledky — ulož run z backtestu.</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((r) => {
                const selected = r.id === selectedId;
                const tc = Number(r.metrics?.tradeCount ?? 0);
                const fe = r.metrics?.finalEquity;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                        selected
                          ? "border-emerald-600/60 bg-emerald-950/40 text-zinc-100"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <div className="font-mono text-[10px] text-zinc-500">{r.id.slice(0, 28)}…</div>
                      <div className="text-[11px] text-zinc-400">{formatRunDate(r)}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-zinc-500">
                        {Number.isFinite(tc) ? <span>{tc} obch.</span> : null}
                        {fe != null && Number.isFinite(Number(fe)) ? (
                          <span>Eq {Number(fe).toLocaleString()}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Typ simulace</span>
          <div className="flex rounded-lg border border-zinc-700 p-0.5">
            <button
              type="button"
              onClick={() => setSimKind("shuffle")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                simKind === "shuffle" ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Shuffle (základní MC)
            </button>
            <button
              type="button"
              onClick={() => setSimKind("prop_firm")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                simKind === "prop_firm" ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Prop firm challenge
            </button>
          </div>
        </div>

        {hasRegimeMc && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/35 p-3">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">Rozsah Monte Carlo</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMcScope("global")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  mcScope === "global" ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Globálně (celý run)
              </button>
              <button
                type="button"
                onClick={() => hasRegimeMc && setMcScope("per_regime")}
                disabled={!hasRegimeMc}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  mcScope === "per_regime" ? "bg-violet-200 text-violet-950" : "text-zinc-400 hover:text-zinc-200"
                } disabled:opacity-40`}
              >
                Per režim (Up / Down / Range)
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Per režim: samostatné shuffle / prop běhy pro obchody v daném režimu (stejný počet simulací v každém
              bucketu). Vyžaduje uložený run se segmentací <span className="text-zinc-400">Per Regime</span>.
            </p>
          </div>
        )}

        {!normalizedInput || normalizedInput.trades.length === 0 ? (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-100">
            {selectedRun
              ? "Vybraný run nemá žádné obchody s platným polem pnl — zvol jiný výsledek."
              : "Vyber výsledek backtestu vlevo."}
          </div>
        ) : (
          <>
            {simKind === "shuffle" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Počet simulací
                    <input
                      type="number"
                      min={50}
                      max={5000}
                      step={50}
                      value={shuffleCount}
                      onChange={(e) => setShuffleCount(Math.max(10, parseInt(e.target.value, 10) || 500))}
                      className="w-28 rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void runShuffle()}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {running ? `Běží… ${progress}/${progressTotal}` : "Spustit shuffle"}
                  </button>
                </div>

                {shuffleResults && shuffleResults.length > 0 && mcScope === "global" && (
                  <McShuffleCharts Plot={Plot} results={shuffleResults} bands={shuffleBands} simCount={shuffleResults.length} />
                )}
                {shuffleByRegime && mcScope === "per_regime" && (
                  <div className="space-y-8">
                    {(["up", "down", "range"] as const).map((k) => {
                      const res = shuffleByRegime[k];
                      if (!res?.length) return null;
                      const bands = aggregateShuffleEquityBands(res);
                      return (
                        <div key={k} className="space-y-2">
                          <div className="text-xs font-medium text-zinc-200">
                            {REGIME_DISPLAY[k]} — {res.length} simulací, {normalizedInput.trades.filter((t) => t.regime === k).length}{" "}
                            obchodů v bucketu
                          </div>
                          <McShuffleCharts Plot={Plot} results={res} bands={bands} simCount={res.length} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {simKind === "prop_firm" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500">Cíl a limity účtu</div>
                  <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Cíl zisku (%)
                    <input
                      type="number"
                      min={1}
                      max={200}
                      step={1}
                      value={propCfg.profitTargetPct}
                      onChange={(e) =>
                        setPropCfg((c) => ({
                          ...c,
                          profitTargetPct: Math.max(0.1, parseFloat(e.target.value) || 10),
                        }))
                      }
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Max drawdown — režim účtu
                    <select
                      value={propCfg.overallDrawdownMode}
                      onChange={(e) =>
                        setPropCfg((c) => ({
                          ...c,
                          overallDrawdownMode: e.target.value as PropFirmConfig["overallDrawdownMode"],
                        }))
                      }
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    >
                      <option value="trailing">
                        Trailing (peak i intra-trade při MAE/MFE)
                      </option>
                      <option value="eod">
                        EOD (celkový DD jen na uzavřené denní equity)
                      </option>
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-400">
                      Max DD měření
                      <select
                        value={propCfg.maxDdMode}
                        onChange={(e) =>
                          setPropCfg((c) => ({
                            ...c,
                            maxDdMode: e.target.value as PropFirmConfig["maxDdMode"],
                          }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      >
                        <option value="percent">% z peak / EOD high</option>
                        <option value="absolute">Absolutně (USD z initial)</option>
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-400">
                      Max DD hodnota
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={propCfg.maxDdValue}
                        onChange={(e) =>
                          setPropCfg((c) => ({ ...c, maxDdValue: Math.max(0, parseFloat(e.target.value) || 0) }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Denní DD (% z intradenního high), 0 = vypnuto
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={propCfg.dailyDdLimitPct}
                      onChange={(e) =>
                        setPropCfg((c) => ({ ...c, dailyDdLimitPct: Math.max(0, parseFloat(e.target.value) || 0) }))
                      }
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400">
                    Max denní ztráta (USD od začátku dne), 0 = vypnuto
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={propCfg.maxDailyLossUsd}
                      onChange={(e) =>
                        setPropCfg((c) => ({ ...c, maxDailyLossUsd: Math.max(0, parseFloat(e.target.value) || 0) }))
                      }
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-400 md:col-span-2">
                    Consistency: max podíl zisku z jednoho dne (%), 0 = vypnuto
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={propCfg.consistencyMaxDayProfitPct}
                      onChange={(e) =>
                        setPropCfg((c) => ({
                          ...c,
                          consistencyMaxDayProfitPct: Math.max(0, parseFloat(e.target.value) || 0),
                        }))
                      }
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                  </div>

                  <div className="border-t border-zinc-800 pt-4 space-y-3">
                    <div className="text-[11px] uppercase tracking-wider text-zinc-500">Normalizace rizika (na obchod)</div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Použije se <code className="text-zinc-400">initialRiskUsd</code> z obchodu; chybí-li, medián |PnL|
                      z výběru.
                    </p>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Režim
                      <select
                        value={propCfg.riskNormalizeMode}
                        onChange={(e) =>
                          setPropCfg((c) => ({
                            ...c,
                            riskNormalizeMode: e.target.value as PropFirmConfig["riskNormalizeMode"],
                          }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      >
                        <option value="as_backtest">Jak v backtestu (žádná normalizace)</option>
                        <option value="fixed_usd">Fixní risk USD na obchod</option>
                        <option value="range_usd">Náhodný risk USD v rozmezí (Monte Carlo)</option>
                        <option value="align_median_risk">Zarovnat na medián risku z dat</option>
                      </select>
                    </label>
                    {propCfg.riskNormalizeMode === "fixed_usd" && (
                      <label className="flex flex-col gap-1 text-xs text-zinc-400">
                        Risk USD
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={propCfg.riskNormFixedUsd}
                          onChange={(e) =>
                            setPropCfg((c) => ({
                              ...c,
                              riskNormFixedUsd: Math.max(1, parseFloat(e.target.value) || 500),
                            }))
                          }
                          className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                        />
                      </label>
                    )}
                    {propCfg.riskNormalizeMode === "range_usd" && (
                      <div className="flex gap-2">
                        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-400">
                          Min USD
                          <input
                            type="number"
                            min={1}
                            step={10}
                            value={propCfg.riskNormRangeMinUsd}
                            onChange={(e) =>
                              setPropCfg((c) => ({
                                ...c,
                                riskNormRangeMinUsd: Math.max(1, parseFloat(e.target.value) || 400),
                              }))
                            }
                            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                          />
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-400">
                          Max USD
                          <input
                            type="number"
                            min={1}
                            step={10}
                            value={propCfg.riskNormRangeMaxUsd}
                            onChange={(e) =>
                              setPropCfg((c) => ({
                                ...c,
                                riskNormRangeMaxUsd: Math.max(1, parseFloat(e.target.value) || 500),
                              }))
                            }
                            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-zinc-800 pt-4 space-y-3">
                    <div className="text-[11px] uppercase tracking-wider text-zinc-500">Globální měřítko PnL (legacy)</div>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Po normalizaci
                      <select
                        value={propCfg.riskMode}
                        onChange={(e) =>
                          setPropCfg((c) => ({ ...c, riskMode: e.target.value as PropFirmConfig["riskMode"] }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      >
                        <option value="percent">Násobitel vs. baseline 1 % účtu</option>
                        <option value="fixed">Fix USD vs medián |PnL| celého runu</option>
                      </select>
                    </label>
                    {propCfg.riskMode === "percent" ? (
                      <label className="flex flex-col gap-1 text-xs text-zinc-400">
                        Risk %
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.1}
                          value={propCfg.riskPercent}
                          onChange={(e) =>
                            setPropCfg((c) => ({ ...c, riskPercent: Math.max(0.01, parseFloat(e.target.value) || 1) }))
                          }
                          className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                        />
                      </label>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs text-zinc-400">
                        Risk (USD) vs medián |PnL|
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={propCfg.riskFixedUsd}
                          onChange={(e) =>
                            setPropCfg((c) => ({
                              ...c,
                              riskFixedUsd: Math.max(1, parseFloat(e.target.value) || 500),
                            }))
                          }
                          className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                        />
                      </label>
                    )}
                  </div>

                  <div className="border-t border-zinc-800 pt-4 space-y-3">
                    <div className="text-[11px] uppercase tracking-wider text-zinc-500">Stres (robustnost)</div>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Průměrné R: změna % (např. −5 → všechny PnL ×0.95)
                      <input
                        type="number"
                        min={-50}
                        max={50}
                        step={1}
                        value={propCfg.stressAvgRPct}
                        onChange={(e) =>
                          setPropCfg((c) => ({ ...c, stressAvgRPct: parseFloat(e.target.value) || 0 }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-zinc-400">
                      Win rate: body k dolů (např. −3 → náhodně ~3 % výher na BE v každé simulaci)
                      <input
                        type="number"
                        min={-50}
                        max={0}
                        step={1}
                        value={propCfg.stressWinRatePts}
                        onChange={(e) =>
                          setPropCfg((c) => ({
                            ...c,
                            stressWinRatePts: Math.min(0, parseFloat(e.target.value) || 0),
                          }))
                        }
                        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                      />
                    </label>
                  </div>

                  <label className="flex flex-col gap-1 text-xs text-zinc-400 max-w-xs">
                    Počet simulací
                    <input
                      type="number"
                      min={50}
                      max={5000}
                      step={50}
                      value={propCount}
                      onChange={(e) => setPropCount(Math.max(10, parseInt(e.target.value, 10) || 500))}
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void runProp()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {running ? `Běží… ${progress}/${progressTotal}` : "Spustit prop challenge"}
                </button>

                {propStats && propResults && mcScope === "global" && (
                  <McPropCharts
                    Plot={Plot}
                    propResults={propResults}
                    propStats={propStats}
                    passCurves={passCurves}
                    failCurves={failCurves}
                  />
                )}
                {propStatsByRegime && propByRegime && mcScope === "per_regime" && (
                  <div className="space-y-8">
                    {(["up", "down", "range"] as const).map((k) => {
                      const stats = propStatsByRegime[k];
                      const curves = propCurvesByRegime?.[k];
                      const arr = propByRegime[k];
                      if (!stats || !curves || !arr?.length) return null;
                      return (
                        <div key={k} className="space-y-2">
                          <div className="text-xs font-medium text-zinc-200">
                            {REGIME_DISPLAY[k]} — {arr.length} simulací (bucket:{" "}
                            {normalizedInput.trades.filter((t) => t.regime === k).length} obchodů)
                          </div>
                          <McPropCharts
                            Plot={Plot}
                            propResults={arr}
                            propStats={stats}
                            passCurves={curves.pass}
                            failCurves={curves.fail}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function McShuffleRobustnessTable({ results }: { results: ShuffleSimRunResult[] }) {
  const col = (f: (r: ShuffleSimRunResult) => number) => {
    const xs = results.map(f).filter((x) => Number.isFinite(x));
    return {
      p10: sampleQuantile(xs, 0.1),
      p50: sampleQuantile(xs, 0.5),
      p90: sampleQuantile(xs, 0.9),
      mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN,
    };
  };

  const rows: {
    label: string;
    hint?: string;
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    fmt: (v: number) => string;
  }[] = [
    {
      label: "Celkový výnos",
      hint: "% k initial — sequencing risk",
      ...col((r) => r.totalReturnPct),
      fmt: (v) => `${fmtMcNum(v, 2)} %`,
    },
    {
      label: "Max drawdown",
      hint: "% z peak equity",
      ...col((r) => r.maxDrawdownPct),
      fmt: (v) => `${fmtMcNum(v, 2)} %`,
    },
    {
      label: "Win rate",
      hint: "z uzavřených obchodů",
      ...col((r) => r.winRate * 100),
      fmt: (v) => `${fmtMcNum(v, 2)} %`,
    },
    {
      label: "Profit factor",
      hint: "hrubý zisk / hrubá ztráta",
      ...col((r) => r.profitFactor),
      fmt: (v) => (v >= 1e6 ? "∞" : fmtMcNum(v, 2)),
    },
    {
      label: "Expectancy",
      hint: "průměr PnL / obchod (USD)",
      ...col((r) => r.expectancy),
      fmt: (v) => fmtMcNum(v, 2),
    },
    {
      label: "σ PnL / trade",
      hint: "rozptyl výsledků obchodů",
      ...col((r) => r.pnlStd),
      fmt: (v) => fmtMcNum(v, 2),
    },
    {
      label: "Max série ztrát",
      hint: "nejdelší řada záporných v tomto pořadí",
      ...col((r) => r.maxConsecutiveLosses),
      fmt: (v) => String(Math.round(v)),
    },
    {
      label: "Výnos / max DD",
      hint: "Calmar‑like v rámci jedné permutace",
      ...col((r) => r.returnOverMaxDd),
      fmt: (v) => {
        if (!Number.isFinite(v)) return "—";
        if (v >= 1e6) return ">1e6";
        if (v <= -1e6) return "<−1e6";
        return fmtMcNum(v, 2);
      },
    },
    {
      label: "Sharpe‑like",
      hint: "μ/σ × √n na výběru PnL (bez Rf)",
      ...col((r) => r.sharpeLike),
      fmt: (v) => fmtMcNum(v, 2),
    },
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/35 p-3">
      <div className="text-xs font-medium text-zinc-200">Robustnost pořadí obchodů (percentily přes shuffles)</div>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        Stejná sada obchodů, náhodné pořadí. Úzký rozsah p10–p90 u výnosu a Calmar‑like napovídá stabilnější edge; široký
        rozptyl profit factoru nebo expectancy znamená citlivost na pořadí.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 pr-3 font-medium">Metrika</th>
              <th className="py-2 pr-2 font-normal">p10</th>
              <th className="py-2 pr-2 font-normal">p50</th>
              <th className="py-2 pr-2 font-normal">p90</th>
              <th className="py-2 pr-2 font-normal">Průměr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-zinc-800/80 text-zinc-300">
                <td className="py-2 pr-3">
                  <div>{row.label}</div>
                  {row.hint ? <div className="text-[10px] text-zinc-600">{row.hint}</div> : null}
                </td>
                <td className="py-2 pr-2 font-mono text-zinc-400">{row.fmt(row.p10)}</td>
                <td className="py-2 pr-2 font-mono text-zinc-100">{row.fmt(row.p50)}</td>
                <td className="py-2 pr-2 font-mono text-zinc-400">{row.fmt(row.p90)}</td>
                <td className="py-2 pr-2 font-mono text-zinc-500">{row.fmt(row.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtMcNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Plotly v CSS grid bez min-w-0/minmax přetéká; úzký rozsah dat dělá z histogramu „karton“. */
function mcHistogramPlotOptions(x: number[]): {
  nbinsx: number;
  xaxis: Record<string, unknown>;
} {
  const xs = x.filter((v) => Number.isFinite(v));
  if (xs.length === 0) {
    return { nbinsx: 12, xaxis: { gridcolor: "#27272a", nticks: 6, automargin: true } };
  }
  let lo = xs[0]!;
  let hi = xs[0]!;
  for (const v of xs) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const scale = Math.max(Math.abs(lo), Math.abs(hi), 1e-12);
  const rel = span / scale;

  let nbinsx = Math.min(36, Math.max(10, Math.round(Math.sqrt(xs.length) * 2.2)));

  const tickformat =
    span === 0 || rel < 1e-12
      ? ".4g"
      : span < 0.02
        ? ".4f"
        : span < 200
          ? ".3g"
          : ",.4~s";

  const xaxis: Record<string, unknown> = {
    gridcolor: "#27272a",
    nticks: 8,
    automargin: true,
    tickformat,
  };

  if (span === 0 || !Number.isFinite(span) || rel < 1e-12) {
    const mid = (lo + hi) / 2;
    const pad = Math.max(Math.abs(mid) * 0.02, Math.max(1, Math.abs(mid) * 1e-6));
    xaxis.range = [mid - pad, mid + pad];
    nbinsx = 14;
  } else if (rel < 5e-4) {
    const pad = Math.max(span * 0.2, scale * 1e-9);
    xaxis.range = [lo - pad, hi + pad];
  }

  return { nbinsx, xaxis };
}

function McShuffleCharts({
  Plot,
  results,
  bands,
  simCount,
}: {
  Plot: ComponentType<any> | null;
  results: ShuffleSimRunResult[];
  bands: ReturnType<typeof aggregateShuffleEquityBands> | null;
  simCount: number;
}) {
  const finalEq = results.map((r) => r.finalEquity);
  const maxDd = results.map((r) => r.maxDrawdownPct);
  const winRt = results.map((r) => r.winRate * 100);
  const retPct = results.map((r) => r.totalReturnPct);
  const profFac = results.map((r) => Math.min(r.profitFactor, 14));
  const expect = results.map((r) => r.expectancy);
  const consec = results.map((r) => r.maxConsecutiveLosses);
  const calmarish = results.map((r) => Math.min(25, Math.max(-25, r.returnOverMaxDd)));
  const sharpeL = results.map((r) => r.sharpeLike);

  if (!Plot) {
    return <div className="text-sm text-zinc-500">Načítání grafů…</div>;
  }

  const xBand = bands ? bands.equityP50.map((_, i) => i) : [];

  return (
    <div className="space-y-6">
      <div className="text-[11px] text-zinc-500">
        Simulací: <span className="text-zinc-300">{simCount}</span>
      </div>
      {bands && (
        <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="px-2 pt-2 text-xs font-medium text-zinc-300">Rozdělení equity curve (p10 / p50 / p90)</div>
          <div className="h-[320px] w-full min-w-0 max-w-full">
            <Plot
              data={[
                {
                  x: xBand,
                  y: bands.equityP90,
                  type: "scatter",
                  mode: "lines",
                  line: { width: 0 },
                  name: "p90",
                  showlegend: false,
                },
                {
                  x: xBand,
                  y: bands.equityP10,
                  type: "scatter",
                  mode: "lines",
                  fill: "tonexty",
                  fillcolor: "rgba(16,185,129,0.12)",
                  line: { width: 0 },
                  name: "p10–p90",
                },
                {
                  x: xBand,
                  y: bands.equityP50,
                  type: "scatter",
                  mode: "lines",
                  line: { color: "#34d399", width: 2 },
                  name: "Medián",
                },
              ]}
              layout={{
                autosize: true,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#a1a1aa", size: 11 },
                margin: { t: 28, r: 12, b: 40, l: 48 },
                xaxis: { title: "Pořadí obchodu", gridcolor: "#27272a" },
                yaxis: { title: "Equity", gridcolor: "#27272a" },
                showlegend: true,
                legend: { orientation: "h", y: -0.2 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </div>
      )}

      <McShuffleRobustnessTable results={results} />

      <div className="text-xs font-medium text-zinc-400">Histogramy</div>
      <div className="grid min-w-0 max-w-full auto-rows-auto gap-4 md:grid-cols-2 md:[grid-template-columns:repeat(2,minmax(0,1fr))] xl:[grid-template-columns:repeat(3,minmax(0,1fr))]">
        <McHist Plot={Plot} title="Finální balance" x={finalEq} color="#34d399" />
        <McHist Plot={Plot} title="Max drawdown %" x={maxDd} color="#f87171" />
        <McHist Plot={Plot} title="Win rate %" x={winRt} color="#60a5fa" />
        <McHist
          Plot={Plot}
          title="Celkový výnos %"
          x={retPct}
          color="#a78bfa"
        />
        <McHist
          Plot={Plot}
          title={"Profit factor (osa ≤ 14)"}
          x={profFac}
          color="#fbbf24"
        />
        <McHist Plot={Plot} title="Expectancy (USD)" x={expect} color="#2dd4bf" />
        <McHist
          Plot={Plot}
          title="Max série ztrát"
          x={consec}
          color="#fb7185"
        />
        <McHist
          Plot={Plot}
          title="Výnos/max DD (osa ±25)"
          x={calmarish}
          color="#94a3b8"
        />
        <McHist Plot={Plot} title="Sharpe‑like" x={sharpeL} color="#38bdf8" />
      </div>
    </div>
  );
}

function McHist({
  Plot,
  title,
  x,
  color,
  height = 220,
}: {
  Plot: ComponentType<any>;
  title: string;
  x: number[];
  color: string;
  height?: number;
}) {
  const { nbinsx, xaxis } = mcHistogramPlotOptions(x);

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
      <div className="px-2 pt-2 text-xs font-medium text-zinc-300">{title}</div>
      <div className="w-full min-w-0 max-w-full" style={{ height }}>
        <Plot
          data={[{ type: "histogram", x, marker: { color }, nbinsx }]}
          layout={{
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: { color: "#a1a1aa", size: 10 },
            margin: { t: 8, r: 10, b: 36, l: 44 },
            bargap: 0.08,
            xaxis: { ...xaxis, title: "" },
            yaxis: { title: "Počet", gridcolor: "#27272a", rangemode: "tozero" },
          }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

function McPropCharts({
  Plot,
  propResults,
  propStats,
  passCurves,
  failCurves,
}: {
  Plot: ComponentType<any> | null;
  propResults: PropFirmRunResult[];
  propStats: ReturnType<typeof buildPropStats>;
  passCurves: number[][];
  failCurves: number[][];
}) {
  if (!Plot) {
    return <div className="text-sm text-zinc-500">Načítání grafů…</div>;
  }

  const reasons = Object.entries(propStats.failCounts).filter(([, n]) => n > 0) as [PropFirmFailReason, number][];
  const labels = reasons.map(([k]) => propFailReasonLabel(k));

  const passTraces = passCurves.map((curve, i) => ({
    x: curve.map((_, j) => j),
    y: curve,
    type: "scatter" as const,
    mode: "lines" as const,
    line: { width: 1, color: "rgba(52,211,153,0.35)" },
    showlegend: i === 0,
    name: i === 0 ? "Pass (vzorek)" : undefined,
  }));

  const failTraces = failCurves.map((curve, i) => ({
    x: curve.map((_, j) => j),
    y: curve,
    type: "scatter" as const,
    mode: "lines" as const,
    line: { width: 1, color: "rgba(248,113,113,0.35)" },
    showlegend: i === 0,
    name: i === 0 ? "Fail (vzorek)" : undefined,
  }));

  const finalEq = propResults.map((r) => r.finalEquity);
  const maxDdPath = propResults.map((r) => r.maxDrawdownPct);
  const tradesToPassH = propResults.filter((r) => r.passed).map((r) => r.tradesToPass).filter((x): x is number => x != null);
  const retPct = propResults.map((r) => r.totalReturnPct);

  const wilson = propStats.wilson;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
          <div className="text-xs text-zinc-500">Pass rate</div>
          <div className="text-2xl font-semibold text-emerald-400">{(propStats.passRate * 100).toFixed(1)} %</div>
          <div className="mt-1 text-xs text-zinc-500">
            Úspěšných: {propStats.passedN} / {propStats.simCount}
          </div>
          {wilson ? (
            <div className="mt-2 text-[10px] leading-snug text-zinc-600">
              95% Wilson: {(wilson.low * 100).toFixed(1)}–{(wilson.high * 100).toFixed(1)} % (hrubá jistota rozsahu
              pass rate při daném N)
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
          <div className="text-xs text-zinc-500">Obchodů do passu (jen úspěch)</div>
          <div className="text-2xl font-semibold text-zinc-100">
            {propStats.tradesPassP50 != null ? propStats.tradesPassP50.toFixed(1) : "—"}
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
            <div>p10: {propStats.tradesPassP10 != null ? propStats.tradesPassP10.toFixed(0) : "—"}</div>
            <div>p90: {propStats.tradesPassP90 != null ? propStats.tradesPassP90.toFixed(0) : "—"}</div>
            <div>Průměr: {propStats.avgTrades != null ? propStats.avgTrades.toFixed(1) : "—"}</div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
          <div className="text-xs text-zinc-500">Konečná equity (všechny simulace)</div>
          <div className="mt-2 space-y-0.5 font-mono text-[11px] text-zinc-400">
            <div>p10: {fmtMcNum(propStats.finalEquityP10, 0)}</div>
            <div className="text-zinc-200">p50: {fmtMcNum(propStats.finalEquityP50, 0)}</div>
            <div>p90: {fmtMcNum(propStats.finalEquityP90, 0)}</div>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
          <div className="text-xs text-zinc-500">Max DD na cestě / výnos</div>
          <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
            <div>Medián max DD (vše): {fmtMcNum(propStats.maxDdP50All, 2)} %</div>
            <div>Medián max DD | pass: {propStats.medianMaxDdPass != null ? `${fmtMcNum(propStats.medianMaxDdPass, 2)} %` : "—"}</div>
            <div>Medián max DD | fail: {propStats.medianMaxDdFail != null ? `${fmtMcNum(propStats.medianMaxDdFail, 2)} %` : "—"}</div>
            <div className="border-t border-zinc-800/80 pt-1 text-zinc-500">
              Celkový výnos % — p10 / p50 / p90: {fmtMcNum(propStats.returnP10, 2)} / {fmtMcNum(propStats.returnP50, 2)} /{" "}
              {fmtMcNum(propStats.returnP90, 2)}
            </div>
            <div className="pt-1 text-zinc-600">
              Medián výnos % | pass:{" "}
              {propStats.medianReturnPass != null ? `${fmtMcNum(propStats.medianReturnPass, 2)} %` : "—"} · fail:{" "}
              {propStats.medianReturnFail != null ? `${fmtMcNum(propStats.medianReturnFail, 2)} %` : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/35 p-3">
        <div className="text-xs font-medium text-zinc-200">Čtení výsledků (robustnost)</div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] leading-relaxed text-zinc-500">
          <li>
            Nízký pass rate nebo široký Wilsonův interval = strategie nemusí přežít náhodné pořadí / šum při pravidlech
            účtu.
          </li>
          <li>
            Velký rozdíl mezi mediánem max DD u fail vs. pass ukazuje, kde se typicky trh při pravidlech „zlomí“.
          </li>
          <li>
            Percentily konečné equity a výnosu % přes všechny běhy zobrazují tail risk i při stejném nastavení šlapky.
          </li>
        </ul>
      </div>

      <div className="grid min-w-0 max-w-full gap-4 md:grid-cols-2 md:[grid-template-columns:repeat(2,minmax(0,1fr))]">
        <McHist Plot={Plot} title="Konečná equity (všechny sim.)" x={finalEq} color="#34d399" />
        <McHist Plot={Plot} title="Max drawdown % (cesta)" x={maxDdPath} color="#f87171" />
        <McHist
          Plot={Plot}
          title="Obchodů do passu (jen úspěch)"
          x={tradesToPassH}
          color="#a78bfa"
        />
        <McHist Plot={Plot} title="Celkový výnos % (všechny sim.)" x={retPct} color="#60a5fa" />
      </div>

      {labels.length > 0 && (
        <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="px-2 pt-2 text-xs font-medium text-zinc-300">Rozpad důvodů neúspěchu</div>
          <div className="h-[300px] w-full min-w-0 max-w-full">
            <Plot
              data={[
                {
                  type: "bar",
                  x: labels,
                  y: reasons.map(([, n]) => n),
                  marker: { color: "#f87171" },
                },
              ]}
              layout={{
                autosize: true,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#a1a1aa", size: 11 },
                margin: { t: 24, r: 12, b: 80, l: 40 },
                xaxis: { tickangle: -25, gridcolor: "#27272a", automargin: true },
                yaxis: { title: "Počet", gridcolor: "#27272a" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </div>
      )}

      <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
        <div className="px-2 pt-2 text-xs font-medium text-zinc-300">Equity — vzorek pass vs fail</div>
        <div className="h-[340px] w-full min-w-0 max-w-full">
          <Plot
            data={[...failTraces, ...passTraces]}
            layout={{
              autosize: true,
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              font: { color: "#a1a1aa", size: 11 },
              margin: { t: 28, r: 12, b: 40, l: 48 },
              xaxis: { title: "Pořadí obchodu", gridcolor: "#27272a" },
              yaxis: { title: "Equity", gridcolor: "#27272a" },
              showlegend: true,
              legend: { orientation: "h", y: -0.15 },
            }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}
