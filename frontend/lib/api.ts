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
    const d = parsed.detail;
    if (typeof d === "string" && d.trim()) return d;
    if (Array.isArray(d) && d.length > 0) {
      const parts = d.map((x: unknown) => {
        if (x && typeof x === "object" && "msg" in x && typeof (x as { msg: unknown }).msg === "string") {
          return (x as { msg: string }).msg;
        }
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      });
      return parts.join("; ");
    }
    const message =
      typeof parsed.message === "string" ? parsed.message : "";
    if (message) return message;
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
  if (status === 502) {
    return `HTTP ${status} na ${endpoint}: backend nedostupný (proxy). ${normalized || "Spusť uvicorn na :8000."}`;
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

/** Volby pro POST /api/view — fáze 5 (artefakty místo přepočtu modulů). */
export type ViewDataOptions = {
  useArtifacts?: boolean;
  /** Default true. False = jen S/D zóny z artefaktu (bez swingů/BOS/trend z H/L cache). */
  artifactIncludeHl?: boolean;
  artifactIncludeSd?: boolean;
  artifactDatasetId?: string | null;
};

export type ViewDataResponse = {
  ohlc: OhlcBar[];
  markers: { date: string; type: string; value: number | null; bar_index?: number | string }[];
  lines: ViewLine[];
  zones?: ViewZone[];
  artifact_status?: string;
  artifact_banner?: string | null;
  dataset_id?: string | null;
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
  window?: ViewDataWindow | null,
  options?: ViewDataOptions | null
): Promise<ViewDataResponse> {
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
  if (options?.useArtifacts) body.use_artifacts = true;
  if (options?.artifactIncludeHl === false) body.artifact_include_hl = false;
  if (options?.artifactIncludeSd === false) body.artifact_include_sd = false;
  if (options?.artifactDatasetId && String(options.artifactDatasetId).trim()) {
    body.artifact_dataset_id = String(options.artifactDatasetId).trim();
  }
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
  return res.json() as Promise<ViewDataResponse>;
}

/** Stav .backtest_artifacts pro data_file + years (fáze 6). */
export type ArtifactLayerStatus = {
  state: string;
  detail?: string | null;
};

export type ArtifactStatusResponse = {
  ok: boolean;
  error?: string | null;
  dataset_id?: string | null;
  data_fingerprint?: string | null;
  hl?: ArtifactLayerStatus;
  sd?: ArtifactLayerStatus;
  overall?: string;
  overall_label?: string;
};

export async function getArtifactStatus(
  dataFile: string,
  years: number,
  window?: ViewDataWindow | null
): Promise<ArtifactStatusResponse> {
  const headers = await getApiHeaders(true);
  const body: Record<string, unknown> = {
    data_file: dataFile,
    years,
  };
  if (window?.startIso) body.start_iso = window.startIso;
  if (window?.endIso) body.end_iso = window.endIso;
  const res = await fetch(`${API_BASE}/api/artifacts/status`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/artifacts/status"));
  }
  return res.json() as Promise<ArtifactStatusResponse>;
}

export type ArtifactBuildRequest = {
  years: number;
  startIso?: string | null;
  endIso?: string | null;
  zoneTimeframes?: string[];
  /** Podmnožina TF pro H/L + S/D build; vynecháno nebo prázdné = celý žebříček na serveru. */
  precomputeTimeframes?: string[];
  hlParams?: Record<string, number | boolean | string> | null;
  sdParams?: Record<string, number | boolean | string> | null;
  skipHl?: boolean;
  skipSd?: boolean;
};

export type ArtifactBuildResult = {
  ok: boolean;
  dataset_id?: string | null;
  hl?: unknown;
  sd?: unknown;
  status?: ArtifactStatusResponse;
  overall_label?: string;
};

/** SSE event z ``POST /api/artifacts/build?stream=1``. */
export type ArtifactBuildStreamEvent =
  | { type: "phase"; phase: string; message?: string; pct?: number }
  | { type: "result"; data: ArtifactBuildResult }
  | { type: "error"; message: string };

const ARTIFACT_BUILD_STREAM_CLIENT_MS = 48 * 60 * 60 * 1000;

function artifactBuildRequestBody(dataFile: string, req: ArtifactBuildRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    data_file: dataFile,
    years: req.years,
    skip_hl: !!req.skipHl,
    skip_sd: !!req.skipSd,
  };
  if (req.startIso) body.start_iso = req.startIso;
  if (req.endIso) body.end_iso = req.endIso;
  if (req.zoneTimeframes?.length) body.zone_timeframes = req.zoneTimeframes;
  if (req.precomputeTimeframes?.length) body.precompute_timeframes = req.precomputeTimeframes;
  if (req.hlParams) body.hl_params = req.hlParams;
  if (req.sdParams) body.sd_params = req.sdParams;
  return body;
}

export async function buildArtifacts(dataFile: string, req: ArtifactBuildRequest): Promise<ArtifactBuildResult> {
  const headers = await getApiHeaders(true);
  const body = artifactBuildRequestBody(dataFile, req);
  const res = await fetch(`${API_BASE}/api/artifacts/build`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/artifacts/build"));
  }
  return res.json() as Promise<ArtifactBuildResult>;
}

/**
 * Dlouhý build s průběhem (SSE). První bajty přijdou hned — vhodné přes Next proxy.
 */
export async function buildArtifactsStreaming(
  dataFile: string,
  req: ArtifactBuildRequest,
  onEvent: (ev: ArtifactBuildStreamEvent) => void
): Promise<ArtifactBuildResult> {
  const headers = await getApiHeaders(true);
  const body = artifactBuildRequestBody(dataFile, req);
  const res = await fetch(`${API_BASE}/api/artifacts/build?stream=1`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ARTIFACT_BUILD_STREAM_CLIENT_MS),
  });
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(formatApiError(res.status, message, "/api/artifacts/build?stream=1"));
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: ArtifactBuildResult | null = null;

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
          const ev = JSON.parse(line.slice(6)) as ArtifactBuildStreamEvent;
          onEvent(ev);
          if (ev.type === "result") result = ev.data;
          if (ev.type === "error") throw new Error(ev.message || "Chyba artifact build");
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(`Backend poslal nevalidní SSE: ${line.slice(0, 180)}`);
          }
          throw e;
        }
      }
    }
  }

  if (!result) throw new Error("Artifact build nedokončil odpověď — zkontroluj backend log.");
  return result;
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
