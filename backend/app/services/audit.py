"""
Append-only audit event logger.

Common `action` values (convention):
- run.request / run.complete / run.stream — single backtest lifecycle
- run.batch — parameter matrix / batch runs (details: plannedRuns, completedRuns)
- governance.change — (optional) server-side governance mutations
- export.bundle — (optional) reproducibility bundle downloads via API proxy
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
    try:
        with _audit_file_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass

