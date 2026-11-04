import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = path.resolve(here, '../connection.json');
const program = fs.readFile(path.join(here, 'remote_review.py')).then(gzipSync);
const projectStore = path.join(homedir(), '.cache', 'claude-consult', 'projects');
const maxBytes = 8 * 1024 * 1024;
const blockedDirs = new Set(['.git', '.codex', '.claude', '.agents', '.ssh', '.aws', '.azure', '.gnupg', 'node_modules', '.venv', 'venv', '__pycache__']);
const blockedNames = new Set(['agents.md', 'claude.md', 'skill.md', '.npmrc', '.pypirc', 'credentials', 'credentials.json', 'id_rsa', 'id_ed25519']);
const digest = b => createHash('sha256').update(b).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';

function privatePath(name) {
  const parts = name.toLowerCase().split('/');
  return parts.some(p => blockedDirs.has(p)) || blockedNames.has(parts.at(-1)) ||
    /^\.env($|\.)|\.pem$|\.p12$|\.pfx$|\.key$/i.test(parts.at(-1)) ||
    /(^|\/)work\/claude-consult(\/|$)/i.test(name);
}

function relativeName(value) {
  const name = value.replaceAll('\\', '/').replace(/\/$/, '');
  const parts = name.split('/');
  if (!name || /^[A-Za-z]:|^\//.test(name) || parts.some(p => !p || p === '.' || p === '..' || p.includes(':'))) {
    throw new Error('Use a project-relative file or directory path: ' + value);
  }
  if (privatePath(name)) throw new Error('Excluded private or execution-configuration path: ' + name);
  return name;
}

function checkText(text, label) {
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(text)) {
    throw new Error('Possible credential in ' + label + '; prepare a sanitized copy.');
  }
}

async function sourceFile(root, name) {
  let cursor = root;
  for (const part of name.split('/')) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Links are not exported: ' + name);
  }
  const actual = await fs.realpath(cursor);
  const rel = path.relative(root, actual);
  if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Path escaped project: ' + name);
  const info = await fs.stat(actual);
  if (!info.isFile() || info.nlink > 1) throw new Error('Expected a regular, unlinked file: ' + name);
  if (info.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB: ' + name);
  const bytes = await fs.readFile(actual);
  if (bytes.includes(0)) throw new Error('Only selected UTF-8 text files are supported: ' + name);
  checkText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), name);
  return { path: name, sha256: digest(bytes), size: bytes.length, bytes };
}

async function snapshot(root, selection, exclusions, additions = []) {
  const names = new Set();
  const omitted = name => privatePath(name) || exclusions.some(p => name === p || name.startsWith(p + '/'));
  async function visit(name) {
    if (omitted(name)) return;
    const target = path.join(root, name);
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) throw new Error('Links are not exported: ' + name);
    if (info.isDirectory()) {
      for (const entry of await fs.readdir(target)) await visit(name + '/' + entry);
    } else {
      names.add(name);
      if (names.size > 512) throw new Error('Select at most 512 files; narrow the shared directories.');
    }
  }
  for (const scope of selection) {
    if (omitted(scope)) continue;
    // A disappeared approved scope remains eligible if it is recreated later.
    try { await fs.lstat(path.join(root, scope)); }
    catch (error) { if (error.code === 'ENOENT' && !additions.includes(scope)) continue; throw error; }
    await visit(scope);
  }
  const sorted = [...names].sort();
  if (new Set(sorted.map(x => x.toLowerCase())).size !== sorted.length) throw new Error('Case-conflicting file paths.');
  const entries = [];
  let bytes = 0;
  for (const name of sorted) {
    const entry = await sourceFile(root, name);
    bytes += entry.size;
    if (bytes > maxBytes) throw new Error('Selected materials exceed 8 MiB; narrow the shared directories.');
    entries.push(entry);
  }
  const files = entries.map(({ path: p, sha256, size }) => ({ path: p, sha256, size }));
  return { entries, files, bytes, snapshotId: digest(JSON.stringify(files.map(x => [x.path, x.sha256]))) };
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function configuration(configFile = defaults) {
  const c = JSON.parse(await fs.readFile(configFile, 'utf8'));
  if (!/^[A-Za-z0-9.-]+$/.test(c.host) || !/^[a-z_][a-z0-9_-]*$/i.test(c.user) || c.user === 'root') {
    throw new Error('Use a non-root SSH account and a plain host name or IP.');
  }
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('Invalid SSH port.');
  return c;
}

