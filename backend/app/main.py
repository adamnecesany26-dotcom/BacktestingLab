"""
FastAPI entry point for the backtesting platform API.
Handles CORS, routes, and startup/shutdown events.
"""

import os
import re

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import run, data, chart, view, artifacts
from app.security import require_api_access

app = FastAPI(
    title="Backtesting Platform API",
    description="API for running trading strategy backtests",
    version="0.1.0",
)


def _cors_allow_origins() -> list[str]:
    """Next.js dev on localhost; extend via CORS_EXTRA_ORIGINS (comma-separated)."""
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
    ]
    extra = os.environ.get("CORS_EXTRA_ORIGINS", "")
    if extra.strip():
        origins.extend(p.strip() for p in extra.split(",") if p.strip())
    seen: set[str] = set()
    out: list[str] = []
    for o in origins:
        if o not in seen:
            seen.add(o)
            out.append(o)
    return out


def _cors_allow_origin_regex() -> str | None:
    """
    Optional regex (Starlette CORS). Set CORS_ALLOW_ORIGIN_REGEX explicitly, or
    CORS_ALLOW_LAN_3000=1 for ^http://<host>:3000$ (LAN IP / hostname on port 3000).
    """
    raw = os.environ.get("CORS_ALLOW_ORIGIN_REGEX", "").strip()
    if raw:
        # Light validation so a typo doesn't break startup
        re.compile(raw)
        return raw
    if os.environ.get("CORS_ALLOW_LAN_3000", "").strip().lower() in {"1", "true", "yes", "on"}:
        # Hostname or IPv4; [::1] covered in _cors_allow_origins
        return r"^http://[A-Za-z0-9.\-]+:3000$"
    return None


# CORS — if the browser shows only "Failed to fetch", Origin is often blocked (e.g. http://192.168.x.x:3000).
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_origin_regex=_cors_allow_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


# Include API routes
app.include_router(run.router, prefix="/api", tags=["run"], dependencies=[Depends(require_api_access)])
app.include_router(data.router, prefix="/api", tags=["data"], dependencies=[Depends(require_api_access)])
app.include_router(chart.router, prefix="/api", tags=["chart"], dependencies=[Depends(require_api_access)])
app.include_router(view.router, prefix="/api", tags=["view"], dependencies=[Depends(require_api_access)])
app.include_router(artifacts.router, prefix="/api", tags=["artifacts"], dependencies=[Depends(require_api_access)])
