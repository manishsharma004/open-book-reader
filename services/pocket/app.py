"""Pocket TTS service for Open Book Reader.

This process is separate from the app server. The app server forwards
`POST /v1/speak` with vendor `pocket` to `POST /tts` here. It does not
import this module.

    POCKET_LANGUAGE=english_18m_refl_2026-10 python services/pocket/app.py

The process listens on port 7508. This container publishes services on 7500–7510.

Weights are gated. A Hugging Face token (`HF_TOKEN` or `huggingface-cli login`)
is required the first time the model downloads. `POCKET_LANGUAGE` is read
when the process starts. A request cannot switch the model.

`voice_url` accepts a builtin voice name only. This service does not fetch
http, https, or hf URLs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Protocol

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

DEFAULT_LANGUAGE = "english_18m_refl_2026-10"
MAX_SAMPLE_BYTES = 10 * 1024 * 1024
_VOICE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,5}$")
logger = logging.getLogger("pocket_service")


class VoiceCloningUnavailable(RuntimeError):
    """The loaded weights have no voice encoder, so a sample cannot be cloned."""


CLONING_UNAVAILABLE = (
    "This Pocket process has no voice encoder, so a sample cannot be cloned. "
    "Built-in voices still work. Accept the terms at https://huggingface.co/kyutai/pocket-tts, "
    "set HF_TOKEN, and restart Pocket TTS. On-device Pocket TTS clones the same sample in the browser."
)


class Synthesizer(Protocol):
    def speak(
        self,
        text: str,
        voice_name: str | None,
        voice_file: Path | None,
        stop: threading.Event | None = None,
    ) -> bytes | None: ...


class PocketSynthesizer:
    """Loads Kyutai Pocket TTS. Import happens here, not in the app server."""

    def __init__(self, language: str, quantize: bool = False) -> None:
        from pocket_tts.default_parameters import get_default_voice_for_language
        from pocket_tts.models.tts_model import TTSModel

        self.language = language
        self.device = torch_device()
        self.model = TTSModel.load_model(language=language, quantize=quantize)
        self.model.to(self.device)
        default_voice = get_default_voice_for_language(language, None)
        self.default_state = self.model.get_state_for_audio_prompt(default_voice)
        self.voice_cloning = bool(self.model.has_voice_cloning)
        self._lock = threading.Lock()
        logger.info("pocket device=%s voice_cloning=%s", self.device, self.voice_cloning)

    def speak(
        self,
        text: str,
        voice_name: str | None,
        voice_file: Path | None,
        stop: threading.Event | None = None,
    ) -> bytes | None:
        import torch

        with self._lock:
            if stop is not None and stop.is_set():
                return None
            if voice_file is not None:
                if not self.voice_cloning:
                    raise VoiceCloningUnavailable(CLONING_UNAVAILABLE)
                state = self.model.get_state_for_audio_prompt(voice_file, truncate=True)
            elif voice_name:
                state = self.model.get_state_for_audio_prompt(voice_name)
            else:
                state = self.default_state
            pieces = []
            for chunk in self.model.generate_audio_stream(state, text, stop=stop):
                pieces.append(chunk.detach().cpu().float())
            if stop is not None and stop.is_set():
                logger.info("pocket speech stopped")
                return None
            if not pieces:
                raise RuntimeError("Pocket TTS produced no audio.")
            audio = pieces[0] if len(pieces) == 1 else torch.cat(pieces, dim=0)
        channel = audio
        if channel.ndim == 2:
            channel = channel[0]
        return wav_from_float([float(sample) for sample in channel.tolist()], int(self.model.sample_rate))


def torch_device() -> str:
    """Use the RX 5500M when ROCm can see it and about a gigabyte is free."""
    import torch

    choice = os.environ.get("POCKET_DEVICE", "").strip().lower()
    if choice:
        return choice
    if not (getattr(torch.version, "hip", None) and torch.cuda.is_available()):
        return "cpu"
    free, total = torch.cuda.mem_get_info()
    if free < 1024 * 1024 * 1024:
        logger.warning(
            "pocket staying on cpu because the gpu has %s MB free of %s MB",
            free // (1024 * 1024),
            total // (1024 * 1024),
        )
        return "cpu"
    return "cuda"


def wav_from_float(samples: list[float], sample_rate: int) -> bytes:
    import array
    import io
    import wave

    frames = array.array("h")
    for sample in samples:
        clipped = max(-1.0, min(1.0, sample))
        frames.append(int(round(clipped * 32767)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(frames.tobytes())
    return buffer.getvalue()


def _synthesize(
    lock: threading.Lock,
    synthesizer: Synthesizer,
    text: str,
    voice_name: str | None,
    upload: tuple[str, bytes] | None,
    stop: threading.Event,
) -> bytes | None:
    if upload is not None and not bool(getattr(synthesizer, "voice_cloning", True)):
        raise VoiceCloningUnavailable(CLONING_UNAVAILABLE)
    if upload is not None:
        suffix, sample = upload
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            handle.write(sample)
            path = Path(handle.name)
        try:
            with lock:
                return synthesizer.speak(text, None, path, stop)
        finally:
            path.unlink(missing_ok=True)
    with lock:
        return synthesizer.speak(text, voice_name, None, stop)


def create_app(synthesizer: Synthesizer, language: str = DEFAULT_LANGUAGE) -> FastAPI:
    app = FastAPI(title="Pocket TTS")
    lock = threading.Lock()

    @app.get("/health")
    def health() -> dict[str, str]:
        cloning = bool(getattr(synthesizer, "voice_cloning", True))
        return {"status": "healthy", "language": language, "voiceCloning": "yes" if cloning else "no"}

    @app.post("/tts")
    async def text_to_speech(
        request: Request,
        text: str = Form(...),
        voice_url: str | None = Form(None),
        voice_wav: UploadFile | None = File(None),
    ) -> Response:
        spoken = text.strip()
        if not spoken:
            raise HTTPException(400, "Text cannot be empty.")
        if len(spoken) > 8000:
            raise HTTPException(400, "Text is longer than 8000 characters.")
        name = _builtin_voice(voice_url)
        upload = _read_upload(voice_wav)
        if name is not None and upload is not None:
            raise HTTPException(400, "Send either a voice name or a voice file, not both.")
        logger.info(
            "pocket speech chars=%s voice=%s sample_bytes=%s",
            len(spoken),
            "name" if name else "default",
            len(upload[1]) if upload else 0,
        )
        stop = threading.Event()

        async def watch() -> None:
            try:
                while True:
                    message = await request.receive()
                    if message.get("type") == "http.disconnect":
                        logger.info("pocket speech aborted")
                        stop.set()
                        return
            except asyncio.CancelledError:
                return

        watcher = asyncio.create_task(watch())
        try:
            wav = await asyncio.to_thread(_synthesize, lock, synthesizer, spoken, name, upload, stop)
        except HTTPException:
            raise
        except VoiceCloningUnavailable as exc:
            raise HTTPException(400, str(exc)) from None
        except Exception:
            logger.exception("pocket synthesis failed")
            raise HTTPException(500, "Pocket TTS could not synthesize that request.") from None
        finally:
            stop.set()
            watcher.cancel()
        if not wav:
            return Response(status_code=499)
        if not wav.startswith(b"RIFF"):
            raise HTTPException(500, "Pocket TTS returned audio that is not a wav.")
        return Response(content=wav, media_type="audio/wav")

    return app


def _builtin_voice(voice_url: str | None) -> str | None:
    if voice_url is None:
        return None
    cleaned = voice_url.strip()
    if not cleaned:
        return None
    if "://" in cleaned or "/" in cleaned or "\\" in cleaned or not _VOICE_NAME.fullmatch(cleaned):
        raise HTTPException(400, "voice_url must be a builtin voice name. This service does not fetch URLs.")
    return cleaned


def _read_upload(upload: UploadFile | None) -> tuple[str, bytes] | None:
    if upload is None:
        return None
    sample = upload.file.read(MAX_SAMPLE_BYTES + 1)
    if not sample and not upload.filename:
        return None
    if not sample:
        raise HTTPException(400, "The voice file is empty.")
    if len(sample) > MAX_SAMPLE_BYTES:
        raise HTTPException(400, "Voice samples are limited to 10 MB.")
    suffix = Path(upload.filename).suffix.lower()
    if not _SUFFIX.fullmatch(suffix):
        suffix = ".wav"
    return suffix, sample


def main() -> None:
    import uvicorn

    language = os.environ.get("POCKET_LANGUAGE", DEFAULT_LANGUAGE).strip() or DEFAULT_LANGUAGE
    host = os.environ.get("POCKET_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = int(os.environ.get("POCKET_PORT", "7508"))
    quantize = os.environ.get("POCKET_QUANTIZE", "") == "1"
    if not logger.handlers:
        logging.basicConfig(level=logging.INFO)
    logger.info("loading pocket language=%s quantize=%s", language, quantize)
    app = create_app(PocketSynthesizer(language, quantize=quantize), language=language)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
