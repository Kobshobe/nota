# Change chains

Each directory under `.changes/` is a **change chain**: the artifacts of one change, layer by layer answering "what to solve", "how the system should behave", and "how this change does it". A chain is a historical snapshot of that change, not the authority on current behavior — current behavior lives only in docs and source.

## Directories and naming

A chain is the set of files that grow under `.changes/<slug>/` as work progresses (see below), limited to `intent.md`, `spec.md`, and `plan.md`. `<slug>` is a lowercase, hyphen-separated phrase describing the change itself, with no number.

Finished chains move to `.changes/archive/YYYY-MM-DD-v{n}-<slug>/`, with the date of archiving, `v{n}` incrementing from 1 within that day, so chains from the same day stay ordered. The root holds only in-progress chains — artifacts carry no status line, so "in progress" and "finished" are distinguished only by location.

## Layer count follows the boundaries

Missing layers are legal; skipping layers is not. The further a change reaches, the longer the chain.

- **`intent.md`** — default starting point: the problem to solve, expected outcome, constraints, open questions.
- **`spec.md`** — lands only when the change **alters system behavior** or **crosses an existing policy boundary**: system behavior, data flow, affected systems, policy conflicts.
- **`plan.md`** — lands when the change does: which files, in what order, and how to prove it. It is both the execution checklist and the baseline for review comparison.

The gate enforces exactly one rule: once `spec.md` exists, `intent.md` must exist. Everything else is convention, not gate: `plan.md` may stand alone (small changes), and `intent.md` plus `plan.md` without `spec.md` is legal (a simplification that doesn't change system behavior).

## Open questions

Undecided matters go in `intent.md` with a machine-recognizable marker:

```text
[NEEDS CLARIFICATION: should third-party claims adjusters see this too?]
```

Once `spec.md` exists, no such markers may remain in `intent.md` — every one is either answered or explicitly carried over with who decides it.

## Required sections per layer

Only these sections must exist; the rest is free. The first line is the machine-readable identifier of each artifact.

- `intent.md` — `# Intent: <title>`, must have `## Problem`.
- `spec.md` — `# Spec: <title>`, must have `## Behavior`, `## Alternatives considered`, `## Areas of concern`.
- `plan.md` — `# Plan: <title>`, must have `## Files`, `## Proof`.

`## Behavior` states a checkable gate, e.g. "introducing a new concept or dependency requires evidence of a current consumer"; if that fails, say why it must be introduced. `## Areas of concern` may say "none" — "no conflicts" and "not checked" must be distinguishable. `## Alternatives considered` records what this design beat, or the same option gets argued again.

## Freezing

Chains may change freely while the work is in progress; they freeze at merge. Never go back to fix a finished chain so it keeps up with later changes — it records what was decided then, not what holds now. When a decision is overturned, say so in a new chain, not in the old one; replacement relations between chains are not recorded.

Freezing doesn't make a chain useless: `## Alternatives considered` in `spec.md` is the only record of what that design beat. **To re-argue an existing decision, search `.changes/archive/`** — that is the only place such reasons live.

## When to write

Every non-trivial change has at least one chain. The test: it changes behavior, architecture, conventions across files or modules, process or tooling, test strategy, on-disk or network formats, or any decision a maintainer might revisit.

## Deferred findings

A change often turns up a gap elsewhere that this change should not fix in passing — it would grow the chain, blur the review, and stuff two things into one change.

Its home is a chain containing **only `intent.md`**, written under `.changes/<slug>/` and left in the root until resolved or dropped: add later layers and archive on resolution, or delete it if abandoned.

It is not archived with the chain that found it. Archiving freezes; nobody reads a frozen `plan.md` again — before that chain closes, its finding must have grown into its own chain.

## Archiving

```sh
n=$(find .changes/archive -maxdepth 1 -name "$(date +%F)-v*" | wc -l)
git mv .changes/<slug> ".changes/archive/$(date +%F)-v$((n + 1))-<slug>"
```

Archived chains never change again. The gate checks only path shape under `archive/`, not content format — formats evolve, and frozen history should not be chased.
