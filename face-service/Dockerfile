# Face service (InsightFace buffalo_l on ONNX Runtime, CPU) for Railway.
# Build context is this folder (Railway Root Directory "/face-service").
# It is reached only over Railway's private network - give it NO public domain.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp: OpenMP runtime used by ONNX Runtime; libglib: needed by OpenCV.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Download the buffalo_l models (~300 MB) at build time, so each start is fast
# and never depends on the download server.
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition', 'landmark_3d_68'], providers=['CPUExecutionProvider'])"

COPY . .

# Set PORT=8001 on the Railway service; the backend calls http://face-service.railway.internal:8001
CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8001}"]
