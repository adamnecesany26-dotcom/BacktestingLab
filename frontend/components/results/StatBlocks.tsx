"use client";

import { useState } from "react";
import type { RunResponse } from "@shared/types";
import { formatProfitFactorDisplay } from "@/lib/formatProfitFactor";
import { summarizeTradeRMultiples } from "@/lib/tradeMetrics";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp } from "@/components/backtestFieldMeta";

interface StatBlocksProps {
  results: RunResponse | null;
  /** Souhrn přes celou dávku instrumentů (`batchSummary.aggregates`) */
  batchAggregates?: Record<string, unknown> | null;
}

const METH_TIPS: Partial<Record<string, string>> = {
  sharpeRatio:
    "Annualized Sharpe z equity k\u0159ivky. P\u0159edpoklady i.i.d. bar return\u016f \u010dasto neplat\u00ed u diskr\u00e9tn\u00edch/intradenn\u00edch strategi\u00ed. Hodnota z\u00e1vis\u00ed na frekvenci dat a d\u00e9lce vzorku \u2014 srovn\u00e1vej jen p\u0159i stejn\u00e9m TF a obdob\u00ed.",
  sortinoRatio:
    "Podobn\u011b jako Sharpe, ale penalizuje jen downside volatilitu. St\u00e1le z\u00e1vis\u00ed na frekvenci dat a d\u00e9lce vzorku.",
  profitFactor:
    "Hrub\u00fd zisk / hrub\u00e1 ztr\u00e1ta z uzav\u0159en\u00fdch obchod\u016f. Hodnota \u2265999 znamen\u00e1 sentinel \u201ebez ztr\u00e1tov\u00fdch obchod\u016f\u201c v tomto vzorku.",
  finalEquity:
    "Hodnota \u00fa\u010dtu na konci dle Backtrader brokeru. U futures s n\u00e1sobi\u010dem m\u016f\u017ee b\u00fdt po tot\u00e1ln\u00ed ztr\u00e1t\u011b i m\u00edrn\u011b z\u00e1porn\u00e1 \u2014 nen\u00ed to \u201echyba zobrazen\u00ed\u201c, ale model p\u00e1ky bez tvrd\u00e9ho margin callu.",
  maxDrawdown:
    "Max. propad od vrcholu equity (%). Bez d\u00e9lky a recovery je jen jedno \u010d\u00edslo \u2014 dv\u011b strategie se stejn\u00fdm DD mohou m\u00edt naprosto odli\u0161n\u00fd risk profil.",
  maxDrawdownDuration:
    "Nejdel\u0161\u00ed obdob\u00ed pod p\u0159edchoz\u00edm peakem (bary/dny). Kl\u00ed\u010dov\u00e9 pro psychologii, funding a likviditu \u2014 d\u00e9lka bolesti je stejn\u011b d\u016fle\u017eit\u00e1 jako hloubka.",
  timeToRecovery:
    "Bary/dny od nejhlub\u0161\u00edho propadu zp\u011bt na peak. Null = equity se dosud nezotavila. Kritick\u00e9 pro alokaci kapit\u00e1lu.",
  expectancyR:
    "Expectancy USD d\u011bleno pr\u016fm\u011brnou velikost\u00ed ztr\u00e1ty \u2014 hrub\u00fd \u201eR\u201c proxy; nen\u00ed to broker R-multiple bez definovan\u00e9ho risku na obchod.",
  pnlConcentration:
    "Kolik % celkov\u00e9ho zisku generuje top 5 obchod\u016f. Vysok\u00e1 koncentrace = edge z\u00e1vis\u00ed na p\u00e1r v\u00fdjime\u010dn\u00fdch vstupech, ne na systematick\u00e9m procesu.",
  payoffRatio:
    "AvgWin / AvgLoss \u2014 kolikr\u00e1t je pr\u016fm\u011brn\u00fd zisk v\u011bt\u0161\u00ed ne\u017e pr\u016fm\u011brn\u00e1 ztr\u00e1ta. PayoffRatio < 1 vy\u017eaduje win rate > 50% pro pozitivn\u00ed edge.",
  kellyFraction:
    "Kelly = WR - LR/PayoffRatio. Teoretick\u00fd optim\u00e1ln\u00ed pod\u00edl kapit\u00e1lu za p\u0159edpokladu i.i.d. Re\u00e1ln\u00fd sizing by m\u011bl b\u00fdt v\u00fdrazn\u011b men\u0161\u00ed (half-Kelly nebo m\u00e9n\u011b).",
};

