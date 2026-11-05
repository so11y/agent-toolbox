import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {consultChat,resumeChat,stopChat} from '../scripts/chats.mjs';
import {chatAction,close,forgetProject} from '../scripts/consult.mjs';

const chatId=randomUUID();
const root=await fs.mkdtemp(path.join(os.tmpdir(),'claude-live-stop-'));
const store=path.resolve(os.homedir(),'.cache/claude-consult/chats');
const dir=path.resolve(store,createHash('sha256').update(chatId).digest('hex'));
const configFile=process.argv[2];
let first,second,third,control;
try {
  await fs.writeFile(path.join(root,'README.md'),'Small isolated cancellation check.\n');
  first=await consultChat({chatId,configFile,turnId:randomUUID(),projectRoot:root,title:'停止と再開の確認',
    task:'短い動作確認です。合言葉は「青空411」です。project/README.md を読んで一文で確認し、完了として返してください。',
    include:['README.md']});
  assert.equal(first.status,'ok',JSON.stringify(first));
  const turnId=randomUUID();
  const call=consultChat({chatId,configFile,turnId,projectRoot:root,
    task:'project/README.md を読み、前の合言葉を確認してください。これは停止操作の動作確認です。'});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline) {
    try {control=JSON.parse(await fs.readFile(path.join(dir,'active-run.json'),'utf8'));}
    catch {control=null;}
    if(control?.turnId===turnId) {
      const remote=await chatAction({action:'run_status',control:{key:control.key,runId:control.runId}},configFile);
      if(remote.status==='running')break;
    }
    await new Promise(r=>setTimeout(r,200));
  }
  assert.equal(control?.turnId,turnId);
  const interruptedAt=Date.now();
  const hookPath=new URL('../scripts/interrupt.ps1',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
  const hook=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    ['-NoProfile','-NonInteractive','-File',hookPath],
    {windowsHide:true,encoding:'utf8',timeout:3000,input:JSON.stringify({hook_event_name:'Interrupt',session_id:chatId,turn_id:turnId})});
  assert.equal(hook.status,0,hook.stderr);
  second=await call;
  assert.equal(second.status,'cancelled',JSON.stringify(second));
  assert.equal(second.remoteExited,true);
  const stoppedAfterMs=Date.now()-interruptedAt;
  assert.equal((await resumeChat({chatId,configFile})).status,'released');
  third=await consultChat({chatId,configFile,turnId:randomUUID(),projectRoot:root,
    task:'停止後の再開確認です。最初の会話の合言葉を一文で答え、完了として返してください。'});
  assert.equal(third.status,'ok',JSON.stringify(third));
  assert.equal(first.sessionId,third.sessionId);
  assert.match(third.guidance.summary,/青空411/);
  console.log(JSON.stringify({realClaude:true,hookDirectlyInvoked:true,nativeStopButtonTested:false,
    confirmedRemoteExit:true,stoppedAfterMs,sameSessionAfterResume:true,rememberedContext:true,
    sessionId:first.sessionId,runKey:control.key,projectRoot:root,chatId}));
} finally {
  try {await stopChat({chatId,configFile});} catch {}
  if(first?.taskDir) await close({taskDir:first.taskDir,configFile}).catch(()=>{});
  await forgetProject({projectRoot:root,configFile}).catch(()=>{});
  if(path.dirname(dir)!==store)throw new Error('Unexpected chat cleanup');
  await fs.rm(dir,{recursive:true,force:true});
  if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Unexpected project cleanup');
  await fs.rm(root,{recursive:true,force:true});
}
