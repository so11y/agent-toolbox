# Codex Worker Usage

`scripts/run-codex.mjs` accepts one JSON object on `stdin` and writes one JSON summary object to `stdout`. It uses only Node.js built-ins and invokes the local `codex` CLI (`CODEX_BIN` overrides the executable name).

## Request fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"analyze" \| "execute" \| "review" \| "resume"` | `"analyze"` | Execution mode and sandbox policy. |
| `cwd` | string | `process.cwd()` | Repository or target working directory. |
| `prompt` | string | required (optional in `review`) | Concrete task instructions sent to Codex via stdin. |
| `effort` | `"low" \| "medium" \| "high" \| "xhigh" \| "ultra" \| "persistent" \| "max"` | `medium` (`analyze`), `high` (`review`), `max` (`execute`/`resume`) | Overrides `model_reasoning_effort` for this call. |
| `model` | string | config default | Optional explicit model override (`-m`). |
| `persist` | boolean | `false` (`true` for `resume`) | When `false`, passes `--ephemeral` so one-off runs do not clutter Codex Desktop session history. |
| `sessionId` | string | required in `resume` | Exact `sessionId` returned from an earlier `persist: true` call. `--last` is rejected. |
| `worktree` | boolean | `false` | Runs Codex in a new managed Git worktree (`--worktree`). Useful for parallel edits. |
| `addDir` | string[] | `[]` | Extra writable directories for `execute` (`--add-dir`). |
| `review` | `{ uncommitted?, base?, commit?, title? }` | `{ uncommitted: true }` | Diff target for `review` mode. Supply at most one of `uncommitted`, `base`, or `commit`. |
| `outputSchema` | string | omitted | Optional JSON Schema file path (`--output-schema`). |
| `timeoutMs` | number | none (no limit) | Optional wall-clock timeout in ms. Omit to wait until Codex exits naturally; when set to a positive number, kills the process tree on expiry. |
| `rawPrompt` | boolean | `false` | Skip prepending the default worker constraint header. |
| `keepSkills` | boolean | `false` | Keep host skill discovery enabled instead of passing `--enable skip_host_skill_discovery`. |
| `keepPlugins` | boolean | `false` | Keep desktop plugins from `config.toml` enabled. |
| `keepMcp` | boolean | `false` | Keep MCP servers from `config.toml` enabled. |
| `dryRun` | boolean | `false` | Return the resolved command and arguments without spawning Codex. |

## Isolation defaults

By default, every invocation inherits auth, model provider, trusted projects, and host `developer_instructions` from `$CODEX_HOME/config.toml` while stripping desktop bloat and recursion risks:

- `--disable hooks` so Codex Desktop `Interrupt`/`SessionEnd` hooks do not fire.
- `--enable skip_host_skill_discovery` + `-c suppress_unstable_features_warning=true` so Codex does not reload host skills (`tidy-code`, `claude-consult`, `claude-web`, etc.).
- `-c notify=[]` so desktop turn-ended notifications do not fire.
- Auto-disables `[plugins.*]` and `[mcp_servers.*]` entries found in `$CODEX_HOME/config.toml` via `-c ...enabled=false` unless explicitly kept.

## Examples

### 1. Read-only analysis (`analyze`)

```powershell
@'
{
  "mode": "analyze",
  "cwd": "D:/code/my-app",
  "effort": "medium",
  "prompt": "Read src/sync/ and list every place where network retries happen, with file paths, line numbers, and stop conditions."
}
'@ | node "D:/code/agent-toolbox/skills/codex-worker/scripts/run-codex.mjs"
```

### 2. Bounded edit and test run (`execute`)

```powershell
@'
{
  "mode": "execute",
  "cwd": "D:/code/my-app",
  "prompt": "In src/parser.ts only, replace the manual query-string loop with URLSearchParams while preserving duplicate keys. Do not edit other source files. Run `npm test` and report the exact command and exit code."
}
'@ | node "D:/code/agent-toolbox/skills/codex-worker/scripts/run-codex.mjs"
```

### 3. Independent diff review (`review`)

```powershell
@'
{
  "mode": "review",
  "cwd": "D:/code/my-app",
  "review": { "uncommitted": true },
  "prompt": "Check for regressions, missing error propagation, or unintended API changes. Skip style nits."
}
'@ | node "D:/code/agent-toolbox/skills/codex-worker/scripts/run-codex.mjs"
```

### 4. Multi-turn follow-up (`persist` + `resume`)

First call with `"persist": true` and capture `sessionId` from the JSON response. Then send the follow-up:

```powershell
@'
{
  "mode": "resume",
  "cwd": "D:/code/my-app",
  "sessionId": "<exact-session-id-from-step-1>",
  "prompt": "Now update tests/parser.test.ts to cover empty values and rerun `npm test`."
}
'@ | node "D:/code/agent-toolbox/skills/codex-worker/scripts/run-codex.mjs"
```

## Response shape

```json
{
  "ok": true,
  "mode": "analyze",
  "effort": "medium",
  "exitCode": 0,
  "sessionId": "01a2...",
  "persisted": false,
  "durationMs": 12450,
  "lastMessage": "...",
  "usage": {
    "input_tokens": 9200,
    "cached_input_tokens": 0,
    "output_tokens": 180
  }
}
```
