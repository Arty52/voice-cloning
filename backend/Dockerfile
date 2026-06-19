FROM python:3.14.2-slim

ARG INSTALL_SAMPLE_PROCESSING=0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/app/storage/model-cache

WORKDIR /app

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/src /app/backend/src

RUN if [ "$INSTALL_SAMPLE_PROCESSING" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi

RUN python -m pip install --no-cache-dir --upgrade pip \
    && if [ "$INSTALL_SAMPLE_PROCESSING" = "1" ]; then \
      python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchaudio torchcodec \
      && python -m pip install --no-cache-dir -e "/app/backend[sample-processing]"; \
    else \
      python -m pip install --no-cache-dir -e /app/backend; \
    fi

COPY assets /app/assets

EXPOSE 6420

CMD ["uvicorn", "voice_cloning.api:app", "--host", "0.0.0.0", "--port", "6420"]
