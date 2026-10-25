"""App server: static UI and a stateless vendor proxy."""

import base64
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from open_book.forward import approved_completion_base, approved_speech_base, voice_id
from open_book.log import logger, note_vendor, observe_v1, public_text

BUILD = Path(__file__).resolve().parents[2] / "web" / "build"
MAX_AUDIO_BYTES = 24 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("server version=0.1.0 ffmpeg=%s", shutil.which("ffmpeg") is not None)
    yield


app = FastAPI(title="Open Book Reader", lifespan=lifespan)
app.middleware("http")(observe_v1)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> Response:
    if isinstance(exc, (HTTPException, StarletteHTTPException)):
        raise exc
    logger.exception("proxy crash method=%s route=%s", request.method, request.url.path)
    raise exc


class CompleteBody(BaseModel):
    baseUrl: str = Field(max_length=500)
    model: str = Field(max_length=200)
    apiKey: str = Field(default="", max_length=500)
    system: str = Field(max_length=8000)
    user: str = Field(max_length=20000)


class SpeakBody(BaseModel):
    vendor: Literal["openai", "kokoro", "elevenlabs"]
    baseUrl: str = Field(max_length=500)
    model: str = Field(default="", max_length=200)
    apiKey: str = Field(default="", max_length=500)
    voice: str = Field(default="", max_length=200)
    text: str = Field(max_length=8000)
    emotion: str = Field(default="neutral", max_length=40)
    instructions: str = Field(default="", max_length=8000)
    sampleBase64: str | None = Field(default=None, max_length=14_000_000)


class CloneBody(BaseModel):
    vendor: Literal["openai", "kokoro", "elevenlabs", "browser"]
    baseUrl: str = Field(max_length=500)
    apiKey: str = Field(default="", max_length=500)
    name: str = Field(max_length=80)
    sampleBase64: str = Field(max_length=14_000_000)
    mime: str = Field(default="audio/mpeg", max_length=80)


def openai_url(origin: str, suffix: str) -> str:
    return f"{origin}/v1/{suffix}"


def auth_headers(api_key: str) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    return headers


def vendor_error(response: httpx.Response) -> HTTPException:
    detail = response.text[:500] or f"Vendor returned {response.status_code}"
    status = response.status_code if 400 <= response.status_code <= 599 else 502
    return HTTPException(status, detail)


@app.get("/v1/health")
def health(request: Request) -> dict[str, object]:
    note_vendor(request, "-")
    return {
        "version": "0.1.0",
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "maxBodyBytes": 32 * 1024 * 1024,
    }


