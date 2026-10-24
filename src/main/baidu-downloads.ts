import {WebContentsView,type Session,type WebContents,type DownloadItem,type Event} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertSafeWrite,isWithin} from './safety';
import {baiduBrowserUrl,baiduAccountKey} from './baidu-page';
import {parseBaiduShare,type BaiduDownloadState,type BaiduDownloadTask,type BaiduShareFile} from '../shared/baidu-download';
import {BAIDU_SHARE_SNAPSHOT,BAIDU_SHARE_BACK,baiduShareAction,baiduNormalDownload} from './baidu-share-page';
import {DownloadFolders,downloadFamily} from './download-folders';

interface Deps {dataDir:string;roots:()=>string[];session:()=>Promise<Session>;canNetwork:()=>boolean;changed:()=>void;onDownloaded?:(file:string)=>Promise<{assetId:string}>;onTaskStarted?:(id:string)=>void}
interface FileIdentity {device:string;inode:string;birthtime:string;modified:string;size:string}
interface StoredTask extends BaiduDownloadTask {folder:string;fileIdentity?:FileIdentity}
interface ShareFile extends BaiduShareFile {index:number}
interface Batch {files:ShareFile[];account?:string;serial:number}
interface Pending {file:ShareFile;account:string;id:string;folder:string;expires:number;finish:(task:StoredTask)=>void;failure?:string}
const states=['downloading','paused','completed','interrupted','cancelled'];
const uuidPattern='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const identityKeys=['device','inode','birthtime','modified','size'] as const;
function fileIdentity(file:string):FileIdentity {
 const s=fs.lstatSync(file,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.ino===0n||s.birthtimeNs===0n)throw new Error('下载文件无法可靠校验。');
 return {device:s.dev.toString(),inode:s.ino.toString(),birthtime:s.birthtimeNs.toString(),modified:s.mtimeNs.toString(),size:s.size.toString()};
}
function storedIdentity(value:any):FileIdentity|undefined {
 if(!value||typeof value!=='object'||identityKeys.some(key=>typeof value[key]!=='string'||! /^\d{1,40}$/.test(value[key]))||value.inode==='0'||value.birthtime==='0')return;
 return {device:value.device,inode:value.inode,birthtime:value.birthtime,modified:value.modified,size:value.size};
}
export function baiduDownloadName(name:unknown):string {
 if(typeof name!=='string'||!name||name.length>200||name!==name.trim()||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name)||name==='.'||name==='..')throw new Error('文件名无法安全保存。');return name;
}
export function baiduDownloadUrl(value:string):boolean {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(?:^|\.)(?:baidu\.com|baidupcs\.com|bcebos\.com)$/.test(u.hostname)}catch{return false}}
export class BaiduDownloads {
 private view?:WebContentsView;private remote?:Session;private phase:BaiduDownloadState['phase']='idle';private message='';private title='';private files:ShareFile[]=[];private directory?:string;private pagePath='';private back=false;private busy=false;private serial=0;private lastStop=Promise.resolve();private loggedIn=false;private rejectedAccount?:string;
 private tasks:StoredTask[]=[];private active=new Map<string,DownloadItem>();private pending?:Pending;private source='';private batch?:Batch;private batchRun?:Promise<void>;private imports=new Map<string,Promise<void>>();private folders:DownloadFolders;
 constructor(private readonly deps:Deps){this.folders=new DownloadFolders(deps.dataDir,deps.roots);this.load()}
 private working():boolean{return this.busy||!!this.pending||this.active.size>0||(this.batch?.files.length??0)>0||this.imports.size>0}
 state():BaiduDownloadState {return {phase:this.phase,title:this.title,message:this.message,files:this.files.map(({index,...file})=>file),downloadDir:this.directory,tasks:this.tasks.map(({folder,fileIdentity,...task})=>({...task})),canGoBack:this.back,busy:this.working(),loggedIn:this.loggedIn,queued:this.batch?.files.length??0}}
 async refreshState():Promise<BaiduDownloadState>{
  if(this.deps.canNetwork())try{const remote=await this.deps.session();const account=baiduAccountKey(await remote.cookies.get({url:'https://pan.baidu.com/'}));this.loggedIn=!!account&&account!==this.rejectedAccount}catch{this.loggedIn=false}
  return this.state();
 }
 private async requireLogin(){await this.refreshState();if(!this.loggedIn)throw new Error('请先在应用内登录百度账号，再读取分享。')}
 setDirectory(directory:string):void {if(this.working())throw new Error('请等待下载及入库结束后更改保存位置。');const target=assertSafeWrite(directory,this.deps.dataDir,[...this.deps.roots(),this.deps.dataDir],true);const stat=fs.lstatSync(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('请选择普通下载文件夹。');this.directory=target;this.save();this.deps.changed()}
 private requireNetwork(){if(!this.deps.canNetwork())throw new Error('请先开启联网。')}
 allowNavigation(contentsId:number,url:string):boolean{return !!this.view&&this.view.webContents.id===contentsId&&!!this.pending&&Date.now()<this.pending.expires&&baiduDownloadUrl(url)}
 private requireIdle(){if(this.working())throw new Error('请等待当前读取、下载或入库完成。')}
 async read(text:unknown,code?:unknown):Promise<void>{const share=parseBaiduShare(text,code);this.requireNetwork();this.requireIdle();await this.run(async()=>{await this.requireLogin();await this.createView();this.source=share.url;await this.view!.webContents.loadURL(share.url+(share.code?'?pwd='+encodeURIComponent(share.code):''));await this.capture()})}
 async folder(id:string):Promise<void>{this.requireNetwork();this.requireIdle();const file=this.files.find(f=>f.id===id);if(!file?.directory)throw new Error('请选择当前列表中的文件夹。');await this.run(async()=>{await this.assertPage();await this.evaluate(baiduShareAction(file.index,file.name,'open'));await this.capture(this.pagePath)})}
 async parent():Promise<void>{this.requireNetwork();this.requireIdle();if(!this.back)throw new Error('已经是分享根目录。');await this.run(async()=>{await this.assertPage();await this.evaluate(BAIDU_SHARE_BACK);await this.capture(this.pagePath)})}
 private async run(action:()=>Promise<void>){const serial=this.serial;this.busy=true;this.phase='loading';this.message='';this.deps.changed();try{await action();if(serial!==this.serial)throw new Error();this.phase='ready'}catch{this.phase='error';this.files=[];this.message='分享读取失败：请检查链接、提取码、网络，或完成百度登录与验证。';throw new Error(this.message)}finally{this.busy=false;this.deps.changed()}}
 private async createView(){if(this.phase!=='loading')throw new Error('读取已取消。');const serial=this.serial;if(this.view&&!this.view.webContents.isDestroyed())return;this.remote=await this.deps.session();if(serial!==this.serial)throw new Error('读取已取消。');this.view=new WebContentsView({webPreferences:{session:this.remote,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}});const wc=this.view.webContents;this.view.setBounds({x:0,y:0,width:1280,height:900});wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-attach-webview',e=>e.preventDefault());wc.on('will-frame-navigate',e=>{try{baiduBrowserUrl(e.url)}catch{if(!this.allowNavigation(wc.id,e.url))e.preventDefault()}});wc.on('will-redirect',e=>{try{baiduBrowserUrl(e.url)}catch{if(!this.allowNavigation(wc.id,e.url))e.preventDefault()}});wc.on('will-navigate',e=>{try{baiduBrowserUrl(e.url)}catch{if(!this.allowNavigation(wc.id,e.url))e.preventDefault()}});wc.on('render-process-gone',()=>this.stop());}
 private async evaluate(script:string):Promise<any>{this.requireNetwork();if(!this.view||this.view.webContents.isDestroyed())throw new Error('分享页面未就绪。');let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([this.view.webContents.executeJavaScript(script,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('页面操作超时。')),10000)})])}finally{if(timer)clearTimeout(timer)}}
 private async assertPage(){if(!this.view||this.view.webContents.isDestroyed()||new URL(this.view.webContents.getURL()).origin+new URL(this.view.webContents.getURL()).pathname!==this.source)throw new Error('分享页面已变化，请重新读取。');const state=await this.evaluate(BAIDU_SHARE_SNAPSHOT);if(state.path!==this.pagePath)throw new Error('文件列表已变化，请重新读取。')}
 private async capture(previous?:string){const serial=this.serial;for(let attempt=0;attempt<35;attempt++){if(serial!==this.serial)throw new Error('读取已取消。');const data=await this.evaluate(BAIDU_SHARE_SNAPSHOT);if(serial!==this.serial)throw new Error('读取已取消。');if(data.files?.length&&(!previous||data.path!==previous)){if(data.files.length>=1000)throw new Error('此目录文件过多，请在较小的子目录读取。');this.files=data.files.map((f:any)=>{if(typeof f.name!=='string'||!f.name||f.name.length>500||typeof f.directory!=='boolean'||!Number.isInteger(f.index))throw new Error('文件列表无效。');return {id:randomUUID(),index:f.index,name:f.name,directory:f.directory,sizeText:String(f.sizeText).slice(0,80)}});this.pagePath=data.path;this.title=String(data.title).slice(0,500);this.back=data.back===true;return}if(/分享的文件已经被取消|分享已失效|链接不存在/.test(data.text))throw new Error('分享已失效。');await new Promise(resolve=>setTimeout(resolve,600))}throw new Error('文件列表无法读取，请登录或完成验证。')}
 async download(id:string):Promise<void>{return this.downloadMany([id])}
 async downloadMany(ids:unknown):Promise<void>{
  this.requireNetwork();this.requireIdle();if(!this.directory)throw new Error('请先选择下载保存位置。');
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'))throw new Error('请勾选 1 至 100 个当前列表中的文件。');
  const files=[...new Set(ids)].map(id=>{const file=this.files.find(f=>f.id===id);if(!file||file.directory)throw new Error('所选文件已变化，请重新读取并勾选。');baiduDownloadName(file.name);return {...file}});
  const batch:Batch={files,serial:this.serial};this.batch=batch;
  let started=false,resolveStart!:()=>void,rejectStart!:(error:unknown)=>void;
  const start=new Promise<void>((resolve,reject)=>{resolveStart=resolve;rejectStart=reject});
  const run=(async()=>{
   try{
    while(batch.files.length&&this.batch===batch&&batch.serial===this.serial){
     this.requireNetwork();const file=batch.files.shift()!,result=await this.requestDownload(file,batch);if(!started){started=true;resolveStart()}
     const task=await result.finished;if(task.state!=='completed'||task.importError)break;
    }
   }catch(error){if(!started)rejectStart(error);this.message=error instanceof Error?error.message:'下载请求失败。'}
   finally{if(this.batch===batch)this.batch=undefined;this.deps.changed()}
  })();this.batchRun=run;void run.then(()=>{if(this.batchRun===run)this.batchRun=undefined});return start;
 }
 cancelBatch():void {if(this.batch)this.batch.files=[];this.deps.changed()}
 private async requestDownload(file:ShareFile,batch:Batch):Promise<{finished:Promise<StoredTask>}>{
  this.busy=true;const serial=this.serial;this.message='正在请求下载…';this.deps.changed();
  try{
   await this.assertPage();const account=baiduAccountKey(await this.remote!.cookies.get({url:'https://pan.baidu.com/'}));
   if(!account)throw new Error('请先在应用内登录百度账号，再点击下载。');
   if(batch.account&&account!==batch.account)throw new Error('登录账号已变化，已停止后续下载。请重新读取分享。');batch.account=account;
   if(serial!==this.serial)throw new Error('登录状态已变化，请重新读取分享。');this.requireNetwork();
   const taskId=randomUUID(),family=downloadFamily(file.name),{folder}=this.folders.reserve(this.directory!,'baidu',this.source+'|'+family,family,file.name);
   let finish!:(task:StoredTask)=>void;const finished=new Promise<StoredTask>(resolve=>finish=resolve);
   const pending:Pending={id:taskId,file,account,folder,expires:Date.now()+20000,finish};this.pending=pending;
   await this.evaluate(baiduShareAction(file.index,file.name,'download'));
   let ordinaryClicked=false;
   for(let i=0;i<40&&this.pending?.id===taskId&&serial===this.serial;i++){
    await new Promise(resolve=>setTimeout(resolve,500));if(!this.pending||serial!==this.serial)break;
    if(!ordinaryClicked){const result=await this.evaluate(baiduNormalDownload(file.name));
     if(result==='login'){this.rejectedAccount=account;this.loggedIn=false;throw new Error('登录已失效，请重新登录百度账号。')}
     if(result==='mismatch'||result==='unsupported')throw new Error('百度下载页面已变化，未启动下载。');ordinaryClicked=result==='clicked';
    }
   }
   if(serial!==this.serial)throw new Error('登录状态或网络已变化，下载已取消。');
   if(pending.failure)throw new Error(pending.failure);
   if(this.pending?.id===taskId){this.pending=undefined;throw new Error('百度未开始网页下载。请检查登录／安全验证；若百度要求客户端，该文件暂无法在应用内下载。')}
   return {finished};
  }catch(error){this.pending=undefined;this.message=error instanceof Error?error.message:'下载请求失败。';throw error}
  finally{this.busy=false;this.deps.changed()}
 }

 accept(event:Event,item:DownloadItem,contents?:WebContents):boolean {
  if(contents!==this.view?.webContents)return false;const pending=this.pending;
  // Only the download expressly armed by the local file-list button can write.
  if(!pending||Date.now()>pending.expires||!this.deps.canNetwork()||item.getFilename()!==pending.file.name||!item.getURLChain().length||!item.getURLChain().every(baiduDownloadUrl)){event.preventDefault();return true}
  this.pending=undefined;try{
   const target=this.taskPath(pending.folder,pending.id,pending.file.name),partial=assertSafeWrite(target+'.part',this.deps.dataDir,[...this.deps.roots(),this.deps.dataDir],true);if(fs.existsSync(target)||fs.existsSync(partial))throw new Error('目标文件已存在。');item.setSavePath(partial);
   const record:StoredTask={id:pending.id,name:pending.file.name,folder:pending.folder,state:'downloading',receivedBytes:0,totalBytes:item.getTotalBytes(),downloadBps:0,startedAt:new Date().toISOString()};this.tasks.unshift(record);this.tasks=this.tasks.slice(0,200);this.active.set(record.id,item);this.message='';try{this.deps.onTaskStarted?.(record.id)}catch{}this.save();this.deps.changed();let lastBytes=0,lastAt=Date.now(),lastNotify=0;
   item.on('updated',(_event,state)=>{try{this.taskPath(record.folder,record.id,record.name);assertSafeWrite(partial,this.deps.dataDir,[...this.deps.roots(),this.deps.dataDir],true);if(!this.deps.canNetwork())throw new Error();if(state==='interrupted')this.cancelBatch();const now=Date.now(),bytes=item.getReceivedBytes();record.downloadBps=Math.max(0,(bytes-lastBytes)*1000/Math.max(1,now-lastAt));record.receivedBytes=bytes;record.totalBytes=item.getTotalBytes();record.state=item.isPaused()||state==='interrupted'&&item.canResume()?'paused':state==='interrupted'?'interrupted':'downloading';if(record.state!=='downloading')record.downloadBps=0;lastAt=now;lastBytes=bytes;if(now-lastNotify>300){lastNotify=now;this.deps.changed()}}catch{this.cancelBatch();item.cancel()}});
   item.once('done',(_event,state)=>{this.active.delete(record.id);record.receivedBytes=item.getReceivedBytes();record.totalBytes=item.getTotalBytes();record.downloadBps=0;record.finishedAt=new Date().toISOString();record.state=state==='completed'?'completed':state==='cancelled'?'cancelled':'interrupted';if(state==='completed')try{this.taskPath(record.folder,record.id,record.name);const stat=fs.lstatSync(partial);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.receivedBytes)throw new Error();try{fs.linkSync(partial,target)}catch(error:any){if(!['ENOTSUP','EPERM','EXDEV','EOPNOTSUPP'].includes(error.code))throw error;fs.copyFileSync(partial,target,fs.constants.COPYFILE_EXCL)}fs.unlinkSync(partial);record.fileIdentity=fileIdentity(target)}catch{record.state='interrupted';record.error='下载文件未能安全保存，请重新读取分享并重试。'}this.save();this.deps.changed();const imported=record.state==='completed'?this.register(record):Promise.resolve();void imported.finally(()=>pending.finish(record))});
  }catch{event.preventDefault();pending.failure='下载保存位置不可用，请重新选择。';this.message=pending.failure;this.deps.changed()}return true;
 }
 private register(task:StoredTask):Promise<void>{
  if(task.assetId||!this.deps.onDownloaded)return Promise.resolve();
  if(this.imports.has(task.id))return this.imports.get(task.id)!;
  const operation=Promise.resolve().then(async()=>{try{const file=this.importFile(task);const result=await this.deps.onDownloaded!(file);this.importFile(task);if(typeof result?.assetId!=='string'||! /^[A-Za-z0-9:_-]{1,256}$/.test(result.assetId))throw new Error();task.assetId=result.assetId;delete task.importError}catch{task.importError='下载已完成，自动入库失败；可重试入库，无需重新下载。'}finally{this.imports.delete(task.id);this.save();this.deps.changed()}});this.imports.set(task.id,operation);return operation;
 }
 private importFile(task:StoredTask):string {if(!task.fileIdentity)throw new Error('旧下载记录缺少文件校验信息，请通过手动添加素材入库。');return this.reveal(task.id)}
 async retryImport(id:string):Promise<void>{const task=this.tasks.find(row=>row.id===id);if(!task||task.state!=='completed')throw new Error('请选择已完成的下载。');if(this.imports.has(id))throw new Error('此文件正在入库，请稍候。');if(task.assetId)return;if(!this.deps.onDownloaded)throw new Error('自动入库暂不可用。');this.importFile(task);await this.register(task)}
 control(id:string,action:'pause'|'resume'|'cancel'){const item=this.active.get(id);if(!item)throw new Error('任务已结束；中断任务请重新读取分享后下载。');if(action==='pause')item.pause();else if(action==='resume'){this.requireNetwork();if(!item.canResume())throw new Error('无法继续，请重新下载。');item.resume()}else if(action==='cancel'){this.cancelBatch();item.cancel()}else throw new Error('下载操作无效。');const row=this.tasks.find(t=>t.id===id)!;row.state=action==='pause'?'paused':action==='resume'?'downloading':'cancelled';row.downloadBps=0;this.save();this.deps.changed()}
 reveal(id:string):string{const task=this.tasks.find(t=>t.id===id);if(!task||task.state!=='completed')throw new Error('请选择已完成的下载。');const file=this.taskPath(task.folder,task.id,task.name);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('下载文件已不在原位置。');if(task.fileIdentity){const current=fileIdentity(file);if(identityKeys.some(key=>current[key]!==task.fileIdentity![key]))throw new Error('下载文件已发生变化，已停止入库。')}return file}
 stop(){
  this.serial++;this.loggedIn=false;if(this.batch)this.batch.files=[];this.pending=undefined;this.files=[];this.back=false;this.pagePath='';this.phase='idle';this.message='';
  const waiting=[...this.active.values()].map(item=>new Promise<void>(resolve=>{item.once('done',()=>resolve());item.cancel()}));
  this.lastStop=Promise.all([this.lastStop,...waiting,...this.imports.values(),this.batchRun]).then(()=>{});
  const view=this.view;this.view=undefined;if(view&&!view.webContents.isDestroyed())view.webContents.close();this.save();this.deps.changed();
 }
 async shutdown(){this.stop();await this.lastStop}

 private taskPath(folder:string,id:string,name:string):string{const uuid=new RegExp('^'+uuidPattern+'$'),grouped=new RegExp('^.{1,160}--vrcal-'+uuidPattern+'$');if(!uuid.test(id)||!path.isAbsolute(folder)||!(path.basename(folder)===id||grouped.test(path.basename(folder)))||isWithin(folder,this.deps.dataDir))throw new Error('下载路径无效。');const target=assertSafeWrite(path.join(folder,baiduDownloadName(name)),this.deps.dataDir,[...this.deps.roots(),this.deps.dataDir],true);if(grouped.test(path.basename(folder)))this.folders.assertOwned(target);return target}
 private journal(){return assertSafeWrite(path.join(this.deps.dataDir,'baidu-downloads.json'),this.deps.dataDir,this.deps.roots())}
 private load(){try{const file=this.journal(),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||stat.size>1024*1024)return;const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.schema!==1)return;if(typeof value.directory==='string'&&path.isAbsolute(value.directory)&&!isWithin(value.directory,this.deps.dataDir))this.directory=assertSafeWrite(value.directory,this.deps.dataDir,[...this.deps.roots(),this.deps.dataDir],true);this.tasks=(Array.isArray(value.tasks)?value.tasks:[]).slice(0,200).flatMap((r:any)=>{try{this.taskPath(r.folder,r.id,r.name);if(!states.includes(r.state))return [];const assetId=typeof r.assetId==='string'&&/^[A-Za-z0-9:_-]{1,256}$/.test(r.assetId)?r.assetId:undefined;return [{id:r.id,name:r.name,folder:r.folder,state:r.state==='completed'?'completed':r.state==='cancelled'?'cancelled':'interrupted',receivedBytes:Math.max(0,Number(r.receivedBytes)||0),totalBytes:Math.max(0,Number(r.totalBytes)||0),downloadBps:0,startedAt:String(r.startedAt??'').slice(0,50),finishedAt:typeof r.finishedAt==='string'?r.finishedAt.slice(0,50):undefined,fileIdentity:storedIdentity(r.fileIdentity),assetId,importError:!assetId&&r.state==='completed'&&r.importError?'下载已完成，自动入库失败；可重试入库，无需重新下载。':undefined,error:typeof r.error==='string'?'下载文件未能安全保存，请重新读取分享并重试。':undefined} as StoredTask]}catch{return []}})}catch{}}
 private save(){try{const file=this.journal(),tmp=assertSafeWrite(file+'.tmp.'+randomUUID(),this.deps.dataDir,this.deps.roots());fs.writeFileSync(tmp,JSON.stringify({schema:1,directory:this.directory,tasks:this.tasks}),{flag:'wx'});fs.renameSync(tmp,file)}catch{this.message='下载记录保存失败，请检查资料库磁盘。'}}
}
