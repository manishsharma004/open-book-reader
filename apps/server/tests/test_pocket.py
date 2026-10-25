"""Pocket speech stays on port 7508 and the sample is a form file, not a URL."""

import base64
import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient

from open_book.main import app

_POCKET = Path(__file__).resolve().parents[3] / "services" / "pocket" / "app.py"
_spec = importlib.util.spec_from_file_location("pocket_service_app", _POCKET)
assert _spec and _spec.loader
pocket_app = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pocket_app)


class _Calls:
    def __init__(self) -> None:
        self.posts: list[dict[str, object]] = []

    def client(self):
        calls = self

        class Response:
            status_code = 200
            headers = {"content-type": "audio/wav"}
            content = b"RIFF\x00\x00\x00\x00WAVEbody"

        class Client:
            def __init__(self, *args, **kwargs):
                assert kwargs.get("follow_redirects") is False
                assert kwargs.get("timeout") == 90

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def post(self, url, data=None, files=None, **kwargs):
                calls.posts.append({"url": url, "data": data, "files": files, "kwargs": kwargs})
                return Response()

        return Client


def test_speak_sends_the_sample_as_voice_wav(monkeypatch):
    calls = _Calls()
    monkeypatch.setattr("open_book.main.httpx.Client", calls.client())
    sample = b"RIFFxxxxWAVEclip"
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "pocket",
            "baseUrl": "http://127.0.0.1:7508",
            "model": "english_18m_refl_2026-10",
            "voice": "alba",
            "text": "Hello from the book.",
            "sampleBase64": base64.b64encode(sample).decode("ascii"),
            "sampleMime": "audio/wav",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mime"] == "audio/wav"
    assert body["words"] is None
    assert "voice_wav" in body["delivery"]
    assert calls.posts[0]["url"] == "http://127.0.0.1:7508/tts"
    data = calls.posts[0]["data"]
    files = calls.posts[0]["files"]
    assert data == {"text": "Hello from the book."}
    assert "voice_url" not in data
    name, payload, mime = files["voice_wav"]
    assert name == "sample.wav"
    assert payload == sample
    assert mime == "audio/wav"


def test_speak_sends_a_builtin_voice_name(monkeypatch):
    calls = _Calls()
    monkeypatch.setattr("open_book.main.httpx.Client", calls.client())
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "pocket",
            "baseUrl": "http://127.0.0.1:7508",
            "voice": "alba",
            "text": "Hello.",
        },
    )
    assert response.status_code == 200
    assert calls.posts[0]["url"] == "http://127.0.0.1:7508/tts"
    assert calls.posts[0]["data"] == {"text": "Hello.", "voice_url": "alba"}
    assert calls.posts[0]["files"] is None


def test_speak_does_not_forward_a_voice_url(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError(f"httpx should not open a connection: {args} {kwargs}")

    monkeypatch.setattr("open_book.main.httpx.Client", boom)
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "pocket",
            "baseUrl": "http://127.0.0.1:7508",
            "voice": "https://example.com/voice.wav",
            "text": "Hello.",
        },
    )
    assert response.status_code == 400
    refused = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "pocket",
            "baseUrl": "http://10.0.0.8:7508",
            "voice": "alba",
            "text": "Hello.",
        },
    )
    assert refused.status_code == 400
    assert "port 7508" in refused.json()["detail"]


def test_speak_rejects_a_huge_sample(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("httpx should not open a connection")

    monkeypatch.setattr("open_book.main.httpx.Client", boom)
    raw = b"a" * (10 * 1024 * 1024 + 1)
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "pocket",
            "baseUrl": "http://127.0.0.1:7508",
            "text": "Hello.",
            "sampleBase64": base64.b64encode(raw).decode("ascii"),
        },
    )
    assert response.status_code == 400
    assert "10 MB" in response.json()["detail"]


class _Fake:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None, bytes]] = []

    def speak(self, text: str, voice_name: str | None, voice_file: Path | None) -> bytes:
        payload = voice_file.read_bytes() if voice_file else b""
        self.calls.append((text, voice_name, payload))
        return pocket_app.wav_from_float([0.0, 0.5, -0.5], 8000)


def test_service_form_keeps_the_sample_and_refuses_urls():
    fake = _Fake()
    client = TestClient(pocket_app.create_app(fake))
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["language"] == "english_18m_refl_2026-10"

    both = client.post(
        "/tts",
        data={"text": "Hello", "voice_url": "alba"},
        files={"voice_wav": ("clip.wav", b"RIFFxxxxWAVE", "audio/wav")},
    )
    assert both.status_code == 400
    assert fake.calls == []

    fetched = client.post("/tts", data={"text": "Hello", "voice_url": "https://example.com/voice.wav"})
    assert fetched.status_code == 400

    uploaded = client.post(
        "/tts",
        data={"text": "Hello there"},
        files={"voice_wav": ("clip.mp3", b"ID3clip", "audio/mpeg")},
    )
    assert uploaded.status_code == 200
    assert uploaded.headers["content-type"].startswith("audio/wav")
    assert uploaded.content.startswith(b"RIFF")
    assert fake.calls[-1] == ("Hello there", None, b"ID3clip")

    named = client.post("/tts", data={"text": "Named", "voice_url": "alba"})
    assert named.status_code == 200
    assert fake.calls[-1] == ("Named", "alba", b"")

    default = client.post("/tts", data={"text": "Default"})
    assert default.status_code == 200
    assert fake.calls[-1] == ("Default", None, b"")
