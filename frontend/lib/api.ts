/**
 * API client for backend communication.
 */

import type { RunRequest, RunResponse } from "@shared/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type StreamEvent =
  | { type: "log"; line: string; stream?: string }
  | { type: "progress"; value: number }
  | { type: "result"; data: RunResponse }
  | { type: "error"; message: string };

export async function runBacktest(request: RunRequest): Promise<RunResponse> {
  const res = await fetch(`${API_BASE}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function runBacktestStreaming(
  request: RunRequest,
  signal: AbortSignal,
  onEvent: (ev: StreamEvent) => void
): Promise<RunResponse> {
  const res = await fetch(`${API_BASE}/api/run?stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text ? `${res.status}: ${text}` : `HTTP ${res.status} - backend neodpovídá`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: RunResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const block of events) {
      const line = block.split("\n")[0];
      if (line?.startsWith("data: ")) {
        try {
          const ev = JSON.parse(line.slice(6)) as StreamEvent;
          onEvent(ev);
          if (ev.type === "result") result = ev.data;
          if (ev.type === "error") throw new Error(ev.message || "Chyba engine");
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  if (!result) throw new Error("Backtest nedokončil - zkontrolujte Docker a backend logy");
  return result;
}

export async function getAvailableData(): Promise<{
  instruments: import("@shared/types").DataInstrument[];
}> {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
