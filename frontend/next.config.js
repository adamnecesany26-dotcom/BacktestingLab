/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Dev / single-host: browser calls same origin `/api/*` → proxied to FastAPI.
   * Fixes Windows issues where `localhost` in JS resolves to IPv6 (::1) but uvicorn listens on IPv4 only.
   * Override target: BACKEND_PROXY_URL=http://host:8000
   */
  async rewrites() {
    const backend = (process.env.BACKEND_PROXY_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

module.exports = nextConfig;
