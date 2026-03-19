"""
FastAPI entry point for the backtesting platform API.
Handles CORS, routes, and startup/shutdown events.
"""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import run, data, chart, view
from app.security import require_api_access

app = FastAPI(
    title="Backtesting Platform API",
    description="API for running trading strategy backtests",
    version="0.1.0",
)

# CORS - allow frontend (Next.js dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
