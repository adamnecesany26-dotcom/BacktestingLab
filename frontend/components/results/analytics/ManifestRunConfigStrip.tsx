"use client";

import type { RunResponse } from "@shared/types";

/** Shrnutí konfigurace z manifest.analysis (data z backendu, bez odhadů z metrik). */
export function ManifestRunConfigStrip({ results }: { results: RunResponse }) {
  const manifest =
    results.manifest && typeof results.manifest === "object" ? (results.manifest as Record<string, unknown>) : null;
  const raw = manifest?.analysis;
  const analysis = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!analysis) return null;

  const foldsLen = Array.isArray((results.validation as Record<string, unknown> | undefined)?.folds)
    ? ((results.validation as Record<string, unknown>).folds as unknown[]).length
    : 0;
  const vm = String(analysis.validation_mode ?? "single");
  const validationLabel =
    vm === "oos_split"
      ? "OOS split"
      : vm === "walk_forward"
        ? "Walk-forward"
        : vm === "param_test"
          ? "Param test"
          : "Single run";

  const sweep = analysis.sweep_mode;
  const sweepStr =
    sweep != null && String(sweep).trim() !== "" && String(sweep) !== "undefined" ? String(sweep) : "vypnuto";

  const mcRaw = analysis.monte_carlo;
  const mcCfg = mcRaw && typeof mcRaw === "object" ? (mcRaw as Record<string, unknown>) : null;
  const mcN = mcCfg != null ? Number(mcCfg.simulations ?? 0) : 0;
  const mcStr = mcN > 0 ? `${mcN} sim` : "vypnuto";

  const regimeRaw = analysis.regime_config;
  const regimeOn =
    regimeRaw && typeof regimeRaw === "object" && (regimeRaw as Record<string, unknown>).enabled === true;

  const portRaw = analysis.portfolio_config;
  const portfolioOn =
    portRaw != null && typeof portRaw === "object" && Object.keys(portRaw as object).length > 0;

  const exRaw = analysis.execution_model;
  const ex = exRaw && typeof exRaw === "object" ? (exRaw as Record<string, unknown>) : null;
  const executionOn = ex?.enabled === true;
  const forwardOn =
    executionOn &&
    ex?.forward_bridge != null &&
    typeof ex.forward_bridge === "object" &&
    Object.keys(ex.forward_bridge as object).length > 0;

  const batchRaw = analysis.batch_config;
  const batchOn =
    batchRaw != null && typeof batchRaw === "object" && Object.keys(batchRaw as object).length > 0;

  const expOn = analysis.experiment != null && typeof analysis.experiment === "object";

  const items: { k: string; v: string }[] = [
    { k: "Validace", v: validationLabel },
    { k: "Sweep", v: sweepStr },
    { k: "Monte Carlo", v: mcStr },
    { k: "Regime analýza", v: regimeOn ? "zapnuto" : "vypnuto" },
    { k: "Portfolio", v: portfolioOn ? "zapnuto" : "vypnuto" },
    { k: "Exekuční model", v: executionOn ? "zapnuto" : "vypnuto" },
  ];
  if (forwardOn) items.push({ k: "Forward bridge", v: "zapnuto" });
  if (batchOn) items.push({ k: "Batch / matrix", v: "zapnuto" });
  if (expOn) items.push({ k: "Experiment metadata", v: "ano" });

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/50 via-zinc-900/30 to-zinc-950/50 px-4 py-3 shadow-lg shadow-black/20">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Konfigurace běhu (manifest)</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {items.map(({ k, v }) => (
          <span
            key={k}
            className="inline-flex items-baseline gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1"
          >
            <span className="text-zinc-500">{k}:</span>
            <span className="text-zinc-200 font-medium">{v}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-zinc-600 mt-1.5">
        Z <code className="text-zinc-500">manifest.analysis</code>
        {vm === "oos_split" || vm === "walk_forward" ? (
          foldsLen > 0 ? (
            <> — foldy v záložce OOS / Walk-forward.</>
          ) : (
            <>
              {" "}
              — pokud chybí <code className="text-zinc-500">validation.folds</code>, jde o starší / oříznutý payload.
            </>
          )
        ) : vm === "param_test" ? (
          <> — detail parametrů v záložce Param test.</>
        ) : (
          <> — konfigurace z backendu.</>
        )}
      </p>
    </div>
  );
}
