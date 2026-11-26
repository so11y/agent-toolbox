import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCodexInvocation,
  discoverConfigSuppressions,
  parseJsonlOutput,
  runCodex
} from '../scripts/run-codex.mjs';

test('discoverConfigSuppressions finds plugins and mcp servers without touching config.toml', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worker-cfg-'));
  try {
    await fs.writeFile(path.join(tmp, 'config.toml'), [
      'model = "gpt-test"',
      '[mcp_servers.node_repl]',
      'command = "node_repl.exe"',
      '[mcp_servers.cua_repl]',
      'enabled = false',
      '[plugins."documents@openai-primary-runtime"]',
      'enabled = true',
      '[plugins."browser@openai-bundled"]',
      'enabled = true'
    ].join('\n'));

    const all = discoverConfigSuppressions(tmp);
    assert.deepEqual(all, [
      'plugins."documents@openai-primary-runtime".enabled=false',
      'plugins."browser@openai-bundled".enabled=false',
      'mcp_servers.node_repl.enabled=false',
      'mcp_servers.cua_repl.enabled=false'
    ]);
    assert.deepEqual(discoverConfigSuppressions(tmp, { keepPlugins: true }), [
      'mcp_servers.node_repl.enabled=false',
      'mcp_servers.cua_repl.enabled=false'
    ]);
    assert.deepEqual(discoverConfigSuppressions(tmp, { keepPlugins: true, keepMcp: true }), []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('buildCodexInvocation enforces safe defaults for analyze, execute, review, and resume', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worker-inv-'));
  const env = { ...process.env, CODEX_HOME: tmp };
  try {
    await fs.writeFile(path.join(tmp, 'config.toml'), '[mcp_servers.node_repl]\n[plugins."chrome@openai-bundled"]\n');

    const analyze = buildCodexInvocation({ mode: 'analyze', cwd: tmp, prompt: 'Read README.' }, env);
    assert.equal(analyze.effort, 'medium');
    assert.equal(analyze.persist, false);
    assert.ok(analyze.args.includes('-s'));
    assert.equal(analyze.args[analyze.args.indexOf('-s') + 1], 'read-only');
    assert.ok(analyze.args.includes('--ephemeral'));
    assert.ok(analyze.args.includes('--disable'));
    assert.ok(analyze.args.includes('hooks'));
    assert.ok(analyze.args.includes('skip_host_skill_discovery'));
    assert.ok(analyze.args.includes('notify=[]'));
    assert.ok(analyze.args.includes('plugins."chrome@openai-bundled".enabled=false'));
    assert.ok(analyze.args.includes('mcp_servers.node_repl.enabled=false'));
    assert.match(analyze.stdinPrompt, /Do not load or apply host skills/);

    const execute = buildCodexInvocation({
      mode: 'execute',
      cwd: tmp,
      prompt: 'Edit src/a.js.',
      persist: true,
      worktree: true
    }, env);
    assert.equal(execute.effort, 'max');
    assert.equal(execute.args[execute.args.indexOf('-s') + 1], 'workspace-write');
    assert.equal(execute.args.includes('--ephemeral'), false);
    assert.ok(execute.args.includes('--worktree'));

    const review = buildCodexInvocation({
      mode: 'review',
      cwd: tmp,
      review: { base: 'main' }
    }, env);
    assert.equal(review.effort, 'high');
    assert.equal(review.args[0], 'exec');
    assert.equal(review.args[1], 'review');
    assert.equal(review.args.includes('-s'), false);
    assert.equal(review.args.includes('-C'), false);
    assert.ok(review.args.includes('--base'));
    assert.equal(review.stdinPrompt, null);

    const resume = buildCodexInvocation({
      mode: 'resume',
      cwd: tmp,
      sessionId: '01a21612-ed2f-77d2-8725-38e2527d097d',
      prompt: 'Run tests.'
    }, env);
    assert.equal(resume.args[0], 'exec');
    assert.equal(resume.args[1], 'resume');
    assert.equal(resume.args.includes('-s'), false);
    assert.equal(resume.args.includes('-C'), false);
    assert.equal(resume.args.includes('--ephemeral'), false);
    assert.equal(resume.args.at(-2), '01a21612-ed2f-77d2-8725-38e2527d097d');
    assert.equal(resume.args.at(-1), '-');

    assert.throws(() => buildCodexInvocation({ mode: 'resume', cwd: tmp, prompt: 'hi' }, env), /explicit sessionId/);
    assert.throws(() => buildCodexInvocation({ mode: 'resume', cwd: tmp, sessionId: '--last', prompt: 'hi' }, env), /explicit sessionId/);
    assert.throws(() => buildCodexInvocation({ mode: 'analyze', cwd: tmp, prompt: 'hi', dangerouslyBypass: true }, env), /disabled/);
    assert.throws(() => buildCodexInvocation({ mode: 'review', cwd: tmp, review: { uncommitted: true, base: 'main' } }, env), /at most one/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('parseJsonlOutput extracts thread_id, last message, usage, and errors', () => {
  const sample = [
    JSON.stringify({ type: 'thread.started', thread_id: 'tid-123' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'warn-1' } }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'first' } }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'final answer' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 42 } })
  ].join('\n');

  const parsed = parseJsonlOutput(sample);
  assert.equal(parsed.sessionId, 'tid-123');
  assert.equal(parsed.lastMessage, 'final answer');
  assert.deepEqual(parsed.usage, { input_tokens: 1000, output_tokens: 42 });
  assert.deepEqual(parsed.errors, ['warn-1']);
});

test('runCodex dryRun returns resolved invocation without spawning codex', async () => {
  const res = await runCodex({ mode: 'analyze', prompt: 'Inspect files.', dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.mode, 'analyze');
  assert.ok(Array.isArray(res.args));
});

test('CLI executes main() when invoked through a directory junction/symlink', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worker-link-'));
  const skillDir = fileURLToPath(new URL('../', import.meta.url));
  const linkedDir = path.join(tmp, 'codex-worker');
  try {
    await fs.symlink(skillDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    const out = execFileSync(process.execPath, [path.join(linkedDir, 'scripts', 'run-codex.mjs')], {
      input: JSON.stringify({ mode: 'analyze', prompt: 'Ping', dryRun: true }),
      encoding: 'utf8',
      windowsHide: true
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dryRun, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
