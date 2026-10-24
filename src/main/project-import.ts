import {readProjectReadiness} from './project-readiness';
import {cleanImportReview,type ImportCheck,type ImportReviewPatch} from '../shared/avatar-workbench';
import {snapshotAssets,compareAssets,recentAssets,cleanProjectChanges} from './project-changes';
import {cleanImportedPaths,importLocations,resolveImportLocation} from './project-locations';
import {installOwnedHelper} from './project-helper';
import {installMaHelper,publishMaRequest,readMaResult} from './project-ma';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import type {ImportSourceChoice,ProjectImportJob,ProjectImportPreview,ProjectImportOptions} from '../shared/project-contracts';
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
 private refreshing?:Promise<void>;private locating=new Map<string,Promise<void>>();
 private plans=new Map<string,Plan>();private history:ProjectImportJob[]=[];private active?:Promise<ProjectImportJob>;private persistTail:Promise<void>=Promise.resolve();private recoverCopies=new Set<string>();private recoverUnity=new Set<string>();
 constructor(private readonly deps:ProjectImportDependencies){
  try{const journal=this.journal();const s=fs.lstatSync(journal);if(!s.isFile()||s.size>32*1024*1024)throw new Error('导入记录文件无效。');const data=JSON.parse(fs.readFileSync(journal,'utf8'));if(!Array.isArray(data))throw new Error('导入记录文件无效。');this.history=data.filter((j:any)=>j&&idPattern.test(j.id)&&typeof j.assetId==='string'&&typeof j.projectId==='string'&&typeof j.projectPath==='string'&&path.isAbsolute(j.projectPath)&&typeof j.sourceName==='string'&&typeof j.sourcePath==='string'&&path.isAbsolute(j.sourcePath)&&['copy','unitypackage'].includes(j.mode)&&['copying','waiting-unity','importing','completed','cancelled','failed'].includes(j.state)).slice(0,100);for(const job of this.history){if(job.state==='copying')this.recoverCopies.add(job.id);else if(job.mode==='unitypackage'&&!terminal(job.state))this.recoverUnity.add(job.id);job.projectChanges=cleanProjectChanges(job.projectChanges);job.review=cleanImportReview(job.review)}}catch(error:any){if(error.code!=='ENOENT')throw error}
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
 async readiness(projectId:string){return readProjectReadiness(await validateProject(this.get(projectId,true),this.deps.roots()),projectId)}
 private duplicate(project:ProjectAccess,signature:string,mode:ImportSourceChoice['mode']){return mode==='unitypackage'?this.history.find(j=>j.state==='completed'&&j.mode===mode&&path.resolve(j.projectPath).toLowerCase()===project.root.toLowerCase()&&j.sha256===signature):undefined}
 async review(id:string,patch:ImportReviewPatch):Promise<void>{
  if(typeof id!=='string'||!idPattern.test(id)||!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!['appearance','movement','menu'].includes(k)||typeof (patch as any)[k]!=='boolean'))throw new Error('检查记录无效。');
  await this.refreshJobs();const job=this.history.find(j=>j.id===id);if(!job||job.state!=='completed')throw new Error('请在文件导入完成后记录检查结果。');
  this.get(job.projectId,true);job.review={...cleanImportReview(job.review),...patch,updatedAt:new Date().toISOString()};await this.persist();
 }
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
 async preview(assetId:string,projectId:string,choiceId:string,options:ProjectImportOptions={}):Promise<ProjectImportPreview>{
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['maSetup','maAssemble','maMenuWithAssembly','allowRepeat'].includes(key))||['maSetup','maAssemble','maMenuWithAssembly','allowRepeat'].some(key=>(options as any)[key]!==undefined&&typeof (options as any)[key]!=='boolean')||options.maSetup&&options.maAssemble||options.maMenuWithAssembly&&!options.maAssemble)throw new Error('MA 配置选项无效。');const maSetup=options.maSetup===true,maAssemble=options.maAssemble===true,wantsMA=maSetup||maAssemble;
  if(typeof choiceId!=='string')throw new Error('请选择本地素材文件。');const asset=this.get(assetId),project=await validateProject(this.get(projectId,true),this.deps.roots());
  const source=(await this.sources(assetId)).find(c=>c.id===choiceId);if(!source)throw new Error('本地素材文件选择已失效，请重新选择。');
  if(isWithin(source.path,project.root)||isWithin(project.root,source.path))throw new Error('原素材与目标工程路径重叠，不能复制或导入。');
  const manifest=await sourceManifest(source.path),conflicts=source.mode==='copy'?await guidConflicts(manifest,project):[],warnings=[...manifest.warnings];
  const hasPrefabs=source.mode==='unitypackage'||manifest.files.some(f=>/\.prefab$/i.test(f.relative));const prefabList=manifest.files.filter(f=>/\.prefab$/i.test(f.relative));const manageablePrefabs=prefabList.length<=1000&&Buffer.byteLength(JSON.stringify(prefabList.map(f=>f.relative)))<=128*1024;if(wantsMA&&!manageablePrefabs)warnings.push('本批 Prefab 太多，请选择更具体的素材后装配。');if(wantsMA){if(!hasPrefabs)warnings.push('此复制内容没有 Prefab，无法配置 MA 菜单。');warnings.push('导入后在 Unity 中处理；多个角色或 Prefab 时先选择，不会自动保存场景。')}
  let editor:UnityEditor|undefined,sha256:string|undefined;
  if(source.mode==='unitypackage'){
   const handle=await fsp.open(source.path,'r');try{const b=Buffer.alloc(2);await handle.read(b,0,2,0);if(b[0]!==31||b[1]!==139)throw new Error('这不是有效的 Unity gzip 素材包，请核对源文件。')}finally{await handle.close()}
   sha256=await fileHash(source.path);editor=await this.editor(project.version);if(!editor)warnings.push('未找到相同版本的 Unity；可手动打开此工程，再由助手接收导入。');
   warnings.push('素材包将在 Unity 原生窗口确认；首次导入会在此工程添加轻量导入助手。');
  }
  const existing=source.mode==='unitypackage'?(await this.productImportRecords(projectId)).find(j=>j.mode==='unitypackage'&&j.sha256===sha256):undefined;
  const allowRepeat=options.allowRepeat===true&&source.mode==='unitypackage',duplicateBlocked=!!existing&&!allowRepeat,readiness=await readProjectReadiness(project,projectId);
  const preflight:ImportCheck[]=[{id:'project',state:'pass',title:'目标工程',detail:project.root},{id:'guid',state:conflicts.length?'blocked':source.mode==='copy'?'pass':'unknown',title:'文件引用',detail:conflicts.length?'存在重复 GUID，禁止覆盖。':source.mode==='copy'?'已检查复制内容的 GUID。':'Unity 素材包的覆盖项由原生导入窗口核对。'},{id:'fit',state:'unknown',title:'角色适配',detail:'商品支持列表不等于本地包版本；请核对所选适配包。体型与穿模需要实际检查。'}];
  if(existing)preflight.push({id:'duplicate',state:duplicateBlocked?'blocked':'warning',title:'此前已经导入',detail:source.mode==='unitypackage'?'此工程已有相同内容的素材包记录；文件改名也不会当作新包。':'此工程已有同一份未变化的复制内容，请先查看导入记录。'});
  if(wantsMA){for(const [id,key] of [['nadena.dev.modular-avatar','ma'],['com.vrchat.avatars','sdk']] as const){const d=readiness.dependencies.find(d=>d.id===id)!;preflight.push({id:key,state:d.state==='files-found'?'pass':'warning',title:d.label,detail:d.state==='files-found'?`发现包文件 ${d.version}；Unity 编译与接口仍需验证。`:d.state==='declared'?'仅发现依赖声明，请在 Unity 确认已安装并编译。':'尚未确认此依赖，请在 Unity 或公开插件页核对。'})}
   preflight.push({id:'menu',state:'pass',title:'菜单处理',detail:options.maMenuWithAssembly?'保留作者已有 MA 菜单；没有时创建显隐开关，与装配一起撤销。':maSetup?'仅配置菜单，骨骼装配另行检查。':'本次只装配；作者已有组件保持原样。'});
  }
  const preview:ProjectImportPreview={token:randomUUID(),assetId:asset.id,projectId,sourceName:source.name,sourcePath:source.path,projectPath:project.root,mode:source.mode,fileCount:source.mode==='copy'?manifest.files.length:1,bytes:source.mode==='copy'?manifest.bytes:manifest.files.find(f=>f.source===source.path)!.size,ready:!conflicts.length&&!duplicateBlocked&&(!wantsMA||hasPrefabs&&manageablePrefabs),maSetup,maAssemble,maMenuWithAssembly:options.maMenuWithAssembly===true,allowRepeat,duplicateJobId:existing?.id,preflight,conflicts,warnings,projectVersion:project.version,editorPath:editor?.path,helperRequired:source.mode==='unitypackage'||wantsMA};
  for(const [key,value] of this.plans)if(value.expires<Date.now())this.plans.delete(key);if(this.plans.size>=20)this.plans.delete(this.plans.keys().next().value!);
  this.plans.set(preview.token,{preview,source,manifest,project,expires:Date.now()+10*60*1000,sha256});return structuredClone(preview);
 }
 async execute(token:string):Promise<ProjectImportJob>{
  if(this.active)throw new Error('正在执行导入，请等待当前操作完成。');const plan=this.plans.get(token);this.plans.delete(token);if(!plan||plan.expires<Date.now())throw new Error('导入预览已失效，请重新预览。');
  if(!plan.preview.ready)throw new Error('当前导入预览无法执行，请核对提示。');const operation=this.perform(plan);this.active=operation;try{return await operation}finally{if(this.active===operation)this.active=undefined}
 }
 private async perform(plan:Plan):Promise<ProjectImportJob>{
  const asset=this.get(plan.preview.assetId),project=await validateProject(this.get(plan.preview.projectId,true),this.deps.roots());
  if(project.device!==plan.project.device||project.inode!==plan.project.inode||project.root!==plan.project.root)throw new Error('工程目录已变化，请重新预览。');
  await this.sourceAllowed(asset,plan.source.path);if(!(await this.sources(asset.id)).some(c=>c.id===plan.source.id)||(await sourceManifest(plan.source.path)).signature!==plan.manifest.signature)throw new Error('源文件已变化，请重新预览。');
  await this.refreshJobs();if(this.history.some(j=>j.projectId===plan.preview.projectId&&!terminal(j.state)))throw new Error('此工程已有等待中的导入，请先完成或取消。');
  const duplicate=this.duplicate(project,plan.sha256??plan.manifest.signature,plan.source.mode);if(duplicate&&!(plan.source.mode==='unitypackage'&&plan.preview.allowRepeat))throw new Error('此素材已经导入到该工程，请查看记录或明确选择再次导入。');
  if(plan.source.mode==='copy'&&(await guidConflicts(plan.manifest,project)).length)throw new Error('工程已有相同 GUID，复制已停止。');
  if(plan.sha256&&await fileHash(plan.source.path)!==plan.sha256)throw new Error('源文件已变化，请重新预览。');
  const p=plan.preview,job:ProjectImportJob={id:randomUUID(),assetId:p.assetId,projectId:p.projectId,sourceName:p.sourceName,sourcePath:p.sourcePath,projectPath:p.projectPath,mode:p.mode,state:p.mode==='copy'?'copying':'waiting-unity',createdAt:new Date().toISOString(),fileCount:p.fileCount,completedFiles:0,bytes:p.bytes,copiedBytes:0,sha256:plan.sha256??plan.manifest.signature,...(duplicate?{repeatOf:duplicate.id}:{})};
  if(job.mode==='copy'){const location=copyLocation(project,asset.name,job.id,plan.manifest);job.destinationPath=location.destination;job.destinationContainer=location.container}
  if(job.mode==='copy')this.recordPaths(job,plan.manifest.files.filter(f=>!f.relative.endsWith('.meta')).map(f=>path.relative(project.root,path.join(job.destinationContainer!,f.relative)).split(path.sep).join('/')),true);
  if(p.maSetup||p.maAssemble){const prefabPaths=p.mode==='copy'?plan.manifest.files.filter(f=>/\.prefab$/i.test(f.relative)).map(f=>path.relative(project.root,path.join(job.destinationContainer!,f.relative)).split(path.sep).join('/')):[];job.maSetup={state:'waiting-import',message:'等待文件导入完成后配置 MA 菜单。',prefabPaths,requestPublished:false,...(p.maAssemble?{assembly:true,menuWithAssembly:p.maMenuWithAssembly===true}:{})}}
  this.history.unshift(job);let committed=false,published=false,temporaryRequest:string|undefined;
  try{
   await this.persist();
   if(job.mode==='copy'){
    job.destinationPath=await commitCopy(plan.manifest,project,asset.name,(files,bytes)=>{job.completedFiles=files;job.copiedBytes=bytes;this.deps.onChange?.()},{id:job.id,sha256:job.sha256!});committed=true;job.state='completed';job.finishedAt=new Date().toISOString();await this.finish(job);if(job.maSetup){await this.prepareMa(job,project);if(!await this.isProjectOpen(project)){const editor=await this.editor(project.version);if(editor)try{await (this.deps.launchEditor??launchUnityEditor)(editor.path,['-projectPath',project.root])}catch{job.maSetup.message='素材已导入，请手动打开 Unity 配置 MA 菜单。'}}}
   }else{
    await this.installHelper(project);if(job.maSetup)await this.prepareMa(job,project);await this.captureBaseline(job,project);const requests=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Requests'));await fsp.mkdir(requests,{recursive:true});const request=await projectWrite(project,path.join(requests,job.id+'.json'));
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
 private async prepareMa(job:ProjectImportJob,project:ProjectAccess):Promise<void>{
  if(!job.maSetup||job.maSetup.requestPublished||job.maSetup.state==='applied'||job.maSetup.state==='skipped')return;
  try{
   const paths=job.maSetup.prefabPaths??[];
   if(job.mode==='copy'){
    const container=job.destinationContainer;if(!container||path.dirname(container)!==path.join(project.assets,'VRCAL_Imports')||!path.basename(container).endsWith('-'+job.id))throw new Error('MA 导入目录无效。');
    const prefix=path.relative(project.root,container).split(path.sep).join('/')+'/';if(!paths.length||paths.some(p=>!p.startsWith(prefix)))throw new Error('MA Prefab 不属于本次复制目录。');
    const receipt=JSON.parse(await smallFile(path.join(container,'.vrcal-import.json'),65536));if(receipt.id!==job.id||receipt.sha256!==job.sha256||receipt.state!=='completed')throw new Error('MA 等待有效的文件复制回执。');
   }
   await installMaHelper(project.root,path.resolve(__dirname,'../../../assets/unity'));
   await publishMaRequest(project.root,{schema:1,id:job.id,sha256:job.sha256!,projectPath:project.root,sourceName:job.sourceName,mode:job.mode,prefabPaths:paths,sourcePackageName:job.mode==='unitypackage'?path.basename(job.sourcePath):'',...(job.maSetup.assembly?{assemble:true,menuWithAssembly:job.maSetup.menuWithAssembly===true}:{})});
   job.maSetup.requestPublished=true;job.maSetup.state=job.mode==='copy'?'waiting-selection':'waiting-import';job.maSetup.message=job.maSetup.assembly?'等待 Unity 使用 MA 装配；多个候选时请先选择。':job.mode==='copy'?'请在 Unity 中选择角色和 Prefab，配置 MA 菜单。':'等待 Unity 导入完成后选择角色和 Prefab。';
  }catch(error){job.maSetup.state='error';job.maSetup.message=error instanceof Error?error.message:'MA 配置准备失败；已导入的文件保持原样。'}
 }
 private async refreshMa(job:ProjectImportJob):Promise<boolean>{
  if(!job.maSetup||!job.sha256)return false;const record=this.deps.getAsset(job.projectId);if(!record||record.kind!=='unity-project'||record.path!==job.projectPath)return false;
  const before=JSON.stringify(job.maSetup);
  try{const result=await readMaResult(job.projectPath,{id:job.id,sha256:job.sha256});if(result){job.maSetup={...job.maSetup,state:result.state,message:result.message,avatarName:result.avatarName,prefabPath:result.prefabPath,menuName:result.menuName,hierarchyPath:result.hierarchyPath,menuMode:result.menuMode};if(job.maSetup.assembly&&result.state==='applied'&&result.assembly!==true){job.maSetup.state='error';job.maSetup.message='Unity 未确认 MA 装配结果，请检查助手版本及场景；不会自动重复装配。'}else if(job.maSetup.menuWithAssembly&&result.state==='applied'&&!result.menuMode){job.maSetup.state='error';job.maSetup.message='旧助手没有返回菜单结果，请更新助手并在 Unity 核对；不会自动重复装配。'}}
   else if(job.state==='completed'&&!job.maSetup.requestPublished&&job.maSetup.state!=='error')await this.prepareMa(job,await validateProject(record,this.deps.roots()));
   if(['failed','cancelled'].includes(job.state)&&job.maSetup.state==='waiting-import'){job.maSetup.state='skipped';job.maSetup.message='文件未完成导入，未配置 MA 菜单。'}
  }catch{/* An unavailable or foreign MA receipt never implies successful setup. */}
  return JSON.stringify(job.maSetup)!==before;
 }
 private recordPaths(job:ProjectImportJob,value:unknown,complete:unknown):void {
  const paths=cleanImportedPaths(value);if(!Array.isArray(value)||value.length>0&&!paths.length)return;
  const kept:string[]=[];let size=2;for(const p of paths){const next=Buffer.byteLength(JSON.stringify(p))+1;if(kept.length>=1000||size+next>128*1024)break;kept.push(p);size+=next}
  job.importedAssetPaths=kept;job.importedPathsComplete=complete===true&&kept.length===paths.length;
 }
 private async refreshImportedPaths(job:ProjectImportJob):Promise<boolean>{
  if(job.mode!=='unitypackage'||job.state!=='completed'||job.importedPathsComplete===true||!job.sha256)return false;
  const record=this.deps.getAsset(job.projectId);if(!record||record.path!==job.projectPath||record.kind!=='unity-project')return false;const before=JSON.stringify([job.importedAssetPaths,job.importedPathsComplete]);
  try{const project=await validateProject(record,this.deps.roots()),file=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Results',job.id+'.json')),receipt=JSON.parse(await smallFile(file,1024*1024));if(receipt.schema===1&&receipt.id===job.id&&receipt.sha256===job.sha256&&receipt.state==='completed')this.recordPaths(job,receipt.importedAssetPaths,receipt.importedPathsComplete)}catch{}
  return JSON.stringify([job.importedAssetPaths,job.importedPathsComplete])!==before;
 }
 private baselineFile(id:string):string {
  if(!idPattern.test(id))throw new Error('导入记录无效。');return assertSafeWrite(path.join(this.deps.dataDir,'project-import-baselines',id+'.json'),this.deps.dataDir,this.deps.roots());
 }
 private async captureBaseline(job:ProjectImportJob,project:ProjectAccess):Promise<void>{
  try{const snapshot=await snapshotAssets(project),file=this.baselineFile(job.id);await noLinks(file,true);await fsp.mkdir(path.dirname(file),{recursive:true});await noLinks(file,true);await fsp.writeFile(file,JSON.stringify({schema:1,id:job.id,sha256:job.sha256,snapshot}),{flag:'wx'});job.comparisonReady=true}
  catch{job.comparisonReady=false} // Optional location hints never prevent the authorized Unity import.
 }
 private async locateChanges(job:ProjectImportJob):Promise<void>{
  if(job.projectChanges)return;const pending=this.locating.get(job.id);if(pending)return pending;
  const operation=(async()=>{
   const project=await validateProject(this.get(job.projectId,true),this.deps.roots());if(project.root!==job.projectPath)throw new Error('目标工程已变化。');
   let baseline:any;try{baseline=JSON.parse(await smallFile(this.baselineFile(job.id),32*1024*1024))}catch(error:any){if(error.code!=='ENOENT')throw error}
   if(baseline&&(baseline.schema!==1||baseline.id!==job.id||baseline.sha256!==job.sha256))throw new Error('工程对比清单无效，请重新选择工程。');
   const after=await snapshotAssets(project);job.projectChanges=baseline?compareAssets(baseline.snapshot,after):recentAssets(after,job.createdAt,job.finishedAt??job.createdAt);job.comparisonReady=false;
  })();this.locating.set(job.id,operation);try{await operation}finally{if(this.locating.get(job.id)===operation)this.locating.delete(job.id)}
 }
 private async refreshChanges(job:ProjectImportJob):Promise<boolean>{
  let changed=false;
  if(job.mode==='unitypackage'&&job.state==='completed'){
   if(job.comparisonReady&&!job.projectChanges){try{await this.locateChanges(job)}catch{job.comparisonReady=false}changed=true}
   if(job.message==='Unity did not report the selected Assets paths; the import location is unknown.'){
    job.message=job.importedAssetPaths?.length?'':job.projectChanges?.paths.length?'Unity 未返回精确位置，可查看下方的工程变化候选。':'Unity 未返回精确位置，可查找工程中新增或修改的文件。';changed=true;
   }
  }
  return changed;
 }
 async findLocations(id:string):Promise<void>{
  if(typeof id!=='string'||!idPattern.test(id))throw new Error('导入记录无效。');await this.refreshJobs();const job=this.history.find(j=>j.id===id);
  if(!job||job.mode!=='unitypackage'||job.state!=='completed')throw new Error('此导入尚无可定位的工程位置。');await this.locateChanges(job);await this.persist();
 }
 private async finish(job:ProjectImportJob):Promise<void>{if(!job.linked){this.deps.onComplete?.(structuredClone(job));job.linked=true}}
 private async isProjectOpen(project:ProjectAccess):Promise<boolean>{try{await noLinks(path.join(project.root,'Temp','UnityLockfile'));return (await fsp.lstat(path.join(project.root,'Temp','UnityLockfile'))).isFile()}catch{return false}}
 private async installHelper(project:ProjectAccess):Promise<void>{return installOwnedHelper(project.root,'VRCALImportBridge',path.resolve(__dirname,'../../../assets/unity'))}
 private async refreshJobs():Promise<void>{
  if(this.refreshing)return this.refreshing;const operation=this.refreshJobsNow();this.refreshing=operation;try{await operation}finally{if(this.refreshing===operation)this.refreshing=undefined}
 }
 private async refreshJobsNow():Promise<void>{
  let changed=false;
  for(const job of this.history){
   if(await this.refreshMa(job))changed=true;
   if(await this.refreshImportedPaths(job))changed=true;
   if(await this.refreshChanges(job))changed=true;
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
    try{receipt=JSON.parse(await smallFile(file,1024*1024))}catch{/* A receipt may not exist yet. */}
    if(receipt?.schema===1&&receipt.id===job.id&&receipt.sha256===job.sha256&&['importing','completed','failed','cancelled'].includes(receipt.state)){
     if(job.state!==receipt.state){job.state=receipt.state;job.message=typeof receipt.message==='string'?receipt.message.slice(0,2000):undefined;if(terminal(job.state))job.finishedAt=new Date().toISOString();changed=true}
     if(job.state==='completed'){this.recordPaths(job,receipt.importedAssetPaths,receipt.importedPathsComplete);await this.refreshChanges(job);job.completedFiles=job.fileCount;job.copiedBytes=job.bytes;try{await this.finish(job);changed=true}catch{job.message='Unity 已导入完成，素材关联稍后重试；请勿重复导入。';changed=true}}
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
  if(changed){await this.persist();for(const job of this.history)if(terminal(job.state)&&(job.state!=='completed'||job.projectChanges))try{const file=this.baselineFile(job.id);await noLinks(file);await fsp.unlink(file)}catch{/* Completed evidence stays in the journal; only our exact baseline file is removed. */}}
 }
 async retryMa(id:string):Promise<void>{
  if(typeof id!=='string'||!idPattern.test(id)||this.active)throw new Error('请等待当前导入完成。');await this.refreshJobs();const job=this.history.find(j=>j.id===id);
  if(!job?.maSetup||job.state!=='completed')throw new Error('请在 Unity 的 MA 配置窗口继续处理此请求。');
  const project=await validateProject(this.get(job.projectId,true),this.deps.roots());if(project.root!==job.projectPath)throw new Error('目标工程已变化。');
  if(job.maSetup.requestPublished){
   const error='Package import failed. MA setup was not applied; inspect the separate import result.';
   const result=await readMaResult(project.root,{id:job.id,sha256:job.sha256!});
   if(job.mode!=='unitypackage'||result?.state!=='error'||result.message!==error)throw new Error('请在 Unity 的 MA 配置窗口继续处理此请求。');
   const receipt=JSON.parse(await smallFile(await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Results',id+'.json'))));
   if(receipt.schema!==1||receipt.id!==id||receipt.sha256!==job.sha256||receipt.state!=='completed')throw new Error('请在 Unity 的 MA 配置窗口继续处理此请求。');
   try{const journal=JSON.parse(await smallFile(await projectWrite(project,path.join(project.root,'Library',BRIDGE,'MAState',id+'.json'))));if(journal.schema!==1||journal.id!==id||journal.sha256!==job.sha256||journal.phase!=='selection')throw new Error('请在 Unity 的 MA 配置窗口继续处理此请求。')}catch(e:any){if(e.code!=='ENOENT')throw e}
   const file=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'MAResults',id+'.json')),before=await smallFile(file);
   // The old helper treats this exact error as terminal: it cannot be applying concurrently.
   const check=JSON.parse(before);if(check.id!==id||check.sha256!==job.sha256||check.state!=='error'||check.message!==error)throw new Error('MA 状态已变化，请刷新后重试。');
   const archive=await projectWrite(project,file+'.retry-'+randomUUID());await fsp.rename(file,archive);
   job.maSetup.state='waiting-selection';job.maSetup.message='文件已导入，等待 Unity 重新准备 MA；不会重复导入素材。';
  }else await this.prepareMa(job,project);
  await this.persist();
 }
 async updateMaHelper(id:string):Promise<void>{
  const record=this.get(id,true);if(this.active||this.history.some(j=>j.projectId===id&&!terminal(j.state)))throw new Error('请等待此工程当前导入结束后再更新 MA 助手。');
  if(!this.history.some(j=>j.projectId===id&&j.projectPath===record.path&&j.maSetup))throw new Error('请先在此工程导入素材并启用 MA 助手。');
  const project=await validateProject(record,this.deps.roots());await installMaHelper(project.root,path.resolve(__dirname,'../../../assets/unity'));
 }
 /** Read completed import evidence without refreshing jobs, invoking callbacks, installing helpers, or writing project/library files. */
 async productImportRecords(projectId:string):Promise<ProjectImportJob[]>{
  const project=await validateProject(this.get(projectId,true),this.deps.roots()),result:ProjectImportJob[]=[];
  for(const source of this.history){if(source.projectId!==projectId||source.projectPath!==project.root)continue;const job=structuredClone(source);
   if(job.mode==='unitypackage'&&job.sha256&&!['failed','cancelled'].includes(job.state))try{
    const file=path.join(project.root,'Library',BRIDGE,'Results',job.id+'.json'),receipt=JSON.parse(await smallFile(file,1024*1024));
    if(receipt.schema===1&&receipt.id===job.id&&receipt.sha256===job.sha256&&receipt.state==='completed'){job.state='completed';this.recordPaths(job,receipt.importedAssetPaths,receipt.importedPathsComplete)}
   }catch{/* Unavailable receipts cannot establish an import; recorded completed evidence remains available. */}
   if(job.state==='completed')result.push(job);
  }
  return result;
 }
 async jobs(projectId?:string):Promise<ProjectImportJob[]>{await this.refreshJobs();return structuredClone(this.history.filter(j=>!projectId||j.projectId===projectId).slice(0,100).map(job=>{if(job.state!=='completed'){const {importedAssetPaths:_paths,importedPathsComplete:_complete,projectChanges:_changes,...pending}=job;return {...pending,importLocations:[],changeLocations:[]}}return {...job,changeLocations:importLocations(cleanProjectChanges(job.projectChanges)?.paths.map(p=>p.path)??[]),importLocations:job.mode==='copy'&&job.destinationContainer?[path.relative(job.projectPath,job.destinationContainer).split(path.sep).join('/')]:importLocations(job.importedAssetPaths??[])}}))}
 async importLocation(id:string,relative:unknown):Promise<string>{
  if(typeof id!=='string'||!idPattern.test(id))throw new Error('导入记录无效。');await this.refreshJobs();const job=this.history.find(j=>j.id===id);if(!job)throw new Error('导入记录不存在。');const project=await validateProject(this.get(job.projectId,true),this.deps.roots());return resolveImportLocation(project,job,relative);
 }
 async cancel(id:string):Promise<boolean>{
  if(!idPattern.test(id))throw new Error('导入任务无效。');await this.refreshJobs();const job=this.history.find(j=>j.id===id);if(!job||job.mode!=='unitypackage'||job.state!=='waiting-unity')return false;
  const project=await validateProject(this.get(job.projectId,true),this.deps.roots()),request=await projectWrite(project,path.join(project.root,'Library',BRIDGE,'Requests',id+'.json'));
  try{await fsp.rename(request,await projectWrite(project,request+'.cancelled'))}catch(error:any){if(error.code==='ENOENT'){job.message='Unity 正在处理，请在 Unity 原生窗口取消。';await this.persist();return false}throw error}
  job.state='cancelled';job.finishedAt=new Date().toISOString();try{await this.persist()}catch{job.message='请求已取消，进度记录稍后保存。'}return true;
 }
 async openProject(id:string):Promise<void>{const project=await validateProject(this.get(id,true),this.deps.roots()),editor=await this.editor(project.version);if(!editor)throw new Error('未找到相同版本的 Unity，请选择编辑器或手动打开工程。');if(!await this.isProjectOpen(project))await (this.deps.launchEditor??launchUnityEditor)(editor.path,['-projectPath',project.root])}
}
