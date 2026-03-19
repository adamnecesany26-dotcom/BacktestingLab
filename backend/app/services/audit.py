"""
Append-only audit event logger.
"""

from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any


def _audit_file_path() -> Path:
    backend_root = Path(__file__).resolve().parent.parent.parent
    project_root = backend_root.parent
    audit_dir = project_root / ".audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    return audit_dir / "events.jsonl"


def append_audit_event(
    *,
    action: str,
    actor_id: str,
    entity: str,
    entity_id: str | None = None,
    status: str = "ok",
    details: dict[str, Any] | None = None,
) -> None:
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "actorId": actor_id or "unknown",
        "entity": entity,
        "entityId": entity_id,
        "status": status,
        "details": details or {},
    }
    with _audit_file_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")

