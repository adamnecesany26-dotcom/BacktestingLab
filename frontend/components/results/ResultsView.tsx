"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleOutputChart } from "@/components/charts/ModuleOutputChart";
import { RunHistory } from "@/components/results/RunHistory";
import { assessOverfitting, readinessFromSeverity } from "@/lib/overfittingSignals";

/** Client-only; default export keeps a single webpack async chunk (fewer stale named-export mismatches in dev). */
const EquityChart = dynamic(() => import("@/components/charts/EquityChart"), {
  ssr: false,
  loading: () => <div className="py-16 text-center text-sm text-zinc-500">Načítám graf equity…</div>,
});
const TradeHighlight = dynamic(
  () => import("@/components/results/TradeHighlight").then((m) => ({ default: m.TradeHighlight })),
  { ssr: false, loading: () => <div className="py-16 text-center text-sm text-zinc-500">Načítám graf…</div> }
);
import { StatBlocks } from "@/components/results/StatBlocks";
import { QualityGateBanner } from "@/components/results/QualityGateBanner";
import { AnalyticsView } from "@/components/results/AnalyticsView";
import type { ModuleOutput, RunResponse } from "@shared/types";
import {
  computeDetailedChartWindow,
  filterModuleOutputToOhlcWindow,
  type DetailedViewMode,
} from "@/lib/detailedTradesWindow";
import { PriceContextChart } from "@/components/charts/PriceContextChart";
import { getChartTfSelectOptions, resampleOhlcForChartChoice } from "@/lib/chartOhlcResample";
import { getViewData } from "@/lib/api";
import { viewDataResponseToModuleOutput } from "@/lib/viewArtifactAdapter";
import { effectiveViewDataTimeframe } from "@/lib/viewChartTimeframe";
import { buildCumulativeREquityCurve, summarizeTradeRMultiples } from "@/lib/tradeMetrics";
import type { SavedBacktestRun } from "@/lib/firestore";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp } from "@/components/backtestFieldMeta";

type TabId = "equity" | "highlight" | "detailed" | "analytics" | "runHistory";

const RESULT_TABS: { id: TabId; label: string; shortcut: string }[] = [
  { id: "equity", label: "Equity", shortcut: "1" },
  { id: "highlight", label: "Highlight", shortcut: "2" },
  { id: "detailed", label: "Detailed", shortcut: "3" },
  { id: "analytics", label: "Analytics", shortcut: "4" },
  { id: "runHistory", label: "Run history", shortcut: "5" },
];

interface ResultsViewProps {
  results: RunResponse | null;
  runHistory: SavedBacktestRun[];
  strategyId: string;
  onBack: () => void;
  onExport: () => void;
  onDeleteRun: (id: string) => void;
  onDeleteAllRuns: () => void;
  onUpdateLifecycle: (runDocId: string, patch: Record<string, unknown>) => Promise<void>;
  strategyName?: string;
  /** Current editor snapshot of main.py (or best-effort) for reproducibility bundle */
  strategyMainPy?: string;
}

