---
name: tidy-code
description: >-
  Write, change or review code in a bounded area with the least final
  machinery and no wasted work: fix problems at the source, trust established
  internal invariants, reuse the project's canonical utilities/dependencies,
  delete forwarding wrappers and speculative guards/fallbacks, remove
  redundant computation and I/O, and keep caller-facing APIs to one direct
  call per intent. Use for local refactoring, simplification, optimization or
  a final readability pass on a module, file or feature, and whenever the user
  says "clean up", "simplify", "tidy", "optimize", "too slow", "too
  defensive", "too many layers", or "remove redundant guards". Not for
  repository-wide audits or architecture decisions (use
  audit-refactor-project) or for plain bug fixes.
---

# Tidy Code

Produce the clearest complete implementation with the least necessary final machinery. Optimize the whole supported call flow for the reader and the caller, not one file for the smallest diff or line count. Minimize concepts, branches, states, public calls, publications, call hops and file jumps while preserving required behavior, clear ownership, consistent naming and visible failures. Readability and visual order are acceptance criteria alongside correctness.

This skill is the single source of the local simplification rules. `audit-refactor-project` applies them across a repository; it owns repo-wide discovery, architecture and feature-removal decisions.

## Contract

Keep these active throughout and re-check them before finishing.

### Callers and publication

- Measure simplicity across callers and implementation together. Do not tidy the implementation by exporting filtering, branching, state tracking, key bookkeeping, sequencing or extra calls to every caller.
- One common supported intent is one direct call, interpreted once. A mixed set-and-clear update must not require split calls or repeated interpretation.
- Define omitted field, explicit clear marker, null-like value, ordinary value, merge and replace semantics explicitly, consistent with the public contract and neighboring APIs.
- Do not throw or add custom validation for an input that can be interpreted naturally and safely. Reject only for a concrete domain, safety, impossible-state or external-contract reason. Types, docs and runtime behavior must agree.
- Publish normal success once and coherently: install all required writes before running hooks, observers, notifications, commits and invalidation, and expose no avoidable intermediate success state. Count public calls, commits, notifications and observer-visible states as complexity.
- One owner and one canonical API per domain concept, state, validation rule, error mapping and operation.

### Failure semantics

One call and one coherent publication do not require failure atomicity. Never add rollback, compensation, retry, atomicity/transactions, locks, revisions, sessions, preflight, plan/seal, receipts, custom error types or error translation unless a concrete user-selected or authoritative domain contract requires them. Do not infer one from words like `submit`, `update`, `batch` or `notify`, from multiple writes or owners, or from wanting to notify once. Technical feasibility is not authorization.

- Retry needs an explicit contract with retryable failures, idempotency, limits and stopping behavior.
- Rollback needs a contract defining what is undone and how.
- A custom error needs an existing consumer of the distinction.
- Locking or revision state needs a real coordination contract, not a hypothetical race.

Otherwise let failures surface and propagate naturally. Catch, translate, retry, default, suppress or continue only where this layer owns required cleanup, cancellation, recovery, observability or an external error contract.

### Source and trust

- Fix problems at the authoritative producer, type, data shape, contract or boundary. Do not keep an avoidable optional and make every consumer check it.
- After an invariant is established by construction, parsing, initialization, an authoritative boundary or a required prior step, use the canonical value directly: no repeated validation, cloning, assertions, optional checks, fallbacks or catch-and-continue.
- Clone only when required behavior needs independent ownership, mutation isolation or a distinct lifetime.
- Validate external, deserialized, third-party, unsafe or security-sensitive data once, when a format, security, domain or external contract requires it. A public API alone does not justify validating every possible misuse.
- Establish each API or callback's responsibility, readable state, permitted writes and calls, and applicable lifecycle or execution phase before judging a guard. Visibility, overridability, a shared phase or a test callback does not grant extra effects.
- Keep a runtime defense only when a concrete reachable producer and required handling at this layer justify it. A reentrancy or stale-work guard additionally needs a permitted operation, a reachable supported sequence, and evidence that old work can damage current state. Prefer existing ownership, relationships and reference identity; remove only checks whose supported purpose has been ruled out, including shared purposes across different callbacks.
- If the contract is unclear, record the missing evidence. Do not invent defensive behavior or declare a use unsupported merely to remove a check. Existing callers and tests are evidence, not authority to override the contract; absence of an in-repo caller does not exclude supported public use.
- Test rare but supported workflows, including legal re-entry and required error propagation. Document explicitly excluded calls as contract limits; do not turn them into guarantees of success, rejection, ignoring the call or recovery. Preserve rejection or cleanup tests when an authoritative error or safety contract requires that behavior. Never add production checks or assert incidental error text merely to satisfy a probe; migrate tests that only preserve excluded behavior with the obsolete support code.

## Inspect before editing

Establish the required behavior, current owner, actual callers, invariant producers, error and publication behavior, local conventions, installed dependencies and relevant tests. Search the repository for existing APIs, utilities, shared packages, equivalent implementations, neighboring patterns and publication paths, and read manifests, workspace config, compiler targets and lint/format rules. Do not write a local implementation before checking whether the project already owns the operation.

