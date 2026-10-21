import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import type {ImportSourceChoice,ProjectImportJob,ProjectImportPreview} from '../shared/project-contracts';
import {assertSafeWrite,isWithin} from './safety';
import {noLinks,projectWrite,smallFile,validateProject,type ProjectAccess} from './project-access';
import {commitCopy,copyLocation,fileHash,guidConflicts,sourceManifest,type CopyManifest} from './project-copy';
import {findUnityEditor,launchUnityEditor,type UnityEditor} from './unity-editors';
export {listProjectFiles} from './project-files';

export interface ProjectImportDependencies {
 dataDir:string;roots:()=>string[];getAsset:(id:string)=>AssetRecord|null;
 readRoots?:(asset:AssetRecord)=>string[];selectedEditor?:()=>string|undefined;
 onComplete?:(job:ProjectImportJob)=>void;onChange?:()=>void;
 findEditor?:(version:string)=>Promise<UnityEditor|undefined>;launchEditor?:(executable:string,args:string[])=>Promise<void>;
}
interface Plan {preview:ProjectImportPreview;source:ImportSourceChoice;manifest:CopyManifest;project:ProjectAccess;expires:number;sha256?:string}
const terminal=(state:ProjectImportJob['state'])=>['completed','cancelled','failed'].includes(state);
const BRIDGE='VRCALImportBridge';
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class ProjectImports {
 private plans=new Map<string,Plan>();private history:ProjectImportJob[]=[];private active?:Promise<ProjectImportJob>;private persistTail:Promise<void>=Promise.resolve();private recoverCopies=new Set<string>();private recoverUnity=new Set<string>();
 constructor(private readonly deps:ProjectImportDependencies){
  try{const journal=this.journal();const s=fs.lstatSync(journal);if(!s.isFile()||s.size>2*1024*1024)throw new Error('导入记录文件无效。');const data=JSON.parse(fs.readFileSync(journal,'utf8'));if(!Array.isArray(data))throw new Error('导入记录文件无效。');this.history=data.filter((j:any)=>j&&idPattern.test(j.id)&&typeof j.assetId==='string'&&typeof j.projectId==='string'&&typeof j.projectPath==='string'&&path.isAbsolute(j.projectPath)&&typeof j.sourceName==='string'&&typeof j.sourcePath==='string'&&path.isAbsolute(j.sourcePath)&&['copy','unitypackage'].includes(j.mode)&&['copying','waiting-unity','importing','completed','cancelled','failed'].includes(j.state)).slice(0,100);for(const job of this.history){if(job.state==='copying')this.recoverCopies.add(job.id);else if(job.mode==='unitypackage'&&!terminal(job.state))this.recoverUnity.add(job.id)}}catch(error:any){if(error.code!=='ENOENT')throw error}
 }
 get busy():boolean{return !!this.active}
 async waitIdle():Promise<void>{await this.active?.catch(()=>{});await this.persistTail}
 private journal():string{return assertSafeWrite(path.join(this.deps.dataDir,'project-imports.json'),this.deps.dataDir,this.deps.roots())}
 private async persist():Promise<void>{
  const snapshot=JSON.stringify(this.history.slice(0,100)),file=this.journal();
  this.persistTail=this.persistTail.catch(()=>{}).then(async()=>{const temp=assertSafeWrite(path.join(this.deps.dataDir,'project-imports-'+randomUUID()+'.tmp'),this.deps.dataDir,this.deps.roots());try{await fsp.writeFile(temp,snapshot,{flag:'wx'});await fsp.rename(temp,file)}finally{await fsp.unlink(temp).catch(()=>{})}});await this.persistTail;this.deps.onChange?.();
 }
 private get(id:unknown,project=false):AssetRecord{if(typeof id!=='string')throw new Error('素材或工程选择无效。');const asset=this.deps.getAsset(id);if(!asset||asset.missing||project!==(asset.kind==='unity-project'))throw new Error(project?'请选择已登记的 Unity 工程。':'请选择可用的本地素材。');return asset}
 private async sourceAllowed(asset:AssetRecord,file:string):Promise<void>{const scopes=[...this.deps.roots(),...(this.deps.readRoots?.(asset)??[])];if(!path.isAbsolute(file)||!scopes.some(root=>isWithin(file,root)))throw new Error('素材不在已登记的本地范围内。');await noLinks(file)}
 private async editor(version:string):Promise<UnityEditor|undefined>{return this.deps.findEditor?this.deps.findEditor(version):findUnityEditor(version,this.deps.selectedEditor?.())}
 async sources(assetId:string):Promise<ImportSourceChoice[]>{
  const asset=this.get(assetId),choices=new Map<string,ImportSourceChoice>();
  const add=(file:string,mode:ImportSourceChoice['mode'],name:string)=>{const id=createHash('sha256').update(asset.id+'\0'+file+'\0'+mode).digest('hex');choices.set(id,{id,name,path:file,mode})};
  for(const file of new Set([asset.path,...(asset.members??[]).filter(m=>!m.missing&&m.kind!=='unity-project').map(m=>m.path)])){
   await this.sourceAllowed(asset,file);const stat=await fsp.lstat(file);
   if(stat.isDirectory()){
    add(file,'copy',path.basename(file));const queue=[{file,depth:0}];let inspected=0;
    for(let cursor=0;cursor<queue.length;cursor++){const task=queue[cursor],handle=await fsp.opendir(task.file);try{for await(const entry of handle){if(++inspected>10000)throw new Error('素材目录过大，请选择更具体的本地条目。');if(entry.isSymbolicLink())continue;const child=path.join(task.file,entry.name);if(entry.isFile()&&/\.unitypackage$/i.test(entry.name)){await this.sourceAllowed(asset,child);add(child,'unitypackage',path.relative(file,child))}else if(entry.isDirectory()&&task.depth<4&&!['.git','Library','Temp','node_modules'].includes(entry.name)){await noLinks(child);queue.push({file:child,depth:task.depth+1})}}}finally{await handle.close().catch(()=>{})}}
   }else if(stat.isFile()&&/\.unitypackage$/i.test(file))add(file,'unitypackage',path.basename(file));
   else if(stat.isFile()&&!/\.(?:zip|rar|7z|exe|msi|bat|cmd|ps1|lnk|url)$/i.test(file))add(file,'copy',path.basename(file));
  }
  return [...choices.values()].sort((a,b)=>Number(b.mode==='unitypackage')-Number(a.mode==='unitypackage')||a.name.localeCompare(b.name,'zh-CN'));
 }
 async preview(assetId:string,projectId:string,choiceId:string):Promise<ProjectImportPreview>{
  if(typeof choiceId!=='string')throw new Error('请选择本地素材文件。');const asset=this.get(assetId),project=await validateProject(this.get(projectId,true),this.deps.roots());
  const source=(await this.sources(assetId)).find(c=>c.id===choiceId);if(!source)throw new Error('本地素材文件选择已失效，请重新选择。');
  if(isWithin(source.path,project.root)||isWithin(project.root,source.path))throw new Error('原素材与目标工程路径重叠，不能复制或导入。');
  const manifest=await sourceManifest(source.path),conflicts=source.mode==='copy'?await guidConflicts(manifest,project):[],warnings=[...manifest.warnings];
  let editor:UnityEditor|undefined,sha256:string|undefined;
  if(source.mode==='unitypackage'){
   const handle=await fsp.open(source.path,'r');try{const b=Buffer.alloc(2);await handle.read(b,0,2,0);if(b[0]!==31||b[1]!==139)throw new Error('这不是有效的 Unity gzip 素材包，请核对源文件。')}finally{await handle.close()}
   sha256=await fileHash(source.path);editor=await this.editor(project.version);if(!editor)warnings.push('未找到相同版本的 Unity；可手动打开此工程，再由助手接收导入。');
   warnings.push('素材包将在 Unity 原生窗口确认；首次导入会在此工程添加轻量导入助手。');
  }
  const preview:ProjectImportPreview={token:randomUUID(),assetId:asset.id,projectId,sourceName:source.name,sourcePath:source.path,projectPath:project.root,mode:source.mode,fileCount:source.mode==='copy'?manifest.files.length:1,bytes:source.mode==='copy'?manifest.bytes:manifest.files.find(f=>f.source===source.path)!.size,ready:!conflicts.length,conflicts,warnings,projectVersion:project.version,editorPath:editor?.path,helperRequired:source.mode==='unitypackage'};
  for(const [key,value] of this.plans)if(value.expires<Date.now())this.plans.delete(key);if(this.plans.size>=20)this.plans.delete(this.plans.keys().next().value!);
  this.plans.set(preview.token,{preview,source,manifest,project,expires:Date.now()+10*60*1000,sha256});return structuredClone(preview);
 }
 async execute(token:string):Promise<ProjectImportJob>{
  if(this.active)throw new Error('正在执行导入，请等待当前操作完成。');const plan=this.plans.get(token);this.plans.delete(token);if(!plan||plan.expires<Date.now())throw new Error('导入预览已失效，请重新预览。');
  const operation=this.perform(plan);this.active=operation;try{return await operation}finally{if(this.active===operation)this.active=undefined}
 }
 private async perform(plan:Plan):Promise<ProjectImportJob>{
  const asset=this.get(plan.preview.assetId),project=await validateProject(this.get(plan.preview.projectId,true),this.deps.roots());
  if(project.device!==plan.project.device||project.inode!==plan.project.inode||project.root!==plan.project.root)throw new Error('工程目录已变化，请重新预览。');
  await this.sourceAllowed(asset,plan.source.path);if(!(await this.sources(asset.id)).some(c=>c.id===plan.source.id)||(await sourceManifest(plan.source.path)).signature!==plan.manifest.signature)throw new Error('源文件已变化，请重新预览。');
  await this.refreshJobs();if(this.history.some(j=>j.projectId===plan.preview.projectId&&!terminal(j.state)))throw new Error('此工程已有等待中的导入，请先完成或取消。');
  if(plan.source.mode==='copy'&&(await guidConflicts(plan.manifest,project)).length)throw new Error('工程已有相同 GUID，复制已停止。');
  if(plan.sha256&&await fileHash(plan.source.path)!==plan.sha256)throw new Error('源文件已变化，请重新预览。');
  const p=plan.preview,job:ProjectImportJob={id:randomUUID(),assetId:p.assetId,projectId:p.projectId,sourceName:p.sourceName,sourcePath:p.sourcePath,projectPath:p.projectPath,mode:p.mode,state:p.mode==='copy'?'copying':'waiting-unity',createdAt:new Date().toISOString(),fileCount:p.fileCount,completedFiles:0,bytes:p.bytes,copiedBytes:0,sha256:plan.sha256??plan.manifest.signature};
  if(job.mode==='copy'){const location=copyLocation(project,asset.name,job.id,plan.manifest);job.destinationPath=location.destination;job.destinationContainer=location.container}
  this.history.unshift(job);let committed=false,published=false,temporaryRequest:string|undefined;
  try{
   await this.persist();
   if(job.mode==='copy'){
    job.destinationPath=await commitCopy(plan.manifest,project,asset.name,(files,bytes)=>{job.completedFiles=files;job.copiedBytes=bytes;this.deps.onChange?.()},{id:job.id,sha256:job.sha256!});committed=true;job.state='completed';job.finishedAt=new Date().toISOString();await this.finish(job);
   }else{
    await this.installHelper(project);const requests=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Requests'));await fsp.mkdir(requests,{recursive:true});const request=await projectWrite(project,path.join(requests,job.id+'.json'));
    temporaryRequest=await projectWrite(project,request+'.tmp');await fsp.writeFile(temporaryRequest,JSON.stringify({schema:1,id:job.id,projectPath:project.root,sourcePath:job.sourcePath,sha256:job.sha256}),{flag:'wx'});
    job.message='等待 Unity 载入助手并确认导入。';
    // Save the intent before atomically publishing a request that Unity can claim.
    await this.persist();await projectWrite(project,request);await fsp.rename(temporaryRequest,request);temporaryRequest=undefined;published=true;
    const editor=await this.editor(project.version);if(editor&&!await this.isProjectOpen(project))try{await (this.deps.launchEditor??launchUnityEditor)(editor.path,['-projectPath',project.root])}catch{job.message='Unity 未能启动，请手动打开此工程；导入请求仍保留。'}
   }
   await this.persist();return structuredClone(job);
  }catch(error){
   if(temporaryRequest)try{await projectWrite(project,temporaryRequest);await fsp.unlink(temporaryRequest)}catch{/* An unpublished .tmp request is never executed by Unity. */}
   if(committed||published){job.message=committed?'文件已复制完成，但资料库记录暂未保存；请勿重复导入。':'请求已交给 Unity，但进度记录暂未保存；请勿重复导入。';try{await this.persist()}catch{/* The pre-commit journal and project-side receipt allow later reconciliation. */}return structuredClone(job)}
   job.state='failed';job.message=error instanceof Error?error.message:'导入未完成。';job.finishedAt=new Date().toISOString();try{await this.persist()}catch{/* No executable request or committed copy exists. */}throw error;
  }
 }
 private async finish(job:ProjectImportJob):Promise<void>{if(!job.linked){this.deps.onComplete?.(structuredClone(job));job.linked=true}}
 private async isProjectOpen(project:ProjectAccess):Promise<boolean>{try{await noLinks(path.join(project.root,'Temp','UnityLockfile'));return (await fsp.lstat(path.join(project.root,'Temp','UnityLockfile'))).isFile()}catch{return false}}
 private async installHelper(project:ProjectAccess):Promise<void>{
  const root=await projectWrite(project,path.join(project.assets,BRIDGE)),editor=await projectWrite(project,path.join(root,'Editor'));
  const names=['VRCALImportBridge.cs','VRCALImportBridge.Editor.asmdef'],bundle=path.resolve(__dirname,'../../../assets/unity');
  const files=await Promise.all(names.map(name=>fsp.readFile(path.join(bundle,name))));
  try{await fsp.lstat(editor);for(let i=0;i<names.length;i++){await noLinks(path.join(editor,names[i]));if(!(await fsp.readFile(path.join(editor,names[i]))).equals(files[i]))throw new Error('工程已有不同的导入助手文件，未覆盖。')}return}catch(error:any){if(error.code!=='ENOENT')throw error;try{await fsp.lstat(editor);throw new Error('工程已有不完整的导入助手，未覆盖。')}catch(check:any){if(check.code!=='ENOENT')throw check}}
  await fsp.mkdir(root,{recursive:true});const stage=await projectWrite(project,path.join(root,'.stage-'+randomUUID()));await fsp.mkdir(stage);try{for(let i=0;i<names.length;i++)await fsp.writeFile(await projectWrite(project,path.join(stage,names[i])),files[i],{flag:'wx'});await projectWrite(project,editor);await fsp.rename(stage,editor)}catch(error){await projectWrite(project,stage);await fsp.rm(stage,{recursive:true,force:true});throw error}
 }
 private async refreshJobs():Promise<void>{
  let changed=false;
  for(const job of this.history){
   if(job.state==='completed'&&!job.linked)try{await this.finish(job);changed=true}catch{/* Metadata can be retried without reimporting files. */}
   if(terminal(job.state))continue;const record=this.deps.getAsset(job.projectId);if(!record||record.path!==job.projectPath||record.kind!=='unity-project')continue;
   if(job.mode==='copy'){
    if(!this.recoverCopies.has(job.id))continue;
    try{const project=await validateProject(record,this.deps.roots()),container=job.destinationContainer;if(!container||path.dirname(container)!==path.join(project.assets,'VRCAL_Imports')||!path.basename(container).endsWith('-'+job.id))throw new Error('导入目标无效。');await projectWrite(project,container);const receipt=JSON.parse(await smallFile(path.join(container,'.vrcal-import.json'),65536));if(receipt.schema!==1||receipt.id!==job.id||receipt.sha256!==job.sha256||receipt.state!=='completed'||receipt.destinationPath!==job.destinationPath)throw new Error('导入回执无效。');job.state='completed';job.completedFiles=job.fileCount;job.copiedBytes=job.bytes;job.finishedAt=new Date().toISOString()}catch{job.state='failed';job.message='上次复制未完成，请重新预览后重试。'}
    if(job.state==='completed')try{await this.finish(job)}catch{job.message='文件已复制完成，素材关联稍后重试；请勿重复导入。'}
    this.recoverCopies.delete(job.id);changed=true;continue;
   }
   try{
    const project=await validateProject(record,this.deps.roots()),file=path.join(project.root,'Library',BRIDGE,'Results',job.id+'.json');await projectWrite(project,file);
    let receipt:any;
    try{receipt=JSON.parse(await smallFile(file,65536))}catch{/* A receipt may not exist yet. */}
    if(receipt?.schema===1&&receipt.id===job.id&&receipt.sha256===job.sha256&&['importing','completed','failed','cancelled'].includes(receipt.state)){
     if(job.state!==receipt.state){job.state=receipt.state;job.message=typeof receipt.message==='string'?receipt.message.slice(0,2000):undefined;if(terminal(job.state))job.finishedAt=new Date().toISOString();changed=true}
     if(job.state==='completed'){job.completedFiles=job.fileCount;job.copiedBytes=job.bytes;try{await this.finish(job);changed=true}catch{job.message='Unity 已导入完成，素材关联稍后重试；请勿重复导入。';changed=true}}
     this.recoverUnity.delete(job.id);continue;
    }
    const request=path.join(project.root,'Library',BRIDGE,'Requests',job.id+'.json');
    await projectWrite(project,request);
    let cancelled:any;
    try{cancelled=JSON.parse(await smallFile(request+'.cancelled',65536))}catch{/* Only a matching cancellation marker is authoritative. */}
    if(cancelled?.schema===1&&cancelled.id===job.id&&cancelled.sha256===job.sha256&&cancelled.projectPath===project.root){job.state='cancelled';job.finishedAt=new Date().toISOString();changed=true;this.recoverUnity.delete(job.id);continue}
    if(this.recoverUnity.has(job.id)){
     let published=false;
     for(const candidate of [request,request+'.claimed'])try{await noLinks(candidate);if((await fsp.lstat(candidate)).isFile())published=true}catch(error:any){if(error.code!=='ENOENT')throw error}
     if(!published){job.state='failed';job.message='上次请求尚未提交到 Unity，请重新预览后重试。';job.finishedAt=new Date().toISOString();changed=true}
     this.recoverUnity.delete(job.id);
    }
   }catch{/* Missing, malformed, linked or unavailable receipts never imply successful import. */}
  }
  if(changed)await this.persist();
 }
 async jobs(projectId?:string):Promise<ProjectImportJob[]>{await this.refreshJobs();return structuredClone(this.history.filter(j=>!projectId||j.projectId===projectId).slice(0,100))}
 async cancel(id:string):Promise<boolean>{
  if(!idPattern.test(id))throw new Error('导入任务无效。');await this.refreshJobs();const job=this.history.find(j=>j.id===id);if(!job||job.mode!=='unitypackage'||job.state!=='waiting-unity')return false;
  const project=await validateProject(this.get(job.projectId,true),this.deps.roots()),request=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Requests',id+'.json'));
  try{await fsp.rename(request,await projectWrite(project,request+'.cancelled'))}catch(error:any){if(error.code==='ENOENT'){job.message='Unity 正在处理，请在 Unity 原生窗口取消。';await this.persist();return false}throw error}
  job.state='cancelled';job.finishedAt=new Date().toISOString();try{await this.persist()}catch{job.message='请求已取消，进度记录稍后保存。'}return true;
 }
 async openProject(id:string):Promise<void>{const project=await validateProject(this.get(id,true),this.deps.roots()),editor=await this.editor(project.version);if(!editor)throw new Error('未找到相同版本的 Unity，请选择编辑器或手动打开工程。');if(!await this.isProjectOpen(project))await (this.deps.launchEditor??launchUnityEditor)(editor.path,['-projectPath',project.root])}
}
