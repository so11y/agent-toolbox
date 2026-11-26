---
name: codex-worker
description: >-
  Delegate bounded, well-specified file reading, codebase sweeps, batch edits,
  test-fix loops, or diff reviews to local Codex CLI as a strict execution
  worker without loading host skills or widening scope. Use only when the user
  explicitly authorizes Codex in the request (for example with "@codex",
  "/codex-worker", or phrases like "let codex read these files", "have codex
  execute this plan", "ask codex to review this diff", "offload this to
  codex"). Without explicit user authorization, handle the task directly. Not
  for open-ended architecture design.
---

# Codex Worker

Use local Codex CLI as a bounded execution worker. The calling agent owns architecture, planning, task boundaries, and final verification; Codex executes the assigned step strictly without loading host skills, inventing refactors, or delegating further.

## Division of responsibility

- **Explicit authorization gate.** Invoke Codex only when the user authorizes it (for example by writing `@codex` or `/codex-worker`, or explicitly asking to delegate to Codex). Seeing `@codex` in the user's message grants authorization to delegate the bounded reading, execution, or review portion of that task.
- **Decide here; execute there.** Apply planning or code-quality skills (such as `tidy-code`, `decision-lock`, or `concise-plan-docs`) in the calling agent, then send Codex concrete instructions, target paths, forbidden areas, and exact checks.
- **No double skill loading.** By default, the bundled wrapper disables host skill discovery, hooks, desktop notifications, MCP servers, and desktop plugins so Codex stays fast, lean, and strictly obedient to the task prompt.
- **No recursive delegation.** Never let Codex invoke `claude-consult`, `claude-web`, or nested Codex sessions.

## Modes

Choose the narrowest mode that fits the task:

- **`analyze` (default, read-only)**: `-s read-only`, `--ephemeral`, default effort `medium`. Use for multi-file sweeps, call-path tracing, log diagnosis, or targeted evidence gathering. Makes no file edits.
- **`review` (read-only diff review)**: `codex exec review` (`--uncommitted`, `--base <branch>`, or `--commit <sha>`), `--ephemeral`, default effort `medium`. Use for an independent second opinion on changes.
- **`execute` (bounded edits & commands)**: `-s workspace-write`, `--ephemeral` by default, default effort `high`. Use only when the task authorizes file changes or test runs. Always specify allowed paths, non-goals, and required verification commands. Add `worktree: true` whenever the calling agent and Codex may touch the same repository concurrently.
- **`resume` (explicit continuation)**: continue a previously persisted worker run (`persist: true`) using its exact `sessionId`. Never use `--last`, because `CODEX_HOME` is shared with Codex Desktop.

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

Resolve `scripts/run-codex.mjs` relative to this skill's directory. The script prints a single compact JSON summary (`ok`, `mode`, `exitCode`, `sessionId`, `durationMs`, `lastMessage`, `usage`, `errors`).

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
- If a run fails, times out, or returns `ok: false`, inspect the exact error and workspace state before retrying; do not silently loop identical failing calls.
