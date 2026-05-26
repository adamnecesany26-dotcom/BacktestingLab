import type { RunResponse } from "@shared/types";

export function validationFoldsPropsFromResults(results: RunResponse) {
  const foldsRaw = Array.isArray(results.validation?.folds)
    ? (results.validation!.folds as Record<string, unknown>[])
    : [];
  const manifestRec =
    results.manifest && typeof results.manifest === "object" ? (results.manifest as Record<string, unknown>) : null;
  const manifestAnalysis =
    manifestRec?.analysis && typeof manifestRec.analysis === "object"
      ? (manifestRec.analysis as Record<string, unknown>)
      : null;
  const manifestRequestedVal = String(manifestAnalysis?.validation_mode ?? "");
  const manifestWantsOosWf =
    manifestRequestedVal === "oos_split" || manifestRequestedVal === "walk_forward";
  const manifestFoldCountRaw = manifestRec?.validationFoldCount;
  const manifestFoldCount =
    manifestFoldCountRaw != null && Number.isFinite(Number(manifestFoldCountRaw))
      ? Math.max(0, Math.floor(Number(manifestFoldCountRaw)))
      : null;
  const foldsMissingPayload =
    manifestWantsOosWf && foldsRaw.length === 0 && manifestFoldCount != null && manifestFoldCount > 0;
  const foldsMissingUnknown =
    manifestWantsOosWf &&
    foldsRaw.length === 0 &&
    (manifestFoldCount == null || manifestFoldCount === 0);
  const guardrails =
    results.validation?.guardrails && typeof results.validation.guardrails === "object"
      ? (results.validation.guardrails as Record<string, unknown>)
      : null;
  const guardHints = Array.isArray(guardrails?.possibleLeakageHints)
    ? (guardrails.possibleLeakageHints as string[])
    : [];
  const validationMode = String(results.validation?.mode ?? "single");
  const valSummary =
    results.validation?.summary && typeof results.validation.summary === "object"
      ? (results.validation.summary as Record<string, unknown>)
      : null;

  return {
    foldsRaw,
    guardHints,
    foldsMissingPayload,
    foldsMissingUnknown,
    manifestFoldCount,
    validationMode,
    avgDegradation: Number(valSummary?.avgDegradation ?? 0),
    foldsFailedGates: Number(valSummary?.foldsFailedGates ?? 0),
    foldCountMeta: Number(valSummary?.foldCount ?? 0),
  };
}
