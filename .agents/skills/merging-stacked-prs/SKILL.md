---
name: merging-stacked-prs
description: Land a series of interdependent GitHub PRs (A ← B ← C, each based on the one below) on the trunk, merge a PR whose base is another unmerged PR, or take any request mentioning stacked PRs, PR stacks, dependent PRs, or merging several related PRs in order. Every same-repository dependency chain must use GitHub's official stacked-PR feature before landing, so GitHub owns stack-level rules, CI, ordering, redirection, and merge state.
---

# Land an official GitHub PR stack

Land dependent PRs through GitHub's native stack object and `gh stack merge`. Do not replicate stack semantics by merging and retargeting one at a time with `gh pr merge` and `gh pr edit`. Branch-history policy (merge-forward and rebase allowed) is owned by the root [`AGENTS.md`](../../../AGENTS.md).

## Require native stack support

Run `gh stack --version` before changing any GitHub state. When the official extension or the server-side stack feature is unavailable, **hard stop**; do not fall back to manual per-PR merging and retargeting. GitHub stacks require every head branch to live in the same repository; a chain spanning forks is a hard stop.

Use a clean, dedicated worktree. Pull the current PR metadata and exact head OIDs; don't trust branch names or earlier reports:

```sh
gh pr view <pr> --json number,author,baseRefName,baseRefOid,headRefName,headRefOid,isCrossRepository,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup
```

For every suspected chain, check `PullRequest.stack` and `stackEntry.position` on at least one PR: the official GitHub object, not an inference from base branches, is the authority on stack membership. Establish the expected bottom-up order from the live PR bases: the bottom PR targets the trunk, and each higher PR targets the head branch of the one immediately below.

## Link missing stack members

Compare the existing stack entries with the expected chain first. An existing stack may contain an order-preserving subset of the requested chain; multiple stack numbers, unexpected entries, or conflicting order require user direction before any change.

When a dependent PR is not yet in the official stack:

1. Compare each `author.login` exactly.
2. When all authors match, link automatically in bottom-up order:

```sh
gh stack link --base <trunk> <bottom-pr> <next-pr> ... <top-pr>
```

3. When authors differ or an author is unavailable, ask the user before changing GitHub state.
4. Re-query GraphQL and require: one stack number, the expected trunk, the complete PR set, the expected positions, and the expected base chain.

Never automatically dissolve, reorder, or rebuild an existing stack; `gh stack link` only adds, and merged or queued entries cannot be unstacked.

## Refresh only when needed

Don't rewrite branches just because a refresh mechanism exists. When the live merge state or repository rules require an updated trunk, choose one:

- **Native cascading rebase**: check out the remote stack with `gh stack checkout <pr-or-stack>` (when untracked locally), then run `gh stack sync`. It may rebase and lease-protected force-push every layer before local verification; immediately check the rewritten range, run the relevant checks for each layer, and don't merge or claim readiness until they pass. After resolving conflicts with `gh stack rebase`, publish with `gh stack push`. If checkout or sync reports a divergence between local and remote stack composition, cancel and ask; do not delete or rebuild the remote stack automatically.
- **Incremental merge-forward**: merge the trunk into the lowest affected layer, then merge each updated parent branch into its child bottom-up, pushing normally. When the base advances mid-flight, save that checkpoint before merging a newer tip.

Any history rewrite is allowed after review, but it invalidates commit-OID assumptions. After pushing, re-pull the exact head and re-verify unresolved review threads, approvals, mergeability, and checks. **Never use bare `--force`**, and never overwrite a concurrently advanced remote head.

## Pre-flight scope before merging

Re-query the official stack immediately before merging. Require every selected PR to be open, non-draft, in the expected order, and satisfying the repository's review and check requirements. Treat each PR's state independently: a ready top does not prove its dependencies are ready.

"Land this stack" selects the whole stack. A partial landing needs an explicit boundary PR and includes every layer from the bottom through that boundary.

## Merge through the stack API

Merge the whole stack by its official stack number:

```sh
gh stack merge <stack-number> --yes --merge
```

For an explicitly requested partial landing, merge through the boundary PR:

```sh
gh stack merge <boundary-pr> --yes --merge
```

Don't pass `--delete-branch`, don't retarget dependencies by hand, and don't issue per-PR merge commands. GitHub merges the selected range bottom-up and retargets or rebases the remaining upper layers. A direct stack merge is all-or-nothing; when the trunk uses a merge queue, GitHub enqueues the selected range together but may land it in batches.

Don't bypass merge requirements. When a native merge reports a blocker, resolve it through the PR that owns it, or stop and report; **never** fall back to `gh pr merge`.

## Verify landing state

Wait until every selected PR reports `MERGED`; being enqueued does not count as landed:

```sh
gh pr view <pr> --json number,state,mergedAt,mergeCommit,baseRefName,headRefName
```

For a partial landing, re-query the official stack and verify that every remaining PR is still linked in the expected order, targeting the stack trunk or the layer directly below it. Because GitHub may have rebased the remaining layers, re-check the current heads, review state, and CI.

Delete branches only after the corresponding PR reports `MERGED`, as a separate final pass. Before deleting, require that GitHub reports no open PR still based on it:

```sh
gh pr list --state open --base <branch> --json number --jq length
```

A result other than `0` blocks deletion.

## Checklist

- [ ] Native `gh stack` is available; every PR branch lives in the same repository.
- [ ] Live PR bases and exact heads establish a bottom-up dependency chain.
- [ ] GraphQL reports one official stack with the expected trunk, entries, and order; unstacked same-author chains were linked automatically.
- [ ] Every rewritten layer passed its relevant checks, and review threads, approvals, mergeability, and checks were re-verified afterwards.
- [ ] The whole stack, or the explicitly bounded prefix, was submitted through `gh stack merge --yes --merge`.
- [ ] Every selected PR reports `MERGED`; the remaining upper layers still form the expected official stack.
- [ ] Branch deletion happened only after verifying merge state and zero dependents.
