# Project reuse and chat conversations

## Conversation ownership

One actual Codex chat owns one Claude conversation. Read the stable chat ID from
`nodeRepl.requestMeta.threadId` (or verified host thread context). Never use a turn ID,
tool-call ID, workspace path, guessed ID, or newly generated UUID as the Codex chat ID.

Use `scripts/chats.mjs` for normal work. It keeps the binding under
`~/.cache/claude-consult/chats/<hash-of-chat-id>/`; the raw Codex ID stays local.
The server receives a separate random catalog key and a Japanese conversation title.
A new Codex chat creates a separate binding even when it shares the same project.
More requests, steering, and completed phases within the same chat reuse its existing
Claude session. Do not close it when a phase finishes.

The project path and SSH destination are pinned on first use. A changed workspace/server
fails explicitly instead of silently replacing the conversation. Use a new Codex chat
for a different workspace. If the host does not expose a stable chat identity, explain
that binding cannot be guaranteed; do not manufacture one.

## Normal use

~~~javascript
var relay = await import("file:///D:/codex/home/skills/claude-consult/scripts/chats.mjs?updated=" + Date.now());
var chatId = nodeRepl.requestMeta.threadId;
var reply = await relay.consultChat({
  chatId,
  turnId: nodeRepl.requestMeta["x-codex-turn-metadata"].turn_id,
  projectRoot: "D:/Projects/example",
  title: "検索処理の改善",
  task: "検索処理を確認し、改善方針と検証方法を考えてください。",
  include: ["src/", "tests/", "package.json"],
  environment: { os: "Windows", testCommand: "npm test" }
});
console.log(reply.guidance);
~~~

Use the same `chatId` for later calls. A new `task` updates the objective in that
conversation; it does not create another conversation. Omitted task/environment fields
retain their values. Send only newly observed results and a natural Japanese update:

~~~javascript
var next = await relay.consultChat({
  chatId,
  turnId: nodeRepl.requestMeta["x-codex-turn-metadata"].turn_id,
  projectRoot: "D:/Projects/example",
  results: [{actionId:"check-1", command:"npm test", exitCode:1,
             output:"実際のエラー出力を原文のまま入れる"}],
  message: "変更を反映しました。このエラーが残っています。次に確認する箇所を教えてください。"
});
await relay.ensureCurrent(next.taskDir);
~~~

The wrapper allocates the Claude session ID once, before the first request. The first
call uses `--session-id`; later calls use `--resume`. Failures never silently allocate a
replacement. A potentially ambiguous failure marks the binding for attention: inspect
the recorded evidence and remote state before an explicit continuation. If previously
saved history has disappeared, restore it rather than starting an empty replacement.

## History and manual viewing

- `listChats({projectRoot?})`: local names, dates, summary, phase decision, and binding
  records. This makes no model call. Show concise Chinese descriptions to the user.
- `openChat({chatId,configFile?})`: open the bound session in the server desktop terminal.
  The remote catalog is marked paused; automation refuses new analysis while paused.
- `resumeChat({chatId,configFile?})`: after the user says to continue, release that pause
  and reconcile whether the fixed session ID exists. It does not submit a model prompt.
  If the viewing terminal still owns the project lock, it returns `project_busy`.
- `bindChat({chatId,projectRoot,title,sessionId,configFile?})`: explicit migration of a
  verified existing session into an unbound chat. Never bind an unrelated chat's session
  to a new chat just because its title is similar.

The server's `claude-history` command and Japanese desktop launcher **会話履歴** select
these same saved conversations by title. They use `--resume <ID>` internally. The
native `/resume` picker still excludes `-p` sessions. The history viewer keeps the
same read/search-only tool restrictions and holds the project lock for its lifetime.
After exiting, automatic reasoning stays paused until the user asks to continue.
Viewing starts no model request; a message the user submits in Claude does.

The picker uses the last synchronized source view if it still exists. If it was cleaned,
it clearly opens history with an empty working directory. Prior file results are history,
not proof that current local files still match. The next automated turn synchronizes
fresh sources before asking Claude what to do. Do not execute an old action merely
because it appears in the viewed transcript.

