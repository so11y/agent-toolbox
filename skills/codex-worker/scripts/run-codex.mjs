import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODES = new Set(['analyze', 'execute', 'review', 'resume']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'ultra', 'persistent', 'max']);
const DEFAULT_EFFORT = { analyze: 'medium', review: 'high', execute: 'max', resume: 'max' };

const WORKER_PREAMBLE = [
  'Worker execution rules:',
  '- Execute only the assigned task within the stated file and command boundaries.',
  '- Do not load or apply host skills (such as tidy-code, audit-refactor-project, claude-consult, or claude-web) and do not delegate to other agents.',
  '- Do not widen scope, redesign unrelated code, or perform unrequested refactors.',
  '- Report concrete facts only: exact file paths, line numbers, commands run, exit codes, and any blockers or unfinished items.'
].join('\n');

export function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function discoverConfigSuppressions(codexHome, { keepPlugins = false, keepMcp = false } = {}) {
  const configPath = path.join(codexHome, 'config.toml');
  if (!fs.existsSync(configPath)) return [];
  const raw = fs.readFileSync(configPath, 'utf8');
  const overrides = [];
  const seen = new Set();

  if (!keepPlugins) {
    for (const match of raw.matchAll(/^\s*\[plugins\.("[^"]+"|[A-Za-z0-9_-]+)\]\s*$/gm)) {
      const key = match[1];
      const expr = `plugins.${key}.enabled=false`;
      if (!seen.has(expr)) {
        seen.add(expr);
        overrides.push(expr);
      }
    }
  }

  if (!keepMcp) {
    for (const match of raw.matchAll(/^\s*\[mcp_servers\.("[^"]+"|[A-Za-z0-9_-]+)\]\s*$/gm)) {
      const key = match[1];
      const expr = `mcp_servers.${key}.enabled=false`;
      if (!seen.has(expr)) {
        seen.add(expr);
        overrides.push(expr);
      }
    }
  }

  return overrides;
}

export function buildPrompt(prompt, { rawPrompt = false } = {}) {
  const text = String(prompt ?? '').trim();
  if (!text) throw new Error('prompt is required and must be non-empty.');
  return rawPrompt ? text : `${WORKER_PREAMBLE}\n\n---\n\n${text}`;
}

export function buildCodexInvocation(options = {}, env = process.env) {
  const mode = options.mode || 'analyze';
  if (!MODES.has(mode)) {
    throw new Error(`Invalid mode "${mode}". Expected one of: ${[...MODES].join(', ')}.`);
  }
  if (options.dangerouslyBypass) {
    throw new Error('dangerouslyBypass is disabled in codex-worker.');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const effort = options.effort || DEFAULT_EFFORT[mode];
  if (!EFFORTS.has(effort)) {
    throw new Error(`Invalid effort "${effort}". Expected one of: ${[...EFFORTS].join(', ')}.`);
  }

  const persist = mode === 'resume' ? true : Boolean(options.persist);
  const codexHome = resolveCodexHome(env);
  const args = ['exec'];

  if (mode === 'resume') {
    args.push('resume');
  } else if (mode === 'review') {
    args.push('review');
  }

  // Common isolation flags
  args.push('--json');
  args.push('--disable', 'hooks');
  if (!options.keepSkills) {
    args.push('--enable', 'skip_host_skill_discovery');
    args.push('-c', 'suppress_unstable_features_warning=true');
  }
  args.push('-c', 'notify=[]');
  args.push('-c', `model_reasoning_effort="${effort}"`);

  for (const expr of discoverConfigSuppressions(codexHome, {
    keepPlugins: Boolean(options.keepPlugins),
    keepMcp: Boolean(options.keepMcp)
  })) {
    args.push('-c', expr);
  }

  if (options.model) {
    args.push('-m', String(options.model));
  }

  if (mode === 'analyze' || mode === 'execute') {
    const sandbox = mode === 'analyze' ? 'read-only' : 'workspace-write';
    args.push('-s', sandbox);
    args.push('-C', cwd);
    if (Array.isArray(options.addDir)) {
      for (const dir of options.addDir) {
        if (dir) args.push('--add-dir', path.resolve(dir));
      }
    }
  } else if (mode === 'review') {
    args.push('-c', 'sandbox_mode="read-only"');
    const review = options.review || {};
    const targets = [Boolean(review.uncommitted), Boolean(review.base), Boolean(review.commit)].filter(Boolean).length;
    if (targets > 1) {
      throw new Error('review accepts at most one of uncommitted, base, or commit.');
    }
    if (review.uncommitted) args.push('--uncommitted');
    else if (review.base) args.push('--base', String(review.base));
    else if (review.commit) args.push('--commit', String(review.commit));
    else args.push('--uncommitted');
    if (review.title) args.push('--title', String(review.title));
  }

  if (options.worktree) args.push('--worktree');
  if (!persist) args.push('--ephemeral');
  if (options.skipGitRepoCheck !== false && mode !== 'review') {
    args.push('--skip-git-repo-check');
  }
  if (options.outputSchema) {
    args.push('--output-schema', path.resolve(options.outputSchema));
  }

  let stdinPrompt = null;
  if (mode === 'resume') {
    const sessionId = String(options.sessionId || '').trim();
    if (!sessionId || sessionId === '--last') {
      throw new Error('resume mode requires an explicit sessionId (never --last).');
    }
    stdinPrompt = buildPrompt(options.prompt, { rawPrompt: Boolean(options.rawPrompt) });
    args.push(sessionId, '-');
  } else if (mode === 'review') {
    if (options.prompt && String(options.prompt).trim()) {
      stdinPrompt = buildPrompt(options.prompt, { rawPrompt: Boolean(options.rawPrompt) });
      args.push('-');
    }
  } else {
    stdinPrompt = buildPrompt(options.prompt, { rawPrompt: Boolean(options.rawPrompt) });
    args.push('-');
  }

  return {
    command: env.CODEX_BIN || 'codex',
    args,
    cwd,
    mode,
    effort,
    persist,
    stdinPrompt,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : null
  };
}

export function parseJsonlOutput(stdout) {
  let sessionId = null;
  let lastMessage = '';
  let usage = null;
  const errors = [];
  const nonJsonLines = [];

  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      nonJsonLines.push(line);
      continue;
    }
    if (event.type === 'thread.started' && event.thread_id) {
      sessionId = event.thread_id;
    } else if (event.type === 'item.completed' && event.item) {
      if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
        lastMessage = event.item.text;
      } else if (event.item.type === 'error' && event.item.message) {
        errors.push(event.item.message);
      }
    } else if (event.type === 'turn.completed' && event.usage) {
      usage = event.usage;
    } else if (event.type === 'error' && event.message) {
      errors.push(event.message);
    } else if (event.type === 'turn.failed' && event.error?.message) {
      errors.push(event.error.message);
    }
  }

  if (!lastMessage && nonJsonLines.length) {
    lastMessage = nonJsonLines.join('\n');
  }

  return { sessionId, lastMessage, usage, errors };
}

function killProcessTree(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } else {
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 2000).unref();
  }
}

