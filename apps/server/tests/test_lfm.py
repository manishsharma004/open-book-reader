"""LFM3 Audio stays on port 7510 and posts llama.cpp /tts JSON."""

import base64

import httpx
from fastapi.testclient import TestClient

from open_book.main import app


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
                assert kwargs.get("timeout") == 180

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def post(self, url, json=None, **kwargs):
                calls.posts.append({"url": url, "json": json, "kwargs": kwargs})
                return Response()

        return Client


def test_speak_posts_voice_and_language(monkeypatch):
    calls = _Calls()
    monkeypatch.setattr("open_book.main.httpx.Client", calls.client())
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "lfm",
            "baseUrl": "http://127.0.0.1:7510",
            "model": "en-gb",
            "voice": "male",
            "text": "Hello from the book.",
            "sampleBase64": base64.b64encode(b"RIFFxxxxWAVEclip").decode("ascii"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mime"] == "audio/wav"
    assert body["words"] is None
    assert "not sent" in body["delivery"]
    assert calls.posts[0]["url"] == "http://127.0.0.1:7510/tts"
    assert calls.posts[0]["json"] == {
        "input": "Hello from the book.",
        "voice": "male",
        "lang": "en-gb",
        "response_format": "wav",
    }


def test_speak_refuses_a_cloned_voice_name():
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "lfm",
            "baseUrl": "http://127.0.0.1:7510",
            "model": "en",
            "voice": "alba",
            "text": "Hello.",
        },
    )
    assert response.status_code == 400
    assert "female" in response.json()["detail"]


def test_unreachable_host_is_a_bad_gateway(monkeypatch):
    def explode(*args, **kwargs):
        raise httpx.ConnectError("down")

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            explode()

    monkeypatch.setattr("open_book.main.httpx.Client", Client)
    response = TestClient(app).post(
        "/v1/speak",
        json={
            "vendor": "lfm",
            "baseUrl": "http://127.0.0.1:7510",
            "model": "en",
            "voice": "female",
            "text": "Hello.",
        },
    )
    assert response.status_code == 502
