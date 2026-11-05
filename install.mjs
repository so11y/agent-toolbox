import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultConnectionFile } from './skills/claude-consult/scripts/consult.mjs';

const sources = fileURLToPath(new URL('./skills/', import.meta.url));
const allSkills = (await fs.readdir(sources, { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const developmentSkills = ['audit-refactor-project', 'code-analysis', 'concise-plan-docs', 'decision-lock', 'tidy-code'];
const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
const profiles = {
  codex: { directory: path.join(codexHome, 'skills'), skills: allSkills },
  cursor: { directory: path.join(homedir(), '.cursor', 'skills'), skills: developmentSkills },
  claude: { directory: path.join(homedir(), '.claude', 'skills'), skills: developmentSkills }
};
const requested = process.argv.slice(2);
const selected = requested.length ? [...new Set(requested)] : ['codex', 'cursor'];
for (const name of selected) {
  if (!profiles[name]) throw new Error('Usage: node install.mjs [codex] [cursor] [claude]');
}
const stamp = new Date().toISOString().replaceAll(':', '-');

async function info(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Keep machine configuration outside linked source directories.
const legacyConnection = path.join(codexHome, 'skills', 'claude-consult', 'connection.json');
if (selected.includes('codex') && !await info(defaultConnectionFile) && await info(legacyConnection)) {
  await fs.mkdir(path.dirname(defaultConnectionFile), { recursive: true });
  await fs.copyFile(legacyConnection, defaultConnectionFile, fs.constants.COPYFILE_EXCL);
  await fs.chmod(defaultConnectionFile, 0o600);
}

const installed = [];
const backups = {};
for (const agent of selected) {
  const profile = profiles[agent];
  await fs.mkdir(profile.directory, { recursive: true });
  const directory = await fs.realpath(profile.directory);
  const backup = path.join(path.dirname(directory), 'skill-backups', stamp);
  for (const name of profile.skills) {
    const source = await fs.realpath(path.join(sources, name));
    const target = path.resolve(directory, name);
    const current = await info(target);
    if (current?.isSymbolicLink()) {
      try { if (await fs.realpath(target) === source) continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (current) {
      const archived = path.join(backup, name);
      // Move only the selected skill entry, never its containing skills root.
      if (path.dirname(target) !== directory) throw new Error('Unexpected skill path.');
      await fs.mkdir(path.dirname(archived), { recursive: true });
      await fs.rename(target, archived);
      backups[agent] = backup;
    }
    await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    installed.push({ agent, skill: name, target, source });
  }
}
console.log(JSON.stringify({ linked: installed, connectionFile: defaultConnectionFile,
  ...(Object.keys(backups).length ? { backups } : {}) }, null, 2));
