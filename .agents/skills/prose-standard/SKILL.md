---
name: prose-standard
description: Use when writing, reviewing, restoring, tightening, or auditing text — deciding where text is required across Markdown, comments, test comments, prompts, descriptions, diagnostics, and UI strings, and how much to write.
---

# Prose standard

Write enough to preserve the contract, then delete the reasoning, duplication, and decoration. A **contract** is an obligation, invariant, precondition, postcondition, or compatibility promise that callers, callees, implementers, producers, or consumers rely on. This skill owns editorial judgment and required coverage; placement, budgets, and gates use [`doc-standards`](../doc-standards/SKILL.md), and reasoning leakage uses [`trim-cot-leakage`](../trim-cot-leakage/SKILL.md). It is guidance, not a script.

Treat "contract, boundary, shape, surface, seam, gate, vocabulary" as **check-before-use** words, not banned words: first ask whether a more precise term states the fact better. Keep a word when it names the exact technical object, including caller/callee contracts and security or process boundaries.

A comment describes a non-obvious contract or reason the code cannot express; it doesn't restate what the code already implies.

## Input and exclusions

Require an explicit scope. When it's missing, report the needed input and stop; don't infer the whole repository, and don't start an interview.

The mode is automatic or interactive, defaulting to automatic. Enter interactive mode only when the user explicitly asks for questions or calibration. Mode controls questioning, not write permission: review and audit tasks only report and don't edit; only tasks explicitly asking to write, fix, or tighten apply clear changes.

Always exclude third-party vendor directories and `.changes/archive/` (frozen snapshots). Generated directories, snapshots, and fixtures are derivatives: change the owning source or scenario first, then regenerate.

## Preserve complete propositions

Before editing, identify every proposition in a paragraph and keep each relevant one:

- Actor and action;
- Conditions, timing, and order;
- Modality (must, may, never);
- Negative guarantees and exceptions;
- Ownership, side effects, failure modes, and consequences.

Delete adjectives, repetition, and narration only when every factual clause survives and the result is clearer. **Fewer characters is not an improvement by itself.**

Keep the full local contract at the point of use: the behavior, failure, ownership, and consequences a caller or maintainer needs right there. Aggressively link architecture, rationale, algorithms, history, and extended examples to the document that owns them. An explanation has one home; critical contract facts may be repeated locally.

Keep a non-obvious reason when omitting it could plausibly cause misuse or a wrong simplification; otherwise state the consequence and link the reason.

## Required coverage by location

This is not one-way shortening. When code, types, and structure cannot convey the required contracts below, add text or restore it. Don't add comments where the local code is already obvious.

- **Public interface comments**: record caller-visible return distinctions, throws or rejections, side effects, ownership, timing, cancellation, and durability.
- **Internal comments**: orient a non-local structure and an obviously complex local structure, including invariants, race order, ownership, security boundaries, and surprising failure behavior. Drop control-flow narration and code restatement.
- **Module comments**: state the module's role, dependencies, responsibilities, and non-obvious architectural choices, and link the choices.
- **Tests**: explain only non-obvious test design — why a fixture, assertion, platform adaptation, real entry path, or indirect observation is needed. Drop walkthroughs and checklists.
- **Operational guides**: include prerequisites, required actions, real entry points, observable verification, and brief warnings.
- **README**: include consumer contracts: configuration, semantics, failure, limits, extension points, and externally visible effects. Quote stable visible text owned by the module; link generated directories and cross-module owners.
- **Change chains**: keep distinctive reasons, mechanisms, alternatives, consequences, and verification evidence. In-progress chains may use future tense; they freeze at merge and are not backfilled.
- **Incident write-ups**: keep the incident sequence, evidence, causal chain, impact, and prevention. Delete repetition that establishes no causation and implementation detail.
- **Skills and agent instructions**: state behavioral guardrails and explicit scope limits (e.g. "guidance, not a script or checklist"), keep workflows concise, and link sources of truth.
- **Examples and configuration comments**: explain access limits, non-obvious wiring or load order, security stance, replay behavior, exceptions, and likely misuse; don't narrate entries the configuration already shows.
- **Prompts and visible strings**: treat wording as behavior. Check generated output and run behavior checks, or explain why no snapshot applies.
- **Diagnostics**: name the failing object or path, the violated rule, and the correction when non-obvious; drop internal execution narration.

Keep searchable mechanism names and meaningful emphasis; normalize only decorative emphasis.

## Workflow

1. Confirm the scope, mode, current branch or PR base, and applicable AGENTS.md. Don't look at unrelated branches.
2. Before judging a piece of text, read [`doc-standard.md`](../../references/doc-standard.md) and the code or document that owns it.
3. Inspect the requested scope, not just the largest files. Use search and counts to find candidates, then judge each paragraph semantically.
4. Classify each candidate as: keep, add, tighten, restore, reorganize, defer. Apply clear changes only when the task authorizes it; don't invent changes to hit a deletion target.
5. Change the owner first, then derivatives. After learning a new rule, re-check similar paragraphs.
6. Run the narrowest relevant checks, the docs gate `python3 .agents/scripts/check_docs.py`, and `git diff --check`, and verify the final diff contains no vendor paths.
7. Report the scope examined, the clear changes, intentional keeps, deferred cases, and the checks actually run.

## Boundary cases

A case is a boundary case only when at least two versions both satisfy the complete-proposition rule but trade off between accepted principles. In automatic mode, apply clear changes and report genuine boundary cases without asking; don't weaken propositions to make progress. In interactive mode, group similar paragraphs under one principle, give two or three viable versions, recommend one, and explain the factual or structural difference; don't offer worse distractors.
