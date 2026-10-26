"""Legal catalogs behind one search and one file download.

Each class is the same interface. The browse screen does not branch on which one it is.
"""

import hashlib
import json
import re
from urllib.parse import quote, urlencode, urlparse

from open_book.open_books.htmltext import html_to_text
from open_book.open_books.http import FetchError, get
from open_book.open_books.model import Book, Format, SearchPage
from open_book.open_books.opds import Entry, Feed, acquisition_links, is_open_access, parse_feed
from open_book.open_books.refs import pack_path, unpack_path

PDF = Format("application/pdf", "PDF", True)
TEXT = Format("text/plain", "Text", True)
EPUB = Format("application/epub+zip", "EPUB", False)
_SE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}(?:/[a-z0-9][a-z0-9_-]{0,80}){0,4}$")
_IA_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,160}$")
_SITE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$")
_OL_LANG = {
    "en": "eng",
    "fr": "fre",
    "de": "ger",
    "es": "spa",
    "it": "ita",
    "pt": "por",
    "pl": "pol",
    "nl": "dut",
    "sv": "swe",
    "ja": "jpn",
    "zh": "chi",
    "fi": "fin",
    "no": "nor",
}
WIKI_LANGS = ("en", "fr", "de", "es", "it", "pt", "pl", "nl", "sv", "ja", "zh")


def _page(token: str | None) -> int:
    if not token:
        return 1
    if token.isdigit() and 0 < int(token) < 10000:
        return int(token)
    raise FetchError(404, "That page is not part of this catalog.")


def _filename(title: str, suffix: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in " .-'()" else " " for char in title)
    cleaned = " ".join(cleaned.split())[:80] or "book"
    return f"{cleaned}.{suffix}"


def _kept(entry: Entry, default: str | None) -> tuple[str, str] | None:
    blob = f"{entry.rights} {entry.summary} {entry.title}".lower()
    blocked = ("all rights reserved", "under copyright", "freemium", "tous droits réservés")
    free = ("public domain", "domaine public", "cc0", "cc by", "creative commons", "open access", "licence ouverte")
    if any(word in blob for word in blocked) and not any(word in blob for word in free):
        return None
    if "public domain" in blob or "domaine public" in blob:
        return "public-domain", entry.rights or "Public domain"
    if any(word in blob for word in ("cc0", "cc by", "creative commons", "open access", "licence ouverte")):
        return "open-license", entry.rights or "Open license"
    if default == "public-domain":
        return "public-domain", entry.rights or "Public domain"
    if default == "open-license":
        return "open-license", entry.rights or "Open license"
    return None


def _formats(entry: Entry, *, html_as_text: bool) -> tuple[Format, ...]:
    found: dict[str, Format] = {}
    for link in acquisition_links(entry):
        media = link.type
        if html_as_text and media in {"text/html", "application/xhtml+xml"}:
            media = "text/plain"
        if media in {"text/plain", "text/plain; charset=utf-8"}:
            found["text/plain"] = TEXT
        elif media == "application/pdf":
            found["application/pdf"] = PDF
        elif media == "application/epub+zip":
            found.setdefault("application/epub+zip", EPUB)
    order = ("text/plain", "application/pdf", "application/epub+zip")
    return tuple(found[key] for key in order if key in found)


def _preferred(entry: Entry, *, html_as_text: bool):
    ranked = []
    for link in acquisition_links(entry):
        media = link.type
        if media.startswith("text/plain"):
            ranked.append((0, link, "text/plain"))
        elif html_as_text and media in {"text/html", "application/xhtml+xml"}:
            ranked.append((1, link, "text/plain"))
        elif media == "application/pdf":
            ranked.append((2, link, "application/pdf"))
    if not ranked:
        return None
    ranked.sort(key=lambda item: item[0])
    return ranked[0][1], ranked[0][2]


