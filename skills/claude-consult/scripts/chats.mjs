import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { consult, chatAction } from './consult.mjs';
import { beginRun, finishRun, cancelled, writeRecord } from './local_control.mjs';

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
  const owner={id:randomUUID()};
  await writeRecord(path.join(lock,'owner.json'),owner);
  try { return await fn(dir, await read(path.join(dir, 'chat.json'))); }
  finally {
    if((await read(path.join(lock,'owner.json')))?.id===owner.id) {
      await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);
    }
  }
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
  if(!uuid.test(options.turnId||'')) throw new Error('Pass the actual Codex turn_id with chatId.');
  return locked(options.chatId, async (dir,entry) => {
    entry = await entryFor(dir,entry,options);
    const previous=await read(path.join(dir,'active-run.json'));
    if(previous && await cancelled(previous) && entry.resumedAfterRun!==previous.runId) throw new Error('The previous Codex turn was stopped. Use resumeChat before continuing.');
    if (entry.paused || entry.attention) throw new Error('This chat is paused or needs reconciliation. Inspect its state, then use resumeChat when the user asks to continue.');
    const control=await beginRun(dir,options.turnId,entry.key);
    const ownerFile=path.join(dir,'operation.lock','owner.json');
    await writeRecord(ownerFile,{...await read(ownerFile),runId:control.runId});
    try {
      const result = await cancelled(control) ? {status:'cancelled',remoteExited:true} :
        await consult({...options, taskDir:entry.taskDir, conversation:metadata(entry),control});
      if((await read(path.join(dir,'active-run.json')))?.runId!==control.runId) return {status:'cancelled',runId:control.runId};
      if(await cancelled(control) || ['cancelled','connection_lost','lease_expired','helper_exited','timeout'].includes(result.status)) {
        entry.paused=true;entry.attention=true;
        entry.lastStatus=result.remoteExited?'cancelled':'stop_pending';
        await finishRun(control,{status:entry.lastStatus,remoteExited:result.remoteExited});
        await save(dir,entry);
        return {status:entry.lastStatus,remoteExited:result.remoteExited===true,sessionId:entry.sessionId,runId:control.runId};
      }
      if (result.status === 'ok') {
        if (result.sessionId !== entry.sessionId) throw new Error('Claude returned a different session ID; binding was not changed.');
        entry.started = true;
        entry.decision = result.guidance.decision;
        entry.summary = result.guidance.summary;
      } else {
        entry.attention = !['not_ready','conversation_paused','project_busy'].includes(result.status);
      }
      await finishRun(control,{status:result.status,remoteExited:result.status==='ok'||result.status==='not_ready'});
      entry.lastStatus = result.status;
      await save(dir,entry);
      return {...result, taskDir:entry.taskDir, conversationTitle:entry.title};
    } catch(e) {
      if((await read(path.join(dir,'active-run.json')))?.runId!==control.runId) throw e;
      const wasCancelled=await cancelled(control);
      await finishRun(control,{status:wasCancelled?'stop_pending':'attention_required',remoteExited:false});
      entry.paused=wasCancelled;
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
  await recoverCancelledLock(chatId,configFile);
  return locked(chatId, async(dir,entry)=>{
    if (!entry) throw new Error('No conversation binding found.');
    const result = await chatAction({action:'history_release',key:entry.key,sessionId:entry.sessionId},configFile);
    if (result.status === 'released') {
      if (entry.started && !result.sessionExists) throw new Error('Saved Claude history is missing; restore it before continuing this binding.');
      entry.started = result.sessionExists;
      entry.paused = false; entry.attention=false;
      entry.resumedAfterRun=(await read(path.join(dir,'active-run.json')))?.runId;
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

/** Cancels only this chat's active run; deliberately bypasses the analysis lock. */
export async function stopChat({chatId,turnId,configFile}) {
  const dir=location(chatId);
  const control=await read(path.join(dir,'active-run.json'));
  if(!control || (turnId && turnId!==control.turnId)) return {status:'not_running'};
  await writeRecord(control.turnCancelFile,{reason:'user_interrupt',turnId:control.turnId});
  await writeRecord(control.cancelFile,{reason:'user_interrupt'});
  try {
    let result=await chatAction({action:'run_cancel',control:{key:control.key,runId:control.runId}},configFile,10000);
    const deadline=Date.now()+6000;
    while(!result.remoteExited && Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,300));
      result=await chatAction({action:'run_status',control:{key:control.key,runId:control.runId}},configFile,10000);
    }
    const answer={status:result.remoteExited?'cancelled':'stop_pending',remoteExited:result.remoteExited===true,runId:control.runId};
    await finishRun(control,answer);
    return answer;
  } catch(e) {
    const answer={status:'stop_pending',remoteExited:false,runId:control.runId,diagnostic:e.message};
    await finishRun(control,answer);
    return answer;
  }
}
async function recoverCancelledLock(chatId,configFile) {
  const dir=location(chatId),control=await read(path.join(dir,'active-run.json'));
  if(!control || !await cancelled(control)) return;
  const reply=await chatAction({action:'run_cancel',control:{key:control.key,runId:control.runId}},configFile,10000);
  if(!reply.remoteExited) throw new Error('Remote stop is not confirmed yet; do not resume or replace this run.');
  const lock=path.join(dir,'operation.lock');
  const owner=await read(path.join(lock,'owner.json'));
  if(owner?.runId===control.runId) {
    await fs.unlink(path.join(lock,'owner.json'));
    await fs.rmdir(lock);
  }
}
