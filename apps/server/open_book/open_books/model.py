"""The book fields every provider returns. No source URL."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Format:
    media_type: str
    label: str
    addable: bool


@dataclass(frozen=True)
class Book:
    id: str
    title: str
    authors: tuple[str, ...]
    languages: tuple[str, ...]
    year: str | None
    license: str
    license_note: str
    formats: tuple[Format, ...]


@dataclass(frozen=True)
class SearchPage:
    books: tuple[Book, ...]
    page: str | None


def public(note: str) -> tuple[str, str]:
    return "public-domain", note


def open_license(note: str) -> tuple[str, str]:
    return "open-license", note
