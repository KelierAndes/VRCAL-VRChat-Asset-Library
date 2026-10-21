import {cleanProjectChanges} from './project-changes';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {noLinks,type ProjectAccess} from './project-access';
import {isWithin} from './safety';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validImportedPath(value:unknown):value is string {
 return typeof value==='string'&&value.length<=32760&&value.startsWith('Assets/')
  &&!/[\\:\x00-\x1f\x7f-\x9f]/.test(value)
  &&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part));
}
/** A malformed item invalidates the whole batch; never salvage a misleading partial receipt. */
export function cleanImportedPaths(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>10000)return [];
 for(const item of value)if(!validImportedPath(item))return [];
 return [...new Set(value as string[])];
}
/** One useful common location per first Assets child, preserving files directly under Assets. */
export function importLocations(paths:string[]):string[]{
 const groups=new Map<string,string[][]>();
 for(const file of cleanImportedPaths(paths)){const parts=file.split('/'),key=parts[1];const group=groups.get(key);if(group)group.push(parts);else groups.set(key,[parts])}
 return [...groups.values()].map(group=>{
  const common=group[0].slice();for(const parts of group.slice(1)){let length=0;while(length<common.length&&length<parts.length&&common[length]===parts[length])length++;common.length=length}
  return common.join('/');
 });
}
export interface ImportLocationJob {id:string;projectPath:string;mode:string;state:string;destinationContainer?:string;importedAssetPaths?:unknown;projectChanges?:unknown}
/** Resolve only a completed job's recorded locations after checking the current project and filesystem. */
export async function resolveImportLocation(project:ProjectAccess,job:ImportLocationJob,relative:unknown):Promise<string>{
 if(job.state!=='completed'||path.resolve(job.projectPath)!==project.root||!validImportedPath(relative))throw new Error('此导入尚无可定位的工程位置。');
 if(project.assets!==path.join(project.root,'Assets'))throw new Error('工程 Assets 目录无效。');
 await noLinks(project.root);const root=await fsp.lstat(project.root);
 if(!root.isDirectory()||root.dev!==project.device||root.ino!==project.inode)throw new Error('工程目录已变化，请重新选择工程。');
 const target=path.resolve(project.root,relative);if(!isWithin(target,project.assets))throw new Error('只能定位此工程 Assets 内的导入内容。');
 let allowed=false;
 if(job.mode==='unitypackage'){
  const imported=cleanImportedPaths(job.importedAssetPaths);
  const candidates=cleanProjectChanges(job.projectChanges)?.paths.map(p=>p.path)??[];
  allowed=imported.includes(relative)||importLocations(imported).includes(relative)||candidates.includes(relative)||importLocations(candidates).includes(relative);
 }else if(job.mode==='copy'){
  const container=job.destinationContainer;
  allowed=uuid.test(job.id)&&!!container&&path.isAbsolute(container)&&path.dirname(container)===path.join(project.assets,'VRCAL_Imports')
   &&path.basename(container).endsWith('-'+job.id)&&isWithin(target,container);
 }
 if(!allowed)throw new Error('此位置不属于该次导入的已记录结果。');
 await noLinks(target);const current=await fsp.lstat(target);
 if(!current.isFile()&&!current.isDirectory())throw new Error('导入位置已不存在或不是普通文件／文件夹。');
 return target;
}
