---
name: pre-push-checks
description: Before pushing, force-pushing, marking for review, or claiming checks pass, pick the minimum check set that covers the change about to be pushed, instead of reflexively running the full test suite.
---

# Pre-push checks

Before pushing, run **once** the minimum evidence set covering this change. The only ordering exception is a stacked-PR sync publish: it may rewrite branches before local verification, so verification must follow the sync immediately. Git hooks are deliberately narrow; full CI coverage belongs to the remote, not to the local machine.

## Determine the change

1. Confirm the working tree and branch.

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. Review the full change range against a **verified remote base**. Don't guess the base: take it from the current remote or stack state.

```sh
git fetch origin <base-branch>
git diff --stat origin/<base-branch>...HEAD
git diff origin/<base-branch>...HEAD
```

After merging the base, re-run the range report, re-decide which behaviors may be affected, and re-run only the checks invalidated by that merge.

## Choose evidence by surface

There is no universal local baseline beyond hooks. Every behavior change needs **the narrowest test or dedicated check that fails if it regresses**; add broader checks only when the change genuinely reaches a broader surface.

- **Code behavior**: run the test file that owns the behavior, or the focused test case names. When a shared convention changes, also run the neighboring modules' tests.
- **Docs, change chains, generated directories, or comments tied to docs**: run `python3 .agents/scripts/check_docs.py`.
- **Externally visible output** (API, command, UI, logs): run the focused tests owning that output, or a runnable demo scenario.
- **Manifests, public exports, build configuration, entry scripts**: run the build and the corresponding dependency and packaging checks.
- **Real external service behavior**: run the corresponding integration target when credentials are available; never print secrets.

Don't manually repeat a check that already passed just because "a commit is next".

## Full local rehearsal

Run a full local approximation only in three cases: the user explicitly asks, you're diagnosing a CI failure, or the change spans the whole repository so no narrower set is credible. Take the command list from the current workflows and scripts, not from memory.

## Protecting a history-rewriting push

Rebasing independent and stacked branches (including after review) is allowed. Before rewriting, fetch the remote branch and record its exact OID, then publish with `--force-with-lease=<branch>:<observed OID>`, so a concurrent remote update aborts the push. **Never use bare `--force`.**

After any rewriting push, re-fetch the live branch head and re-verify unresolved review threads, approvals, mergeability, and check status. Commit hashes and inline-comment anchors from before the rewrite are no longer current evidence.

## Handling failures

When a relevant check fails before pushing, stop, fix it, or explain the blocker. Don't "push it up to see whether CI differs".

If a failure looks environment-specific, prove it: record the exact command, the failing test, and the platform-specific difference; first confirm the platform-independent part of the evidence; when the check is required, prefer fixing the cross-platform nondeterminism. Bypass local hooks only when the user explicitly asks or agrees, and report honestly what failed and why CI is expected to differ.

## Push procedure

1. Run the selected relevant checks once.
2. Commit normally; if pre-commit auto-fixes changed files, review them before continuing.
3. Push normally, or use the exact lease for an authorized rewrite.
4. Verify the remote ref matches local `HEAD`.

```sh
git rev-parse HEAD origin/$(git branch --show-current)
```

For GitHub PRs, check remote CI after pushing:

```sh
gh pr checks
```

Report pending checks honestly as pending; read the failure content before attributing it to the branch or environment. When `gh pr checks` reports "no checks" while the commit exists, check mergeability before suspecting the push or the infrastructure.

Landing stacked branches uses [`merging-stacked-prs`](../merging-stacked-prs/SKILL.md).
