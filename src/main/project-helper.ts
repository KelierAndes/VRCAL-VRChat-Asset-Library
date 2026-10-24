import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import {noLinks,projectWrite,smallFile,validateProject,type ProjectAccess} from './project-access';

type Kind='VRCALImportBridge'|'VRCALMASetup';
const locks=new Map<string,Promise<void>>();
async function read(file:string):Promise<string|undefined>{try{return await smallFile(file,1024*1024)}catch(e:any){if(e.code==='ENOENT')return undefined;throw e}}
async function replace(project:ProjectAccess,file:string,content:string,previous:string|undefined):Promise<void>{
 const temporary=await projectWrite(project,path.join(path.dirname(file),'.vrcal-'+randomUUID().replaceAll('-','').slice(0,16)+'.tmp'));
 try{
  await fsp.writeFile(temporary,content,{encoding:'utf8',flag:'wx'});await projectWrite(project,file);
  if(await read(file)!==previous)throw new Error('助手文件在安装期间已变化，未覆盖。');
  if(previous===undefined)await fsp.link(temporary,file);else await fsp.rename(temporary,file);
 }finally{await projectWrite(project,temporary);await fsp.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
/** Upgrade only byte-identical shipped predecessors. Custom files and Unity .meta files remain untouched. */
export async function installOwnedHelper(projectPath:string,kind:Kind,bundle:string):Promise<void>{
 if(!['VRCALImportBridge','VRCALMASetup'].includes(kind))throw new Error('工程助手类型无效。');
 const key=path.resolve(projectPath).toLowerCase()+'\0'+kind,previous=locks.get(key)??Promise.resolve();
 const pending=previous.catch(()=>{}).then(async()=>{
  const project=await validateProject({path:projectPath,kind:'unity-project'} as AssetRecord,[projectPath]);
  const editor=await projectWrite(project,path.join(project.assets,kind,'Editor')),files:{file:string;content:string;previous:string|undefined}[]=[];
  for(const name of [kind+'.cs',kind+'.Editor.asmdef']){
   const source=path.join(bundle,name);await noLinks(source);const content=await smallFile(source,1024*1024),file=await projectWrite(project,path.join(editor,name)),old=await read(file);
   const legacy:string[]=[];if(name.endsWith('.cs'))for(const version of ['v1','v2','v3']){const bytes=await read(path.join(bundle,'legacy',kind+'.'+version+'.cs.txt'));if(bytes!==undefined)legacy.push(bytes)}
   if(old!==undefined&&old!==content&&!legacy.includes(old))throw new Error('工程已有不同的助手文件，已保留原文件，请先核对。');
   files.push({file,content,previous:old});
  }
  await fsp.mkdir(editor,{recursive:true});const changed:typeof files=[];
  try{for(const file of files){if(file.previous===file.content)continue;await replace(project,file.file,file.content,file.previous);changed.push(file)}}
  catch(error){for(const file of changed.reverse())try{await projectWrite(project,file.file);if(await read(file.file)!==file.content)continue;if(file.previous===undefined)await fsp.unlink(file.file);else await replace(project,file.file,file.previous,file.content)}catch{/* Only revert still-owned bytes; retain the original error. */}throw error}
 });locks.set(key,pending);try{await pending}finally{if(locks.get(key)===pending)locks.delete(key)}
}