A new Codex chat must not adopt an old chat's session to implement "continue yesterday".
Identify the original chat for the user to return to, or transfer an explicit factual
summary into the new chat's separate conversation.

## Connection and low-level helpers

The configured server is `desktop@43.133.218.55`. SSH uses the existing executable
and key path; host checking remains on and forwarding stays off. Remote CLI requests
use the existing loopback HTTP proxy `http://127.0.0.1:8118`.
No local filesystem endpoint or reverse SSH is introduced.

`scripts/consult.mjs` implements the underlying project snapshots and recorded turns.
Its `doctor` is for setup, not every turn. Missing login/CLI/restriction flags are
reported before sources and context are transmitted. `ensureCurrent(taskDir)` verifies
the latest successfully analyzed snapshot. `close({taskDir})` and
`forgetProject({projectRoot})` remove source views/cache only when explicitly requested;
they are not normal phase-completion steps and do not erase Claude transcripts.


## Input and sharing semantics

The chat wrapper selects a stable task directory for the bound Codex chat. Await each operation before starting another on the same project. Changing the canonical project location or server selects a different project cache.

- `task`: required initially; omission retains it, while an explicit value updates it for user steering.
- `include`: adds project-relative files or directories to the project's remembered sharing scope. Directory paths may end in `/`. New files under those directories are discovered each turn. No globs or whole-root `.` selection.
- `exclude`: if supplied, replaces the project's entire explicit exclusion list. Exclusions cover the named path and its descendants and win over includes. Omission retains the existing list; `[]` clears it. Thus adding an include does not silently undo an existing exclusion.
- Omitted `include` reuses the project scope, including across tasks. A disappeared approved path is omitted from the snapshot and can reappear later. Explicitly including a nonexistent path fails.
- Built-in private/tool exclusions are always active, including `.git`, `.codex`, `.claude`, `.agents`, credential/configuration paths, dependency environments, and reserved `work/claude-consult/` records. Directory scans skip these paths; explicitly including them fails.
- `environment`: omission retains task facts; an object merges supplied fields; `null` clears them.
- `results`: new evidence for this turn; omission is an empty list and does not replay old output.
- `message`: the new technical update. Follow the language guidance in `SKILL.md`; preserve raw diagnostics.
- `baseRevision` and `responseLanguage`: omission retains the task's value; initial defaults are empty and `ja`.
- `configFile`: an optional alternative connection file. The destination participates in project identity.

Only selected UTF-8 text files are supported: at most 512 actual files, 2 MiB per file, 8 MiB in a source snapshot, and 1 MiB of task/context/results. Links, path traversal, binary files, oversized selections, and recognizable credential signatures fail explicitly. Select source directories and exclude unsupported/generated material. Content checks cannot detect every secret; inspect newly shared materials.

Keep task records outside the project or in its reserved private paths, normally `work/claude-consult/`. Do not put task records in a selected source directory.

## Result and freshness

A successful turn returns `status: "ok"`, `snapshotId`, `sessionId`, `guidance`, `permissionDenials`, usage/cost metadata when available, and transfer measurements.

`guidance` contains:

- `decision`: `continue`, `complete`, or `blocked`.
- `summary`: current diagnosis or reasoning.
- `actions`: the next bounded batch, each with an ID, kind (`inspect/run/edit`), instruction, paths, and commands.
- `acceptance`: completion checks.
- `question`: an unresolved question or `null`.

Commands are proposals; the transport never executes them. Missing/invalid structured output is a failure. Actual local evidence establishes completion.

The snapshot is assembled before analysis. The server verifies content hashes and builds the exact readable tree before starting Claude. A per-project process lock covers the entire analysis and prevents another turn, `close`, or `forgetProject` from replacing/removing it. Different projects are independent. A competing call returns `project_busy` (inside `detail` when detected by the readiness/inventory step). The lock is released by the operating system when the helper exits; the small lock file can remain.

Local files can still change while Claude reasons. Use `ensureCurrent` before acting when edits may have occurred. A newly created file inside a shared directory also makes prior guidance stale.

## Transmission and persistence

Each normal turn uses two SSH connections:

