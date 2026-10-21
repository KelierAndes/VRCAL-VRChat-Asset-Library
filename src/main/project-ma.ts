import {installOwnedHelper} from './project-helper';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import {noLinks,projectWrite,smallFile,validateProject,type ProjectAccess} from './project-access';

/** Separate from file import completion: an MA failure never changes the imported files. */
export interface MaRequest {
 schema:1;id:string;sha256:string;projectPath:string;sourceName:string;
 assemble?:boolean;mode:'copy'|'unitypackage';prefabPaths:string[];sourcePackageName:string;
}
export interface MaResult {
 schema:1;id:string;sha256:string;
 state:'waiting-import'|'waiting-selection'|'applied'|'skipped'|'error';
 message:string;avatarName?:string;prefabPath?:string;menuName?:string;assembly?:boolean;hierarchyPath?:string;
}
const names=['VRCALMASetup.cs','VRCALMASetup.Editor.asmdef'] as const;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hashPattern=/^[a-f0-9]{64}$/i;
const states=new Set(['waiting-import','waiting-selection','applied','skipped','error']);
const projectLocks=new Map<string,Promise<unknown>>();
function validIdentity(value:{id?:unknown;sha256?:unknown}):boolean{return typeof value.id==='string'&&idPattern.test(value.id)&&typeof value.sha256==='string'&&hashPattern.test(value.sha256)}
function validPrefab(value:unknown):value is string {
 return typeof value==='string'&&value.length<=2000&&value.startsWith('Assets/')&&/\.prefab$/i.test(value)
  &&!/[\\:\0]/.test(value)&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}
async function projectAt(projectPath:string):Promise<ProjectAccess>{
 if(typeof projectPath!=='string'||!path.isAbsolute(projectPath))throw new Error('请选择本机 Unity 工程。');
 return validateProject({path:projectPath,kind:'unity-project'} as AssetRecord,[projectPath]);
}
async function serial<T>(projectPath:string,work:()=>Promise<T>):Promise<T>{
 const key=path.resolve(projectPath).toLowerCase(),previous=projectLocks.get(key)??Promise.resolve();
 const current=previous.catch(()=>{}).then(work);projectLocks.set(key,current);
 try{return await current}finally{if(projectLocks.get(key)===current)projectLocks.delete(key)}
}
async function existing(file:string):Promise<string|undefined>{
 try{return await smallFile(file,1024*1024)}catch(error:any){if(error.code==='ENOENT')return undefined;throw error}
}
async function allowed(project:ProjectAccess,file:string):Promise<string>{
 const root=path.join(project.root,'Library','VRCALImportBridge');
 const relative=path.relative(root,file).split(path.sep);
 const exactHelper=names.some(name=>file===path.join(project.assets,'VRCALMASetup','Editor',name));
 if(!exactHelper&&!(relative.length===2&&['MARequests','MAResults'].includes(relative[0])&&/^[a-zA-Z0-9.-]+$/.test(relative[1])))throw new Error('MA 只能访问专用助手与请求目录。');
 return projectWrite(project,file);
}

/** Install exactly our two independent editor files; preflight both so conflicts never partially overwrite a project. */
export async function installMaHelper(projectPath:string,helperSourceDirectory:string):Promise<void>{return installOwnedHelper(projectPath,'VRCALMASetup',helperSourceDirectory)}

