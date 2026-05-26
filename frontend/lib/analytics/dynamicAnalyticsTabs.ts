import type { RunResponse } from "@shared/types";

export type AnalyticsDynamicKind = "sweep" | "walk_forward" | "oos_split" | "param_test" | "regime";

export type AnalyticsDynamicTab = {
  id: string;
  kind: AnalyticsDynamicKind;
  label: string;
};

const ORDER: AnalyticsDynamicKind[] = ["sweep", "walk_forward", "oos_split", "param_test"];

const LABELS: Record<AnalyticsDynamicKind, string> = {
  sweep: "Sweep",
  walk_forward: "Walk-forward",
  oos_split: "OOS split",
  param_test: "OAT sweep",
  regime: "Regime",
};

/**
 * Odvozené dynamické záložky z payloadu (žádné hardcoded metriky — jen presence dat / režimu).
 */
export function deriveDynamicAnalyticsTabs(results: RunResponse): AnalyticsDynamicTab[] {
  const out: AnalyticsDynamicTab[] = [];
  const seen = new Set<AnalyticsDynamicKind>();

  const validation = results.validation && typeof results.validation === "object"
    ? (results.validation as Record<string, unknown>)
    : null;
  const mode = String(validation?.mode ?? "single");

  const robustness = results.robustness && typeof results.robustness === "object"
    ? (results.robustness as Record<string, unknown>)
    : null;
  const sweepTested = Math.max(0, Math.floor(Number(robustness?.tested ?? 0)));

  const paramTest =
    validation?.paramTest != null && typeof validation.paramTest === "object";

  const regimeRaw = results.regimeAnalysis && typeof results.regimeAnalysis === "object"
    ? (results.regimeAnalysis as Record<string, unknown>)
    : null;
  const regimeTab =
    !!regimeRaw &&
    (regimeRaw.segmentation === "per_regime_ema_atr_v1" ||
      (regimeRaw.byRegime != null && typeof regimeRaw.byRegime === "object"));

  const add = (kind: AnalyticsDynamicKind) => {
    if (seen.has(kind)) return;
    seen.add(kind);
    out.push({ id: `dyn-${kind}`, kind, label: LABELS[kind] });
  };

  if (sweepTested > 0) add("sweep");
  if (mode === "walk_forward") add("walk_forward");
  if (mode === "oos_split") add("oos_split");
  if (paramTest) add("param_test");
  if (regimeTab) add("regime");

  out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return out;
}
