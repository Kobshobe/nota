# Documentation standard

This file defines document layering, writing rules, and character budgets. It constrains markdown in the repository root `*.md`, `docs/`, `.agents/`, and `.changes/`; notes in the source tree are not scanned by the gate. Change chains (including the example chain) are subject to the one-paragraph-per-line and link checks like any other document, but are not registered in the character budgets; the frozen snapshots in [`.changes/`](../../.changes/README.md) are checked only for directory shape.

## One fact, one home

Every fact has exactly one owning layer; elsewhere, keep only a link. Decide which layer a piece belongs to before writing.

| Layer | Responsibility | What doesn't belong |
|---|---|---|
| Root `AGENTS.md` | Standing orders: rules an agent needs in context every session, one to three lines each, linking to their owning layer | Stories, full examples, situated procedures, content restated from links |
| Architecture docs | An ordered map: composition, core modules, data flow, extension points; required reading before touching core code | Type definitions, per-module detail, decision rationale, implementation status markers |
| Subsystem / module reference | One page per subsystem: type definitions, semantics, public interface | Behavior narratives, decision rationale |
| Change chains (`.changes/`) | Three artifacts per change: the problem, system behavior, how this change does it; frozen at merge | Authoritative description of current behavior, backfilling later changes |
| Incident write-ups (postmortem) | The incident story — the only place narration is allowed | — |
| Cookbook | Operational guides with numbered verification steps | Design rationale (link to the chain) |
| Module README | That module's contract: configuration, semantics, limits, extension points | Restated comments, other modules' concerns |
| Development guide | Environment setup, daily workflow, CI overview | Itemized checklists (they drift from scripts) |
| Skill (`.agents/skills/`) | Reusable workflows and judgment criteria | Product and runtime conventions (belong to docs or source) |

Placement principles: a defect → postmortem; why this was done now → change chain; why it is like this now → architecture doc or module README; steps → cookbook; type definitions → subsystem reference; standing rules → root `AGENTS.md` with reasons linked.

## Tutorial or reference

- **Tutorial**: an ordered path to a result, introducing only what each step needs.
- **Reference**: defines a lookup scope and states current behavior, with no teaching order.

Split them when both carry substance; annotate the split explicitly inside one document only when one part is small.

Before writing a tutorial, decide the reader's starting knowledge and label every concept as beginner / intermediate / advanced; establish prerequisites before the concepts that depend on them; increase difficulty; move unnecessary advanced content into later tutorials or reference.

Writing order: locate the document in the tree → decide the allowed detail granularity → choose tutorial or reference → (tutorial) order by prerequisite and difficulty → move details that belong lower down → link to their new homes.

## Writing rules

- **Write the current state, not the change history.** Never use "used to / now / no longer"; never cite PRs or commits; leave the story of a change to its chain or postmortem.
- **One paragraph, one physical line.** Use the editor's soft wrap; code blocks, tables, and list structure keep their original format.
- **Code blocks must compile or run.** Example code in docs must be verifiable by the corresponding tool, or it doesn't belong.
- **Comments and docs state the full contract, not the reasoning.** Keep behavior, failure, ordering, ownership, and safe-use information; drop narration, test walkthroughs, review analysis, and code restatement.
- **Name participants and facts concretely.** Write "response field", "JSON validation", "export interface", not "response shape", "validation boundary", "module shape"; reserve words like `contract` and `boundary` for real agreements and boundaries.
- **Cross-reference with relative markdown links**, never bare filenames or numbers; links must resolve and anchors must exist, checked by [`.agents/scripts/check_docs.py`](../scripts/check_docs.py).

## Anti-slop checklist

Search any document for these and handle them on sight:

- The same rule in several layers. Grep a distinctive phrase, keep one home, turn the rest into links.
- Narrating history or story: "used to / now / no longer / once / renamed / moved", PRs, commits.
- Implementation status markers: "Implemented!", "Future: ...". Status rots; repository structure and manifests are the authority.
- Hand-restating directories, comments, tests, or module inventories when source or a generator is the authority.
- Reasoning process: step-by-step implementation narration, proofs of obvious branches, test walkthroughs, rejected local options.
- Repeating rationale beside several parallel members instead of writing it once at the capability or helper that owns it.
- Paragraph walls: one paragraph stuffed with several rules and parenthetical asides. Split or push down.
- Emphasis inflation: bolding everywhere, all caps, "crucially". Keep emphasis for clauses that really change behavior.
- Test walkthroughs and implementation narration in chains: a chain records the problem, system behavior, and execution plan, not a process retrospective.

## Character budgets

[`.agents/scripts/doc-budgets.json`](../scripts/doc-budgets.json) registers a character limit per document; [`check_docs.py`](../scripts/check_docs.py) fails when a document exceeds its limit, sits at its limit, or is missing from the registry.

When the gate turns red, work in this order:

1. **Move**: content that belongs to another layer moves there, leaving a one-line link when needed.
2. **Compress**: content that does belong here but can be shorter.
3. **Raise the limit**: only when the content genuinely needs the space, and explain the registry change in the change description. A limit that is too low is a quota bug.

Limits are guardrails, not reduction targets. A document at its limit keeps at least 5% headroom, and the gate enforces that; if you can't compress further, raise the limit and explain the registry change in the change description.
