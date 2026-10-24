import {session,safeStorage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertSafeWrite} from './safety';
import type {BrowserCookieSnapshot} from './storage';

export const COOKIE_MIGRATION_FAILED='登录状态无法完整保存，资料库迁移已停止；原位置和登录资料仍保留。';
type EligibleCookie=Electron.Cookie&{domain:string};
export function persistentCookieDigest(cookies:Electron.Cookie[],key:(cookie:Electron.Cookie)=>string):string {
 return createHash('sha256').update(JSON.stringify(cookies.filter(c=>c.session!==true).map(c=>[key(c),c.value,c.expirationDate]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
}

/** Local cookie-store access only: no window, navigation, optional-feature enablement or requests. */
export async function snapshotBrowserCookies(dataDir:string,roots:string[],profile:BrowserCookieSnapshot['profile'],eligible:(cookie:any)=>cookie is EligibleCookie,key:(cookie:Electron.Cookie)=>string):Promise<BrowserCookieSnapshot|undefined> {
 const folder=assertSafeWrite(path.join(dataDir,profile),dataDir,roots),mirror=assertSafeWrite(path.join(dataDir,profile+'-cookies.bin'),dataDir,roots);
 if(!fs.existsSync(folder)&&!fs.existsSync(mirror))return;
 try{
  if(!safeStorage.isEncryptionAvailable())throw new Error(COOKIE_MIGRATION_FAILED);
  const retained=new Map<string,EligibleCookie>();let previousDigest:string|undefined;
  if(fs.existsSync(mirror)){
   const info=fs.lstatSync(mirror);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw new Error(COOKIE_MIGRATION_FAILED);
   const payload=JSON.parse(safeStorage.decryptString(fs.readFileSync(mirror)));
   if(!payload||!Number.isFinite(payload.at)||payload.at>Date.now()+60000||!Array.isArray(payload.cookies))throw new Error(COOKIE_MIGRATION_FAILED);
   if(Date.now()-payload.at<=30*86400000){if(typeof payload.nativeCookieDigest==='string'&&/^[a-f0-9]{64}$/.test(payload.nativeCookieDigest))previousDigest=payload.nativeCookieDigest;for(const cookie of payload.cookies){if(eligible(cookie))retained.set(key(cookie),cookie)}}
  }
  if(fs.existsSync(folder)){
   const info=fs.lstatSync(folder);if(!info.isDirectory()||info.isSymbolicLink())throw new Error(COOKIE_MIGRATION_FAILED);
   const nativeAuthoritative=(profile==='baidu-session'||profile.startsWith('ai-web-'))&&(fs.existsSync(path.join(folder,'Network','Cookies'))||fs.existsSync(path.join(folder,'Cookies')));
   const local=session.fromPath(folder,{cache:false}),cookies=await local.cookies.get({});
   if(!Array.isArray(cookies))throw new Error(COOKIE_MIGRATION_FAILED);
   // Preserve session-only login after restart before opening an AI page only
   // when its encrypted mirror still agrees with the native persistent cookies.
   // Old mirrors and changed/logout state are never merged back into native data.
   if(nativeAuthoritative){const keepSession=profile.startsWith('ai-web-')&&previousDigest===persistentCookieDigest(cookies.filter(eligible),key);for(const [identity,cookie] of retained)if(!keepSession||cookie.session!==true)retained.delete(identity)}
   // Native persistent cookies override older mirror values for the same cookie identity.
   for(const cookie of cookies)if(eligible(cookie))retained.set(key(cookie),cookie);
   await local.cookies.flushStore();local.flushStorageData();
  }
  const cookies=[...retained.values()];
  // Migration must be complete. Ordinary background mirrors may trim to these bounds;
  // migration instead stops before dropping any eligible existing login cookie.
  if(cookies.length>100)throw new Error(COOKIE_MIGRATION_FAILED);
  const encrypted=safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies,...(profile.startsWith('ai-web-')?{nativeCookieDigest:persistentCookieDigest(cookies,key)}:{})}));
  if(encrypted.length>256*1024)throw new Error(COOKIE_MIGRATION_FAILED);
  const temporary=assertSafeWrite(mirror+'.'+randomUUID()+'.tmp',dataDir,roots);
  try{
   const fd=fs.openSync(temporary,'wx');try{fs.writeFileSync(fd,encrypted);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
   assertSafeWrite(mirror,dataDir,roots);assertSafeWrite(temporary,dataDir,roots);fs.renameSync(temporary,mirror);
  }finally{if(fs.existsSync(temporary)){assertSafeWrite(temporary,dataDir,roots);fs.unlinkSync(temporary)}}
  return {profile,sha256:createHash('sha256').update(encrypted).digest('hex')};
 }catch{throw new Error(COOKIE_MIGRATION_FAILED)}
}
