"""The proxy may open only the completion and speech targets it is built for."""

import os
import socket

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from open_book.forward import approved_completion_base, approved_speech_base
from open_book.main import app


@pytest.fixture(autouse=True)
def clear_allow(monkeypatch):
    monkeypatch.delenv("OLLAMA_ALLOW", raising=False)
    monkeypatch.delenv("SPEECH_ALLOW", raising=False)
    monkeypatch.delenv("SPEECH_UPSTREAM", raising=False)


def test_completion_allows_llm_port_on_named_hosts():
    assert approved_completion_base("http://127.0.0.1:5173/v1") == "http://127.0.0.1:5173"
    assert approved_completion_base("http://localhost:5173/v1") == "http://localhost:5173"
    assert approved_completion_base("http://[::1]:5173/v1") == "http://[::1]:5173"
    for url in [
        "http://192.168.1.45:11434/v1",
        "http://192.168.1.45:5173/v1",
        "http://127.0.0.1:5174/v1",
        "https://192.168.1.45:5173/v1",
        "https://127.0.0.1:5173/v1",
    ]:
        with pytest.raises(HTTPException) as caught:
            approved_completion_base(url)
        assert caught.value.status_code == 400


def test_completion_allows_local_ollama():
    assert approved_completion_base("http://127.0.0.1:11434/v1") == "http://127.0.0.1:11434"
    assert approved_completion_base("http://127.0.0.1:11434") == "http://127.0.0.1:11434"
    assert approved_completion_base("http://localhost:11434/v1/") == "http://localhost:11434"
    assert approved_completion_base("http://[::1]:11434/v1") == "http://[::1]:11434"


def test_completion_allows_ollama_cloud():
    assert approved_completion_base("https://ollama.com/v1") == "https://ollama.com:443"


def test_completion_refuses_other_networks():
    refused = [
        "http://192.168.1.40:11434/v1",
        "http://10.0.0.5:11434/v1",
        "http://172.16.0.2:11434/v1",
        "http://169.254.169.254/latest/meta-data",
        "http://169.254.169.254:11434/v1",
        "http://[fd00:ec2::254]/",
        "http://127.0.0.1:22/v1",
        "http://127.0.0.1:8080/v1",
        "http://127.0.0.2:11434/v1",
        "https://api.openai.com/v1",
        "http://ollama.com/v1",
        "http://example.com:11434/v1",
        "http://2130706433:11434/v1",
    ]
    for url in refused:
        with pytest.raises(HTTPException) as caught:
            approved_completion_base(url)
        assert caught.value.status_code == 400


def test_completion_refuses_smuggled_paths():
    for url in [
        "http://127.0.0.1:11434/v1/../../",
        "http://127.0.0.1:11434/api/chat",
        "http://user:pass@127.0.0.1:11434/v1",
        "http://127.0.0.1:11434/v1?q=1",
        "http://127.0.0.1:11434/v1#frag",
    ]:
        with pytest.raises(HTTPException) as caught:
            approved_completion_base(url)
        assert caught.value.status_code == 400


def test_ollama_allow_is_one_host(monkeypatch):
    monkeypatch.setenv("OLLAMA_ALLOW", "192.168.1.40:11434, [fe80::1]:11434")
    assert approved_completion_base("http://192.168.1.40:11434/v1") == "http://192.168.1.40:11434"
    with pytest.raises(HTTPException):
        approved_completion_base("http://192.168.1.41:11434/v1")
    with pytest.raises(HTTPException) as caught:
        approved_completion_base("http://[fe80::1]:11434/v1")
    assert caught.value.detail == "That address is never forwarded to."


def test_metadata_cannot_be_allowlisted(monkeypatch):
    monkeypatch.setenv("OLLAMA_ALLOW", "169.254.169.254:11434")
    with pytest.raises(HTTPException) as caught:
        approved_completion_base("http://169.254.169.254:11434/v1")
    assert caught.value.detail == "That address is never forwarded to."


def test_speech_allows_known_hosts_only():
    assert approved_speech_base("http://127.0.0.1:8880/v1", "kokoro") == "http://127.0.0.1:8880"
    assert approved_speech_base("http://localhost:8880/v1", "kokoro") == "http://localhost:8880"
    assert approved_speech_base("https://api.openai.com/v1", "openai") == "https://api.openai.com:443"
    assert approved_speech_base("https://api.elevenlabs.io", "elevenlabs") == "https://api.elevenlabs.io:443"
    assert approved_speech_base("http://127.0.0.1:7508", "pocket") == "http://127.0.0.1:7508"
    assert approved_speech_base("http://localhost:7508", "pocket") == "http://localhost:7508"
    assert approved_speech_base("http://[::1]:7508", "pocket") == "http://[::1]:7508"
    assert approved_speech_base("http://127.0.0.1:7510", "lfm") == "http://127.0.0.1:7510"
    for url, vendor in [
        ("http://192.168.1.1:8880/v1", "kokoro"),
        ("http://192.168.1.45:8880/v1", "kokoro"),
        ("http://192.168.1.45:7508", "pocket"),
        ("http://192.168.1.45:7510", "lfm"),
        ("http://192.168.1.1:7508", "pocket"),
        ("http://127.0.0.1:8000", "pocket"),
        ("http://127.0.0.1:8001", "pocket"),
        ("http://127.0.0.1:8880", "pocket"),
        ("http://127.0.0.1:7508", "kokoro"),
        ("http://127.0.0.1:7508", "lfm"),
        ("http://127.0.0.1:7510", "pocket"),
        ("https://127.0.0.1:7508", "pocket"),
        ("http://192.168.1.45:5173/v1", "openai"),
        ("http://127.0.0.1:11434/v1", "kokoro"),
        ("http://127.0.0.1:8880/v1", "openai"),
        ("https://api.openai.com/v1", "kokoro"),
        ("https://api.openai.com/v1", "pocket"),
        ("http://api.elevenlabs.io/v1", "elevenlabs"),
        ("https://example.com/v1", "openai"),
    ]:
        with pytest.raises(HTTPException) as caught:
            approved_speech_base(url, vendor)
        assert caught.value.status_code == 400


