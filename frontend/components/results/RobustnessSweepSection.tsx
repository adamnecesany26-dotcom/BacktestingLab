"use client";

import { useEffect, useMemo, useState } from "react";
import { extractSweepRunRows } from "@/lib/sweepRobustness";
import { SweepRunsTable } from "@/components/results/SweepRunsTable";
import { SweepFullHistogram } from "@/components/results/analytics/SweepFullHistogram";
import { SweepScatterPanel } from "@/components/results/analytics/SweepScatterPanel";
import { SweepSensitivityPlots } from "@/components/results/analytics/SweepSensitivityPlots";

function formatNum(n: unknown, digits = 4): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function stabilityLabel(score: number): { text: string; tone: "good" | "mid" | "low" } {
  if (!Number.isFinite(score)) return { text: "—", tone: "mid" };
  if (score >= 0.55) return { text: "Relativně stabilní rozptyl mezi top běhy", tone: "good" };
  if (score >= 0.35) return { text: "Střední stabilita — top kombinace se dost liší", tone: "mid" };
  return { text: "Nízká stabilita — výsledky sweepu silně závisí na parametrech", tone: "low" };
}

function parseHist(raw: unknown): { low: number; high: number; nbin: number; counts: number[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const counts = Array.isArray(o.counts) ? o.counts.map((c) => Number(c) || 0) : [];
  if (!counts.length) return null;
  return {
    low: Number(o.low ?? 0),
    high: Number(o.high ?? 1),
    nbin: Number(o.nbin ?? counts.length),
    counts,
  };
}

export function RobustnessSweepSection({
  robustness,
  runId,
}: {
  robustness: Record<string, unknown> | null | undefined;
  runId?: string | null;
}) {
  const [heatmapFilter, setHeatmapFilter] = useState<{ xBin: number; yBin: number } | null>(null);
  const [planeView, setPlaneView] = useState<"grid" | "scatter">("grid");

  const rows = useMemo(() => extractSweepRunRows(robustness ?? null), [robustness]);
  const tested = Math.max(0, Math.floor(Number(robustness?.tested ?? 0)));
  const attempted = Math.max(0, Math.floor(Number(robustness?.candidatesAttempted ?? tested)));
  const failures = Math.max(0, Math.floor(Number(robustness?.sweepFailures ?? Math.max(0, attempted - tested))));

  useEffect(() => {
    setHeatmapFilter(null);
  }, [runId, robustness?.mode, tested]);

  useEffect(() => {
    const m = String(robustness?.mode ?? "");
    setPlaneView(m === "random" ? "scatter" : "grid");
  }, [runId, robustness?.mode]);

  const heatmap = robustness?.heatmap && typeof robustness.heatmap === "object" ? (robustness.heatmap as Record<string, unknown>) : null;
  const heatmapCells = Array.isArray(heatmap?.cells) ? (heatmap.cells as Record<string, unknown>[]) : [];
  const nestedHoldout =
    robustness?.nestedHoldout && typeof robustness.nestedHoldout === "object"
      ? (robustness.nestedHoldout as Record<string, unknown>)
      : null;
  const holdoutOn = nestedHoldout?.enabled === true;
  const scoreDist =
    robustness?.scoreDistribution && typeof robustness.scoreDistribution === "object"
      ? (robustness.scoreDistribution as Record<string, unknown>)
      : null;
  const stabilityScore = Number(robustness?.stabilityScore ?? NaN);
  const stab = stabilityLabel(stabilityScore);
  const mode = String(robustness?.mode ?? "—");
  const penalty = Number(robustness?.multipleTestingPenaltyScale ?? NaN);
  const scoreNote =
    typeof robustness?.scoreFieldNote === "string" ? robustness.scoreFieldNote.trim() : null;
  const best = robustness?.best && typeof robustness.best === "object" ? (robustness.best as Record<string, unknown>) : null;
  const bestParams =
    best?.params && typeof best.params === "object" ? (best.params as Record<string, unknown>) : null;
  const bestMetrics =
    best?.metrics && typeof best.metrics === "object" ? (best.metrics as Record<string, unknown>) : null;

  const sweepSummary =
    robustness?.sweepSummary && typeof robustness.sweepSummary === "object"
      ? (robustness.sweepSummary as Record<string, unknown>)
      : null;
  const profFrac = Number(sweepSummary?.profitableFraction ?? NaN);
  const medianPnl = Number(sweepSummary?.medianTotalReturnUsd ?? NaN);
  const topDecPnl = Number(sweepSummary?.topDecileMeanTotalReturnUsd ?? NaN);
  const outlierThr =
    sweepSummary?.outlierScoreThreshold != null ? Number(sweepSummary.outlierScoreThreshold) : NaN;
  const pnlPct =
    sweepSummary?.pnlPercentiles && typeof sweepSummary.pnlPercentiles === "object"
      ? (sweepSummary.pnlPercentiles as Record<string, unknown>)
      : null;

  const histograms =
    robustness?.histograms && typeof robustness.histograms === "object"
      ? (robustness.histograms as Record<string, unknown>)
      : null;
  const histScore = parseHist(histograms?.score);
  const histPnl = parseHist(histograms?.totalReturnUsd);

  const paramSens =
    robustness?.paramSensitivity && typeof robustness.paramSensitivity === "object"
      ? (robustness.paramSensitivity as Record<string, Array<{ value: number; meanScore: number; n: number }>>)
      : {};

  const scoreSpan = useMemo(() => {
    const vals = heatmapCells
      .filter((c) => Number(c.count ?? 0) > 0)
      .map((c) => Number(c.avgScore ?? 0))
      .filter((x) => Number.isFinite(x));
    if (vals.length === 0) return { min: 0, max: 1e-6 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max: max === min ? min + 1e-6 : max };
  }, [heatmapCells]);

  const robustThreshold = useMemo(() => {
    const vals = heatmapCells
      .filter((c) => Number(c.count ?? 0) > 0)
      .map((c) => Number(c.avgScore ?? 0))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
    if (vals.length < 3) return null;
    const idx = Math.floor((vals.length - 1) * 0.8);
    return vals[idx] ?? null;
  }, [heatmapCells]);

  const heatmapNorm = (avgSc: number): number => {
    const { min, max } = scoreSpan;
    return Math.min(1, Math.max(0, (avgSc - min) / (max - min)));
  };

  const exportNote =
    rows.length > 0
      ? `Export obsahuje až ${rows.length} řádků (engine limit). Sloupec Params je zkrácený — úplný JSON je v modalu „Porovnat běhy“. Histogramy a citlivost jsou z celého počtu dokončených běhů (${tested}).`
      : null;

  const xBins = Math.max(1, Number(heatmap?.xBins ?? 6));
  const yBins = Math.max(1, Number(heatmap?.yBins ?? 6));
  const xKey = String(heatmap?.xKey ?? "");
  const yKey = String(heatmap?.yKey ?? "");

  const redFlags: { sev: "high" | "mid"; msg: string }[] = [];
  if (Number.isFinite(profFrac) && profFrac < 0.12 && tested >= 12) {
    redFlags.push({
      sev: "high",
      msg: `Jen ${(profFrac * 100).toFixed(1)} % konfigurací je v zisku — typický příznak slabého edge nebo přeladění. Nesleduj jen peak.`,
    });
  }
  if (stab.tone === "low" && tested >= 8) {
    redFlags.push({
      sev: "mid",
      msg: "Nízká stabilita top skóre — malá změna parametrů mění pořadí. Hledej širší plochu v heatmapě / scatteru.",
    });
  }
  if (Number.isFinite(medianPnl) && medianPnl < 0 && Number(sweepSummary?.bestTotalReturnUsd ?? 0) > Math.abs(medianPnl) * 4 && tested >= 15) {
    redFlags.push({
      sev: "high",
      msg: "Medián P/L je záporný, zatímco peak je silně kladný — výsledek může tahat hrst extrémů (multiple testing).",
    });
  }

  if (tested <= 0 && rows.length === 0) return null;

  const heatmapRowSlices: Record<string, unknown>[][] = [];
  if (heatmapCells.length > 0 && xBins > 0 && yBins > 0) {
    for (let yi = 0; yi < yBins; yi++) {
      heatmapRowSlices.push(heatmapCells.slice(yi * xBins, (yi + 1) * xBins));
    }
  }

  const scorePercentiles =
    Number.isFinite(Number(scoreDist?.p10)) &&
    Number.isFinite(Number(scoreDist?.p50)) &&
    Number.isFinite(Number(scoreDist?.p90))
      ? {
          p10: Number(scoreDist?.p10),
          p50: Number(scoreDist?.p50),
          p90: Number(scoreDist?.p90),
        }
      : null;

  const pnlPercentiles =
    pnlPct && Number.isFinite(Number(pnlPct.p10))
      ? { p10: Number(pnlPct.p10), p50: Number(pnlPct.p50), p90: Number(pnlPct.p90) }
      : null;

  return (
    <section
      className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/25 via-zinc-950/60 to-zinc-950/80 shadow-xl shadow-black/25 overflow-hidden"
      aria-label="Robustnostní parametrický sweep"
    >
      <div className="px-4 sm:px-5 py-4 border-b border-cyan-500/15 bg-zinc-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-400/90">Parametrický sweep</p>
            <h3 className="text-lg sm:text-xl font-semibold text-zinc-100 mt-1">Výsledky průzkumu PARAMS</h3>
            <p className="text-xs text-zinc-500 mt-2 max-w-3xl leading-relaxed">
              Zaměř se na <strong className="text-zinc-300">medián a tvar distribuce</strong>, ne na jeden nejlepší řádek.
              Heatmapa / scatter ukazuje, jestli existuje <strong className="text-zinc-300">plošina</strong> rozumných výsledků.
              Holdout zapnutý = metriky v tabulce primárně z test úseku.
            </p>
          </div>
          <div
            className={`shrink-0 rounded-xl px-3 py-2 text-[11px] font-medium border ${
              stab.tone === "good"
                ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-100"
                : stab.tone === "low"
                  ? "border-rose-500/35 bg-rose-950/25 text-rose-100"
                  : "border-amber-500/30 bg-amber-950/20 text-amber-100"
            }`}
            title="Rozptyl skóre mezi top 20 kombinacemi — vyšší = méně citlivé na drobnou změnu ranku"
          >
            <div className="text-[10px] uppercase tracking-wider opacity-80">Stabilita (top 20)</div>
            <div className="text-base font-mono tabular-nums mt-0.5">{formatNum(stabilityScore, 3)}</div>
            <div className="text-[10px] mt-1 opacity-90 leading-snug max-w-[14rem]">{stab.text}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mt-4">
          <div className="lg:col-span-5 rounded-2xl border border-cyan-500/35 bg-cyan-950/20 px-4 py-4 shadow-inner shadow-black/20">
            <div className="text-[10px] uppercase tracking-wider text-cyan-500/85">Medián P/L (všech {tested || rows.length} konfig.)</div>
            <div
              className={`text-3xl sm:text-4xl font-bold tabular-nums mt-1 ${Number.isFinite(medianPnl) && medianPnl >= 0 ? "text-cyan-100" : "text-rose-200/95"}`}
            >
              {Number.isFinite(medianPnl) ? `$${medianPnl.toFixed(2)}` : "—"}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-zinc-400">
              <div title="Průměr P/L v horním decilu (nejlepších ~10 % konfigurací)">
                Horní decil Ø P/L:{" "}
                <span className="text-zinc-200 font-mono">
                  {Number.isFinite(topDecPnl) ? `$${topDecPnl.toFixed(2)}` : "—"}
                </span>
              </div>
              <div>
                Ziskových konfigurací:{" "}
                <span className="text-zinc-200 font-mono">
                  {Number.isFinite(profFrac) ? `${(profFrac * 100).toFixed(1)} %` : "—"}
                </span>
              </div>
              <div>
                Top decil Ø skóre:{" "}
                <span className="text-zinc-200 font-mono">{formatNum(sweepSummary?.topDecileMeanScore, 4)}</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-xl border border-zinc-800/90 bg-zinc-900/35 px-4 py-3 text-xs text-zinc-400 leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Co z toho číst</div>
            <ul className="list-disc pl-4 space-y-1.5">
              <li>
                Široká, většinou kladná <strong className="text-zinc-300">distribuce P/L</strong> → větší šance na robustní edge.
              </li>
              <li>
                Většina v mínusu + pár extrémů → spíš <strong className="text-rose-300/90">náhoda / overfit</strong> (Bonferroni, trial count).
              </li>
              <li>
                V 2D hledej <strong className="text-zinc-300">souvislou zelenou plochu</strong>, ne izolovaný pixel (označena horní ~20 % skóre v buňce).
              </li>
            </ul>
          </div>

          <div className="lg:col-span-3 rounded-xl border border-zinc-700/80 bg-zinc-950/50 px-3 py-3 text-[11px] text-zinc-400">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Peak (reference — ne „vítěz“)</div>
            {bestParams && bestMetrics ? (
              <>
                <div className="text-sm font-mono text-zinc-200">${Number(bestMetrics.totalReturnUsd ?? 0).toFixed(2)} P/L</div>
                <div className="text-[10px] mt-1 font-mono truncate text-zinc-500" title={JSON.stringify(bestParams)}>
                  {Object.entries(bestParams)
                    .filter(([, v]) => v != null && typeof v !== "object")
                    .slice(0, 4)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" · ")}
                </div>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <KpiTile label="Režim" value={mode === "random" ? "Náhodný" : mode === "grid" ? "Mřížka" : mode} />
          <KpiTile label="Spočteno" value={String(tested || rows.length)} accent="cyan" />
          <KpiTile
            label="Selhání"
            value={failures > 0 ? String(failures) : "0"}
            sub={attempted > tested ? `${attempted} plánováno` : undefined}
            accent={failures > 0 ? "rose" : undefined}
          />
          <KpiTile
            label="Holdout"
            value={holdoutOn ? "Ano" : "Ne"}
            sub={
              holdoutOn ? `Tr ${nestedHoldout?.trainBarCount ?? "—"} / ho ${nestedHoldout?.holdoutBarCount ?? "—"}` : undefined
            }
            accent={holdoutOn ? "violet" : undefined}
          />
        </div>

        {redFlags.length > 0 ? (
          <div className="mt-4 space-y-2">
            {redFlags.map((f, i) => (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  f.sev === "high"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-100"
                }`}
              >
                {f.msg}
              </div>
            ))}
          </div>
        ) : null}

        {scoreNote ? <p className="text-[10px] text-zinc-600 mt-3 leading-relaxed">{scoreNote}</p> : null}
      </div>

      <div className="p-4 sm:p-5 space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <SweepFullHistogram
            hist={histPnl}
            percentiles={pnlPercentiles}
            title="Distribuce P/L (celý sweep)"
            unitHint="Počty všech dokončených běhů v pruzích. Čárky: p10 / medián / p90 v P/L."
          />
          <SweepFullHistogram
            hist={histScore}
            percentiles={scorePercentiles}
            title="Distribuce interního skóre"
            unitHint="Skóre z enginu (holdout nebo full). Stejné percentily jako scoreDistribution."
          />
        </div>

        {heatmap && heatmapCells.length > 0 && xKey && yKey ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-200">Parametrická rovina ({xKey} × {yKey})</h4>
              <div className="flex rounded-lg border border-zinc-700/80 p-0.5 bg-zinc-900/50">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    planeView === "grid" ? "bg-cyan-600/30 text-cyan-100" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                  onClick={() => setPlaneView("grid")}
                >
                  Grid / heatmap
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    planeView === "scatter" ? "bg-violet-600/30 text-violet-100" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                  onClick={() => setPlaneView("scatter")}
                >
                  Scatter
                </button>
              </div>
            </div>
            <p className="text-[10px] text-zinc-500">
              Scatter používá exportní vzorek řádků (max. dle enginu); heatmapa agreguje všechny dokončené běhy. Buňky v horních ~20 %
              průměrného skóre mají zlatý obrys („robustní zóna“ přibližně).
            </p>

            {planeView === "grid" ? (
              <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/40 p-4">
                <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                  <div className="text-[10px] text-zinc-600 font-mono text-right w-full sm:w-auto">
                    <div>
                      {xKey}: {String((heatmap.xRange as unknown[])?.[0])} … {String((heatmap.xRange as unknown[])?.[1])}
                    </div>
                    <div>
                      {yKey}: {String((heatmap.yRange as unknown[])?.[0])} … {String((heatmap.yRange as unknown[])?.[1])}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  {heatmapRowSlices.map((row, yi) => (
                    <div key={yi} className="flex gap-1.5 items-stretch">
                      <div className="w-8 sm:w-9 shrink-0 flex items-center justify-end text-[9px] text-zinc-500 font-mono pr-1">
                        y{yi}
                      </div>
                      <div
                        className="flex-1 min-w-0 grid gap-1.5"
                        style={{ gridTemplateColumns: `repeat(${xBins}, minmax(0, 1fr))` }}
                      >
                        {row.map((cell, xi) => {
                          const count = Number(cell.count ?? 0);
                          const avgSc = Number(cell.avgScore ?? 0);
                          const t = count > 0 ? heatmapNorm(avgSc) : 0;
                          const avgPnl = Number(cell.avgTotalReturnUsd ?? 0);
                          const avgWr = Number(cell.avgWinRate ?? 0);
                          const xBin = Number(cell.xBin ?? xi);
                          const yBin = Number(cell.yBin ?? yi);
                          const selected =
                            heatmapFilter != null && heatmapFilter.xBin === xBin && heatmapFilter.yBin === yBin;
                          const robust =
                            robustThreshold != null && count > 0 && avgSc >= robustThreshold - 1e-9;
                          const bg =
                            count <= 0
                              ? "rgba(39,39,42,0.5)"
                              : `rgba(6, 182, 212, ${0.12 + t * 0.75})`;
                          const fg = t > 0.62 && count > 0 ? "#ecfeff" : "#a1a1aa";
                          return (
                            <button
                              type="button"
                              key={`${yi}-${xi}`}
                              disabled={count <= 0}
                              onClick={() => {
                                if (count <= 0) return;
                                setHeatmapFilter((prev) =>
                                  prev?.xBin === xBin && prev?.yBin === yBin ? null : { xBin, yBin },
                                );
                              }}
                              className={`min-h-[3.25rem] rounded-lg border text-left px-1.5 py-1 flex flex-col justify-center gap-0.5 transition-all ${
                                count > 0
                                  ? "cursor-pointer border-zinc-700 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/10"
                                  : "border-zinc-800/80 opacity-40 cursor-default"
                              } ${robust ? "outline outline-2 outline-amber-400/70 outline-offset-1" : ""} ${selected ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-950 border-cyan-400" : ""}`}
                              style={{ backgroundColor: bg, color: fg }}
                              title={`Buňka x=${xBin} y=${yBin}\nn=${count}\navgScore=${avgSc.toFixed(4)}\navgPnL=$${avgPnl.toFixed(2)}\navgWR=${avgWr.toFixed(1)}%${robust ? "\n↑ horní ~20 % skóre v buňkách" : ""}`}
                            >
                              {count > 0 ? (
                                <>
                                  <span className="text-[10px] font-semibold leading-tight tabular-nums">n={count}</span>
                                  <span className="text-[9px] opacity-90 tabular-nums">sc {avgSc.toFixed(2)}</span>
                                  <span className="text-[9px] opacity-80 tabular-nums">${avgPnl.toFixed(0)}</span>
                                </>
                              ) : (
                                <span className="text-[10px] text-zinc-600 text-center w-full">·</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1">
                  <div className="w-8 sm:w-9 shrink-0" aria-hidden />
                  <div className="flex-1 flex justify-between text-[9px] text-zinc-600 font-mono px-0.5 min-w-0">
                    {Array.from({ length: xBins }, (_, xi) => (
                      <span key={xi} className="flex-1 text-center">
                        x{xi}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-5 h-3 rounded border border-amber-400/60 outline outline-2 outline-amber-400/70" />
                    robustní zóna (~top 20 % avgScore)
                  </span>
                </div>
              </div>
            ) : (
              <SweepScatterPanel rows={rows} xKey={xKey} yKey={yKey} />
            )}
          </div>
        ) : null}

        <SweepSensitivityPlots data={paramSens} />

        {rows.length > 0 ? (
          <SweepRunsTable
            rows={rows}
            maxExportNote={exportNote ?? undefined}
            heatmapSelection={heatmapFilter}
            onClearHeatmapFilter={() => setHeatmapFilter(null)}
            outlierScoreThreshold={Number.isFinite(outlierThr) ? outlierThr : null}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-sm text-zinc-500 text-center">
            Žádný exportní vzorek řádků — zkontroluj <code className="text-zinc-400">robustness.rankingSample</code> ve výsledku.
          </div>
        )}
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "violet" | "rose";
}) {
  const border =
    accent === "cyan"
      ? "border-cyan-500/25 bg-cyan-950/15"
      : accent === "violet"
        ? "border-violet-500/25 bg-violet-950/15"
        : accent === "rose"
          ? "border-rose-500/30 bg-rose-950/20"
          : "border-zinc-800/80 bg-zinc-900/40";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${border}`}>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500 leading-tight">{label}</div>
      <div className="text-sm font-semibold text-zinc-100 mt-1 tabular-nums break-words">{value}</div>
      {sub ? <div className="text-[10px] text-zinc-600 mt-1 leading-snug">{sub}</div> : null}
    </div>
  );
}