export async function runCodex(options = {}, env = process.env) {
  const invocation = buildCodexInvocation(options, env);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode: invocation.mode,
      effort: invocation.effort,
      persisted: invocation.persist,
      cwd: invocation.cwd,
      command: invocation.command,
      args: invocation.args,
      stdinPrompt: invocation.stdinPrompt
    };
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let timer = null;
    if (invocation.timeoutMs != null) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, invocation.timeoutMs);
      timer.unref();
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const finish = (exitCode, spawnError = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const parsed = parseJsonlOutput(stdout);
      const errors = [...parsed.errors];
      if (spawnError) errors.push(spawnError.message);
      if (timedOut) errors.push(`Timed out after ${invocation.timeoutMs} ms.`);
      const trimmedStderr = stderr.trim();
      resolve({
        ok: !timedOut && !spawnError && exitCode === 0,
        mode: invocation.mode,
        effort: invocation.effort,
        exitCode: exitCode ?? 1,
        ...(timedOut ? { timedOut: true } : {}),
        sessionId: parsed.sessionId,
        persisted: invocation.persist,
        durationMs: Date.now() - startedAt,
        lastMessage: parsed.lastMessage,
        usage: parsed.usage,
        ...(errors.length ? { errors } : {}),
        ...(trimmedStderr ? { stderr: trimmedStderr.slice(0, 4000) } : {})
      });
    };

    child.on('error', (error) => finish(1, error));
    child.on('close', (code) => finish(code));

    if (invocation.stdinPrompt != null) {
      child.stdin.end(invocation.stdinPrompt, 'utf8');
    } else {
      child.stdin.end();
    }
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main() {
  const raw = await readStdin();
  if (!raw) {
    process.stderr.write('Expected a JSON request object on stdin. See references/usage.md.\n');
    process.exitCode = 1;
    return;
  }
  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`Invalid JSON on stdin: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runCodex(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    const entry = fs.realpathSync(process.argv[1]);
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32'
      ? entry.toLowerCase() === self.toLowerCase()
      : entry === self;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

if (isMainEntry()) {
  await main();
}