1. Combine CLI readiness with an inventory of missing/corrupt content hashes.
2. Send the current file manifest, context/results, and only missing contents, then receive guidance.

Requests and the shipped Python helper are gzip-compressed. The analysis channel stays open for cancellation and heartbeat frames; these small control frames are not included in the reported source/payload byte totals. User content travels as encoded stdin data; none is interpolated into shell commands. There is no background watcher or two-way synchronization.

Project identity is derived from the canonical local project path and destination; only its opaque digest is sent. On Windows, path case does not create a separate identity. Two different checkouts have separate caches even if their repository names match.

The local project registry is `~/.cache/claude-consult/projects/<project-id>.json` (under the Windows user profile here). It stores the local path, destination, and approved scopes; it contains no source bodies and is never sent as model context. The chat binding owns the fixed Claude session ID; task state owns the current objective, evidence, and latest analyzed snapshot.

The server retains `~/.cache/project-consult/projects/<project-id>/objects/` and `manifest.json`. An unchanged body is reused within and across tasks. A rename can reuse its content. Modified files are transferred whole and compressed, rather than as block-level deltas. The cache holds the latest selected contents; excluded/deleted objects are pruned.

Only the latest turn needs a readable source view under `tasks/<task-id>/`. A new turn rebuilds that view from the manifest and removes older views under the project lock. Each bound chat has a stable working-directory path and session ID; returning to it rebuilds its view and resumes that conversation. Current source and actual results take precedence over older conversation assumptions.

`close` removes the finished task's readable view while keeping the persistent project cache. `forgetProject` removes the project cache and local scope registry when requested. Earlier source or results can remain in standard Claude conversation records and local task evidence. This workflow does not erase those records or system audit history.

A lost/corrupt content object is detected by the inventory check and uploaded before model invocation. After an ambiguous failure, inspect local records; do not automatically repeat a potentially billed model call.

Transfer measurements distinguish source bytes from SSH application payload bytes. `sentBytes` includes both compressed requests and the helper bootstrap, excluding SSH handshake/encryption overhead. Zero source upload still sends manifests and context. Network-byte savings do not establish model speed or token savings.

## Shared development skills

The approved server catalog is `~/.claude/skills/.project-consult.json`. It names these five installed skills: `audit-refactor-project`, `code-analysis`, `concise-plan-docs`, `decision-lock`, and `tidy-code`. Each native skill is at `~/.claude/skills/<name>/SKILL.md`; it retains the original English rules with Chinese passages translated into English. Codex-only UI metadata is not installed. Native Claude Code can discover the skills automatically or invoke them with commands such as `/code-analysis` and `/tidy-code`.

The reasoning loop retains `--restricted` and `--safe-mode`, which disable automatic custom-skill loading. Before each model turn, the helper verifies the approved catalog and copies its exact files into `guides/<name>/SKILL.md` inside the analysis directory. Claude first reads `guides/index.json` and then the relevant skill bodies. This keeps file access inside the turn and exposes no new execution tools. Skills do not override user decisions, task scope, or the requirement to request local edits/tests through actions. English skill text does not change the default Japanese response language.

The result adds `availableSkills` and `guideSetId` for the supplied catalog. Availability does not claim the model actually used every skill. The catalog pins file hashes; changed or missing approved files cause an explicit failure before a model request. If the catalog is absent, the loop proceeds with an empty guide index. A catalog is limited to 64 KiB, each skill to 128 KiB, and the combined bodies to 512 KiB.

Skills are installed once and read on the server, rather than re-uploaded on every project turn. These are synchronized copies: after changing the original local skills, prepare the English copies again, update their catalog hashes/descriptions, and synchronize that bundle. Write the catalog after its skill files and preserve unrelated installed skills. Do not copy credentials, local orchestration files, or the local `claude-consult` controller into the server's skill catalog. Closing/forgetting a project removes its guide snapshots but leaves the installed personal skills intact.

## Long calls and execution boundary

Model calls may take several minutes. In Codex desktop, run the Node REPL call with a timeout of at least 720000 ms inside yielding tool orchestration, then resume that same call with short waits and keep the user informed. An early tool yield is not a reason to start another request.

