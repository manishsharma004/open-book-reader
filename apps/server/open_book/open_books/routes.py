"""Same-origin routes for every open-book provider."""

import json
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from open_book.log import note_vendor
from open_book.open_books.http import FetchError
from open_book.open_books.providers import by_id

router = APIRouter()


class FileBody(BaseModel):
    mediaType: str = Field(max_length=80)


def _provider(provider_id: str, request: Request):
    note_vendor(request, provider_id)
    provider = by_id(provider_id)
    if provider is None:
        raise HTTPException(404, "That provider is not registered.")
    return provider


def _call(action):
    try:
        return action()
    except FetchError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "The catalog returned data that could not be read.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "The catalog could not be reached.") from exc


def _book(provider_id: str, book) -> dict:
    if book.license not in {"public-domain", "open-license"}:
        raise HTTPException(404, "That book is not free to keep.")
    return {
        "provider": provider_id,
        "id": book.id,
        "title": book.title,
        "authors": list(book.authors),
        "languages": list(book.languages),
        "year": book.year,
        "license": book.license,
        "licenseNote": book.license_note,
        "formats": [
            {"mediaType": fmt.media_type, "label": fmt.label, "addable": fmt.addable} for fmt in book.formats
        ],
    }


@router.get("/v1/open-books/providers")
def providers(request: Request) -> dict:
    note_vendor(request, "open-books")
    from open_book.open_books.providers import PROVIDERS

    return {
        "providers": [
            {
                "id": provider.id,
                "name": provider.name,
                "search": provider.search,
                "languages": list(provider.languages),
                "note": provider.note,
            }
            for provider in PROVIDERS
        ]
    }


@router.get("/v1/open-books/{provider_id}")
def search(provider_id: str, request: Request, q: str = "", language: str = "", page: str = "") -> dict:
    provider = _provider(provider_id, request)
    found = _call(lambda: provider.find(q[:200], language[:12], page[:40] or None))
    return {"books": [_book(provider.id, book) for book in found.books], "page": found.page}


@router.post("/v1/open-books/{provider_id}/{book_id:path}")
def download(provider_id: str, book_id: str, body: FileBody, request: Request) -> Response:
    provider = _provider(provider_id, request)
    media_type = body.mediaType.split(";", 1)[0].strip().lower()
    data, media, filename = _call(lambda: provider.file(book_id, media_type))
    if media not in {"text/plain", "application/pdf", "application/epub+zip"}:
        raise HTTPException(404, "That format is not available.")
    disposition = "attachment; filename*=UTF-8''" + quote(filename)
    return Response(content=data, media_type=media, headers={"Content-Disposition": disposition, "Cache-Control": "no-store"})


@router.get("/v1/open-books/{provider_id}/{book_id}/cover")
def cover(provider_id: str, book_id: str, request: Request) -> Response:
    provider = _provider(provider_id, request)
    found = _call(lambda: provider.cover(book_id))
    if found is None:
        raise HTTPException(404, "That book has no cover.")
    data, media = found
    if not media.startswith("image/"):
        raise HTTPException(404, "That book has no cover.")
    return Response(content=data, media_type=media, headers={"Cache-Control": "no-store"})
