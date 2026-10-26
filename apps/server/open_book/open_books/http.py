"""Fetch a catalog file from hosts that provider named.

Speech forwarding does not use this. Redirects stay on the provider's list.
"""

from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = 40 * 1024 * 1024
TIMEOUT = 60.0
MAX_REDIRECTS = 3
USER_AGENT = "OpenBookReader/0.1 (https://github.com/manishsharma004/open-book-reader)"


class FetchError(Exception):
    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(message)


def _allowed(url: str, hosts: tuple[str, ...], allow_http: tuple[str, ...]) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.username or parsed.password or not host or host not in hosts:
        raise FetchError(404, "That file is not on this provider's hosts.")
    if any(char in host for char in (" ", "\\")):
        raise FetchError(404, "That file is not on this provider's hosts.")
    port = parsed.port
    if parsed.scheme == "https":
        if port not in (None, 443):
            raise FetchError(404, "That file is not on this provider's hosts.")
        return
    if parsed.scheme == "http" and host in allow_http and port in (None, 80):
        return
    raise FetchError(404, "That file is not on this provider's hosts.")


def get(url: str, hosts: tuple[str, ...], *, allow_http: tuple[str, ...] = ()) -> tuple[bytes, str]:
    current = url
    seen = 0
    while True:
        _allowed(current, hosts, allow_http)
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
            with client.stream("GET", current) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location or seen >= MAX_REDIRECTS:
                        raise FetchError(502, "The catalog redirected too many times.")
                    seen += 1
                    current = urljoin(current, location)
                    continue
                if response.status_code == 404:
                    raise FetchError(404, "The catalog does not have that file.")
                if response.status_code >= 400:
                    raise FetchError(502, "The catalog did not return that file.")
                media = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip().lower()
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise FetchError(413, "That file is larger than 40 MB.")
                    chunks.append(chunk)
                return b"".join(chunks), media or "application/octet-stream"
