import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertSafeWrite} from './safety';

const TOKEN=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const INVALID='更新启动确认无效；将保留或恢复原版本。';
function localPath(value:unknown):string {
 if(typeof value!=='string'||!path.isAbsolute(value)||value.startsWith('\\\\')||/[\x00-\x1f]/.test(value)||value.includes(':',3)||value.split(/[\\/]/).some(part=>/[. ]$/.test(part)))throw new Error(INVALID);
 return path.resolve(value);
}
function equalPath(a:string,b:string):boolean {return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b}
function sameFile(a:fs.Stats,b:fs.Stats):boolean {return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs}
async function readSmallJson(file:string):Promise<any> {
 const before=await fsp.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>131072)throw new Error(INVALID);
 const handle=await fsp.open(file,'r');
 try {
  if(!sameFile(before,await handle.stat()))throw new Error(INVALID);
  const text=await handle.readFile('utf8');
  if(!sameFile(before,await handle.stat())||!sameFile(before,await fsp.lstat(file)))throw new Error(INVALID);
  return JSON.parse(text.replace(/^\uFEFF/,''));
 }finally{await handle.close()}
}
async function verifyTarget(target:string,size:number,sha256:string):Promise<void> {
 const before=await fsp.lstat(target);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size!==size)throw new Error(INVALID);
 const handle=await fsp.open(target,'r');
 try{
  if(!sameFile(before,await handle.stat()))throw new Error(INVALID);
  const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
  if(hash.digest('hex')!==sha256||!sameFile(before,await handle.stat())||!sameFile(before,await fsp.lstat(target)))throw new Error(INVALID);
 }finally{await handle.close()}
}

/** Called only after the main window has loaded successfully. CLI supplies a UUID, never a path. */
export async function acknowledgeUpdateStartup(dataDir:string,roots:string[],appVersion?:string):Promise<boolean> {
 const args=process.argv.filter(arg=>arg==='--vrc-update-token'||arg.startsWith('--vrc-update-token='));
 if(args.length===0)return false;
 const token=args[0]?.slice('--vrc-update-token='.length);
 if(args.length!==1||!args[0].startsWith('--vrc-update-token=')||!TOKEN.test(token))throw new Error(INVALID);
 const data=localPath(dataDir),stage=assertSafeWrite(path.join(data,'updates',token),data,roots),manifest=assertSafeWrite(path.join(stage,'install.json'),data,roots);
 const plan=await readSmallJson(manifest);
 if(!plan||plan.schema!==1||plan.token!==token||!DIGEST.test(plan.sha256)||!DIGEST.test(plan.expectedTargetSha256)||!Number.isSafeInteger(plan.size)||plan.size<512||plan.size>1024*1024*1024||!Number.isSafeInteger(plan.expectedTargetSize)||plan.expectedTargetSize<512||plan.expectedTargetSize>1024*1024*1024||!Number.isSafeInteger(plan.parentPid)||plan.parentPid<1||plan.parentPid>2147483647||!Array.isArray(plan.protectedRoots)||typeof plan.version!=='string'||!/^\d+\.\d+\.\d+$/.test(plan.version)||appVersion!==undefined&&plan.version!==appVersion)throw new Error(INVALID);
 const guarded=[...roots,...plan.protectedRoots.map(localPath)],target=localPath(plan.target),portable=localPath(process.env.PORTABLE_EXECUTABLE_FILE);
 if(!equalPath(localPath(plan.dataDir),data)||!equalPath(localPath(plan.stageDir),stage)||!equalPath(localPath(plan.staged),path.join(stage,'update.exe'))||!equalPath(target,portable)||path.extname(target).toLowerCase()!=='.exe')throw new Error(INVALID);
 assertSafeWrite(stage,data,guarded);assertSafeWrite(manifest,data,guarded);assertSafeWrite(target,data,guarded,true);
 await verifyTarget(target,plan.size,plan.sha256);
 const receipt=assertSafeWrite(path.join(stage,'startup-ready.json'),data,guarded),pending=assertSafeWrite(path.join(stage,'startup-ready-'+randomUUID()+'.tmp'),data,guarded);
 const payload=JSON.stringify({schema:1,token,target,sha256:plan.sha256,size:plan.size,version:plan.version,pid:process.pid,parentPid:process.ppid,startupReady:true,at:new Date().toISOString()});
 try{
  const file=await fsp.open(pending,'wx');try{await file.writeFile(payload,'utf8');await file.sync()}finally{await file.close()}
  assertSafeWrite(receipt,data,guarded);assertSafeWrite(pending,data,guarded);
  // Prefer exclusive publication; exFAT and similar filesystems need an atomic rename instead.
  try{await fsp.link(pending,receipt)}catch(error:any){
   if(!['ENOTSUP','EOPNOTSUPP','ENOSYS','EPERM','EINVAL'].includes(error.code))throw error;
   assertSafeWrite(receipt,data,guarded);
   try{await fsp.lstat(receipt);throw new Error(INVALID)}catch(existing:any){if(existing.code!=='ENOENT')throw existing}
   assertSafeWrite(pending,data,guarded);assertSafeWrite(receipt,data,guarded);
   // Only the fixed receipt inside this operation's validated UUID stage can be published.
   // The temporary file is complete, flushed and closed before it becomes visible here.
   await fsp.rename(pending,receipt);
  }
 }finally{try{assertSafeWrite(pending,data,guarded);await fsp.unlink(pending)}catch(error:any){if(error.code!=='ENOENT')throw error}}
 return true;
}
