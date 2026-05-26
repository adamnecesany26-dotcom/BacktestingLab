export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    const t = a;
    const x = Math.imul(t ^ (t >>> 15), t | 1);
    const y = x ^ (x + Math.imul(x ^ (x >>> 7), x | 61));
    return ((y ^ (y >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleIndices(n: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}
