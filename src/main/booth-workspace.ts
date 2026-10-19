import {BrowserWindow,WebContentsView,ipcMain,session,safeStorage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';
import {assertSafeWrite,isWithin} from './safety';
import {isPublicAddress} from './online';
import {normalizeTheme,THEME_BACKGROUNDS} from '../shared/contracts';
import type {BoothTab,BoothDownload,BoothState,AppTheme,AppLanguage} from '../shared/contracts';
import {normalizeLanguage,translate} from '../shared/i18n';
import {NATIVE_MESSAGES} from '../shared/messages-native';
import {snapshotBrowserCookies} from './browser-cookie-migration';

export interface BoothWorkspaceDependencies {
 parent:()=>BrowserWindow|null;dataDir:string;roots:()=>string[];getDownloadDir:()=>string|undefined;canNetwork:()=>boolean;
 getTheme?:()=>AppTheme;
 getLanguage?:()=>AppLanguage;
 validateAsset:(id:string)=>{title:string};applyProduct:(id:string,url:string)=>Promise<void>;
 onChanged:()=>void;onDownloaded:(file:string,sourceItem?:string)=>Promise<{assetId?:string}>;
}
export interface BoothOpenOptions {tab:BoothTab|'search';query?:string;assetId?:string}
export const BOOTH_ACCOUNT_URLS={login:'https://accounts.booth.pm/users/sign_in',favorites:'https://accounts.booth.pm/wish_lists',gifts:'https://accounts.booth.pm/library/gifts',library:'https://accounts.booth.pm/library'} as const;
const HEIGHT=166,MAX_HISTORY=100,COOKIE_AGE=30*24*60*60*1000;
const officialHost=(hostname:string)=>/(?:^|\.)booth\.pm$/i.test(hostname);
const cookieHost=(hostname:string)=>/(?:^|\.)(?:booth\.pm|pixiv\.net)$/i.test(hostname.replace(/^\./,''));
function mirroredCookie(cookie:any,now=Date.now()/1000):cookie is Electron.Cookie&{domain:string} {
 if(!cookie||typeof cookie.name!=='string'||!cookie.name||/[\x00-\x20\x7f;=]/.test(cookie.name)||typeof cookie.value!=='string'||/[\x00-\x1f\x7f]/.test(cookie.value)||Buffer.byteLength(cookie.name)+Buffer.byteLength(cookie.value)>16384||typeof cookie.domain!=='string'||cookie.domain.length>254||!/^\.?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(cookie.domain)||cookie.domain.replace(/^\./,'').split('.').some((label:string)=>label.length>63)||!cookieHost(cookie.domain))return false;
 if(cookie.path!==undefined&&(typeof cookie.path!=='string'||!cookie.path.startsWith('/')||cookie.path.length>4096||/[\x00-\x1f\x7f;]/.test(cookie.path)))return false;
 if(['hostOnly','httpOnly','secure','session'].some(key=>cookie[key]!==undefined&&typeof cookie[key]!=='boolean')||cookie.sameSite!==undefined&&!['unspecified','no_restriction','lax','strict'].includes(cookie.sameSite))return false;
 return cookie.expirationDate===undefined?cookie.session===true:cookie.session!==true&&Number.isFinite(cookie.expirationDate)&&cookie.expirationDate>now&&cookie.expirationDate<=8640000000000;
}
function cookieKey(cookie:Electron.Cookie):string {return JSON.stringify([cookie.name,(cookie.domain||'').replace(/^\./,'').toLowerCase(),cookie.path||'/'])}
function encryptedCookieMirror(cookies:Electron.Cookie[]):Buffer {
 const at=Date.now(),encode=()=>safeStorage.encryptString(JSON.stringify({at,cookies}));let encrypted=encode();
 while(encrypted.length>256*1024&&cookies.length){cookies.pop();encrypted=encode()}
 if(encrypted.length>256*1024)throw new Error('Encrypted cookie mirror exceeds its size limit.');return encrypted;
}
export function prepareBoothSessionMigration(dataDir:string,roots:string[]){return snapshotBrowserCookies(dataDir,roots,'booth-session',mirroredCookie,cookieKey)}
const loginHost=(hostname:string)=>/(?:^|\.)(?:booth\.pm|pixiv\.net|google\.com|recaptcha\.net|apple\.com|twitter\.com|x\.com)$/i.test(hostname);
/** Unlike public metadata fetches, this browser intentionally permits official login paths. */
export function boothBrowserUrl(raw:string):URL {
 if(typeof raw!=='string'||raw.length>16384)throw new Error('网址无效。');let url:URL;try{url=new URL(raw)}catch{throw new Error('请输入完整 HTTPS 网址。')}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host))throw new Error('只允许公开 HTTPS 网站。');
 return url;
}
export function boothAppliedProduct(raw:string):string|undefined {try{const url=boothBrowserUrl(raw);if(!officialHost(url.hostname))return;const match=url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/(\d{1,12})\/?$/i);return match?'https://booth.pm/zh-cn/items/'+match[1]:undefined}catch{return undefined}}
export function boothSearchUrl(query:string):string {
 if(typeof query!=='string'||!query.trim()||query.length>300)throw new Error('请输入 1 至 300 字的搜索词。');const value=query.trim();
 if(/^\d{1,12}$/.test(value))return 'https://booth.pm/zh-cn/items/'+value;
 if(/^https:\/\//i.test(value)){const product=boothAppliedProduct(value);if(!product)throw new Error('请输入 BOOTH 商品网址、编号或搜索词。');return product}
 return 'https://booth.pm/zh-cn/search/'+encodeURIComponent(value);
}
export function boothDownloadName(raw:string):string {
 const value=String(raw||'download').normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').trim();
 let name=value||'download';if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
 if(name.length>180){const extension=path.extname(name).slice(0,20);name=name.slice(0,180-extension.length)+extension}return name;
}
export function reserveBoothDownload(directory:string,filename:string,dataDir:string,roots:string[],id=randomUUID()):string {
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('下载任务无效。');
 const root=assertSafeWrite(directory,dataDir,roots,true);if(!fs.lstatSync(root).isDirectory())throw new Error('请选择有效的下载文件夹。');
 const folder=assertSafeWrite(path.join(root,'booth-'+id),dataDir,roots,true);fs.mkdirSync(folder); // Exclusive new task folder; never reuse or overwrite an existing file.
 return assertSafeWrite(path.join(folder,boothDownloadName(filename)),dataDir,roots,true);
}
interface StoredDownload extends BoothDownload {file?:string}
interface Entry {window:BrowserWindow;view:WebContentsView;channel:string;toolbarUrl:string;assetId?:string;title:string;tab:BoothTab|'search';query:string;status:string;statusValues?:Record<string,string|number>;loading:boolean;loaded:boolean;lastLoadedUrl?:string;httpError:boolean;busy:boolean;applied?:string;closed:boolean}
interface BrowserState {title:string;tab:string;query:string;url:string;status:string;loading:boolean;canApply:boolean;canGoBack:boolean;canGoForward:boolean;applied:boolean;downloadDir?:string;sessionSaved:boolean;activeDownloads:number;theme:AppTheme;language:AppLanguage;messages:Record<string,string>}
export class BoothWorkspace {
 private remoteSession?:Electron.Session;private entry?:Entry;private owned=new Set<Electron.WebContents>();private popups=new Set<BrowserWindow>();
 private downloads:StoredDownload[]=[];private activeItems=new Map<string,Electron.DownloadItem>();private dns=new Map<string,{at:number;promise:Promise<void>}>();
 private cookieTimer?:ReturnType<typeof setTimeout>;private restoringCookies=false;private clearing=false;private stopping=false;private cookieWrite=Promise.resolve();private initializing?:Promise<void>;private inFlightImports=new Set<Promise<void>>();
 private sessionHooksInstalled=false;
 private readonly downloadListener=(event:Electron.Event,item:Electron.DownloadItem,contents:Electron.WebContents)=>this.startDownload(event,item,contents);
 private readonly cookieListener=(_event:Electron.Event,cookie:Electron.Cookie)=>{if(!this.restoringCookies&&!this.clearing&&cookieHost(cookie.domain||'')){if(this.cookieTimer)clearTimeout(this.cookieTimer);this.cookieTimer=setTimeout(()=>{this.cookieTimer=undefined;void this.flushCookies()},300)}};
 constructor(private readonly deps:BoothWorkspaceDependencies){this.loadHistory()}
 private file(name:string):string {return assertSafeWrite(path.join(this.deps.dataDir,name),this.deps.dataDir,this.deps.roots())}
 snapshot():BoothState {return {downloadDir:this.deps.getDownloadDir(),sessionSaved:!!this.remoteSession&&safeStorage.isEncryptionAvailable(),downloads:this.downloads.map(({file:_file,...publicItem})=>({...publicItem})),active:!!this.entry&&!this.entry.closed}}
 downloadPath(id:string):string|undefined {
  const item=this.downloads.find(value=>value.id===id);if(!item?.file||item.state!=='completed')return;
  const file=assertSafeWrite(item.file,this.deps.dataDir,this.deps.roots(),true),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('下载文件已移动或不是普通文件。');return file;
 }
 cancelDownload(id:string):void {if(typeof id!=='string')throw new Error('下载任务无效。');const item=this.activeItems.get(id);if(item)item.cancel()}
 async retryImport(id:string):Promise<{assetId?:string}> {const record=this.downloads.find(value=>value.id===id);if(!record||record.state!=='completed')throw new Error('请选择已完成的下载。');if(record.assetId)return {assetId:record.assetId};const file=this.downloadPath(id);if(!file)throw new Error('下载文件不存在。');await this.importDownload(record,file);return {assetId:record.assetId}}
 networkChanged():void {if(!this.deps.canNetwork()){for(const [id,item] of this.activeItems){const record=this.downloads.find(value=>value.id===id);if(record)record.error='联网已关闭；请回 BOOTH 重新点击下载。';item.cancel()}for(const contents of this.owned)if(!contents.isDestroyed())contents.stop()}this.notify()}
 async open(options:BoothOpenOptions):Promise<void> {
  if(!this.deps.canNetwork())throw new Error('请先开启联网，再打开 BOOTH。');
  if(!options||!['login','favorites','gifts','library','search'].includes(options.tab))throw new Error('BOOTH 页面无效。');
  const title=options.assetId?this.deps.validateAsset(options.assetId).title:'BOOTH 账户与资料库';
  const target=options.tab==='search'?boothSearchUrl(options.query||''):BOOTH_ACCOUNT_URLS[options.tab];
  this.stopping=false;await this.initialize();this.installSessionHooks();
  if(this.entry&&!this.entry.closed){const entry=this.entry;entry.assetId=options.assetId;entry.title=title;entry.tab=options.tab;entry.query=options.query||'';entry.applied=undefined;entry.window.setTitle(options.assetId?this.t('为素材选择 BOOTH 商品')+' · '+title:this.t('BOOTH 账户与资料库'));this.emit();if(!process.env.VRC_LIBRARY_TEST_HIDDEN)entry.window.show();await this.navigate(entry,target);return}
  const channel='vrc-booth:'+randomUUID(),toolbarPath=path.resolve(__dirname,'../../../assets/booth-workspace.html');
  const window=new BrowserWindow({width:1200,height:900,minWidth:820,minHeight:560,title:options.assetId?this.t('为素材选择 BOOTH 商品')+' · '+title:this.t('BOOTH 账户与资料库'),parent:this.deps.parent()??undefined,show:false,autoHideMenuBar:true,backgroundColor:THEME_BACKGROUNDS[this.theme()],webPreferences:{preload:path.join(__dirname,'booth-workspace-preload.js'),additionalArguments:['--vrc-booth-channel='+channel,'--vrc-theme='+this.theme(),'--vrc-language='+this.language()],partition:'vrc-booth-toolbar-'+randomUUID(),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,devTools:false}});
  const view=new WebContentsView({webPreferences:this.remotePreferences()}),entry:Entry={window,view,channel,toolbarUrl:pathToFileURL(toolbarPath).href,assetId:options.assetId,title,tab:options.tab,query:options.query||'',status:'正在打开 BOOTH…',loading:true,loaded:false,httpError:false,busy:false,closed:false};
  this.entry=entry;window.setMenu(null);window.contentView.addChildView(view);view.setBackgroundColor('#ffffff');this.owned.add(view.webContents);
  const layout=()=>{if(entry.closed)return;const [width,height]=window.getContentSize();view.setBounds({x:0,y:HEIGHT,width,height:Math.max(0,height-HEIGHT)})};window.on('resize',layout);layout();
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
  this.protectContents(view.webContents,true);ipcMain.handle(channel,async(event,input:unknown)=>{
   try{
   if(this.entry!==entry||entry.closed||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.sender.getURL()!==entry.toolbarUrl)throw new Error('浏览器操作来源无效。');
   const command=typeof input==='string'?input:(input&&typeof input==='object'?(input as {command?:unknown}).command:undefined);
   if(typeof command!=='string'||!['state','back','forward','reload','apply','close','search','tab'].includes(command))throw new Error('浏览器操作无效。');
   if(command==='state')return this.browserState();if(command==='close'){window.close();return}if(command==='apply'){await this.apply(entry);return this.browserState()}
   if(!this.deps.canNetwork())throw new Error('联网已关闭。');if(entry.busy)return this.browserState();
   const remote=view.webContents;
   if(command==='search'){const query=(input as {query?:unknown}).query;if(typeof query!=='string')throw new Error('搜索词无效。');const url=boothSearchUrl(query);entry.query=query.trim();entry.tab='search';await this.navigate(entry,url)}
   if(command==='tab'){const tab=(input as {tab?:unknown}).tab;if(typeof tab!=='string'||!Object.hasOwn(BOOTH_ACCOUNT_URLS,tab))throw new Error('账户页面无效。');entry.tab=tab as BoothTab;await this.navigate(entry,BOOTH_ACCOUNT_URLS[tab as BoothTab])}
   if(command==='back'&&remote.navigationHistory.canGoBack())remote.navigationHistory.goBack();if(command==='forward'&&remote.navigationHistory.canGoForward())remote.navigationHistory.goForward();if(command==='reload')remote.reload();return this.browserState();
   }catch(error){throw new Error(this.t(error instanceof Error?error.message:'操作失败'))}
  });
  window.once('closed',()=>{this.disposeEntry(entry);this.notify()});
  try{await window.loadFile(toolbarPath);if(entry.closed)return;this.emit();if(!process.env.VRC_LIBRARY_TEST_HIDDEN)window.show();void this.navigate(entry,target);this.notify()}catch(error){this.disposeEntry(entry);throw error}
 }
 close():void {if(this.entry)this.disposeEntry(this.entry);for(const popup of [...this.popups])if(!popup.isDestroyed())popup.destroy();this.popups.clear();this.notify()}
 refreshTheme():void {const entry=this.entry;if(entry&&!entry.closed){entry.window.setBackgroundColor(THEME_BACKGROUNDS[this.theme()]);entry.window.setTitle?.(entry.assetId?this.t('为素材选择 BOOTH 商品')+' · '+entry.title:this.t('BOOTH 账户与资料库'));this.emit()}}
 private theme():AppTheme {return normalizeTheme(this.deps.getTheme?.())}
 private language():AppLanguage {return normalizeLanguage(this.deps.getLanguage?.())}
 private messages():Record<string,string> {return Object.fromEntries(Object.keys(NATIVE_MESSAGES).map(source=>[source,this.t(source)]))}
 private t(source:string,values:Record<string,string|number>={}):string {return translate(source,this.language(),values)}
 async shutdown():Promise<void> {this.stopping=true;this.close();this.removeSessionHooks();for(const [id,item] of this.activeItems){const record=this.downloads.find(value=>value.id===id);if(record){record.state='interrupted';record.downloadBps=0;record.error='应用已关闭；请回 BOOTH 重新点击下载。'}item.cancel()}this.activeItems.clear();await Promise.allSettled([...this.inFlightImports]);this.saveHistory();await this.flushCookies();await this.remoteSession?.cookies.flushStore();this.remoteSession?.flushStorageData()}
 async clearSession():Promise<void> {
  this.clearing=true;if(this.cookieTimer)clearTimeout(this.cookieTimer);this.cookieTimer=undefined;
  try{await this.shutdown();await this.cookieWrite;await this.remoteSession?.closeAllConnections();await this.remoteSession?.clearStorageData();await this.remoteSession?.clearCache();const file=this.file('booth-session-cookies.bin');if(fs.existsSync(file))fs.unlinkSync(file);this.notify()}finally{this.clearing=false}
 }
 private remotePreferences():Electron.WebPreferences {return {session:this.remoteSession,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,disableDialogs:true,devTools:false}}
 private async initialize():Promise<void> {if(this.initializing)return this.initializing;this.initializing=this.initializeSession();return this.initializing}
 private async initializeSession():Promise<void> {
  const folder=this.file('booth-session');fs.mkdirSync(folder,{recursive:true});this.remoteSession=session.fromPath(folder,{cache:true});const remote=this.remoteSession;
  remote.setPermissionCheckHandler(()=>false);remote.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));remote.setDevicePermissionHandler(()=>false);
  remote.webRequest.onBeforeRequest((details,callback)=>{
   const deny=()=>{if(details.resourceType==='mainFrame')this.status('已阻止不安全链接，或联网已关闭。');callback({cancel:true})};
   if(this.clearing||this.stopping||!this.deps.canNetwork()){deny();return}
   if(details.resourceType!=='mainFrame'&&((/^data:/i.test(details.url)&&['image','font','media'].includes(details.resourceType))||details.url==='about:blank')){callback({cancel:false});return}
   let raw=details.url;if(details.resourceType!=='mainFrame'&&raw.startsWith('blob:https://'))raw=raw.slice(5);
   try{const url=boothBrowserUrl(raw);if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(details.method)||!['GET','HEAD','OPTIONS'].includes(details.method)&&!loginHost(url.hostname)){deny();return}void this.publicHost(url.hostname).then(()=>callback({cancel:this.clearing||this.stopping||!this.deps.canNetwork()})).catch(deny)}catch{deny()}
  });
  this.installSessionHooks();
  await this.restoreCookies();this.notify();
 }
 private installSessionHooks():void {if(!this.remoteSession||this.sessionHooksInstalled)return;this.remoteSession.on('will-download',this.downloadListener);this.remoteSession.cookies.on('changed',this.cookieListener);this.sessionHooksInstalled=true}
 private removeSessionHooks():void {if(!this.remoteSession||!this.sessionHooksInstalled)return;this.remoteSession.off('will-download',this.downloadListener);this.remoteSession.cookies.off('changed',this.cookieListener);this.sessionHooksInstalled=false;if(this.cookieTimer)clearTimeout(this.cookieTimer);this.cookieTimer=undefined}
 private async publicHost(host:string):Promise<void> {
  const cached=this.dns.get(host);if(cached&&Date.now()-cached.at<60000)return cached.promise;
  const promise=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const records=await Promise.race([lookup(host,{all:true,verbatim:true}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('解析超时')),5000)})]);if(!records.length||records.some(record=>!isPublicAddress(record.address)))throw new Error('地址不公开。')}finally{if(timer)clearTimeout(timer)}})();
  this.dns.set(host,{at:Date.now(),promise});void promise.catch(()=>this.dns.delete(host));if(this.dns.size>128)this.dns.delete(this.dns.keys().next().value!);await promise;
 }
 private protectContents(contents:Electron.WebContents,primary=false):void {
  contents.on('will-attach-webview',event=>event.preventDefault());contents.on('will-frame-navigate',event=>{try{if(!event.isMainFrame&&event.url==='about:blank')return;boothBrowserUrl(event.url)}catch{event.preventDefault();this.status('已阻止非 HTTPS 或本地链接。')}});
  contents.on('will-redirect',event=>{try{boothBrowserUrl(event.url)}catch{event.preventDefault();this.status('已阻止不安全跳转。')}});
  contents.on('login',(event,_details,_auth,callback)=>{event.preventDefault();callback();this.status('此浏览器不处理网络认证弹窗，请使用网站登录页面。')});
  contents.setWindowOpenHandler(details=>{try{boothBrowserUrl(details.url);if(!this.deps.canNetwork()||this.clearing)return {action:'deny'};return {action:'allow',overrideBrowserWindowOptions:{parent:this.entry?.window,width:1000,height:800,autoHideMenuBar:true,webPreferences:this.remotePreferences()}}}catch{this.status('已阻止额外窗口中的本地或不安全网址。');return {action:'deny'}}});
  contents.on('did-create-window',popup=>{popup.setMenu(null);this.popups.add(popup);this.owned.add(popup.webContents);this.protectContents(popup.webContents);popup.once('closed',()=>{this.popups.delete(popup);this.owned.delete(popup.webContents)})});
  if(!primary)return;
  contents.on('did-start-navigation',event=>{if(!event.isMainFrame||!this.entry)return;this.entry.loading=true;this.entry.loaded=false;this.entry.httpError=false;this.entry.status='正在加载 BOOTH 页面…';this.emit()});
  contents.on('did-navigate',(_event,_url,status)=>{if(this.entry&&status>=400){this.entry.httpError=true;this.entry.loaded=false;this.status(status===404?'此页面不存在或商品已下架。':'网页暂时不可用，请检查网络或完成网站验证。')}this.emit()});contents.on('did-navigate-in-page',()=>this.emit());
  contents.on('did-finish-load',()=>{if(!this.entry)return;this.entry.loading=false;this.entry.loaded=!this.entry.httpError;if(!this.entry.httpError){this.entry.lastLoadedUrl=contents.getURL();this.entry.status=boothAppliedProduct(contents.getURL())&&this.entry.assetId?'核对当前商品后，点击“应用此商品”。':'网站登录状态会在本机保存；使用上方搜索或账户入口。'}this.emit()});
  contents.on('did-fail-load',(_event,code,_description,_url,isMain)=>{if(!isMain||!this.entry)return;this.entry.loading=false;const retained=code===-3&&this.deps.canNetwork()&&!this.clearing&&!this.stopping&&this.entry.lastLoadedUrl===contents.getURL();this.entry.loaded=retained;if(retained)this.status('网页仍可浏览；下载状态请在素材库的 BOOTH 页面查看。');else this.status('页面加载失败或已取消，请检查网络或代理后重载。')});
  contents.on('render-process-gone',()=>{if(this.entry){this.entry.loaded=false;this.entry.loading=false;this.status('浏览器页面已退出，请重载。')}});
 }
 private async navigate(entry:Entry,url:string):Promise<void> {if(entry.closed||!this.deps.canNetwork())return;entry.applied=undefined;try{await entry.view.webContents.loadURL(boothBrowserUrl(url).href)}catch{if(!entry.closed)this.status('页面加载失败或已取消，请重载或重新搜索。')}}
 private browserState():BrowserState|undefined {
  const entry=this.entry;if(!entry||entry.closed)return;const contents=entry.view.webContents,url=contents.isDestroyed()?'':contents.getURL(),product=boothAppliedProduct(url);let valid=false;
  if(entry.assetId)try{this.deps.validateAsset(entry.assetId);valid=true}catch{}
  // The toolbar never publishes OAuth parameters, signed download URLs, or login tokens.
  let displayUrl='';try{const parsed=boothBrowserUrl(url);displayUrl=parsed.origin+parsed.pathname}catch{}
  return {title:entry.assetId?entry.title:this.t('BOOTH 账户与资料库'),tab:entry.tab,query:entry.query,url:displayUrl,status:this.t(entry.status,entry.statusValues),loading:entry.loading,canApply:valid&&!!product&&entry.loaded&&!entry.loading&&!entry.busy&&entry.applied!==product&&this.deps.canNetwork(),canGoBack:!contents.isDestroyed()&&contents.navigationHistory.canGoBack(),canGoForward:!contents.isDestroyed()&&contents.navigationHistory.canGoForward(),applied:!!product&&entry.applied===product,downloadDir:this.deps.getDownloadDir(),sessionSaved:safeStorage.isEncryptionAvailable(),activeDownloads:this.activeItems.size,theme:this.theme(),language:this.language(),messages:this.messages()};
 }
 private async apply(entry:Entry):Promise<void> {
  if(!this.browserState()?.canApply||!entry.assetId)throw new Error('请打开有效的 BOOTH 商品页面，再应用到当前素材。');const id=entry.assetId,source=boothAppliedProduct(entry.view.webContents.getURL())!;
  this.deps.validateAsset(id);entry.busy=true;this.status('正在应用当前商品…');try{await this.deps.applyProduct(id,source);if(!entry.closed&&entry.assetId===id){entry.applied=source;this.status('已应用商品；可在素材库撤回本次来源确认。')}}catch{this.status('应用失败，请回素材库查看素材状态后重试。');throw new Error('应用商品失败。')}finally{entry.busy=false;this.emit()}
 }
 private disposeEntry(entry:Entry):void {if(entry.closed)return;entry.closed=true;ipcMain.removeHandler(entry.channel);this.owned.delete(entry.view.webContents);if(!entry.view.webContents.isDestroyed())entry.view.webContents.close();if(!entry.window.isDestroyed())entry.window.destroy();if(this.entry===entry)this.entry=undefined}
 private emit():void {const entry=this.entry;if(entry&&!entry.closed&&!entry.window.webContents.isDestroyed())entry.window.webContents.send(entry.channel+':state',this.browserState())}
 private status(message:string,values?:Record<string,string|number>):void {if(this.entry){this.entry.status=message;this.entry.statusValues=values;this.emit()}}
 private notify():void {this.emit();this.deps.onChanged()}
 private startDownload(event:Electron.Event,item:Electron.DownloadItem,contents:Electron.WebContents):void {
  const reject=(message:string)=>{event.preventDefault();this.status(message)};
  if(!this.deps.canNetwork()||this.clearing||this.stopping||!this.owned.has(contents)||!item.hasUserGesture()){reject('下载须由你在 BOOTH 网页点击；联网关闭时不会下载。');return}
  try{const origin=boothBrowserUrl(item.getInitiatorOrigin());if(!officialHost(origin.hostname))throw new Error();boothBrowserUrl(item.getURL())}catch{reject('仅接收由 BOOTH 网页发起的公开 HTTPS 下载。');return}
  const directory=this.deps.getDownloadDir();if(!directory){reject('请先在素材库的 BOOTH 页面选择下载保存位置，再点击下载。');return}
  const id=randomUUID();let file:string;try{file=reserveBoothDownload(directory,item.getFilename(),this.deps.dataDir,this.deps.roots(),id);item.setSavePath(file)}catch{reject('下载位置受到保护或不可写；请在素材库重新选择位置。');return}
  const sourceUrl=boothAppliedProduct(contents.getURL()),record:StoredDownload={id,name:path.basename(file),file,sourceUrl,state:'downloading',receivedBytes:0,totalBytes:item.getTotalBytes(),downloadBps:0,startedAt:new Date().toISOString()};
  this.downloads.unshift(record);this.downloads=this.downloads.filter((value,index)=>index<MAX_HISTORY||this.activeItems.has(value.id));this.activeItems.set(id,item);this.saveHistory();this.notify();let lastAt=Date.now(),lastBytes=0,lastNotification=0;
  item.on('updated',(_event,state)=>{
   try{assertSafeWrite(file,this.deps.dataDir,this.deps.roots(),true);if(!this.deps.canNetwork()||this.clearing){item.cancel();return}}catch{record.error='保存路径已变化，下载已停止。';item.cancel();return}
   const now=Date.now(),received=item.getReceivedBytes();record.receivedBytes=received;record.totalBytes=item.getTotalBytes();record.downloadBps=state==='interrupted'?0:Math.max(0,(received-lastBytes)*1000/Math.max(1,now-lastAt));record.state=state==='interrupted'?'interrupted':'downloading';lastAt=now;lastBytes=received;
   if(now-lastNotification>=250){lastNotification=now;this.notify()}if(state==='interrupted'){record.error='下载中断；请回 BOOTH 重新点击下载。';this.saveHistory()}
  });
  item.once('done',(_event,state)=>{
   this.activeItems.delete(id);record.receivedBytes=item.getReceivedBytes();record.totalBytes=item.getTotalBytes();record.downloadBps=0;record.finishedAt=new Date().toISOString();
   if(record.state!=='interrupted'||state==='completed')record.state=state==='completed'?'completed':state==='cancelled'?'cancelled':'interrupted';
   if(state!=='completed'){record.error??=state==='cancelled'?'下载已取消；已保留任务记录。':'下载中断；请回 BOOTH 重新点击下载。';this.saveHistory();this.notify();return}
   void this.importDownload(record,file).catch(()=>{});
  });
 }
 private importDownload(record:StoredDownload,file:string):Promise<void> {
  const pending=(async()=>{try{assertSafeWrite(file,this.deps.dataDir,this.deps.roots(),true);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.receivedBytes)throw new Error();const imported=await this.deps.onDownloaded(file,record.sourceUrl);record.assetId=imported.assetId;if(!record.assetId)throw new Error();record.error=undefined;this.status('下载完成并已导入素材库：{name}',{name:record.name})}catch{record.error='文件已保存，但自动导入未完成；可定位文件或重试导入。';throw new Error('文件已保存，但自动导入未完成。')}finally{this.saveHistory();this.notify()}})();
  this.inFlightImports.add(pending);void pending.finally(()=>this.inFlightImports.delete(pending)).catch(()=>{});return pending;
 }
 private loadHistory():void {
  try{const file=this.file('booth-downloads.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)return;const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(parsed))return;
   this.downloads=parsed.slice(0,MAX_HISTORY).filter(value=>value&&typeof value.id==='string'&&/^[a-f0-9-]{36}$/.test(value.id)&&typeof value.name==='string'&&['downloading','completed','interrupted','cancelled','failed'].includes(value.state)).map(value=>({id:value.id,name:boothDownloadName(value.name),state:value.state==='downloading'?'interrupted':value.state,receivedBytes:Math.max(0,Number(value.receivedBytes)||0),totalBytes:Math.max(0,Number(value.totalBytes)||0),downloadBps:0,startedAt:typeof value.startedAt==='string'?value.startedAt:'',finishedAt:typeof value.finishedAt==='string'?value.finishedAt:undefined,assetId:typeof value.assetId==='string'?value.assetId:undefined,sourceUrl:typeof value.sourceUrl==='string'?boothAppliedProduct(value.sourceUrl):undefined,file:typeof value.file==='string'&&path.isAbsolute(value.file)?value.file:undefined,error:value.state==='downloading'?'上次下载未完成，请回 BOOTH 重新点击。':typeof value.error==='string'?value.error.slice(0,300):undefined}));
  }catch{/* An invalid journal never affects browsing or original files. */}
 }
 private saveHistory():void {try{this.writeOwned('booth-downloads.json',Buffer.from(JSON.stringify(this.downloads)))}catch{this.status('下载记录暂时无法保存，请检查资料库位置。')}}
 private writeOwned(name:string,bytes:Buffer):void {const file=this.file(name),temporary=this.file(name+'.'+randomUUID()+'.tmp');fs.writeFileSync(temporary,bytes,{flag:'wx'});try{assertSafeWrite(file,this.deps.dataDir,this.deps.roots());fs.renameSync(temporary,file)}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary)}}
 private async restoreCookies():Promise<void> {
  if(!this.remoteSession||!safeStorage.isEncryptionAvailable())return;const file=this.file('booth-session-cookies.bin');this.restoringCookies=true;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)return;const payload=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));if(!payload||!Number.isFinite(payload.at)||Date.now()-payload.at>COOKIE_AGE||payload.at>Date.now()+60000||!Array.isArray(payload.cookies))return;
   const existing=new Set((await this.remoteSession.cookies.get({})).map(cookieKey));for(const cookie of payload.cookies.slice(0,100)){if(!mirroredCookie(cookie)||existing.has(cookieKey(cookie)))continue;const domain=cookie.domain.replace(/^\./,''),url='https://'+domain+(cookie.path||'/');try{await this.remoteSession.cookies.set({url,domain:cookie.hostOnly?undefined:cookie.domain,path:cookie.path||'/',name:cookie.name,value:cookie.value,secure:cookie.secure,httpOnly:cookie.httpOnly,sameSite:cookie.sameSite,expirationDate:cookie.expirationDate});existing.add(cookieKey(cookie))}catch{/* One rejected or expired cookie does not prevent restoring the remaining official cookies. */}}
  }catch{/* Cookies may be expired or encrypted for another Windows account; website login remains available. */}finally{this.restoringCookies=false}
 }
 private flushCookies():Promise<void> {
  if(!this.remoteSession||!safeStorage.isEncryptionAvailable()||this.clearing)return Promise.resolve();const remote=this.remoteSession;
  this.cookieWrite=this.cookieWrite.then(async()=>{if(this.clearing)return;const cookies=(await remote.cookies.get({})).filter(cookie=>mirroredCookie(cookie)).slice(0,100);if(this.clearing)return;this.writeOwned('booth-session-cookies.bin',encryptedCookieMirror(cookies)) }).catch(()=>{this.status('临时登录状态未能保存；下次可能需要重新登录。')});return this.cookieWrite;
 }
}
