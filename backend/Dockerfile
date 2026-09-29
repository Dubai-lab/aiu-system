# Main backend (FastAPI) for Railway.
# Build context is the REPOSITORY ROOT (the assistant reads shared/pages.json),
# so Railway's backend service uses Root Directory "/" and this Dockerfile path.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY shared/ shared/
COPY backend/ backend/
WORKDIR /srv/backend

# Railway provides PORT. Listen on "::" so the service is reachable on Railway's
# network, and trust X-Forwarded-For from Railway's proxy so rate limits see the
# real client IP instead of the proxy's.
CMD ["sh", "-c", "uvicorn app.main:app --host :: --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