export function ResultsView({
  results,
  runHistory,
  strategyId,
  onBack,
  onExport,
  onDeleteRun,
  onDeleteAllRuns,
  onUpdateLifecycle,
  strategyName,
  strategyMainPy = "",
}: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("equity");
  const [bundleBusy, setBundleBusy] = useState(false);
  const [detailedMode, setDetailedMode] = useState<DetailedViewMode>("by_trades");
  const [detailedPage, setDetailedPage] = useState(0);
  const [tradesPerView, setTradesPerView] = useState(15);
  const [monthsPerView, setMonthsPerView] = useState(3);
  const [chartTf, setChartTf] = useState<string>("source");
  const [useArtifactLayersDetailed, setUseArtifactLayersDetailed] = useState(false);
  const [artifactDetailedOut, setArtifactDetailedOut] = useState<ModuleOutput | null>(null);
  const [artifactDetailedLoading, setArtifactDetailedLoading] = useState(false);
  const [artifactDetailedError, setArtifactDetailedError] = useState<string | null>(null);
  const [artifactDetailedBanner, setArtifactDetailedBanner] = useState<string | null>(null);
  /** Index do `batchRuns` pro Equity / Detailed / Highlight / analytiku obchodů; poslední run = výchozí */
  const [batchViewIdx, setBatchViewIdx] = useState(0);
  const [runNote, setRunNote] = useState("");
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState<Record<string, boolean>>({});

  const batchRuns = useMemo((): RunResponse[] | null => {
    const br = results?.batchRuns;
    if (!Array.isArray(br) || br.length === 0) return null;
    return br as RunResponse[];
  }, [results?.batchRuns]);

  const batchRunCount = useMemo(() => {
    const bs = results?.batchSummary;
    if (!bs || typeof bs !== "object") return 0;
    return Math.max(0, Math.floor(Number((bs as Record<string, unknown>).runCount ?? 0)));
  }, [results?.batchSummary]);

  useEffect(() => {
    if (batchRuns?.length) {
      setBatchViewIdx(batchRuns.length - 1);
    } else {
      setBatchViewIdx(0);
    }
  }, [results?.runId, batchRuns?.length]);

  const viewResults: RunResponse = useMemo(() => {
    if (batchRuns && batchRuns.length > 0 && batchViewIdx >= 0 && batchViewIdx < batchRuns.length) {
      return batchRuns[batchViewIdx]!;
    }
    return results!;
  }, [batchRuns, batchViewIdx, results]);

  const batchSummaryRoot =
    results?.batchSummary && typeof results.batchSummary === "object"
      ? (results.batchSummary as Record<string, unknown>)
      : null;
  const batchAggregates =
    batchSummaryRoot?.aggregates && typeof batchSummaryRoot.aggregates === "object"
      ? (batchSummaryRoot.aggregates as Record<string, unknown>)
      : null;

  const baseOhlc = viewResults?.ohlc ?? [];
  const chartTfOptions = useMemo(() => getChartTfSelectOptions(baseOhlc), [baseOhlc]);

  useEffect(() => {
    setDetailedPage(0);
  }, [detailedMode, tradesPerView, monthsPerView]);

  useEffect(() => {
    setDetailedPage(0);
  }, [batchViewIdx]);

  useEffect(() => {
    setBannerDismissed({});
  }, [results?.runId]);

  const mergedOutput: ModuleOutput = useMemo(() => {
    if (!viewResults) return { markers: [], lines: [], zones: [] };
    const hasModuleOutputs = !!viewResults.moduleOutputs && Object.keys(viewResults.moduleOutputs).length > 0;
    if (!hasModuleOutputs) return { markers: [], lines: [], zones: [] };
    return {
      markers: Object.values(viewResults.moduleOutputs!).flatMap((o) => o.markers ?? []),
      lines: Object.entries(viewResults.moduleOutputs!).flatMap(([mod, o]) =>
        (o.lines ?? []).map((l) => ({ ...l, name: `${mod}: ${l.name ?? "line"}` }))
      ),
      zones: Object.values(viewResults.moduleOutputs!).flatMap((o) => o.zones ?? []),
    };
  }, [viewResults]);

  const detailedWindow = useMemo(() => {
    if (!baseOhlc.length) return null;
    return computeDetailedChartWindow(
      baseOhlc,
      viewResults?.trades ?? [],
      detailedMode,
      detailedPage,
      tradesPerView,
      monthsPerView
    );
  }, [viewResults?.trades, baseOhlc, detailedMode, detailedPage, tradesPerView, monthsPerView]);

  const chartOhlc = useMemo(() => {
    if (!detailedWindow?.windowOhlc.length) return [];
    return resampleOhlcForChartChoice(detailedWindow.windowOhlc, chartTf);
  }, [detailedWindow?.windowOhlc, chartTf]);

  const detailedChartOutput = useMemo(() => {
    if (!detailedWindow?.windowOhlc.length) return mergedOutput;
    return filterModuleOutputToOhlcWindow(mergedOutput, detailedWindow.windowOhlc);
  }, [mergedOutput, detailedWindow]);

  const contextChartOhlc = useMemo(() => {
    const w = detailedWindow?.windowOhlc ?? [];
    if (!baseOhlc.length || w.length < 2) return [];
    const loMs = Date.parse(w[0]!.date);
    const hiMs = Date.parse(w[w.length - 1]!.date);
    if (!Number.isFinite(loMs) || !Number.isFinite(hiMs)) return [];
    const span = Math.max(hiMs - loMs, 24 * 3600 * 1000);
    const lo2 = loMs - span;
    const hi2 = hiMs + span;
    const win = baseOhlc.filter((b) => {
      const t = Date.parse(b.date);
      return Number.isFinite(t) && t >= lo2 && t <= hi2;
    });
    return win.length ? win : baseOhlc;
  }, [baseOhlc, detailedWindow?.windowOhlc]);

  const contextTrade = useMemo(() => {
    const v = detailedWindow?.visibleTrades ?? [];
    if (!v.length) return null;
    // Prefer trades that carry zoneMeta (S/D), since the user wants "zone + simulated R trade" context.
    const withMeta = v.find((t) => t.zoneMeta != null);
    return withMeta ?? v[0]!;
  }, [detailedWindow?.visibleTrades]);

  const detailedChartOutputEffective = useMemo(() => {
    if (useArtifactLayersDetailed && artifactDetailedOut) return artifactDetailedOut;
    return detailedChartOutput;
  }, [useArtifactLayersDetailed, artifactDetailedOut, detailedChartOutput]);

  const rEquityCurve = useMemo(() => buildCumulativeREquityCurve(viewResults?.trades ?? []), [viewResults?.trades]);

  const rSummary = useMemo(() => summarizeTradeRMultiples(viewResults?.trades ?? []), [viewResults?.trades]);

  const manifestForView = viewResults?.manifest && typeof viewResults.manifest === "object"
    ? (viewResults.manifest as Record<string, unknown>)
    : null;

  useEffect(() => {
    if (!useArtifactLayersDetailed || activeTab !== "detailed") {
      setArtifactDetailedOut(null);
      setArtifactDetailedError(null);
      setArtifactDetailedBanner(null);
      setArtifactDetailedLoading(false);
      return;
    }
    const dataFile = String(manifestForView?.dataFile ?? "").trim();
    const wo = detailedWindow?.windowOhlc;
    if (!dataFile || !wo?.length) {
      setArtifactDetailedOut(null);
      setArtifactDetailedError(!dataFile ? "V manifestu chybí dataFile — nelze načíst artefakty." : null);
      setArtifactDetailedLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setArtifactDetailedLoading(true);
      setArtifactDetailedError(null);
      setArtifactDetailedBanner(null);
      try {
        const years = Math.max(0, Math.floor(Number(manifestForView?.years ?? 0)));
        const nativeTf = String(manifestForView?.timeframe ?? "");
        const chartParam = chartTf === "source" ? "native" : chartTf;
        const chartTimeframeApi =
          chartTf === "source" ? null : effectiveViewDataTimeframe(chartParam, nativeTf);
        const win = { startIso: wo[0]!.date, endIso: wo[wo.length - 1]!.date };
        const res = await getViewData(dataFile, years, null, null, null, chartTimeframeApi, win, {
          useArtifacts: true,
          artifactIncludeSd: true,
        });
        if (cancelled) return;
        const mod = viewDataResponseToModuleOutput(res);
        setArtifactDetailedOut(filterModuleOutputToOhlcWindow(mod, wo));
        setArtifactDetailedBanner(res.artifact_banner ?? null);
      } catch (e) {
        if (cancelled) return;
        setArtifactDetailedOut(null);
        setArtifactDetailedError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setArtifactDetailedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    useArtifactLayersDetailed,
    activeTab,
    manifestForView,
    chartTf,
    detailedWindow,
  ]);

  const handleReproBundle = useCallback(async () => {
    if (!results) return;
    setBundleBusy(true);
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const manifest = results.manifest ?? {};
      const fp = String((manifest as Record<string, unknown>).datasetFingerprint ?? "n/a");
      const readme = [
        "Backtesting reproducibility bundle",
        "",
        "Limits:",
        "- strategy_main.py is the editor snapshot at export (may differ from Firestore if unsaved).",
        "- Python/backend version, engine script, and data files should match the original run environment.",
        "",
        `datasetFingerprint (manifest): ${fp}`,
      ].join("\n");
      const zipped = zipSync({
        "README_bundle.txt": strToU8(readme),
        "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
        "results_summary.json": strToU8(
          JSON.stringify(
            {
              runId: results.runId,
              metrics: results.metrics,
              validation: results.validation,
              monteCarlo: results.monteCarlo,
              executionSummary: results.executionSummary,
              batchSummary: results.batchSummary,
              batchRunsOmitted: (results.batchSummary as Record<string, unknown> | undefined)?.batchRunsOmitted,
              qualityGate: results.qualityGate,
              experiment: results.experiment,
              runNote: runNote || undefined,
            },
            null,
            2
          )
        ),
        ...(runNote.trim() ? { "run_note.txt": strToU8(runNote) } : {}),
        "strategy_main.py": strToU8(
          strategyMainPy.trim()
            ? strategyMainPy
            : "# No editor content passed — open main.py and export again.\n"
        ),
      });
      const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `repro-bundle-${(results.runId ?? "run").toString().slice(0, 24)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("ZIP export selhal (chybí balíček fflate?). Spusť npm install ve frontend/. ");
    } finally {
      setBundleBusy(false);
    }
  }, [results, strategyMainPy, runNote]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const idx = "12345".indexOf(e.key);
      if (idx >= 0 && idx < RESULT_TABS.length) setActiveTab(RESULT_TABS[idx]!.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!results) {
    return (
      <div className="flex flex-col flex-1 p-6">
        <div className="flex justify-between items-center mb-4">
          <button onClick={onBack} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm">
            ← Zpět na editor
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-500">Žádné výsledky</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <div className="flex justify-between items-center p-6 pb-4 shrink-0">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
        >
          ← Zpět na editor
        </button>
        <div className="flex gap-2">
          <button
            onClick={onExport}
            className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-medium text-sm"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void handleReproBundle()}
            disabled={bundleBusy}
            className="px-4 py-2 rounded-lg bg-emerald-800/60 hover:bg-emerald-700/70 font-medium text-sm disabled:opacity-50"
          >
            {bundleBusy ? "…" : "Repro bundle (ZIP)"}
          </button>
          <button
            type="button"
            onClick={() => setNoteExpanded((p) => !p)}
            className="px-3 py-2 rounded-lg bg-zinc-700/60 hover:bg-zinc-600/70 text-sm text-zinc-300"
            title="Poznámka k runu"
          >
            {noteExpanded ? "Skrýt poznámku" : "📝 Poznámka"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-px px-6 shrink-0 rounded-t-xl overflow-hidden border border-zinc-700/70 border-b-0 bg-zinc-800/80">
        {RESULT_TABS.map(({ id, label, shortcut }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`w-full py-3 text-[15px] font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === id
                ? "bg-zinc-900/95 text-emerald-400 border-b-2 border-emerald-500"
                : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/90"
            }`}
          >
            <span>{label}</span>
            <kbd className="text-[11px] text-zinc-500 font-mono font-normal">{shortcut}</kbd>
          </button>
        ))}
      </div>

      {noteExpanded && (
        <div className="mx-6 mt-2 mb-1">
          <textarea
            value={runNote}
            onChange={(e) => setRunNote(e.target.value)}
            placeholder="Proč tento run? Co testuji? Co jsem zjistil?"
            className="w-full h-20 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
          />
        </div>
      )}

      <div className="px-6 pt-3 space-y-2 shrink-0">
        {(() => {
          if (bannerDismissed.trust) return null;
          const prf = viewResults?.propRedFlags as Record<string, unknown> | undefined;
          const trust = prf ? String(prf.trustLevel ?? "") : "";
          const label = prf ? String(prf.trustLabel ?? "") : "";
          const cc = Number(prf?.criticalCount ?? 0);
          const wc = Number(prf?.warningCount ?? 0);
          const valMode = String((viewResults?.validation as Record<string, unknown> | undefined)?.mode ?? "single");
          if (!trust || (cc === 0 && wc === 0)) return null;
          const bg =
            trust === "not_trustworthy"
              ? "bg-rose-500/15 border-rose-600/40"
              : trust === "low_trust"
                ? "bg-amber-500/10 border-amber-500/30"
                : "bg-yellow-500/8 border-yellow-500/25";
          const tc =
            trust === "not_trustworthy" ? "text-rose-200" : trust === "low_trust" ? "text-amber-200" : "text-yellow-200";
          return (
            <div className={`relative rounded-xl border shadow-lg shadow-black/10 px-3 py-2.5 pr-20 text-xs ${bg} ${tc}`}>
              <button
                type="button"
                onClick={() => setBannerDismissed((p) => ({ ...p, trust: true }))}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-black/25 hover:bg-black/40 text-[11px] text-zinc-200 border border-zinc-600/50"
              >
                Schovat
              </button>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium uppercase tracking-wider text-[10px]">Trust: {trust.replace(/_/g, " ")}</span>
                <span>{label}</span>
                {cc > 0 && <span className="text-rose-300">{cc} critical</span>}
                {wc > 0 && <span className="text-amber-300">{wc} warning{wc > 1 ? "s" : ""}</span>}
                {valMode === "single" && (
                  <span className="text-zinc-400">Tip: zapni OOS/WF validaci pro vyšší důvěryhodnost.</span>
                )}
              </div>
            </div>
          );
        })()}

        {(() => {
          if (bannerDismissed.reality) return null;
          const m = viewResults?.metrics as unknown as Record<string, unknown> | undefined;
          const tradeCount = Number(m?.tradeCount ?? 0);
          const execSummary = viewResults?.executionSummary as Record<string, unknown> | undefined;
          const execEnabled = execSummary ? Boolean(execSummary.enabled) : false;
          const valObj = viewResults?.validation as Record<string, unknown> | undefined;
          const valMode = String(valObj?.mode ?? "single");
          const pnlD = viewResults?.tradePnlDistribution as Record<string, unknown> | undefined;
          const conc = pnlD?.concentration as Record<string, unknown> | undefined;
          const top5 = Number(conc?.top5PnlPct ?? NaN);

          const warnings: string[] = [];
          if (tradeCount > 0 && tradeCount < 30)
            warnings.push(`Pouze ${tradeCount} obchodů — statisticky nedostatečný vzorek.`);
          if (!execEnabled)
            warnings.push("Execution model vypnutý — výsledky nezahrnují slippage, spread ani latenci.");
          if (valMode === "single" && tradeCount > 0)
            warnings.push("Jediný run bez OOS/WF validace — přetrénování nelze detekovat.");
          if (Number.isFinite(top5) && top5 > 60)
            warnings.push(`Top 5 obchodů nese ${top5.toFixed(0)} % celkového PnL — edge závisí na pár výjimkách.`);

          if (warnings.length === 0) return null;
          return (
            <div className="relative rounded-xl border border-amber-600/45 bg-amber-950/30 shadow-lg shadow-black/10 px-3 py-2.5 pr-20 text-xs text-amber-200 space-y-0.5">
              <button
                type="button"
                onClick={() => setBannerDismissed((p) => ({ ...p, reality: true }))}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-black/25 hover:bg-black/40 text-[11px] text-amber-100 border border-amber-700/40"
              >
                Schovat
              </button>
              <div className="font-semibold uppercase tracking-wider text-[10px] text-amber-400/90 mb-1">Reality check</div>
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-amber-500 shrink-0 mt-px">&#9888;</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {batchRunCount > 1 && (
        <div className="px-6 pt-2 shrink-0 space-y-2">
          {!bannerDismissed.batch && (
            <div className="relative rounded-xl border border-amber-500/35 bg-amber-500/10 shadow-lg shadow-black/10 px-3 py-2.5 pr-20 text-xs text-amber-100 leading-relaxed">
              <button
                type="button"
                onClick={() => setBannerDismissed((p) => ({ ...p, batch: true }))}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-black/25 hover:bg-black/40 text-[11px] text-amber-100 border border-amber-600/40"
              >
                Schovat
              </button>
              <div>
                Dávka: <strong>{batchRunCount}</strong> runů. Grafy a záložky Equity / Highlight / Detailed / S/D analytika
                odpovídají <strong>vybranému instrumentu</strong> níže. Celkový souhrn přes všechny běhy je v blocích metrik a v
                Analytics (tabulka + agregace).
              </div>
            </div>
          )}
          {batchRuns && batchRuns.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="batch-instrument-select" className="text-zinc-400 shrink-0">
                Zobrazit instrument:
              </label>
              <select
                id="batch-instrument-select"
                value={batchViewIdx}
                onChange={(e) => setBatchViewIdx(Number(e.target.value))}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 min-w-[12rem] max-w-full"
              >
                {batchRuns.map((r, i) => {
                  const mf = r.manifest && typeof r.manifest === "object" ? (r.manifest as Record<string, unknown>) : {};
                  const sym = String(mf.instrument ?? `Run ${i + 1}`);
                  const file = String(mf.dataFile ?? "");
                  return (
                    <option key={i} value={i}>
                      {sym}
                      {file ? ` — ${file.split("/").pop() ?? file}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : batchSummaryRoot?.batchRunsOmitted ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {String(batchSummaryRoot.batchRunsOmittedReason ?? "Dílčí runy bez plného payloadu — přepínač instrumentů není k dispozici. Použij tabulku v Analytics nebo spusť méně než 13 instrumentů najednou.")}
            </div>
          ) : null}
        </div>
      )}

      {viewResults.qualityGate != null && !bannerDismissed.qualityGate && (
        <div className="px-6 pt-2 shrink-0">
          <QualityGateBanner
            qualityGate={viewResults.qualityGate}
            onDismiss={() => setBannerDismissed((p) => ({ ...p, qualityGate: true }))}
          />
        </div>
      )}

      {(() => {
        if (bannerDismissed.readiness) return null;
        const m = viewResults?.metrics as unknown as Record<string, unknown> | undefined;
        const valObj = viewResults?.validation as Record<string, unknown> | undefined;
        const mc = viewResults?.monteCarlo as Record<string, unknown> | undefined;
        const rob = viewResults?.robustness as Record<string, unknown> | undefined;
        const valSummary = valObj?.summary as Record<string, unknown> | undefined;
        const qg = viewResults?.qualityGate as Record<string, unknown> | undefined;
        const ovSig = viewResults?.overfittingSignals as Record<string, unknown> | undefined;
        const bsc = viewResults?.batchSummary as Record<string, unknown> | undefined;
        const assessment = assessOverfitting({
          validationMode: String(valObj?.mode ?? "single"),
          tradeCount: Number(m?.tradeCount ?? 0),
          riskOfRuin: Number(mc?.riskOfRuin ?? NaN),
          qualityGatePassed: qg ? (typeof qg.passed === "boolean" ? (qg.passed as boolean) : null) : null,
          avgDegradation: Number(valSummary?.avgDegradation ?? 0),
          foldsFailedGates: Number(valSummary?.foldsFailedGates ?? 0),
          guardHintCount: Array.isArray((valObj?.guardrails as Record<string, unknown> | undefined)?.possibleLeakageHints)
            ? ((valObj?.guardrails as Record<string, unknown>).possibleLeakageHints as unknown[]).length : 0,
          sweepTested: Number(rob?.tested ?? 0),
          stabilityScore: Number(rob?.stabilityScore ?? NaN),
          batchRunCount: Number(bsc?.runCount ?? 0),
          paramTestRuns: Number(valSummary?.paramTestTotalRuns ?? 0),
          profitFactor: m?.profitFactor != null ? Number(m.profitFactor) : null,
          profitFactorStatus: typeof m?.profitFactorStatus === "string" ? m.profitFactorStatus as string : null,
          trialCount: Number(ovSig?.trialCount ?? 1),
          naiveAdjustedAlpha: ovSig?.naiveAdjustedAlpha != null ? Number(ovSig.naiveAdjustedAlpha) : null,
        });
        const tier = readinessFromSeverity(assessment.severityScore);
        const tierColor = tier === "ready" ? "border-emerald-600/50 bg-emerald-950/20 text-emerald-200"
          : tier === "caution" ? "border-amber-600/50 bg-amber-950/20 text-amber-200"
          : "border-rose-600/50 bg-rose-950/20 text-rose-200";
        const tierDot = tier === "ready" ? "bg-emerald-500" : tier === "caution" ? "bg-amber-500" : "bg-rose-500";
        const valMode = String(valObj?.mode ?? "single");
        const mcRan = mc != null && Number(mc.simulations ?? 0) > 0;
        const manifest = viewResults?.manifest as Record<string, unknown> | undefined;
        const inst = String(manifest?.instrument ?? "");
        const dataFile = String(manifest?.dataFile ?? "");
        const shortFile = dataFile.split("/").pop()?.split("\\").pop() ?? dataFile;
        const execSummary = viewResults?.executionSummary as Record<string, unknown> | undefined;
        const execOn = execSummary ? Boolean(execSummary.enabled) : false;
        const topWarnings = assessment.warnings.slice(0, 3);
        return (
          <div className="px-6 pt-2 shrink-0">
            <div className={`relative rounded-xl border shadow-lg shadow-black/15 px-3 py-2.5 pr-20 text-xs ${tierColor} space-y-1`}>
              <button
                type="button"
                onClick={() => setBannerDismissed((p) => ({ ...p, readiness: true }))}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded-md bg-black/25 hover:bg-black/40 text-[11px] text-zinc-200 border border-zinc-600/50"
              >
                Schovat
              </button>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${tierDot}`} />
                  <span className="font-medium text-[11px]">{assessment.readinessLabel}</span>
                </span>
                <span className="text-zinc-500">|</span>
                <span className="text-zinc-400">
                  {valMode === "single"
                    ? "Single run"
                    : valMode === "oos_split"
                      ? "OOS"
                      : valMode === "walk_forward"
                        ? "WF"
                        : valMode === "param_test"
                          ? "Param test"
                          : valMode}
                </span>
                <span className="text-zinc-400">MC: {mcRan ? "yes" : "no"}</span>
                <span className="text-zinc-400">Exec: {execOn ? "on" : "off"}</span>
                {inst && <span className="text-zinc-400">{inst}</span>}
                {shortFile && <span className="text-zinc-500 truncate max-w-[180px]">{shortFile}</span>}
                <span className="text-zinc-500 ml-auto">score {assessment.severityScore}</span>
              </div>
              {topWarnings.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-90">
                  {topWarnings.map((w, i) => (
                    <span key={i}>{w}</span>
                  ))}
                  {assessment.warnings.length > 3 && (
                    <span className="text-zinc-500">+{assessment.warnings.length - 3} more in Analytics</span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <details className="mx-6 mt-2 mb-1 shrink-0 rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/40 via-zinc-950/30 to-zinc-950/50 shadow-lg shadow-black/15 overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100 select-none list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 border-b border-zinc-800/50">
          <span>Metriky runu</span>
          <span className="text-xs text-zinc-500 font-normal">Kliknutím rozbalit / sbalit</span>
        </summary>
        <div className="px-4 py-3 border-t border-zinc-800/40">
          <StatBlocks results={viewResults} batchAggregates={batchRunCount > 1 ? batchAggregates : null} />
        </div>
        {contextTrade && contextChartOhlc.length > 0 && (
          <div className="px-4 pb-4">
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                Price context (LW chart) — 2× historie · marker: entry
              </div>
              <PriceContextChart
                ohlc={contextChartOhlc}
                entryIso={String(contextTrade.entryDate ?? contextTrade.date ?? "")}
                side={contextTrade.type === "sell" ? "short" : "long"}
                height={300}
              />
            </div>
          </div>
        )}
      </details>

      <div
        className={`flex-1 px-6 mt-2 rounded-b-xl overflow-hidden bg-zinc-900/80 border border-zinc-800 ${
          activeTab === "highlight" ||
            activeTab === "detailed" ||
            activeTab === "runHistory" ||
            activeTab === "analytics"
            ? "min-h-[560px]"
            : "min-h-[480px]"
        }`}
      >
        {activeTab === "equity" && (
          <div className="space-y-4 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1 inline-flex items-center gap-1">
                Equity — účet
                <FieldHelpPopover help={backtestFieldHelp.resultsEquityUsd} />
              </div>
              <EquityChart
                equityCurve={viewResults.equityCurve}
                equity={viewResults.equityCurve ? undefined : viewResults.equity}
                height={320}
                dates={
                  !viewResults.equityCurve?.length && viewResults.ohlc?.length
                    ? (() => {
                        const first = viewResults.ohlc![0]?.date;
                        if (!first) return undefined;
                        const d = new Date(first);
                        d.setDate(d.getDate() - 1);
                        const dayBefore = d.toISOString();
                        return [dayBefore, ...viewResults.ohlc!.map((o) => o.date)];
                      })()
                    : undefined
                }
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 mb-1 inline-flex items-center gap-1">
                Kumulativní R (uzavřené obchody)
                <FieldHelpPopover help={backtestFieldHelp.resultsEquityR} />
              </div>
              {rEquityCurve.length >= 1 ? (
                <EquityChart
                  equityCurve={rEquityCurve}
                  height={280}
                  yAxisTitle="Součet R"
                  seriesHoverLabel="Kumulativní R"
                  lineColor="#f59e0b"
                  fillRgba="rgba(245, 158, 11, 0.28)"
                  footerHint={
                    rSummary != null
                      ? `Obchodů s odhadnutým R: ${rSummary.count} z ${viewResults.trades?.length ?? 0} (ze zoneMeta: stop, vstup, velikost).`
                      : null
                  }
                />
              ) : (
                <div className="h-[200px] rounded-lg bg-zinc-900 flex flex-col items-center justify-center text-zinc-500 text-sm px-4 text-center gap-1">
                  <span>Křivka R není k dispozici.</span>
                  <span className="text-xs text-zinc-600">
                    Potřeba jsou uzavřené obchody s PnL a v zoneMeta platný stopPrice od strategie.
                  </span>
                </div>
              )}
            </div>
            {(() => {
              const eq = viewResults.equityCurve ?? (viewResults.equity ?? []).map((v, i) => ({ date: String(i), value: v }));
              if (!eq || eq.length < 2) return null;
              let peak = -Infinity;
              const ddPoints: { date: string; dd: number }[] = [];
              let maxDdPct = 0;
              let uwBars = 0;
              for (const pt of eq) {
                const val = typeof pt === "object" && pt !== null ? (pt as { date: string; value: number }).value : Number(pt);
                const date = typeof pt === "object" && pt !== null ? (pt as { date: string; value: number }).date : "";
                if (val > peak) peak = val;
                const dd = peak > 0 ? ((peak - val) / peak) * 100 : 0;
                if (dd > maxDdPct) maxDdPct = dd;
                if (dd > 0.01) uwBars++;
                ddPoints.push({ date, dd: -dd });
              }
              const uwPct = eq.length > 0 ? ((uwBars / eq.length) * 100).toFixed(0) : "0";
              return (
                <div>
                  <div className="flex items-center gap-3 px-1 mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Underwater (drawdown %)</span>
                    <span className="text-[10px] text-zinc-500">
                      Max: <span className="text-rose-400 font-mono">{maxDdPct.toFixed(2)}%</span>
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Pod vodou: <span className="text-amber-400 font-mono">{uwPct}%</span> barů
                    </span>
                  </div>
                  <div className="h-[100px] bg-zinc-900/60 rounded border border-zinc-800/50 relative overflow-hidden">
                    <svg viewBox={`0 0 ${ddPoints.length} 100`} className="w-full h-full" preserveAspectRatio="none">
                      {maxDdPct > 0 && (
                        <path
                          d={`M0,0 ${ddPoints.map((p, i) => `L${i},${(-p.dd / maxDdPct) * 95}`).join(" ")} L${ddPoints.length - 1},0 Z`}
                          fill="rgba(239,68,68,0.25)"
                          stroke="rgba(239,68,68,0.6)"
                          strokeWidth="0.5"
                        />
                      )}
                    </svg>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {activeTab === "highlight" && (
          <TradeHighlight ohlc={viewResults.ohlc ?? []} trades={viewResults.trades} chartHeight={360} />
        )}
        {activeTab === "detailed" &&
          (viewResults.ohlc && detailedWindow ? (
            <div className="py-4 h-full overflow-auto">
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                  <span className="text-zinc-500 shrink-0">Výřez:</span>
                  <select
                    value={detailedMode}
                    onChange={(e) => setDetailedMode(e.target.value as DetailedViewMode)}
                    className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200"
                  >
                    <option value="by_trades">Počet obchodů</option>
                    <option value="by_months">Období (měsíce)</option>
                  </select>
                  <span className="text-zinc-500 shrink-0">TF grafu:</span>
                  <select
                    value={chartTf}
                    onChange={(e) => setChartTf(e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200"
                    title="Agregace svíček z dat runu. Pro přesnou osu použij „Zdroj“. Žlutě obrys = zóna z zoneMeta u daného obchodu; ostatní obdélníky = všechny zóny z modulu v okně."
                  >
                    {chartTfOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {detailedMode === "by_trades" ? (
                    <label className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Najednou</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={tradesPerView}
                        onChange={(e) => setTradesPerView(Math.min(100, Math.max(1, Number(e.target.value) || 15)))}
                        className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                      />
                    </label>
                  ) : (
                    <label className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Měsíců</span>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={monthsPerView}
                        onChange={(e) => setMonthsPerView(Math.min(36, Math.max(1, Number(e.target.value) || 3)))}
                        className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
                      />
                    </label>
                  )}
                  <div className="flex gap-1 ml-auto">
                    <button
                      type="button"
                      disabled={!detailedWindow.hasPrev}
                      onClick={() => setDetailedPage((p) => Math.max(0, p - 1))}
                      className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      ← Předchozí
                    </button>
                    <button
                      type="button"
                      disabled={!detailedWindow.hasNext}
                      onClick={() => setDetailedPage((p) => p + 1)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Další →
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useArtifactLayersDetailed}
                    onChange={(e) => setUseArtifactLayersDetailed(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800"
                  />
                  <span className="inline-flex items-center gap-1 flex-wrap">
                    <span>
                      Vrstvy z cache (stejný formát jako View /{" "}
                      <code className="text-zinc-500">.backtest_artifacts</code>)
                    </span>
                    <span className="inline-flex" onMouseDown={(e) => e.preventDefault()}>
                      <FieldHelpPopover help={backtestFieldHelp.resultsDetailedArtifactLayers} />
                    </span>
                  </span>
                </label>
                {artifactDetailedLoading ? (
                  <p className="text-xs text-amber-200/90">Načítám artefakty pro výřez…</p>
                ) : null}
                {artifactDetailedError ? (
                  <p className="text-xs text-rose-400">{artifactDetailedError}</p>
                ) : null}
                {useArtifactLayersDetailed && artifactDetailedBanner ? (
                  <p className="text-xs text-zinc-500">{artifactDetailedBanner}</p>
                ) : null}
                <p className="text-xs text-zinc-500">{detailedWindow.summary}</p>
                <ModuleOutputChart
                  ohlc={chartOhlc.length ? chartOhlc : detailedWindow.windowOhlc}
                  moduleName="Detailed"
                  output={detailedChartOutputEffective}
                  trades={detailedWindow.visibleTrades}
                  height={520}
                  orderLevelsMode
                  rrrTradeStyle={false}
                  showZoneTouchByIndex={chartTf === "source"}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">
              Detailed view není dostupný, protože run nevrátil OHLC data.
            </div>
          ))}
        {activeTab === "runHistory" && (
          <div className="py-4 h-full overflow-auto">
            <RunHistory
              runs={runHistory}
              onDeleteRun={onDeleteRun}
              onDeleteAll={onDeleteAllRuns}
              onUpdateLifecycle={onUpdateLifecycle}
            />
          </div>
        )}
        {activeTab === "analytics" && (
          <div className="h-full overflow-auto">
            <AnalyticsView results={viewResults} batchSummary={results.batchSummary} />
          </div>
        )}
      </div>
    </div>
  );
}
