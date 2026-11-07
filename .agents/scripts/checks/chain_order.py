"""Validate change-chain directory shape and layer ordering."""

from __future__ import annotations

import re
from pathlib import Path

from ._common import rel

FILES = ("intent.md", "spec.md", "plan.md")
# Only spec claims system behavior, so it must be backed by intent; plan may stand alone (small changes).
REQUIRES = (("spec.md", "intent.md"),)
ARCHIVE_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-v\d+-.+$")
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


EXAMPLE = Path(".agents") / "references" / "chain-example"


def chains(root: Path):
    """Yield the chains under validation: in-progress work items in `.changes/`, plus the shipped example chain."""
    changes = root / ".changes"
    if changes.is_dir():
        for entry in sorted(changes.iterdir()):
            if entry.is_dir() and entry.name != "archive" and not entry.name.startswith("."):
                yield entry
    example = root / EXAMPLE
    if example.is_dir():
        yield example


def check(root: Path) -> list[str]:
    """Return chains with a missing directory, a bad archive name, or a skipped layer."""
    changes = root / ".changes"
    if not changes.is_dir():
        return [f"missing directory: {rel(root, changes)}"]

    errors: list[str] = []
    archive = changes / "archive"
    if not archive.is_dir():
        errors.append(f"missing directory: {rel(root, archive)}")
    else:
        for entry in sorted(archive.iterdir()):
            if entry.name.startswith("."):
                continue
            if not entry.is_dir() or not ARCHIVE_NAME.match(entry.name):
                errors.append(f"{rel(root, entry)}: archived directory name should be YYYY-MM-DD-v<number>-<slug>")

    for entry in sorted(changes.iterdir()):
        if entry.is_dir() and entry.name != "archive" and not entry.name.startswith("."):
            if not SLUG.match(entry.name):
                errors.append(f"{rel(root, entry)}: an in-progress chain directory name should be a lowercase hyphen-separated phrase with no number")

    for chain in chains(root):
        for child in sorted(chain.iterdir()):
            if child.is_dir():
                errors.append(f"{rel(root, child)}: chain directories must not contain subdirectories")
        names = {path.name for path in chain.iterdir() if path.is_file()}
        if not names:
            errors.append(f"{rel(root, chain)}: empty work item directory")
            continue
        for extra in sorted(names - set(FILES)):
            errors.append(f"{rel(root, chain)}: unknown file {extra} (only {', '.join(FILES)} allowed)")
        for present, required in REQUIRES:
            if present in names and required not in names:
                errors.append(f"{rel(root, chain)}: has {present} without {required} (layers cannot be skipped)")
    return errors