Local `state.json` and `steps/<id>.json` retain task continuity, the sent manifest/context, and returned guidance; source bodies are not duplicated per step. Those orchestration records are not shared as project materials.

Claude is restricted to `Read,Grep,Glob`, with `--restricted`, `--safe-mode`, empty strict MCP configuration, no MCP tools, `dontAsk`, and a 16-turn limit. It requests local commands/edits in its response. `--allowedTools` alone is not the tool boundary. `--bare` is not required because its authentication behavior differs from subscription login.

The server stops the model process group after 10 minutes; the client allows another minute for cleanup/transport. The helper exposes no local execution endpoint and does not change local Codex permissions.

References checked on 2026-11-04:

- [Claude CLI flags](https://code.claude.com/docs/en/cli-reference)
- [Structured output and session continuation](https://code.claude.com/docs/en/headless)

Skill compatibility references checked on 2026-11-04:
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Restricted and safe mode](https://code.claude.com/docs/en/cli-reference)

## Stop, interruption, and recovery

Normal calls must include the current Codex `turnId`, read from
`nodeRepl.requestMeta["x-codex-turn-metadata"].turn_id` on the current call.
Do not reuse a prior turn ID or invent one. Multiple reasoning rounds in one Codex
turn share that turn ID but receive independent run IDs.

The installed `Interrupt` and `SessionEnd` hooks run `scripts/interrupt.ps1`.
They only write a local, turn-scoped cancellation marker; they read no transcripts
and perform no network request. Both use a three-second limit. Codex must trust
the exact definitions in the user `hooks.json` before it will invoke them.
Check the native Hooks settings/list for `trusted`; a script test alone does not
prove the actual Stop button has been wired up.

- When the user says stop, use `stopChat({chatId})`. It bypasses the analysis lock,
  marks the active turn cancelled, and requests remote termination for that run only.
  Do not pass a new message's turn ID when intending to stop an older active run.
- `cancelled` with `remoteExited: true` confirms the run is no longer executing.
  `stop_pending` means termination has not been confirmed; do not call it stopped.
- Pressing the native Stop button triggers the trusted hook without a model reply.
  The active transport observes the marker, sends cancel, and stops heartbeats.
- The same SSH analysis channel carries a small heartbeat every three seconds.
  EOF cancels the run; fifteen seconds without a heartbeat expires its lease.
  There is no permanent local polling service.
- The server targets its recorded process group, first TERM, then KILL after
  three seconds if necessary. A separate run-scoped guard handles helper death
  and retains the project's lock through cleanup. The child also binds its
  lifetime to the helper before exec. Other runs and manual history terminals
  are outside this cancellation scope.
- Late results from an interrupted turn are discarded. `ensureCurrent` rejects
  its old guidance even if the selected source hashes still match.
- Keep the chat/session binding, conversation history, and completed local edits.
  After the user asks to continue, call `resumeChat`, check its result, and send
  fresh context/results in a new turn. It reconciles remote exit before recovering
  a cancelled run's stale local lock. Missing history is not silently replaced.
  Remote requests already submitted may have incurred usage; process termination
  does not promise a refund or immediate provider-side billing cancellation.

Remote setup now includes `scripts/run_control.py` alongside `remote_review.py`
under `~/.local/lib/project-consult/`. Keep the installed files in sync with the
skill. Run IDs, local chat/turn IDs, hook markers, heartbeats, and process records
are transport metadata, not Claude prompt materials. The existing read-only
snapshot and Japanese/Chinese language rules remain in force.

Validation helpers:
- `tests/remote_stop_test.py`: isolated processes; cancellation, EOF, lease expiry,
  helper death, descendant cleanup, lock release, and run isolation; no model call.
- `tests/local_stop_test.mjs`: directly invokes the short PowerShell hook on
  isolated fixtures; verifies correct turn matching, recovery, and stale-result rejection.
- `tests/live_stop_test.mjs`: opt-in real Claude calls to verify cancellation
  through the production SSH path and continuation with the same session.
  It directly invokes the hook; it does not claim to test the desktop Stop button.