def test_speech_allow_opens_one_port(monkeypatch):
    monkeypatch.setenv("SPEECH_ALLOW", "127.0.0.1:22434")
    assert approved_speech_base("http://127.0.0.1:22434/v1", "openai") == "http://127.0.0.1:22434"
    with pytest.raises(HTTPException):
        approved_speech_base("http://127.0.0.1:22435/v1", "openai")


def test_routes_do_not_connect_when_refused(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError(f"httpx should not open a connection: {args} {kwargs}")

    monkeypatch.setattr("open_book.main.httpx.Client", boom)
    client = TestClient(app)
    complete = client.post(
        "/v1/complete",
        json={"baseUrl": "http://192.168.1.1/v1", "model": "qwen3:4b", "system": "s", "user": "u"},
    )
    assert complete.status_code == 400
    assert "OLLAMA_ALLOW" in complete.json()["detail"]
    speak = client.post(
        "/v1/speak",
        json={
            "vendor": "kokoro",
            "baseUrl": "http://10.0.0.8:8880/v1",
            "model": "kokoro",
            "voice": "af_heart",
            "text": "hello",
        },
    )
    assert speak.status_code == 400
    assert "SPEECH_ALLOW" in speak.json()["detail"]
    clone = client.post(
        "/v1/voices/clone",
        json={
            "vendor": "elevenlabs",
            "baseUrl": "http://127.0.0.1:11434",
            "apiKey": "secret",
            "name": "Reader",
            "sampleBase64": "aGVsbG8=",
        },
    )
    assert clone.status_code == 400
    assert os.environ.get("OLLAMA_ALLOW") is None


def test_complete_uses_the_ollama_path(monkeypatch):
    posts: list[str] = []

    class Response:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "{\"ok\":true}"}}]}

    class Client:
        def __init__(self, *args, **kwargs):
            assert kwargs.get("follow_redirects") is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers, json):
            posts.append(url)
            assert "authorization" not in {key.lower() for key in headers}
            return Response()

    monkeypatch.setattr("open_book.main.httpx.Client", Client)
    response = TestClient(app).post(
        "/v1/complete",
        json={
            "baseUrl": "http://127.0.0.1:11434/v1/../admin",
            "model": "qwen3:4b",
            "system": "s",
            "user": "u",
        },
    )
    assert response.status_code == 400
    assert posts == []
    ok = TestClient(app).post(
        "/v1/complete",
        json={"baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen3:4b", "system": "s", "user": "u"},
    )
    assert ok.status_code == 200
    assert posts == ["http://127.0.0.1:11434/v1/chat/completions"]
    llm = TestClient(app).post(
        "/v1/complete",
        json={"baseUrl": "http://127.0.0.1:5173/v1", "model": "qwen3:4b", "system": "s", "user": "u"},
    )
    assert llm.status_code == 200
    assert posts == [
        "http://127.0.0.1:11434/v1/chat/completions",
        "http://127.0.0.1:5173/v1/chat/completions",
    ]


def _compose_dns(monkeypatch):
    def fake(host, port, *args, **kwargs):
        if host == "localhost":
            address = "127.0.0.1"
        elif host in {"pocket", "kokoro"}:
            address = "172.18.0.4"
        else:
            address = "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)


def test_speech_upstream_rewrites_approved_local_speech(monkeypatch):
    _compose_dns(monkeypatch)
    monkeypatch.setenv("SPEECH_UPSTREAM", "7508=http://pocket:7508, 8880=http://kokoro:8880")
    assert approved_speech_base("http://127.0.0.1:7508", "pocket") == "http://pocket:7508"
    assert approved_speech_base("http://localhost:7508", "pocket") == "http://pocket:7508"
    assert approved_speech_base("http://[::1]:7508", "pocket") == "http://pocket:7508"
    assert approved_speech_base("http://127.0.0.1:8880/v1", "kokoro") == "http://kokoro:8880"
    assert approved_speech_base("https://api.openai.com/v1", "openai") == "https://api.openai.com:443"


def test_speech_upstream_leaves_other_ports_alone(monkeypatch):
    _compose_dns(monkeypatch)
    monkeypatch.setenv("SPEECH_UPSTREAM", "8880=http://kokoro:8880")
    assert approved_speech_base("http://127.0.0.1:7508", "pocket") == "http://127.0.0.1:7508"


def test_speech_upstream_refuses_metadata(monkeypatch):
    monkeypatch.setenv("SPEECH_UPSTREAM", "7508=http://169.254.169.254:7508")
    with pytest.raises(HTTPException) as caught:
        approved_speech_base("http://127.0.0.1:7508", "pocket")
    assert caught.value.status_code == 400
    assert caught.value.detail == "That address is never forwarded to."


def test_speech_upstream_rejects_a_bad_entry(monkeypatch):
    monkeypatch.setenv("SPEECH_UPSTREAM", "pocket")
    with pytest.raises(HTTPException) as caught:
        approved_speech_base("http://127.0.0.1:7508", "pocket")
    assert caught.value.status_code == 500
