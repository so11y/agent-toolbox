import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { consult, chatAction } from './consult.mjs';

const store = path.join(homedir(), '.cache', 'claude-consult', 'chats');
const defaults = new URL('../connection.json', import.meta.url);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function location(chatId) {
  if (!uuid.test(chatId || '')) throw new Error('Pass the actual Codex threadId; do not invent a chat identifier.');
  return path.join(store, createHash('sha256').update(chatId.toLowerCase()).digest('hex'));
}
async function read(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function save(dir, value) {
  value.updatedAt = new Date().toISOString();
  const tmp = path.join(dir, 'chat.tmp');
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', {mode:0o600});
  await fs.rename(tmp, path.join(dir, 'chat.json'));
}
async function locked(chatId, fn) {
  const dir = location(chatId);
  await fs.mkdir(dir, {recursive:true});
  const lock = path.join(dir, 'operation.lock');
  try { await fs.mkdir(lock); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('This Codex chat already has an operation running. Await it; inspect a leftover lock after a crash.'); throw e; }
  try { return await fn(dir, await read(path.join(dir, 'chat.json'))); }
  finally { await fs.rmdir(lock); }
}
async function identity(projectRoot, configFile) {
  const root = await fs.realpath(projectRoot);
  const configPath = configFile ? path.resolve(configFile) : defaults;
  const c = JSON.parse(await fs.readFile(configPath, 'utf8'));
  return {root, destination:c.user + '@' + c.host.toLowerCase() + ':' + c.port};
}
async function entryFor(dir, entry, options) {
  const {root,destination} = await identity(options.projectRoot, options.configFile);
  if (entry) {
    if (entry.projectRoot.toLowerCase() !== root.toLowerCase() || entry.destination !== destination)
      throw new Error('This chat is bound to another project/server. Keep its workspace, or use a new Codex chat; it will not silently switch sessions.');
  } else {
    entry = {version:1, codexChatId:options.chatId, projectRoot:root, destination, key:randomUUID(), sessionId:randomUUID(),
      title:options.title || path.basename(root), taskDir:path.join(dir,'task'), started:false,
      paused:false, attention:false, createdAt:new Date().toISOString()};
  }
  if (options.title !== undefined) {
    if (!options.title.trim() || options.title.length > 120) throw new Error('Use a short, nonempty conversation title.');
    entry.title = options.title;
  }
  await save(dir,entry);
  return entry;
}
function metadata(entry) {
  return {key:entry.key, title:entry.title, sessionId:entry.sessionId, resume:entry.started};
}
export async function consultChat(options) {
  return locked(options.chatId, async (dir,entry) => {
    entry = await entryFor(dir,entry,options);
    if (entry.paused || entry.attention) throw new Error('This chat is paused or needs reconciliation. Inspect its state, then use resumeChat when the user asks to continue.');
    try {
      const result = await consult({...options, taskDir:entry.taskDir, conversation:metadata(entry)});
      if (result.status === 'ok') {
        if (result.sessionId !== entry.sessionId) throw new Error('Claude returned a different session ID; binding was not changed.');
        entry.started = true;
        entry.decision = result.guidance.decision;
        entry.summary = result.guidance.summary;
      } else {
        entry.attention = !['not_ready','conversation_paused','project_busy'].includes(result.status);
      }
      entry.lastStatus = result.status;
      await save(dir,entry);
      return {...result, taskDir:entry.taskDir, conversationTitle:entry.title};
    } catch(e) {
      entry.attention = true;
      entry.lastStatus = 'attention_required';
      await save(dir,entry);
      throw e;
    }
  });
}
export async function listChats({projectRoot} = {}) {
  const root = projectRoot ? (await fs.realpath(projectRoot)).toLowerCase() : null;
  let dirs;
  try { dirs = await fs.readdir(store); } catch(e) { if(e.code==='ENOENT') return []; throw e; }
  const entries = [];
  for (const name of dirs) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const entry = await read(path.join(store,name,'chat.json'));
    if (entry && (!root || entry.projectRoot.toLowerCase() === root))
      entries.push({...entry, recordFile:path.join(store,name,'chat.json')});
  }
  return entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function openChat({chatId,configFile}) {
  return locked(chatId, async(dir,entry)=>{
    if (!entry?.started) throw new Error('No saved Claude conversation is bound to this chat.');
    const result = await chatAction({action:'history_open',key:entry.key},configFile);
    if (result.status === 'opening') {entry.paused=true; await save(dir,entry);}
    return result;
  });
}
export async function resumeChat({chatId,configFile}) {
  return locked(chatId, async(dir,entry)=>{
    if (!entry) throw new Error('No conversation binding found.');
    const result = await chatAction({action:'history_release',key:entry.key,sessionId:entry.sessionId},configFile);
    if (result.status === 'released') {
      if (entry.started && !result.sessionExists) throw new Error('Saved Claude history is missing; restore it before continuing this binding.');
      entry.started = result.sessionExists;
      entry.paused = false; entry.attention=false;
      await save(dir,entry);
    }
    return result;
  });
}
/** Adopt a verified existing CLI session into this chat, only on an explicit migration. */
export async function bindChat(options) {
  if (!uuid.test(options.sessionId)) throw new Error('Invalid Claude session ID.');
  await fs.mkdir(store, {recursive:true});
  const claimLock = path.join(store, 'binding-' + options.sessionId.toLowerCase() + '.lock');
  try { await fs.mkdir(claimLock); }
  catch(e) { if(e.code==='EEXIST') throw new Error('This Claude session is being bound by another operation.'); throw e; }
  try { return await locked(options.chatId, async(dir,entry)=>{
    if (entry && entry.sessionId !== options.sessionId) throw new Error('This chat already has another binding.');
    if (!uuid.test(options.sessionId)) throw new Error('Invalid Claude session ID.');
    const owner = (await listChats()).find(x => x.sessionId === options.sessionId && x.codexChatId !== options.chatId);
    if (owner) throw new Error('This Claude session already belongs to another Codex chat.');
    entry = await entryFor(dir,entry,options);
    entry.sessionId = options.sessionId;
    await save(dir,entry);
    const result = await chatAction({action:'history_register', conversation:metadata(entry)}, options.configFile);
    if (result.status !== 'registered') throw new Error('Existing Claude history was not found.');
    entry.started = true; entry.attention=false; await save(dir,entry);
    return entry;
  }); } finally { await fs.rmdir(claimLock); }
}

export { ensureCurrent } from './consult.mjs';