class Gutenberg:
    id = "gutenberg"
    name = "Project Gutenberg"
    search = True
    languages = ("en", "fr", "de", "es", "it", "pt", "fi", "nl", "zh")
    note = ""
    hosts = ("www.gutenberg.org",)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        start = 1 if page in (None, "", "1") else _page(page)
        lang = language if language in self.languages else "en"
        query = f"l.{lang}"
        if q.strip():
            query = f"{q.strip()} {query}"
        url = "https://www.gutenberg.org/ebooks/search.opds/?query=" + quote(query)
        if start > 1:
            url += f"&start_index={start}"
        raw, _media = get(url, self.hosts)
        feed = parse_feed(raw, url)
        books = []
        for entry in feed.entries:
            match = re.search(r"/ebooks/(\d+)", entry.entry_id)
            if not match:
                continue
            books.append(
                Book(
                    match.group(1),
                    entry.title,
                    tuple(entry.authors[:4]),
                    tuple(entry.languages[:3]) or (lang,),
                    entry.year,
                    "public-domain",
                    "Public domain in the USA.",
                    (TEXT, EPUB),
                )
            )
        next_page = None
        if feed.next_href:
            match = re.search(r"start_index=(\d+)", feed.next_href)
            if match:
                next_page = match.group(1)
        return SearchPage(tuple(books), next_page)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if not book_id.isdigit() or media_type != "text/plain":
            raise FetchError(404, "That format is not available.")
        last: FetchError | None = None
        for url in (
            f"https://www.gutenberg.org/files/{book_id}/{book_id}-0.txt",
            f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt",
        ):
            try:
                data, media = get(url, self.hosts)
            except FetchError as exc:
                last = exc
                continue
            if media.startswith("text/"):
                return data, "text/plain", f"{book_id}.txt"
            last = FetchError(404, "That format is not available.")
        raise last or FetchError(404, "That format is not available.")

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        if not book_id.isdigit():
            return None
        try:
            data, media = get(
                f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.cover.medium.jpg",
                self.hosts,
            )
        except FetchError:
            return None
        if not media.startswith("image/"):
            return None
        return data, media


class OpenLibrary:
    id = "openlibrary"
    name = "Open Library"
    search = True
    languages = tuple(_OL_LANG)
    note = "Public-domain ebooks"
    hosts = ("openlibrary.org", "archive.org")

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        number = _page(page)
        params = {
            "q": q.strip() or "literature",
            "ebook_access": "public",
            "limit": "20",
            "page": str(number),
            "fields": "title,author_name,ia,ebook_access,language,first_publish_year",
        }
        if language in _OL_LANG:
            params["language"] = _OL_LANG[language]
        url = "https://openlibrary.org/search.json?" + urlencode(params)
        raw, _media = get(url, self.hosts)
        payload = json.loads(raw)
        books = []
        for doc in payload.get("docs") or []:
            if doc.get("ebook_access") != "public":
                continue
            identifiers = doc.get("ia") or []
            if isinstance(identifiers, str):
                identifiers = [identifiers]
            ia_id = next((item for item in identifiers if isinstance(item, str) and _IA_ID.fullmatch(item)), None)
            if not ia_id:
                continue
            year = doc.get("first_publish_year")
            authors = doc.get("author_name") or []
            books.append(
                Book(
                    ia_id,
                    str(doc.get("title") or "Untitled"),
                    tuple(str(name) for name in authors[:4]),
                    (language or "en",),
                    str(year) if isinstance(year, int) else None,
                    "public-domain",
                    "Public-domain ebook on Open Library.",
                    (TEXT, PDF),
                )
            )
        found = int(payload.get("numFound") or 0)
        next_page = str(number + 1) if number * 20 < found else None
        return SearchPage(tuple(books), next_page)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if not _IA_ID.fullmatch(book_id) or media_type not in {"text/plain", "application/pdf"}:
            raise FetchError(404, "That format is not available.")
        raw, _media = get(f"https://archive.org/metadata/{book_id}", self.hosts)
        chosen = _archive_file(json.loads(raw).get("files") or [], media_type)
        if chosen is None:
            raise FetchError(404, "That format is not available.")
        name, returned = chosen
        data, media = get(f"https://archive.org/download/{quote(book_id)}/{quote(name)}", self.hosts)
        if returned == "application/pdf" and media != "application/pdf":
            raise FetchError(404, "That format is not available.")
        if returned == "text/plain" and not media.startswith("text/"):
            raise FetchError(404, "That format is not available.")
        return data, returned, name

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        if not _IA_ID.fullmatch(book_id):
            return None
        try:
            data, media = get(f"https://archive.org/services/img/{quote(book_id)}", self.hosts)
        except FetchError:
            return None
        if not media.startswith("image/"):
            return None
        return data, media


