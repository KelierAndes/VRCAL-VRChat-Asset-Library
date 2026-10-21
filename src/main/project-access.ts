import fsp from 'node:fs/promises';
import path from 'node:path';
import type {AssetRecord} from '../shared/contracts';
import type {ProjectFilePage} from '../shared/project-contracts';
import {isWithin} from './safety';

export async function noLinks(file:string,missing=false):Promise<void>{
 if(!path.isAbsolute(file)||file.includes('\0')||process.platform==='win32'&&(file.startsWith('\\\\')||file.includes(':',3)))throw new Error('请选择本机普通文件或文件夹。');
 for(let cursor=path.resolve(file);;cursor=path.dirname(cursor)){
  try{if((await fsp.lstat(cursor)).isSymbolicLink())throw new Error('路径包含文件或目录链接，已拒绝操作。')}catch(error:any){if(!missing||!['ENOENT','ENOTDIR'].includes(error.code))throw error}
  if(path.dirname(cursor)===cursor)break;
 }
}
export async function smallFile(file:string,max=1024*1024):Promise<string>{await noLinks(file);const stat=await fsp.lstat(file);if(!stat.isFile()||stat.size>max)throw new Error('工程说明或 meta 文件过大，无法安全读取。');return fsp.readFile(file,'utf8')}
export interface ProjectAccess {root:string;assets:string;version:string;packages:ProjectFilePage['packages'];device:number;inode:number}
export async function validateProject(project:AssetRecord,roots:string[]):Promise<ProjectAccess>{
 if(project.kind!=='unity-project'||!path.isAbsolute(project.path)||!roots.some(root=>path.isAbsolute(root)&&isWithin(project.path,root)))throw new Error('请选择已登记的 Unity 工程。');
 await noLinks(project.path);const stat=await fsp.lstat(project.path);if(!stat.isDirectory())throw new Error('工程目录不存在。');
 const root=path.resolve(project.path),assets=path.join(root,'Assets');
 for(const part of ['Assets','Packages','ProjectSettings']){const file=path.join(root,part);await noLinks(file);if(!(await fsp.lstat(file)).isDirectory())throw new Error('请选择包含 Assets、Packages 和 ProjectSettings 的 Unity 工程。')}
 let version='',packages:ProjectAccess['packages']=[];
 try{version=(await smallFile(path.join(root,'ProjectSettings','ProjectVersion.txt'),65536)).match(/^m_EditorVersion:\s*(\S+)/m)?.[1]??''}catch(error:any){if(error.code!=='ENOENT')throw error}
 try{const manifest=JSON.parse(await smallFile(path.join(root,'Packages','manifest.json')));if(manifest.dependencies&&typeof manifest.dependencies==='object')packages=Object.entries(manifest.dependencies).filter(([name,value])=>typeof value==='string'&&name.length<=300).slice(0,1000).map(([name,version])=>({name,version:String(version).slice(0,2000)}))}catch(error:any){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error}
 return {root,assets,version,packages,device:stat.dev,inode:stat.ino};
}
export function relativeAssetPath(root:string,relative:unknown):string {
 if(typeof relative!=='string'||relative.length>32760||relative.includes('\0')||/[:]/.test(relative)||/^[\\/]/.test(relative)||relative.replaceAll('\\','/').split('/').some(p=>p==='..'))throw new Error('工程内相对路径无效。');
 const file=path.resolve(root,relative);if(!isWithin(file,root))throw new Error('只能读取此工程 Assets 内的文件。');return file;
}
/** A narrow exception for an explicit import; the global source-directory write guard stays unchanged. */
export async function projectWrite(project:ProjectAccess,file:string):Promise<string>{
 const allowed=[path.join(project.assets,'VRCAL_Imports'),path.join(project.assets,'VRCALImportBridge'),path.join(project.root,'Library','VRCALImportBridge')];
 if(!allowed.some(root=>isWithin(file,root)))throw new Error('导入只能写入当前工程的专用目录。');
 await noLinks(project.root);const stat=await fsp.lstat(project.root);if(stat.dev!==project.device||stat.ino!==project.inode)throw new Error('工程目录已变化，请重新选择工程。');
 await noLinks(file,true);return path.resolve(file);
}
