import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadConnection } from '../skills/claude-consult/scripts/consult.mjs';

const config = await loadConnection(process.argv[2]);
const names = JSON.parse(await fs.readFile(new URL('./skills.json', import.meta.url), 'utf8'));
const skills = await Promise.all(names.map(async name => {
  const body = await fs.readFile(new URL('../skills/' + name + '/SKILL.md', import.meta.url));
  // Canonical shared skills use folded, indented YAML descriptions.
  const description = body.toString('utf8').match(/^description: >-\r?\n((?:[ \t]+[^\r\n]*\r?\n)+)/m)[1]
    .trim().split(/\r?\n/).map(line => line.trim()).join(' ');
  return { name, description, body: body.toString('base64') };
}));
const programs = Object.fromEntries(await Promise.all(
  ['remote_review.py', 'run_control.py', 'history.py'].map(async name =>
    [name, (await fs.readFile(new URL('./claude-consult/' + name, import.meta.url))).toString('base64')])));
const installer = (await fs.readFile(new URL('./install.py', import.meta.url))).toString('base64');
const remote = "python3 -c 'import base64;exec(base64.b64decode(\"" + installer + "\"))'";
const args = ['-T', '-p', String(config.port), '-i', config.identityFile,
  '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=12',
  config.user + '@' + config.host, remote];
const child = spawn(config.sshExecutable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let output = '', diagnostic = '';
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => diagnostic += data);
child.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
child.stdin.end(JSON.stringify({ programs, skills, proxy: config.proxy || null }));
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
if (code !== 0) throw new Error('Server installation failed (' + code + '): ' + diagnostic);
console.log(JSON.stringify(JSON.parse(output), null, 2));