def _archive_file(files: list[dict], media_type: str) -> tuple[str, str] | None:
    ranked: list[tuple[int, int, str, str]] = []
    for item in files:
        name = str(item.get("name") or "")
        if not name or "/" in name or "\\" in name or name.startswith("."):
            continue
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        if size <= 0 or size > 40 * 1024 * 1024:
            continue
        fmt = str(item.get("format") or "")
        lower = name.lower()
        if media_type == "text/plain" and lower.endswith(".txt") and "Text" in fmt:
            ranked.append((0 if "_djvu" not in lower else 1, size, name, "text/plain"))
        elif media_type == "application/pdf" and lower.endswith(".pdf") and "PDF" in fmt:
            ranked.append((0, size, name, "application/pdf"))
    if not ranked:
        return None
    ranked.sort()
    _rank, _size, name, returned = ranked[0]
    return name, returned


class StandardEbooks:
    id = "standardebooks"
    name = "Standard Ebooks"
    search = False
    languages = ("en",)
    note = "New releases"
    hosts = ("standardebooks.org",)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del q, language, page
        url = "https://standardebooks.org/feeds/atom/new-releases"
        raw, _media = get(url, self.hosts)
        feed = parse_feed(raw, url)
        books = []
        prefix = "https://standardebooks.org/ebooks/"
        for entry in feed.entries:
            if not entry.entry_id.startswith(prefix):
                continue
            book_id = entry.entry_id[len(prefix) :].strip("/")
            if not _SE_ID.fullmatch(book_id):
                continue
            books.append(
                Book(
                    book_id,
                    entry.title,
                    tuple(entry.authors[:4]),
                    ("en",),
                    entry.year,
                    "public-domain",
                    "Public domain. Standard Ebooks edition.",
                    (TEXT, EPUB),
                )
            )
        return SearchPage(tuple(books), None)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if media_type != "text/plain" or not _SE_ID.fullmatch(book_id):
            raise FetchError(404, "That format is not available.")
        raw, media = get(f"https://standardebooks.org/ebooks/{book_id}/text/single-page", self.hosts)
        if "html" not in media and "xml" not in media:
            raise FetchError(404, "That format is not available.")
        text = html_to_text(raw)
        if len(text) < 200:
            raise FetchError(404, "That format is not available.")
        return text.encode("utf-8"), "text/plain", _filename(book_id.split("/")[-1], "txt")

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class EbooksGratuits:
    id = "ebooksgratuits"
    name = "Ebooks libres et gratuits"
    search = True
    languages = ("fr",)
    note = ""
    hosts = ("www.ebooksgratuits.com",)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language
        number = _page(page)
        url = "https://www.ebooksgratuits.com/opds/feed.php?mode=search&query=" + quote(q.strip())
        if number > 1:
            url += f"&page={number - 1}"
        raw, _media = get(url, self.hosts)
        return _opds_page(raw, url, self.hosts, "public-domain", html_as_text=False, query="")

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if media_type != "application/pdf" or not book_id.isdigit():
            raise FetchError(404, "That format is not available.")
        data, media = get(
            f"https://www.ebooksgratuits.com/newsendbook.php?id={book_id}&format=pdf",
            self.hosts,
        )
        if media != "application/pdf":
            raise FetchError(404, "That format is not available.")
        return data, "application/pdf", f"{book_id}.pdf"

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class WolneLektury:
    id = "wolnelektury"
    name = "Wolne Lektury"
    search = True
    languages = ("pl",)
    note = ""
    hosts = ("wolnelektury.pl",)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language, page
        query = q.strip() or "a"
        url = "https://wolnelektury.pl/opds/search/?q=" + quote(query)
        raw, _media = get(url, self.hosts)
        feed = parse_feed(raw, url)
        books = []
        for entry in feed.entries:
            slug = _wolne_slug(entry)
            if not slug:
                continue
            kept = _kept(entry, "public-domain")
            if kept is None:
                continue
            license_name, note = kept
            books.append(
                Book(slug, entry.title, tuple(entry.authors[:4]), ("pl",), entry.year, license_name, note or "Public domain.", (TEXT, PDF, EPUB))
            )
        return SearchPage(tuple(books[:20]), None)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if not _SLUG.fullmatch(book_id) or media_type not in {"text/plain", "application/pdf"}:
            raise FetchError(404, "That format is not available.")
        raw, _media = get(f"https://wolnelektury.pl/api/books/{book_id}/", self.hosts)
        payload = json.loads(raw)
        key = "txt" if media_type == "text/plain" else "pdf"
        href = str(payload.get(key) or "")
        if urlparse(href).hostname != "wolnelektury.pl":
            raise FetchError(404, "That format is not available.")
        data, media = get(href, self.hosts)
        if media_type == "application/pdf" and media != "application/pdf":
            raise FetchError(404, "That format is not available.")
        if media_type == "text/plain" and not media.startswith("text/"):
            raise FetchError(404, "That format is not available.")
        suffix = "txt" if media_type == "text/plain" else "pdf"
        return data, media_type, _filename(str(payload.get("title") or book_id), suffix)

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        if not _SLUG.fullmatch(book_id):
            return None
        try:
            raw, _media = get(f"https://wolnelektury.pl/api/books/{book_id}/", self.hosts)
            href = str(json.loads(raw).get("cover") or "")
            if urlparse(href).hostname != "wolnelektury.pl":
                return None
            data, media = get(href, self.hosts)
        except (FetchError, json.JSONDecodeError):
            return None
        if not media.startswith("image/"):
            return None
        return data, media


