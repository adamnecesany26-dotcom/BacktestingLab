"use client";

/** Mean score vs discrete param value — from engine `paramSensitivity`. */

export function SweepSensitivityPlots({ data }: { data: Record<string, Array<{ value: number; meanScore: number; n: number }>> }) {
  const keys = Object.keys(data).filter((k) => Array.isArray(data[k]) && data[k]!.length >= 2);
  if (keys.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700/60 bg-zinc-950/40 px-4 py-5 text-xs text-zinc-500">
        Citlivost parametrů není k dispozici (potřebuje novější engine s <code className="text-zinc-400">paramSensitivity</code>).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-zinc-200">Citlivost — průměrné skóre vs parametr</h4>
      <p className="text-[10px] text-zinc-500 -mt-2 max-w-3xl leading-relaxed">
        Hladký trend naznačuje smysluplný vztah; „hřeben“ z náhodného šumu často znamená slabý signál. Hodnoty se agregují přes všechny
        dokončené běhy sweepu (ne jen export tabulky).
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {keys.map((param) => {
          const series = data[param]!;
          const vals = series.map((p) => p.value);
          const scores = series.map((p) => p.meanScore);
          const minV = Math.min(...vals);
          const maxV = Math.max(...vals);
          const minS = Math.min(...scores);
          const maxS = Math.max(...scores);
          const dV = maxV - minV || 1;
          const dS = maxS - minS || 1;
          const w = 320;
          const h = 120;
          const pad = 24;
          const pts = series
            .map((p, i) => {
              const x = pad + ((p.value - minV) / dV) * (w - 2 * pad);
              const y = pad + (1 - (p.meanScore - minS) / dS) * (h - 2 * pad);
              return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(" ");
          return (
            <div key={param} className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <div className="text-[11px] font-mono text-cyan-200/90 mb-1">{param}</div>
              <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[120px]" preserveAspectRatio="none">
                <path d={pts} fill="none" stroke="rgba(52,211,153,0.85)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                {series.map((p, i) => {
                  const x = pad + ((p.value - minV) / dV) * (w - 2 * pad);
                  const y = pad + (1 - (p.meanScore - minS) / dS) * (h - 2 * pad);
                  const nr = Math.min(10, 4 + Math.sqrt(p.n));
                  return <circle key={i} cx={x} cy={y} r={nr} fill="rgba(6,182,212,0.35)" stroke="rgba(6,182,212,0.8)" strokeWidth={0.5} />;
                })}
              </svg>
              <div className="text-[9px] text-zinc-600 mt-1 font-mono">
                body: váha ~√n · rozsah skóre {minS.toFixed(3)} … {maxS.toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
