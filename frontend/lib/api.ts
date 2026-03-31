/**
 * API client for backend communication.
 */

import type { RunRequest, RunResponse, OhlcBar, Trade } from "@shared/types";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * API base URL.
 * - If `NEXT_PUBLIC_API_URL` is set (non-empty): direct calls (production / custom).
 * - If unset in the browser: `""` → same-origin `/api/...` přes `app/api/[...path]/route.ts` (streaming SSE na FastAPI; nepoužívat samotné next rewrites).
 * - SSR / Node fallback: explicit IPv4 avoids `localhost` → ::1 mismatches with uvicorn.
 */
function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw !== undefined && String(raw).trim() !== "") {
    return String(raw).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return "";
  }
  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBase();
const API_AUTH_KEY = process.env.NEXT_PUBLIC_API_AUTH_KEY ?? "";

function apiBaseLabel(): string {
  return API_BASE === "" ? "(stejný origin → Next proxy na 127.0.0.1:8000)" : API_BASE;
}

async function readApiErrorMessage(res: Response): Promise<string> {
  const raw = await res.text();
  if (!raw) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    const detail = typeof parsed.detail === "string" ? parsed.detail : typeof parsed.message === "string" ? parsed.message : "";
    if (detail) return detail;
  } catch {
    // fall back to raw text
  }
  return raw;
}

function formatApiError(status: number, message: string, endpoint: string): string {
  const normalized = (message || "").trim();
  if (status === 401) {
    return `HTTP 401 na ${endpoint}: backend vyžaduje API auth. Zkontrolujte backend \`API_AUTH_KEY\` a frontend \`NEXT_PUBLIC_API_AUTH_KEY\`.`;
  }
  if (status === 429) {
    return `HTTP 429 na ${endpoint}: překročen rate limit backendu.`;
  }
  return normalized ? `HTTP ${status} na ${endpoint}: ${normalized}` : `HTTP ${status} na ${endpoint}`;
}

async function getApiHeaders(contentTypeJson: boolean = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (contentTypeJson) headers["Content-Type"] = "application/json";
  if (API_AUTH_KEY) headers["X-API-Key"] = API_AUTH_KEY;
  try {
    const uid = getFirebaseAuth().currentUser?.uid;
    if (uid) headers["X-Actor-Id"] = uid;
  } catch {
    // ignore
  }
  return headers;
}

export type StreamEvent =
  | { type: "log"; line: string; stream?: string }
  | { type: "progress"; value: number }
  | { type: "result"; data: RunResponse }
  | { type: "error"; message: string };

