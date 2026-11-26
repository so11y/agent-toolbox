---
name: concise-plan-docs
description: >-
  Write, revise and maintain implementation plans and related project
  documents as a non-redundant system where every rule has one authoritative
  owner: normative contract (specs, numbered decisions), action plan,
  analysis, and execution record. Use whenever the user asks to create or
  change a plan, spec, contract, numbered decision (e.g. "D12"), acceptance
  gate, task board or progress record, or to deduplicate or reorganize such
  documents, e.g. "update the plan document", "revise this decision", "adjust the plan to the new decision",
  "organize the planning documents", "write up the implementation plan", "record what we did".
  Bounded edits stay bounded: change the authority and only the active text
  that would implement the old rule. Not for README/API reference, code
  comments, or general prose editing.
---

# Concise Plan Docs

Keep a project document system precise, executable and stable under change. "Concise" means every passage has one job, not that the document is short. A large contract may keep every detail that changes behavior, ownership, sequencing, interfaces, persistence, migration, verification or acceptance.

The organizing idea is separation of concerns: the **plan follows the contract**; analysis and records may explain or report it but never silently redefine it.

## Document roles

- **`CONTRACT`** (normative): target behavior, user-visible boundaries, ownership, data contracts, persistence rules, prohibitions, approved exceptions, and decision status. No diary prose, and no unexecuted work presented as done.
- **`PLAN`**: work packages, order, dependencies, owners, deliverables, exit gates, verification commands. It references contract decisions by identifier and creates no competing product rule ("implement D12", never a restatement of D12).
- **`ANALYSIS`**: observed facts, source traces, measurements, causes, derived consequences, alternatives, open questions. May recommend inside the contract boundary; references normative decisions instead of copying them.
- **`RECORD`**: what was actually done, when, with which commands, evidence and results, and remaining gaps. Never changes the target by implication. A historical result that differs from the current target stays historical and is marked so.
- **`INDEX`**: routes readers to the above and tracks ownership and status; does not restate the contract.

**Declaration rule.** A new or structurally revised document declares its role, authority source, scope and what it may define. A structural revision changes the role, authority boundary, overall scope or organizing structure; editing one rule, decision or acceptance condition is not one. During a bounded edit to an existing document, leave its metadata alone unless a missing role makes the edited scope ambiguous.

## Authority order

User instructions and repository rules first, then the user's latest explicit decision, the current contract for the document's scope, active plans and gates derived from it, and finally evidence, analysis, records and earlier assistant prose. A document is authoritative only within its declared scope; confident wording or being copied into several files does not make anything normative.

## Before writing

1. Identify the role, scope, and the authoritative owner of every normative topic involved, and read that contract first.
2. If a topic has an owner, do not define it again: write a short reference plus the local consequence. Never make a document "self-contained" by copying another document's definition.
3. Create no rule, exception, owner, interface, state, workflow or product behavior by implication.
4. If evidence conflicts with the contract, keep the evidence as `FACT`/`RECORD`, name the smallest conflict, and when resolving it needs the user's decision, flag `DIRECTION_CONFLICT` and ask rather than pick a side.
5. When writing into an existing document set, follow its language and conventions.

## Labels

Use labels only where a passage's role is not obvious from its section. Do not tag every paragraph.

- Decision status in contracts: `LOCKED`, `DERIVED`, `PROPOSED`, `OPEN`, `DEFERRED`.
- Evidence: `FACT`, `RECORD`.
- Verification claims: `EXECUTED`, `PLANNED`, `NOT_CHECKED`, stated accurately.

Keep normative ("must"), planned ("will do"), observed, suggested, and completed statements distinct.

## Change modes

Classify the request before editing. When the mode or scope is ambiguous, state it in one line and proceed.

- **`AUTHORITY_CHANGE`**: create or modify a contract. The default whenever the user asks to change a spec, decision, rule, contract or numbered decision. It is not a cleanup command.
- **`PLAN_CHANGE`**: change work, order, dependency, owner or exit criteria without changing the contract.
- **`ANALYSIS`**: inspect or explain evidence; no target rewrite unless authorized.
- **`RECORD`**: record completed work and checks; never present planned work as completed.
- **`DOC_CONSOLIDATION`**: only when explicitly requested.

### AUTHORITY_CHANGE

1. Update the single authoritative definition first.
2. Treat search hits as candidates, not edit targets. Classify each as authority, active plan/acceptance, analysis fact, record, citation, or unrelated lexical match.
3. Edit the authority and only active text whose behavior, ownership, ordering, interface or acceptance would otherwise implement the old rule. Replace superseded target text and conclusions derived from it; do not append a correction beside a still-active old rule.
4. Do not rewrite historical evidence, completed records or ordinary references to unify wording. No global search-and-replace, terminology normalization or duplicate-summary cleanup.
5. Elsewhere, cite the decision identifier and give only the local consequence.
6. Stop when the authority is correct and no active semantic conflict remains.

### DOC_CONSOLIDATION

Trace repeated concepts to their best owner, move material to the correct role, replace redundant definitions with references, remove diary prose and stale derived conclusions, and finish with a contradiction and stale-term sweep. Preserve every detail that can change behavior, ownership, sequencing, interface, migration, verification or acceptance.

## Writing rules

- State each normative decision completely once; elsewhere use a reference, e.g. "Under D12, this section describes only the implementation semantics of the commit phase".
- A textual difference is a conflict only if it could lead to different behavior, owner, ordering, interface, persistence result or acceptance result.
- Keep code, tables and examples that define an API, state transition, data structure, edge case or observable contract. Remove only what has no independent implementation or verification consequence.
- No arbitrary limits on length, sections, examples or tables.

## Scope and stopping

Before editing, note the requested deliverable, authorized mutations, governing contract and non-goals. Do not grow a plan change into a spec change, or a spec change into repository-wide cleanup, without authorization. Repository-wide wording sync is never an implicit completion condition. A one-passage change stops once that passage is updated and any resulting active conflicts are resolved; unrelated metadata, headings, summaries and history stay untouched.

## Final review

- Normative content has one owner; plans hold actions, not new requirements.
- Analyses separate facts, derivations, proposals and open questions; records separate executed evidence from planned work.
- No superseded target text is still active; history was not rewritten as current.
- No unauthorized feature, state, workflow or API appeared.
- Links, headings, status labels and acceptance gates agree.
- Role declarations follow the Declaration rule.

**Deletion test.** For any questionable passage, ask whether removing it could change an implementer's choice about behavior, ownership, ordering, scope, interface, migration, verification or acceptance. If yes, keep or sharpen it. If no, delete it, merge it into its owner, or move it to the right role.

## Report

State the mode, the files changed, and the files reviewed but left unchanged with a reason each; list any `DIRECTION_CONFLICT` or `OPEN` items that need the user.