# -*- coding: utf-8 -*-
"""
Zástupný modul pro zpětnou kompatibilitu importů (`examples.swing_hl_detector`).

Jediný zdroj implementace: ``strategies/sd_zone_strategy/modules/Swing_HL.py``.
Upravuj vždy tam; tento soubor jen přenačte ten modul pod jménem tohoto balíčku.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_CANONICAL = (
    Path(__file__).resolve().parent.parent
    / "strategies"
    / "sd_zone_strategy"
    / "modules"
    / "Swing_HL.py"
)
if not _CANONICAL.is_file():
    raise ImportError(f"Swing HL canonical module not found: {_CANONICAL}")

_spec = importlib.util.spec_from_file_location(__name__, _CANONICAL)
if _spec is None or _spec.loader is None:
    raise ImportError(f"Cannot load spec for {_CANONICAL}")
_impl = importlib.util.module_from_spec(_spec)
sys.modules[__name__] = _impl
_spec.loader.exec_module(_impl)