async function projectIdentity(projectRoot, configFile) {
  const root = await fs.realpath(projectRoot);
  const config = await configuration(configFile);
  const destination = config.user + '@' + config.host.toLowerCase() + ':' + config.port;
  const projectId = digest(JSON.stringify([path.sep === '\\' ? root.toLowerCase() : root, destination]));
  return { root, config, destination, projectId, projectFile: path.join(projectStore, projectId + '.json') };
}

function command(executable, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, failure;
    const timer = setTimeout(() => { failure = new Error('SSH call timed out; do not automatically repeat a potentially billed request.'); child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    for (const [stream, key] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
      stream.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 2 * 1024 * 1024) { failure = new Error('Remote output exceeded 2 MiB.'); child.kill(); return; }
        if (key === 'out') stdout += chunk; else stderr += chunk;
      });
    }
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); failure ? reject(failure) : resolve({ code, stdout, stderr }); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
    child.stdin.end(input);
  });
}

async function exchange(config, payload, timeoutMs) {
  const compressed = gzipSync(Buffer.from(JSON.stringify({ ...payload, proxy: config.proxy || null })));
  const bootstrap = 'import base64,gzip\nREVIEW_REQUEST_GZIP=base64.b64decode("' +
    compressed.toString('base64') + '")\nexec(gzip.decompress(base64.b64decode("' +
    (await program).toString('base64') + '")))\n';
  const args = ['-T', '-p', String(config.port), '-i', config.identityFile,
    '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=12',
    '-o', 'ServerAliveInterval=15', config.user + '@' + config.host, 'python3 -'];
  const result = await command(config.sshExecutable, args, bootstrap, timeoutMs);
  let answer;
  try { answer = JSON.parse(result.stdout); }
  catch { throw new Error('SSH/helper failed (exit ' + result.code + '): ' + result.stderr.slice(0, 1000)); }
  return { answer, sentBytes: Buffer.byteLength(bootstrap), receivedBytes: Buffer.byteLength(result.stdout + result.stderr) };
}

export async function doctor(configFile) {
  return (await exchange(await configuration(configFile), { action: 'doctor' }, 70000)).answer;
}

