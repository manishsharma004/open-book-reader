#!/usr/bin/env python3
"""Mirror specs/discussion/*.md onto the design discussion issue.

The issue body is a short preamble plus DESIGN.md. Every other spec file is
one issue comment, found again on later runs by a hidden marker line, and
edited in place.

Usage:
    python3 scripts/sync_design_issue.py [--dry-run]

Reads the GitHub token from the file named by $GITHUB_TOKEN_FILE. The token
is never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "manishsharma004/open-book-reader"
ISSUE = 1
SPEC_DIR = Path(__file__).resolve().parent.parent / "specs" / "discussion"
BLOB = f"https://github.com/{REPO}/blob/main/specs/discussion"
TREE = f"https://github.com/{REPO}/tree/main/specs/discussion"

# GitHub rejects issue bodies and comments longer than this many characters.
GITHUB_BODY_LIMIT = 65_536

# Body first, then comments in this order when they are created.
COMMENT_FILES = ["PROVIDERS.md", "UX.md", "REVIEW.md"]
COMMENT_TITLES = {
    "PROVIDERS.md": "connection settings, the proxy, and vendor tables",
    "UX.md": "screens, controls, states, and accessibility",
    "REVIEW.md": "design review findings and what changed because of them",
}


def marker(name: str) -> str:
    return f"<!-- spec-file: specs/discussion/{name} -->"


def issue_body() -> str:
    design = (SPEC_DIR / "DESIGN.md").read_text(encoding="utf-8")
    comment_list = "\n".join(
        f"- [`{name}`]({BLOB}/{name}): {COMMENT_TITLES[name]}" for name in COMMENT_FILES
    )
    preamble = (
        "This issue is the design discussion for Open Book Reader. "
        f"The canonical write-up is in [`specs/discussion/`]({TREE}) on `main`. "
        f"This body mirrors [`DESIGN.md`]({BLOB}/DESIGN.md). "
        "The other spec files are mirrored in comments on this issue, each starting with its path:\n\n"
        f"{comment_list}\n\n"
        "Decisions are in DESIGN.md section 14. Comment here if one of them should change. Library and model choices are a suggestion. "
        "Browser-owned data in IndexedDB, a stateless proxy that forwards each request to the vendor in the "
        "request's profile, and vendor settings stored in the browser are constraints.\n\n"
        "---\n\n"
    )
    return preamble + design


def comment_body(name: str) -> str:
    text = (SPEC_DIR / name).read_text(encoding="utf-8")
    header = (
        f"{marker(name)}\n"
        f"Mirror of [`specs/discussion/{name}`]({BLOB}/{name}) on `main`. "
        "Edits belong in the file; this comment is replaced when the file changes.\n\n"
        "---\n\n"
    )
    return header + text


def normalize(text: str | None) -> str:
    return (text or "").replace("\r\n", "\n").strip()


class GitHub:
    def __init__(self, token: str) -> None:
        self._token = token

    def call(self, method: str, path: str, payload: dict | None = None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            f"https://api.github.com{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "open-book-reader-spec-sync",
                **({"Content-Type": "application/json"} if data else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:500]
            raise SystemExit(f"GitHub {method} {path} failed: {err.code} {detail}") from None

    def comments(self) -> list[dict]:
        out: list[dict] = []
        page = 1
        while True:
            batch = self.call("GET", f"/repos/{REPO}/issues/{ISSUE}/comments?per_page=100&page={page}")
            out.extend(batch)
            if len(batch) < 100:
                return out
            page += 1


def find_comment(comments: list[dict], name: str) -> dict | None:
    tag = marker(name)
    for comment in comments:
        if normalize(comment.get("body")).startswith(tag):
            return comment
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="show sizes and planned changes without writing")
    args = parser.parse_args()

    planned = {"body": issue_body(), **{name: comment_body(name) for name in COMMENT_FILES}}
    too_long = False
    for name, text in planned.items():
        size = len(text)
        flag = "OK" if size <= GITHUB_BODY_LIMIT else "TOO LONG"
        too_long |= size > GITHUB_BODY_LIMIT
        print(f"{name:14} {size:6} chars  {flag}")
    if too_long:
        print(f"A mirrored text exceeds GitHub's {GITHUB_BODY_LIMIT}-character limit. Split the spec file.")
        return 1

    token_file = os.environ.get("GITHUB_TOKEN_FILE")
    if not token_file:
        print("GITHUB_TOKEN_FILE is not set.")
        return 1
    gh = GitHub(Path(token_file).read_text(encoding="utf-8").strip())

    issue = gh.call("GET", f"/repos/{REPO}/issues/{ISSUE}")
    comments = gh.comments()

    actions: list[tuple[str, str, str, dict | None]] = []
    if normalize(issue.get("body")) != normalize(planned["body"]):
        actions.append(("body", "PATCH", f"/repos/{REPO}/issues/{ISSUE}", {"body": planned["body"]}))
    for name in COMMENT_FILES:
        existing = find_comment(comments, name)
        if existing is None:
            actions.append((name, "POST", f"/repos/{REPO}/issues/{ISSUE}/comments", {"body": planned[name]}))
        elif normalize(existing.get("body")) != normalize(planned[name]):
            actions.append((name, "PATCH", f"/repos/{REPO}/issues/comments/{existing['id']}", {"body": planned[name]}))

    if not actions:
        print("Issue already matches the spec files.")
        return 0
    for name, method, path, _ in actions:
        print(f"{'would ' if args.dry_run else ''}{method:5} {name} -> {path}")
    if args.dry_run:
        return 0

    for _, method, path, payload in actions:
        gh.call(method, path, payload)

    issue = gh.call("GET", f"/repos/{REPO}/issues/{ISSUE}")
    comments = gh.comments()
    mismatched = []
    if normalize(issue.get("body")) != normalize(planned["body"]):
        mismatched.append("body")
    for name in COMMENT_FILES:
        found = find_comment(comments, name)
        if found is None or normalize(found.get("body")) != normalize(planned[name]):
            mismatched.append(name)
    if mismatched:
        print("Verification failed for: " + ", ".join(mismatched))
        return 1
    print(f"Verified: issue #{ISSUE} body and {len(COMMENT_FILES)} spec comments match the files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
