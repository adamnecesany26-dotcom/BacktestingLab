"use client";

import type { ReactNode } from "react";
import type { RunResponse } from "@shared/types";

type Variant = "compact" | "default";

function degradationTone(avgDeg: number): "ok" | "warn" | "bad" | "neutral" {
  if (!Number.isFinite(avgDeg)) return "neutral";
  if (avgDeg > 0.6) return "bad";
  if (avgDeg > 0.35) return "warn";
  return "ok";
}

function Chip({ children, tone }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" }) {
  const bg =
    tone === "ok"
      ? "border-emerald-600/35 bg-emerald-950/35 text-emerald-100"
      : tone === "warn"
        ? "border-amber-600/35 bg-amber-950/30 text-amber-100"
        : tone === "bad"
          ? "border-rose-600/40 bg-rose-950/35 text-rose-100"
          : "border-zinc-600/40 bg-zinc-900/70 text-zinc-300";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium tabular-nums ${bg}`}>
      {children}
    </span>
  );
}

export function ValidationResultsHero({ results, variant = "default" }: { results: RunResponse; variant?: Variant }) {
  const val = results.validation && typeof results.validation === "object" ? (results.validation as Record<string, unknown>) : null;
  const mode = String(val?.mode ?? "single");
  const summary = val?.summary && typeof val.summary === "object" ? (val.summary as Record<string, unknown>) : null;
  const folds = Array.isArray(val?.folds) ? (val.folds as unknown[]) : [];
  const foldCountSummary = Math.max(0, Math.floor(Number(summary?.foldCount ?? 0)));
  const foldCountEff = Math.max(folds.length, foldCountSummary);
  const avgDeg = Number(summary?.avgDegradation ?? NaN);
  const medDeg = Number(summary?.medianDegradation ?? NaN);
  const foldsFailed = Math.max(0, Math.floor(Number(summary?.foldsFailedGates ?? 0)));
  const paramRuns = Math.max(0, Math.floor(Number(summary?.paramTestTotalRuns ?? 0)));
  const paramKeys = Array.isArray(summary?.paramKeysTested) ? (summary!.paramKeysTested as string[]) : [];
  const paramTest = val?.paramTest && typeof val.paramTest === "object" ? (val.paramTest as Record<string, unknown>) : null;
  const runsLen = Array.isArray(paramTest?.runs) ? (paramTest.runs as unknown[]).length : 0;
  const methodology = val?.methodology && typeof val.methodology === "object" ? (val.methodology as Record<string, unknown>) : null;
  const methDesc = typeof methodology?.description === "string" ? methodology.description.trim() : "";

  const pad = variant === "compact" ? "px-3 py-2.5" : "px-4 py-3.5";
  const titleCls = variant === "compact" ? "text-xs" : "text-sm";
  const bodyCls = variant === "compact" ? "text-[11px] leading-snug" : "text-xs leading-relaxed";
  const foldWhere =
    variant === "compact"
      ? "Kompletní tabulku foldů otevři v záložce „Analytics“."
      : "Rozklikni jednotlivé foldy níže na této stránce.";

  if (mode === "single") {
    return (
      <div
        className={`rounded-xl border border-zinc-700/55 bg-zinc-950/45 shadow-md shadow-black/15 ${pad}`}
        role="region"
        aria-label="Režim validace: jeden běh"
      >
        <div className={`uppercase tracking-wider text-[10px] font-medium text-zinc-500 ${titleCls}`}>Validace · jeden běh</div>
        <p className={`mt-1.5 text-zinc-300 ${bodyCls}`}>
          Zobrazené metriky, equity a seznam obchodů odpovídají <span className="text-zinc-200 font-medium">jednomu</span> plnému
          backtestu na celém načteném úseku dat. Žádné dodatečné out-of-sample okno se v tomto režimu nepřepočítává.
        </p>
        {variant === "default" && (
          <p className="mt-1 text-[10px] text-zinc-600">
            Chceš-li vidět výkon na části dat, která strategie „neviděla“ v IS, v konfiguraci zapni OOS split nebo walk-forward.
          </p>
        )}
      </div>
    );
  }

  if (mode === "oos_split") {
    const degToneChip = degradationTone(avgDeg);
    return (
      <div
        className={`rounded-xl border border-sky-700/45 bg-gradient-to-br from-sky-950/35 via-zinc-950/40 to-zinc-950/55 shadow-lg shadow-black/20 ${pad}`}
        role="region"
        aria-label="Režim validace: OOS split"
      >
        <div className={`uppercase tracking-wider text-[10px] font-medium text-sky-400/90 ${titleCls}`}>Validace · OOS split</div>
        <p className={`mt-1.5 text-sky-100/90 ${bodyCls}`}>
          Horní přehled (Křivky, Obchody) je stále z <span className="text-white font-medium">jednoho plného běhu na všech datech</span>.
          Skutečný OOS výkon hledej ve <span className="text-zinc-200 font-medium">sloupcích „test“ u foldů</span> — tam engine porovnává
          train vs. test pro každý řez. {foldWhere}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip>Foldů: {foldCountEff || "—"}</Chip>
          {Number.isFinite(avgDeg) ? (
            <Chip tone={degToneChip === "neutral" ? "neutral" : degToneChip}>
              Ø degradace (engine): {avgDeg.toFixed(3)}
            </Chip>
          ) : null}
          {Number.isFinite(medDeg) && medDeg !== avgDeg ? (
            <Chip tone="neutral">Medián degradace: {medDeg.toFixed(3)}</Chip>
          ) : null}
          {foldsFailed > 0 ? <Chip tone="bad">Foldů FAIL gate: {foldsFailed}</Chip> : <Chip tone="ok">Gate foldů: 0 FAIL</Chip>}
        </div>
        {variant === "default" && methDesc ? (
          <p className="mt-2 text-[10px] text-zinc-500 leading-snug border-t border-zinc-800/80 pt-2">{methDesc}</p>
        ) : null}
      </div>
    );
  }

  if (mode === "walk_forward") {
    const degToneChip = degradationTone(avgDeg);
    return (
      <div
        className={`rounded-xl border border-violet-700/45 bg-gradient-to-br from-violet-950/30 via-zinc-950/40 to-zinc-950/55 shadow-lg shadow-black/20 ${pad}`}
        role="region"
        aria-label="Režim validace: walk-forward"
      >
        <div className={`uppercase tracking-wider text-[10px] font-medium text-violet-300/90 ${titleCls}`}>
          Validace · walk-forward
        </div>
        <p className={`mt-1.5 text-violet-100/85 ${bodyCls}`}>
          Statistiky nahoře (mimo tuto kartu) jsou z <span className="text-white font-medium">plného běhu na všech datech</span>. Walk-forward
          přidává posuvná okna — u každého foldu sleduj zejména <span className="text-zinc-200 font-medium">test (OOS) metriky</span> a
          stabilitu napříč foldy. {foldWhere}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip>Foldů: {foldCountEff || "—"}</Chip>
          {Number.isFinite(avgDeg) ? (
            <Chip tone={degToneChip === "neutral" ? "neutral" : degToneChip}>
              Ø degradace: {avgDeg.toFixed(3)}
            </Chip>
          ) : null}
          {foldsFailed > 0 ? <Chip tone="bad">FAIL gate: {foldsFailed}</Chip> : <Chip tone="ok">0 FAIL gate</Chip>}
        </div>
        {variant === "default" && methDesc ? (
          <p className="mt-2 text-[10px] text-zinc-500 leading-snug border-t border-zinc-800/80 pt-2">{methDesc}</p>
        ) : null}
      </div>
    );
  }

  if (mode === "param_test") {
    const trainOnly = paramTest?.trainOnly === true;
    const trBars = Math.max(0, Math.floor(Number(paramTest?.trainBars ?? 0)));
    const hoBars = Math.max(0, Math.floor(Number(paramTest?.holdoutBars ?? 0)));
    const effRuns = Math.max(paramRuns, runsLen);
    const paramWhere =
      variant === "compact"
        ? "Interaktivní grafy a případný holdout najdeš v záložce „Analytics“."
        : "Grafy a holdout vyhodnocení jsou v sekci Param test níže.";
    return (
      <div
        className={`rounded-xl border border-emerald-700/45 bg-gradient-to-br from-emerald-950/25 via-zinc-950/45 to-zinc-950/55 shadow-lg shadow-black/20 ${pad}`}
        role="region"
        aria-label="Režim validace: param test"
      >
        <div className={`uppercase tracking-wider text-[10px] font-medium text-emerald-400/90 ${titleCls}`}>
          Validace · param test (OAT)
        </div>
        <p className={`mt-1.5 text-emerald-100/90 ${bodyCls}`}>
          <span className="text-white font-medium">KPI nahoře</span> = baseline s aktuálními PARAMS na{" "}
          <span className="text-zinc-200 font-medium">celém</span> úseku. Engine navíc spouští OAT sweep (jeden číselný parametr najednou).
          Ukazuje citlivost na parametry — <span className="text-zinc-300">nenahrazuje</span> plnohodnotný walk-forward, ale odhalí křehké
          optimum. {paramWhere}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone="neutral">Sweep běhů: {effRuns || "—"}</Chip>
          {paramKeys.length > 0 ? (
            <Chip tone="neutral">Parametry: {paramKeys.slice(0, 4).join(", ")}{paramKeys.length > 4 ? "…" : ""}</Chip>
          ) : null}
          {trainOnly ? (
            <Chip tone="warn">
              Train-only · IS {trBars}b · holdout {hoBars}b
            </Chip>
          ) : (
            <Chip tone="neutral">Sweep na celých datech (bez holdout splitu)</Chip>
          )}
        </div>
        {guardrailsNote(val)}
        {variant === "default" && methDesc ? (
          <p className="mt-2 text-[10px] text-zinc-500 leading-snug border-t border-zinc-800/80 pt-2">{methDesc}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-zinc-700/50 bg-zinc-950/40 ${pad}`}>
      <div className={`uppercase tracking-wider text-[10px] text-zinc-500 ${titleCls}`}>Validace</div>
      <p className={`mt-1 text-zinc-400 ${bodyCls}`}>Neznámý režim: {mode}</p>
    </div>
  );
}

function guardrailsNote(val: Record<string, unknown> | null): ReactNode {
  const g = val?.guardrails && typeof val.guardrails === "object" ? (val.guardrails as Record<string, unknown>) : null;
  const flags = g?.flags && typeof g.flags === "object" ? (g.flags as Record<string, unknown>) : null;
  const multi = flags?.paramTestMultipleComparisons === true;
  if (!multi) return null;
  return (
    <p className="mt-2 text-[10px] text-amber-200/90 leading-snug rounded-md border border-amber-600/25 bg-amber-950/20 px-2 py-1.5">
      Více bodů v parametrickém prostoru = vyšší riziko náhodného „nálezu“ — výsledky čti jako průzkum, ne jako finální důkaz edge.
    </p>
  );
}
