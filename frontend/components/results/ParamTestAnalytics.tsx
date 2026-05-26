"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { formatProfitFactorFromRow } from "@/lib/formatProfitFactor";
import { paramTestAxisXHint, paramTestXTickFormat } from "@/lib/paramTestAxisHints";

type MetricId =
  | "totalReturn"
  | "totalReturnUsd"
  | "sharpeRatio"
  | "sortinoRatio"
  | "profitFactor"
  | "tradeCount"
  | "maxDrawdownPct"
  | "winRate"
  | "finalEquity";

const METRIC_OPTIONS: { id: MetricId; label: string }[] = [
  { id: "totalReturn", label: "ROI / výnos % (celkem)" },
  { id: "totalReturnUsd", label: "Total return (USD)" },
  { id: "sharpeRatio", label: "Sharpe ratio" },
  { id: "sortinoRatio", label: "Sortino ratio" },
  { id: "profitFactor", label: "Profit factor" },
  { id: "maxDrawdownPct", label: "Max drawdown %" },
  { id: "winRate", label: "Win rate" },
  { id: "tradeCount", label: "Počet obchodů" },
  { id: "finalEquity", label: "Finální equity" },
];

function yLabelFor(metric: MetricId): string {
  return METRIC_OPTIONS.find((o) => o.id === metric)?.label ?? metric;
}

function yAxisSubtitle(metric: MetricId): string {
  switch (metric) {
    case "totalReturn":
      return "Hodnota z metrik backtestu (stejná jako horní karty) — u „ROI / výnos %“ jde o procenta výnosu nad kapitálem.";
    case "totalReturnUsd":
      return "Celkový výnos v USD (ze stejného běhu jako sweep).";
    case "profitFactor":
      return "Podíl hrubého zisku a ztráty (bez jednotky).";
    case "tradeCount":
      return "Počet uzavřených obchodů.";
    case "maxDrawdownPct":
      return "Maximum drawdown v % (nižší je obvykle lepší).";
    default:
      return "Hodnota z výstupu backtestu pro daný bod na ose X.";
  }
}

function formatTooltip(metric: MetricId, row: Record<string, unknown>): string {
  const parts = [`param = ${String(row.paramValue)}`];
  if (metric === "profitFactor") {
    parts.push(`PF = ${formatProfitFactorFromRow(row)}`);
  } else if (metric === "totalReturn") {
    const v = row[metric];
    parts.push(`ROI = ${v == null ? "N/A" : `${Number(v).toFixed(2)} %`}`);
  } else {
    const v = row[metric];
    parts.push(`${metric} = ${v == null ? "N/A" : Number(v).toFixed(4)}`);
  }
  return parts.join("<br>");
}