function MethTip({ text }: { text: string }) {
  return (
    <span className="ml-0.5 text-zinc-500 cursor-help select-none" title={text}>
      &#9432;
    </span>
  );
}

type StatItem = { key: string; label: string; format: (v: number) => string; group: "pnl" | "risk" | "activity" };

const STAT_ITEMS: StatItem[] = [
  { key: "totalReturn", label: "Return %", format: (v) => `${v}%`, group: "pnl" },
  { key: "winRate", label: "Win Rate", format: (v) => `${v}%`, group: "pnl" },
  { key: "profitFactor", label: "Profit Factor", format: (v) => v.toFixed(2), group: "pnl" },
  { key: "expectancyUsd", label: "Expect. USD", format: (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, group: "pnl" },
  { key: "expectancyR", label: "Expect. R", format: (v) => v.toFixed(2), group: "pnl" },
  { key: "payoffRatio", label: "Payoff Ratio", format: (v) => v.toFixed(2), group: "pnl" },
  { key: "kellyFraction", label: "Kelly %", format: (v) => `${(v * 100).toFixed(1)}%`, group: "pnl" },
  { key: "finalEquity", label: "Final Equity", format: (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2 }), group: "pnl" },
  { key: "totalReturnUsd", label: "Return USD", format: (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, group: "pnl" },
  { key: "sharpeRatio", label: "Sharpe", format: (v) => v.toFixed(2), group: "risk" },
  { key: "sortinoRatio", label: "Sortino", format: (v) => v.toFixed(2), group: "risk" },
  { key: "maxDrawdown", label: "Max DD %", format: (v) => `${v.toFixed(2)}%`, group: "risk" },
  { key: "maxDrawdownDuration", label: "DD Duration", format: () => "", group: "risk" },
  { key: "timeToRecovery", label: "Recovery", format: () => "", group: "risk" },
  { key: "pnlConcentration", label: "Top 5 PnL %", format: () => "", group: "risk" },
  { key: "tradeCount", label: "Trades", format: (v) => String(v), group: "activity" },
  { key: "longShort", label: "L / S", format: () => "", group: "activity" },
];

const GROUP_LABELS: Record<string, string> = { pnl: "PnL", risk: "Risk", activity: "Activity" };

function formatAggNum(v: unknown, digits = 2): string {
  if (v == null || Number.isNaN(Number(v))) return "\u2014";
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDuration(bars: number | null | undefined, days: number | null | undefined): string {
  if (bars == null && days == null) return "\u2014";
  const parts: string[] = [];
  if (bars != null) parts.push(`${bars} bars`);
  if (days != null) parts.push(`${days.toFixed(0)}d`);
  return parts.join(" / ") || "\u2014";
}

export function StatBlocks({ results, batchAggregates }: StatBlocksProps) {
  const [showTips, setShowTips] = useState(false);

  if (!results) return null;

  const m = results.metrics as unknown as Record<string, unknown>;
  const mc = results.monteCarlo && typeof results.monteCarlo === "object" ? (results.monteCarlo as Record<string, unknown>) : null;
  const ror = mc != null ? Number(mc.riskOfRuin ?? NaN) : NaN;
  const mcMode = mc != null ? String(mc.mode ?? "n/a") : "";
  const mcMethod = mc != null ? String(mc.method ?? "") : "";
  const mcNote = mc != null && typeof mc.note === "string" ? mc.note : "";

  const pnlDist = results.tradePnlDistribution && typeof results.tradePnlDistribution === "object"
    ? (results.tradePnlDistribution as Record<string, unknown>)
    : null;
  const concentration = pnlDist?.concentration && typeof pnlDist.concentration === "object"
    ? (pnlDist.concentration as Record<string, unknown>)
    : null;
  const top5Pct = concentration != null ? Number(concentration.top5PnlPct ?? NaN) : NaN;

  const tradeRSummary = summarizeTradeRMultiples(results.trades ?? []);

  const agg = batchAggregates && typeof batchAggregates === "object" ? batchAggregates : null;
  const aggItems: { label: string; value: string }[] = agg
    ? [
        { label: "Run\u016f v d\u00e1vce", value: String(agg.runCount ?? "\u2014") },
        { label: "Obchod\u016f celkem", value: String(agg.totalTrades ?? "\u2014") },
        { label: "\u03a3 return USD", value: agg.sumTotalReturnUsd != null ? `$${formatAggNum(agg.sumTotalReturnUsd)}` : "\u2014" },
        { label: "\u00d8 return USD / run", value: agg.meanTotalReturnUsd != null ? `$${formatAggNum(agg.meanTotalReturnUsd)}` : "\u2014" },
        { label: "\u00d8 profit factor", value: formatAggNum(agg.meanProfitFactor, 4) },
        { label: "\u00d8 win rate %", value: agg.meanWinRate != null ? `${formatAggNum(agg.meanWinRate)}%` : "\u2014" },
        { label: "\u00d8 max DD %", value: agg.meanMaxDrawdownPct != null ? `${formatAggNum(agg.meanMaxDrawdownPct)}%` : "\u2014" },
      ]
    : [];

  const resolveValue = (key: string, format: (v: number) => string): string => {
    if (key === "longShort") return `${m.longCount ?? 0} / ${m.shortCount ?? 0}`;
    if (key === "profitFactor")
      return formatProfitFactorDisplay(m[key], typeof m.profitFactorStatus === "string" ? m.profitFactorStatus : undefined);
    if (key === "maxDrawdownDuration")
      return formatDuration(m.maxDrawdownDurationBars as number | null, m.maxDrawdownDurationDays as number | null);
    if (key === "timeToRecovery") {
      const rBars = m.timeToRecoveryBars;
      return rBars == null ? "\u26a0 not recovered" : formatDuration(rBars as number, m.timeToRecoveryDays as number | null);
    }
    if (key === "pnlConcentration") return Number.isFinite(top5Pct) ? `${top5Pct.toFixed(1)}%` : "\u2014";
    if (key === "payoffRatio" || key === "kellyFraction") {
      const raw = m[key];
      if (raw == null) return "\u2014";
      const numV = Number(raw);
      return Number.isFinite(numV) ? format(numV) : "\u2014";
    }
    let v = m[key] as number | undefined;
    if (key === "maxDrawdown") {
      v = (m.maxDrawdownPct as number | undefined) ?? v;
    }
    return v != null ? format(v) : "\u2014";
  };

  const alertBorderFor = (key: string): string => {
    if (key === "timeToRecovery" && m.timeToRecoveryBars == null)
      return "border border-rose-600/50 bg-rose-950/20";
    if (key === "pnlConcentration" && Number.isFinite(top5Pct) && top5Pct > 70)
      return "border border-amber-600/50 bg-amber-950/20";
    if (key === "tradeCount" && Number(m.tradeCount ?? 0) > 0 && Number(m.tradeCount ?? 0) < 30)
      return "border border-amber-600/40 bg-amber-950/15";
    if (key === "maxDrawdownDuration") {
      const ddBars = Number(m.maxDrawdownDurationBars ?? 0);
      if (ddBars > 500) return "border border-rose-600/50 bg-rose-950/20";
      if (ddBars > 200) return "border border-amber-600/40 bg-amber-950/15";
    }
    return "";
  };

  const groups: ("pnl" | "risk" | "activity")[] = ["pnl", "risk", "activity"];

  const validationMode = String(results.validation?.mode ?? "single");
  const showFullSampleScopeNote =
    validationMode === "oos_split" || validationMode === "walk_forward";

  return (
    <div className="space-y-3">
      {showFullSampleScopeNote && (
        <div
          className="rounded-xl border border-amber-800/40 bg-amber-950/25 px-3 py-2.5 text-[11px] text-amber-100/90 leading-snug shadow-md shadow-black/10"
          title="viz manifest.primaryMetricsSource a methodology.primaryRunScope"
        >
          <span className="font-medium text-amber-200">Hlavní čísla (equity, obchody): </span>
          vždy z <span className="text-amber-100">jednoho</span> plného backtestu na <span className="text-amber-100">celých</span> datech.
          OOS / walk-forward přidává jen dodatečné lehké běhy v záložce Analytics (foldy) — proto se shodují se single runem.
        </div>
      )}
      {aggItems.length > 0 && (
        <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-sky-400/90 mb-2">Souhrn d\u00e1vky (v\u0161echny instrumenty)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {aggItems.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-md bg-zinc-900/80 border border-zinc-700/40 px-2 py-1.5 min-h-[48px] flex flex-col justify-between"
              >
                <span className="text-[10px] text-zinc-500 uppercase leading-tight">{label}</span>
                <span className="font-mono text-xs text-sky-100 truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          {aggItems.length > 0 ? "Vybran\u00fd instrument" : "Metriky runu"}
        </span>
        <button
          type="button"
          onClick={() => setShowTips((p) => !p)}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {showTips ? "Skr\u00fdt metodiku" : "Metodika \u24d8"}
        </button>
      </div>
      {groups.map((g) => {
        const items = STAT_ITEMS.filter((s) => s.group === g);
        return (
          <div key={g}>
            <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1 px-0.5">{GROUP_LABELS[g]}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
              {items.map(({ key, label, format }) => {
                const value = resolveValue(key, format);
                const alert = alertBorderFor(key);
                const tip = showTips ? METH_TIPS[key] : undefined;
                const mutedUsd =
                  key === "finalEquity" || key === "totalReturnUsd" ? "opacity-90 ring-1 ring-zinc-700/35" : "";
                return (
                  <div
                    key={key}
                    className={`rounded-xl px-2.5 py-2 min-w-0 min-h-[58px] flex flex-col justify-between shadow-sm shadow-black/10 ${alert || "bg-zinc-800/85 border border-zinc-700/50"} ${mutedUsd}`}
                  >
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider truncate flex items-center gap-0.5">
                      {label}
                      {tip ? <MethTip text={tip} /> : null}
                    </span>
                    <span className="font-mono text-[15px] text-zinc-100 truncate">{value}</span>
                    {key === "kellyFraction" && value !== "\u2014" ? (
                      <span className="text-[9px] text-zinc-600 block leading-tight mt-0.5">half-Kelly max</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {tradeRSummary != null && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1 px-0.5 flex items-center gap-1">
            R-multiple (obchody)
            <FieldHelpPopover help={backtestFieldHelp.resultsRMultipleStats} />
            {showTips ? (
              <MethTip text="Z uzavřených obchodů, kde jde z zoneMeta odvodit vstup a stop: R = PnL / (|entry\u2212stop|\u00d7|size|). Chybí-li stop v metadatech, obchod se do statistiky nepočítá." />
            ) : null}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
            {[
              { label: "Počet R", value: `${tradeRSummary.count} / ${results.trades?.length ?? 0}` },
              { label: "Pr\u016fm\u011br R", value: tradeRSummary.mean.toFixed(2) },
              { label: "Medi\u00e1n R", value: tradeRSummary.median.toFixed(2) },
              { label: "5\u201395 %", value: `${tradeRSummary.p5.toFixed(2)} \u2026 ${tradeRSummary.p95.toFixed(2)}` },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-xl px-2.5 py-2 min-w-0 min-h-[58px] flex flex-col justify-between shadow-sm shadow-black/10 bg-emerald-950/25 border border-emerald-800/40"
              >
                <span className="text-[10px] text-emerald-600/90 uppercase tracking-wider truncate">{label}</span>
                <span className="font-mono text-[15px] text-emerald-100/95 truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {mc != null && Number.isFinite(ror) && (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2 text-xs text-zinc-400 space-y-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
            <span className="text-zinc-500 uppercase tracking-wider">Monte Carlo</span>
            <span>
              Risk of ruin (est.): <span className="text-zinc-200 font-mono">{ror.toFixed(4)}</span>
            </span>
            <span>
              Mode: <span className="text-zinc-200 font-mono">{mcMode}</span>
            </span>
            {mcMethod && (
              <span>
                Method: <span className="text-zinc-200 font-mono">{mcMethod}</span>
              </span>
            )}
          </div>
          <div className="text-zinc-500 leading-relaxed">
            {mcNote || "Bootstrap odhad z resampled PnL uzav\u0159en\u00fdch obchod\u016f \u2014 ne pravd\u011bpodobnost z tr\u017en\u00edho modelu."}
            {showTips && <MethTip text="riskOfRuin je pod\u00edl simulac\u00ed, kde max DD % p\u0159ekro\u010dil pr\u00e1h. Jde o resampling stress test, ne kalibrovan\u00fd tail odhad. V\u017edy \u010dt\u011bte method/mode/note v JSON." />}
          </div>
        </div>
      )}
    </div>
  );
}
