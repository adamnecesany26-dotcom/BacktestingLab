# Optional legacy image — NOT required for local runs (runner: host subprocess or in-process).
# Engine scripts run on the host by default; see README in this folder.
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Engine script (runs inside container)
COPY engine.py .
COPY view_engine.py .

RUN useradd -m -u 10001 appuser
USER appuser

# Strategy is mounted at /app/strategy
# Data is mounted at /app/data (read-only)
ENV STRATEGY_PATH=/app/strategy/strategy.py
ENV DATA_PATH=/app/data

CMD ["python", "engine.py"]
