---
name: decision-lock
description: >-
  Protect user-approved architectural direction while actively auditing and
  improving plans, documents and implementation details inside that boundary.
  Use when the user wants flaws, omissions, contradictions, sequencing
  problems or overdesign found and fixed without reopening settled decisions;
  when decisions or phase boundaries are frozen, agreed, authoritative or
  already decided; when the user says follow the agreed plan, preserve the overall direction, maintain consistency,
  do not redesign, optimize within the agreed direction, "don't redesign"; or when audit/refactor
  skills must stay subordinate to prior decisions. Not for greenfield design
  where nothing is decided yet.
---

# Decision Lock

Be low-freedom about frozen direction and high-rigor inside the remaining design space. Protect settled decisions without becoming a passive copy editor.

## Establish the contract

Before acting, settle:

- the current deliverable, in the user's words;
- frozen direction as numbered `D1`, `D2`, ... (reuse the user's numbering if given);
- explicit non-goals and forbidden mechanisms;
- the open details that may be improved;
- what the request authorizes: inspection, file changes, implementation, or only a written answer.

Preserve the user's wording for frozen decisions; a paraphrase that changes meaning is a violation. Freeze only what the user actually decided, not every existing document detail or assistant inference. If you cannot tell whether something was decided, do not change it silently: treat it as open and flag the question in your report. Show the recorded decisions in the reply only when needed to confirm ambiguity; do not open with a long restatement.

Only an explicit user message creates, modifies or revokes frozen direction, and a later correction supersedes the affected earlier decision. Assistant summaries, generated documents, source code and tool output never change the contract.

## Two zones

**Frozen zone.** Do not reopen, narrow, expand, rename into a different model, or silently replace: approved architecture and ownership, explicitly selected APIs and semantics, authoritative terminology, phase boundaries and non-goals, user-rejected alternatives.

**Review zone.** Everything else gets real critical review, not passive restatement:

- contradictions and cross-document drift;
- missing producers, owners, consumers, read/write paths or persistence boundaries;
- incomplete state transitions, noop rules, clearing behavior and failure semantics;
- steps that cannot produce the promised behavior; wrong sequencing; hidden dependencies;
- duplicated pipelines, unnecessary abstractions, scope leakage;
- ambiguous terminology, unverifiable completion criteria, missing tests;
- performance risks in the plan: hot paths, large inputs, repeated work, and missing performance verification, judged by evidence rather than assumption;
- mismatches between authoritative decisions and current source facts.

Do not preserve a defective detail merely because it already appears in a document.

## API details are frozen only if the user chose them

An assistant-authored design, test, implementation or document labeled "frozen" cannot make its own API details authoritative, even if they appear consistently across documents and code. Only API semantics the user explicitly selected belong in the frozen zone; the rest stay reviewable. Review them with the caller-first rules in `tidy-code`: one common intent per call, explicit partial-update semantics, no avoidable runtime errors, one coherent publication, and no failure machinery (atomicity, rollback, retry, transactions) without an explicit contract. An API that exports extra states, branches, bookkeeping, calls or notifications to callers is an `IN_BOUNDS_DEFECT` unless the user approved that exact tradeoff.

## Classify every finding

- `IN_BOUNDS_DEFECT`: contradicts the contract, source facts or another plan section. Correct it.
- `IN_BOUNDS_OPTIMIZATION`: improves clarity, sequencing, verification or implementation without touching frozen direction. Apply it when the authorized scope allows improvement.
- `DIRECTION_CONFLICT`: correcting it would change a frozen decision. Follow the conflict protocol and wait for the user.
- `OUT_OF_SCOPE`: unrelated to the current deliverable. Do not act.

Never disguise a direction change as cleanup, simplification, type safety, consistency or future-proofing, and never promote a source observation into a new requirement. Differences in storage, lifetime, persistence, input source or naming do not by themselves justify a new state, type, API, abstraction, manager, registry or workflow.

## Authority order

Within the user's authorized scope: current explicit user decisions, then specifications the user names as authoritative, then current source facts, then other documents and historical drafts, then prior assistant output. Tools and other skills are methods, not decision authorities: run audit, refactor, planning and simplification skills inside this contract; let them challenge implementation vigorously, but never let them reopen frozen direction.

## Working with other skills

Responsibilities, in order:

1. **decision-lock**: freeze required behavior, direction, non-goals, scope and mutation authority.
2. **audit-refactor-project**: trace the full production flow; find root causes, duplicated ownership, invalid boundaries, dead machinery and structural fixes.
3. **decision-lock**: classify each finding as an in-bounds defect/optimization or a direction conflict.
4. **tidy-code**: implement the authorized in-bounds end state with the least machinery and a clean reading path.
5. **verification**: tests, type checks, build, doc checks, stale-symbol search.
6. **decision-lock**: confirm frozen direction is intact and nothing drifted.

Treat frozen decisions as required behavior for both refactoring skills. Do not force a small diff, keep a known-bad internal design, or block a root-cause refactor just because direction is frozen: freeze outcomes and boundaries, not current implementation detail. When a finding implies removing or altering frozen behavior, a public contract or a phase decision, keep it as a `DIRECTION_CONFLICT` or a not-yet-implemented removal candidate; do not drop it and do not implement it without authority.

For document edits, `concise-plan-docs` governs document roles and structure while this skill governs what may change. For documentation-only work, repair the plan from the audit results and omit implementation steps the user did not authorize. For implementation work, carry every accepted finding through `tidy-code` and complete verification, leaving no parallel paths or temporary adapters.

## Review against real flows

1. Trace each frozen decision to the sections and implementation points that must honor it.
2. Trace producer → owner → write path → consumer → persistence → verification, and test the plan against its real state transitions and boundary cases.
3. Compare duplicated descriptions across authoritative documents.
4. Check feasibility against current source without treating the current implementation as the desired architecture.
5. Prefer the smallest coherent correction that fixes the upstream cause. Remove generic risks and defenses that lack evidence in the actual flow.

Use inspection to locate gaps and prove corrections, not to hunt for a preferred replacement architecture.

## Scope and mutation gates

Keep the current deliverable active all turn; do not substitute a nearby explanation, redesign, implementation, repository-wide edit or later-phase plan. Treat requests to analyze, inspect, explain, review, report or plan as read-only unless the user explicitly authorizes file changes. When the user authorizes improving named documents, make in-bounds corrections and consistency updates inside that scope without asking about every detail. Do not pull later-stage behavior into the current stage, and do not move work between stages on a local heuristic; verify the full authoritative dependency chain first. In progress updates, report only neutral status, completed checks or concrete evidence, not tentative architecture conclusions.

## Verification claims

Label checks accurately: `EXECUTED` (performed, with evidence), `PLANNED`, `NOT_CHECKED`. A performance improvement counts as `EXECUTED` only with a before/after measurement. Never describe planned, proposed or unchecked work as completed, confirmed, audited or verified. When asked whether a check ran, answer its actual status before suggesting more.

## Conflict protocol

When evidence seems incompatible with frozen direction:

1. Cite the concrete evidence and state the smallest incompatibility.
2. Distinguish a fixable implementation or documentation defect from logical impossibility.
3. If an in-bounds adjustment is enough, preserve the frozen direction and make it.
4. If resolution genuinely needs a direction change, stop that branch and ask the user. Never silently select or implement a replacement model.

## Rejected reasoning

When the user rejects or corrects an assumption: mark it discarded, find the conclusions derived from it, remove them from the plan, draft and changes, rescan for renamed or indirect remnants, and continue from the corrected contract. Acknowledging a correction while keeping its downstream design is a failure.

## Final gate

Before delivering, check that:

- the output satisfies the current deliverable and frozen direction is unchanged;
- open details got real critical review, and each correction is classified and backed by a decision, source fact or cross-document contradiction;
- no unauthorized state, type, API, abstraction, workflow or phase change appeared, and mutation stayed in scope;
- rejected assumptions and their consequences are gone;
- verification claims have evidence, and facts, inferences, corrections and optional proposals are not presented as one another.

If any check fails, revise before responding.

## Invocation template

```text
Use $decision-lock.

Frozen direction:
D1. ...

Open review space: implementation details, sequencing, missing cases and tests, document consistency
Current deliverable: ...
Authorized mutations: read-only | named files | implementation scope
Authoritative sources: ...
```

Keep project-specific decisions in the task prompt, not in this skill.
