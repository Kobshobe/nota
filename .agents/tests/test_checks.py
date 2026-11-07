"""Behavior tests for the gate validators: pin coverage and failure paths on temporary repository fixtures."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from checks import _common, chain_order, doc_budgets, md_links, md_wrap, skill_frontmatter  # noqa: E402


def write(root: Path, relative: str, text: str) -> Path:
    """Write a file in the fixture, creating parent directories as needed."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class GateCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / ".changes" / "archive").mkdir(parents=True)
        (self.root / ".agents" / "scripts").mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()


class DocumentsTest(GateCase):
    def test_root_readme_governed_and_tool_dirs_skipped(self):
        write(self.root, "README.md", "# Title\n")
        write(self.root, "docs/node_modules/dep.md", "# Dependency\n")
        got = {_common.rel(self.root, path) for path in _common.documents(self.root)}
        self.assertIn("README.md", got)
        self.assertNotIn("docs/node_modules/dep.md", got)


class MdWrapTest(GateCase):
    def test_root_readme_folded_paragraph_flagged(self):
        write(self.root, "README.md", "line one\nline two\n")
        self.assertTrue(any("README.md" in error for error in md_wrap.check(self.root)))

    def test_in_progress_chain_folded_paragraph_flagged(self):
        write(self.root, ".changes/probe/intent.md", "# Intent: p\n\n## Problem\n\none\ntwo\n")
        self.assertTrue(any(".changes/probe" in error for error in md_wrap.check(self.root)))

    def test_archive_folded_paragraph_skipped(self):
        write(self.root, ".changes/archive/2026-01-01-old/intent.md", "# Intent: o\n\n## Problem\n\none\ntwo\n")
        self.assertEqual(md_wrap.check(self.root), [])


class MdLinksTest(GateCase):
    def test_root_readme_broken_link_flagged(self):
        write(self.root, "README.md", "See [missing](missing.md).\n")
        self.assertTrue(any("missing.md" in error for error in md_links.check(self.root)))

    def test_missing_anchor_flagged(self):
        write(self.root, "README.md", "[x](target.md#nowhere)\n")
        write(self.root, "target.md", "# Title\n")
        self.assertTrue(any("nowhere" in error for error in md_links.check(self.root)))


class ChainOrderTest(GateCase):
    def test_chain_slug_shape_enforced(self):
        write(self.root, ".changes/BadName/intent.md", "# Intent: x\n\n## Problem\n\nok\n")
        self.assertTrue(any("BadName" in error for error in chain_order.check(self.root)))

    def test_chain_subdirectory_rejected(self):
        write(self.root, ".changes/good/intent.md", "# Intent: x\n\n## Problem\n\nok\n")
        (self.root / ".changes" / "good" / "sub").mkdir()
        self.assertTrue(any("must not contain subdirectories" in error for error in chain_order.check(self.root)))

    def test_archive_name_without_version_rejected(self):
        write(self.root, ".changes/archive/2026-01-01-old/intent.md", "# Intent: x\n\n## Problem\n\nok\n")
        self.assertTrue(any("archived directory name" in error for error in chain_order.check(self.root)))

    def test_archive_name_with_version_accepted(self):
        write(self.root, ".changes/archive/2026-01-01-v1-old/intent.md", "# Intent: x\n\n## Problem\n\nok\n")
        self.assertEqual(chain_order.check(self.root), [])


class DocBudgetsTest(GateCase):
    def _manifest(self, body: str) -> None:
        write(self.root, ".agents/scripts/doc-budgets.json", body)

    def test_tool_dirs_not_required_in_manifest(self):
        self._manifest('{"budgets": {"README.md": 1000}}')
        write(self.root, "README.md", "Short\n")
        write(self.root, "docs/node_modules/dep.md", "# " + "x" * 5000 + "\n")
        self.assertEqual(doc_budgets.check(self.root), [])

    def test_unregistered_governed_doc_flagged(self):
        self._manifest('{"budgets": {}}')
        write(self.root, "README.md", "Content\n")
        self.assertTrue(any("no character budget" in error for error in doc_budgets.check(self.root)))

    def test_headroom_enforced(self):
        self._manifest('{"budgets": {"README.md": 100}}')
        write(self.root, "README.md", "x" * 96 + "\n")
        self.assertTrue(any("headroom" in error for error in doc_budgets.check(self.root)))

    def test_invalid_json_reported(self):
        self._manifest("{")
        self.assertTrue(any("not valid JSON" in error for error in doc_budgets.check(self.root)))

    def test_missing_budgets_reported(self):
        self._manifest("{}")
        self.assertTrue(any("budgets" in error for error in doc_budgets.check(self.root)))

    def test_non_integer_limit_reported(self):
        self._manifest('{"budgets": {"README.md": "lots"}}')
        self.assertTrue(any("integer" in error for error in doc_budgets.check(self.root)))


class SkillFrontmatterTest(GateCase):
    def test_valid_skill_passes(self):
        write(self.root, ".agents/skills/good/SKILL.md", "---\nname: good\ndescription: d\n---\n\n# Good\n")
        self.assertEqual(skill_frontmatter.check(self.root), [])

    def test_name_must_match_directory(self):
        write(self.root, ".agents/skills/bad/SKILL.md", "---\nname: wrong\ndescription: d\n---\n\n# Bad\n")
        self.assertTrue(any("name should match the directory name bad" in error for error in skill_frontmatter.check(self.root)))

    def test_empty_description_flagged(self):
        write(self.root, ".agents/skills/bad/SKILL.md", "---\nname: bad\ndescription:\n---\n\n# Bad\n")
        self.assertTrue(any("description is empty" in error for error in skill_frontmatter.check(self.root)))

    def test_missing_heading_flagged(self):
        write(self.root, ".agents/skills/bad/SKILL.md", "---\nname: bad\ndescription: d\n---\n\nbody\n")
        self.assertTrue(any("missing an H1" in error for error in skill_frontmatter.check(self.root)))


if __name__ == "__main__":
    unittest.main()