def _wolne_slug(entry: Entry) -> str:
    candidates = [entry.entry_id, *[link.href for link in entry.links]]
    for candidate in candidates:
        for marker in ("/lektura/", "/api/books/", "/book/"):
            if marker in candidate:
                slug = candidate.split(marker, 1)[1].strip("/").split("/")[0]
                if _SLUG.fullmatch(slug):
                    return slug
    return ""


class Textos:
    id = "textos"
    name = "Textos.info"
    search = True
    languages = ("es",)
    note = ""
    hosts = ("textos.info", "www.textos.info")
    root = "https://www.textos.info/opds"
    allow_http: tuple[str, ...] = ()
    default_license = "public-domain"
    html_as_text = False

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language, page
        return _feed_search(self, q)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        return _feed_file(self, book_id, media_type)

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class Aozora:
    id = "aozora"
    name = "Aozora Bunko"
    search = True
    languages = ("ja",)
    note = ""
    hosts = ("aozora.textlive.net",)
    root = "http://aozora.textlive.net/catalog.opds"
    allow_http = ("aozora.textlive.net",)
    default_license = "public-domain"
    html_as_text = False

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language, page
        return _feed_search(self, q)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        return _feed_file(self, book_id, media_type)

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class ImWerden:
    id = "imwerden"
    name = "ImWerden"
    search = True
    languages = ("ru",)
    note = "New arrivals marked free to copy"
    hosts = ("imwerden.de",)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language
        number = _page(page)
        url = "https://imwerden.de/opds/new.php" if number == 1 else f"https://imwerden.de/opds/new.php?page={number}"
        raw, _media = get(url, self.hosts)
        feed = parse_feed(raw, url)
        books = []
        for entry in feed.entries:
            if not is_open_access(entry):
                continue
            if q.strip() and q.strip().lower() not in entry.title.lower():
                continue
            picked = _preferred(entry, html_as_text=False)
            if picked is None or picked[1] != "application/pdf":
                continue
            token = pack_path(picked[0].href, self.hosts)
            if token is None:
                continue
            books.append(
                Book(token, entry.title, tuple(entry.authors[:4]), ("ru",), entry.year, "open-license", "Marked open access.", (PDF,))
            )
        next_page = str(number + 1) if feed.next_href else None
        return SearchPage(tuple(books[:20]), next_page)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        if media_type != "application/pdf":
            raise FetchError(404, "That format is not available.")
        data, media = get(unpack_path(book_id, self.hosts, ()), self.hosts)
        if media != "application/pdf":
            raise FetchError(404, "That format is not available.")
        return data, "application/pdf", "book.pdf"

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class Bokselskap:
    id = "bokselskap"
    name = "bokselskap.no"
    search = True
    languages = ("no",)
    note = "EPUB is listed and not downloaded yet"
    hosts = ("www.bokselskap.no",)
    root = "https://www.bokselskap.no/wp-content/themes/bokselskap/tekster/opds/opds-katalog/opds_bokselskap_titler_nb_NO.xml"
    allow_http: tuple[str, ...] = ()
    default_license = "public-domain"
    html_as_text = False

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language, page
        return _feed_search(self, q)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        return _feed_file(self, book_id, media_type)

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class Cbeta:
    id = "cbeta"
    name = "CBETA"
    search = True
    languages = ("zh",)
    note = ""
    hosts = ("www.cbeta.org", "archive2.cbeta.org")
    root = "https://www.cbeta.org/opds"
    allow_http: tuple[str, ...] = ()
    default_license = "open-license"
    html_as_text = False

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language, page
        return _feed_search(self, q)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        return _feed_file(self, book_id, media_type)

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class OpenEdition:
    id = "openedition"
    name = "OpenEdition"
    search = True
    languages = ("fr", "en", "es", "pt", "it", "de")
    note = "Search by publisher"
    hosts = ("opds.openedition.org", "books.openedition.org")

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        del language
        number = _page(page)
        raw, _media = get("https://opds.openedition.org/?platform=OB&core=publishers&limit=200", self.hosts)
        publishers = parse_feed(raw, "https://opds.openedition.org/")
        sites = []
        for entry in publishers.entries:
            site = urlparse(entry.entry_id).path.strip("/").split("/")[-1]
            if not _SITE.fullmatch(site):
                continue
            if q.strip() and q.strip().lower() not in entry.title.lower() and q.strip().lower() not in site.lower():
                continue
            sites.append(site)
        if not sites:
            return SearchPage((), None)
        site = sites[0]
        url = (
            "https://opds.openedition.org/?platform=OB&core=documents"
            f"&siteName={quote(site)}&start={number}&limit=20"
        )
        raw, _media = get(url, self.hosts)
        feed = parse_feed(raw, url)
        books = []
        for entry in feed.entries:
            if _kept(entry, None) is None and "freemium" in f"{entry.summary} {entry.rights}".lower():
                continue
            if "freemium" in f"{entry.summary} {entry.rights}".lower():
                continue
            match = re.fullmatch(r"OB\.([A-Za-z0-9_-]+)\.(\d+)", entry.entry_id)
            if not match:
                continue
            books.append(
                Book(
                    f"{match.group(1)}:{match.group(2)}",
                    entry.title,
                    tuple(entry.authors[:4]),
                    tuple(entry.languages[:3]) or ("fr",),
                    entry.year,
                    "open-license",
                    "Open access on OpenEdition.",
                    (PDF, EPUB),
                )
            )
        next_page = str(number + 1) if feed.next_href else None
        return SearchPage(tuple(books), next_page)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        site, sep, number = book_id.partition(":")
        if media_type != "application/pdf" or not sep or not _SITE.fullmatch(site) or not number.isdigit():
            raise FetchError(404, "That format is not available.")
        data, media = get(f"https://books.openedition.org/{site}/pdf/{number}", self.hosts)
        if media != "application/pdf":
            raise FetchError(404, "That format is not available.")
        return data, "application/pdf", f"{number}.pdf"

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


