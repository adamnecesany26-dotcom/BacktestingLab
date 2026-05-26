"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { RunResponse } from "@shared/types";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { tradeRFromTrade } from "@/lib/tradeMetrics";
import {
  rHistogramBuckets,
  tradesByCalendarPeriod,
  tradesByHourLocal,
  tradesByWeekday,
  type CalendarPeriod,
  type TimeBucketStat,
} from "@/lib/analytics/tradeTimeBreakdowns";

const EquityChart = dynamic(() => import("@/components/charts/EquityChart"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-zinc-500">Načítám equity…</div>,
});

function maxAbsPnL(buckets: TimeBucketStat[]): number {
  return buckets.reduce((m, b) => Math.max(m, Math.abs(b.pnlSum)), 0) || 1;
}

function BucketRows({ buckets }: { buckets: TimeBucketStat[] }) {
  const cap = maxAbsPnL(buckets);
  const hasData = buckets.some((b) => b.tradeCount > 0);
  if (!hasData) {
    return <p className="text-xs text-zinc-500">Nedostatek dat (chybí čas uzavření u obchodů).</p>;
  }
  return (
    <div className="space-y-1.5 pr-1">
      {buckets.map((b) => {
        const w = cap > 0 ? (Math.abs(b.pnlSum) / cap) * 100 : 0;
        const wr = b.tradeCount > 0 ? (b.wins / b.tradeCount) * 100 : 0;
        const pos = b.pnlSum >= 0;
        return (
          <div key={b.key} className="grid grid-cols-[7rem_1fr_auto] gap-2 items-center text-[11px]">
            <span className="text-zinc-500 truncate" title={b.label}>
              {b.label}
            </span>
            <div className="h-2 rounded bg-zinc-800 overflow-hidden min-w-0">
              <div
                className={`h-full ${pos ? "bg-emerald-500/80" : "bg-rose-500/80"}`}
                style={{ width: `${Math.max(4, w)}%` }}
              />
            </div>
            <div className="text-right font-mono text-zinc-300 shrink-0">
              {b.pnlSum >= 0 ? "+" : ""}
              {b.pnlSum.toFixed(0)}$ <span className="text-zinc-600">({b.tradeCount} · WR {wr.toFixed(0)}%)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownSection({
  title,
  subtitle,
  buckets,
}: {
  title?: string;
  subtitle?: string;
  buckets: TimeBucketStat[];
}) {
  const hasData = buckets.some((b) => b.tradeCount > 0);
  if (!hasData) {
    return (
      <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
        {title ? <div className="text-xs font-medium text-zinc-300">{title}</div> : null}
        {subtitle && <p className="text-[10px] text-zinc-600 mt-0.5">{subtitle}</p>}
        <p className="text-xs text-zinc-500 mt-2">Nedostatek dat (chybí čas uzavření u obchodů).</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
      {title ? <div className="text-xs font-medium text-zinc-300">{title}</div> : null}
      {subtitle && <p className="text-[10px] text-zinc-600 mt-0.5">{subtitle}</p>}
      <div className="mt-3 max-h-64 overflow-y-auto">
        <BucketRows buckets={buckets} />
      </div>
    </div>
  );
}

export function AnalyticsFinancialsPanel({ results }: { results: RunResponse }) {
  const trades = results.trades ?? [];
  const m = results.metrics;
  const [calPeriod, setCalPeriod] = useState<CalendarPeriod>("day");

  const weekday = useMemo(() => tradesByWeekday(trades), [trades]);
  const byHour = useMemo(() => tradesByHourLocal(trades), [trades]);
  const byCal = useMemo(() => tradesByCalendarPeriod(trades, calPeriod), [trades, calPeriod]);
  const rVals = useMemo(
    () => trades.map((t) => tradeRFromTrade(t)).filter((x): x is number => x != null && Number.isFinite(x)),
    [trades],
  );
  const rHist = useMemo(() => rHistogramBuckets(rVals), [rVals]);
  const rMax = useMemo(() => rHist.reduce((a, b) => Math.max(a, b.count), 0) || 1, [rHist]);

  const pfStatus = typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/35 p-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Výkonnost v čase — equity</div>
        <EquityChart
          equityCurve={results.equityCurve}
          equity={results.equityCurve ? undefined : results.equity}
          height={300}
          dates={
            !results.equityCurve?.length && results.ohlc?.length
              ? (() => {
                  const first = results.ohlc![0]?.date;
                  if (!first) return undefined;
                  const d = new Date(first);
                  d.setDate(d.getDate() - 1);
                  return [d.toISOString(), ...results.ohlc!.map((o) => o.date)];
                })()
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownSection
          title="Den v týdnu (exit, lokální čas)"
          subtitle="Součet PnL podle dne uzavření obchodu."
          buckets={weekday}
        />
        <BreakdownSection
          title="Hodina dne (exit, lokální čas)"
          subtitle="0–23 podle lokální časové zóny prohlížeče."
          buckets={byHour}
        />
      </div>

      <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-zinc-300">Agregace podle období</div>
            <p className="text-[10px] text-zinc-600 mt-0.5">Denní / týdenní / měsíční součty PnL z uzavřených obchodů.</p>
          </div>
          <select
            value={calPeriod}
            onChange={(e) => setCalPeriod(e.target.value as CalendarPeriod)}
            className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
          >
            <option value="day">Denní</option>
            <option value="week">Týdenní</option>
            <option value="month">Měsíční</option>
          </select>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto">
          <BucketRows buckets={byCal} />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Distribuce R</div>
        <p className="text-[10px] text-zinc-600 mb-3">
          Z uzavřených obchodů s odvozeným počátečním rizikem (stejná logika jako křivka R ve výsledcích).
        </p>
        {rVals.length === 0 ? (
          <p className="text-sm text-zinc-500">Žádné obchody s vypočitatelným R.</p>
        ) : (
          <div className="space-y-1">
            {rHist.map((bin, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-2 items-center text-[11px]">
                <span className="text-zinc-500 font-mono">{bin.label}</span>
                <div className="h-2 rounded bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-500/75"
                    style={{ width: `${Math.max(3, (bin.count / rMax) * 100)}%` }}
                  />
                </div>
                <span className="text-zinc-400 text-right">{bin.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-3">Monetizační metriky (engine)</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Profit factor</div>
            <div className="font-mono text-zinc-100 mt-0.5">{formatProfitFactorDisplay(m.profitFactor, pfStatus)}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Hrubý zisk</div>
            <div className="font-mono text-emerald-400 mt-0.5">
              {m.grossProfitClosedTrades != null ? `$${Number(m.grossProfitClosedTrades).toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Hrubá ztráta (abs)</div>
            <div className="font-mono text-rose-400 mt-0.5">
              {m.grossLossAbsClosedTrades != null ? `$${Number(m.grossLossAbsClosedTrades).toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Payoff ratio</div>
            <div className="font-mono text-zinc-100 mt-0.5">
              {m.payoffRatio != null && Number.isFinite(Number(m.payoffRatio)) ? Number(m.payoffRatio).toFixed(2) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">Kelly (i.i.d.)</div>
            <div className="font-mono text-zinc-100 mt-0.5">
              {m.kellyFraction != null && Number.isFinite(Number(m.kellyFraction))
                ? `${(Number(m.kellyFraction) * 100).toFixed(1)} %`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase">CAGR</div>
            <div className="font-mono text-zinc-100 mt-0.5">
              {m.cagr != null && Number.isFinite(Number(m.cagr)) ? `${(Number(m.cagr) * 100).toFixed(2)} %` : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
