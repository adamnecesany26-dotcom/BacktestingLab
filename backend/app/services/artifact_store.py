"""
Úložiště precomputovaných artefaktů (fáze 1).

Kořen: ``<repo>/.backtest_artifacts/{dataset_id}/hl|sd/v{schema}/...``

Dataset ID je stabilní hash z (relativní data_file, fingerprint, years, volitelné ISO okno).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

# Bump při breaking změně manifestu nebo struktury složek.
ARTIFACT_SCHEMA_VERSION = 1

DEFAULT_ARTIFACTS_DIRNAME = ".backtest_artifacts"


def repo_root() -> Path:
    """Kořen repozitáře Backtesting_app (nad backend/)."""
    return Path(__file__).resolve().parent.parent.parent.parent


def artifacts_root(base: Path | None = None) -> Path:
    root = (base or repo_root()).resolve()
    return root / DEFAULT_ARTIFACTS_DIRNAME


def normalize_dataset_relative_path(data_file: str) -> str:
    return str(data_file or "").replace("\\", "/").lstrip("/")


def compute_dataset_id(
    data_file: str,
    fingerprint: str,
    years: float | None = None,
    start_iso: str | None = None,
    end_iso: str | None = None,
) -> str:
    """
    Krátký stabilní ID složky. Stejné vstupy → stejné ID.
    ``years`` None nebo 0 = celá načtená série (stejná konvence jako view engine).
    """
    rel = normalize_dataset_relative_path(data_file)
    fp = (fingerprint or "").strip()
    yr = "full" if years is None or float(years) <= 0 else f"{float(years):.12g}"
    s0 = (start_iso or "").strip()
    s1 = (end_iso or "").strip()
    payload = f"{rel}\x00{fp}\x00{yr}\x00{s0}\x00{s1}".encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()[:20]


def dataset_dir(base: Path | None, dataset_id: str) -> Path:
    return artifacts_root(base) / dataset_id


def hl_version_dir(base: Path | None, dataset_id: str, schema_version: int | None = None) -> Path:
    ver = ARTIFACT_SCHEMA_VERSION if schema_version is None else int(schema_version)
    return dataset_dir(base, dataset_id) / "hl" / f"v{ver}"


def sd_version_dir(base: Path | None, dataset_id: str, schema_version: int | None = None) -> Path:
    ver = ARTIFACT_SCHEMA_VERSION if schema_version is None else int(schema_version)
    return dataset_dir(base, dataset_id) / "sd" / f"v{ver}"


def hl_manifest_path(base: Path | None, dataset_id: str, schema_version: int | None = None) -> Path:
    return hl_version_dir(base, dataset_id, schema_version) / "manifest.json"


def sd_manifest_path(base: Path | None, dataset_id: str, schema_version: int | None = None) -> Path:
    return sd_version_dir(base, dataset_id, schema_version) / "manifest.json"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_atomic_json(path: Path, data: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def read_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def build_hl_manifest_skeleton(
    *,
    dataset_id: str,
    data_file: str,
    data_fingerprint: str,
    time_range_start: str | None,
    time_range_end: str | None,
    years: float | None,
    hl_module_digest: str,
    params_snapshot: dict[str, Any] | None,
    tf_ladder: list[str],
) -> dict[str, Any]:
    return {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "kind": "hl",
        "dataset_id": dataset_id,
        "data_file": normalize_dataset_relative_path(data_file),
        "host_dataset_fingerprint": (data_fingerprint or "").strip(),
        "time_range_start": time_range_start,
        "time_range_end": time_range_end,
        "years": years,
        "hl_module_digest": hl_module_digest,
        "sd_module_digest": None,
        "params_snapshot": dict(params_snapshot or {}),
        "tf_ladder": list(tf_ladder),
        "artifacts": {},
        "created_at_utc": None,
    }


def build_sd_manifest_skeleton(
    *,
    dataset_id: str,
    data_file: str,
    data_fingerprint: str,
    time_range_start: str | None,
    time_range_end: str | None,
    years: float | None,
    hl_module_digest: str,
    sd_module_digest: str,
    params_snapshot: dict[str, Any] | None,
    hl_manifest_path_rel: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "kind": "sd",
        "dataset_id": dataset_id,
        "data_file": normalize_dataset_relative_path(data_file),
        "host_dataset_fingerprint": (data_fingerprint or "").strip(),
        "time_range_start": time_range_start,
        "time_range_end": time_range_end,
        "years": years,
        "hl_module_digest": hl_module_digest,
        "sd_module_digest": sd_module_digest,
        "params_snapshot": dict(params_snapshot or {}),
        "hl_manifest_path_rel": hl_manifest_path_rel,
        "artifacts": {},
        "created_at_utc": None,
    }


def manifest_is_stale_fingerprint(manifest: dict[str, Any] | None, current_fingerprint: str) -> bool:
    if not manifest:
        return True
    old = str(manifest.get("host_dataset_fingerprint") or "").strip()
    return old != (current_fingerprint or "").strip()


def manifest_is_stale_module_digest(
    manifest: dict[str, Any] | None,
    *,
    kind: str,
    current_digest: str,
) -> bool:
    if not manifest:
        return True
    key = "hl_module_digest" if kind == "hl" else "sd_module_digest"
    old = str(manifest.get(key) or "").strip()
    return old != (current_digest or "").strip()


def _pid_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _lock_ttl_seconds() -> float:
    """
    Max age of a lock file before we consider it stale.
    Default is conservative: builds can run for many hours (UI allows up to 48h).
    """
    raw = os.environ.get("ARTIFACT_LOCK_TTL_SEC")
    if raw is None or str(raw).strip() == "":
        return float(72 * 3600)  # 72h
    try:
        v = float(raw)
    except ValueError:
        return float(72 * 3600)
    return float(max(300.0, v))


def _read_lock_file(lock_path: Path) -> tuple[int | None, float | None]:
    """Return (pid, created_at_epoch_seconds)."""
    try:
        raw = lock_path.read_text(encoding="utf-8", errors="replace")
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        pid = int(lines[0]) if len(lines) >= 1 else None
        ts = float(lines[1]) if len(lines) >= 2 else None
        return pid, ts
    except Exception:
        return None, None


def _clear_legacy_lock_dir(lock_path: Path) -> None:
    """Starý formát: prázdný adresář *.lock — po pádu procesu zůstal a blokoval další build."""
    try:
        if lock_path.is_dir():
            try:
                lock_path.rmdir()
            except OSError:
                shutil.rmtree(lock_path, ignore_errors=True)
    except OSError:
        pass


def acquire_lock(lock_path: Path) -> bool:
    """
    Exkluzivní zámek souboru (O_CREAT|O_EXCL). Po pádu backendu lze zámek získat znovu,
    pokud PID v souboru už neběží. Staré zámky jako prázdný adresář se smažou.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    _clear_legacy_lock_dir(lock_path)

    def _try_create() -> bool:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, f"{os.getpid()!s}\n{time.time()!s}\n".encode("ascii"))
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            return False

    if _try_create():
        return True

    pid, created_at = _read_lock_file(lock_path)
    ttl = _lock_ttl_seconds()
    now = time.time()
    age = (now - float(created_at)) if created_at is not None else None
    # If the lock is very old, prefer reclaiming it even if PID-check is unreliable on this OS.
    if age is not None and age > ttl:
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass
        return _try_create()
    if pid is not None and not _pid_exists(pid):
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass
        return _try_create()

    return False


def release_lock(lock_path: Path) -> None:
    try:
        if lock_path.is_file():
            lock_path.unlink(missing_ok=True)
        elif lock_path.is_dir():
            try:
                lock_path.rmdir()
            except OSError:
                shutil.rmtree(lock_path, ignore_errors=True)
    except OSError:
        pass
