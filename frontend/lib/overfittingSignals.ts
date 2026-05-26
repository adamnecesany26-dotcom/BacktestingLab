/**
 * Heuristic overfitting / edge-readiness signals shared by Analytics and Run history.
 * Not statistical proof — guides human review.
 */

export interface OverfittingSignalContext {
  validationMode: string;
  tradeCount: number;
  riskOfRuin: number;
  qualityGatePassed: boolean | undefined | null;
  avgDegradation?: number;
  foldsFailedGates?: number;
  guardHintCount?: number;
  sweepTested?: number;
  stabilityScore?: number;
  batchRunCount?: number;
  /** Dodatečné OAT běhy z validation.param_test (bez baseline). */
  paramTestRuns?: number;
  profitFactor?: number | null;
  profitFactorStatus?: string | null;
  /** Total configurations tested (main + sweep + param test) */
  trialCount?: number;
  /** Naive Bonferroni adjusted alpha (0.05 / trialCount) */
  naiveAdjustedAlpha?: number | null;
}

export interface OverfittingAssessment {
  warnings: string[];
  /** Higher = more concern; used for readiness tier. */
  severityScore: number;
  readinessLabel: string;
}

export function assessOverfitting(ctx: OverfittingSignalContext): OverfittingAssessment {
  const warnings: string[] = [];
  let severity = 0;

  const mode = (ctx.validationMode || "single").toLowerCase();

  if (mode === "single") {
    warnings.push("Pouze single run (bez OOS/WF) — nejvyšší riziko zkreslení.");
    severity += 3;
  }

  const tc = Math.max(0, Math.floor(Number(ctx.tradeCount) || 0));
  if (tc < 20) {
    warnings.push(`Nízký počet obchodů (${tc}) — metriky mají vysokou varianci.`);
    severity += 2;
  } else if (tc < 40) {
    warnings.push(`Středně nízký počet obchodů (${tc}) — opatrná interpretace.`);
    severity += 1;
  }

  const ror = ctx.riskOfRuin;
  if (Number.isFinite(ror)) {
    if (ror > 0.25) {
      warnings.push(`Vysoký odhad risk of ruin (${(ror * 100).toFixed(1)}%).`);
      severity += 2;
    } else if (ror > 0.1) {
      warnings.push(`Zvýšený risk of ruin (${(ror * 100).toFixed(1)}%).`);
      severity += 1;
    }
  }

  if (ctx.qualityGatePassed === false) {
    warnings.push("Quality gate je FAIL.");
    severity += 3;
  }

  const sweepTested = Math.max(0, Math.floor(Number(ctx.sweepTested ?? 0)));
  if (sweepTested > 0 && mode === "single") {
    warnings.push(
      `Parametrický sweep (${sweepTested} vzorků) na single runu — vysoké riziko přeladění.`,
    );
    severity += 2;
  }

  const avgDeg = Number(ctx.avgDegradation ?? 0);
  if ((mode === "walk_forward" || mode === "oos_split") && Number.isFinite(avgDeg) && avgDeg < -0.35) {
    warnings.push(
      `Silný propad train→test (avg degradation ${avgDeg.toFixed(2)}) — možný overfit na train části.`,
    );
    severity += 2;
  }

  const ff = Math.max(0, Math.floor(Number(ctx.foldsFailedGates ?? 0)));
  if (ff > 0) {
    warnings.push(`${ff} fold(ů) nesplnilo quality gates na test segmentu.`);
    severity += 2;
  }

  const gh = Math.max(0, Math.floor(Number(ctx.guardHintCount ?? 0)));
  if (gh > 0) {
    warnings.push(
      `Validation guardrails: ${gh} upozornění (krátké okno / málo obchodů ve foldu / WF korelace).`,
    );
    severity += 1;
  }

  const stabil = Number(ctx.stabilityScore ?? NaN);
  if (sweepTested >= 5 && Number.isFinite(stabil) && stabil < 0.35) {
    warnings.push(`Nízká stabilita výsledků sweepu (stabilityScore ${stabil.toFixed(2)}).`);
    severity += 1;
  }

  const ptr = Math.max(0, Math.floor(Number(ctx.paramTestRuns ?? 0)));
  if (ptr > 0) {
    warnings.push(
      `Param test: ${ptr} dodatečných běhů (OAT po parametrech) — vícenásobné porovnání; špičky metrik ber jen jako exploraci.`,
    );
    severity += 1;
    if (ptr >= 24) {
      severity += 1;
    }
  }

  const brc = Math.max(0, Math.floor(Number(ctx.batchRunCount ?? 0)));
  if (brc >= 8) {
    warnings.push(
      `Velká dávka batch runů (${brc}) — násobí riziko falešných pozitiv (multiple testing).`,
    );
    severity += 1;
  } else if (brc >= 4) {
    warnings.push(`Batch více konfigurací (${brc}) — opatrná interpretace „nejlepšího“ výsledku.`);
    severity += 1;
  }

  const pfs = String(ctx.profitFactorStatus ?? "");
  if (pfs === "undefined_no_losing_trades") {
    warnings.push(
      "Profit factor není definován (žádné ztrátové obchody) — není to důkaz „nekonečného“ edge, jen degenerace poměru.",
    );
    severity += 1;
  }
  if (pfs === "no_gross_activity" && tc === 0) {
    warnings.push("Žádná uzavřená P&L aktivita — metriky jako PF nemají smysl.");
    severity += 1;
  }

  const pfRaw = ctx.profitFactor;
  const pf = pfRaw == null ? NaN : Number(pfRaw);
  if (Number.isFinite(pf) && pf >= 3 && tc < 50 && tc >= 10) {
    warnings.push(
      "Velmi vysoký profit factor při omezeném počtu obchodů — zkontroluj výjimky a sample bias.",
    );
    severity += 1;
  }

  const trials = Math.max(1, Math.floor(Number(ctx.trialCount ?? 1)));
  if (trials > 1) {
    const adjAlpha = ctx.naiveAdjustedAlpha ?? (0.05 / trials);
    warnings.push(
      `Celkem ${trials} konfigurací testováno — naive Bonferroni práh: ${adjAlpha.toFixed(4)} (0.05/${trials}). ` +
      "Vítězné metriky mohou odrážet šťastnou náhodu při mnohonásobném porovnání.",
    );
    if (trials >= 20) severity += 2;
    else if (trials >= 5) severity += 1;
  }

  let readinessLabel: string;
  if (severity === 0) {
    readinessLabel = "Heuristic signal: eligible for controlled forward test";
  } else if (severity <= 4) {
    readinessLabel = "Heuristic signal: promising, but still needs more validation";
  } else {
    readinessLabel = "Heuristic signal: not ready for trust";
  }

  return { warnings, severityScore: severity, readinessLabel };
}

export function readinessFromSeverity(severity: number): "ready" | "caution" | "not_ready" {
  if (severity === 0) return "ready";
  if (severity <= 4) return "caution";
  return "not_ready";
}
