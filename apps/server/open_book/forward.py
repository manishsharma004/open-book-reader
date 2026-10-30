"""Outbound targets the proxy is willing to open.

Completion goes to an Ollama server. Speech goes to Kokoro, Pocket TTS, or LFM3 Audio on
this machine, api.openai.com, or api.elevenlabs.io. Anything else is refused
before a socket is opened, so a caller cannot use the proxy to reach the rest
of the local network. Operators opt in to extra hosts with OLLAMA_ALLOW or
SPEECH_ALLOW, in the environment or in apps/server/local.allow. That file is
not committed.
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException

OLLAMA_PORT = 11434
LLM_PORT = 5173
KOKORO_PORT = 8880
POCKET_PORT = 7508
LFM_PORT = 7510
OLLAMA_CLOUD = "ollama.com"
OPENAI_HOST = "api.openai.com"
ELEVENLABS_HOST = "api.elevenlabs.io"

_HOST_NAME = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$"
)
_VOICE_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
_LOOPBACK = {ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("::1")}
_METADATA_V6 = ipaddress.ip_address("fd00:ec2::254")
_DOC_NETS = (
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
)


@dataclass(frozen=True)
class Target:
    scheme: str
    host: str
    port: int
    origin: str


def approved_completion_base(url: str) -> str:
    target = _parse_base(url)
    if target.host == OLLAMA_CLOUD:
        if target.scheme == "https" and target.port == 443:
            return target.origin
        raise _refused(
            "Ollama cloud is only forwarded over https://ollama.com."
        )
    if _is_local_loopback(target) and target.port == OLLAMA_PORT and target.scheme == "http":
        return target.origin
    if _builtin_llm(target):
        if not _is_local_loopback(target):
            _reject_blocked_resolution(target)
        return target.origin
    if _allow_hit(target, "OLLAMA_ALLOW", OLLAMA_PORT):
        _reject_blocked_resolution(target)
        return target.origin
    raise _refused(
        "Completion is only forwarded to Ollama on this machine at port 11434 "
        f"(http://127.0.0.1:{OLLAMA_PORT}/v1), to an LLM on port {LLM_PORT} at "
        "127.0.0.1, localhost, or ::1, to https://ollama.com, or to a host "
        "listed in OLLAMA_ALLOW or apps/server/local.allow. "
        f"Refused {target.scheme}://{_display(target.host, target.port)}."
    )


def approved_speech_base(url: str, vendor: str) -> str:
    target = _parse_base(url)
    if _builtin_speech(target, vendor):
        if not _is_local_loopback(target):
            _reject_blocked_resolution(target)
        upstream = _speech_upstream(target.port)
        if upstream is not None:
            return upstream
        return target.origin
    if _allow_hit(target, "SPEECH_ALLOW", None):
        _reject_blocked_resolution(target)
        return target.origin
    raise _refused(
        "Speech is only forwarded to Kokoro on port 8880, Pocket TTS on port 7508, "
        "or LFM3 Audio on port 7510 "
        "at 127.0.0.1, localhost, or ::1, to https://api.openai.com, "
        "to https://api.elevenlabs.io, or to a host:port listed in SPEECH_ALLOW "
        "or apps/server/local.allow. "
        f"Refused {target.scheme}://{_display(target.host, target.port)}."
    )


def voice_id(value: str) -> str:
    cleaned = value.strip()
    if not _VOICE_ID.fullmatch(cleaned):
        raise HTTPException(400, "Voice id must be letters, numbers, _ or -.")
    return cleaned


def _builtin_llm(target: Target) -> bool:
    if target.scheme != "http" or target.port != LLM_PORT:
        return False
    return _is_local_loopback(target)


def _builtin_speech(target: Target, vendor: str) -> bool:
    if vendor == "kokoro":
        return _local_speech(target, KOKORO_PORT)
    if vendor == "pocket":
        return _local_speech(target, POCKET_PORT)
    if vendor == "lfm":
        return _local_speech(target, LFM_PORT)
    if vendor == "openai":
        return target.scheme == "https" and target.host == OPENAI_HOST and target.port == 443
    if vendor == "elevenlabs":
        return target.scheme == "https" and target.host == ELEVENLABS_HOST and target.port == 443
    return False


def _local_speech(target: Target, port: int) -> bool:
    return (
        target.scheme == "http"
        and target.port == port
        and _is_local_loopback(target)
    )


def _parse_base(url: str) -> Target:
    raw = url.strip()
    if not raw or "\\" in raw or any(ord(char) < 32 or ord(char) == 127 for char in raw):
        raise _bad("Base URL must be an http or https URL.")
    try:
        parsed = urlsplit(raw)
        explicit_port = parsed.port
    except ValueError as exc:
        raise _bad("Base URL must be an http or https URL.") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise _bad("Base URL must be an http or https URL without a username or password.")
    if parsed.query or parsed.fragment:
        raise _bad("Base URL must not include a query or fragment.")
    path = parsed.path or ""
    if path not in {"", "/", "/v1", "/v1/"}:
        raise _bad("Base URL path must be empty or /v1. The proxy chooses the API path.")
    host = parsed.hostname.rstrip(".").lower()
    port = explicit_port or (443 if parsed.scheme == "https" else 80)
    if isinstance(port, int) is False or not 1 <= port <= 65535:
        raise _bad("Base URL port is not allowed.")
    if not _known_host(host):
        raise _bad("Base URL host is not allowed.")
    display_host = f"[{host}]" if ":" in host else host
    return Target(parsed.scheme, host, port, f"{parsed.scheme}://{display_host}:{port}")


def _known_host(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return _HOST_NAME.fullmatch(host) is not None


def _is_local_loopback(target: Target) -> bool:
    try:
        ip = ipaddress.ip_address(target.host)
    except ValueError:
        if target.host != "localhost":
            return False
        return _localhost_is_loopback(target.port)
    return _bare_loopback(ip)


def _localhost_is_loopback(port: int) -> bool:
    try:
        infos = socket.getaddrinfo("localhost", port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(400, "localhost did not resolve to this machine.") from exc
    addresses = {ipaddress.ip_address(item[4][0]) for item in infos}
    if not addresses or any(not _bare_loopback(ip) for ip in addresses):
        raise HTTPException(400, "localhost did not resolve to this machine.")
    return True


def _bare_loopback(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip in _LOOPBACK


def _speech_upstream(port: int) -> str | None:
    """Dial the operator's Compose service for an already approved local speech port.

    `SPEECH_UPSTREAM` is `port=url` pairs, for example
    `7508=http://pocket:7508,8880=http://kokoro:8880`. The caller still has to
    name a loopback host. A caller cannot choose this origin.
    """
    raw = os.environ.get("SPEECH_UPSTREAM", "")
    if not raw.strip():
        return None
    chosen: str | None = None
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        port_text, sep, url = entry.partition("=")
        if sep != "=" or not port_text.isdigit() or not url:
            raise HTTPException(500, f"SPEECH_UPSTREAM has an invalid entry: {entry}")
        mapped = int(port_text)
        if not 1 <= mapped <= 65535:
            raise HTTPException(500, f"SPEECH_UPSTREAM has an invalid entry: {entry}")
        try:
            upstream = _parse_base(url)
        except HTTPException as exc:
            raise HTTPException(500, f"SPEECH_UPSTREAM has an invalid entry: {entry}") from exc
        _reject_blocked_resolution(upstream)
        if mapped == port:
            chosen = upstream.origin
    return chosen


def _allow_hit(target: Target, env_name: str, default_port: int | None) -> bool:
    allowed = _allowlist(env_name, default_port)
    return (target.host, target.port) in allowed


_ALLOW_NAMES = ("OLLAMA_ALLOW", "SPEECH_ALLOW")


def local_allow_file() -> Path:
    override = os.environ.get("LOCAL_ALLOW_FILE", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[1] / "local.allow"


def _allowlist(env_name: str, default_port: int | None) -> set[tuple[str, int]]:
    raw = ",".join(
        part
        for part in (os.environ.get(env_name, ""), _local_allow_values()[env_name])
        if part.strip()
    )
    found: set[tuple[str, int]] = set()
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        try:
            found.add(_allow_entry(entry, default_port))
        except ValueError as exc:
            raise HTTPException(500, f"{env_name} has an invalid entry: {entry}") from exc
    return found


def _local_allow_values() -> dict[str, str]:
    found = {name: "" for name in _ALLOW_NAMES}
    path = local_allow_file()
    if not path.is_file():
        return found
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise HTTPException(500, "local.allow could not be read.") from exc
    collected: dict[str, list[str]] = {name: [] for name in _ALLOW_NAMES}
    for line in lines:
        text = line.split("#", 1)[0].strip()
        if not text:
            continue
        if "=" not in text:
            raise HTTPException(500, f"local.allow has an invalid line: {text}")
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key not in collected:
            raise HTTPException(500, f"local.allow has an unknown setting: {key}")
        if value:
            collected[key].append(value)
    return {name: ",".join(values) for name, values in collected.items()}


def _allow_entry(entry: str, default_port: int | None) -> tuple[str, int]:
    if "://" in entry or "/" in entry or "\\" in entry or any(ord(char) < 33 for char in entry):
        raise ValueError("bad entry")
    if entry.startswith("["):
        host, sep, rest = entry[1:].partition("]")
        if sep != "]" or not host:
            raise ValueError("bad ipv6")
        port_text = rest[1:] if rest.startswith(":") else ""
        if rest and not rest.startswith(":"):
            raise ValueError("bad ipv6 port")
        port = _port(port_text, default_port)
        ipaddress.ip_address(host)
        return host.lower(), port
    if entry.count(":") > 1:
        raise ValueError("bracket an ipv6 host")
    if ":" in entry:
        host, port_text = entry.rsplit(":", 1)
        port = _port(port_text, None)
    else:
        host, port = entry, _port("", default_port)
    host = host.lower().rstrip(".")
    if not host or not _known_host(host):
        raise ValueError("bad host")
    return host, port


def _port(text: str, default: int | None) -> int:
    if text == "":
        if default is None:
            raise ValueError("port required")
        return default
    if not text.isdigit():
        raise ValueError("bad port")
    port = int(text)
    if not 1 <= port <= 65535:
        raise ValueError("bad port")
    return port


def _reject_blocked_resolution(target: Target) -> None:
    """Refuse an opted-in name when it resolves to metadata, link-local, or another blocked address."""
    try:
        literal = ipaddress.ip_address(target.host)
    except ValueError:
        literal = None
    if literal is not None:
        if _always_blocked(literal):
            raise _refused("That address is never forwarded to.")
        return
    if target.host == "localhost" or _builtin_public(target):
        return
    try:
        infos = socket.getaddrinfo(target.host, target.port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(400, f"Could not resolve {target.host}.") from exc
    addresses = [ipaddress.ip_address(item[4][0]) for item in infos]
    if not addresses or any(_always_blocked(ip) for ip in addresses):
        raise _refused("That address is never forwarded to.")


def _builtin_public(target: Target) -> bool:
    return target.host in {OLLAMA_CLOUD, OPENAI_HOST, ELEVENLABS_HOST}


def _always_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _always_blocked(ip.ipv4_mapped)
    if ip == _METADATA_V6 or ip.is_unspecified or ip.is_multicast or ip.is_reserved or ip.is_link_local:
        return True
    return any(ip in network for network in _DOC_NETS if ip.version == 4)


def _display(host: str, port: int) -> str:
    return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"


def _bad(message: str) -> HTTPException:
    return HTTPException(400, message)


def _refused(message: str) -> HTTPException:
    return HTTPException(400, message)
