---
name: code-review
description: When reviewing a PR, point the reviewer at this repository's standards (AGENTS.md conventions, prose standard, change chains, quality gate) plus the review-specific checks code alone can't reveal.
---

# Reviewing a PR

**This skill is guidance, not a complete checklist.** Verify and pull the PR's live base first, then read the diff and enough surrounding code to understand the design. Rank correctness, lifetime, security, and broken required behavior above style; one substantiated blocker beats a long list of nitpicks.

## Sources of truth

- [`AGENTS.md`](../../../AGENTS.md): the standing general engineering conventions.
- [`doc-standard.md`](../../references/doc-standard.md): documentation placement and prose discipline.
- [`prose-standard`](../prose-standard/SKILL.md): coverage requirements and editorial judgment for comments, docs, prompts, and visible strings.
- [`changes/README.md`](../../../.changes/README.md): chain layers and format; disagreeing with a chain is a design discussion, not an automatic veto.
- [`pre-push-checks`](../pre-push-checks/SKILL.md): the minimum evidence set the author should have run.

## Blocking requirements

1. **New prose gets a semantic review.** Review every added or changed Markdown, comment, prompt, description, diagnostic, and visible string paragraph by paragraph with [`prose-standard`](../prose-standard/SKILL.md); mechanical checks cannot establish these properties.
2. **Docs match code.** Configuration, defaults, errors, fields, and public behavior get their docs and comments updated in the same change. Comments state non-obvious contracts; implementation narration, test walkthroughs, review history, and repeated rationale are removed or turned into links to their single home.
3. **Registrations can be cleaned up.** Every new registration has a matching release path.
4. **Required evidence exists.** Confirm the author ran the narrowest relevant checks for this diff and that CI covers the full matrix; review the semantic gaps neither can catch.

## Human review

- **Intent and interface contract**: trace both ends of every changed interface and confirm the implementation matches the PR and any chain, including errors, cancellation, ownership, and release.
- **Lifetime and concurrency**: for async initialization, callbacks, processes, or teardown, check for races before publication, cancellation during awaits, independent error reporting, callback isolation, ownership before re-entry, and release that comes fully to rest.
- **Scope, ownership, necessity**: map every abstraction, state machine, option, defensive copy, and compatibility path to a current contract, production consumer, and owning module. Question unrelated features and speculative generalization.
- **Configuration and public choices**: every default, public operation set, format, or introduced external concept needs current-consumer evidence or precedent; without enough evidence, require an explicit choice or a deferral.
- **Enforcement paths**: follow every rejection path to the operation that actually enforces it; check direct and alternative callers that can bypass the schema, prompt, façade, or listener order.
- **Boundary coverage through to the final result**: locate the owner of the complete output or retained result (including wrapping and metadata); probe minimal values and exact limits, very large single chunks, and multi-byte text.
- **Real entry paths**: exercise the real loader, entry script, worker, or subprocess where relevant; hand-mounted instances miss illegal-export errors.
- **Test strength**: assertions should fail on the expected regression and verify external state, logs, events, or release, not restate the implementation or trust someone's report. Coverage is necessary, not evidence that the scenario is right.
- **Chain matches diff**: verify `plan.md`'s `## Files` against the final diff — every listed file changed, every changed file listed; when the implementation departs from the plan, update `plan.md` in the same change.
- **Chain layers**: a change that alters system behavior or crosses an existing policy boundary deserves `spec.md`. The gate only enforces `spec ⇒ intent`; whether a spec *should* exist is judgment, and review is the only place it gets caught.
- **Snapshot changes**: externally visible changes update snapshots or explain why none applies. Review expected-output diffs as behavior changes, not formatting noise.

## Reporting findings

State the defect, location, impact, and evidence. Attach local defects to the tightest diff range; raise cross-cutting architecture or scope concerns as PR-level comments. Separate blockers from suggestions and omit what the green gate already enforces. Reply in existing review threads. When review comments arrive, verify each one and fix or rebut it on technical grounds, without performative agreement.
