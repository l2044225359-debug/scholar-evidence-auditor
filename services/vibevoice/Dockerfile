# syntax=docker/dockerfile:1.7

ARG VIBEVOICE_BASE_IMAGE=pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
FROM ${VIBEVOICE_BASE_IMAGE}

ARG VIBEVOICE_REPOSITORY=https://github.com/microsoft/VibeVoice.git
ARG VIBEVOICE_REF=main

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/models/huggingface
ENV VIBEVOICE_VOICES_DIR=/opt/vibevoice/demo/voices/streaming_model
ENV VIBEVOICE_OUTPUT_DIR=/data/outputs
ENV VIBEVOICE_DEVICE=cuda

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        git \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone "${VIBEVOICE_REPOSITORY}" /opt/vibevoice \
    && cd /opt/vibevoice \
    && git checkout "${VIBEVOICE_REF}" \
    && pip install --no-cache-dir "/opt/vibevoice[streamingtts]"

WORKDIR /app
COPY app.py /app/app.py
RUN mkdir -p /models /data/outputs

EXPOSE 8002
CMD ["python", "app.py"]