function checkedRequest(project:ProjectAccess,value:MaRequest):MaRequest {
 if(!value||value.assemble!==undefined&&typeof value.assemble!=='boolean'||value.schema!==1||!validIdentity(value)||typeof value.projectPath!=='string'||!path.isAbsolute(value.projectPath)
  ||path.resolve(value.projectPath).toLowerCase()!==project.root.toLowerCase()
  ||!['copy','unitypackage'].includes(value.mode)||typeof value.sourceName!=='string'||value.sourceName.length>1000
  ||!Array.isArray(value.prefabPaths)||value.prefabPaths.length>1000||!value.prefabPaths.every(validPrefab)
  ||typeof value.sourcePackageName!=='string'||value.mode==='unitypackage'&&(!/\.unitypackage$/i.test(value.sourcePackageName)
   ||value.sourcePackageName!==path.basename(value.sourcePackageName)||/[\\/:\0]/.test(value.sourcePackageName)))throw new Error('MA 请求的身份、工程或 Prefab 路径无效。');
 // Drop unrecognized keys; never forward arbitrary caller-controlled objects into the editor helper.
 return {schema:1,id:value.id,sha256:value.sha256,projectPath:value.projectPath,sourceName:value.sourceName,
  mode:value.mode,prefabPaths:[...value.prefabPaths],sourcePackageName:value.sourcePackageName,...(value.assemble!==undefined?{assemble:value.assemble}:{})};
}

/** Publish once after explicit opt-in. Copy callers pass the actual copied Assets/*.prefab paths. */
export async function publishMaRequest(projectPath:string,value:MaRequest):Promise<string>{
 return serial(projectPath,async()=>{
  const project=await projectAt(projectPath),request=checkedRequest(project,value);
  if(request.mode==='copy')for(const relative of request.prefabPaths){const file=path.join(project.root,...relative.split('/'));await noLinks(file);if(!(await fsp.lstat(file)).isFile())throw new Error('复制的 Prefab 文件不存在。')}
  const target=await allowed(project,path.join(project.root,'Library/VRCALImportBridge/MARequests',request.id+'.json'));
  const contents=JSON.stringify(request),previous=await existing(target);
  if(previous!==undefined){if(previous!==contents)throw new Error('已有不同身份或内容的 MA 请求，已拒绝覆盖。');return target}
  await fsp.mkdir(path.dirname(target),{recursive:true});await allowed(project,target);
  const temporary=path.join(path.dirname(target),'.ma-'+randomUUID().replaceAll('-','')+'.tmp');
  await allowed(project,temporary);
  try{
   const handle=await fsp.open(temporary,'wx');
   try{await handle.writeFile(contents,'utf8');await handle.sync()}finally{await handle.close()}
   await allowed(project,target);await noLinks(temporary);
   try{await fsp.link(temporary,target)}catch(error:any){if(error.code!=='EEXIST'||await existing(target)!==contents)throw error}
  }finally{await noLinks(temporary,true);await fsp.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
  return target;
 });
}

/** Ignore malformed/foreign receipts. No file import state is read or written here. */
export async function readMaResult(projectPath:string,identity:{id:string;sha256:string}):Promise<MaResult|undefined>{
 if(!identity||!validIdentity(identity))throw new Error('MA 回执身份无效。');
 const project=await projectAt(projectPath),file=await allowed(project,path.join(project.root,'Library/VRCALImportBridge/MAResults',identity.id+'.json'));
 const text=await existing(file);if(text===undefined)return undefined;
 let value:any;try{value=JSON.parse(text)}catch{return undefined}
 if(!value||value.schema!==1||value.id!==identity.id||typeof value.sha256!=='string'||value.sha256.toLowerCase()!==identity.sha256.toLowerCase()
  ||!states.has(value.state)||typeof value.message!=='string'||value.message.length>4000
  ||value.assembly!==undefined&&typeof value.assembly!=='boolean'||value.hierarchyPath!==undefined&&(typeof value.hierarchyPath!=='string'||value.hierarchyPath.length>4000)
  ||['avatarName','menuName'].some(key=>value[key]!=null&&(typeof value[key]!=='string'||value[key].length>1000))
  ||value.prefabPath!=null&&value.prefabPath!==''&&!validPrefab(value.prefabPath))return undefined;
 const result:MaResult={schema:1,id:value.id,sha256:value.sha256,state:value.state,message:value.message};
 if(typeof value.assembly==='boolean')result.assembly=value.assembly;
 for(const key of ['avatarName','prefabPath','menuName','hierarchyPath'] as const)if(typeof value[key]==='string'&&value[key].length>0)result[key]=value[key];
 return result;
}