class Wikisource:
    id = "wikisource"
    name = "Wikisource"
    search = True
    languages = WIKI_LANGS
    note = ""
    hosts = tuple(f"{lang}.wikisource.org" for lang in WIKI_LANGS)

    def find(self, q: str, language: str, page: str | None) -> SearchPage:
        lang = language if language in WIKI_LANGS else "en"
        number = _page(page)
        host = f"{lang}.wikisource.org"
        url = f"https://{host}/w/api.php?" + urlencode(
            {
                "action": "query",
                "list": "search",
                "srsearch": q.strip() or "literature",
                "srnamespace": "0",
                "format": "json",
                "srlimit": "20",
                "sroffset": str((number - 1) * 20),
            }
        )
        raw, _media = get(url, self.hosts)
        payload = json.loads(raw)
        books = []
        for hit in (payload.get("query") or {}).get("search") or []:
            title = str(hit.get("title") or "").strip()
            if not title or len(title) > 180 or "/" in title or ":" in title:
                continue
            books.append(
                Book(
                    f"{lang}:{title}",
                    title,
                    (),
                    (lang,),
                    None,
                    "open-license",
                    "Wikisource text. A copyrighted page is dropped at download.",
                    (TEXT,),
                )
            )
        offset = (payload.get("continue") or {}).get("sroffset")
        next_page = str(number + 1) if isinstance(offset, int) else None
        return SearchPage(tuple(books), next_page)

    def file(self, book_id: str, media_type: str) -> tuple[bytes, str, str]:
        lang, sep, title = book_id.partition(":")
        if media_type != "text/plain" or not sep or lang not in WIKI_LANGS or not title or "/" in title:
            raise FetchError(404, "That format is not available.")
        host = f"{lang}.wikisource.org"
        raw, _media = get(
            f"https://{host}/w/api.php?"
            + urlencode({"action": "query", "prop": "categories", "titles": title, "cllimit": "50", "format": "json"}),
            self.hosts,
        )
        pages = (json.loads(raw).get("query") or {}).get("pages") or {}
        for page in pages.values():
            if "missing" in page:
                raise FetchError(404, "That page is not in this catalog.")
            for category in page.get("categories") or []:
                name = str(category.get("title") or "").lower()
                if "copyright" in name or "non-free" in name or "all rights reserved" in name:
                    raise FetchError(404, "That page is not free to keep.")
        html, media = get(f"https://{host}/w/rest.php/v1/page/{quote(title.replace(' ', '_'))}/html", self.hosts)
        if "html" not in media:
            raise FetchError(404, "That format is not available.")
        text = html_to_text(html)
        if len(text) < 40:
            raise FetchError(404, "That format is not available.")
        return text.encode("utf-8"), "text/plain", _filename(title, "txt")

    def cover(self, book_id: str) -> tuple[bytes, str] | None:
        del book_id
        return None


