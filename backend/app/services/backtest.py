"""
Backtest service - controls backtest logic.
Used by engine.py inside Docker; this module documents the interface.
"""

# This module is primarily used inside the Docker container (engine.py).
# The runner service invokes Docker, which runs engine.py.
# Backtest logic lives in backend/docker/engine.py
