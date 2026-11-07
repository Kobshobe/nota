---
name: doc-standards
description: Use when writing, moving, reviewing, or auditing docs — choosing the layer and detail level, distinguishing tutorial from reference, checking tutorial progression, cleaning up documentation slop, handling budget overruns, or taking requests like "improve the docs", "audit the docs", "where does this belong", "this doc is too long".
---

# Applying the documentation standard

The rules live in [`doc-standard.md`](../../references/doc-standard.md). This workflow covers placement, corpus audits, budgets, and validation across Markdown, comments, and docstrings. It is guidance, not a script; use [`prose-standard`](../prose-standard/SKILL.md) for coverage requirements and editorial judgment, and **never judge a defect by length alone**.

## Sources of truth (read them, don't restate)

- [`doc-standard.md`](../../references/doc-standard.md): layering, tutorial and reference forms, the ownership table, budgets, and the slop checklist.
- [`changes/README.md`](../../../.changes/README.md): when a chain needs which layer, what each layer holds, when to archive.
- Root [`AGENTS.md`](../../../AGENTS.md): the standing orders behind the character discipline this skill guards.

## Review structure, then text

Apply the standard's writing order to every human-facing document. Do **not** put change chains through this structural pass.

1. Locate the document in the repository and the navigation tree, state its own subject, and identify its direct children.
2. Decide the allowed detail granularity: the document's subject in full, direct children summarized by purpose and high-level behavior, deeper explanation pushed down to the child that owns it, with a link.
3. Judge the form by **actual use**, not by path or title. A tutorial must be an ordered path to an observable result; a reference must support lookup within a defined scope without sequential reading.
4. For tutorials, decide the reader's starting point and whether each concept is beginner, intermediate, or advanced; reorder content that comes before its prerequisites, and move optional advanced detail into later tutorials or reference.
5. Split a document when tutorial and reference both carry substance; when one part is small, put it in an explicitly labeled section.

Then check the constraints that make placement expensive:

- Moves are atomic: delete from the old place, add at the new one, and fix every inbound link in the same change.
- Never hand-edit generated directories; if the fact belongs there, change the generator's source.
- Before renaming or moving a document, grep for inbound links.

## Audit the corpus

After the structural review, start with the cheapest probes for the items on the slop checklist, then judge each paragraph semantically.

1. Measure: list the documents that have budget entries and find anomalously large unregistered files.
2. Use [`trim-cot-leakage`](../trim-cot-leakage/SKILL.md) to find reasoning leakage: narrated history, references that exist only in the design process, review orchestration, control-flow narration, test walkthroughs. Keep only non-obvious contracts or durable reasons.
3. Grep distinctive phrases to find duplication. Keep one home, turn the rest into links.
4. Replace hand-written directories, inventories of tests or status, and restated comments with the authoritative tree, script, or generated reference.
5. If what you're deleting is **promised behavior** rather than explanation, start with an `intent.md` first.

Exclude `.changes/archive/`: it is a frozen snapshot. Active text may be fixed, redirected, or have a link into it removed, but never clean through into a frozen target.

Keep every load-bearing rule, ideally one to three lines plus a link to the reason. Delete stories, duplication, status markers, and the path by which a rule was derived.

## When the budget is exceeded

Apply the "move, compress, raise" order from [`doc-standard.md`](../../references/doc-standard.md); this skill only adds the workflow probes above.

## Validation and PR hygiene

At minimum run `python3 .agents/scripts/check_docs.py` and `git diff --check`; comment changes may require regenerating related directories. In the PR description, give the character-count delta, explain any intentional overage, and list the checks actually run.
