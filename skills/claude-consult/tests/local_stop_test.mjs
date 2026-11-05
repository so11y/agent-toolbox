import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {beginRun,cancelled,writeRecord} from '../scripts/local_control.mjs';
import {consultChat,resumeChat,stopChat,ensureCurrent} from '../scripts/chats.mjs';
import {loadConnection} from '../scripts/consult.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'claude-stop-local-'));
const chatId=randomUUID(),turnId=randomUUID(),otherTurn=randomUUID(),key=randomUUID(),sessionId=randomUUID();
const store=path.resolve(os.homedir(),'.cache/claude-consult/chats');
const dir=path.resolve(store,createHash('sha256').update(chatId).digest('hex'));
const hook=new URL('../scripts/interrupt.ps1',import.meta.url);
const configFile=process.argv[2];
const connection=await loadConnection(configFile);
const checks={};
function trigger(event,turn) {
  const start=Date.now();
  const result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-File',hook.pathname.replace(/^\/([A-Za-z]:)/,'$1')],
    {windowsHide:true,encoding:'utf8',timeout:3000,
     input:JSON.stringify({session_id:chatId,turn_id:turn,hook_event_name:event})});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'');
  assert.ok(Date.now()-start<3000);
}
try {
  await fs.mkdir(dir,{recursive:true});
  const c=await beginRun(dir,turnId,key);
  trigger('Interrupt',otherTurn);
  assert.equal(await cancelled(c),false);
  checks.wrong_turn_does_not_cancel=true;
  trigger('Interrupt',turnId);
  assert.equal(await cancelled(c),true);
  checks.interrupt_marks_correct_turn_under_three_seconds=true;
  await assert.rejects(ensureCurrent(path.join(dir,'task')),/cancelled/);
  checks.old_guidance_rejected=true;

  const c2=await beginRun(dir,randomUUID(),key);
  trigger('SessionEnd',undefined);
  assert.equal(await cancelled(c2),true);
  checks.session_end_marks_active_run=true;
  await writeRecord(path.join(dir,'chat.json'),{version:1,codexChatId:chatId,projectRoot:await fs.realpath(root),
    destination:connection.user+'@'+connection.host+':'+connection.port,key,sessionId,
    title:'停止処理の確認',taskDir:path.join(dir,'task'),started:false,paused:false,attention:false});
  await fs.mkdir(path.join(dir,'operation.lock'));
  await writeRecord(path.join(dir,'operation.lock','owner.json'),{id:randomUUID(),runId:c2.runId});
  const stopped=await stopChat({chatId,configFile});
  assert.equal(stopped.remoteExited,true);
  const resumed=await resumeChat({chatId,configFile});
  assert.equal(resumed.status,'released');
  checks.stale_lock_recovery_with_remote_confirmation=true;
  const same=JSON.parse(await fs.readFile(path.join(dir,'chat.json'),'utf8'));
  assert.equal(same.sessionId,sessionId);
  checks.resume_keeps_session_id=true;
  const preCancelledTurn=randomUUID();
  trigger('Interrupt',preCancelledTurn);
  const stoppedBeforeCall=await consultChat({chatId,configFile,turnId:preCancelledTurn,projectRoot:root,task:'No model call should start.'});
  assert.equal(stoppedBeforeCall.status,'cancelled');
  assert.equal(stoppedBeforeCall.remoteExited,true);
  checks.cancel_before_consult_no_model_request=true;
  console.log(JSON.stringify({passed:checks}));
} finally {
  if(path.dirname(dir)!==store)throw new Error('Unexpected test cleanup path.');
  await fs.rm(dir,{recursive:true,force:true});
  if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Unexpected temporary project.');
  await fs.rm(root,{recursive:true,force:true});
}
