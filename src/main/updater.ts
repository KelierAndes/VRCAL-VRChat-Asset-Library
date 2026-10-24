import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assertSafeWrite} from './safety';
import type {UpdateState} from '../shared/contracts';

const REPOSITORY='NecoAya/VRCAL-VRChat-Asset-Library';
export const UPDATE_RELEASE_URL='https://github.com/'+REPOSITORY+'/releases/latest';
const ENDPOINT='https://api.github.com/repos/'+REPOSITORY+'/releases/latest';
const MAX_ASSET=1024*1024*1024,MAX_JSON=2*1024*1024;
interface ReleaseAsset {version:string;url:string;size:number;sha256:string}
interface Identity {dev:number;ino:number;size:number;mtimeMs:number}
export interface UpdaterDependencies {
 version:string;dataDir:string;roots:()=>string[];executable?:string;packaged:boolean;canNetwork:()=>boolean;
 fetch:(url:string,init?:RequestInit)=>Promise<Response>;onChange?:(state:UpdateState)=>void;quit:()=>void|Promise<void>;
 /** Host-process boundary injection; production always launches the bundled, hidden PowerShell helper. */
 launchHelper?:(scriptPath:string,manifestPath:string)=>Promise<void>;
}
function version(value:unknown,allowLocal=false):string {if(typeof value!=='string'||!/^v?(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(allowLocal?value.replace(/-(?:preview|local)\.(?:0|[1-9]\d{0,5})$/,''):value))throw new Error('更新版本号无效。');return value.replace(/^v/,'')}
// Remote releases are stable-only. At an equal numeric version, stable supersedes a local preview.
function newer(latest:string,current:string):boolean {const [core,suffix]=current.split('-'),a=latest.split('.').map(Number),b=core.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return suffix!==undefined}
function identity(file:string):Identity {const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw new Error('更新目标不是独立的普通文件。');return {dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs}}
function sameIdentity(a:Identity,b:Identity):boolean {return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs}
function https(raw:string):URL {const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hostname.endsWith('.'))throw new Error('更新网址无效。');return url}
function officialRelease(raw:unknown,tag:string):string {if(typeof raw!=='string')throw new Error('更新发布页面无效。');const url=https(raw);if(url.hostname!=='github.com'||url.pathname!=='/'+REPOSITORY+'/releases/tag/'+tag||url.search||url.hash)throw new Error('更新发布页面不属于官方仓库。');return url.href}
function officialAsset(raw:unknown,tag:string,name:string):string {if(typeof raw!=='string')throw new Error('更新下载地址无效。');const url=https(raw);if(url.hostname!=='github.com'||decodeURIComponent(url.pathname)!=='/'+REPOSITORY+'/releases/download/'+tag+'/'+name||url.search||url.hash)throw new Error('更新文件不属于官方仓库。');return url.href}
async function sha256(file:string):Promise<string> {const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
function portableHeader(file:string):void {const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(64);if(fs.readSync(fd,header,0,64,0)!==64||header.toString('ascii',0,2)!=='MZ')throw new Error('更新文件不是有效的 Windows 程序。');const offset=header.readUInt32LE(60),signature=Buffer.alloc(4);if(offset<64||offset>16*1024*1024||offset+4>fs.fstatSync(fd).size||fs.readSync(fd,signature,0,4,offset)!==4||!signature.equals(Buffer.from([80,69,0,0])))throw new Error('更新文件不是有效的 Windows 程序。')}finally{fs.closeSync(fd)}}
async function launch(script:string,manifest:string):Promise<number> {
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const stage=path.dirname(manifest),launcher=assertSafeWrite(path.join(stage,'update-launcher.ps1'),stage,[]),receipt=path.join(stage,'helper-ready.json'),deadline=Date.now()+10000;
 await fsp.writeFile(launcher,await fsp.readFile(path.resolve(__dirname,'../../../assets/update-launcher.ps1')),{flag:'wx'});
 // The relay runs normally; Start-Process gives its hidden helper an independent lifetime.
 const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',launcher,'-Helper',script,'-Manifest',manifest],{detached:false,stdio:['ignore','pipe','pipe'],windowsHide:true});
 const failed=()=>new Error('无法启动更新助手，当前版本保持不变。');
 try{
  const output=await new Promise<string>((resolve,reject)=>{
   let text='';const timer=setTimeout(()=>reject(failed()),10000);
   const finish=(error?:Error)=>{clearTimeout(timer);if(error)reject(error);else resolve(text)};
   child.once('error',error=>finish(error));child.once('close',code=>finish(code===0?undefined:failed()));
   child.stdout!.setEncoding('utf8');child.stdout!.on('data',(chunk:string)=>{text+=chunk;if(Buffer.byteLength(text)>4096)finish(failed())});
   child.stderr!.resume();
  });
  const started=JSON.parse(output.replace(/^\uFEFF/,''));
  if(!started||started.token!==path.basename(stage)||started.parentPid!==process.pid||!Number.isSafeInteger(started.helperPid)||started.helperPid<1||started.helperPid>2147483647||started.helperPid===process.pid||started.helperPid===child.pid)throw failed();
  while(true){
   if(Date.now()>deadline)throw failed();
   try{assertSafeWrite(receipt,stage,[]);const stat=await fsp.lstat(receipt);if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw new Error('更新助手的启动确认无效。');const ready=JSON.parse((await fsp.readFile(receipt,'utf8')).replace(/^\uFEFF/,''));if(ready.token!==started.token||ready.parentPid!==process.pid||ready.helperPid!==started.helperPid)throw new Error('更新助手的启动确认无效。');break}catch(error:any){if(error.code!=='ENOENT')throw error}
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  child.unref();
  return started.helperPid;
 }catch(error){try{child.kill()}catch{/* Only the helper started by this operation is managed here. */}throw error}
}

/** Public GitHub releases only; the renderer never supplies a URL, path, digest or update target. */
export class AppUpdater {
 private readonly target:string;private current:UpdateState;private asset?:ReleaseAsset;private operation?:AbortController;private closed=false;
 private owned?:Identity;private staged?:string;private stageDir?:string;private baselineDigest?:string;
 constructor(private readonly deps:UpdaterDependencies){
  this.target=deps.executable??'';
  try{if(this.targetAllowed())this.owned=identity(this.target)}catch{/* Unsupported installations retain the manual release-page fallback. */}
  this.current={currentVersion:deps.version,status:this.supported()?'idle':'unsupported',receivedBytes:0,totalBytes:0,downloadBps:0,message:this.supported()?'可检查官方 GitHub 更新。':'当前运行方式不支持自动替换，请从官方发布页下载。',releaseUrl:UPDATE_RELEASE_URL,canInstall:this.supported()};
 }
 state():UpdateState {return {...this.current,canInstall:this.supported()}}
 private publish(patch:Partial<UpdateState>):void {this.current={...this.current,...patch};if(!this.closed)this.deps.onChange?.(this.state())}
 private targetAllowed():boolean {
  if(process.platform!=='win32'||!this.deps.packaged||!this.target||!process.env.PORTABLE_EXECUTABLE_FILE||!path.isAbsolute(this.target)||path.resolve(this.target).toLowerCase()!==path.resolve(process.env.PORTABLE_EXECUTABLE_FILE).toLowerCase()||path.extname(this.target).toLowerCase()!=='.exe'||this.target.startsWith('\\\\')||this.target.includes(':',3))return false;
  assertSafeWrite(this.target,this.deps.dataDir,this.deps.roots(),true);assertSafeWrite(path.join(this.deps.dataDir,'updates'),this.deps.dataDir,this.deps.roots());return true;
 }
 private supported():boolean {try{return !!this.owned&&this.targetAllowed()&&sameIdentity(identity(this.target),this.owned)}catch{return false}}
 private requireSupported():void {if(!this.supported())throw new Error('当前运行方式或程序位置不支持自动替换，请从官方发布页下载。')}
 private network():void {if(this.closed)throw new Error('更新服务已关闭。');if(!this.deps.canNetwork())throw new Error('联网已关闭或暂停；本地素材浏览不受影响。')}
 private begin():AbortController {if(this.operation||this.current.status==='installing')throw new Error('请等待当前更新操作完成。');const controller=new AbortController();this.operation=controller;return controller}
 private async request(raw:string,controller:AbortController,asset=false):Promise<Response> {
  let current=raw;
  for(let redirects=0;redirects<=5;redirects++){
   this.network();if(controller.signal.aborted)throw controller.signal.reason;
   const url=https(current);if(asset?!(url.hostname==='github.com'&&url.pathname.startsWith('/'+REPOSITORY+'/releases/download/')||['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)):url.href!==ENDPOINT)throw new Error('更新跳转地址不受信任。');
   const response=await this.deps.fetch(url.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:asset?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:controller.signal});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('更新服务器返回了无效跳转。');current=new URL(location,url).href;continue}
   if(!response.ok){await response.body?.cancel();throw new Error(response.status===403||response.status===429?'GitHub 暂时限制请求，请稍后重试。':'官方更新服务暂时不可用。')}
   return response;
  }
  throw new Error('更新跳转次数过多。');
 }
 async check():Promise<UpdateState> {
  const controller=this.begin(),timer=setTimeout(()=>controller.abort(new Error('检查更新超时，请稍后重试。')),30000);
  this.asset=undefined;this.publish({status:'checking',message:'正在检查官方更新…',receivedBytes:0,totalBytes:0,downloadBps:0});
  try{
   this.network();const response=await this.request(ENDPOINT,controller),reader=response.body?.getReader();if(!reader)throw new Error('官方更新资料为空。');const chunks:Buffer[]=[];let length=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_JSON)throw new Error('官方更新资料超过大小限制。');chunks.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   if(controller.signal.aborted)throw controller.signal.reason;const release=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!release||release.draft!==false||release.prerelease!==false)throw new Error('官方更新资料无效。');const latest=version(release.tag_name),releaseUrl=officialRelease(release.html_url,release.tag_name),releaseNotes=typeof release.body==='string'?release.body.slice(0,60000):'';
   if(!newer(latest,version(this.deps.version,true))){this.publish({status:'up-to-date',latestVersion:latest,releaseUrl,releaseNotes,checkedAt:new Date().toISOString(),message:'已是最新版本。'});return this.state()}
   const name='VRC-Asset-Library-'+latest+'-x64.exe',matches=Array.isArray(release.assets)?release.assets.filter((item:any)=>item&&item.name===name):[];if(matches.length!==1)throw new Error('官方发布中没有唯一可用的 Windows 更新文件。');const item=matches[0];if(item.state!=='uploaded'||!Number.isSafeInteger(item.size)||item.size<512||item.size>MAX_ASSET||typeof item.digest!=='string'||!/^sha256:[a-f0-9]{64}$/i.test(item.digest))throw new Error('官方更新文件缺少有效的大小或 SHA-256 校验。');
   this.asset={version:latest,url:officialAsset(item.browser_download_url,release.tag_name,name),size:item.size,sha256:item.digest.slice(7).toLowerCase()};
   this.publish({status:this.supported()?'available':'unsupported',latestVersion:latest,releaseUrl,releaseNotes,totalBytes:item.size,checkedAt:new Date().toISOString(),message:this.supported()?'发现新版本，可下载并校验。':'发现新版本；当前运行方式请使用官方发布页手动更新。'});
  }catch(error){if(!this.closed)this.publish({status:controller.signal.aborted&&controller.signal.reason?.name==='AbortError'?'idle':'error',message:error instanceof Error?error.message:'检查更新失败。'})}finally{clearTimeout(timer);if(this.operation===controller)this.operation=undefined}
  return this.state();
 }
 async download():Promise<UpdateState> {
  this.requireSupported();if(!this.asset)throw new Error('请先检查并选择官方新版本。');this.network();const controller=this.begin(),asset=this.asset,timer=setTimeout(()=>controller.abort(new Error('更新下载超时，请稍后重试。')),10*60*1000);let file:fsp.FileHandle|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,part='';
  this.publish({status:'downloading',message:'正在下载并校验更新…',receivedBytes:0,totalBytes:asset.size,downloadBps:0});
  try{
   const before=identity(this.target);this.baselineDigest=await sha256(this.target);if(!this.owned||!sameIdentity(before,this.owned)||!sameIdentity(identity(this.target),this.owned))throw new Error('当前程序文件已变化，已停止更新。');
   const token=randomUUID(),directory=this.stageDir=assertSafeWrite(path.join(this.deps.dataDir,'updates',token),this.deps.dataDir,this.deps.roots());await fsp.mkdir(directory,{recursive:true});part=assertSafeWrite(path.join(directory,'update.exe.part'),this.deps.dataDir,this.deps.roots());file=await fsp.open(part,'wx');
   const response=await this.request(asset.url,controller,true),declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)!==asset.size))throw new Error('更新下载大小与官方资料不一致。');reader=response.body?.getReader();if(!reader)throw new Error('更新下载内容为空。');const hash=createHash('sha256');let received=0,lastBytes=0,lastAt=performance.now();
   while(true){const {done,value}=await reader.read();this.network();if(controller.signal.aborted)throw controller.signal.reason;if(done)break;received+=value.length;if(received>asset.size||received>MAX_ASSET)throw new Error('更新下载超过官方文件大小。');hash.update(value);for(let offset=0;offset<value.length;){const written=await file.write(value,offset,value.length-offset);if(written.bytesWritten<1)throw new Error('更新下载失败。');offset+=written.bytesWritten}const now=performance.now(),elapsed=now-lastAt;if(elapsed>=200||received===value.length){this.publish({receivedBytes:received,downloadBps:Math.max(0,(received-lastBytes)*1000/Math.max(1,elapsed))});lastAt=now;lastBytes=received}}
   await file.sync();await file.close();file=undefined;if(received!==asset.size||hash.digest('hex')!==asset.sha256||identity(part).size!==asset.size||await sha256(part)!==asset.sha256)throw new Error('更新 SHA-256 或文件大小校验失败，已丢弃下载。');assertSafeWrite(part,this.deps.dataDir,this.deps.roots());portableHeader(part);const staged=assertSafeWrite(path.join(directory,'update.exe'),this.deps.dataDir,this.deps.roots());await fsp.rename(part,staged);part='';this.staged=staged;this.publish({status:'ready',receivedBytes:received,downloadBps:0,message:'更新已校验，重启后应用。'});
  }catch(error){if(!this.closed)this.publish({status:controller.signal.aborted&&controller.signal.reason?.name==='AbortError'?'available':'error',receivedBytes:0,downloadBps:0,message:controller.signal.reason?.name==='AbortError'?'已取消更新下载。':error instanceof Error?error.message:'更新下载失败。'})}finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});reader?.releaseLock();await file?.close().catch(()=>{});if(part)try{assertSafeWrite(part,this.deps.dataDir,this.deps.roots());await fsp.unlink(part)}catch{}if(this.operation===controller)this.operation=undefined}
  return this.state();
 }
 async install():Promise<UpdateState> {
  this.requireSupported();if(this.closed||this.operation||this.current.status!=='ready'||!this.asset||!this.staged||!this.stageDir||!this.baselineDigest)throw new Error('请先下载并校验更新。');
  let approval:string|undefined;
  try{
   const target=assertSafeWrite(this.target,this.deps.dataDir,this.deps.roots(),true),staged=assertSafeWrite(this.staged,this.deps.dataDir,this.deps.roots());if(identity(staged).size!==this.asset.size||await sha256(staged)!==this.asset.sha256)throw new Error('已下载的更新文件发生变化，请重新下载。');portableHeader(staged);
   if(!this.supported()||await sha256(target)!==this.baselineDigest)throw new Error('当前程序文件已变化，已停止更新。');await fsp.access(path.dirname(target),fs.constants.W_OK);
   const token=path.basename(this.stageDir),script=assertSafeWrite(path.join(this.stageDir,'update-helper.ps1'),this.deps.dataDir,this.deps.roots()),manifest=assertSafeWrite(path.join(this.stageDir,'install.json'),this.deps.dataDir,this.deps.roots());
   await fsp.writeFile(script,await fsp.readFile(path.resolve(__dirname,'../../../assets/update-helper.ps1')),{flag:'wx'});
   await fsp.writeFile(manifest,JSON.stringify({schema:1,version:this.asset.version,token,target,staged,stageDir:this.stageDir,dataDir:path.resolve(this.deps.dataDir),protectedRoots:this.deps.roots().map(root=>path.resolve(root)),sha256:this.asset.sha256,size:this.asset.size,expectedTargetSha256:this.baselineDigest,expectedTargetSize:this.owned!.size,parentPid:process.pid}),{flag:'wx'});
   this.publish({status:'installing',downloadBps:0,message:'正在退出并应用更新；程序将自动重新打开。'});
   if(this.deps.launchHelper)await this.deps.launchHelper(script,manifest);
   else{
    const helperPid=await launch(script,manifest),file=assertSafeWrite(path.join(this.stageDir,'install-approved.json'),this.deps.dataDir,this.deps.roots()),handle=await fsp.open(file,'wx');approval=file;
    try{await handle.writeFile(JSON.stringify({schema:1,token,parentPid:process.pid,helperPid,approved:true}),'utf8');await handle.sync()}finally{await handle.close()}
   }
   await this.deps.quit();
  }catch(error){if(approval)try{assertSafeWrite(approval,this.deps.dataDir,this.deps.roots());await fsp.unlink(approval)}catch{/* A helper without a matching approval must stop before changing any executable. */}this.publish({status:'error',message:error instanceof Error?error.message:'无法启动更新助手，当前版本保持不变。'});throw error}
  return this.state();
 }
 cancel():void {if(this.current.status==='installing')return;this.operation?.abort(new DOMException('已取消更新操作。','AbortError'))}
 close():void {this.closed=true;if(this.current.status!=='installing')this.operation?.abort(new DOMException('更新服务已关闭。','AbortError'))}
}
export {AppUpdater as Updater};
