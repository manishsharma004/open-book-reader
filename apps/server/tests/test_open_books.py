"""Open-book providers share one route shape and do not hand the browser a source URL."""

import json

import pytest
from fastapi.testclient import TestClient

from open_book.main import app
from open_book.open_books.http import FetchError, _allowed
from open_book.open_books.providers import Gutenberg, OpenLibrary
from open_book.open_books.refs import pack_path, unpack_path

GUTENBERG_FEED = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://www.gutenberg.org/ebooks/1342.opds</id>
    <title>Pride and Prejudice</title>
    <author><name>Austen, Jane</name></author>
    <dcterms:language xmlns:dcterms="http://purl.org/dc/terms/">en</dcterms:language>
  </entry>
  <link rel="next" href="/ebooks/search.opds/?query=pride&amp;start_index=26"/>
</feed>
"""

OL_JSON = json.dumps(
    {
        "numFound": 2,
        "docs": [
            {"title": "Public", "author_name": ["Austen"], "ia": ["public_item"], "ebook_access": "public", "first_publish_year": 1813},
            {"title": "Borrow", "ia": ["borrow_item"], "ebook_access": "borrowable"},
        ],
    }
).encode()


def test_fetch_stays_on_the_provider_hosts():
    _allowed("https://www.gutenberg.org/files/1342/1342-0.txt", ("www.gutenberg.org",), ())
    _allowed("http://aozora.textlive.net/catalog.opds", ("aozora.textlive.net",), ("aozora.textlive.net",))
    for url in (
        "http://www.gutenberg.org/files/1.txt",
        "https://evil.example/files/1.txt",
        "https://www.gutenberg.org.evil.example/files/1.txt",
        "https://user:pass@www.gutenberg.org/files/1.txt",
        "https://www.gutenberg.org:444/files/1.txt",
    ):
        with pytest.raises(FetchError):
            _allowed(url, ("www.gutenberg.org",), ())


def test_book_id_cannot_point_at_another_host():
    token = pack_path("https://www.gutenberg.org/files/1342/1342-0.txt", ("www.gutenberg.org",))
    assert token is not None
    assert "gutenberg.org" not in token
    assert unpack_path(token, ("www.gutenberg.org",), ()) == "https://www.gutenberg.org/files/1342/1342-0.txt"
    assert pack_path("https://evil.example/secret", ("www.gutenberg.org",)) is None
    with pytest.raises(FetchError):
        unpack_path(pack_path("https://www.gutenberg.org/../secret", ("www.gutenberg.org",)) or "0.e30", ("www.gutenberg.org",), ())


def test_gutenberg_search_and_text_file(monkeypatch):
    seen = []

    def fake_get(url, hosts, allow_http=()):
        seen.append(url)
        _allowed(url, hosts, allow_http)
        if url.endswith(".txt"):
            return b"The Project Gutenberg eBook\n\nHello.", "text/plain"
        if url.endswith(".epub"):
            return b"PK\x03\x04epub", "application/epub+zip"
        return GUTENBERG_FEED, "application/atom+xml"

    monkeypatch.setattr("open_book.open_books.providers.get", fake_get)
    found = Gutenberg().find("pride", "en", None)
    assert found.books[0].id == "1342"
    assert found.books[0].license == "public-domain"
    assert found.page == "26"
    assert all("http" not in book.id for book in found.books)
    data, media, name = Gutenberg().file("1342", "text/plain")
    assert media == "text/plain" and data.startswith(b"The Project") and name.endswith(".txt")
    assert seen[-1] == "https://www.gutenberg.org/files/1342/1342-0.txt"
    epub, epub_media, epub_name = Gutenberg().file("1342", "application/epub+zip")
    assert epub_media == "application/epub+zip" and epub.startswith(b"PK") and epub_name.endswith(".epub")
    assert seen[-1] == "https://www.gutenberg.org/cache/epub/1342/pg1342-images.epub"


def test_open_library_drops_borrowable(monkeypatch):
    def fake_get(url, hosts, allow_http=()):
        _allowed(url, hosts, allow_http)
        assert "ebook_access=public" in url
        return OL_JSON, "application/json"

    monkeypatch.setattr("open_book.open_books.providers.get", fake_get)
    found = OpenLibrary().find("austen", "en", None)
    assert [book.id for book in found.books] == ["public_item"]
    assert found.books[0].formats[0].addable is True


def test_routes_hide_source_urls(monkeypatch):
    def fake_get(url, hosts, allow_http=()):
        _allowed(url, hosts, allow_http)
        if "search.opds" in url:
            return GUTENBERG_FEED, "application/atom+xml"
        if url.endswith(".epub"):
            return b"PK\x03\x04epub-bytes", "application/octet-stream"
        return b"Hello from the catalog.", "text/plain"

    monkeypatch.setattr("open_book.open_books.providers.get", fake_get)
    client = TestClient(app)
    listed = client.get("/v1/open-books/providers")
    assert listed.status_code == 200
    ids = [item["id"] for item in listed.json()["providers"]]
    assert ids[:3] == ["gutenberg", "openlibrary", "standardebooks"]
    assert "hosts" not in listed.text
    found = client.get("/v1/open-books/gutenberg", params={"q": "pride", "language": "en"})
    assert found.status_code == 200
    body = found.json()
    assert body["books"][0]["id"] == "1342"
    assert "http://" not in found.text and "https://" not in found.text
    assert "url" not in found.text
    downloaded = client.post("/v1/open-books/gutenberg/1342", json={"mediaType": "text/plain"})
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"Hello")
    assert downloaded.headers["content-type"].startswith("text/plain")
    epub = client.post("/v1/open-books/gutenberg/1342", json={"mediaType": "application/epub+zip"})
    assert epub.status_code == 200
    assert epub.content.startswith(b"PK")
    assert epub.headers["content-type"].startswith("application/epub+zip")


def test_catalog_routes_allow_a_static_site():
    client = TestClient(app)
    options = client.options("/v1/open-books/providers")
    assert options.status_code == 204
    assert options.headers["access-control-allow-origin"] == "*"
    assert options.headers["access-control-allow-methods"] == "GET, POST, OPTIONS"
    health = client.get("/v1/health")
    assert health.status_code == 200
    assert health.headers["access-control-allow-origin"] == "*"
    other = client.post("/v1/speak", json={})
    assert "access-control-allow-origin" not in other.headers
