import fsp from 'node:fs/promises';
import path from 'node:path';
import type {ProjectChanges} from '../shared/project-contracts';
import {noLinks,type ProjectAccess} from './project-access';
import {cleanImportedPaths,validImportedPath} from './project-locations';

interface Entry {path:string;directory:boolean;size:number;mtimeMs:number;ctimeMs:number}
export interface AssetSnapshot {
 schema:1;root:string;device:number;inode:number;startedAt:string;checkedAt:string;
 complete:boolean;entries:Entry[];
}
const helpers=new Set(['vrcalimportbridge','vrcalmasetup']);
const numeric=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function validSnapshot(s:AssetSnapshot):boolean {
 return s?.schema===1&&typeof s.root==='string'&&path.isAbsolute(s.root)&&numeric(s.device)&&numeric(s.inode)
  &&date(s.startedAt)&&date(s.checkedAt)&&typeof s.complete==='boolean'&&Array.isArray(s.entries)&&s.entries.length<=100000
  &&s.entries.every(e=>e&&typeof e.directory==='boolean'&&numeric(e.size)&&numeric(e.mtimeMs)&&numeric(e.ctimeMs))
  &&s.entries.every(e=>validImportedPath(e.path))&&new Set(s.entries.map(e=>e.path)).size===s.entries.length;
}
/** Metadata only: never extract packages, edit AssetDatabase, or traverse directory links. */
export async function snapshotAssets(project:Pick<ProjectAccess,'root'|'assets'|'device'|'inode'>,options:{maxEntries?:number;maxMs?:number}={}):Promise<AssetSnapshot>{
 const verify=async()=>{await noLinks(project.root);const s=await fsp.lstat(project.root);if(!s.isDirectory()||s.dev!==project.device||s.ino!==project.inode||project.assets!==path.join(project.root,'Assets'))throw new Error('工程目录已变化，请重新选择工程。');await noLinks(project.assets)};
 await verify();const start=Date.now(),result:AssetSnapshot={schema:1,root:project.root,device:project.device,inode:project.inode,startedAt:new Date(start).toISOString(),checkedAt:'',complete:true,entries:[]};
 const limit=Math.max(1,Math.min(100000,options.maxEntries??100000)),deadline=start+Math.max(1,Math.min(20000,options.maxMs??20000));
 const queue=[project.assets];let visited=0,bytes=0;
 outer:for(let cursor=0;cursor<queue.length;cursor++){
  const folder=queue[cursor];let handle;
  try{
   await noLinks(folder);handle=await fsp.opendir(folder);
   for await(const entry of handle){
    if(++visited>limit||Date.now()>deadline||bytes>24*1024*1024){result.complete=false;break outer}
    if(entry.isSymbolicLink()||/\.meta$/i.test(entry.name)||folder===project.assets&&helpers.has(entry.name.toLowerCase()))continue;
    const file=path.join(folder,entry.name),relative=path.relative(project.root,file).split(path.sep).join('/');
    if(!cleanImportedPaths([relative]).length){result.complete=false;continue}
    try{
     const stat=await fsp.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())continue;
     result.entries.push({path:relative,directory:stat.isDirectory(),size:stat.isDirectory()?0:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});bytes+=Buffer.byteLength(relative)+160;
     if(stat.isDirectory())queue.push(file);
    }catch{result.complete=false}
   }
  }catch{result.complete=false}
  finally{await handle?.close().catch(()=>{})}
 }
 await verify();result.checkedAt=new Date().toISOString();return result;
}
function bounded(basis:ProjectChanges['basis'],snapshot:AssetSnapshot,paths:ProjectChanges['paths'],complete:boolean):ProjectChanges {
 const kept:ProjectChanges['paths']=[],directories=new Set(snapshot.entries.filter(e=>e.directory).map(e=>e.path));let bytes=2;
 paths.sort((a,b)=>Number(directories.has(a.path))-Number(directories.has(b.path))||a.path.localeCompare(b.path));
 for(const entry of paths){const size=Buffer.byteLength(JSON.stringify(entry))+1;if(kept.length>=1000||bytes+size>128*1024)break;kept.push(entry);bytes+=size}
 return {basis,checkedAt:snapshot.checkedAt,complete:complete&&kept.length===paths.length,total:paths.length,paths:kept};
}
export function compareAssets(before:AssetSnapshot,after:AssetSnapshot):ProjectChanges {
 if(!validSnapshot(before)||!validSnapshot(after)||before.root!==after.root||before.device!==after.device||before.inode!==after.inode)throw new Error('工程对比清单无效，请重新选择工程。');
 const previous=new Map(before.entries.map(e=>[e.path,e])),changes:ProjectChanges['paths']=[];
 for(const e of after.entries){const old=previous.get(e.path);
  if(!old){if(before.complete)changes.push({path:e.path,kind:'added'})}
  else if(e.directory!==old.directory||!e.directory&&(old.size!==e.size||old.mtimeMs!==e.mtimeMs||old.ctimeMs!==e.ctimeMs))changes.push({path:e.path,kind:'modified'});
 }
 return bounded('before-after',after,changes,before.complete&&after.complete);
}
export function recentAssets(snapshot:AssetSnapshot,createdAt:string,finishedAt:string):ProjectChanges {
 if(!validSnapshot(snapshot)||!date(createdAt)||!date(finishedAt)||Date.parse(finishedAt)<Date.parse(createdAt))throw new Error('导入时间无效，无法查找近期位置。');
 // A missing baseline can only produce time hints. A long interrupted import is capped at 24 hours.
 const end=Date.parse(finishedAt)+2000,start=Math.max(Date.parse(createdAt)-2000,end-24*60*60*1000);
 return bounded('time-window',snapshot,snapshot.entries.filter(e=>!e.directory&&e.mtimeMs>=start&&e.mtimeMs<=end).map(e=>({path:e.path,kind:'recent'})),false);
}
export function cleanProjectChanges(value:unknown):ProjectChanges|undefined {
 const v=value as ProjectChanges;if(!v||!['before-after','time-window'].includes(v.basis)||!date(v.checkedAt)||typeof v.complete!=='boolean'||!Number.isSafeInteger(v.total)||v.total<0||!Array.isArray(v.paths)||v.paths.length>1000||v.total<v.paths.length)return;
 if(!v.paths.every(p=>p&&['added','modified','recent'].includes(p.kind))||cleanImportedPaths(v.paths.map(p=>p.path)).length!==v.paths.length||Buffer.byteLength(JSON.stringify(v.paths))>128*1024)return;
 return {basis:v.basis,checkedAt:v.checkedAt,complete:v.basis==='before-after'&&v.complete,total:v.total,paths:v.paths.map(p=>({path:p.path,kind:p.kind}))};
}
