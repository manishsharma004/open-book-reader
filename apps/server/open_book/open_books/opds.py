"""Read an OPDS or Atom feed into entries. Both Atom namespaces show up in the wild."""

from dataclasses import dataclass, field
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

ATOM = "http://www.w3.org/2005/Atom"
ATOM_HTTPS = "https://www.w3.org/2005/Atom"
DCTERMS = "http://purl.org/dc/terms/"
DC = "http://purl.org/dc/elements/1.1/"

ACQUISITION = "http://opds-spec.org/acquisition"


@dataclass
class Link:
    rel: str
    type: str
    href: str
    title: str


@dataclass
class Entry:
    entry_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    year: str | None = None
    rights: str = ""
    summary: str = ""
    links: list[Link] = field(default_factory=list)


@dataclass
class Feed:
    entries: list[Entry]
    next_href: str | None


def _local(tag: str) -> str:
    if tag.startswith("{") and "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def _text(element: ET.Element, name: str) -> str:
    for child in element:
        if _local(child.tag) == name and (child.text or "").strip():
            return " ".join(child.text.split())
    return ""


def _texts(element: ET.Element, name: str) -> list[str]:
    found = []
    for child in list(element):
        if _local(child.tag) != name:
            continue
        if (child.text or "").strip():
            found.append(" ".join(child.text.split()))
        for nested in child.iter():
            if nested is not child and _local(nested.tag) == "name" and (nested.text or "").strip():
                found.append(" ".join(nested.text.split()))
    return found


def parse_feed(raw: bytes, base_url: str) -> Feed:
    root = ET.fromstring(raw)
    entries: list[Entry] = []
    next_href = None
    for child in root:
        if _local(child.tag) == "link" and _rel(child) == "next":
            href = child.attrib.get("href")
            if href:
                next_href = urljoin(base_url, href)
        if _local(child.tag) != "entry":
            continue
        entry = Entry(
            entry_id=_text(child, "id"),
            title=_text(child, "title") or "Untitled",
            authors=_texts(child, "author"),
            rights=_text(child, "rights"),
            summary=_text(child, "summary") or _text(child, "content"),
        )
        published = _text(child, "published") or _text(child, "issued")
        if len(published) >= 4 and published[:4].isdigit():
            entry.year = published[:4]
        for node in child.iter():
            if _local(node.tag) == "language" and (node.text or "").strip():
                entry.languages.append(node.text.strip()[:12])
            if _local(node.tag) != "link":
                continue
            href = node.attrib.get("href")
            if not href or href.startswith("data:"):
                continue
            entry.links.append(
                Link(
                    rel=_rel(node),
                    type=node.attrib.get("type", "").split(";", 1)[0].strip().lower(),
                    href=urljoin(base_url, href),
                    title=node.attrib.get("title", ""),
                )
            )
        entries.append(entry)
    return Feed(entries, next_href)


def _rel(element: ET.Element) -> str:
    rel = element.attrib.get("rel", "alternate")
    return rel.split()[-1] if rel else "alternate"


def acquisition_links(entry: Entry) -> list[Link]:
    found = []
    for link in entry.links:
        if link.rel == ACQUISITION or link.rel.endswith("/acquisition") or link.rel.endswith("/open-access") or link.rel == "enclosure":
            found.append(link)
    return found


def is_open_access(entry: Entry) -> bool:
    return any(link.rel.endswith("/open-access") for link in entry.links)
