import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

test('link selected skills, preserve local data, and repeat without replacing links', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-toolbox-install-'));
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const codexHome = path.join(fixture, 'codex');
  const codexSkills = path.join(codexHome, 'skills');
  const cursorSkills = path.join(fixture, '.cursor', 'skills');
  const antigravitySkillsJson = path.join(fixture, '.gemini', 'config', 'skills.json');
  const legacy = path.join(codexSkills, 'claude-consult');
  const config = { host: 'fixture.invalid', user: 'fixture', port: 22 };
  const environment = { ...process.env, HOME: fixture, USERPROFILE: fixture, CODEX_HOME: codexHome };
  try {
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'connection.json'), JSON.stringify(config));
    await fs.mkdir(path.join(codexSkills, '.system'), { recursive: true });
    await fs.writeFile(path.join(codexSkills, '.system', 'keep'), 'system data');
    await fs.mkdir(path.join(cursorSkills, 'personal'), { recursive: true });
    await fs.writeFile(path.join(cursorSkills, 'personal', 'SKILL.md'), 'personal skill');
    await fs.mkdir(path.dirname(antigravitySkillsJson), { recursive: true });
    await fs.writeFile(antigravitySkillsJson, JSON.stringify({ entries: [{ path: '~/personal-skills' }] }, null, 2));
    const invoke = () => JSON.parse(execFileSync(process.execPath,
      [path.join(repository, 'install.mjs'), 'codex', 'cursor', 'claude', 'antigravity'],
      { env: environment, windowsHide: true, encoding: 'utf8' }));
    const first = invoke();
    assert.equal(first.linked.filter(x => x.agent === 'codex').length, 7);
    assert.equal(first.linked.filter(x => x.agent === 'cursor').length, 5);
    assert.equal(first.linked.filter(x => x.agent === 'claude').length, 5);
    assert.equal(first.configured.length, 1);
    assert.equal(first.configured[0].agent, 'antigravity');
    assert.equal(first.configured[0].skills.length, 6);
    for (const item of first.linked) {
      assert.equal(await fs.realpath(item.target), await fs.realpath(item.source));
      assert.equal((await fs.lstat(item.target)).isSymbolicLink(), true);
    }
    assert.equal(await fs.readFile(path.join(codexSkills, '.system', 'keep'), 'utf8'), 'system data');
    assert.equal(await fs.readFile(path.join(cursorSkills, 'personal', 'SKILL.md'), 'utf8'), 'personal skill');
    assert.equal(await fs.lstat(path.join(codexSkills, 'codex-worker')).catch(e => e.code), 'ENOENT');
    assert.equal(await fs.lstat(path.join(cursorSkills, 'claude-consult')).catch(e => e.code), 'ENOENT');
    assert.equal(await fs.lstat(path.join(cursorSkills, 'claude-web')).catch(e => e.code), 'ENOENT');
    assert.equal(await fs.lstat(path.join(cursorSkills, 'codex-worker')).catch(e => e.code), 'ENOENT');
    const agyConfig = JSON.parse(await fs.readFile(antigravitySkillsJson, 'utf8'));
    assert.equal(agyConfig.entries.length, 2);
    assert.deepEqual(agyConfig.entries[0], { path: '~/personal-skills' });
    assert.equal(agyConfig.entries[1].include_only.includes('codex-worker'), true);
    assert.equal(agyConfig.entries[1].include_only.includes('claude-consult'), false);
    assert.equal(agyConfig.entries[1].include_only.includes('claude-web'), false);
    assert.deepEqual(JSON.parse(await fs.readFile(first.connectionFile, 'utf8')), config);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(first.backups.codex, 'claude-consult', 'connection.json'), 'utf8')), config);
    config.host = 'updated.invalid';
    await fs.writeFile(first.connectionFile, JSON.stringify(config));
    const repeated = invoke();
    assert.deepEqual(repeated.linked, []);
    assert.equal(repeated.configured, undefined);
    assert.equal(repeated.backups, undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(first.connectionFile, 'utf8')), config);
  } finally {
    if (path.dirname(fixture) !== path.resolve(os.tmpdir())) throw new Error('Unexpected fixture cleanup path.');
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
