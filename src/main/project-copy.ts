import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {GuidConflict} from '../shared/project-contracts';
import {isWithin} from './safety';
import {noLinks,projectWrite,smallFile,type ProjectAccess} from './project-access';

export interface CopyEntry {source:string;relative:string;size:number;mtimeMs:number;dev:number;ino:number;guid?:string}
export interface CopyManifest {source:string;folder:boolean;files:CopyEntry[];directories:string[];bytes:number;signature:string;warnings:string[]}
const SKIP=new Set(['.git','.svn','node_modules','Library','Temp','Logs','obj']);
export async function fileHash(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function entry(file:string,relative:string):Promise<CopyEntry>{await noLinks(file);const s=await fsp.lstat(file);if(!s.isFile())throw new Error('素材包含非普通文件，无法复制。');let guid:string|undefined;if(file.toLowerCase().endsWith('.meta')){const text=await smallFile(file,4*1024*1024);guid=text.match(/^guid:\s*([a-fA-F0-9]{32})\s*$/m)?.[1].toLowerCase();if(!guid)throw new Error('素材 meta 文件缺少有效 GUID，无法保证引用。')}return {source:file,relative,size:s.size,mtimeMs:s.mtimeMs,dev:s.dev,ino:s.ino,guid}}
export async function sourceManifest(source:string):Promise<CopyManifest>{
 await noLinks(source);const stat=await fsp.lstat(source),folder=stat.isDirectory();if(!folder&&!stat.isFile())throw new Error('请选择普通文件或文件夹。');
 const files:CopyEntry[]=[],directories:string[]=[],warnings:string[]=[],started=Date.now();let inspected=0;
 const add=async(file:string,relative:string)=>{const next=await entry(file,relative);files.push(next);};
 if(folder){
  const prefix=path.basename(source),queue=[{file:source,relative:prefix,depth:0}];
  for(let cursor=0;cursor<queue.length;cursor++){
   const task=queue[cursor];if(task.depth>48||Date.now()-started>30000)throw new Error('素材过大或目录过深，未写入工程。');await noLinks(task.file);directories.push(task.relative);
   const handle=await fsp.opendir(task.file);try{for await(const item of handle){if(++inspected>50000)throw new Error('素材文件超过检查上限，未写入工程。');if(item.isSymbolicLink())throw new Error('素材包含文件或目录链接，未写入工程。');if(item.isDirectory()&&SKIP.has(item.name))continue;const file=path.join(task.file,item.name),relative=path.join(task.relative,item.name);if(item.isDirectory())queue.push({file,relative,depth:task.depth+1});else if(item.isFile())await add(file,relative);else throw new Error('素材包含非普通文件，无法复制。')}}finally{await handle.close().catch(()=>{})}
  }
  try{await add(source+'.meta',prefix+'.meta')}catch(error:any){if(error.code!=='ENOENT')throw error}
 }else{await add(source,path.basename(source));if(!source.toLowerCase().endsWith('.meta'))try{await add(source+'.meta',path.basename(source)+'.meta')}catch(error:any){if(error.code!=='ENOENT')throw error}}
 const bytes=files.reduce((sum,f)=>sum+f.size,0);if(bytes>64*1024*1024*1024)throw new Error('素材超过 64 GB，未写入工程。');
 if(files.some(f=>/\.unitypackage$/i.test(f.source)))warnings.push('复制文件夹不会展开其中的 Unity 素材包；需要导入内容时，请选择具体素材包。');
 const signature=createHash('sha256').update(JSON.stringify({files:files.slice().sort((a,b)=>a.relative.localeCompare(b.relative)),directories:directories.slice().sort()})).digest('hex');
 return {source,folder,files,directories,bytes,signature,warnings};
}
export async function guidConflicts(manifest:CopyManifest,project:ProjectAccess):Promise<GuidConflict[]>{
 const wanted=new Map<string,string>(),conflicts:GuidConflict[]=[];
 for(const file of manifest.files)if(file.guid){const prior=wanted.get(file.guid);if(prior)conflicts.push({guid:file.guid,source:file.source,target:prior});else wanted.set(file.guid,file.source)}
 if(!wanted.size)return conflicts;
 const roots=[project.assets,path.join(project.root,'Packages')],cache=path.join(project.root,'Library','PackageCache');
 try{await noLinks(cache);if((await fsp.lstat(cache)).isDirectory())roots.push(cache)}catch(error:any){if(error.code!=='ENOENT')throw error}
 for(const dependency of project.packages)if(dependency.version.startsWith('file:')){
  const raw=dependency.version.slice(5);let decoded:string;try{decoded=decodeURIComponent(raw)}catch{throw new Error('工程本地包路径无效，无法完整核对 GUID。')}
  const local=path.resolve(project.root,'Packages',decoded);if(!isWithin(local,project.root))throw new Error('工程引用了工程外的本地包，请用 Unity 原生导入以核对 GUID。');
  await noLinks(local);if((await fsp.lstat(local)).isDirectory()&&!roots.some(root=>isWithin(local,root)))roots.push(local);
 }
 const queue=roots.map(file=>({file,depth:0})),started=Date.now();let count=0;
 for(let cursor=0;cursor<queue.length;cursor++){
  const task=queue[cursor];if(task.depth>48||Date.now()-started>30000)throw new Error('工程 GUID 检查达到上限，未写入工程。');await noLinks(task.file);
  const handle=await fsp.opendir(task.file);try{for await(const item of handle){if(++count>150000)throw new Error('工程 GUID 检查达到上限，未写入工程。');if(item.isSymbolicLink())throw new Error('工程包含目录或文件链接，无法完整核对 GUID。');if(item.name.startsWith('.'))continue;const file=path.join(task.file,item.name);if(item.isDirectory())queue.push({file,depth:task.depth+1});else if(item.isFile()&&item.name.toLowerCase().endsWith('.meta')){const guid=(await smallFile(file,4*1024*1024)).match(/^guid:\s*([a-fA-F0-9]{32})\s*$/m)?.[1].toLowerCase();if(guid&&wanted.has(guid)&&conflicts.length<100)conflicts.push({guid,source:wanted.get(guid)!,target:file})}}}finally{await handle.close().catch(()=>{})}
 }
 return conflicts;
}
export function copyLocation(project:ProjectAccess,label:string,id:string,manifest:CopyManifest):{container:string;destination:string}{
 const safe=Array.from(label.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'')).slice(0,64).join('')||'Asset',container=path.join(project.assets,'VRCAL_Imports',safe+'-'+id);
 return {container,destination:manifest.folder?path.join(container,path.basename(manifest.source)):container};
}
export async function commitCopy(manifest:CopyManifest,project:ProjectAccess,label:string,onProgress:(files:number,bytes:number)=>void,receipt:{id:string;sha256:string}):Promise<string>{
 const base=await projectWrite(project,path.join(project.assets,'VRCAL_Imports'));await fsp.mkdir(base,{recursive:true});
 const id=receipt.id,location=copyLocation(project,label,id,manifest);
 const stage=await projectWrite(project,path.join(base,'.stage-'+id)),destination=await projectWrite(project,location.container);await fsp.mkdir(stage);const owned=await fsp.lstat(stage);
 try{
  for(const dir of manifest.directories){const target=path.join(stage,dir);if(!isWithin(target,stage))throw new Error('素材内部路径无效。');await projectWrite(project,target);await fsp.mkdir(target,{recursive:true})}
  let completed=0,bytes=0;
  for(const file of manifest.files){
   await noLinks(file.source);const current=await fsp.lstat(file.source);if(!current.isFile()||current.dev!==file.dev||current.ino!==file.ino||current.size!==file.size||current.mtimeMs!==file.mtimeMs)throw new Error('源文件已变化，请重新预览。');
   const target=path.join(stage,file.relative);if(!isWithin(target,stage))throw new Error('素材内部路径无效。');await projectWrite(project,target);await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.copyFile(file.source,target,fs.constants.COPYFILE_EXCL);
   await noLinks(file.source);const after=await fsp.lstat(file.source);if(after.dev!==file.dev||after.ino!==file.ino||after.size!==file.size||after.mtimeMs!==file.mtimeMs||await fileHash(file.source)!==await fileHash(target))throw new Error('复制时源文件已变化，请重新预览。');
   onProgress(++completed,bytes+=file.size);
  }
  if((await sourceManifest(manifest.source)).signature!==manifest.signature)throw new Error('源文件已变化，请重新预览。');
  if((await guidConflicts(manifest,project)).length)throw new Error('工程已有相同 GUID，复制已停止。');
  // The receipt commits with the files, so a later database/journal error cannot erase the actual copy outcome.
  await fsp.writeFile(await projectWrite(project,path.join(stage,'.vrcal-import.json')),JSON.stringify({schema:1,id:receipt.id,sha256:receipt.sha256,state:'completed',destinationPath:location.destination}),{flag:'wx'});
  await projectWrite(project,destination);try{await fsp.lstat(destination);throw new Error('目标目录已存在，未覆盖已有文件。')}catch(error:any){if(error.code!=='ENOENT')throw error}
  await fsp.rename(stage,destination);return location.destination;
 }catch(error){
  // Only this operation's still-owned staging directory is removed.
  await projectWrite(project,stage);const current=await fsp.lstat(stage);if(current.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())await fsp.rm(stage,{recursive:true,force:true});throw error;
 }
}