export async function runBacktest(request: RunRequest): Promise<RunResponse> {
  const headers = await getApiHeaders(true);
  const res = await fetch(`${API_BASE}/api/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/run"));
  }
  return res.json();
}

export async function runBacktestStreaming(
  request: RunRequest,
  signal: AbortSignal,
  onEvent: (ev: StreamEvent) => void
): Promise<RunResponse> {
  const headers = await getApiHeaders(true);
  const res = await fetch(`${API_BASE}/api/run?stream=1`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/run?stream=1"));
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
          if (e instanceof SyntaxError) {
            throw new Error(`Backend poslal nevalidní SSE event: ${line.slice(0, 180)}`);
          }
          throw e;
        }
      }
    }
  }

  if (!result) throw new Error("Backtest nedokončil - zkontrolujte backend logy a závislosti (pip install -r backend/requirements.txt)");
  return result;
}

export async function getAvailableData(): Promise<{
  instruments: import("@shared/types").DataInstrument[];
}> {
  const res = await fetch(`${API_BASE}/api/data`, { headers: await getApiHeaders(false) });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/data"));
  }
  return res.json();
}

/** Bod čáry; volitelně state/score z trendu Swing HL / HL_identificator */
export interface ViewLinePoint {
  date: string;
  value: number;
  state?: string;
  score?: number;
}

/** Řada bodů pro běžné indikátorové čáry (ne režimový histogram) */
export interface ViewLineSeries {
  name: string;
  data: ViewLinePoint[];
  color?: string;
}

/** HMM / režim — spodní histogram ve StrategyViewChart (barva = dominantní stav) */
export interface ViewRegimeHistogramLine {
  name: string;
  regime_histogram: true;
  data: { date: string; trend: number; chop: number; high_vol: number }[];
}

export type ViewLine = ViewLineSeries | ViewRegimeHistogramLine;

export function isViewRegimeHistogramLine(line: ViewLine): line is ViewRegimeHistogramLine {
  return "regime_histogram" in line && line.regime_histogram === true;
}

/** Inducement point (pasivní likvidita) */
export interface ViewInducement {
  date: string;
  value: number;
  type: string;
  /** Bar index pro přesné umístění na grafu (intraday data) */
  index?: number;
}

/** Zone/box for View chart */
export interface ViewZone {
  date_start: string;
  date_end: string;
  value_low: number;
  value_high: number;
  fillcolor?: string;
  name?: string;
  base_length?: number;
  impulse_score?: number;
  touches?: number;
  strength?: number;
  has_touch?: boolean;
  touch_bar_index?: number;
  touch_marker_price?: number;
  touch_date?: string;
  active_demand_zones_below?: number;
  inducements?: ViewInducement[];
  inducement_count?: number;
  inducement_points?: number;
  /** Gap přímo u zóny (mezi pivotem a následující svíčkou) */
  has_gap?: boolean;
  gap_type?: "up" | "down";
  gap_date?: string;
  gap_value_low?: number;
  gap_value_high?: number;
}

/** Fetch OHLC + optional module markers/lines/zones for View chart. */
export type ViewDataWindow = {
  startIso?: string | null;
  endIso?: string | null;
};

export async function getViewData(
  dataFile: string,
  years: number,
  moduleCode?: string | null,
  params?: Record<string, number | boolean | string> | null,
  moduleDependencies?: Record<string, string> | null,
  /** native = source bar size; else backend resamples OHLC (1m…1Mo) before module + chart */
  chartTimeframe?: string | null,
  /** Optional ISO slice after years cutoff — module runs on sliced OHLC */
  window?: ViewDataWindow | null
): Promise<{
  ohlc: OhlcBar[];
  markers: { date: string; type: string; value: number }[];
  lines: ViewLine[];
  zones?: ViewZone[];
}> {
  const headers = await getApiHeaders(true);
  const body: Record<string, unknown> = {
    data_file: dataFile,
    years,
    module_code: moduleCode || null,
    params: params || null,
    module_dependencies: moduleDependencies || null,
    chart_timeframe:
      chartTimeframe && chartTimeframe !== "native" ? chartTimeframe : null,
  };
  if (window?.startIso) body.start_iso = window.startIso;
  if (window?.endIso) body.end_iso = window.endIso;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/view`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const isNetwork =
      err instanceof TypeError &&
      (String((err as Error).message).toLowerCase().includes("fetch") ||
        String((err as Error).message).toLowerCase().includes("network"));
    if (isNetwork) {
      throw new Error(
        `Nelze se spojit s API ${apiBaseLabel()} — zkontrolujte běh uvicorn na :8000, restart ` +
          `frontendu po změně next.config (proxy). Pokud máte v .env NEXT_PUBLIC_API_URL=http://localhost:8000, zkuste řádek smazat ` +
          `(proxy přes :3000) nebo použít http://127.0.0.1:8000. LAN/CORS: CORS_ALLOW_LAN_3000 v backend/.env.`
      );
    }
    throw err;
  }
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/view"));
  }
  return res.json();
}

/** Fetch mplfinance chart PNG from backend. */
export async function getChartImage(ohlc: OhlcBar[], trades: Trade[]): Promise<Blob> {
  const headers = await getApiHeaders(true);
  const res = await fetch(`${API_BASE}/api/chart`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ohlc, trades }),
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/chart"));
  }
  return res.blob();
}
