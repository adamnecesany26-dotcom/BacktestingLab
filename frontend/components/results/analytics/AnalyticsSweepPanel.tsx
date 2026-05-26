"use client";

import type { RunResponse } from "@shared/types";
import { RobustnessSweepSection } from "@/components/results/RobustnessSweepSection";

export function AnalyticsSweepPanel({ results }: { results: RunResponse }) {
  const tested = Math.max(0, Math.floor(Number((results.robustness as Record<string, unknown> | undefined)?.tested ?? 0)));
  const mode = String((results.robustness as Record<string, unknown> | undefined)?.mode ?? "");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 px-4 py-3 text-sm text-zinc-300">
        <h2 className="text-base font-semibold text-zinc-100">Parametrický sweep</h2>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed max-w-3xl">
          Tato záložka je určena pro běhy s <strong>robustnostním hledáním</strong> (grid / náhodné PARAMS). Počet
          zkoušek a rozptyl top skóre říká, jestli je „edge“ široký nebo jestli držíte se na jedné křehké kombinaci.
          {tested > 0 ? (
            <>
              {" "}
              V tomto výsledku: <span className="text-cyan-200 font-mono">{tested}</span> dokončených kombinací
              {mode ? (
                <>
                  , režim <span className="font-mono text-zinc-400">{mode}</span>
                </>
              ) : null}
              .
            </>
          ) : (
            <> V odpovědi zatím nejsou data sweepu — zapni sweep v Edge finding nebo očekávej pole{" "}
              <code className="text-zinc-500">robustness</code>.</>
          )}
        </p>
      </section>
      <RobustnessSweepSection robustness={results.robustness as Record<string, unknown> | undefined} runId={results.runId} />
    </div>
  );
}
