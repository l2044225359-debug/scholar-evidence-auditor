"""Minimal VibeVoice Realtime TTS service for Scholar."""

from __future__ import annotations

import copy
import logging
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from transformers.cache_utils import DynamicCache
from transformers.modeling_outputs import BaseModelOutputWithPast
from vibevoice.modular.modeling_vibevoice_streaming_inference import (
    VibeVoiceStreamingForConditionalGenerationInference,
)
from vibevoice.processor.vibevoice_streaming_processor import (
    VibeVoiceStreamingProcessor,
)

logger = logging.getLogger("vibevoice")
logging.basicConfig(level=logging.INFO)

MODEL_PATH = os.getenv(
    "VIBEVOICE_MODEL_PATH",
    "microsoft/VibeVoice-Realtime-0.5B",
)
DEVICE = os.getenv(
    "VIBEVOICE_DEVICE",
    "cuda" if torch.cuda.is_available() else "cpu",
)
VOICES_DIR = Path(
    os.getenv(
        "VIBEVOICE_VOICES_DIR",
        "/home/lh/race/vibevoice/demo/voices/streaming_model",
    )
)
OUTPUT_DIR = Path(
    os.getenv(
        "VIBEVOICE_OUTPUT_DIR",
        "/home/lh/race/vibevoice/vibevoice_outputs",
    )
)
MAX_CHARS = int(os.getenv("VIBEVOICE_MAX_CHARS", "2500"))

app = FastAPI(title="Scholar VibeVoice", version="1.0.0")

_model_lock = threading.Lock()
_generation_lock = threading.Lock()
_model: VibeVoiceStreamingForConditionalGenerationInference | None = None
_processor: VibeVoiceStreamingProcessor | None = None
_load_error: str | None = None


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    speaker: str = "Carter"
    language: Literal["en"] = "en"


def _voice_files() -> dict[str, Path]:
    return {
        path.stem.lower(): path
        for path in sorted(VOICES_DIR.glob("*.pt"))
        if path.is_file()
    }


def _resolve_voice(speaker: str) -> Path:
    voices = _voice_files()
    if not voices:
        raise RuntimeError("No VibeVoice speaker prompts were found")
    needle = speaker.strip().lower()
    if needle in voices:
        return voices[needle]
    partial = [
        path
        for name, path in voices.items()
        if needle in name or name in needle
    ]
    if len(partial) == 1:
        return partial[0]
    default = voices.get("en-carter_man")
    if default:
        return default
    return next(iter(voices.values()))


def _clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"【\d+】|\[\d+\]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_model() -> None:
    global _model, _processor, _load_error
    if _model is not None and _processor is not None:
        return
    with _model_lock:
        if _model is not None and _processor is not None:
            return
        try:
            logger.info("Loading processor and model on %s", DEVICE)
            _processor = VibeVoiceStreamingProcessor.from_pretrained(MODEL_PATH)
            dtype = torch.bfloat16 if DEVICE == "cuda" else torch.float32
            kwargs = {
                "torch_dtype": dtype,
                "device_map": DEVICE if DEVICE in {"cuda", "cpu"} else None,
            }
            try:
                _model = (
                    VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                        MODEL_PATH,
                        attn_implementation="flash_attention_2",
                        **kwargs,
                    )
                )
            except Exception as exc:
                logger.warning(
                    "FlashAttention unavailable; using SDPA: %s",
                    type(exc).__name__,
                )
                _model = (
                    VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                        MODEL_PATH,
                        attn_implementation="sdpa",
                        **kwargs,
                    )
                )
            _model.eval()
            _model.set_ddpm_inference_steps(num_steps=5)
            _load_error = None
            logger.info("VibeVoice model ready")
        except Exception as exc:
            _load_error = f"{type(exc).__name__}: {exc}"
            logger.exception("VibeVoice model loading failed")
            raise


@app.on_event("startup")
def warmup() -> None:
    if os.getenv("VIBEVOICE_WARMUP", "1") != "1":
        return

    def worker() -> None:
        try:
            load_model()
        except Exception:
            pass

    threading.Thread(target=worker, daemon=True).start()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "vibevoice-realtime-tts",
        "version": "1.0.0",
        "model": MODEL_PATH,
        "device": DEVICE,
        "ready": _model is not None and _processor is not None,
        "loading": _model is None and _load_error is None,
        "error": _load_error,
        "languages": ["en"],
        "voices": list(_voice_files()),
    }


@app.post("/api/tts")
def synthesize(payload: TTSRequest):
    text = _clean_text(payload.text)
    if not text:
        raise HTTPException(status_code=422, detail="Text is empty")
    if re.search(r"[\u3400-\u9fff]", text):
        raise HTTPException(
            status_code=422,
            detail=(
                "VibeVoice Realtime currently supports English narration only"
            ),
        )

    try:
        load_model()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"VibeVoice model unavailable: {type(exc).__name__}",
        ) from exc

    assert _model is not None
    assert _processor is not None
    voice_path = _resolve_voice(payload.speaker)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.wav"

    with _generation_lock:
        try:
            with torch.serialization.safe_globals(
                [BaseModelOutputWithPast, DynamicCache]
            ):
                try:
                    cached_prompt = torch.load(
                        voice_path,
                        map_location=DEVICE,
                        weights_only=True,
                    )
                except Exception:
                    cached_prompt = torch.load(
                        voice_path,
                        map_location=DEVICE,
                        weights_only=False,
                    )
            inputs = _processor.process_input_with_cached_prompt(
                text=text,
                cached_prompt=cached_prompt,
                padding=True,
                return_tensors="pt",
                return_attention_mask=True,
            )
            for key, value in inputs.items():
                if torch.is_tensor(value):
                    inputs[key] = value.to(DEVICE)
            outputs = _model.generate(
                **inputs,
                max_new_tokens=None,
                cfg_scale=1.5,
                tokenizer=_processor.tokenizer,
                generation_config={"do_sample": False},
                verbose=False,
                all_prefilled_outputs=copy.deepcopy(cached_prompt),
            )
            if not outputs.speech_outputs:
                raise RuntimeError("VibeVoice returned no speech output")
            _processor.save_audio(
                outputs.speech_outputs[0],
                output_path=str(output_path),
            )
            audio = output_path.read_bytes()
        finally:
            output_path.unlink(missing_ok=True)

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-Vibevoice-Model": MODEL_PATH,
            "X-Vibevoice-Speaker": voice_path.stem,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("VIBEVOICE_HOST", "127.0.0.1"),
        port=int(os.getenv("VIBEVOICE_PORT", "8002")),
    )
