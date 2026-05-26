"use client";

import { useMemo, useState } from "react";
import type { RunResponse } from "@shared/types";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { aggregateWalkForward } from "@/lib/analytics/walkForwardAggregate";
import { WalkForwardOosChart } from "@/components/results/analytics/WalkForwardOosChart";

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "" : "−";
  return `${sign}$${Math.abs(n).toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} %`;
}

function HeroMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad" | "neutral";
}) {
  const border =
    tone === "good"
      ? "border-emerald-500/35 bg-emerald-950/25"
      : tone === "bad"
        ? "border-rose-500/35 bg-rose-950/20"
        : "border-zinc-700/60 bg-zinc-900/40";
  const valCls = tone === "good" ? "text-emerald-200" : tone === "bad" ? "text-rose-200" : "text-zinc-100";
  return (
    <div className={`rounded-2xl border ${border} px-4 py-3 min-w-[9.5rem] flex-1 shadow-sm shadow-black/15`} title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1">
        {label}
        <span className="text-zinc-600 cursor-help font-normal normal-case">ⓘ</span>
      </div>
      <div className={`text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight ${valCls}`}>{value}</div>
    </div>
  );
}

export function WalkForwardDashboard({ results }: { results: RunResponse }) {
  const folds = Array.isArray(results.validation?.folds)
    ? (results.validation!.folds as Record<string, unknown>[])
    : [];
  const agg = useMemo(() => aggregateWalkForward(folds), [folds]);
  const summary = results.validation?.summary && typeof results.validation.summary === "object"
    ? (results.validation.summary as Record<string, unknown>)
    : null;

  const [showIsDetail, setShowIsDetail] = useState(false);

  if (!agg) return null;

  const oosRatio = agg.oosVsIsRatioPct;
  const ratioTone: "good" | "bad" | "neutral" =
    oosRatio == null
      ? "neutral"
      : oosRatio >= 55
        ? "good"
        : oosRatio >= 30
          ? "neutral"
          : "bad";

  const winTone: "good" | "bad" | "neutral" =
    agg.weightedOosWinRatePct == null
      ? "neutral"
      : agg.weightedOosWinRatePct >= 48
        ? "good"
        : agg.weightedOosWinRatePct >= 40
          ? "neutral"
          : "bad";

  const totalTone: "good" | "bad" | "neutral" = agg.totalOosReturnUsd >= 0 ? "good" : "bad";

  const pfDisp = formatProfitFactorDisplay(agg.medianOosProfitFactor ?? undefined, undefined);
  const pfTone: "good" | "bad" | "neutral" =
    agg.medianOosProfitFactor == null
      ? "neutral"
      : agg.medianOosProfitFactor >= 1.15
        ? "good"
        : agg.medianOosProfitFactor >= 1
          ? "neutral"
          : "bad";

  const ddTone: "good" | "bad" | "neutral" =
    agg.maxOosDdPct == null
      ? "neutral"
      : agg.maxOosDdPct <= 12
        ? "good"
        : agg.maxOosDdPct <= 25
          ? "neutral"
          : "bad";

  const maxAbsSeg = Math.max(1e-6, ...agg.segments.map((s) => Math.abs(s.oosReturnUsd)));

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-zinc-950/90 via-violet-950/15 to-zinc-950/95 p-4 sm:p-5 shadow-lg shadow-black/25">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Walk-forward — OOS souhrn</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl leading-relaxed">
              Za <strong className="text-zinc-400">5–10 s</strong>: je výkon mimo trénink konzistentní, nebo jen „nafouknutý“ IS? Tady jsou jen agregáty z{" "}
              <strong className="text-emerald-200/90">OOS (test)</strong> segmentů; IS je volitelně níže.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-full border border-zinc-700/60 bg-zinc-900/60 px-2.5 py-1 text-zinc-400">
              Foldů: <span className="text-zinc-200">{agg.foldCount}</span>
            </span>
            {summary?.avgDegradation != null ? (
              <span className="rounded-full border border-zinc-700/60 bg-zinc-900/60 px-2.5 py-1 text-zinc-400" title="(OOS−IS)/|IS| průměr napříč foldy">
                Ø degradace: <span className="text-zinc-200">{String(summary.avgDegradation)}</span>
              </span>
            ) : null}
            {Number(summary?.foldsFailedGates) > 0 ? (
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-200">
                Gate FAIL: {String(summary?.foldsFailedGates)}
              </span>
            ) : (
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-200/90">
                Gate FAIL: 0
              </span>
            )}
          </div>
        </div>

        {agg.redFlags.length > 0 ? (
          <div className="mb-4 space-y-2">
            {agg.redFlags.map((rf) => (
              <div
                key={rf.kind}
                className={`rounded-xl border px-3 py-2 text-xs ${
                  rf.severity === "high"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-100"
                }`}
              >
                <div className="font-medium">{rf.label}</div>
                <div className="text-[11px] opacity-90 mt-0.5 leading-relaxed">{rf.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100/90">
            Žádné silné červené flagy z heuristik — pořád ověř počet obchodů, latenci a reálné náklady.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <HeroMetric
            label="Total OOS return"
            value={formatUsd(agg.totalOosReturnUsd)}
            hint="Součet P/L USD napříč všemi OOS okny (disjunktní segmenty)."
            tone={totalTone}
          />
          <HeroMetric
            label="OOS vs IS ratio"
            value={oosRatio != null ? pct(oosRatio) : "—"}
            hint="(Součet OOS P/L) / (součet IS P/L) × 100 %. Opatrně při záporném IS."
            tone={ratioTone}
          />
          <HeroMetric
            label="Win rate (OOS, váž.)"
            value={agg.weightedOosWinRatePct != null ? pct(agg.weightedOosWinRatePct) : "—"}
            hint="Váha podle počtu obchodů v každém OOS segmentu."
            tone={winTone}
          />
          <HeroMetric
            label="Max DD (OOS seg.)"
            value={agg.maxOosDdPct != null ? pct(agg.maxOosDdPct) : "—"}
            hint="Nejhorší max. drawdown % z jednotlivých OOS oken (ne z jedné spojité křivky)."
            tone={ddTone}
          />
          <HeroMetric
            label="Profit factor (OOS)"
            value={pfDisp}
            hint="Medián profit factoru napříč OOS segmenty (engine ho kapuje 0–5)."
            tone={pfTone}
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-200 mb-2">OOS equity (jen skládané segmenty)</h3>
        <WalkForwardOosChart
          stitched={agg.stitched}
          foldStartIndices={agg.foldStartIndices}
          ddTroughIndices={agg.ddTroughIndices}
          spikeIndices={agg.spikeIndices}
        />
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Segmenty — konzistence OOS</h3>
        <div className="space-y-3">
          {agg.segments.map((s) => {
            const wPct = Math.min(100, (Math.abs(s.oosReturnUsd) / maxAbsSeg) * 100);
            const bg =
              s.oosReturnUsd >= 0 ? "from-emerald-500/70 to-teal-600/50" : "from-rose-500/70 to-red-600/50";
            return (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
                <span className="font-mono text-zinc-400 w-24 shrink-0">{s.id}</span>
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div className="flex-1 h-6 rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${bg}`}
                      style={{ width: `${Math.max(2.5, wPct)}%` }}
                      title={`OOS P/L ${formatUsd(s.oosReturnUsd)}`}
                    />
                  </div>
                  <span className={`tabular-nums w-28 text-right shrink-0 ${s.oosReturnUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {formatUsd(s.oosReturnUsd)}
                  </span>
                  <span className="text-amber-200/80 tabular-nums w-16 text-right shrink-0 hidden sm:inline" title="Max DD % v tomto OOS okně">
                    {s.oosDdPct != null ? `DD ${s.oosDdPct.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-sky-200/95">In-sample (train)</h3>
            <button
              type="button"
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
              onClick={() => setShowIsDetail((v) => !v)}
            >
              {showIsDetail ? "Skrýt čísla" : "Detail"}
            </button>
          </div>
          {showIsDetail ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-zinc-500">Součet P/L</dt>
              <dd className="text-sky-200 font-mono text-right">{formatUsd(agg.totalIsReturnUsd)}</dd>
              <dt className="text-zinc-500">Medián segm. P/L</dt>
              <dd className="text-zinc-300 font-mono text-right">
                {formatUsd(median(agg.segments.map((s) => s.isReturnUsd)))}
              </dd>
            </dl>
          ) : (
            <p className="text-xs text-zinc-500 leading-relaxed">
              IS slouží k odhalení overfittingu vůči OOS. Hlavní rozhodnutí čerpej z výše zelených/červených OOS metrik.
            </p>
          )}
          <div className="mt-3 text-2xl font-semibold tabular-nums text-sky-100">{formatUsd(agg.totalIsReturnUsd)}</div>
          <div className="text-[10px] text-zinc-600 mt-1">Souhrnný výnos napříč tréninkovými okny</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
          <h3 className="text-sm font-semibold text-emerald-200/95 mb-3">Out-of-sample (test)</h3>
          <div className="text-2xl font-semibold tabular-nums text-emerald-100">{formatUsd(agg.totalOosReturnUsd)}</div>
          <div className="text-[10px] text-zinc-600 mt-1">Souhrnný výnos napříč OOS okny</div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs border-t border-zinc-800/60 pt-3">
            <dt className="text-zinc-500">Medián PF (OOS)</dt>
            <dd className="text-zinc-200 font-mono text-right">{pfDisp}</dd>
            <dt className="text-zinc-500">Ø max DD / seg.</dt>
            <dd className="text-zinc-200 font-mono text-right">{agg.avgOosDdPct != null ? `${agg.avgOosDdPct.toFixed(2)} %` : "—"}</dd>
          </dl>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Rozdělení segmentů</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-center">
            <div className="text-2xl font-bold text-emerald-300">{agg.distribution.profit}</div>
            <div className="text-[11px] text-zinc-500">ziskové OOS</div>
          </div>
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-center">
            <div className="text-2xl font-bold text-rose-300">{agg.distribution.loss}</div>
            <div className="text-[11px] text-zinc-500">ztrátové OOS</div>
          </div>
          <div className="rounded-lg border border-zinc-600/40 bg-zinc-900/50 p-3 text-center">
            <div className="text-2xl font-bold text-zinc-300">{agg.distribution.flat}</div>
            <div className="text-[11px] text-zinc-500">≈ break-even</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
          <span>
            Průměr P/L / segment: <span className="text-zinc-200 font-mono">{formatUsd(agg.distribution.avgReturn)}</span>
          </span>
          <span>
            Medián P/L / segment:{" "}
            <span className="text-zinc-200 font-mono">{formatUsd(agg.distribution.medianReturn)}</span>
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-2">Stabilita parametrů</h3>
        <p className="text-xs text-zinc-500 leading-relaxed max-w-3xl">
          Aktuální engine používá <strong className="text-zinc-400">stejné strategy parametry</strong> na každém train i test okně —
          neoptimalizuje parametry na IS a nepřenáší je do OOS. Heatmapa „parametr vs. segment“ tedy není k dispozici, dokud nebude
          v enginu explicitní nested optimalizace.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Drawdown podle segmentu (OOS)</h3>
        <div className="space-y-2">
          {agg.segments.map((s) => {
            const dd = s.oosDdPct ?? 0;
            const w = Math.min(100, (dd / Math.max(agg.maxOosDdPct ?? 1, 1e-6)) * 100);
            return (
              <div key={`dd-${s.id}`} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-zinc-500 w-24 shrink-0">{s.id}</span>
                <div className="flex-1 h-4 rounded bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
                  <div className="h-full bg-amber-500/50" style={{ width: `${w}%` }} />
                </div>
                <span className="text-amber-200/90 tabular-nums w-14 text-right">{s.oosDdPct != null ? `${dd.toFixed(1)}%` : "—"}</span>
              </div>
            );
          })}
        </div>
        <div className="text-[11px] text-zinc-500 mt-2">
          Průměr: {agg.avgOosDdPct != null ? `${agg.avgOosDdPct.toFixed(2)} %` : "—"} · Max:{" "}
          {agg.maxOosDdPct != null ? `${agg.maxOosDdPct.toFixed(2)} %` : "—"}
        </div>
      </section>
    </div>
  );
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
