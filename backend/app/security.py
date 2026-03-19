"""
Security utilities for API access control and rate limiting.
"""

from __future__ import annotations

import os
import time
import re
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass
class RequestIdentity:
    actor_id: str
    auth_method: str
    client_key: str


class InMemoryRateLimiter:
    """Simple fixed-window in-memory limiter suitable for single-process deployments."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.time()
        q = self._events[key]
        cutoff = now - self.window_seconds
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= self.max_requests:
            return False
        q.append(now)
        return True


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_expected_api_key() -> str | None:
    api_key = os.environ.get("API_AUTH_KEY")
    if api_key and api_key.strip():
        return api_key.strip()
    return None


_RATE_LIMIT_MAX = max(1, int(float(os.environ.get("API_RATE_LIMIT_MAX_REQUESTS", "120"))))
_RATE_LIMIT_WINDOW = max(1, int(float(os.environ.get("API_RATE_LIMIT_WINDOW_SEC", "60"))))
_RATE_LIMITER = InMemoryRateLimiter(_RATE_LIMIT_MAX, _RATE_LIMIT_WINDOW)
_ACTOR_ID_RE = re.compile(r"[^A-Za-z0-9._:@-]+")


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0].strip().lower(), parts[1].strip()
    if scheme != "bearer" or not token:
        return None
    return token


def _sanitize_actor_id(raw: str, fallback: str) -> str:
    cleaned = _ACTOR_ID_RE.sub("_", str(raw or "").strip())[:64].strip("._:-")
    return cleaned or fallback


def _is_local_client(client_ip: str) -> bool:
    return client_ip in {"127.0.0.1", "::1", "localhost"}


def _resolve_identity(request: Request) -> RequestIdentity:
    expected_api_key = _resolve_expected_api_key()
    actor_header = request.headers.get("X-Actor-Id", "").strip()
    client_ip = request.client.host if request.client else "unknown"

    bearer = _extract_bearer_token(request)
    x_api_key = request.headers.get("X-API-Key", "").strip()

    auth_required = _parse_bool_env("API_AUTH_REQUIRED", True)
    allow_dev_bypass = _parse_bool_env("API_ALLOW_DEV_BYPASS", False)

    if expected_api_key and (x_api_key == expected_api_key or bearer == expected_api_key):
        actor_id = _sanitize_actor_id(actor_header, "api_key_actor")
        return RequestIdentity(actor_id=actor_id, auth_method="api_key", client_key=f"{client_ip}:{actor_id}")

    if bearer and not expected_api_key:
        actor_id = _sanitize_actor_id(actor_header, "bearer_actor")
        return RequestIdentity(actor_id=actor_id, auth_method="bearer", client_key=f"{client_ip}:{actor_id}")

    if auth_required and not expected_api_key and _is_local_client(client_ip):
        actor_id = _sanitize_actor_id(actor_header, "local_dev")
        return RequestIdentity(actor_id=actor_id, auth_method="local_dev_auto", client_key=f"{client_ip}:{actor_id}")

    if auth_required and not allow_dev_bypass:
        detail = (
            "Unauthorized: missing or invalid API credentials. "
            "Provide X-API-Key/Bearer matching API_AUTH_KEY, or set NEXT_PUBLIC_API_AUTH_KEY for the frontend."
            if expected_api_key
            else "Unauthorized: API auth is enabled but API_AUTH_KEY is not configured on the backend."
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )

    actor_id = _sanitize_actor_id(actor_header, "dev_unauthenticated")
    return RequestIdentity(actor_id=actor_id, auth_method="dev_bypass", client_key=f"{client_ip}:{actor_id}")


async def require_api_access(request: Request) -> RequestIdentity:
    identity = _resolve_identity(request)

    if not _RATE_LIMITER.allow(identity.client_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please retry later.",
        )

    request.state.actor_id = identity.actor_id
    request.state.auth_method = identity.auth_method
    return identity

