# -*- coding: utf-8 -*-
# FIRESTORE_SYNC — strategies/sd_zone_strategy/modules/S_D_Zones.py — modul (shim) — vložit do Firestore nebo použít examples/sd_zones.py jako plnou kopii do Modulů → main.py.
"""
S/D zones module — re-exports canonical implementation from examples.sd_zones.

Single source of truth: `examples/sd_zones.py`. Update that file; this shim only
ensures the packaged strategy module stays in sync with examples / Firestore copies.
"""

from __future__ import annotations

import sys
from pathlib import Path

_repo_root = Path(__file__).resolve().parents[3]
_rp = str(_repo_root)
if _rp not in sys.path:
    sys.path.insert(0, _rp)

from examples.sd_zones import detect, get_line, get_zones  # noqa: E402

__all__ = ["detect", "get_line", "get_zones"]
