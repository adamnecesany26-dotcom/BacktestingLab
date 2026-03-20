"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunResponse } from "@shared/types";

const STORAGE_KEY = "backtest_quality_gate_expanded";

type GateCheck = {
  metric?: string;
  value?: number;
  threshold?: number;
  mode?: string;
  passed?: boolean;
};

const METRIC_LABELS: Record<string, string> = {
  tradeCount: "Min. počet obchodů",
  maxDrawdownPct: "Max drawdown %",
  profitFactor: "Profit factor",
  sortinoRatio: "Sortino",
  oosAvgDegradation: "OOS degradace (průměr)",
};

function formatCheckLine(c: GateCheck): string {
  const name = METRIC_LABELS[String(c.metric)] ?? String(c.metric ?? "?");
  const val = typeof c.value === "number" ? c.value : NaN;
  const thr = typeof c.threshold === "number" ? c.threshold : NaN;
  const mode = String(c.mode ?? "");
  const vStr = Number.isFinite(val) ? (name.includes("%") ? `${val.toFixed(2)} %` : val.toFixed(4)) : "—";
  const tStr = Number.isFinite(thr) ? (name.includes("%") ? `${thr.toFixed(2)} %` : thr.toFixed(4)) : "—";
  if (mode === "min") {
    return `${name}: ${vStr} (požadováno ≥ ${tStr})`;
  }
  if (mode === "max") {
    return `${name}: ${vStr} (požadováno ≤ ${tStr})`;
  }
  return `${name}: ${vStr} vs ${tStr}`;
}

interface QualityGateBannerProps {
  qualityGate: RunResponse["qualityGate"];
}

/** Upozornění: brány se vyhodnocují až po celém běhu — neomezují průběh simulace. Lze sbalit. */
export function QualityGateBanner({ qualityGate }: QualityGateBannerProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY);
      if (v === "0") setExpanded(false);
      if (v === "1") setExpanded(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setExpanded((e) => {
      const next = !e;
      try {
        sessionStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (!qualityGate || typeof qualityGate !== "object") return null;

  const passed = qualityGate.passed === true;
  const failed = qualityGate.passed === false;
  if (!passed && !failed) return null;

  const checksRaw = qualityGate.checks;
  const checks = Array.isArray(checksRaw)
    ? (checksRaw as unknown[]).filter((x): x is GateCheck => x != null && typeof x === "object")
    : [];

  return (
    <div
      className={`rounded-lg border text-sm ${
        passed
          ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-100"
          : "border-amber-700/70 bg-amber-950/35 text-amber-100"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-zinc-700/40">
        <div className="font-semibold flex flex-wrap items-center gap-2">
          <span>Quality gate</span>
          <span
            className={`text-xs uppercase tracking-wider px-2 py-0.5 rounded ${
              passed ? "bg-emerald-800/80 text-emerald-200" : "bg-amber-800/80 text-amber-200"
            }`}
          >
            {passed ? "PASS" : "FAIL"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="text-xs px-2 py-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-600"
        >
          {expanded ? "Skrýt" : "Zobrazit"}
        </button>
      </div>

      {expanded && (
        <div className="px-4 py-3">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Max DD a ostatní brány se kontrolují <strong className="text-zinc-300">až po dokončení</strong> celého
            backtestu — simulace tedy může skončit s hlubším propadem než je tvůj práh; gate jen označí, že výsledek
            prahy nesplňuje. U futures / násobiče může být konečné equity i{" "}
            <strong className="text-zinc-300">záporné</strong> a drawdown i přes{" "}
            <strong className="text-zinc-300">100 %</strong> od vrcholu.
          </p>
          {checks.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs font-mono text-zinc-300">
              {checks.map((c, i) => {
                const ok = c.passed === true;
                return (
                  <li key={i} className="flex gap-2">
                    <span className={ok ? "text-emerald-400" : "text-red-400"}>{ok ? "✓" : "✗"}</span>
                    <span>{formatCheckLine(c)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
