---
name: codex-worker
description: >-
  Delegate bounded, well-specified file reading, codebase sweeps, batch edits,
  test-fix loops, or diff reviews to local Codex CLI as a strict execution
  worker without loading host skills or widening scope. Use when the user
  authorizes Codex in this conversation (for example with "@codex",
  "/codex-worker", or phrases like "let codex read these files", "have codex
  execute this plan", "ask codex to review this diff", "offload this to
  codex"); once authorized in a conversation, authorization stays active for
  follow-up turns until the user asks to stop using Codex. Without prior
  authorization in the conversation, handle the task directly. Not for
  open-ended architecture design.
---

# Codex Worker

Use local Codex CLI as a bounded execution worker. The calling agent owns architecture, planning, task boundaries, and final verification; Codex executes the assigned step strictly without loading host skills, inventing refactors, or delegating further.

## Division of responsibility

- **Conversation-level authorization; then use Codex actively.** Do not invoke Codex in a new conversation until the user authorizes it once (for example with `@codex`, `/codex-worker`, or an explicit request). Once authorized in the current conversation, that authorization stays active for follow-up messages—do not require the user to repeat `@codex` every turn—until the user explicitly says to stop using Codex. While active, do not hesitate or take over heavy execution work out of habit: actively delegate bounded implementation, batch caller updates, test writing, test-fix loops, rework after diff review, and independent `review` to Codex across as many sequential steps as needed.
- **Keep firsthand control of core architecture.** Read core contracts, key entry points, and critical state transitions directly in the calling agent so design decisions never rely on secondhand summaries. When using `analyze` for broad mechanical sweeps (finding all callers, references, or log entries), require exact `path:line` factual indexes rather than vague summaries, and spot-check critical locations directly in source.
- **Hard concurrency cap of 2 (prefer serial = 1).** Default to 1 active Codex process at a time when tasks are sequential, dependent, or touch the same files. When two tasks are genuinely independent (such as disjoint read-only sweeps or isolated `--worktree` edits), you may run up to **2** Codex processes concurrently—never exceed 2, to avoid account rate limits or risk-control flags.
- **Decide here; execute there.** Apply planning or code-quality skills (such as `tidy-code`, `decision-lock`, or `concise-plan-docs`) in the calling agent, then send Codex concrete instructions, target paths, forbidden areas, and exact checks.
- **No double skill loading.** By default, the bundled wrapper disables host skill discovery, hooks, desktop notifications, MCP servers, and desktop plugins so Codex stays fast, lean, and strictly obedient to the task prompt.
- **No recursive delegation.** Never let Codex invoke `claude-consult`, `claude-web`, or nested Codex sessions.

## Modes

Choose the narrowest mode that fits the task:

- **`analyze` (default, read-only)**: `-s read-only`, `--ephemeral`, default effort `medium` (escalate to `high` or `max` for complex diagnosis). Use for multi-file sweeps, call-path tracing, log diagnosis, or targeted evidence gathering. Makes no file edits.
- **`review` (read-only diff review)**: `codex exec review` (`--uncommitted`, `--base <branch>`, or `--commit <sha>`), `--ephemeral`, default effort `high` (escalate to `max` for high-risk diffs). Use for an independent second opinion on changes.
- **`execute` (bounded edits & commands)**: `-s workspace-write`, `--ephemeral` by default, default effort `max`. Use only when the task authorizes file changes or test runs. Always specify allowed paths, non-goals, and required verification commands. Add `worktree: true` when isolating risky or experimental edits from the main working tree.
- **`resume` (explicit continuation)**: continue a previously persisted worker run (`persist: true`) using its exact `sessionId`, default effort `max`. Never use `--last`, because `CODEX_HOME` is shared with Codex Desktop.

Never pass `--dangerously-bypass-approvals-and-sandbox` unless the user explicitly asks for it and accepts the risk.

## Running the worker

Read [references/usage.md](references/usage.md) for full options and examples. Always invoke the bundled `scripts/run-codex.mjs` via stdin JSON so multiline UTF-8 prompts and quotes never break in Windows PowerShell:

```powershell
@'
{
  "mode": "analyze",
  "cwd": "D:/path/to/repo",
  "prompt": "Inspect src/auth/ and list every entry point that mutates session state, with file paths and line numbers."
}
'@ | node "D:/code/agent-toolbox/skills/codex-worker/scripts/run-codex.mjs"
```

Resolve `scripts/run-codex.mjs` relative to this skill's directory. By default the wrapper waits until Codex finishes naturally with no kill timeout, then prints a single compact JSON summary (`ok`, `mode`, `exitCode`, `sessionId`, `durationMs`, `lastMessage`, `usage`, `errors`).

## Prompting contract

Every worker prompt should state:

1. **Objective**: the exact question to answer or change to implement.
2. **Scope**: target files or directories, plus explicit non-goals / off-limits paths.
3. **Verification** (for `execute`): exact build, lint, or test commands to run.
4. **Output format**: concise facts with file paths, line numbers, command exit codes, and blockers.

Keep prompts self-contained and concrete. Do not forward open-ended "make it better" requests.

## Verify before reporting

Treat Codex output as a worker report, not proof of completion:

- After **`execute`**, inspect `git status` and `git diff` in the workspace (or worktree) and confirm reported verification results before telling the user the work is done.
- After **`analyze`** or **`review`**, spot-check critical file paths, symbols, or claims before acting on them.
- If Codex repeatedly reports `Selected model is at capacity. Please try a different model.` (whether aborted automatically by `run-codex.mjs` with `abortedReason: "model_at_capacity"`, or observed across retries/consecutive runs), **stop the task immediately and report it to the user**. Do not keep retrying the same model, do not silently switch to another model on your own, and do not launch further Codex runs until the user says how to proceed.
- If a run fails, times out, or returns `ok: false`, inspect the exact error and workspace state before retrying; do not silently loop identical failing calls.
