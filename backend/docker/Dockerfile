# Backtest engine - runs strategies in isolated sandbox
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Engine script (runs inside container)
COPY engine.py .

# Strategy is mounted at /app/strategy
# Data is mounted at /app/data (read-only)
ENV STRATEGY_PATH=/app/strategy/strategy.py
ENV DATA_PATH=/app/data

CMD ["python", "engine.py"]
