"""Validate that markdown documents keep one paragraph per physical line."""

from __future__ import annotations

import re
from pathlib import Path

from ._common import documents, rel

_STRUCTURAL = re.compile(
    r"^(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|<!--|\s|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)"
)
_FENCE = re.compile(r"^\s*(```|~~~)")


def _is_prose(line: str) -> bool:
    """Return whether a line is plain prose (non-empty, unindented, non-structural)."""
    if not line.strip():
        return False
    if line[0].isspace():
        return False
    return _STRUCTURAL.match(line) is None


def check(root: Path) -> list[str]:
    """Return markdown files with folded paragraphs, with their starting line numbers."""
    errors: list[str] = []
    for path in documents(root, skip_archived=True):
        r = rel(root, path)
        lines = path.read_text(encoding="utf-8").splitlines()
        # Skip YAML front matter
        in_frontmatter = bool(lines) and lines[0].strip() == "---"
        in_fence = False
        run_start = 0
        run_length = 0
        for number, line in enumerate(lines, start=1):
            if in_frontmatter:
                if number > 1 and line.strip() == "---":
                    in_frontmatter = False
                continue
            if _FENCE.match(line):
                in_fence = not in_fence
                if run_length > 1:
                    errors.append(f"{r}:{run_start}: paragraph spans {run_length} lines, merge it into one")
                run_length = 0
                continue
            if in_fence:
                continue
            if _is_prose(line):
                if run_length == 0:
                    run_start = number
                run_length += 1
            else:
                if run_length > 1:
                    errors.append(f"{r}:{run_start}: paragraph spans {run_length} lines, merge it into one")
                run_length = 0
        if run_length > 1:
            errors.append(f"{r}:{run_start}: paragraph spans {run_length} lines, merge it into one")
    return errors
