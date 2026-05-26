"use client";

import type { SweepRunRow } from "@/components/results/sweepRunTypes";

/** Random / exploration view: scatter of first two numeric params, color = score. */

export function SweepScatterPanel({
  rows,
  xKey,
  yKey,
}: {
  rows: SweepRunRow[];
  xKey: string;
  yKey: string;
}) {
  const pts: { x: number; y: number; s: number; pnl: number }[] = [];
  for (const r of rows) {
    const p = r.params;
    if (!p || !(xKey in p) || !(yKey in p)) continue;
    const xv = Number(p[xKey]);
    const yv = Number(p[yKey]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    const s = Number(r.scoreRawHoldoutOrFull);
    const pnl = Number((r.metrics ?? {}).totalReturnUsd);
    pts.push({ x: xv, y: yv, s: Number.isFinite(s) ? s : 0, pnl: Number.isFinite(pnl) ? pnl : 0 });
  }

  if (pts.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700/60 px-4 py-6 text-xs text-zinc-500 text-center">
        Málo bodů pro scatter ({pts.length}).
      </div>
    );
  }

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const sc = pts.map((p) => p.s);
  const minS = Math.min(...sc);
  const maxS = Math.max(...sc);
  const sSpan = maxS - minS || 1;

  const w = 640;
  const h = 220;
  const pad = 28;

  const proj = (x: number, y: number) => ({
    px: pad + ((x - minX) / sx) * (w - 2 * pad),
    py: pad + (1 - (y - minY) / sy) * (h - 2 * pad),
  });

  const colorFor = (score: number) => {
    const t = (score - minS) / sSpan;
    const r = Math.round(80 + 120 * (1 - t));
    const g = Math.round(40 + 180 * t);
    const b = Math.round(100 + 80 * t);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
      <h4 className="text-sm font-semibold text-zinc-200 mb-1">Scatter ({xKey} × {yKey})</h4>
      <p className="text-[10px] text-zinc-500 mb-2">
        Barva = skóre (engine ranking). Vhodné pro náhodný sweep — hledej shluky bodů, ne izolovaný pixel.
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[220px]" role="img">
        <rect x={0} y={0} width={w} height={h} fill="rgba(24,24,27,0.5)" rx={6} />
        {pts.map((p, i) => {
          const { px, py } = proj(p.x, p.y);
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r={4}
              fill={colorFor(p.s)}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={0.5}
            >
              <title>{`${xKey}=${p.x}, ${yKey}=${p.y}\nscore=${p.s.toFixed(4)}\nP/L=${p.pnl.toFixed(2)}`}</title>
            </circle>
          );
        })}
        <text x={pad} y={h - 6} fill="#71717a" fontSize={9} fontFamily="monospace">
          {xKey}: {minX.toFixed(4)}
        </text>
        <text x={w - pad} y={h - 6} textAnchor="end" fill="#71717a" fontSize={9} fontFamily="monospace">
          {maxX.toFixed(4)}
        </text>
      </svg>
    </div>
  );
}
