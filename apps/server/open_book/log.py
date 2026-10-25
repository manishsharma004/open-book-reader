"""Server log lines for /v1. Bodies, keys, and book text stay out."""

import logging
import time

from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("open_book")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.propagate = False


def note_vendor(request: Request, vendor: str) -> None:
    request.state.vendor = vendor


def public_text(value: str, limit: int) -> str:
    cleaned = []
    for char in value:
        cleaned.append(char if char.isprintable() and char not in "\r\n\t" else " ")
    text = " ".join("".join(cleaned).split())
    lowered = text.lower()
    if "bearer " in lowered or "sk-" in lowered or "api_key" in lowered or "apikey" in lowered:
        return "[redacted]"
    return text[:limit]


async def observe_v1(request: Request, call_next) -> Response:
    path = request.url.path
    if not path.startswith("/v1"):
        return await call_next(request)
    request.state.vendor = "-"
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("proxy crash method=%s route=%s", request.method, path)
        raise
    elapsed = int((time.perf_counter() - started) * 1000)
    vendor = getattr(request.state, "vendor", "-")
    logger.info(
        "proxy method=%s route=%s vendor=%s status=%s ms=%s",
        request.method,
        path,
        vendor,
        response.status_code,
        elapsed,
    )
    return response
