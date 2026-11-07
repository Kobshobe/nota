---
name: trim-cot-leakage
description: Audit or fix text that reads like leaked reasoning — references that exist only in the design process (decision ids, audit item ids, section numbers of uncommitted drafts), change narration (used to, no longer, cut here), stack or reviewer perspective, arguments written at a reviewer, control-flow narration, or hesitant planning residue hidden in comments, docs, and change chains.
---

# Trim reasoning leakage

Reasoning leakage is text whose point of view is **the session that wrote it** rather than the repository: it cites artifacts only that session can see, narrates change instead of state, or argues with a reviewer who has since left.

The fix is **not just deletion** — when a passage carries factual clauses, restate each clause so it stands on its own at the current location, then delete the surrounding "process". Anything carrying no factual clause (audit ids, control-flow narration) is deleted outright. **Required background**: [`prose-standard`](../prose-standard/SKILL.md) owns the "complete proposition" rule this skill applies. It is guidance, not a script.

## The single test

For each suspicious passage ask: **can a reader at the current location, with no access to any session log, PR thread, or uncommitted draft, resolve every reference and verify every assertion?** If not, restate the surviving facts from the repository's point of view and delete the rest. If yes, it isn't leakage, however historical it sounds — but "resolvable" only clears this skill's bar: on current-state surfaces (README, docs, comments), a resolvable change story **still** counts as change narration, and goes back to its permitted home under category 3.

## Categories

1. **References that exist only in the design process**: `(decision 7)`, `(audit C2)`, `design §4.7`, `plan §1.4`, phase labels (`T4`, `P-I`). When the decision has a committed owner, cite it by name and path; otherwise delete the reference and restate the factual clauses so they stand alone.
2. **Stack and PR perspective**: a later PR in this stack, "added in this PR", "the previous commit". State the shipped mechanism or extension point; move deferred work into a TODO marker, an issue reference, or a chain containing only `intent.md` (see [`changes/README.md`](../../../.changes/README.md)).
3. **Change narration and version stamps**: used to, no longer, the old X, plus deictic stamps (v1, cut here, today, now versus before). State current behavior; a fixed regression becomes a present-tense counterfactual (without X, Y happens), never repository history (it used to do Y).
4. **Review orchestration**: rejected in review, the reviewer confirmed, draft number. Write the surviving decision and reason as plain facts; delete who said what when.
5. **Arguments aimed at a reviewer**: "this conversion is safe because it's just...", "this is correct because...". A comment arguing its own correctness talks to a reviewer, not a maintainer. Either state the invariant that makes the code safe, or delete the comment when the code already shows it.
6. **Restatement and derivation**: control-flow narration (first X, then Y), test walkthroughs, proofs of obvious branches. Delete them; keep only non-obvious contracts or invariants.
7. **Hesitation and planning residue**: "probably fine as is", "should be enough", unmarked deferral. Upgrade to a TODO or FIXME, or restate it as a real boundary; delete the hesitation.
8. **Language drift**: untranslated fragments of another language mixed into text written in one language.

## What is not leakage

Reference cleanup without justification fails in both directions: deleting durable references and leaving dead ones. Apply these retention rules literally:

- **Issue references**: `#1470`, "issue #N owns the follow-up" are resolvable at the current location; keep them on any surface.
- **Merged PR and issue references in change chains and incident write-ups**: evidence the documentation standard permits.
- **Suppression reasons**: lint-disable reasons, coverage-ignore reasons, and empty-catch explanations are required; fix a wrong reason, never delete it.
- **Present-tense counterfactual regression pins**: "without X, Y happens", "a naive X would...".
- **Measured boundaries**: in "measured: ~0.15s at 512 nesting levels", the word "measured" is load-bearing.
- **Runtime old/new state**: "new connections are only accepted after old connections drain" is runtime lifetime, not change history.
- **External references resolvable by design outside the repository**: standard sections (e.g. RFC 9110 §10.1.5), external design docs; the section-number ban targets uncommitted internal drafts, not external standards or committed documents that own their numbering.
- **Project voice and rhetorical forms**: "we" as the project voice; the `## Alternatives considered` section of a chain's `spec.md`.

## Workflow

1. Set scope and exclusions per [`prose-standard`](../prose-standard/SKILL.md): require an explicit scope; never touch vendor directories, `.changes/archive/`, or recorded fixtures and snapshots.
2. Audit read-only first: run the recall probes once, then judge each hit semantically. Probes are clues, not definitions — also read the densest text in scope (module comments, READMEs, chains) without patterns.
3. Fix owners before surfaces: for generated directories, change the source comments or templates before regenerating; wording of model-visible strings is behavior, so flag those as changes needing snapshot support rather than silently rewriting them.
4. Before deleting anything, enumerate the passage's propositions (see prose-standard) and check the over-correction traps: turning obligations into endorsements, promoting an assumption to a shipped feature, deleting a real fact, losing provenance.
5. Validate: re-run the probes and expect only permitted retains; confirm every remaining reference resolves at its current location; run `python3 .agents/scripts/check_docs.py` for the surfaces touched.
