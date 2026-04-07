import type { NextRequest } from "next/server";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

/**
 * Transparentní proxy na FastAPI s pravým streamingem (SSE pro /api/run?stream=1).
 *
 * next.config `rewrites()` bufferuje tělo odpovědi — UI pak nevidí progress až do konce běhu.
 * Tento route handler předává ReadableStream z backendu beze změny.
 *
 * POST tělo se načte do paměti a přepošle jako buffer — bez `duplex: "half"` (na Windows/Node
 * často padá `fetch` a klient vidí 502).
 *
 * Node `fetch` (Undici) má výchozí **headersTimeout 300 s**: synchronní `/api/artifacts/build`
 * neposílá hlavičky, dokud neskončí — po ~5 min spadne spojení → 502. Pro dlouhé cesty proto
 * používáme vlastní Agent s `headersTimeout` / `bodyTimeout` (viz BACKEND_PROXY_FETCH_TIMEOUT_MS).
 * Výchozí čekání doladí `DEFAULT_LONG_FETCH_MS`; `export const maxDuration` musí být dost dlouhé,
 * jinak Next route uřízne dřív (typicky ~15 min při maxDuration = 900).
 */
const BACKEND = (process.env.BACKEND_PROXY_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

/** Výchozí čekání na artifacts/build (AbortSignal + Undici); drž v souladu s maxDuration. */
const DEFAULT_LONG_FETCH_MS = 48 * 60 * 60 * 1000;

/**
 * Next.js (a Vercel) omezují dobu běhu route handleru v sekundách.
 * Nastav ≥ než BACKEND_PROXY_FETCH_TIMEOUT_MS / 1000. Na Vercelu platí strop plánu.
 */
export const maxDuration = 48 * 60 * 60;

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function targetUrl(pathSegments: string[], request: NextRequest): string {
  const sub = pathSegments.join("/");
  const q = new URL(request.url).search;
  return `${BACKEND}/api/${sub}${q}`;
}

function isLongBackendPath(pathSegments: string[]): boolean {
  const sub = pathSegments.join("/");
  return (
    sub === "artifacts/build" ||
    sub.startsWith("artifacts/build/") ||
    sub === "run" ||
    sub.startsWith("run/")
  );
}

/** AbortSignal.timeout — celkový limit požadavku. */
function proxyFetchTimeoutMs(pathSegments: string[]): number {
  const raw = process.env.BACKEND_PROXY_FETCH_TIMEOUT_MS;
  if (raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return n === 0 ? 0 : n;
    }
  }
  return isLongBackendPath(pathSegments) ? DEFAULT_LONG_FETCH_MS : 0;
}

/**
 * Undici čeká na hlavičky a tělo v samostatných timerech; musí být ≥ doba běhu na FastAPI.
 * U dlouhých cest vždy nastavíme Agent (i když AbortSignal vypneš env na 0).
 */
function undiciSocketTimeoutMs(pathSegments: string[], abortMs: number): number {
  if (!isLongBackendPath(pathSegments)) {
    return abortMs > 0 ? abortMs : 0;
  }
  return abortMs > 0 ? abortMs : DEFAULT_LONG_FETCH_MS;
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const target = targetUrl(pathSegments, request);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const init: UndiciRequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    const buf = await request.arrayBuffer();
    headers.delete("content-length");
    if (buf.byteLength > 0) {
      init.body = buf;
    }
  }

  const timeoutMs = proxyFetchTimeoutMs(pathSegments);
  if (timeoutMs > 0) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }

  const socketMs = undiciSocketTimeoutMs(pathSegments, timeoutMs);
  if (socketMs > 0) {
    init.dispatcher = new Agent({
      headersTimeout: socketMs,
      bodyTimeout: socketMs,
      connectTimeout: 120_000,
    });
  }

  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(target, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint =
      timeoutMs > 0 && /aborted|timeout/i.test(msg)
        ? ` Vypršel čas (${Math.round(timeoutMs / 60000)} min). Zvyš BACKEND_PROXY_FETCH_TIMEOUT_MS nebo spusť build přímo proti backendu (NEXT_PUBLIC_API_URL=http://127.0.0.1:8000).`
        : "";
    const body = JSON.stringify({
      detail: `Next proxy nemohl kontaktovat FastAPI na ${BACKEND} (${msg}).${hint} Spusť backend: uvicorn z backend/ na :8000.`,
    });
    return new Response(body, {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  const outHeaders = new Headers();
  res.headers.forEach((value, key) => {
    outHeaders.append(key, value);
  });
  outHeaders.set("X-Accel-Buffering", "no");
  const ct = res.headers.get("content-type") || ""; 
  if (ct.includes("text/event-stream")) {
    outHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    outHeaders.set("Pragma", "no-cache");
  }

  return new Response(res.body as unknown as BodyInit, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

type RouteCtx = { params: { path: string[] } };

export async function GET(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function POST(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function OPTIONS(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}
