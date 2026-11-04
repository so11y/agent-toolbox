import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function exists(file) {
  try { await fs.access(file); return true; }
  catch(e) { if(e.code==='ENOENT') return false; throw e; }
}
export async function writeRecord(file,value) {
  const temp=file+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await fs.rename(temp,file);
}
export async function cancelled(control) {
  return await exists(control.cancelFile) || await exists(control.turnCancelFile);
}
export async function beginRun(dir,turnId,key) {
  if(!/^[0-9a-f-]{36}$/i.test(turnId||'')) throw new Error('Pass the actual Codex turn_id with chatId.');
  const runId=randomUUID();
  const root=path.join(dir,'runs',runId);
  await fs.mkdir(root,{recursive:true});
  const control={key,runId,turnId,runFile:path.join(root,'run.json'),
    cancelFile:path.join(root,'cancel.json'),turnCancelFile:path.join(dir,'cancelled-turns',turnId+'.json')};
  await writeRecord(control.runFile,{...control,status:'starting',remoteExited:false});
  await writeRecord(path.join(dir,'active-run.json'),control);
  return control;
}
export async function finishRun(control,result) {
  await writeRecord(control.runFile,{...control,status:result.status,remoteExited:result.remoteExited===true,
    updatedAt:new Date().toISOString()});
}