export function ParamTestAnalytics({ paramTest }: { paramTest: Record<string, unknown> }) {
  const [Plot, setPlot] = useState<ComponentType<any> | null>(null);
  const [metric, setMetric] = useState<MetricId>("totalReturn");

  useEffect(() => {
    let cancelled = false;
    import("react-plotly.js").then((mod) => {
      if (!cancelled) setPlot(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byParam = useMemo(() => {
    const raw = paramTest.byParam;
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<
      string,
      {
        series?: Record<string, unknown>[];
        bestByMetric?: Record<string, Record<string, unknown> | null | undefined>;
      }
    >;
  }, [paramTest.byParam]);

  const paramKeys = useMemo(() => (byParam ? Object.keys(byParam).sort() : []), [byParam]);
  const runsCount = Array.isArray(paramTest.runs) ? paramTest.runs.length : 0;
  const budget = typeof paramTest.maxRunsBudget === "number" ? paramTest.maxRunsBudget : null;
  const spp = typeof paramTest.samplesPerParam === "number" ? paramTest.samplesPerParam : null;

  if (paramKeys.length === 0) {
    if (runsCount === 0) return null;
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3 text-sm text-zinc-400">
        Param test: žádná data podle parametru (zkontroluj zapnuté rozsahy ve strategii).
      </div>
    );
  }

  if (!Plot) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 text-sm text-zinc-400">
        Načítání grafů Param test…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-700/40 bg-zinc-950/50 p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-emerald-500/90 font-medium">Param test</div>
          <p className="text-sm text-zinc-300 mt-1">
            Baseline metriky v kartách výše = jeden run s aktuálními PARAMS. Níže OAT sweep: jeden parametr najednou v
            rozsahu min–max.
          </p>
          <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
            <span className="text-zinc-400">Osy:</span> vodorovná = skutečná hodnota parametru odeslaná do strategie
            (stejná jednotka jako v PARAMS; žádné „škálování“ na 0–1). Svislá = vybraná metrika z každého OAT běhu — výchozí
            „ROI / výnos %“ odpovídá poli <span className="font-mono text-zinc-400">metrics.totalReturn</span> (v&nbsp;%).
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {runsCount > 0 && (
              <>
                Dodatečné běhy: <span className="font-mono text-zinc-300">{runsCount}</span>
                {budget != null ? (
                  <>
                    {" "}
                    (budget ≤ <span className="font-mono">{budget}</span>
                    {spp != null ? `, ~${spp} bodů/param` : ""})
                  </>
                ) : null}
                .
              </>
            )}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-zinc-400 min-w-[14rem]">
          <span>Metrika na ose Y</span>
          <select
            className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm min-w-[12rem]"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricId)}
          >
            {METRIC_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-600 leading-snug">{yAxisSubtitle(metric)}</span>
        </label>
      </div>

      {paramTest.trainOnly === true && (
        <div className="rounded-md border border-indigo-600/30 bg-indigo-950/20 px-3 py-2 text-xs text-zinc-300">
          <span className="text-indigo-400 font-medium uppercase tracking-wider">Train-only mode</span>
          <span className="text-zinc-500 ml-2">
            OAT sweep b\u011b\u017eel na train \u010d\u00e1sti ({String(paramTest.trainBars ?? "?")} bar\u016f).
            Holdout: {String(paramTest.holdoutBars ?? "?")} bar\u016f.
          </span>
        </div>
      )}

      {paramTest.holdoutBest != null && typeof paramTest.holdoutBest === "object" && (() => {
        const hb = paramTest.holdoutBest as Record<string, unknown>;
        const hm = hb.holdoutMetrics as Record<string, unknown> | null;
        if (!hm) return null;
        return (
          <div className="rounded-lg border border-indigo-600/40 bg-indigo-950/30 p-3 space-y-1">
            <div className="text-xs uppercase tracking-wider text-indigo-400/80">Holdout evaluation (best param by return)</div>
            <div className="text-xs text-zinc-400">
              Selected: <span className="font-mono text-zinc-200">{JSON.stringify(hb.selectedParams)}</span>
              <span className="mx-2">|</span>
              Train return: <span className="font-mono text-zinc-200">${Number(hb.trainBestReturnUsd ?? 0).toFixed(2)}</span>
              <span className="mx-2">|</span>
              Holdout return: <span className={`font-mono ${Number((hm.totalReturnUsd as number) ?? 0) > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ${Number(hm.totalReturnUsd ?? 0).toFixed(2)}
              </span>
              <span className="mx-2">|</span>
              Holdout trades: <span className="font-mono text-zinc-200">{String(hm.tradeCount ?? 0)}</span>
              <span className="mx-2">|</span>
              Holdout Sharpe: <span className="font-mono text-zinc-200">{Number(hm.sharpeRatio ?? 0).toFixed(2)}</span>
            </div>
            {Number(hb.trainBestReturnUsd ?? 0) > 0 && Number(hm.totalReturnUsd ?? 0) < 0 && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200 mt-1">
                Holdout je z\u00e1porn\u00fd p\u0159i kladn\u00e9m train \u2014 siln\u00e1 indikace overfittingu na train data.
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {paramKeys.map((pk) => {
          const block = byParam![pk];
          const series = Array.isArray(block?.series) ? block!.series! : [];
          const bestByMetric = block?.bestByMetric;
          const best = bestByMetric?.[metric] as Record<string, unknown> | null | undefined;

          const x: number[] = [];
          const y: number[] = [];
          const text: string[] = [];
          for (const row of series) {
            if (!row || typeof row !== "object") continue;
            const r = row as Record<string, unknown>;
            const xv = Number(r.paramValue);
            const rawY = r[metric];
            if (!Number.isFinite(xv)) continue;
            if (rawY == null) continue;
            const yn = Number(rawY);
            if (!Number.isFinite(yn)) continue;
            x.push(xv);
            y.push(yn);
            text.push(formatTooltip(metric, r));
          }

          const bestX = best != null ? Number(best.paramValue) : NaN;
          const bestY = best != null ? Number(best.metricValue) : NaN;
          const hasBest = Number.isFinite(bestX) && Number.isFinite(bestY);

          const xHint = paramTestAxisXHint(pk);
          const tickFmt = paramTestXTickFormat(x);
          const fewPoints = x.length > 0 && x.length < 6;
          const plotMode = fewPoints ? "markers" : "lines+markers";

          return (
            <div key={pk} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 space-y-2">
              <div className="text-xs font-mono text-emerald-400/90 px-1">{pk}</div>
              {x.length > 0 && x.length <= 3 ? (
                <p className="text-[10px] text-amber-200/90 px-1 leading-snug">
                  Jen {x.length} bod(x) — čára mezi nimi je jen vizuální spojení bodů, ne interpolace mezi kroky. Pro plný
                  grid zadej v OAT rozmezí + krok (např. atr_sl_pct 10–50, krok 5) a spusť nový run.
                </p>
              ) : null}
              {xHint ? (
                <p className="text-[10px] text-zinc-500 px-1 leading-snug">{xHint}</p>
              ) : null}
              <Plot
                data={[
                  {
                    x,
                    y,
                    text,
                    type: "scatter",
                    mode: plotMode,
                    name: "sweep",
                    line:
                      plotMode === "lines+markers"
                        ? { color: "rgba(52, 211, 153, 0.85)", width: 2 }
                        : { width: 0 },
                    marker: { size: 8, color: "rgba(16, 185, 129, 0.9)" },
                    hoverinfo: "text",
                  },
                  ...(hasBest
                    ? [
                        {
                          x: [bestX],
                          y: [bestY],
                          type: "scatter",
                          mode: "markers",
                          name: "nejlepší (tato metrika)",
                          marker: {
                            size: 14,
                            color: "rgba(251, 191, 36, 0.95)",
                            line: { color: "rgba(250, 204, 21, 1)", width: 2 },
                          },
                          hovertemplate:
                            `<b>Best</b><br>param=%{x}<br>${yLabelFor(metric)}=%{y:.4f}<extra></extra>`,
                        },
                      ]
                    : []),
                ]}
                layout={{
                  autosize: true,
                  height: 280,
                  paper_bgcolor: "rgba(9, 9, 11, 0.5)",
                  plot_bgcolor: "rgba(24, 24, 27, 0.9)",
                  font: { color: "#d4d4d8", size: 11 },
                  margin: { t: 28, r: 12, b: 52, l: 56 },
                  showlegend: hasBest,
                  legend: {
                    orientation: "h",
                    yanchor: "bottom",
                    y: 1.02,
                    x: 0,
                    font: { size: 10 },
                  },
                  xaxis: {
                    title: { text: pk, standoff: 8 },
                    tickformat: tickFmt,
                    gridcolor: "rgba(63, 63, 70, 0.5)",
                    zerolinecolor: "rgba(82, 82, 91, 0.6)",
                  },
                  yaxis: {
                    title: yLabelFor(metric),
                    gridcolor: "rgba(63, 63, 70, 0.5)",
                    zerolinecolor: "rgba(82, 82, 91, 0.6)",
                  },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
              {x.length > 0 ? (
                <div className="overflow-x-auto rounded border border-zinc-800/80 bg-zinc-950/50">
                  <table className="min-w-full text-[10px] text-zinc-400">
                    <thead>
                      <tr className="text-left border-b border-zinc-800">
                        <th className="py-1 px-2 font-medium text-zinc-500">{pk}</th>
                        <th className="py-1 px-2 font-medium text-zinc-500">{yLabelFor(metric)}</th>
                        <th className="py-1 px-2 font-medium text-zinc-500 hidden sm:table-cell">Obchodů</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((row, i) => {
                        if (!row || typeof row !== "object") return null;
                        const r = row as Record<string, unknown>;
                        const pv = r.paramValue;
                        const mv = r[metric];
                        const tc = r.tradeCount;
                        if (mv == null) return null;
                        return (
                          <tr key={i} className="border-b border-zinc-800/60">
                            <td className="py-0.5 px-2 font-mono text-zinc-300">{String(pv)}</td>
                            <td className="py-0.5 px-2 font-mono text-emerald-200/90">
                              {metric === "totalReturn" ? `${Number(mv).toFixed(2)} %` : Number(mv).toFixed(4)}
                            </td>
                            <td className="py-0.5 px-2 font-mono hidden sm:table-cell">{String(tc ?? "—")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
