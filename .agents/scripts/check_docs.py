#!/usr/bin/env python3
"""Single entry point for the documentation gate: runs each validator in order, returning 1 if any fails."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from checks import (  # noqa: E402  (requires .agents/scripts/ on the module search path first)
    _common,
    chain_format,
    chain_order,
    doc_budgets,
    md_links,
    md_wrap,
    skill_frontmatter,
)

CHECKS = (
    ("chain order and directories", chain_order.check),
    ("chain artifact format", chain_format.check),
    ("markdown links", md_links.check),
    ("one paragraph per line", md_wrap.check),
    ("doc character budgets", doc_budgets.check),
    ("skill front matter", skill_frontmatter.check),
)


def main() -> int:
    """Run every validator and return the process exit code."""
    root = _common.repo_root()
    passed = True
    for name, check in CHECKS:
        if not _common.report(name, check(root)):
            passed = False
    print()
    if passed:
        print("All documentation gates passed.")
        return 0
    print("Documentation gates failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
