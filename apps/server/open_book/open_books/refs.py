"""A book id can name a path on a provider's own host. It cannot name a URL."""

import base64
from urllib.parse import urlparse

from open_book.open_books.http import FetchError


def pack_path(href: str, hosts: tuple[str, ...]) -> str | None:
    parsed = urlparse(href)
    host = (parsed.hostname or "").lower().rstrip(".")
    if host not in hosts or parsed.scheme not in {"http", "https"}:
        return None
    path = parsed.path or "/"
    if not path.startswith("/") or "\\" in path or ".." in path.split("/"):
        return None
    blob = path + (f"?{parsed.query}" if parsed.query else "")
    token = base64.urlsafe_b64encode(blob.encode()).decode().rstrip("=")
    return f"{hosts.index(host)}.{token}"


def unpack_path(token: str, hosts: tuple[str, ...], allow_http: tuple[str, ...]) -> str:
    index_text, dot, encoded = token.partition(".")
    if not dot or not index_text.isdigit():
        raise FetchError(404, "That book is not in this catalog.")
    index = int(index_text)
    if index >= len(hosts):
        raise FetchError(404, "That book is not in this catalog.")
    pad = "=" * (-len(encoded) % 4)
    try:
        blob = base64.urlsafe_b64decode(encoded + pad).decode()
    except Exception as exc:
        raise FetchError(404, "That book is not in this catalog.") from exc
    path = blob.split("?", 1)[0]
    if not path.startswith("/") or "\\" in blob or ".." in path.split("/") or "://" in blob:
        raise FetchError(404, "That book is not in this catalog.")
    host = hosts[index]
    scheme = "http" if host in allow_http else "https"
    return f"{scheme}://{host}{blob}"
