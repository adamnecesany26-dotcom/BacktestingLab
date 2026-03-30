"use client";

import { useMemo, useState } from "react";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";

function shortIso(iso: string): string {
  const s = String(iso ?? "").trim();
  if (!s) return "—";
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatUsd(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}$${v.toFixed(2)}`;
}

function sparklinePaths(opts: {
  trainPct: number[];
  testPct: number[];
  trainBarCount: number;
  testBarCount: number;
  w: number;
  h: number;
  pad: number;
}): { trainD: string; testD: string; minY: number; maxY: number; splitX: number } | null {
  const { trainPct, testPct, trainBarCount, testBarCount, w, h, pad } = opts;
  const all = [...trainPct, ...testPct];
  if (all.length === 0) return null;
  let minY = Math.min(...all, 0);
  let maxY = Math.max(...all, 0);
  const span = Math.max(maxY - minY, 1e-6);
  minY -= span * 0.08;
  maxY += span * 0.08;
  const span2 = maxY - minY;

  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const totalBars = Math.max(1, trainBarCount + testBarCount);
  const trainShare = trainBarCount / totalBars;
  const splitX = pad + trainShare * innerW;

  const toPath = (pts: number[], x0: number, x1: number): string => {
    if (pts.length === 0) return "";
    if (pts.length === 1) {
      const y = pad + (1 - (pts[0]! - minY) / span2) * innerH;
      const xm = (x0 + x1) / 2;
      return `M ${xm.toFixed(2)} ${y.toFixed(2)}`;
    }
    return pts
      .map((p, i) => {
        const t = i / (pts.length - 1);
        const x = x0 + t * (x1 - x0);
        const y = pad + (1 - (p - minY) / span2) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const trainD = toPath(trainPct, pad, splitX);
  const testD = toPath(testPct, splitX, w - pad);
  return { trainD, testD, minY, maxY, splitX };
}

function FoldSparkline({
  spark,
  trainBarCount,
  testBarCount,
  testReturnUsd,
}: {
  spark: { trainPct?: unknown; testPct?: unknown } | null | undefined;
  trainBarCount: number;
  testBarCount: number;
  testReturnUsd: number;
}) {
  const trainPct = Array.isArray(spark?.trainPct)
    ? (spark!.trainPct as number[]).filter((x) => Number.isFinite(x))
    : [];
  const testPct = Array.isArray(spark?.testPct)
    ? (spark!.testPct as number[]).filter((x) => Number.isFinite(x))
    : [];
  const geo = sparklinePaths({
    trainPct,
    testPct,
    trainBarCount: Math.max(1, trainBarCount),
    testBarCount: Math.max(1, testBarCount),
    w: 320,
    h: 52,
    pad: 4,
  });

  if (!geo) {
    return (
      <div className="rounded-md border border-dashed border-zinc-700/60 bg-zinc-950/40 px-3 py-4 text-center text-[11px] text-zinc-500">
        Sparkline není k dispozici (starší backend — spusť validaci znovu).
      </div>
    );
  }

  const testColor = testReturnUsd >= 0 ? "#34d399" : "#fb7185";
  return (
    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/60 p-2">
      <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        <span>Equity (normalizováno v rámci okna, % od startu)</span>
        <span>
          <span className="text-sky-400/90">train</span>
          <span className="mx-1.5 text-zinc-600">|</span>
          <span style={{ color: testColor }}>test</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 320 52`}
        className="w-full max-w-full h-[52px]"
        preserveAspectRatio="none"
        role="img"
        aria-label="Equity sparkline train a test"
      >
        <line
          x1={geo.splitX}
          y1={2}
          x2={geo.splitX}
          y2={50}
          stroke="rgba(113,113,122,0.35)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {geo.trainD && (
          <path d={geo.trainD} fill="none" stroke="rgba(56,189,248,0.9)" strokeWidth={1.35} vectorEffect="non-scaling-stroke" />
        )}
        {geo.testD && (
          <path d={geo.testD} fill="none" stroke={testColor} strokeWidth={1.55} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5 font-mono">
        <span>{geo.minY.toFixed(2)}%</span>
        <span>{geo.maxY.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function FoldTimeline({ trainBars, testBars }: { trainBars: number; testBars: number }) {
  const t = Math.max(1, trainBars + testBars);
  const pw = (trainBars / t) * 100;
  const ow = (testBars / t) * 100;
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 rounded-full overflow-hidden border border-zinc-700/50">
        <div
          className="h-full bg-gradient-to-b from-sky-500/80 to-sky-600/70"
          style={{ width: `${pw}%` }}
          title={`IS / train: ${trainBars} bars`}
        />
        <div
          className="h-full bg-gradient-to-b from-emerald-500/35 to-emerald-600/45"
          style={{ width: `${ow}%` }}
          title={`OOS / test: ${testBars} bars`}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>
          IS <span className="text-sky-300/90">{trainBars}</span> barů
        </span>
        <span>
          OOS <span className="text-emerald-300/80">{testBars}</span> barů
        </span>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-700/45 bg-zinc-900/70 px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">{label}</div>
      <div className={`text-sm font-semibold tabular-nums truncate ${valueClass}`}>{value}</div>
    </div>
  );
}

function FoldOverviewBars({ folds }: { folds: Record<string, unknown>[] }) {
  const rows = useMemo(() => {
    return folds.map((f) => {
      const id = String(f.id ?? "");
      const tm = f.testMetrics && typeof f.testMetrics === "object" ? (f.testMetrics as Record<string, unknown>) : {};
      const ret = Number(tm.totalReturnUsd ?? NaN);
      return { id, ret };
    });
  }, [folds]);

  const maxAbs = useMemo(() => {
    const m = Math.max(1e-6, ...rows.map((r) => (Number.isFinite(r.ret) ? Math.abs(r.ret) : 0)));
    return m;
  }, [rows]);

  if (rows.length < 2) return null;

  return (
    <div className="mb-4 rounded-xl border border-zinc-700/40 bg-zinc-950/35 p-3">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Porovnání test P/L napříč foldy</div>
      <div className="space-y-2">
        {rows.map(({ id, ret }) => {
          if (!Number.isFinite(ret)) {
            return (
              <div key={id} className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-mono w-20 shrink-0">{id}</span>
                <span>—</span>
              </div>
            );
          }
          const wPct = Math.min(100, (Math.abs(ret) / maxAbs) * 100);
          const bg = ret >= 0 ? "from-emerald-500/75 to-teal-600/55" : "from-rose-500/75 to-red-600/55";
          return (
            <div key={id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-zinc-400 w-20 shrink-0">{id}</span>
              <div className="flex-1 h-5 rounded-md bg-zinc-900/80 border border-zinc-800/80 overflow-hidden flex items-center">
                <div
                  className={`h-full bg-gradient-to-r ${bg} transition-all min-w-[3px]`}
                  style={{ width: `${wPct}%` }}
                  title={formatUsd(ret)}
                />
              </div>
              <span className={`tabular-nums w-24 text-right shrink-0 ${ret >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {formatUsd(ret)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ValidationFoldsPanelProps {
  folds: Record<string, unknown>[];
  guardHints: string[];
  foldsMissingPayload: boolean;
  foldsMissingUnknown: boolean;
  manifestFoldCount: number | null;
}

export function ValidationFoldsPanel({
  folds,
  guardHints,
  foldsMissingPayload,
  foldsMissingUnknown,
  manifestFoldCount,
}: ValidationFoldsPanelProps) {
  const [openId, setOpenId] = useState<string | null>(() => {
    const first = folds[0];
    return first ? String(first.id ?? "") || null : null;
  });

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/50 via-zinc-900/30 to-zinc-950/50 p-4 shadow-lg shadow-black/20">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Walk-forward / OOS</div>
          <h3 className="text-base font-semibold text-zinc-100">Foldy a výkon mimo vzorek</h3>
        </div>
        <div className="text-[11px] text-zinc-500">
          {folds.length} fold{folds.length === 1 ? "" : "ů"} · klíčové metriky z <span className="text-zinc-400">test</span> okna
        </div>
      </div>

      {foldsMissingPayload && (
        <div className="mb-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-2.5 text-xs text-rose-100">
          Backend hlásí <code className="text-rose-200/90">manifest.validationFoldCount = {manifestFoldCount}</code>, ale v odpovědi
          chybí <code className="text-rose-200/90">validation.folds</code>. Zkuste export JSON nebo nový backtest.
        </div>
      )}
      {foldsMissingUnknown && (
        <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs text-amber-100">
          Konfigurace OOS / WF, ale chybí data foldů (
          <code className="text-amber-200/90">validation.folds</code>
          {manifestFoldCount != null ? (
            <>
              {" "}
              · manifest: <code className="text-amber-200/90">{manifestFoldCount}</code>
            </>
          ) : null}
          ). Spusť backtest znovu na aktuálním backendu.
        </div>
      )}

      {guardHints.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-100">
          <div className="text-amber-200 font-medium mb-1">Guardrails (heuristika)</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {guardHints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {folds.length > 0 ? <FoldOverviewBars folds={folds} /> : null}

      <div className="space-y-3">
        {folds.map((f) => {
          const id = String(f.id ?? "");
          const open = openId === id;
          const tm = f.testMetrics && typeof f.testMetrics === "object" ? (f.testMetrics as Record<string, unknown>) : {};
          const tr = f.train && typeof f.train === "object" ? (f.train as Record<string, unknown>) : {};
          const te = f.test && typeof f.test === "object" ? (f.test as Record<string, unknown>) : {};

          const trainBars = Math.max(0, Math.floor(Number(f.trainBarCount ?? 0)));
          const testBars = Math.max(0, Math.floor(Number(f.testBarCount ?? 0)));
          const testRet = Number(tm.totalReturnUsd ?? NaN);
          const trainRet = Number(tr.totalReturnUsd ?? NaN);

          const spark = f.equitySparklinePct && typeof f.equitySparklinePct === "object" ? (f.equitySparklinePct as Record<string, unknown>) : null;

          const tc = tm.tradeCount != null ? String(tm.tradeCount) : "—";

          return (
            <div
              key={id}
              className="rounded-xl border border-zinc-700/45 overflow-hidden bg-zinc-950/40 backdrop-blur-sm"
            >
              <button
                type="button"
                className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-3 bg-zinc-900/50 hover:bg-zinc-800/55 transition-colors"
                onClick={() => setOpenId(open ? null : id)}
              >
                <span className="font-mono text-sm text-emerald-300/90 shrink-0">{id}</span>
                <span className="text-zinc-500 text-lg leading-none shrink-0 w-4">{open ? "▼" : "▶"}</span>
                <div className="flex-1 min-w-[12rem] flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                  <span>
                    IS <span className="text-zinc-300">{shortIso(String(f.trainStart ?? ""))}</span> →{" "}
                    <span className="text-zinc-300">{shortIso(String(f.trainEnd ?? ""))}</span>
                  </span>
                  <span>
                    OOS <span className="text-zinc-300">{shortIso(String(f.testStart ?? ""))}</span> →{" "}
                    <span className="text-zinc-300">{shortIso(String(f.testEnd ?? ""))}</span>
                  </span>
                  <span className="text-zinc-500">obchodů (test): {tc}</span>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums shrink-0 ${Number.isFinite(testRet) && testRet >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  Test {formatUsd(testRet)}
                </div>
              </button>

              {open && (
                <div className="px-4 py-4 border-t border-zinc-800/80 space-y-4">
                  <FoldTimeline trainBars={trainBars} testBars={testBars} />

                  <FoldSparkline
                    spark={spark}
                    trainBarCount={trainBars}
                    testBarCount={testBars}
                    testReturnUsd={Number.isFinite(testRet) ? testRet : 0}
                  />

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <StatTile
                      label="Test P/L $"
                      value={formatUsd(tm.totalReturnUsd)}
                      valueClass={
                        Number.isFinite(testRet) ? (testRet >= 0 ? "text-emerald-300" : "text-rose-300") : "text-zinc-400"
                      }
                    />
                    <StatTile
                      label="Train P/L $"
                      value={formatUsd(tr.totalReturnUsd)}
                      valueClass={
                        Number.isFinite(trainRet) ? (trainRet >= 0 ? "text-sky-300" : "text-orange-300") : "text-zinc-400"
                      }
                    />
                    <StatTile
                      label="Profit factor"
                      value={formatProfitFactorDisplay(
                        tm.profitFactor as number | undefined,
                        typeof tm.profitFactorStatus === "string" ? tm.profitFactorStatus : undefined,
                      )}
                      valueClass={
                        tm.profitFactor != null && Number(tm.profitFactor) >= 1 ? "text-emerald-300" : "text-rose-300/90"
                      }
                    />
                    <StatTile
                      label="Max DD % (test)"
                      value={tm.maxDrawdownPct != null ? String(tm.maxDrawdownPct) : "—"}
                      valueClass="text-amber-200/90"
                    />
                    <StatTile
                      label="Win % (test)"
                      value={tm.winRate != null ? `${tm.winRate}%` : "—"}
                      valueClass="text-zinc-200"
                    />
                    <StatTile
                      label="Sharpe (test)"
                      value={tm.sharpeRatio != null ? String(tm.sharpeRatio) : "—"}
                      valueClass="text-zinc-200"
                    />
                  </div>

                  <div className="text-[10px] text-zinc-600 leading-relaxed">
                    Sparkline je <strong className="text-zinc-500">zvlášť normalizovaná</strong> v train a test okně (% od první hodnoty v
                    okně), ne stejná škála jako hlavní equity graf celého běhu. Slouží k rychlému tvaru křivky v IS vs. OOS.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
