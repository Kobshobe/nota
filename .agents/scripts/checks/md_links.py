"""Validate that markdown relative links resolve and anchors exist."""

from __future__ import annotations

import re
from pathlib import Path

from ._common import documents, rel

_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_FENCE = re.compile(r"```.*?```", re.S)
_CODE = re.compile(r"`[^`]*`")
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_SKIP_SCHEME = ("http://", "https://", "mailto:", "tel:")


def _strip_code(text: str) -> str:
    """Remove fenced code blocks and inline code so examples aren't treated as real links."""
    return _CODE.sub("", _FENCE.sub("", text))


def _slug(heading: str) -> str:
    """Turn heading text into an anchor the way GitHub does: lowercase, strip punctuation, spaces to hyphens."""
    text = heading.strip().lower()
    text = re.sub(r"[`*]", "", text)
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    return re.sub(r"\s+", "-", text.strip())


def _anchors(text: str) -> set[str]:
    """Return the set of anchors produced by every heading in the document."""
    anchors = set()
    for line in text.splitlines():
        match = _HEADING.match(line)
        if match:
            anchors.add(_slug(match.group(2)))
    return anchors


def check(root: Path) -> list[str]:
    """Return markdown files with a missing relative link target or a missing anchor."""
    errors: list[str] = []
    for path in documents(root, skip_archived=True):
        r = rel(root, path)
        raw = path.read_text(encoding="utf-8")
        anchors = _anchors(raw)
        for match in _LINK.finditer(_strip_code(raw)):
            target = match.group(1)
            if target.startswith(_SKIP_SCHEME):
                continue
            if target.startswith("#"):
                anchor = target[1:]
                if anchor and anchor not in anchors:
                    errors.append(f"{r}: anchor does not exist: {target}")
                continue
            file_part, _, anchor = target.partition("#")
            resolved = (path.parent / file_part).resolve()
            if not resolved.exists():
                errors.append(f"{r}: link target does not exist: {target}")
                continue
            if anchor and resolved.suffix == ".md" and anchor not in _anchors(resolved.read_text(encoding="utf-8")):
                errors.append(f"{r}: anchor does not exist: {target}")
    return errors
