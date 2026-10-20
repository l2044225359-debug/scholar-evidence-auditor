# syntax=docker/dockerfile:1.7

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./

RUN useradd --create-home --uid 1000 scholar \
    && mkdir -p /data/cache /data/exports \
    && chown -R scholar:scholar /data /app
USER scholar

ENV CITATION_CACHE_DIR=/data/cache
ENV CITATION_EXPORT_DIR=/data/exports

EXPOSE 8001
CMD ["python", "app.py"]