Do not preserve a bug, quirk, obsolete structure or speculative compatibility merely because it exists, unless a caller or contract depends on it. If a change could alter user-visible behavior or an uncertain public contract, report evidence and tradeoff instead of deciding the requirement silently. Ambiguity is not permission to add a stronger guarantee.

## Reuse the project's vocabulary

- When a canonical project utility, domain API or already-installed mature dependency has the required semantics, use it instead of a hand-written or lower-level equivalent. Do not default to a native primitive just to avoid an import; use one only after confirming no canonical operation exists.
- If the project has standardized on `lodash-es`, use direct imports of the matching functions instead of `typeof` chains, repeated low-level expressions or local wrappers. Keep imported names intact, confirm exact semantics, and declare the dependency in every package that imports it.
- Wrap an existing call only when the wrapper adds real domain semantics, policy, ownership or lifecycle.
- Adding a new dependency needs recurring or substantial benefit, and should be confirmed with the user first.

## Performance

Removing wasted work is part of tidying, not a separate activity.

- Eliminate redundant computation, repeated parsing or serialization, I/O or queries inside loops, needless copies and full scans, independent awaits run serially, and wrong data structures or algorithms for realistic input sizes. These fixes are usually simpler and faster at once.
- Use the clearest algorithm and structure that fits the real input size; do not hand-tune what is not hot.
- Add a cache, memoization, batching, pooling or concurrency only on evidence (profile, benchmark, query count, documented requirement). When added, own its invalidation, ordering and failure semantics explicitly. Prefer removing work over caching it.
- Before deleting a clone, check, copy or precomputation as speculative, confirm it is not protecting a hot path or required isolation; keep it if it is.
- For a changed hot path, measure before and after on a representative workload and report the numbers. Never claim a speedup without measurement; if you cannot measure, say the gain is expected, not confirmed.

## Keep the main reading path clean

- Each file and class has a coherent role; never split by line count.
- Keep the main flow linear, with related definitions, state changes, publication and owned error handling close together in execution order. Use early returns to reduce nesting.
- Keep a direct condition when a rule is local and readable. Extract a pure function for one recurring stateless decision with clear input and output. Use a small domain object only when it owns several cohesive invariants and replaces scattered rules. Extract a component or class only for a real capability or lifecycle.
- One precise name per concept, status, constant and rule; keep imported API names instead of aliasing or forwarding.
- A pure forwarding layer (`function run() { return context.run() }`) must not exist. No proxy methods, trivial helper fragmentation, shared mutable state spread across objects, clever compression or speculative extension points.
- Remove dead code, stale imports, obsolete paths and comments that restate the code.
- Keep existing boundaries that own authorization, persistence, transactions, concurrency, cancellation, cleanup, external compatibility or error translation; do not create one without its contract.

## Refactor completely

1. Capture supported workflows and required error propagation with focused tests where coverage is thin, following Source and trust.
2. Trace callers, producers, publications and invariant boundaries; identify the canonical owner and contract.
3. Fix the owner, source contract, data shape, API, publication order and error behavior rather than adding downstream workarounds.
4. Migrate every in-scope caller and test.
5. Delete the superseded API, wrapper, branch, helper, type, import, dependency, config and comment.
6. Search for old symbols, alternate paths, duplicate utilities and hand-written equivalents.
7. Re-read and reorder the main flow for directness and scanability.

Rewrite the whole in-scope area when a local patch would keep wrong ownership, duplicated flows, needless states or indirection. Leave no temporary adapters or parallel implementations without a concrete compatibility contract. Keep scope local; if the change would reach beyond the files or module the user named, state the scope and reason first, and escalate to `audit-refactor-project` when repo-wide evidence is needed.

## Verify and finish

Run the formatter and proportionate type-check, lint, tests and build. Then confirm:

- callers express each common intent with one direct call and do none of the filtering, bookkeeping, sequencing, batching or notification suppression the API should own;
- mixed updates are interpreted once, and hooks and observers run only after the writes they must observe;
- every remaining runtime check has a reachable producer and required handling, and callback or continuation guards also meet the permission and stale-work conditions in Source and trust;
- no speculative guard, clone, fallback, assertion, optional chain or catch-and-continue remains;
- no rollback, retry, atomicity, lock, recovery or custom error machinery exists without an explicit contract;
- canonical utilities replace hand-written equivalents, and no duplicate helper, forwarding wrapper, alias or parallel API remains;
- no avoidable repeated work remains in the touched flow, and any performance claim is backed by a measurement;
- the main path is direct and ordered, and required failures stay visible and testable.

For any remaining mechanism that is hard to justify, name the contract and reachable evidence that requires it. If there is none, remove it or report the unresolved requirement.

## Out of scope

This is not a language tutorial; syntax already enforced by the language, formatter, compiler or linter does not belong here. Do not impose a utility-library preference on projects that have not adopted one. Project-specific dependency, style and runtime rules belong in the project's own instructions.