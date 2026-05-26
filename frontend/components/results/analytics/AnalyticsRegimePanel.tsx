"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { RunResponse } from "@shared/types";

const REGIME_ORDER = ["up", "down", "range"] as const;
type RegimeCode = (typeof REGIME_ORDER)[number];

const REGIME_LABEL: Record<RegimeCode, string> = {
  up: "Uptrend",
  down: "Downtrend",
  range: "Range",
};

const REGIME_COLOR: Record<RegimeCode, string> = {
  up: "#22c55e",
  down: "#ef4444",
  range: "#f59e0b",
};

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span className="cursor-help text-zinc-500 hover:text-zinc-300 text-[11px] font-mono">ⓘ</span>
      <span className="pointer-events-none absolute left-0 bottom-full z-20 mb-1 hidden w-64 rounded-lg border border-zinc-600 bg-zinc-900 p-2 text-[11px] leading-snug text-zinc-200 shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export interface AnalyticsRegimePanelProps {
  results: RunResponse;
}

export function AnalyticsRegimePanel({ results }: AnalyticsRegimePanelProps) {
  const [Plot, setPlot] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("react-plotly.js")
      .then((mod) => {
        if (!cancelled) setPlot(() => mod.default);
      })
      .catch(() => {
        if (!cancelled) setPlot(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ra = results.regimeAnalysis && typeof results.regimeAnalysis === "object"
    ? (results.regimeAnalysis as Record<string, unknown>)
    : null;

  const byRegime = ra?.byRegime && typeof ra.byRegime === "object" ? (ra.byRegime as Record<string, Record<string, unknown>>) : null;
  const regimeShare = ra?.regimeShare && typeof ra.regimeShare === "object" ? (ra.regimeShare as Record<string, number>) : null;
  const current = typeof ra?.currentRegime === "string" ? ra.currentRegime : null;
  const explain = ra?.explain && typeof ra.explain === "object" ? (ra.explain as Record<string, string>) : null;
  const params = ra?.params && typeof ra.params === "object" ? (ra.params as Record<string, unknown>) : null;
  const timeline = Array.isArray(ra?.timelineSample) ? (ra.timelineSample as { date: string; regime: string }[]) : [];

  const cardData = useMemo(() => {
    if (!byRegime) return [];
    return REGIME_ORDER.map((k) => {
      const row = byRegime[k];
      if (!row || typeof row !== "object") return { key: k, label: REGIME_LABEL[k], empty: true as const };
      return {
        key: k,
        label: REGIME_LABEL[k],
        empty: false as const,
        trades: Number(row.trades ?? 0),
        winRate: Number(row.winRate ?? 0),
        totalPnl: Number(row.totalPnl ?? 0),
        maxDd: Number(row.maxDrawdownPct ?? 0),
        pf: row.profitFactor,
      };
    });
  }, [byRegime]);

  if (!ra || !byRegime) {
    return (
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-950/40 p-6 text-sm text-zinc-400">
        Pro tuto sekci nejsou k dispozici výstupy segmentace režimu. Zapni{" "}
        <span className="text-zinc-200">Per Regime</span> v nastavení Edge finding a spusť znovu backtest.
      </div>
    );
  }

  const currentLabel =
    current === "up" ? REGIME_LABEL.up : current === "down" ? REGIME_LABEL.down : current === "range" ? REGIME_LABEL.range : "—";

  const barPnL = {
    x: REGIME_ORDER.map((k) => REGIME_LABEL[k]),
    y: REGIME_ORDER.map((k) => Number((byRegime[k] as Record<string, unknown> | undefined)?.totalPnl ?? 0)),
    marker: { color: REGIME_ORDER.map((k) => REGIME_COLOR[k]) },
    type: "bar" as const,
    name: "Celkový PnL",
  };

  const barMeta = {
    x: REGIME_ORDER.map((k) => REGIME_LABEL[k]),
    y: REGIME_ORDER.map((k) => Number((byRegime[k] as Record<string, unknown> | undefined)?.winRate ?? 0)),
    marker: { color: REGIME_ORDER.map((k) => REGIME_COLOR[k]) },
    type: "bar" as const,
    name: "Win rate %",
  };

  const equityTraces = REGIME_ORDER.flatMap((k) => {
    const row = byRegime[k] as { equityCurve?: { date: string; value: number }[] } | undefined;
    const curve = Array.isArray(row?.equityCurve) ? row.equityCurve! : [];
    if (curve.length === 0) return [];
    return [
      {
        x: curve.map((_, i) => i),
        y: curve.map((p) => p.value),
        type: "scatter" as const,
        mode: "lines" as const,
        name: `${REGIME_LABEL[k]} (equity)`,
        line: { color: REGIME_COLOR[k], width: 2 },
      },
    ];
  });

  const segmented =
    regimeShare && REGIME_ORDER.some((k) => Number(regimeShare[k] ?? 0) > 0)
      ? REGIME_ORDER.map((k) => ({ k, pct: Math.max(0, Number(regimeShare[k] ?? 0) * 100) }))
      : timeline.length > 0
        ? (() => {
            const counts: Record<string, number> = { up: 0, down: 0, range: 0 };
            for (const p of timeline) {
              const r = String(p.regime || "").toLowerCase();
              if (r === "up" || r === "down" || r === "range") counts[r] += 1;
            }
            const t = counts.up + counts.down + counts.range || 1;
            return REGIME_ORDER.map((k) => ({ k, pct: (counts[k] / t) * 100 }));
          })()
        : [];

  return (
    <div className="flex flex-col gap-5 py-2">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Aktuální režim (poslední bar řady)</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                current === "up"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : current === "down"
                    ? "bg-red-500/20 text-red-300 border border-red-500/40"
                    : current === "range"
                      ? "bg-amber-500/15 text-amber-200 border border-amber-500/35"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-600"
              }`}
            >
              {currentLabel}
            </span>
            {params && (
              <span className="text-[11px] text-zinc-500">
                EMA {String(params.ema_fast ?? "?")}/{String(params.ema_slow ?? "?")} · ATR {String(params.atr_period ?? "?")}
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] text-zinc-500 max-w-md leading-relaxed">
          Segmentace je počítaná na <span className="text-zinc-300">stejném timeframe</span> jako vstupní data backtestu (ne
          samostatný vyšší TF).
          <InfoTip text="Uptrend / downtrend = pořadí EMA; range = současně úzký spread EMA vs. cena a potlačená relativní volatilita (ATR/close vůči mediánu řady)." />
        </div>
      </header>

      {segmented.length > 0 && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-950/30 p-4 space-y-2">
          <div className="text-xs font-medium text-zinc-300 flex items-center">
            Podíl času podle režimu (barů / odhad z výběru)
            <InfoTip text="Hodnoty vycházejí z regimeShare engine výstupu, nebo z výběrové časové osy timelineSample." />
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full border border-zinc-800">
            {segmented.map(({ k, pct }) =>
              pct > 0 ? (
                <div
                  key={k}
                  style={{ width: `${pct}%`, backgroundColor: REGIME_COLOR[k as RegimeCode] }}
                  title={`${REGIME_LABEL[k as RegimeCode]}: ${pct.toFixed(1)}%`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
            {REGIME_ORDER.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REGIME_COLOR[k] }} />
                {REGIME_LABEL[k]}
                {regimeShare?.[k] != null ? ` ${(Number(regimeShare[k]) * 100).toFixed(1)}%` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {explain && (
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["uptrendRule", "Uptrend"],
              ["downtrendRule", "Downtrend"],
              ["rangeRule", "Range / chop"],
            ] as const
          ).map(([ek, title]) =>
            explain[ek] ? (
              <div key={ek} className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-3 text-[11px] leading-relaxed text-zinc-400">
                <div className="text-zinc-200 text-xs font-medium mb-1">{title}</div>
                {explain[ek]}
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {cardData.map((c) => (
          <div
            key={c.key}
            className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4 space-y-2"
            style={{ borderColor: `${REGIME_COLOR[c.key]}40` }}
          >
            <div className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: REGIME_COLOR[c.key] }} />
              {c.label}
            </div>
            {"empty" in c && c.empty ? (
              <div className="text-sm text-zinc-500">Žádné obchody v tomto režimu.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-zinc-500">Obchody</div>
                    <div className="text-zinc-100 font-mono">{c.trades}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Win rate</div>
                    <div className="text-zinc-100 font-mono">{c.winRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">PnL</div>
                    <div className="text-zinc-100 font-mono">${c.totalPnl.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Max DD %</div>
                    <div className="text-zinc-100 font-mono">{c.maxDd.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500">
                  PF: <span className="text-zinc-300 font-mono">{String(c.pf ?? "—")}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {Plot && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2 space-y-3">
            <div>
              <div className="px-2 pt-2 text-xs font-medium text-zinc-300">Celkový PnL podle režimu</div>
              <Plot
                data={[barPnL]}
                layout={{
                  paper_bgcolor: "rgba(0,0,0,0)",
                  plot_bgcolor: "rgba(0,0,0,0)",
                  font: { color: "#a1a1aa", size: 11 },
                  margin: { t: 20, r: 12, b: 48, l: 48 },
                  xaxis: { tickangle: -15, gridcolor: "#27272a" },
                  yaxis: { title: "USD", gridcolor: "#27272a" },
                  showlegend: false,
                  height: 220,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <div className="px-2 text-xs font-medium text-zinc-300">Win rate % podle režimu</div>
              <Plot
                data={[barMeta]}
                layout={{
                  paper_bgcolor: "rgba(0,0,0,0)",
                  plot_bgcolor: "rgba(0,0,0,0)",
                  font: { color: "#a1a1aa", size: 11 },
                  margin: { t: 12, r: 12, b: 48, l: 48 },
                  xaxis: { tickangle: -15, gridcolor: "#27272a" },
                  yaxis: { title: "%", gridcolor: "#27272a" },
                  showlegend: false,
                  height: 220,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="px-2 pt-2 text-xs font-medium text-zinc-300">
              Kumulativní equity jen z obchodů v daném režimu (po čase vstupu)
            </div>
            {equityTraces.length > 0 ? (
              <Plot
                data={equityTraces}
                layout={{
                  paper_bgcolor: "rgba(0,0,0,0)",
                  plot_bgcolor: "rgba(0,0,0,0)",
                  font: { color: "#a1a1aa", size: 11 },
                  margin: { t: 28, r: 12, b: 40, l: 48 },
                  xaxis: { title: "Pořadí obchodu v režimu", gridcolor: "#27272a" },
                  yaxis: { title: "Equity", gridcolor: "#27272a" },
                  showlegend: true,
                  legend: { orientation: "h", y: -0.2 },
                  height: 360,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            ) : (
              <div className="p-6 text-sm text-zinc-500">Žádné equity křivky — v segmentech nejsou obchody.</div>
            )}
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 leading-relaxed text-center pt-2">
        Jedná se o doporučení na UI — layout a copy slouží jako produktová doporučení, ne závazná specifikace.
      </p>
    </div>
  );
}
