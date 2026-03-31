/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * API proxy: `app/api/[...path]/route.ts` (streamuje SSE pro backtest).
   * Nepoužívat rewrite na `/api/*` — Náv Next.js bufferuje tělo a progress bar v UI nefunguje.
   * Cíl backendu: BACKEND_PROXY_URL (výchozí http://127.0.0.1:8000).
   */
};

module.exports = nextConfig;
