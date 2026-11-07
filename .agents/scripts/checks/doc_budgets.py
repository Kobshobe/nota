"""Validate that every governed document is registered, under its limit, and not sitting at the limit."""

from __future__ import annotations

import json
from pathlib import Path

from ._common import rel, skipped
from .chain_order import EXAMPLE

_HEADROOM_DIVISOR = 20
"""A document at its limit keeps at least 1/20 of the limit as headroom: limits are guardrails, and sitting exactly on one means the limit itself is wrong."""


def _count(text: str) -> int:
    """Count non-whitespace characters, treating Chinese and English alike."""
    return len("".join(text.split()))


_TREES = ("docs", ".agents/references")


def _governed(root: Path) -> set[str]:
    """Return the documents that must register a character budget: root `*.md`, human-facing doc trees, and the chain standard.

    The example chain lives under `.agents/references/`, but the chain validators own it, so it doesn't enter the document budgets.
    """
    paths = {rel(root, path) for path in root.glob("*.md") if path.is_file()}
    for name in _TREES:
        base = root / name
        if not base.is_dir():
            continue
        for path in base.rglob("*.md"):
            if skipped(root, path):
                continue
            relative = path.relative_to(root)
            if relative == EXAMPLE or EXAMPLE in relative.parents:
                continue
            paths.add(rel(root, path))
    chain_standard = root / ".changes" / "README.md"
    if chain_standard.exists():
        paths.add(rel(root, chain_standard))
    return paths


def _load_limits(manifest: Path, root: Path):
    """Read the budgets mapping from the registry, returning (limits, errors)."""
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return None, [f"{rel(root, manifest)}: not valid JSON ({error.msg}, line {error.lineno})"]
    if not isinstance(data, dict) or not isinstance(data.get("budgets"), dict):
        return None, [f"{rel(root, manifest)}: missing the budgets mapping"]
    errors: list[str] = []
    for path, limit in sorted(data["budgets"].items()):
        if not isinstance(limit, int) or isinstance(limit, bool):
            errors.append(f"{rel(root, manifest)}: the limit for {path} should be an integer")
    if errors:
        return None, errors
    return data["budgets"], []


def check(root: Path) -> list[str]:
    """Return unregistered, missing, over-limit, or limit-hugging governed documents."""
    manifest = root / ".agents" / "scripts" / "doc-budgets.json"
    if not manifest.exists():
        return [f"missing registry: {rel(root, manifest)}"]
    limits, malformed = _load_limits(manifest, root)
    if malformed:
        return malformed
    errors: list[str] = []

    for path in sorted(_governed(root)):
        if path not in limits:
            errors.append(f"{path}: no character budget registered in {rel(root, manifest)}")

    for path, limit in sorted(limits.items()):
        target = root / path
        if not target.exists():
            errors.append(f"{path}: registered but the file does not exist")
            continue
        count = _count(target.read_text(encoding="utf-8"))
        if count > limit:
            errors.append(f"{path}: {count} characters, over the limit of {limit}")
            continue
        margin = limit // _HEADROOM_DIVISOR
        if count > limit - margin:
            errors.append(f"{path}: {count} characters, under {margin} characters of headroom below the limit of {limit} — move or compress first, or raise the limit with a reason")
    return errors
