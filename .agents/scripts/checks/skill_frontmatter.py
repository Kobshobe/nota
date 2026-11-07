"""Validate each skill's SKILL.md: complete front matter, name matching the directory, and a heading."""

from __future__ import annotations

from pathlib import Path

from ._common import rel


def _frontmatter(text: str) -> list[str] | None:
    """Return the lines of the YAML front matter; return None when missing or unterminated."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return lines[1:index]
    return None


def _field(block: list[str], key: str) -> str | None:
    """Return the value of a scalar field in the front matter."""
    prefix = f"{key}:"
    for line in block:
        if line.startswith(prefix):
            return line[len(prefix) :].strip()
    return None


def _heading(text: str) -> bool:
    """Return whether the body (after front matter) has a level-one heading."""
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for index, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                start = index + 1
                break
    return any(line.startswith("# ") for line in lines[start:])


def check(root: Path) -> list[str]:
    """Return SKILL.md files that are missing, misnamed, have an empty description, or lack an H1."""
    errors: list[str] = []
    base = root / ".agents" / "skills"
    if not base.is_dir():
        return errors
    for skill in sorted(base.iterdir()):
        if not skill.is_dir():
            continue
        path = skill / "SKILL.md"
        relative = rel(root, path)
        if not path.exists():
            errors.append(f"{relative}: skill is missing SKILL.md")
            continue
        text = path.read_text(encoding="utf-8")
        block = _frontmatter(text)
        if block is None:
            errors.append(f"{relative}: missing YAML front matter")
            continue
        name = _field(block, "name")
        if name != skill.name:
            errors.append(f"{relative}: name should match the directory name {skill.name}")
        if not _field(block, "description"):
            errors.append(f"{relative}: description is empty")
        if not _heading(text):
            errors.append(f"{relative}: missing an H1")
    return errors
