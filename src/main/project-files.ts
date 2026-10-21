import fsp from 'node:fs/promises';
import path from 'node:path';
import type {AssetRecord} from '../shared/contracts';
import type {ProjectFileKind,ProjectFilePage} from '../shared/project-contracts';
import {noLinks,relativeAssetPath,validateProject} from './project-access';

function kind(name:string):ProjectFileKind{const ext=path.extname(name).toLowerCase();return ext==='.prefab'?'prefab':/\.(fbx|blend|vrm|obj|gltf|glb|dae)$/.test(ext)?'model':/\.(png|jpg|jpeg|webp|psd|tga|exr|hdr|tif|tiff)$/.test(ext)?'texture':ext==='.mat'?'material':/\.(anim|controller|overridecontroller)$/.test(ext)?'animation':/\.(cs|dll|asmdef|shader|hlsl|cginc)$/.test(ext)?'script':'other'}
export async function listProjectFiles(project:AssetRecord,roots:string[],relative='',offset=0):Promise<ProjectFilePage>{
 if(!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('工程文件分页参数无效。');
 const access=await validateProject(project,roots),folder=relativeAssetPath(access.assets,relative);await noLinks(folder);if(!(await fsp.lstat(folder)).isDirectory())throw new Error('请选择工程内的文件夹。');
 const entries:ProjectFilePage['entries']=[],warnings:string[]=[];let truncated=false,links=0;const handle=await fsp.opendir(folder);
 try{for await(const entry of handle){if(entries.length>=10000){truncated=true;break}if(entry.isSymbolicLink()){links++;continue}if(entry.name.endsWith('.meta')||entry.name.startsWith('.'))continue;if(!entry.isDirectory()&&!entry.isFile())continue;const file=path.join(folder,entry.name);await noLinks(file);const stat=await fsp.lstat(file);entries.push({name:entry.name,relativePath:path.relative(access.assets,file).split(path.sep).join('/'),directory:entry.isDirectory(),kind:entry.isDirectory()?'directory':kind(entry.name),size:stat.isFile()?stat.size:0})}}
 finally{await handle.close().catch(()=>{})}
 if(links)warnings.push('已跳过文件或目录链接。');if(truncated)warnings.push('当前文件夹条目较多，已达到显示上限。');
 entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
 return {projectId:project.id,relativePath:path.relative(access.assets,folder).split(path.sep).join('/'),entries:entries.slice(offset,offset+200),total:entries.length,offset,hasMore:offset+200<entries.length,truncated,warnings,projectVersion:access.version,packages:access.packages};
}
