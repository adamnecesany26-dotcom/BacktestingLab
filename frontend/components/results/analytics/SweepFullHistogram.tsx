"use client";

/** Full-sample histogram from engine `robustness.histograms` + percentile guides. */

export function SweepFullHistogram({
  hist,
  percentiles,
  title,
  unitHint,
}: {
  hist: { low: number; high: number; nbin: number; counts: number[] } | null | undefined;
  percentiles: { p10: number; p50: number; p90: number } | null | undefined;
  title: string;
  unitHint: string;
}) {
  const counts = hist?.counts && Array.isArray(hist.counts) ? hist.counts.map((c) => Number(c) || 0) : [];
  if (!hist || counts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700/70 bg-zinc-950/40 px-4 py-6 text-center text-xs text-zinc-500">
        Histogram není k dispozici (starší engine bez <code className="text-zinc-400">histograms</code>).
      </div>
    );
  }

  const lo = Number(hist.low);
  const hi = Number(hist.high);
  const span = Math.max(hi - lo, 1e-12);
  const maxC = Math.max(1, ...counts);
  const w = 640;
  const h = 140;
  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const bw = (w - padL - padR) / counts.length;

  const xForValue = (v: number) => {
    if (!Number.isFinite(v)) return null;
    const t = (v - lo) / span;
    if (t < 0 || t > 1) return null;
    return padL + t * (w - padL - padR);
  };

  const pctLines = percentiles
    ? [
        { v: percentiles.p10, col: "rgba(161,161,170,0.9)", lab: "p10" },
        { v: percentiles.p50, col: "rgba(34,211,238,0.95)", lab: "p50" },
        { v: percentiles.p90, col: "rgba(161,161,170,0.9)", lab: "p90" },
      ]
    : [];

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-200">{title}</h4>
          <p className="text-[10px] text-zinc-500 mt-0.5 max-w-xl">{unitHint}</p>
        </div>
        <div className="text-[10px] text-zinc-600 font-mono">
          min {lo.toFixed(4)} → max {hi.toFixed(4)}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[140px]" preserveAspectRatio="none" role="img">
        {counts.map((c, i) => {
          const bh = ((h - padT - padB) * c) / maxC;
          const x = padL + i * bw;
          const y = padT + (h - padT - padB - bh);
          return <rect key={i} x={x} y={y} width={Math.max(1, bw - 1)} height={Math.max(0, bh)} fill="rgba(6,182,212,0.55)" rx={1} />;
        })}
        {pctLines.map((p) => {
          const x = xForValue(p.v);
          if (x == null) return null;
          return (
            <g key={p.lab}>
              <line x1={x} y1={padT} x2={x} y2={h - padB} stroke={p.col} strokeWidth={1} strokeDasharray="4 3" />
              <text x={x} y={h - 4} textAnchor="middle" fill={p.col} fontSize={9} fontFamily="monospace">
                {p.lab}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
