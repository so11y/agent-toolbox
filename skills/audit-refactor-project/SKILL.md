---
name: audit-refactor-project
description: >-
  Whole-repository audit and refactor for simplicity and performance: finds
  duplicated ownership across features, repairs root causes upstream, removes
  speculative validation, fallbacks and error suppression, simplifies
  over-engineered APIs and module boundaries, finds evidence-backed
  performance problems (redundant work, N+1 and I/O in loops, needless copies,
  hot-path waste), and verifies with the full format/lint/type/test/build
  chain and before/after measurement. Reports user-visible feature removals as
  candidates without implementing them. Use whenever the user asks to audit,
  review, simplify, de-duplicate, optimize, speed up or clean up an entire
  project or several modules, even without the word "refactor" (e.g. "audit
  this repo", "simplify the architecture", "find duplicated logic across
  features", "why is this system slow", "remove dead code and over-defensive
  checks", "audit/refactor/optimize repo"). Not for single-bug fixes, new features,
  single-file cleanup or small local refactors (use tidy-code).
---

# Audit and Refactor a Project

Produce the simplest coherent end state that fully supports required behavior. Judge simplicity by the final concepts, states, branches, APIs, call hops, dependencies and ownership boundaries, not by diff size or effort.

Establish required behavior from current user direction, authoritative API/domain contracts and intended production workflows. Existing callers and tests are evidence; a caller can violate the contract, and a test does not authorize extra side effects or special production handling.

## Modes

- **Audit only** (the user asks to audit/review/assess): produce findings, the ranked list and the removal inventory. Do not edit.
- **Refactor** (the user asks to refactor/simplify/clean up, or approves the audit): run the full workflow. Broad permission covers complete internal, behavior-preserving repairs. Removing user-visible features, workflows or uncertain public APIs still needs explicit approval.
- **Plan checkpoint**: before rewriting a subsystem or changing several packages, state the scope and structural evidence first, then proceed unless the user objects.

## Principles

Local implementation rules live in `tidy-code`; this skill adds the system-level ones. The workflow below refers to them by name.

### Local Rules

Read and apply [tidy-code](../tidy-code/SKILL.md) before the first edit. It owns the local caller, publication, failure and trust rules, including callback permissions and test boundaries in [Source and trust](../tidy-code/SKILL.md#source-and-trust). This skill adds the repository-wide tracing and cross-feature checks below.

### Cross-Feature Consistency Contract

Do not consolidate from code similarity. First finish each feature's vertical trace; only then compare siblings stage by stage (interpretation, normalization, validation, defaults, nullability, filtering, ordering, units, aggregation, conversion, state transitions, errors, publication, persistence, output mapping). Mark the common prefix, the first legitimate divergence point, and independent re-interpretations of the same fact.

- Each shared domain fact or rule gets one owner, one canonical representation, one implementation. Interpret shared input once; consumers derive only what their distinct behavior needs, and never re-normalize or re-validate the canonical value.
- Consolidate the common semantic prefix and delay divergence until behavior actually differs. Parallel pipelines implementing the same meaning count as duplicated ownership even if their code shape differs or their output currently matches.
- **Do not weaken the model to share code.** No optional-izing required fields, erasing domain types into primitives or generic maps, merging distinct states, or adding type switches, mode flags or lowest-common-denominator contracts. A generic processor that grows flags and optional fields is another parallel concept, not consolidation. If no truthful common contract exists, keep the concepts separate.
- Measure by change locality: changing one shared rule should touch only its canonical owner.

### Performance

Performance is a first-class audit dimension, judged by evidence rather than taste.

- **Cost drivers to look for while tracing:** work repeated per request, item or render; queries or I/O inside loops (N+1); repeated parsing or serialization; full copies or full scans where incremental ones suffice; wrong data structures or algorithmic complexity at realistic input sizes; independent awaits run serially; unbounded growth of memory, caches or listeners; eager work that is rarely used.
- **Evidence:** profiles, benchmarks, query counts, logs, complexity analysis on real input sizes, or a documented requirement. If none exists, take a quick measurement when practical; otherwise mark the finding `suspected` with its assumptions and the measurement that would confirm it.
- **Rank by impact on real flows,** not micro-level tidiness. Skip micro-optimizations without evidence.
- **Remove work before adding machinery.** Deleting redundant computation, duplicated pipelines and needless copies is both simpler and faster. Add caches, memoization, batching, pooling or concurrency only when measurement or a contract requires it, and then own invalidation, ordering and failure semantics explicitly.
- **Protect hot stages when consolidating or deleting.** Mark performance-sensitive stages (streaming, batching, incremental updates, hot loops) first and preserve their behavior; a deletion that trades speed for tidiness needs evidence the code is off the hot path.

## Workflow

### 1. Baseline

Resolve the repo root, applicable instructions, worktree state and scope; preserve unrelated user changes. Exclude vendored and generated trees unless implicated. Find and run the practical format, lint, type-check, test, build and end-to-end commands, and record pre-existing failures before editing. For large read-only investigations, split by subsystem across parallel agents if available, with explicit edit ownership.

### 2. Trace

Follow each relevant entry point to its final side effect and response, through orchestration, domain logic, state, persistence, external services and output mapping. Map each API's responsibility, read/write ownership, permitted calls and applicable lifecycle or phase before analyzing callbacks or overrides.

For each callback or continuation guard, apply tidy-code's Source and trust in order: confirm the operation is permitted, trace a reachable supported sequence, demonstrate the harmful result, then identify the layer responsible for handling it. Inspect writes, notifications and resource releases after the boundary as well as partial state before it. Check every legitimate boundary served by a shared guard before removing it. Record unclear permissions as evidence gaps; do not redefine the contract to justify keeping or deleting code.

For other guards, fallbacks, assertions, validation, optional chains or catch-and-continue, trace where the invariant is established and judge the handling against its producer and contract. Map config knobs, compatibility paths, pass-through wrappers, dependency direction, duplicated sources of truth, hidden globals and import-time effects. Compare callers with tests and docs. Check authorization, sensitive data, resource limits and injection only where the system actually exposes them.

### 3. Classify and Rank

Label each feature, API, workflow stage, validation, fallback and abstraction as **required, externally constrained, redundant, speculative, obsolete, or unresolved**. Rank structural findings by the reduction in concepts, branches, states, call hops, dependencies and test burden, and by measured or reasoned performance impact.

Removal targets, when the call graph proves they add no required behavior: duplicated ownership, repeated validation, silent error handling, unnecessary compatibility paths, generic setters, equivalent APIs, forwarding layers, dead internal machinery.

Keep a separate **removal-candidate inventory** for user-visible features, workflows and uncertain public APIs. Report the total count and, per candidate: evidence, expected simplification, affected behavior or contract, migration cost, risk, confidence, and a keep / investigate / request-approval recommendation. Do not implement without authority.

### 4. Repair in Ownership Order

1. Prove the issue (call graph, duplicated ownership, needless state or hops, misleading contract, or a focused failure).
2. Fix the earliest owner of the rule, state or malformed data.
3. Establish one canonical contract, shape, source of truth and error behavior for the shared stage (see Cross-Feature Consistency Contract).
4. Make siblings derive their feature-specific data from the canonical result.
5. Migrate every in-repo caller and relevant test.
6. Delete superseded branches, wrappers, APIs, types, helpers, imports, dependencies, config, comments and compatibility paths.
7. Search for old symbols, alternate names, duplicated literals and downstream reinterpretation of canonical values.

Use `tidy-code` for local shape and the final readability pass (nesting, forwarding, file jumps). Leave no temporary adapters, parallel implementations, half-moved ownership or speculative extension points.

### 5. Verify

Format changed files, iterate with focused tests, then run the broadest practical type-check, lint, tests, build, docs and end-to-end checks. Separate pre-existing failures from regressions; if a check cannot run, state the exact blocker. Select tests using tidy-code's Source and trust rules; preserve rare supported sequences and required error behavior, and migrate tests that only enforce excluded behavior with the obsolete implementation.

Re-check the Cross-Feature Consistency Contract against production flows: one owner per shared rule, no parallel normalization/validation/defaulting/filtering/ordering/conversion/publication/persistence left, no weakened types or invariants, no universal processor or compatibility layer standing in for domain concepts. Tests should cover the canonical stage once and each consumer's distinct derivation.

For changed hot paths, measure before and after on a representative workload and report the numbers; never claim a speedup without measurement, and report regressions.

Inspect the final diff for unrelated edits, stale imports, debug code, accidental public-contract changes and retained speculative defenses.

## Report

Lead with the architectural or behavioral outcome, then:

- owning causes fixed and obsolete machinery removed;
- the ranked, not-implemented removal inventory;
- performance findings, confirmed vs suspected, with evidence and measured impact;
- exact verification commands and results;
- only concrete residual risks or blockers.