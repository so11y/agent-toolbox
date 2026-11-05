---
name: claude-consult
description: Use when the user wants remote Claude Code to lead reasoning and decide the next investigation, implementation, or verification steps while local Codex executes them and reports real results. Reuses selected project sources across tasks and binds each Codex chat to one persistent Claude conversation and manages its history.
---

# Claude Consult

Claude Code leads the technical reasoning throughout the task. Codex carries out the next bounded batch of work locally and returns evidence. Continue until the user's acceptance conditions are met; do not reduce Claude's role to a one-off review of a locally chosen solution.

This local skill includes its local scripts. Its server dependency is installed separately from the repository's `server/claude-consult/` into `~/.local/lib/project-consult/`. No server executable is bundled into the skill.

## Roles and authority

- Claude chooses what to investigate, requests missing files or command output, diagnoses results, proposes changes, and decides the next verification.
- Codex gathers the requested local evidence, implements the agreed changes, runs commands/tests in the actual local environment, and reports what happened. Resolve routine implementation details within Claude's chosen approach.
- If local facts contradict the approach, return them to Claude before changing technical direction. User instructions, repository rules, task scope, and local permissions remain authoritative.
- Returned commands are proposals. Codex interprets and executes appropriate actions through its normal tools; the transport never executes them automatically.

## Sharing and language

Use the selected project and the machine-local connection file at `~/.config/agent-toolbox/claude-consult.json`; see the [connection template](connection.example.json). An explicit `configFile` overrides this default. Share relevant source, configuration templates, a useful project outline, accurate environment facts, and actual results. Keep credentials, personal files, Codex conversations/internal reasoning, local orchestration records, and SSH configuration out of the shared materials. Preserve relevant diagnostic facts and tool references already present in the project's code.

Write task descriptions and progress messages in natural, concise Japanese unless the user requests another language. Describe what changed, what was observed, and what needs checking, like an ordinary development conversation. For a failed check, say what changed, provide the actual error, and ask which part to inspect next. Use wording appropriate to the actual result, not a canned report.

Report conclusions and actual execution progress to the user in Chinese unless the user requests another language. Keep paths, code, commands, error text, exit codes, and test counts exact. Structured fields remain structured. Do not add artificial typos, personal anecdotes, claims of manual authorship, invented results, or promises that automation cannot be inferred.

## Shared development skills

The server can expose an explicitly approved catalog of development skills to the reasoning loop. The helper copies their English SKILL.md files into the turn's read-only `guides/` directory, with an index for selective reading. Claude applies relevant guidance under the existing task scope and tool restrictions; requested edits and commands still become actions for local execution. See [references/usage.md](references/usage.md#shared-development-skills) for native CLI use and synchronization.

## Reasoning and execution loop

Read [references/usage.md](references/usage.md) for the API, sharing semantics, retention, and response shape.

1. Identify the objective, actual environment, applicable local instructions, and acceptance conditions. Use the actual host Codex thread ID and current turn ID with `consultChat`; one Codex chat keeps one Claude session across objectives, steering, and completed phases. Never invent an ID or infer it from the project path.
2. Select and inspect useful source files or directories, including relevant callers and tests. Sharing scope persists for that project across tasks; omitted scope arguments reuse it. Directory selection includes future files automatically. The helper skips private/tool configuration paths, but content review is still necessary.
3. Call `consultChat` with the objective, initial scope when needed, and real environment facts. It synchronizes selected additions, changes, and deletions before invoking Claude. A new Codex chat reuses cached sources but gets a separate Claude conversation. Do not call `doctor` before each turn.
4. Carry out Claude's next bounded batch:
   - `inspect`: obtain the requested material; add relevant paths to sharing or return findings.
   - `run`: capture the actual command, exit code, and meaningful output.
   - `edit`: implement the requested change while preserving unrelated user edits.
   If inputs may have changed during analysis, use `ensureCurrent` before relying on the guidance; return fresh evidence if stale.
5. Call `consultChat` with the same Codex chat ID and new results. It resumes the conversation and discovers changes in the remembered sharing scope. Batch related reads/tests and return a concise factual update; retain relevant error context and supply fuller sanitized logs when needed.
6. For `blocked`, provide missing evidence if available; otherwise ask the specific unresolved question. Do not substitute local reasoning while presenting it as Claude's analysis.
7. For `complete`, verify acceptance against actual local results. Return missing or failing evidence for further reasoning. Once accepted, report the result and retain the chat binding for later requests. Only clean source views/cache when requested; do not close the conversation at phase completion.

Await each operation before another operation on the same project. The server holds the project's analysis lock through the model call so synchronization, task closure, or project removal cannot replace its source during analysis. A busy response is a reason to await the running operation, not to start another loop.

Synchronization is one-way, initiated locally at reasoning boundaries. No background sync service, reverse SSH, local filesystem MCP, or unrestricted local execution endpoint is required. This skill does not change Codex's own local permissions.

## Conversation history

Use the chat helper to list histories by title, open the bound session, and release a manual-viewing pause when the user asks to continue. The server also has a Japanese conversation-history launcher. Never attach two Codex chats to one Claude session. Read the history and binding sections of [references/usage.md](references/usage.md) before managing sessions.

## Stopping

When the user stops this workflow, cancel its current run through `stopChat`; do not merely stop polling. The installed `Interrupt` hook handles the native Stop button only after Codex trusts it. Read [the stop and recovery instructions](references/usage.md#stop-interruption-and-recovery) before cancellation setup or recovery. Confirm remote exit before reporting it stopped; otherwise report `stop_pending`. Discard late results, retain the conversation and completed edits, and resume only when the user asks.

## Failures and limits

- Report missing CLI/login, incompatible flags, SSH failures, permission denials, and invalid guidance explicitly. Do not fabricate successful Claude analysis.
- Inspect actual evidence; a CLI exit code or a `complete` label alone does not establish acceptance.
- After a timeout or ambiguous disconnect, inspect recorded state and report uncertainty. Do not automatically repeat a potentially billed call.
- Do not repeat an identical failed request without new evidence, or silently widen sharing, permissions, or installation scope.
- The selected text snapshot is limited to 512 files and 8 MiB. Narrow the scope for larger projects; persistent reuse does not remove those limits. A separate continuous-sync tool is a future transport choice, not an extra service to install during routine skill use.
