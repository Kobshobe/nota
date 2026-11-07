---
name: find-simplifications
description: Use to find non-obvious simplification candidates, write them up as an intent.md or an inline TODO/FIXME/XXX, or fold a worthwhile simplification from another branch in; especially for dead code, duplication, speculative generalization, over-building, added-then-removed code, and surfaces that hand-roll something a mature dependency already provides.
---

# Finding simplifications

Turn a broad request like "find something to simplify" into evidence-backed simplification changes that actually delete or fold existing surface. It is guidance, not a checklist: follow the code, keep judging, and prefer a few proven candidates over a pile of thin guesses.

## Start from repository context

- Read the conventions in [`AGENTS.md`](../../../AGENTS.md), including "tests describe behavior, not correctness".
- Read the project's architecture docs before judging core code; simplifications that conflict with established module boundaries or models need extra evidence.
- Use change chains to understand what was **intentional**: `## Alternatives considered` in `spec.md` records what the design beat. Finished chains live in `.changes/archive/`; **the reasons for existing designs live only there**, so search the archive, not just the in-progress directory. Deleting a recorded boundary requires beating the reason on record, not just citing a "prefer dependencies" policy.

## What counts as a strong candidate

A strong simplification deletes, folds, or downgrades something that really exists, with clear evidence that the current design costs more than it earns:

- A public method, event, configuration option, notification, helper, module, or event with **no production consumer**.
- Only tests or docs use it, and the behavior they pin is not load-bearing.
- Two representations mirror the same fact.
- A boundary-layer method every implementation must support, with no consumer using it.
- A standalone module that exists only for tests or demos but carries release or dependency cost.
- A feature built as speculative generalization with no product owner.
- An invariant, rollback path, or special test that exists only to protect an interface nobody uses.
- Hand-rolled code that reimplements something a **well-maintained dependency** already provides, where replacement deletes both the implementation and its dedicated tests.
- A simplification that changes behavior slightly, but the new behavior is still reasonable and easier to explain.

Thin candidates rarely deserve a chain: fixing a typo, running a dead-code scan, or saying "this looks complex" without call-site evidence.

## Survey broadly

When the user asks for breadth or there are many candidates, use parallel subagents, giving each a domain and demanding evidence rather than guesses. Without subagents, simulate the same breadth yourself. Don't let the first good candidate end the survey.

Start from the largest production-code deltas. An audit that stops at obviously unused symbols misses the files where duplicated lifetime or defensive machinery carries most of the cost.

## Audit trust and lifetime boundaries

For every defensive copy, freeze, validator, and callback capture, state where the value comes from and who owns it next. **Typed same-process calls normally borrow read-only values**; parsers, configuration loaders, queues, external JSON, persisted files, workers, processes, and network decoders own or validate their data. Tests built around hostile getters, forged objects, callback replacement, or post-handoff mutation are "evidence the contract may be speculative", not an automatic reason to keep it.

For complex async code, draw an ownership graph mapping every sentinel, readiness signal, cancellation path, releaser, and state flag to a distinct owner or transfer. When several mechanisms mirror the same liveness or settlement fact, propose one transaction or lifetime controller.

## Hand-rolled or dependency

Introducing a dependency is a legitimate simplification tool. While surveying infrastructure like protocol parsers, framing, retry and backoff loops, globbing, or diff engines, ask: does a well-maintained dependency or a language built-in already do this? To justify a dependency replacement, also check the dependency's health and transitive footprint, prefer built-ins, and count the net deletion (implementation plus dedicated tests plus docs, minus the remaining glue).

## Prove or reject each candidate

For each symbol or behavior, classify consumers first:

- Production corpus: source, entry configuration, runtime scripts, and load paths.
- Non-production corpus: tests, docs, change chains, snapshots, generated expected output, comments.
- Ambiguous corpus: examples and scripts that might be product smoke paths; look at usage before classifying.

Search first, then read call sites. Static analysis tools help but cannot replace understanding public interfaces, dynamic event names, tests, docs, and load paths.

Reject or downgrade a candidate when:

- A production caller exists, so the simplification becomes a feature decision rather than cleanup.
- A chain's `spec.md` or a hard-won defensive pattern explicitly defends the interface, and the new evidence does not beat that reason.
- Deleting it brings unrelated churn without really reducing public interface or required behavior.
- The idea is right but small. Use a targeted TODO/FIXME/XXX tagged by urgency instead.

## Write the intent

Write the simplification's intent in `.changes/<slug>/intent.md`, following [`changes/README.md`](../../../.changes/README.md). One paragraph per physical line.

- First line `# Intent: <action-oriented title>`.
- `## Problem`: name the current interface, cite the relevant files, state the consumer evidence, and separate production callers from tests and docs.
- Other sections are free, but the implementer must be able to tell how far to cut, and the strongest counterargument must be stated plainly.

If the simplification changes system behavior or crosses an existing convention, the chain also needs `spec.md`. Be specific enough to follow, and avoid hollow intents like "simplify this module".

"Added then removed" is the common full-removal case: the feature counts as removed only once it has disappeared from production code, configuration, schema, persisted or wire formats, migrations, and compatibility behavior, with no test treating it as supported behavior.

## Inline TODOs

Inline TODO/FIXME/XXX is only for small, local, obviously useful cleanup that is **not a durable design decision**:

- Name the smell with a stable tag, e.g. `TODO(double default)`.
- Say why revisiting is safe and what action would simplify it.
- Don't add a TODO for speculative complaints or behavior that needs a chain.

## Validation and PR hygiene

A docs-only job runs at least `python3 .agents/scripts/check_docs.py` and `git diff --check`. When opening or updating a PR, summarize the candidates adopted and dropped, which main areas were surveyed, what was deliberately excluded, and which checks ran.
