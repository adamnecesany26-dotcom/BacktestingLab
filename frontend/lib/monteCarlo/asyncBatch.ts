export async function yieldToMain(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export async function runBatched<T>(
  total: number,
  worker: (i: number) => T,
  onProgress: (done: number) => void,
  yieldEvery = 8,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < total; i++) {
    out.push(worker(i));
    if ((i + 1) % yieldEvery === 0 || i + 1 === total) {
      onProgress(i + 1);
      await yieldToMain();
    }
  }
  return out;
}
