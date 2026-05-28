FROM python:3.14.2-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/src /app/backend/src

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -e /app/backend

COPY assets /app/assets

EXPOSE 6420

CMD ["uvicorn", "voice_cloning.api:app", "--host", "0.0.0.0", "--port", "6420"]