def _feed_search(provider, q: str) -> SearchPage:
    return SearchPage(tuple(_descend(provider, provider.root, q.strip().lower(), 0)[:20]), None)


def _descend(provider, url: str, q: str, depth: int) -> list[Book]:
    raw, _media = get(url, provider.hosts, allow_http=provider.allow_http)
    feed = parse_feed(raw, url)
    books = _books_from(feed, provider, q)
    if books or depth >= 3:
        return books
    children: list[tuple[str, str]] = []
    for entry in feed.entries:
        for link in entry.links:
            host = (urlparse(link.href).hostname or "").lower()
            if host not in provider.hosts:
                continue
            if "atom" not in link.type and link.rel not in {"subsection", "alternate"}:
                continue
            children.append((entry.title.lower(), link.href))
    if q:
        matched = [href for title, href in children if q in title]
        children_hrefs = matched or ([children[0][1]] if children else [])
    else:
        children_hrefs = [href for _title, href in children[:1]]
    found: list[Book] = []
    for href in children_hrefs[:2]:
        found.extend(_descend(provider, href, q, depth + 1))
        if len(found) >= 20:
            break
    return found


def _books_from(feed: Feed, provider, q: str) -> list[Book]:
    books = []
    for entry in feed.entries:
        if q.strip() and q.strip().lower() not in entry.title.lower():
            continue
        kept = _kept(entry, provider.default_license)
        if kept is None:
            continue
        if provider.id == "imwerden" and not is_open_access(entry):
            continue
        formats = _formats(entry, html_as_text=provider.html_as_text)
        picked = _preferred(entry, html_as_text=provider.html_as_text)
        if picked is None:
            if EPUB in formats:
                digest = hashlib.sha256(entry.entry_id.encode()).hexdigest()[:16]
                books.append(
                    Book(
                        f"epub.{digest}",
                        entry.title,
                        tuple(entry.authors[:4]),
                        tuple(entry.languages[:3]),
                        entry.year,
                        kept[0],
                        kept[1],
                        (EPUB,),
                    )
                )
            continue
        token = pack_path(picked[0].href, provider.hosts)
        if token is None:
            continue
        shown = tuple(fmt for fmt in formats if fmt.addable or fmt.media_type == "application/epub+zip")
        if not any(fmt.addable for fmt in shown):
            shown = (formats[0],) if formats else ()
        if not shown:
            continue
        books.append(Book(token, entry.title, tuple(entry.authors[:4]), tuple(entry.languages[:3]), entry.year, kept[0], kept[1], shown))
    return books


