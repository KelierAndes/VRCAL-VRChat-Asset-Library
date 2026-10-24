import path from 'node:path';
import {smallFile,type ProjectAccess} from './project-access';
import type {ProjectReadiness,ProjectDependencyEvidence} from '../shared/avatar-workbench';

const DEPENDENCIES=[['com.vrchat.avatars','VRChat Avatar SDK'],['nadena.dev.modular-avatar','Modular Avatar'],['nadena.dev.ndmf','NDMF']] as const;

/** Read only these public dependencies. Do not enumerate Assets or evaluate package code. */
export async function readProjectReadiness(project:ProjectAccess,projectId=''):Promise<ProjectReadiness> {
  const notes:string[]=[],documents=new Map<string,any>();
  const read=async(relative:string):Promise<any>=>{
    try{const value=JSON.parse(await smallFile(path.join(project.root,relative),1024*1024));return value&&typeof value==='object'&&!Array.isArray(value)?value:undefined}
    catch(e:any){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')notes.push(`${relative} 无法核对，未将它当作有效依赖证据。`);return undefined}
  };
  for(const name of ['vpm-manifest.json','packages-lock.json'])documents.set(name,await read('Packages/'+name));
  const dependencies:ProjectDependencyEvidence[]=[];
  for(const [id,label] of DEPENDENCIES){
    const vpm=documents.get('vpm-manifest.json')?.dependencies?.[id],lock=documents.get('packages-lock.json')?.dependencies?.[id];
    const declared=project.packages.find(p=>p.name===id)?.version||(typeof vpm?.version==='string'?vpm.version:undefined)||(typeof lock?.version==='string'?lock.version:undefined);
    const item:ProjectDependencyEvidence={id,label,state:declared?'declared':'unknown',version:declared?.slice(0,100)};
    const candidates=['Packages/'+id+'/package.json'];
    // A lock-pinned registry cache path may be inspected, never arbitrary file: or URL paths.
    if(typeof lock?.version==='string'&&/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(lock.version))candidates.push(`Library/PackageCache/${id}@${lock.version}/package.json`);
    for(const relative of candidates){const pkg=await read(relative);if(pkg?.name===id&&typeof pkg.version==='string'&&pkg.version.length<=100){item.state='files-found';item.version=pkg.version;item.evidence=relative;break}}
    dependencies.push(item);
  }
  return {projectId,checkedAt:new Date().toISOString(),unityVersion:project.version,dependencies,notes:[...new Set(notes)]};
}
