import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {AssetRecord} from '../shared/contracts';
import {publicPlugin,type PublicPlugin,type PluginDownloadState} from '../shared/public-plugins';
import {assertSafeWrite} from './safety';
import {fileHash} from './project-copy';

const MAX_PACKAGE=200*1024*1024;
const patterns:Record<string,RegExp>={'gesture-manager':/^GestureManager[0-9.]+\.unitypackage$/,'av3-emulator':/^lyuma\.av3emulator-[0-9.]+\.unitypackage$/,'av3-manager':/^dev\.vrlabs\.av3manager-[0-9.]+\.unitypackage$/,'facs-utilities':/^FACS\.Utilities\.[0-9.]+\.unitypackage$/,'animation-viewer':/^dev\.hai-vr\.animation-viewer-[0-9.]+\.unitypackage$/,'blendshape-viewer':/^dev\.hai-vr\.blendshape-viewer-[0-9.]+\.unitypackage$/};
interface ReleaseAsset {name:string;version:string;url:string;size:number;sha256?:string}
export function selectPluginRelease(plugin:PublicPlugin,input:any):ReleaseAsset{
 if(!plugin.directPackage||!patterns[plugin.id]||!input||input.draft!==false||input.prerelease!==false||typeof input.tag_name!=='string'||!/^v?\d+(?:\.\d+){1,3}$/.test(input.tag_name)||!Array.isArray(input.assets))throw new Error('官方没有可自动导入的稳定包，请使用官方发布页或 VCC。');
 const items=input.assets.filter((a:any)=>a&&typeof a.name==='string'&&patterns[plugin.id].test(a.name));
 if(items.length!==1)throw new Error('官方包缺失或有多个版本，已停止自动选择，请查看官方发布页。');
 const a=items[0],expected=`https://github.com/${plugin.repository}/releases/download/${input.tag_name}/${a.name}`;
 if(a.browser_download_url!==expected||!Number.isSafeInteger(a.size)||a.size<2||a.size>MAX_PACKAGE||a.digest!=null&&!/^sha256:[a-f0-9]{64}$/.test(a.digest))throw new Error('官方安装包地址、大小或校验信息异常。');
 return{name:a.name,version:input.tag_name,url:expected,size:a.size,sha256:a.digest?.slice(7)};
}
interface Dependencies {dataDir:string;roots:()=>string[];canNetwork:()=>boolean;fetch:(url:string,init:RequestInit)=>Promise<Response>;changed?:()=>void}
export class PublicPluginDownloads {
 private progress:PluginDownloadState={phase:'idle',bytes:0,bytesPerSecond:0,message:'选择公开插件和目标工程后，可下载并导入。',busy:false};
 private controller?:AbortController;private operation?:Promise<AssetRecord>;
 constructor(private readonly deps:Dependencies){}
 get busy(){return !!this.operation}
 state():PluginDownloadState{return {...this.progress,busy:this.busy}}
 private update(patch:Partial<PluginDownloadState>){Object.assign(this.progress,patch);this.deps.changed?.()}
 cancel(){this.controller?.abort()}
 async waitIdle(){await this.operation?.catch(()=>{})}
 private safe(file:string){return assertSafeWrite(file,this.deps.dataDir,this.deps.roots())}
 private file(id:string,hash:string){return this.safe(path.join(this.deps.dataDir,'plugin-downloads',id,hash+'.unitypackage'))}
 getAsset(id:unknown):AssetRecord|null{
  if(typeof id!=='string')return null;const match=/^plugin:([a-z0-9-]+):([a-f0-9]{64})$/.exec(id);if(!match)return null;
  try{const p=publicPlugin(match[1]);if(!p.directPackage)return null;const file=this.file(p.id,match[2]),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_PACKAGE)return null;
   return{id,path:file,name:p.name,group:'公开插件',kind:'unitypackage',size:stat.size,mtimeMs:stat.mtimeMs,missing:false,localCategory:'工具',localAvatars:[],hintUrls:[],manual:{},online:{status:'matched',title:p.name,author:p.author,url:p.releasePage,description:p.description},createdAt:stat.birthtime.toISOString(),updatedAt:stat.mtime.toISOString()};
  }catch{return null}
 }
 async verifySource(id:string):Promise<AssetRecord>{const asset=this.getAsset(id);if(!asset||await fileHash(asset.path)!==id.split(':')[2])throw new Error('插件缓存校验失败，请重新下载。');return asset}
 download(id:string):Promise<AssetRecord>{
  if(this.operation)return Promise.reject(new Error('正在下载插件，请等待或取消。'));
  const operation=this.perform(id);this.operation=operation;
  return operation.finally(()=>{if(this.operation===operation){this.operation=undefined;this.controller=undefined;this.deps.changed?.()}});
 }
 private async request(url:string,signal:AbortSignal,redirects=false):Promise<Response>{
  for(let n=0;n<5;n++){
   if(!this.deps.canNetwork())throw new Error('请先开启联网。');signal.throwIfAborted();
   const response=await this.deps.fetch(url,{signal,redirect:'manual',credentials:'omit',headers:{'User-Agent':'VRCAL-Public-Plugins','Accept':url.startsWith('https://api.github.com/')?'application/vnd.github+json':'application/octet-stream'}});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');await response.body?.cancel();if(!redirects||!location)throw new Error('官方发布地址发生变化，请从官方页面核对。');
    const next=new URL(location,url);if(next.protocol!=='https:'||next.username||next.password||next.port||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname))throw new Error('下载跳转不属于官方文件服务器。');url=next.href;continue;
   }
   if(!response.ok){await response.body?.cancel();throw new Error(response.status===403||response.status===429?'官方服务限流，请稍后重试；已有资料不受影响。':`官方下载失败（${response.status}），请稍后重试或查看发布页。`)}return response;
  }throw new Error('官方下载跳转次数过多。');
 }
 private async perform(id:string):Promise<AssetRecord>{
  const plugin=publicPlugin(id);if(!plugin.directPackage)throw new Error('此插件请使用官方 VCC／ALCOM 安装入口。');
  const controller=new AbortController();this.controller=controller;const timeout=setTimeout(()=>controller.abort(new Error('下载超时，请重试。')),5*60*1000);let temp:string|undefined;
  this.progress={phase:'checking',pluginId:id,name:plugin.name,bytes:0,bytesPerSecond:0,message:'正在核对官方最新稳定发布…',busy:true};this.deps.changed?.();
  try{
   const response=await this.request(`https://api.github.com/repos/${plugin.repository}/releases/latest`,controller.signal);
   const metadata:Buffer[]=[];let length=0;const reader=response.body?.getReader();if(!reader)throw new Error('官方发布资料为空。');try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024)throw new Error('官方发布资料过大。');metadata.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{})}
   const release=selectPluginRelease(plugin,JSON.parse(Buffer.concat(metadata).toString('utf8')));this.update({name:release.name,version:release.version,total:release.size});
   if(release.sha256){const cached=this.getAsset(`plugin:${id}:${release.sha256}`);if(cached&&await fileHash(cached.path)===release.sha256){controller.signal.throwIfAborted();this.update({phase:'ready',bytes:cached.size,assetId:cached.id,message:'已复用经过校验的官方安装包。'});return cached}}
   const directory=this.safe(path.join(this.deps.dataDir,'plugin-downloads',id));await fsp.mkdir(directory,{recursive:true});temp=this.safe(path.join(directory,randomUUID()+'.part'));
   const data=await this.request(release.url,controller.signal,true);const declared=data.headers.get('content-length');if(declared&&Number(declared)!==release.size){await data.body?.cancel();throw new Error('下载长度与官方发布记录不一致。')}
   const stream=data.body?.getReader();if(!stream)throw new Error('下载内容为空。');
   this.update({phase:'downloading',message:'正在从官方发布页下载…'});const start=Date.now(),hash=createHash('sha256'),magic:number[]=[];let bytes=0,last=0;const output=await fsp.open(temp,'wx');
   try{for(;;){controller.signal.throwIfAborted();if(!this.deps.canNetwork())throw new Error('联网已关闭，下载已停止。');const {done,value}=await stream.read();if(done)break;bytes+=value.length;if(bytes>release.size||bytes>MAX_PACKAGE)throw new Error('下载长度超出官方声明。');for(let i=0;i<value.length&&magic.length<2;i++)magic.push(value[i]);hash.update(value);await output.writeFile(value);if(Date.now()-last>150){last=Date.now();this.update({bytes,bytesPerSecond:bytes/Math.max(.1,(Date.now()-start)/1000)})}}await output.sync()}finally{await output.close();await stream.cancel().catch(()=>{})}
   if(bytes!==release.size||magic[0]!==31||magic[1]!==139)throw new Error('下载内容不是完整的 Unity 素材包。');const sha=hash.digest('hex');if(release.sha256&&sha!==release.sha256)throw new Error('官方安装包 SHA-256 校验失败。');controller.signal.throwIfAborted();
   const file=this.file(id,sha);try{await fsp.copyFile(this.safe(temp),file,fs.constants.COPYFILE_EXCL)}catch(error:any){if(error.code!=='EEXIST')throw error;if(await fileHash(file)!==sha)throw new Error('已有插件缓存损坏，请移走该缓存文件后重试。')}
   const asset=this.getAsset(`plugin:${id}:${sha}`);if(!asset)throw new Error('下载完成但无法读取安装包。');this.update({phase:'ready',bytes,bytesPerSecond:bytes/Math.max(.1,(Date.now()-start)/1000),assetId:asset.id,message:release.sha256?'官方安装包已下载并核对 SHA-256。':'官方未提供摘要；已检查大小与格式，并记录本地 SHA-256。'});return asset;
  }catch(error){this.update({phase:controller.signal.aborted?'cancelled':'failed',message:controller.signal.aborted?'下载已取消或超时，可重新尝试。':error instanceof Error?error.message:String(error)});throw error}
  finally{clearTimeout(timeout);if(temp)await fsp.unlink(this.safe(temp)).catch(()=>{})}
 }
}