def _feed_file(provider, book_id: str, media_type: str) -> tuple[bytes, str, str]:
    if media_type not in {"text/plain", "application/pdf"}:
        raise FetchError(404, "That format is not available.")
    url = unpack_path(book_id, provider.hosts, provider.allow_http)
    data, media = get(url, provider.hosts, allow_http=provider.allow_http)
    if media_type == "text/plain" and media in {"text/html", "application/xhtml+xml"} and provider.html_as_text:
        text = html_to_text(data)
        return text.encode("utf-8"), "text/plain", "book.txt"
    if media_type == "text/plain" and media.startswith("text/plain"):
        return data, "text/plain", "book.txt"
    if media_type == "application/pdf" and media == "application/pdf":
        return data, "application/pdf", "book.pdf"
    raise FetchError(404, "That format is not available.")


def _opds_page(raw: bytes, url: str, hosts: tuple[str, ...], default: str, *, html_as_text: bool, query: str) -> SearchPage:
    del hosts, html_as_text, query
    feed = parse_feed(raw, url)
    numbered = []
    for entry in feed.entries:
        kept = _kept(entry, default)
        if kept is None:
            continue
        match = re.search(r"book=(\d+)", entry.entry_id)
        if not match:
            continue
        formats = _formats(entry, html_as_text=False) or (PDF, EPUB)
        numbered.append(
            Book(match.group(1), entry.title, tuple(entry.authors[:4]), ("fr",), entry.year, kept[0], kept[1], formats)
        )
    next_page = None
    if feed.next_href:
        match = re.search(r"[?&]page=(\d+)", feed.next_href)
        if match:
            next_page = str(int(match.group(1)) + 1)
    return SearchPage(tuple(numbered[:20]), next_page)


PROVIDERS = (
    Gutenberg(),
    OpenLibrary(),
    StandardEbooks(),
    EbooksGratuits(),
    WolneLektury(),
    Textos(),
    Aozora(),
    ImWerden(),
    Bokselskap(),
    Cbeta(),
    OpenEdition(),
    Wikisource(),
)


def by_id(provider_id: str):
    for provider in PROVIDERS:
        if provider.id == provider_id:
            return provider
    return None