/** One sequential reasoning turn. Project sharing persists; each task has its own Claude conversation. */
export async function consult({ projectRoot, taskDir, task, include = [], exclude,
  environment, results = [], message = '', baseRevision, responseLanguage, configFile, conversation }) {
  const { root, config, destination, projectId, projectFile } = await projectIdentity(projectRoot, configFile);
  const stateFile = path.join(taskDir, 'state.json');
  let state = await readJson(stateFile);
  if (state && (state.version !== 3 || state.projectId !== projectId || state.closed)) {
    throw new Error('Use a new task directory for a different project/server, completed task, or older skill version.');
  }
  state ||= { version: 3, projectRoot: root, destination, projectId, workspaceId: randomUUID(), files: [], environment: {} };
  const project = await readJson(projectFile) || { version: 3, projectRoot: root, destination, selection: [], exclusions: [] };
  const additions = include.map(relativeName);
  const selection = [...new Set([...project.selection, ...additions])].sort();
  const exclusions = exclude === undefined ? project.exclusions : [...new Set(exclude.map(relativeName))].sort();
  const relativeTask = path.relative(root, path.resolve(taskDir));
  if (relativeTask !== '..' && !relativeTask.startsWith('..' + path.sep) && !path.isAbsolute(relativeTask) &&
      !privatePath(relativeTask.replaceAll('\\', '/'))) {
    throw new Error('Keep task records outside the project or under its work/claude-consult/ directory.');
  }
  const context = {
    task: task ?? state.task,
    environment: environment === null ? {} : { ...state.environment, ...environment },
    results, message,
    baseRevision: baseRevision ?? state.baseRevision ?? '',
    responseLanguage: responseLanguage ?? state.responseLanguage ?? 'ja'
  };
  if (!context.task?.trim()) throw new Error('A task is required on the first turn.');
  const contextText = JSON.stringify(context);
  if (Buffer.byteLength(contextText) > 1024 * 1024) throw new Error('Context exceeds 1 MiB; select relevant evidence.');
  checkText(contextText, 'task/environment/results');

  const { entries, files, bytes, snapshotId } = await snapshot(root, selection, exclusions, additions);
  const oldFiles = new Map(state.files.map(x => [x.path, x.sha256]));
  const names = new Set(files.map(x => x.path));
  const changes = {
    added: files.filter(x => !oldFiles.has(x.path)).map(x => x.path),
    modified: files.filter(x => oldFiles.has(x.path) && oldFiles.get(x.path) !== x.sha256).map(x => x.path),
    removed: state.files.filter(x => !names.has(x.path)).map(x => x.path)
  };
  const request = { version: 3, action: 'analyze', projectId, workspaceId: state.workspaceId, snapshotId,
    sessionId: conversation?.sessionId || state.sessionId || null, ...context, changes, files,
    ...(conversation ? { conversation } : {}) };
  const step = randomUUID();
  await fs.mkdir(path.join(taskDir, 'steps'), { recursive: true });
  await fs.mkdir(projectStore, { recursive: true });
  const record = { request, result: null };
  const recordFile = path.join(taskDir, 'steps', step + '.json');
  await fs.writeFile(recordFile, json(record), { mode: 0o600 });
  Object.assign(project, { selection, exclusions });
  await fs.writeFile(projectFile, json(project), { mode: 0o600 });
  // Only advance the reviewed snapshot/session after a successful analysis.
  Object.assign(state, { task: context.task, environment: context.environment, responseLanguage: context.responseLanguage,
    baseRevision: context.baseRevision });
  await fs.writeFile(stateFile, json(state), { mode: 0o600 });

  let result;
  try {
    const objects = new Map(entries.map(x => [x.sha256, x.bytes]));
    const offer = await exchange(config, { action: 'offer', projectId, hashes: [...objects.keys()], conversation }, 70000);
    if (offer.answer.status !== 'ready') {
      result = { status: 'not_ready', detail: offer.answer, uploadedSourceBytes: 0 };
    } else {
      const uploads = {};
      let sourceBytes = 0;
      for (const hash of offer.answer.missing) {
        if (!objects.has(hash)) throw new Error('Server requested content outside the selected snapshot.');
        uploads[hash] = objects.get(hash).toString('base64');
        sourceBytes += objects.get(hash).length;
      }
      const reply = await exchange(config, { ...request, uploads }, 660000);
      result = { ...reply.answer, transfer: {
        selectedFiles: files.length, uploadedObjects: Object.keys(uploads).length,
        uploadedSourceBytes: sourceBytes, selectedSourceBytes: bytes,
        sentBytes: offer.sentBytes + reply.sentBytes, receivedBytes: offer.receivedBytes + reply.receivedBytes, sshCalls: 2
      }};
      if (result.snapshotId && result.snapshotId !== snapshotId) throw new Error('Response snapshot mismatch.');
      if (result.status === 'ok') {
        Object.assign(state, { files, snapshotId, latestStep: step, sessionId: result.sessionId });
        await fs.writeFile(stateFile, json(state), { mode: 0o600 });
      }
    }
    record.result = result;
    await fs.writeFile(recordFile, json(record), { mode: 0o600 });
    return { ...result, recordFile };
  } catch (error) {
    record.result = { status: 'transport_error', message: error.message };
    await fs.writeFile(recordFile, json(record), { mode: 0o600 });
    throw error;
  }
}

export async function ensureCurrent(taskDir) {
  const state = await readJson(path.join(taskDir, 'state.json'));
  if (!state?.latestStep || state.closed) throw new Error('No open, successfully analyzed task is recorded.');
  const project = await readJson(path.join(projectStore, state.projectId + '.json'));
  if (!project) throw new Error('The shared project has been forgotten.');
  const current = await snapshot(state.projectRoot, project.selection, project.exclusions);
  if (current.snapshotId !== state.snapshotId) throw new Error('Local inputs or sharing scope changed since analysis.');
  return { snapshotId: state.snapshotId, sessionId: state.sessionId };
}

export async function close({ taskDir, configFile }) {
  const stateFile = path.join(taskDir, 'state.json');
  const state = await readJson(stateFile);
  if (!state || state.version !== 3) throw new Error('No current-version task state found.');
  const config = await configuration(configFile);
  if (state.destination !== config.user + '@' + config.host.toLowerCase() + ':' + config.port) throw new Error('Server changed.');
  const { answer } = await exchange(config, { action: 'close', projectId: state.projectId, workspaceId: state.workspaceId }, 30000);
  if (answer.status === 'closed') {
    state.closed = true;
    await fs.writeFile(stateFile, json(state), { mode: 0o600 });
  }
  return answer;
}

/** Explicitly remove this project's retained remote sources and remembered local sharing scope. */
export async function forgetProject({ projectRoot, configFile }) {
  const { config, projectId, projectFile } = await projectIdentity(projectRoot, configFile);
  const { answer } = await exchange(config, { action: 'forget', projectId }, 30000);
  if (answer.status === 'forgotten') await fs.rm(projectFile, { force: true });
  return answer;
}

export async function chatAction(payload, configFile) {
  if (!['history_open','history_release','history_register','history_list'].includes(payload.action)) throw new Error('Invalid history action.');
  return (await exchange(await configuration(configFile), payload, 45000)).answer;
}
