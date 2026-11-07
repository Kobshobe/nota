---
name: tdd
description: Test-driven development. Use when the user wants to build a feature or fix a bug test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-driven development (TDD)

TDD is the "red → green" loop. This skill is the reference that makes the loop produce tests worth keeping: what a good test is, where tests live, anti-patterns, and the rules of the loop. Every section applies within each loop: consult them before and during the loop, not after.

While exploring the codebase, read the project's architecture docs first, so test names and interface vocabulary match the project's domain language, and respect existing decisions in the area you touch.

## What a good test is

A test verifies behavior through the public interface, not implementation details. The code can change completely; the test shouldn't. A good test reads like a specification: "user can checkout with valid cart" states exactly what capability exists, and it survives refactoring because it doesn't care about internals.

See the examples in [tests.md](tests.md) and the mock guidance in [mocking.md](mocking.md).

## Seams: where tests live

A **seam** is the public boundary where you test: you observe behavior there without reaching inside. Tests live on seams, never against internals.

**Test only on pre-agreed seams.** Before writing any test, write down the seam under test and confirm it with the user. Don't write tests on unconfirmed seams. You cannot test everything, so agreeing on seams up front puts test effort on critical paths and complex logic rather than every edge case.

Ask: "What is the public interface, and which seams should we test?"

When the shape of the interface itself is in question (how deep a module should be, where a seam belongs, what the interface should expose), read the project's architecture docs and relevant `spec.md` first, and align with their module, interface, and seam vocabulary; they are reference material to consult, not a session to run.

## Anti-patterns

- **Coupled to implementation**: mocking internal collaborators, testing private methods, or verifying through a side channel (querying the database directly instead of using the interface). Telltale sign: the test breaks on refactoring while behavior is unchanged.
- **Tautology**: the assertion recomputes the expected value the same way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot hand-derived the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-correct literal, a worked example, the specification.
- **Horizontal slicing**: writing all tests first, then all the implementation. Batched tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests become insensitive to real change, and you lock in test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last loop taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to make it pass. Don't anticipate future tests or add speculative features.
- **One slice at a time.** Each loop: one seam, one test, one minimal implementation.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the [`code-review`](../code-review/SKILL.md) skill), not the red → green implementation loop.
