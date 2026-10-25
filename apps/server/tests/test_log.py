import logging

from fastapi.testclient import TestClient

from open_book.main import app

client = TestClient(app)


def records(caplog) -> str:
    return "\n".join(record.getMessage() for record in caplog.records if record.name == "open_book")


def test_refused_complete_is_logged_without_the_book(caplog):
    caplog.set_level(logging.INFO, logger="open_book")
    secret = "sk-test-secret-value"
    sentence = "Mara waited at the station clock."
    response = client.post(
        "/v1/complete?unused=1",
        json={
            "baseUrl": "http://192.168.1.1/v1",
            "model": "qwen3:4b",
            "apiKey": secret,
            "system": "sys",
            "user": sentence,
        },
    )
    assert response.status_code == 400
    text = records(caplog)
    assert "proxy method=POST route=/v1/complete vendor=ollama status=400" in text
    assert "unused" not in text
    assert secret not in text
    assert sentence not in text
    assert "192.168.1.1" not in text


def test_speak_log_names_the_vendor_and_skips_the_text(caplog):
    caplog.set_level(logging.INFO, logger="open_book")
    sentence = "The station clock had stopped at noon."
    response = client.post(
        "/v1/speak",
        json={
            "vendor": "kokoro",
            "baseUrl": "http://10.0.0.8:8880/v1",
            "model": "kokoro",
            "voice": "af_heart",
            "text": sentence,
            "apiKey": "Bearer hidden-key",
        },
    )
    assert response.status_code == 400
    text = records(caplog)
    assert "route=/v1/speak vendor=kokoro status=400" in text
    assert sentence not in text
    assert "hidden-key" not in text


def test_client_report_logs_the_message_and_redacts_a_key(caplog):
    caplog.set_level(logging.INFO, logger="open_book")
    response = client.post(
        "/v1/log",
        json={"route": "/read/abc", "message": "each_key_duplicate"},
    )
    assert response.status_code == 204
    assert "client route=/read/abc message=each_key_duplicate" in records(caplog)
    caplog.clear()
    leaked = client.post(
        "/v1/log",
        json={"route": "/read/abc", "message": "failed with sk-live-secret"},
    )
    assert leaked.status_code == 204
    assert "client route=/read/abc message=[redacted]" in records(caplog)
    assert "sk-live-secret" not in records(caplog)


def test_static_pages_are_not_proxy_logs(caplog):
    caplog.set_level(logging.INFO, logger="open_book")
    response = client.get("/")
    assert response.status_code == 200
    assert "route=/" not in records(caplog)
