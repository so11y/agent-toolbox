---
name: code-analysis
description: >-
  Read-only, evidence-bounded analysis of a specific function, flow or module
  along one named dimension: performance (where time, memory or I/O goes for a
  stated scenario and scale) or reentrancy/concurrency (whether an
  interleaving can actually produce a wrong state). Confirms or refutes a
  suspicion and reports only findings backed by a cost calculation, a concrete
  execution sequence or a measurement; "no significant problem found" is a
  valid result. Use when the user asks "why is this so slow", "analyze performance", "is this a performance issue",
  "is there a reentrancy, concurrency, or race issue", "where is the time going", "can this
  re-enter". Does not edit code, hunt bugs or give generic advice. Not for
  implementing fixes (use tidy-code) or whole-repository audits (use
  audit-refactor-project).
---

# Code Analysis

Answer one question for one dimension: does this actually go wrong, or cost enough to matter, in this code? Read-only: edit no files and write no replacement code; describe a fix direction in one sentence at most. Analyze only the dimension the user named and do not widen to others.

## Inputs

- **Dimension**: performance, reentrancy/concurrency, or both if the user says so.
- **Scope**: the entry point, function or module. If the user names a suspect, verify that first and only that.
- **Performance also needs** a metric (latency, throughput, memory, query count, startup) and a scenario with scale (e.g. one request, 10k rows).

Infer a missing input from context and state it; ask one question only when no sensible assumption exists.

## Evidence

Label every claim `MEASURED` (from a profile, log, benchmark, `EXPLAIN` or a run), `DERIVED` (computed or traced from the code), or `UNVERIFIED`. Prefer existing measurements over reasoning; take a new measurement only if it is cheap and possible here.

## Performance

1. Trace the real call path for the scenario from entry to final I/O.
2. For each stage, compute cost: loop depth × size, query and I/O count, copies and serialization, serial versus parallel awaits, memory retained. State growth in N and find the dominant stage.
3. Try to refute each candidate before reporting it.

Report only a stage that is dominant or roughly 20% or more of the total (unless the user sets another threshold) and whose calculation you can show. Skip micro-optimizations and low-level tuning unless asked.

## Reentrancy and concurrency

1. Find the **inconsistent window**: the span between the first and last write of related state. Note any external code that runs inside it (callbacks, observers, awaits, I/O, external calls), and any check-then-act that spans an `await`.
2. Check whether the window is already closed by ordering, such as all writes finished before hooks run. If so, there is no finding.
3. Find who can re-enter, and confirm that path is reachable in production by tracing callers.
4. Write the interleaving: which call is interrupted at which line, what re-enters and how, what state it sees or overwrites, and the wrong result.

Report only if you can complete step 4 for a reachable path. Otherwise give at most one line, or nothing. Do one pass: no enumerating hypothetical interleavings, no threading analysis for single-threaded code beyond `await` interleaving, and no importing smart-contract reentrancy unless the code is a contract. The usual fix direction is ordering (finish the writes before notifying), not locks or flags.

## Reporting threshold

A finding needs a location, a mechanism, a quantified or sequenced consequence, and evidence labeled `MEASURED` or `DERIVED`. Drop everything else; do not soften it. No "may", "might", "consider", and no generic advice (caching, pooling, async, indexing, locking) unless tied to a specific location and consequence. Do not hunt bugs or review style or security; if you notice a correctness issue, give it one line at the end with no analysis. `UNVERIFIED` points never appear under Findings.

## Output

Keep this structure; short is fine.

- **Verdict**: one sentence: problem found, none found, or cannot tell without measurement or a run.
- **Findings**: for each, location, calculation or interleaving, evidence label, expected effect, fix direction in one sentence, and how invasive the change would be. Write "none" if there are none.
- **Checked and ruled out**: points you actually read and why they are not a problem. Never list what you did not inspect.
- **Needs measurement or a test**: what to measure or reproduce, and how. Omit if none.
- **Not examined**: files or paths you did not read, with no assumption that they are fine.

If nothing meets the threshold, give the verdict, what you checked and what you did not examine, then stop. A short answer is a correct answer.

## Stopping

Stop once the dominant problem is identified and nothing else reaches the threshold, or, if the user gave a target, once fixing the dominant stage is predicted to meet it. Do not continue into the long tail to fill the report.