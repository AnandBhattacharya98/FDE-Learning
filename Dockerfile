# API image for Render (or any Docker host). Build from the repo root:
#   docker build -t fde-learning-api .
#   docker run -p 8000:8000 --env-file backend/.env fde-learning-api
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY content content

RUN useradd --create-home appuser && chown -R appuser /app/backend
USER appuser

WORKDIR /app/backend
ENV CONTENT_DIR=/app/content \
    PORT=8000
EXPOSE 8000

# Render sets $PORT; default to 8000 elsewhere.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