@app.post("/v1/complete")
def complete(body: CompleteBody, request: Request) -> dict[str, str]:
    note_vendor(request, "ollama")
    url = openai_url(approved_completion_base(body.baseUrl), "chat/completions")
    payload = {
        "model": body.model,
        "messages": [
            {"role": "system", "content": body.system},
            {"role": "user", "content": body.user},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            response = client.post(url, headers=auth_headers(body.apiKey), json=payload)
            if response.status_code == 400:
                payload.pop("response_format", None)
                response = client.post(url, headers=auth_headers(body.apiKey), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {urlparse(url).netloc}: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise vendor_error(response)
    try:
        message = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(502, "The text host returned an unexpected response.") from exc
    if isinstance(message, list):
        message = "".join(part.get("text", "") for part in message if isinstance(part, dict))
    if not isinstance(message, str):
        raise HTTPException(502, "The text host returned an empty message.")
    return {"content": message}


def _words_from_alignment(payload: dict) -> list[dict[str, object]] | None:
    alignment = payload.get("alignment")
    if not isinstance(alignment, dict):
        return None
    chars = alignment.get("characters")
    starts = alignment.get("character_start_times_seconds")
    ends = alignment.get("character_end_times_seconds")
    if not isinstance(chars, list) or not isinstance(starts, list) or not isinstance(ends, list):
        return None
    words: list[dict[str, object]] = []
    token = ""
    start = None
    end = None
    for index, char in enumerate(chars):
        if index >= len(starts) or index >= len(ends) or not isinstance(char, str):
            continue
        if char.isspace():
            if token and start is not None and end is not None:
                words.append({"text": token, "start": start, "end": end})
            token = ""
            start = None
            end = None
            continue
        if start is None:
            start = starts[index]
        end = ends[index]
        token += char
    if token and start is not None and end is not None:
        words.append({"text": token, "start": start, "end": end})
    return words or None


def _words_from_list(value: object) -> list[dict[str, object]] | None:
    if not isinstance(value, list):
        return None
    words: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = item.get("word", item.get("text", ""))
        start = item.get("start", item.get("start_time"))
        end = item.get("end", item.get("end_time"))
        if isinstance(start, (int, float)) and isinstance(end, (int, float)):
            words.append({"text": str(text), "start": float(start), "end": float(end)})
    return words or None


def _audio_result(content: bytes, mime: str, words: list[dict[str, object]] | None, delivery: str) -> dict[str, object]:
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(502, "The speech host returned audio larger than 24 MB.")
    return {
        "mime": mime,
        "audioBase64": base64.b64encode(content).decode("ascii"),
        "words": words,
        "delivery": delivery,
    }


@app.post("/v1/speak")
def speak(body: SpeakBody, request: Request) -> dict[str, object]:
    note_vendor(request, body.vendor)
    origin = approved_speech_base(body.baseUrl, body.vendor)
    if body.vendor == "elevenlabs":
        return _speak_elevenlabs(body, origin)
    if body.vendor == "kokoro":
        return _speak_kokoro(body, origin)
    return _speak_openai(body, origin)


def _speak_openai(body: SpeakBody, origin: str) -> dict[str, object]:
    url = openai_url(origin, "audio/speech")
    model = body.model or "gpt-4o-mini-tts"
    voice = body.voice or "alloy"
    payload: dict[str, object] = {
        "model": model,
        "input": body.text,
        "voice": voice,
        "response_format": "mp3",
    }
    delivery = "OpenAI-compatible speech. No emotion field was sent."
    send_instructions = "gpt" in model or "mini-tts" in model
    if send_instructions and body.instructions:
        payload["instructions"] = body.instructions
        delivery = f"OpenAI instructions for {body.emotion}: {body.instructions[:240]}"
    if body.sampleBase64:
        payload["reference_audio"] = body.sampleBase64
        delivery += " A voice sample was attached as reference_audio."
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            response = client.post(url, headers=auth_headers(body.apiKey), json=payload)
            if response.status_code == 400 and "instructions" in payload:
                payload.pop("instructions", None)
                delivery = "The speech host rejected emotion instructions, so the text was sent without them."
                response = client.post(url, headers=auth_headers(body.apiKey), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {urlparse(url).netloc}: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise vendor_error(response)
    mime = response.headers.get("content-type", "audio/mpeg").split(";")[0]
    if "json" in mime:
        data = response.json()
        audio = data.get("audio") or data.get("audio_base64")
        if not isinstance(audio, str):
            raise HTTPException(502, "The speech host returned JSON without audio.")
        return _audio_result(base64.b64decode(audio), "audio/mpeg", _words_from_list(data.get("words") or data.get("timestamps")), delivery)
    return _audio_result(response.content, mime or "audio/mpeg", None, delivery)


def _speak_kokoro(body: SpeakBody, origin: str) -> dict[str, object]:
    voice = body.voice or "af_heart"
    model = body.model or "kokoro"
    payload: dict[str, object] = {
        "model": model,
        "input": body.text,
        "voice": voice,
        "response_format": "mp3",
    }
    if body.sampleBase64:
        payload["reference_audio"] = body.sampleBase64
    delivery = "Kokoro has no emotion control. The text was sent as written."
    if body.sampleBase64:
        delivery += " A voice sample was attached as reference_audio."
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            captioned = client.post(f"{origin}/dev/captioned_speech", headers=auth_headers(body.apiKey), json=payload)
            if captioned.status_code < 400:
                try:
                    data = captioned.json()
                except ValueError:
                    data = None
                if isinstance(data, dict):
                    audio = data.get("audio") or data.get("audio_base64")
                    if isinstance(audio, str):
                        words = _words_from_list(data.get("timestamps") or data.get("words"))
                        return _audio_result(
                            base64.b64decode(audio),
                            "audio/mpeg",
                            words,
                            delivery + " Word times came from captioned speech.",
                        )
            response = client.post(openai_url(origin, "audio/speech"), headers=auth_headers(body.apiKey), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {urlparse(origin).netloc}: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise vendor_error(response)
    return _audio_result(response.content, "audio/mpeg", None, delivery)


def _speak_elevenlabs(body: SpeakBody, origin: str) -> dict[str, object]:
    voice = voice_id(body.voice) if body.voice.strip() else ""
    if not voice:
        raise HTTPException(400, "ElevenLabs needs a voice id. Create one from a sample or paste an existing id.")
    url = f"{origin}/v1/text-to-speech/{voice}/with-timestamps"
    model = body.model or "eleven_multilingual_v2"
    tags = {
        "whispered": "[whispers] ",
        "angry": "[angry] ",
        "excited": "[excited] ",
        "somber": "[sorrowful] ",
        "calm": "[calm] ",
    }
    prefix = tags.get(body.emotion, "")
    payload = {"text": f"{prefix}{body.text}", "model_id": model}
    headers = {"content-type": "application/json", "xi-api-key": body.apiKey}
    delivery = f"ElevenLabs model {model}, voice {voice}. Emotion prefix: {prefix.strip() or 'none'}."
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            response = client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {urlparse(url).netloc}: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise vendor_error(response)
    try:
        data = response.json()
        audio = data["audio_base64"]
    except (KeyError, ValueError) as exc:
        raise HTTPException(502, "ElevenLabs returned an unexpected response.") from exc
    return _audio_result(base64.b64decode(audio), "audio/mpeg", _words_from_alignment(data), delivery)


class ClientLogBody(BaseModel):
    route: str = Field(max_length=200)
    message: str = Field(max_length=300)


@app.post("/v1/log", status_code=204)
def client_log(body: ClientLogBody) -> Response:
    logger.info("client route=%s message=%s", public_text(body.route, 200), public_text(body.message, 300))
    return Response(status_code=204)


@app.post("/v1/voices/clone")
def clone_voice(body: CloneBody, request: Request) -> dict[str, str]:
    note_vendor(request, body.vendor)
    if body.vendor != "elevenlabs":
        raise HTTPException(
            400,
            "Voice cloning on the vendor is implemented for ElevenLabs. The sample stays in this browser for other voices.",
        )
    if not body.apiKey:
        raise HTTPException(400, "ElevenLabs needs an API key to create a voice.")
    origin = approved_speech_base(body.baseUrl, "elevenlabs")
    try:
        sample = base64.b64decode(body.sampleBase64, validate=True)
    except ValueError as exc:
        raise HTTPException(400, "The voice sample is not valid base64.") from exc
    if len(sample) > 10 * 1024 * 1024:
        raise HTTPException(400, "Voice samples are limited to 10 MB.")
    url = f"{origin}/v1/voices/add"
    extension = ".wav" if "wav" in body.mime else ".mp3" if "mpeg" in body.mime or "mp3" in body.mime else ".webm"
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            response = client.post(
                url,
                headers={"xi-api-key": body.apiKey},
                data={"name": body.name or "Open Book Reader"},
                files={"files": (f"sample{extension}", sample, body.mime or "application/octet-stream")},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach {urlparse(url).netloc}: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise vendor_error(response)
    try:
        created = response.json()["voice_id"]
    except (KeyError, ValueError) as exc:
        raise HTTPException(502, "ElevenLabs did not return a voice id.") from exc
    return {"voiceId": str(created)}


class SinglePage(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = await super().get_response("index.html", scope)
        if response.status_code == 404:
            response = await super().get_response("index.html", scope)
        return response


def mount_ui() -> None:
    if not (BUILD / "index.html").is_file():
        raise RuntimeError(f"Web build is missing at {BUILD}. Run npm run build in apps/web.")
    app.mount("/", SinglePage(directory=BUILD), name="ui")


mount_ui()
