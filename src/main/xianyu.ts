import {BrowserWindow,WebContentsView,ipcMain,session,safeStorage,dialog,clipboard,nativeImage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';
import {assertSafeWrite,isWithin} from './safety';
import {isPublicAddress} from './online';
import {normalizeTheme,THEME_BACKGROUNDS} from '../shared/contracts';
import type {AppTheme} from '../shared/contracts';

export interface XianyuWorkspaceDependencies {
 parent:()=>BrowserWindow|null;dataDir:string;roots:()=>string[];getTheme?:()=>AppTheme;canNetwork:()=>boolean;isEnabled:()=>boolean;
 validateAsset:(id:string)=>{title:string;coverPath?:string};searchBooth:(assetId:string,editableQuery:string)=>Promise<unknown>|unknown;
}
const official=(host:string)=>/(?:^|\.)goofish\.com$/i.test(host);
const login=(host:string)=>/^(?:login|passport|member|reg)\.taobao\.com$|^(?:passport|login)\.alibaba\.com$|^login\.aliexpress\.com$/i.test(host);
const credentialHost=(host:string)=>official(host.replace(/^\./,''))||/(?:^|\.)(?:taobao\.com|alibaba\.com)$/i.test(host.replace(/^\./,''));
const resource=(host:string)=>official(host)||login(host)||/(?:^|\.)(?:alicdn\.com|tbcdn\.cn|mmstat\.com|alilog\.com|alipayobjects\.com)$/i.test(host)||/^(?:h5api|acs|log|ynuf|secdev|fourier|cf)\.(?:m\.)?taobao\.com$/i.test(host);
function https(raw:string):URL {
 if(typeof raw!=='string'||raw.length>16384)throw new Error('网址无效。');let u:URL;try{u=new URL(raw)}catch{throw new Error('请输入完整 HTTPS 网址。')}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.hostname.endsWith('.'))throw new Error('只允许官方 HTTPS 页面。');return u;
}
/** Only official Xianyu pages and narrowly scoped account hosts may become documents. */
export function xianyuBrowserUrl(raw:string):URL {const u=https(raw);if(!official(u.hostname)&&!login(u.hostname))throw new Error('仅允许闲鱼官网和所需的官方登录页面。');return u}
export function xianyuRequestAllowed(raw:string,method:string,resourceType:string):boolean {
 try{if(raw==='about:blank'&&resourceType!=='mainFrame')return true;if(/^data:image\//i.test(raw)&&resourceType==='image')return true;
  const u=https(raw.startsWith('blob:https://')?raw.slice(5):raw);if(['mainFrame','subFrame'].includes(resourceType)){xianyuBrowserUrl(u.href);return ['GET','HEAD','POST','OPTIONS'].includes(method)}
  if(!resource(u.hostname))return false;return ['GET','HEAD','OPTIONS'].includes(method)||method==='POST'&&(official(u.hostname)||login(u.hostname)||/^h5api\.m\.taobao\.com$/i.test(u.hostname));
 }catch{return false}
}
export function xianyuKeyword(raw:string):string {if(typeof raw!=='string')throw new Error('请输入商品名称。');const q=raw.trim();if(!q||q.length>300||/[\x00-\x1f]/.test(q)||/(?:https?:\/\/|www\.)/i.test(q))throw new Error('请输入 1 至 300 字的商品名称；先从链接中整理名称。');return q}
/** Never fetch a pasted link, and never interpret marketplace item IDs as BOOTH IDs. */
export function xianyuDraftName(raw:string):string {if(typeof raw!=='string'||raw.length>8000)throw new Error('粘贴内容过长。');return raw.replace(/https?:\/\/[^\s<>"\u3000]+/gi,' ').replace(/【(?:闲鱼|咸鱼)】|\[(?:闲鱼|咸鱼)\]/g,' ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,300)}
export function xianyuSessionDir(dataDir:string):string {return path.join(dataDir,'xianyu-session')}
export interface XianyuImage {png:Buffer;width:number;height:number;label:string}
function noLinks(file:string):void {for(let current=path.resolve(file);;current=path.dirname(current)){if(fs.lstatSync(current).isSymbolicLink())throw new Error('图片路径包含链接，已阻止。');if(path.dirname(current)===current)break}}
function normalizedImage(bytes:Buffer,label:string):XianyuImage {if(!bytes.length||bytes.length>25*1024*1024)throw new Error('请选择不超过 25 MB 的图片。');const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('无法读取图片，请选择 PNG、JPEG、WebP、GIF 或 BMP。');const {width,height}=image.getSize();if(width<1||height<1||width*height>32*1024*1024)throw new Error('图片尺寸过大，请选择不超过 3200 万像素的图片。');const png=image.toPNG();if(png.length>25*1024*1024)throw new Error('图片转换后超过 25 MB，请选择较小图片。');return {png,width,height,label}}
export function readXianyuImage(file:string):XianyuImage {
 if(typeof file!=='string'||!path.isAbsolute(file)||!['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(path.extname(file).toLowerCase()))throw new Error('请选择本地图片文件。');noLinks(file);const fd=fs.openSync(file,fs.constants.O_RDONLY);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>25*1024*1024)throw new Error('请选择不超过 25 MB 的普通图片文件。');const bytes=Buffer.alloc(stat.size+1);let length=0;while(length<bytes.length){const count=fs.readSync(fd,bytes,length,bytes.length-length,null);if(!count)break;length+=count}if(length!==stat.size)throw new Error('图片读取期间发生变化，请重新选择。');noLinks(file);return normalizedImage(bytes.subarray(0,length),path.basename(file))}finally{fs.closeSync(fd)}
}
export function saveXianyuImage(bytes:Buffer,destination:string,dataDir:string,roots:string[]):void {if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>25*1024*1024)throw new Error('图片无效。');if(path.extname(destination).toLowerCase()!=='.png')throw new Error('请保存为 PNG 图片。');const safe=assertSafeWrite(destination,dataDir,roots,true);fs.writeFileSync(safe,bytes,{flag:'wx'})}

interface Entry {window:BrowserWindow;view:WebContentsView;channel:string;toolbarUrl:string;assetId:string;title:string;image?:XianyuImage;draft:string;result:string;status:string;officialVisible:boolean;toolbarHeight:number;closed:boolean;busy:boolean}
export class XianyuWorkspace {
 private entry?:Entry;private remoteSession?:Electron.Session;private initializing?:Promise<void>;private stopping=false;private owned=new Set<Electron.WebContents>();private popups=new Set<BrowserWindow>();private dns=new Map<string,Promise<void>>();private cookieWrite=Promise.resolve();private generation=0;
 constructor(private readonly deps:XianyuWorkspaceDependencies){}
 private file(name:string):string {return assertSafeWrite(path.join(this.deps.dataDir,name),this.deps.dataDir,this.deps.roots())}
 private theme():AppTheme {return normalizeTheme(this.deps.getTheme?.())}
 private isEnabled():boolean {return this.deps.isEnabled?.()===true}
 private canNetwork():boolean {return this.isEnabled()&&this.deps.canNetwork()}
 private assertEnabled():void {if(!this.isEnabled())throw new Error('闲鱼辅助搜索未开启，请先在设置中开启并确认使用提醒。')}
 async open(assetId:string):Promise<void> {
  this.assertEnabled();
  if(typeof assetId!=='string')throw new Error('素材无效。');const material=this.deps.validateAsset(assetId),generation=++this.generation;this.stopping=false;await this.initialize();if(generation!==this.generation||this.stopping)return;
  // A material change discards the previous private image and draft rather than accidentally rebinding them.
  if(this.entry){if(this.entry.assetId===assetId){this.entry.window.show();this.emit();return}this.close()}
  const channel='vrc-xianyu:'+randomUUID(),toolbarPath=path.resolve(__dirname,'../../../assets/xianyu.html');
  const window=new BrowserWindow({width:1180,height:900,minWidth:760,minHeight:600,title:'闲鱼辅助搜图 · '+material.title,parent:this.deps.parent()??undefined,show:false,autoHideMenuBar:true,backgroundColor:THEME_BACKGROUNDS[this.theme()],webPreferences:{preload:path.join(__dirname,'xianyu-preload.js'),additionalArguments:['--vrc-xianyu-channel='+channel,'--vrc-theme='+this.theme()],partition:'vrc-xianyu-toolbar-'+randomUUID(),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,devTools:false}});
  const view=new WebContentsView({webPreferences:this.remotePreferences()}),entry:Entry={window,view,channel,toolbarUrl:pathToFileURL(toolbarPath).href,assetId,title:material.title.slice(0,1000),draft:'',result:'',status:'图片仅在本机预览，尚未发送。',officialVisible:false,toolbarHeight:150,closed:false,busy:false};this.entry=entry;
  if(material.coverPath)try{const cover=path.resolve(material.coverPath);if(![this.deps.dataDir,...this.deps.roots()].some(root=>isWithin(cover,root)))throw new Error();entry.image=readXianyuImage(cover)}catch{entry.status='当前封面不可读取；请选择或粘贴一张图片。'}
  window.setMenu(null);window.contentView.addChildView(view);view.setBackgroundColor('#ffffff');this.owned.add(view.webContents);window.on('resize',()=>this.layout(entry));this.layout(entry);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.on('will-attach-webview',e=>e.preventDefault());this.protectContents(view.webContents);
  ipcMain.handle(channel,async(event,input:unknown)=>{if(this.entry!==entry||entry.closed||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.sender.getURL()!==entry.toolbarUrl)throw new Error('辅助窗口操作来源无效。');return this.command(entry,input)});
  window.once('closed',()=>this.dispose(entry));try{await window.loadFile(toolbarPath);if(entry.closed)return;this.emit();if(!process.env.VRC_LIBRARY_TEST_HIDDEN)window.show()}catch(error){this.dispose(entry);throw error}
 }
 private async command(entry:Entry,input:unknown):Promise<unknown> {
  const data=input&&typeof input==='object'?input as Record<string,unknown>:{},command=typeof input==='string'?input:data.command;
  if(typeof command!=='string'||!['state','close','choose','paste','save','currentCover','extract','draft','result','searchBooth','openOfficial','local','reload','layout'].includes(command))throw new Error('辅助窗口操作无效。');
  if(command==='close'){entry.window.close();return}this.assertEnabled();
  if(command==='state')return this.state();if(command==='layout'){const height=data.height;if(typeof height==='number'&&Number.isFinite(height))entry.toolbarHeight=Math.max(64,Math.min(1000,Math.ceil(height)));this.layout(entry);return}
  if(command==='draft'){entry.draft=typeof data.query==='string'?data.query.slice(0,300):entry.draft;return this.state()}
  if(command==='result'){if(typeof data.text!=='string'||data.text.length>8000)throw new Error('粘贴内容过长。');entry.result=data.text;return this.state()}
  if(command==='extract'){if(typeof data.text!=='string')throw new Error('请输入闲鱼结果的标题或链接。');entry.result=data.text.slice(0,8000);entry.draft=xianyuDraftName(data.text);entry.status=entry.draft?'已整理为名称草稿，请编辑并核对后搜索 BOOTH。':'链接本身不含商品名称；请从闲鱼复制商品标题后粘贴。';this.emit();return this.state()}
  if(command==='local'){entry.officialVisible=false;this.layout(entry);this.emit();return this.state()}
  if(['openOfficial','reload','searchBooth'].includes(command)&&!this.canNetwork())throw new Error('联网已关闭或暂停；本机图片和名称草稿仍可编辑。');
  if(entry.busy)throw new Error('请等待当前操作完成。');entry.busy=true;
  try{
   if(command==='choose'){const selected=await dialog.showOpenDialog(entry.window,{title:'选择一张图片，仅在本机预览',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','gif','bmp']}]});if(!entry.closed&&!selected.canceled&&selected.filePaths[0]){entry.image=readXianyuImage(selected.filePaths[0]);entry.status='已在本机预览所选图片，尚未发送。'}}
   if(command==='paste'){const items=await clipboard.read(),item=items.find(value=>value.types.some(type=>/^image\/(?:png|jpeg|webp|gif|bmp)$/.test(type))),type=item?.types.find(type=>/^image\/(?:png|jpeg|webp|gif|bmp)$/.test(type));if(!item||!type)throw new Error('剪贴板中没有支持的图片。');const blob=await item.getType(type);if(!('arrayBuffer' in blob))throw new Error('剪贴板图片格式无效。');if(blob.size>25*1024*1024)throw new Error('请选择不超过 25 MB 的图片。');const image=normalizedImage(Buffer.from(await blob.arrayBuffer()),'剪贴板图片');if(!entry.closed){entry.image=image;entry.status='已在本机预览剪贴板图片，尚未发送。'}}
   if(command==='currentCover'){const material=this.deps.validateAsset(entry.assetId);if(!material.coverPath)throw new Error('当前素材没有可用封面。');const cover=path.resolve(material.coverPath);if(![this.deps.dataDir,...this.deps.roots()].some(root=>isWithin(cover,root)))throw new Error('封面路径无效。');entry.image=readXianyuImage(cover);entry.status='已在本机预览当前素材封面，尚未发送。'}
   if(command==='save'){if(!entry.image)throw new Error('请先选择或粘贴图片。');const image=entry.image,selected=await dialog.showSaveDialog(entry.window,{title:'保存图片副本，供手机闲鱼 App 选取',defaultPath:'xianyu-image-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png',filters:[{name:'PNG 图片',extensions:['png']}],properties:['showOverwriteConfirmation']});if(!entry.closed&&!selected.canceled&&selected.filePath){saveXianyuImage(image.png,selected.filePath,this.deps.dataDir,this.deps.roots());entry.status='图片副本已保存。传到手机后，在闲鱼 App 手动选图；这里没有上传图片。'}}
   if(command==='searchBooth'){this.deps.validateAsset(entry.assetId);const query=xianyuKeyword(data.query as string);entry.draft=query;await this.deps.searchBooth(entry.assetId,query);entry.status='已用名称搜索 BOOTH；请在 BOOTH 核对商品后再应用，来源可在素材库撤回。'}
   if(command==='openOfficial'){entry.officialVisible=true;this.layout(entry);entry.status='闲鱼官网仅作浏览；本机预览图片没有传给网页。';await entry.view.webContents.loadURL('https://www.goofish.com/')}
   if(command==='reload'){entry.view.webContents.reload()}
  }finally{entry.busy=false;this.emit()}return this.state();
 }
 private state():unknown {const e=this.entry;if(!e||e.closed)return;let url='';try{const u=xianyuBrowserUrl(e.view.webContents.getURL());url=u.origin+u.pathname}catch{}return {title:e.title,image:e.image?{dataUrl:'data:image/png;base64,'+e.image.png.toString('base64'),label:e.image.label,width:e.image.width,height:e.image.height}:undefined,draft:e.draft,result:e.result,status:e.status,officialVisible:e.officialVisible,online:this.canNetwork(),busy:e.busy,theme:this.theme(),url,sessionSaved:safeStorage.isEncryptionAvailable()}}
 private emit():void {const e=this.entry;if(e&&!e.closed&&!e.window.webContents.isDestroyed())e.window.webContents.send(e.channel+':state',this.state())}
 private status(message:string):void {if(this.entry){this.entry.status=message;this.emit()}}
 private layout(e:Entry):void {if(e.closed)return;const [width,height]=e.window.getContentSize(),zoom=e.window.webContents.getZoomFactor?.()??1,top=Math.min(Math.ceil(e.toolbarHeight*zoom),Math.max(64,height-120));e.view.setBounds(e.officialVisible?{x:0,y:top,width,height:Math.max(0,height-top)}:{x:width,y:height,width:0,height:0})}
 refreshTheme():void {if(this.entry){this.entry.window.setBackgroundColor(THEME_BACKGROUNDS[this.theme()]);this.emit()}}
 networkChanged():void {if(!this.canNetwork()){for(const contents of this.owned)if(!contents.isDestroyed())contents.stop();void this.remoteSession?.closeAllConnections();this.status('联网已关闭或暂停；图片和名称草稿保留在本机。')}if(!this.isEnabled()){this.close();return}this.emit()}
 close():void {this.generation++;if(this.entry)this.dispose(this.entry);for(const popup of [...this.popups])if(!popup.isDestroyed())popup.destroy();this.popups.clear()}
 private dispose(e:Entry):void {if(e.closed)return;e.closed=true;ipcMain.removeHandler(e.channel);this.owned.delete(e.view.webContents);if(!e.view.webContents.isDestroyed())e.view.webContents.close();e.image=undefined;if(!e.window.isDestroyed())e.window.destroy();if(this.entry===e)this.entry=undefined}
 async shutdown():Promise<void> {this.stopping=true;++this.generation;this.close();await this.initializing;await this.flushCookies();await this.remoteSession?.cookies.flushStore();this.remoteSession?.flushStorageData()}
 private remotePreferences():Electron.WebPreferences {return {session:this.remoteSession,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,disableDialogs:true,devTools:false}}
 private initialize():Promise<void> {return this.initializing??=(async()=>{const folder=this.file('xianyu-session');fs.mkdirSync(folder,{recursive:true});const remote=this.remoteSession=session.fromPath(folder,{cache:true});remote.setPermissionCheckHandler(()=>false);remote.setPermissionRequestHandler((_c,_p,callback)=>callback(false));remote.setDevicePermissionHandler(()=>false);remote.on('will-download',event=>{event.preventDefault();this.status('辅助窗口不下载文件；请使用图片副本和手机闲鱼 App。')});remote.webRequest.onBeforeRequest((details,callback)=>{
   if(this.stopping||!this.canNetwork()||!xianyuRequestAllowed(details.url,details.method,details.resourceType)){callback({cancel:true});return}if(details.url==='about:blank'||details.url.startsWith('data:')){callback({cancel:false});return}let host:string;try{host=https(details.url.startsWith('blob:')?details.url.slice(5):details.url).hostname}catch{callback({cancel:true});return}void this.publicHost(host).then(()=>callback({cancel:this.stopping||!this.canNetwork()})).catch(()=>callback({cancel:true}));
  });await this.restoreCookies()})()}
 private async publicHost(host:string):Promise<void> {let pending=this.dns.get(host);if(!pending){pending=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const records=await Promise.race([lookup(host,{all:true,verbatim:true}),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),5000)})]);if(!records.length||records.some(r=>!isPublicAddress(r.address)))throw new Error('非公开网络地址。')}finally{if(timer)clearTimeout(timer)}})();this.dns.set(host,pending);if(this.dns.size>100)this.dns.delete(this.dns.keys().next().value!);void pending.catch(()=>this.dns.delete(host))}await pending}
 private protectContents(contents:Electron.WebContents):void {
  const guard=(event:Electron.Event&{url:string;isMainFrame?:boolean})=>{try{if(event.url==='about:blank'&&!event.isMainFrame)return;xianyuBrowserUrl(event.url);if(!this.canNetwork())throw new Error()}catch{event.preventDefault();this.status('已阻止非官方、本地或离线网页跳转。')}};
  contents.on('will-frame-navigate',guard);contents.on('will-redirect',guard);contents.on('will-attach-webview',e=>e.preventDefault());contents.on('login',(e,_details,_auth,callback)=>{e.preventDefault();callback()});
  contents.setWindowOpenHandler(details=>{try{xianyuBrowserUrl(details.url);if(!this.canNetwork()||this.stopping)throw new Error();return {action:'allow',overrideBrowserWindowOptions:{parent:this.entry?.window,width:980,height:800,autoHideMenuBar:true,webPreferences:this.remotePreferences()}}}catch{return {action:'deny'}}});
  contents.on('did-create-window',popup=>{popup.setMenu(null);this.popups.add(popup);this.owned.add(popup.webContents);this.protectContents(popup.webContents);popup.once('closed',()=>{this.popups.delete(popup);this.owned.delete(popup.webContents)})});
  contents.on('did-finish-load',()=>{this.status('官网浏览中；网页暂无已确认可用的图搜入口，可返回图片与名称使用 App 方式。')});contents.on('did-navigate-in-page',()=>this.emit());contents.on('did-fail-load',(_e,code,_d,_u,main)=>{if(main&&code!==-3)this.status('官网暂时不可用。可返回图片与名称，保存图片后在手机 App 手动搜图。')});contents.on('render-process-gone',()=>this.status('官网页面已退出；可返回本机图片与名称，或重载官网。'));
 }
 private async restoreCookies():Promise<void> {if(!this.remoteSession||!safeStorage.isEncryptionAvailable())return;try{const file=this.file('xianyu-session-cookies.bin'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)return;const payload=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));if(!Number.isFinite(payload.at)||Date.now()-payload.at>30*86400000||payload.at>Date.now()+60000||!Array.isArray(payload.cookies))return;const existing=await this.remoteSession.cookies.get({});for(const cookie of payload.cookies.slice(0,100)){if(!cookie||!cookie.session||typeof cookie.name!=='string'||typeof cookie.value!=='string'||typeof cookie.domain!=='string'||!credentialHost(cookie.domain)||existing.some(c=>c.name===cookie.name&&c.domain===cookie.domain&&c.path===cookie.path))continue;await this.remoteSession.cookies.set({url:'https://'+cookie.domain.replace(/^\./,'')+(cookie.path||'/'),name:cookie.name,value:cookie.value,domain:cookie.hostOnly?undefined:cookie.domain,path:cookie.path||'/',httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite})}}catch{/* Login remains possible if the OS cannot decrypt an old local session. */}}
 private flushCookies():Promise<void> {if(!this.remoteSession||!safeStorage.isEncryptionAvailable())return Promise.resolve();const remote=this.remoteSession;this.cookieWrite=this.cookieWrite.then(async()=>{const cookies=(await remote.cookies.get({})).filter(c=>c.session&&credentialHost(c.domain||'')).slice(0,100),file=this.file('xianyu-session-cookies.bin'),tmp=this.file('xianyu-session-cookies.bin.'+randomUUID()+'.tmp');try{fs.writeFileSync(tmp,safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies})),{flag:'wx'});assertSafeWrite(file,this.deps.dataDir,this.deps.roots());fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}}).catch(()=>this.status('登录状态未能保存，下次可能需要重新登录。'));return this.cookieWrite}
}
