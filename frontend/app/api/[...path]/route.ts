import type { NextRequest } from "next/server";

/**
 * Transparentní proxy na FastAPI s pravým streamingem (SSE pro /api/run?stream=1).
 *
 * next.config `rewrites()` bufferuje tělo odpovědi — UI pak nevidí progress až do konce běhu.
 * Tento route handler předává ReadableStream z backendu beze změny.
 */
const BACKEND = (process.env.BACKEND_PROXY_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function targetUrl(pathSegments: string[], request: NextRequest): string {
  const sub = pathSegments.join("/");
  const q = new URL(request.url).search;
  return `${BACKEND}/api/${sub}${q}`;
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const target = targetUrl(pathSegments, request);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  const res = await fetch(target, init);
  const outHeaders = new Headers(res.headers);
  outHeaders.set("X-Accel-Buffering", "no");

  return new Response(res.body, {
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
