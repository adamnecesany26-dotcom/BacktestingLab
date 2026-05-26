"use client";

import type { WfStitchedPoint } from "@/lib/analytics/walkForwardAggregate";

function buildPath(ys: number[], w: number, h: number, pad: number): string {
  if (ys.length === 0) return "";
  let mn = Math.min(...ys);
  let mx = Math.max(...ys);
  const span = Math.max(mx - mn, 1e-6);
  mn -= span * 0.08;
  mx += span * 0.08;
  const span2 = mx - mn;
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  return ys
    .map((y, i) => {
      const t = ys.length === 1 ? 0.5 : i / (ys.length - 1);
      const x = pad + t * iw;
      const yy = pad + (1 - (y - mn) / span2) * ih;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${yy.toFixed(2)}`;
    })
    .join(" ");
}

function buildDdBandPath(ys: number[], w: number, h: number, pad: number): string {
  if (ys.length < 2) return "";
  let peak = ys[0]!;
  const peakYs = ys.map((y) => {
    peak = Math.max(peak, y);
    return peak;
  });
  let mn = Math.min(...ys, ...peakYs);
  let mx = Math.max(...ys, ...peakYs);
  const span = Math.max(mx - mn, 1e-6);
  mn -= span * 0.08;
  mx += span * 0.08;
  const span2 = mx - mn;
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  const toY = (v: number) => pad + (1 - (v - mn) / span2) * ih;

  const parts: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    const t = i / (ys.length - 1);
    const x = pad + t * iw;
    parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${toY(peakYs[i]!).toFixed(2)}`);
  }
  for (let i = ys.length - 1; i >= 0; i--) {
    const t = i / (ys.length - 1);
    const x = pad + t * iw;
    parts.push(`L ${x.toFixed(2)} ${toY(ys[i]!).toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

export function WalkForwardOosChart({
  stitched,
  foldStartIndices,
  ddTroughIndices,
  spikeIndices,
}: {
  stitched: WfStitchedPoint[];
  foldStartIndices: number[];
  ddTroughIndices: number[];
  spikeIndices: number[];
}) {
  const w = 720;
  const h = 200;
  const pad = 8;
  const ys = stitched.map((p) => p.y);
  const lineD = buildPath(ys, w, h, pad);
  const bandD = buildDdBandPath(ys, w, h, pad);

  const xAt = (i: number) => {
    const n = ys.length;
    const t = n <= 1 ? 0.5 : i / (n - 1);
    return pad + t * (w - 2 * pad);
  };

  const yAt = (yVal: number) => {
    if (!ys.length) return pad;
    let mn = Math.min(...ys);
    let mx = Math.max(...ys);
    const span = Math.max(mx - mn, 1e-6);
    mn -= span * 0.08;
    mx += span * 0.08;
    const span2 = mx - mn;
    const ih = h - 2 * pad;
    return pad + (1 - (yVal - mn) / span2) * ih;
  };

  if (stitched.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
        Pro skládanou OOS křivku chybí dostatek bodů ve sparkline (zkuste novější export / delší OOS okna).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">OOS equity (skládání segmentů)</div>
        <div className="flex flex-wrap gap-3 text-[10px] text-zinc-600">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400/90 align-middle mr-1" />
            křivka (normalizovaný index)
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-rose-500/35 align-middle mr-1" />
            drawdown od peaku v rámci křivky
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400/90 align-middle mr-1" />
            lokální dno DD
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-violet-400/90 align-middle mr-1" />
            skok / anomálie
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-[200px]"
        preserveAspectRatio="none"
        role="img"
        aria-label="OOS skládaná equity"
      >
        {foldStartIndices.slice(1).map((i) => (
          <line
            key={`v-${i}`}
            x1={xAt(i)}
            y1={2}
            x2={xAt(i)}
            y2={h - 2}
            stroke="rgba(113,113,122,0.2)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}
        {bandD ? <path d={bandD} fill="rgba(244,63,94,0.12)" stroke="none" /> : null}
        {lineD ? (
          <path d={lineD} fill="none" stroke="rgba(52,211,153,0.95)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : null}
        {ddTroughIndices.map((i) => (
          <circle key={`dd-${i}`} cx={xAt(i)} cy={yAt(ys[i]!)} r={3} fill="rgba(251,191,36,0.85)" />
        ))}
        {spikeIndices.map((i) => (
          <circle key={`sp-${i}`} cx={xAt(i)} cy={yAt(ys[i]!)} r={2.5} fill="rgba(167,139,250,0.95)" />
        ))}
      </svg>
      <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
        Křivka skládá pouze OOS části sparkline napříč foldy (multiplikatívě). Slouží k tvaru a drawdownům mezi segmenty —
        nenahrazuje plný equity graf z jednoho běhu na celých datech.
      </p>
    </div>
  );
}
