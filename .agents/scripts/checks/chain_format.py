"""Validate the header block and required sections of in-progress chain artifacts."""

from __future__ import annotations

import re
from pathlib import Path

from ._common import rel
from .chain_order import chains

TITLE = {"intent.md": "# Intent: ", "spec.md": "# Spec: ", "plan.md": "# Plan: "}
REQUIRED = {
    "intent.md": ("## Problem",),
    "spec.md": ("## Behavior", "## Alternatives considered", "## Areas of concern"),
    "plan.md": ("## Files", "## Proof"),
}
UNRESOLVED = re.compile(r"\[NEEDS CLARIFICATION:[^\]]*\]")


def _headings(text: str) -> list[str]:
    """Return every level-two heading line in the body, verbatim."""
    return [line for line in text.splitlines() if line.startswith("## ")]


def check(root: Path) -> list[str]:
    """Return artifacts with a bad header block, missing required sections, or unresolved markers."""
    errors: list[str] = []
    for chain in chains(root):
        relative = rel(root, chain)
        found: set[str] = set()
        for name, prefix in TITLE.items():
            path = chain / name
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            if not lines or not lines[0].startswith(prefix) or not lines[0][len(prefix) :].strip():
                errors.append(f"{relative}/{name}: first line should be `{prefix}<title>`")
                continue
            found.add(name)
            headings = _headings("\n".join(lines))
            for required in REQUIRED[name]:
                if required not in headings:
                    errors.append(f"{relative}/{name}: missing required section {required}")
        if "spec.md" in found and "intent.md" in found:
            intent = (chain / "intent.md").read_text(encoding="utf-8")
            if UNRESOLVED.search(intent):
                errors.append(f"{relative}/intent.md: spec.md exists, but [NEEDS CLARIFICATION: ...] markers remain")
    return errors
