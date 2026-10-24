import {BrowserWindow,WebContentsView,session,safeStorage} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {assertSafeWrite,writeOwnedAtomic} from './safety';
import {isPublicAddress} from './online';
import {snapshotBrowserCookies,persistentCookieDigest} from './browser-cookie-migration';
import {DISCOVERY_WEB_PROVIDERS,type DiscoveryWebProvider} from '../shared/discovery-prompt';
import type {DiscoveryRequest,WebAiWorkspaceBounds,WebAiWorkspaceState} from '../shared/discovery';
import type {BrowserCookieSnapshot} from './storage';
import {discoveryRequest} from './discovery-parser';
import {aiEditorScript,aiReplyScript,inAppDiscoveryPrompt,parseInAppDiscoveryReply} from './discovery-ai-dom';

export interface DiscoveryAiWorkspaceDependencies {parent:()=>BrowserWindow|undefined;dataDir:string;roots:()=>string[];canNetwork:()=>boolean}
const SOURCE_WORLD=1006,COOKIE_AGE=30*86400000;
const domains:Record<DiscoveryWebProvider,{documents:string[];resources:string[]}>={
 qwen:{documents:['qianwen.com'],resources:['qianwen.com','alicdn.com']},
 kimi:{documents:['kimi.com','kimi.moonshot.cn','login.moonshot.cn'],resources:['kimi.com','moonshot.cn']},
 deepseek:{documents:['deepseek.com'],resources:['deepseek.com']},
};
// Exact third-party hosts from the official public login pages and their SDKs.
// DeepSeek: fe-static.deepseek.com/chat/static/main.d1d163b7e4.js;
// Kimi: login.moonshot.cn/umi.c96ae14f.js and /lib/necaptcha.js.
// Widgets remain subframes/resources; they never become trusted top-level pages.
const verification:Record<DiscoveryWebProvider,string[]>={qwen:[],kimi:['cstaticdun.126.net','cstaticdun1.126.net','cstaticdun-v6.126.net','static.trustdecision.com','td-static.kimi.link','res.wx.qq.com','at.alicdn.com'],deepseek:['challenges.cloudflare.com','js.hcaptcha.com','newassets.hcaptcha.com','api.hcaptcha.com','api2.hcaptcha.com','castatic.fengkongcloud.cn','castatic-xjp.fengkongcloud.cn','captcha-fjny.fengkongcloud.cn','captcha-xjp.fengkongcloud.cn','captcha.fengkongcloud.com','a0fea896111e.edge.captcha-sdk.awswaf.com','a0fea896111e.edge.sdk.awswaf.com','appleid.cdn-apple.com','res.wx.qq.com']};
const verificationPost=['challenges.cloudflare.com','api.hcaptcha.com','api2.hcaptcha.com','captcha-fjny.fengkongcloud.cn','captcha-xjp.fengkongcloud.cn','captcha.fengkongcloud.com','a0fea896111e.edge.captcha-sdk.awswaf.com','a0fea896111e.edge.sdk.awswaf.com'];
function provider(value:unknown):DiscoveryWebProvider {if(!DISCOVERY_WEB_PROVIDERS.some(p=>p.id===value))throw new Error('请选择千问、Kimi 或 DeepSeek 官方网页。');return value as DiscoveryWebProvider}
const matches=(host:string,allowed:string[])=>allowed.some(domain=>host===domain||host.endsWith('.'+domain));
function publicUrl(raw:string,protocol='https:'):URL {
 if(typeof raw!=='string'||raw.length>16384)throw new Error('官网网址无效。');let url:URL;try{url=new URL(raw)}catch{throw new Error('官网网址无效。')}
 const host=url.hostname.toLowerCase();if(url.protocol!==protocol||url.username||url.password||url.port&&url.port!=='443'||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host.endsWith('.'))throw new Error('仅允许公开的官方安全网页。');return url;
}
export function aiWebNavigationUrl(selected:unknown,raw:string):URL {const p=provider(selected),url=publicUrl(raw);if(!matches(url.hostname,domains[p].documents))throw new Error('仅允许当前 AI 官网及其官方登录页面。');return url}
export function aiWebRequestAllowed(selected:unknown,raw:string,method:string,kind:string):boolean {
 try{
  const p=provider(selected);if(raw==='about:blank'&&kind!=='mainFrame')return true;if(kind==='image'&&/^data:image\//i.test(raw))return true;
  if(kind==='webSocket'){const url=publicUrl(raw,'wss:');return !url.hash&&method==='GET'&&matches(url.hostname,domains[p].documents)}
  if(kind==='mainFrame')return ['GET','HEAD','POST','OPTIONS'].includes(method)&&!!aiWebNavigationUrl(p,raw);
  const url=publicUrl(raw.startsWith('blob:https://')?raw.slice(5):raw);
  if(!matches(url.hostname,domains[p].resources)&&!verification[p].includes(url.hostname))return false;
  return ['GET','HEAD','OPTIONS'].includes(method)||method==='POST'&&(matches(url.hostname,domains[p].documents)||verification[p].includes(url.hostname)&&verificationPost.includes(url.hostname));
 }catch{return false}
}
function eligibleCookie(p:DiscoveryWebProvider,c:any):c is Electron.Cookie&{domain:string} {
 if(!c||typeof c.name!=='string'||!c.name||/[\x00-\x20\x7f;=]/.test(c.name)||typeof c.value!=='string'||/[\x00-\x1f\x7f]/.test(c.value)||Buffer.byteLength(c.name)+Buffer.byteLength(c.value)>16384||typeof c.domain!=='string'||!matches(c.domain.replace(/^\./,'').toLowerCase(),p==='kimi'?['kimi.com','moonshot.cn']:domains[p].documents)||typeof c.path!=='string'||!c.path.startsWith('/')||c.path.length>4096||/[\x00-\x1f\x7f;]/.test(c.path))return false;
 return c.session===true&&c.expirationDate===undefined||c.session!==true&&Number.isFinite(c.expirationDate)&&c.expirationDate>Date.now()/1000;
}
const cookieKey=(c:Electron.Cookie)=>JSON.stringify([(c.domain||'').replace(/^\./,'').toLowerCase(),c.path||'/',c.name]);
const nativeCookieDigest=(cookies:Electron.Cookie[])=>persistentCookieDigest(cookies,cookieKey);
export async function prepareAiWebSessionMigration(directory:string,roots:string[]):Promise<BrowserCookieSnapshot[]> {
 const result:BrowserCookieSnapshot[]=[];for(const p of DISCOVERY_WEB_PROVIDERS){const snapshot=await snapshotBrowserCookies(directory,roots,`ai-web-${p.id}`,c=>eligibleCookie(p.id,c),cookieKey);if(snapshot)result.push(snapshot)}return result;
}
interface Entry {parent:BrowserWindow;view:WebContentsView;provider:DiscoveryWebProvider;token:string;requestId:string;request:DiscoveryRequest;prompt:string;closed:boolean;attached:boolean;version:number;bounds?:WebAiWorkspaceBounds;promptReady:boolean;fillBusy:boolean;collectBusy:boolean;timer?:ReturnType<typeof setInterval>;attempts:number;lastReply?:string;stable:number;reply?:string;replyAt?:number;consumed:boolean;popups:Set<BrowserWindow>;onParentClosed:()=>void;onResize:()=>void}
const closedState=():WebAiWorkspaceState=>({status:'closed',notice:'在应用内登录 AI 官网，即可整理本次需求；无需 API 密钥。',promptReady:false});
export class DiscoveryAiWorkspace {
 private state:WebAiWorkspaceState=closedState();private entry?:Entry;private generation=0;
 private sessions=new Map<DiscoveryWebProvider,Promise<Electron.Session>>();private clearing=new Set<DiscoveryWebProvider>();
 private restoring=new Set<DiscoveryWebProvider>();private cookieEpoch=new Map<DiscoveryWebProvider,number>();private cookieWrite=Promise.resolve();private shutting=false;
 private cookieHooks=new Map<DiscoveryWebProvider,{remote:Electron.Session;changed:(_event:Electron.Event,cookie:Electron.Cookie,cause:string,removed:boolean)=>void;download:(event:Electron.Event,item:Electron.DownloadItem)=>void}>();
 private dns=new Map<string,{at:number;promise:Promise<void>}>();
 constructor(private readonly deps:DiscoveryAiWorkspaceDependencies){}
 snapshot():WebAiWorkspaceState {return structuredClone(this.state)}
 private active(entry:Entry,version?:number):boolean {return this.entry===entry&&!entry.closed&&!entry.parent.isDestroyed()&&!entry.view.webContents.isDestroyed()&&!this.clearing.has(entry.provider)&&this.deps.canNetwork()&&(version===undefined||version===entry.version)}
 private current(token:unknown,network=true):Entry {
  const e=this.entry;if(!e||e.closed||typeof token!=='string'||token!==e.token||e.parent.isDestroyed()||e.view.webContents.isDestroyed())throw new Error('网页 AI 工作区已关闭或操作已过期。');
  if(network&&!this.deps.canNetwork()){this.detach(e);e.view.webContents.stop();this.state={...this.state,status:'waiting',notice:'联网已关闭，网页 AI 已暂停。'};throw new Error('请先开启联网，网页 AI 已暂停。')}return e;
 }
 private url(entry:Entry):string {return entry.view.webContents.isDestroyed()?'':entry.view.webContents.getURL()}
 private chat(entry:Entry):boolean {try{return new URL(this.url(entry)).origin===new URL(DISCOVERY_WEB_PROVIDERS.find(p=>p.id===entry.provider)!.url).origin}catch{return false}}
 async open(selected:unknown,value:unknown):Promise<WebAiWorkspaceState> {
  const p=provider(selected),request=discoveryRequest(value);if(!this.deps.canNetwork())throw new Error('请先开启联网。');if(this.clearing.has(p))throw new Error('正在清除这个 AI 账号的登录状态，请稍候。');
  const parent=this.deps.parent();if(!parent||parent.isDestroyed())throw new Error('应用窗口已关闭。');
  this.close();this.shutting=false;const generation=this.generation,requestId=randomUUID(),prepared=inAppDiscoveryPrompt(p,request,requestId),remote=await this.initialize(p);
  if(generation!==this.generation||!this.deps.canNetwork()||parent.isDestroyed()||this.clearing.has(p))return this.snapshot();
  const view=new WebContentsView({webPreferences:this.preferences(remote)}),entry:Entry={parent,view,provider:p,token:randomUUID(),requestId,request:structuredClone(request),prompt:prepared.prompt,closed:false,attached:false,version:0,promptReady:false,fillBusy:false,collectBusy:false,attempts:0,stable:0,consumed:false,popups:new Set(),onParentClosed:()=>{if(this.entry===entry)this.close()},onResize:()=>{if(this.entry===entry&&entry.bounds)this.layout(entry)}};
  this.entry=entry;this.state={token:entry.token,provider:p,url:prepared.url,status:'loading',notice:'正在应用内打开官网；请按网站要求登录，再在对话框发送已填入的需求。',promptReady:false};
  view.setBackgroundColor('#ffffff');parent.once('closed',entry.onParentClosed);parent.on('resize',entry.onResize);this.protect(entry,view.webContents,true);
  void view.webContents.loadURL(aiWebNavigationUrl(p,prepared.url).href).catch(()=>{if(this.active(entry))this.state={...this.state,status:'error',notice:'官网未能加载，请检查网络后重新打开；无需离开本应用。'}});return this.snapshot();
 }
 bounds(token:unknown,value:unknown):void {
  const entry=this.current(token,false);if(value===null){entry.bounds=undefined;this.detach(entry);return}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('网页 AI 显示区域无效。');const raw=value as WebAiWorkspaceBounds;
  if(!['x','y','width','height'].every(key=>typeof (raw as any)[key]==='number'&&Number.isFinite((raw as any)[key]))||raw.width<0||raw.height<0||[raw.x,raw.y,raw.width,raw.height].some(n=>Math.abs(n)>100000))throw new Error('网页 AI 显示区域无效。');
  entry.bounds={x:raw.x,y:raw.y,width:raw.width,height:raw.height};if(!this.deps.canNetwork()){this.detach(entry);return}this.layout(entry);
 }
 private layout(entry:Entry):void {
  if(!this.active(entry)||!entry.bounds)return;const factor=entry.parent.webContents.getZoomFactor(),[width,height]=entry.parent.getContentSize();
  if(!Number.isFinite(factor)||factor<=0){this.detach(entry);return}const b=entry.bounds,left=Math.max(0,Math.min(width,Math.round(b.x*factor))),top=Math.max(0,Math.min(height,Math.round(b.y*factor))),right=Math.max(left,Math.min(width,Math.round((b.x+b.width)*factor))),bottom=Math.max(top,Math.min(height,Math.round((b.y+b.height)*factor)));
  if(right-left<1||bottom-top<1){this.detach(entry);return}entry.view.setBounds({x:left,y:top,width:right-left,height:bottom-top});if(!entry.attached){entry.parent.contentView.addChildView(entry.view);entry.attached=true}this.startFill(entry);
 }
 private detach(entry:Entry):void {entry.version++;if(entry.timer)clearInterval(entry.timer);entry.timer=undefined;if(entry.attached){entry.attached=false;if(!entry.parent.isDestroyed())try{entry.parent.contentView.removeChildView(entry.view)}catch{}}entry.lastReply=undefined;entry.stable=0;entry.reply=undefined;entry.replyAt=undefined;if(this.entry===entry&&this.state.status==='reply-ready')this.state={...this.state,status:entry.promptReady?'waiting':'ready',notice:'已隐藏官网，回复读取已暂停。'}}
 private startFill(entry:Entry):void {if(entry.timer||entry.promptReady||entry.consumed||entry.attempts>=80)return;entry.timer=setInterval(()=>{if(!this.active(entry)||!entry.attached){if(entry.timer)clearInterval(entry.timer);entry.timer=undefined;return}void this.fill(entry.token).catch(()=>{})},1500);entry.timer.unref()}
 private async evaluate(entry:Entry,script:string):Promise<unknown> {return entry.view.webContents.executeJavaScriptInIsolatedWorld(SOURCE_WORLD,[{code:script}],false)}
 async fill(token:unknown):Promise<WebAiWorkspaceState> {
  const entry=this.current(token);if(!entry.attached||entry.fillBusy||entry.consumed)return this.snapshot();if(!this.chat(entry)){this.state={...this.state,status:'waiting',notice:'请在应用内完成官网登录；返回聊天页面后会继续填入。'};return this.snapshot()}
  entry.fillBusy=true;entry.attempts++;const version=entry.version;
  try{const filled=await this.evaluate(entry,aiEditorScript(entry.provider,entry.prompt));if(!this.active(entry,version)||!entry.attached)return this.snapshot();if(filled===true){entry.promptReady=true;if(entry.timer)clearInterval(entry.timer);entry.timer=undefined;this.state={...this.state,status:'waiting',promptReady:true,notice:'需求已填入官网对话框。请点击网站的发送按钮；回答完成后会在应用内继续搜索。'}}else{this.state={...this.state,status:'ready',notice:'请先登录或回到聊天页。已有草稿不会被覆盖；也可复制需求后在官网对话框粘贴并发送。'};if(entry.attempts>=80&&entry.timer){clearInterval(entry.timer);entry.timer=undefined}}}
  catch{if(this.active(entry,version))this.state={...this.state,status:'ready',notice:'暂时无法填入官网编辑器；可以复制本次需求，在应用内官网粘贴并发送。'}}finally{entry.fillBusy=false}return this.snapshot();
 }
 async collect(token:unknown):Promise<WebAiWorkspaceState> {
  const entry=this.current(token);if(entry.consumed||!entry.attached||entry.collectBusy)return this.snapshot();aiWebNavigationUrl(entry.provider,this.url(entry));if(!this.chat(entry))return this.snapshot();entry.collectBusy=true;const version=entry.version;
  try{const raw=await this.evaluate(entry,aiReplyScript(entry.provider,entry.requestId));if(!this.active(entry,version)||!entry.attached)return this.snapshot();const candidates=Array.isArray(raw)&&raw.length<=16?raw:[],replies=new Set(candidates.flatMap(value=>{try{const reply=parseInAppDiscoveryReply(value,entry.requestId);return reply?[reply]:[]}catch{return []}}));
   if(replies.size!==1){entry.lastReply=undefined;entry.stable=0;entry.reply=undefined;entry.replyAt=undefined;this.state={...this.state,status:entry.promptReady?'waiting':'ready',notice:'等待本次需求的完整回复；不会使用旧聊天、其他需求或格式不完整的回答。'};return this.snapshot()}
   const reply=[...replies][0];entry.promptReady=true;if(entry.timer)clearInterval(entry.timer);entry.timer=undefined;this.state={...this.state,promptReady:true};entry.stable=entry.lastReply===reply?entry.stable+1:1;entry.lastReply=reply;
   if(entry.stable>=2){entry.reply=reply;entry.replyAt=Date.now();this.state={...this.state,status:'reply-ready',notice:'本次回复已校验，正在准备使用检索词搜索真实商品。'}}else this.state={...this.state,status:'waiting',notice:'已读取本次回复，正在等候回答稳定。'};
  }catch{if(this.active(entry,version))this.state={...this.state,status:'waiting',notice:'官网回复暂时不可读取；可以在应用内复制完整回答到备用输入框。'}}finally{entry.collectBusy=false}return this.snapshot();
 }
 copyPrompt(token:unknown):string {return this.current(token,false).prompt}
 takeReply(token:unknown,validate?:(request:DiscoveryRequest)=>void):{request:DiscoveryRequest;reply:string} {
  const entry=this.current(token);if(entry.consumed||!entry.attached||!entry.reply||!entry.replyAt||Date.now()-entry.replyAt>15000||this.state.status!=='reply-ready')throw new Error('本次回复尚未完成校验或已经使用，请等待新的完整回复。');aiWebNavigationUrl(entry.provider,this.url(entry));if(!this.chat(entry))throw new Error('请回到本次回复的官网聊天页面。');validate?.(structuredClone(entry.request));if(this.current(token)!==entry||!entry.attached||!entry.reply||this.state.status!=='reply-ready')throw new Error('网页 AI 工作区已变化，请重新核对。');entry.consumed=true;const reply=entry.reply;entry.reply=undefined;this.state={...this.state,status:'searched',notice:'已使用本次网页 AI 检索词；商品来自站内真实搜索结果。'};return {request:structuredClone(entry.request),reply};
 }
 close():void {
  this.generation++;const entry=this.entry;this.entry=undefined;if(entry){entry.closed=true;this.detach(entry);entry.parent.removeListener('closed',entry.onParentClosed);entry.parent.removeListener('resize',entry.onResize);for(const popup of entry.popups)if(!popup.isDestroyed())popup.destroy();entry.popups.clear();if(!entry.view.webContents.isDestroyed()){entry.view.webContents.setWindowOpenHandler(()=>({action:'deny'}));entry.view.webContents.stop();entry.view.webContents.close({waitForBeforeUnload:false})}}this.state=closedState();
 }
 async shutdown():Promise<void> {
  this.shutting=true;this.close();
  // Keep observing logout/rotation while pending network work and cookie reads drain.
  await Promise.allSettled([...this.sessions.entries()].map(async([p,pending])=>{const remote=await pending;await remote.closeAllConnections().catch(()=>{});await this.saveCookieMirror(p,remote);await remote.cookies.flushStore();remote.flushStorageData()}));await this.cookieWrite;
  for(const {remote,changed,download} of this.cookieHooks.values()){remote.cookies.removeListener('changed',changed);remote.removeListener('will-download',download)}this.cookieHooks.clear();
 }
 async clear(selected:unknown):Promise<void> {
  const p=provider(selected);if(this.clearing.has(p))throw new Error('正在清除这个账号，请稍候。');if(this.entry?.provider===p)this.close();this.clearing.add(p);this.cookieEpoch.set(p,(this.cookieEpoch.get(p)||0)+1);
  try{await this.cookieWrite;const remote=await this.initialize(p);await remote.closeAllConnections();await remote.clearStorageData();await remote.clearCache();await remote.cookies.flushStore();remote.flushStorageData();const mirror=this.mirror(p);try{fs.unlinkSync(mirror)}catch(error:any){if(error.code!=='ENOENT')throw error}}finally{this.clearing.delete(p)}
 }
 private preferences(remote:Electron.Session):Electron.WebPreferences {return {session:remote,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,disableDialogs:true,devTools:false}}
 private initialize(p:DiscoveryWebProvider):Promise<Electron.Session> {let pending=this.sessions.get(p);if(!pending){pending=this.initializeSession(p);this.sessions.set(p,pending);void pending.catch(()=>{if(this.sessions.get(p)===pending)this.sessions.delete(p)})}return pending.then(remote=>{if(!this.shutting)this.watchCookies(p,remote);return remote})}
 private mirror(p:DiscoveryWebProvider):string {return assertSafeWrite(path.join(this.deps.dataDir,`ai-web-${p}-cookies.bin`),this.deps.dataDir,this.deps.roots())}
 private watchCookies(p:DiscoveryWebProvider,remote:Electron.Session):void {
  if(this.cookieHooks.has(p))return;
  const changed=(_event:Electron.Event,cookie:Electron.Cookie,_cause:string,_removed:boolean)=>{
   if(this.restoring.has(p)||this.clearing.has(p)||!eligibleCookie(p,{...cookie,session:true,expirationDate:undefined}))return;
   this.cookieEpoch.set(p,(this.cookieEpoch.get(p)||0)+1);
   // Rotation can leave the persistent-cookie digest unchanged, just like logout.
   try{fs.unlinkSync(this.mirror(p))}catch(error:any){if(error.code!=='ENOENT'&&this.entry?.provider===p)this.state={...this.state,notice:'登录状态保存失败，请先清除这个账号再重新登录。'}}
   void this.saveCookieMirror(p,remote);
  };
  const download=(event:Electron.Event,item:Electron.DownloadItem)=>{event.preventDefault();item?.cancel()};remote.cookies.on('changed',changed);remote.on('will-download',download);this.cookieHooks.set(p,{remote,changed,download});
 }
 private saveCookieMirror(p:DiscoveryWebProvider,remote:Electron.Session):Promise<void> {
  const epoch=this.cookieEpoch.get(p)||0;
  this.cookieWrite=this.cookieWrite.then(async()=>{
   if(this.clearing.has(p)||(this.cookieEpoch.get(p)||0)!==epoch)return;if(!safeStorage.isEncryptionAvailable())throw new Error('登录状态无法安全保存。');const cookies=(await remote.cookies.get({})).filter(c=>eligibleCookie(p,c));if(this.clearing.has(p)||(this.cookieEpoch.get(p)||0)!==epoch)return;if(cookies.length>100)throw new Error('登录保存记录过大。');
   const bytes=safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies,nativeCookieDigest:nativeCookieDigest(cookies)}));if(bytes.length>256*1024)throw new Error('登录保存记录过大。');writeOwnedAtomic(this.mirror(p),bytes,this.deps.dataDir,this.deps.roots());
  }).catch(()=>{if(this.entry?.provider===p)this.state={...this.state,notice:'登录状态未能安全保存，下次可能需要重新登录。'}});return this.cookieWrite;
 }
 private async initializeSession(p:DiscoveryWebProvider):Promise<Electron.Session> {
  const folder=assertSafeWrite(path.join(this.deps.dataDir,`ai-web-${p}`),this.deps.dataDir,this.deps.roots()),hasCookies=fs.existsSync(path.join(folder,'Network','Cookies'))||fs.existsSync(path.join(folder,'Cookies'));fs.mkdirSync(folder,{recursive:true});const remote=session.fromPath(folder,{cache:true});
  // Qwen returned an empty HTTP 200 for the non-ASCII app-name product token.
  // Keep the actual Chrome/Electron identity and change only our product name.
  remote.setUserAgent(remote.getUserAgent().replace('VRC素材库/','VRCAL/'));
  remote.setPermissionCheckHandler(()=>false);remote.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));remote.setDevicePermissionHandler(()=>false);
  remote.webRequest.onBeforeRequest((details,callback)=>{
   const active=()=>!!this.entry&&this.entry.provider===p&&this.active(this.entry);if(!active()||!aiWebRequestAllowed(p,details.url,details.method,details.resourceType)){callback({cancel:true});return}
   if(details.url==='about:blank'||/^data:image\//i.test(details.url)){callback({cancel:false});return}try{const raw=details.url.startsWith('blob:https://')?details.url.slice(5):details.url,url=new URL(raw);void this.publicHost(url.hostname).then(()=>callback({cancel:!active()})).catch(()=>callback({cancel:true}))}catch{callback({cancel:true})}
  });
  // Persistent native cookies remain authoritative. Session-only cookies can be
  // restored after normal exit only while the native persistent-cookie digest agrees.
  const mirror=this.mirror(p);
  if(!this.clearing.has(p)&&fs.existsSync(mirror))try{
   if(!safeStorage.isEncryptionAvailable())throw new Error('AI 登录状态无法解密，请重新登录或清除这个账号。');const info=fs.lstatSync(mirror);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw new Error('AI 登录状态不可读取。');const saved=JSON.parse(safeStorage.decryptString(fs.readFileSync(mirror)));
   if(!Number.isFinite(saved?.at)||saved.at>Date.now()+60000||Date.now()-saved.at>COOKIE_AGE||!Array.isArray(saved.cookies)||saved.cookies.length>100)throw new Error('AI 登录保存记录无效或已过期，请重新登录。');
   const native=(await remote.cookies.get({})).filter(c=>eligibleCookie(p,c)),keys=new Set(native.map(cookieKey)),restoreSession=typeof saved.nativeCookieDigest==='string'&&/^[a-f0-9]{64}$/.test(saved.nativeCookieDigest)&&saved.nativeCookieDigest===nativeCookieDigest(native);
   this.restoring.add(p);try{for(const cookie of saved.cookies){if(!eligibleCookie(p,cookie)||hasCookies&&(cookie.session!==true||!restoreSession||keys.has(cookieKey(cookie))))continue;const host=cookie.domain.replace(/^\./,'');await remote.cookies.set({...cookie,url:'https://'+host+(cookie.path||'/')})}await remote.cookies.flushStore();remote.flushStorageData()}finally{this.restoring.delete(p)}
  }catch(error){if(!hasCookies)throw error}return remote;
 }
 private publicHost(host:string):Promise<void> {
  const old=this.dns.get(host);if(old&&Date.now()-old.at<60000)return old.promise;const promise=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const rows=await Promise.race([lookup(host,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),5000);timer.unref()})]);if(!rows.length||rows.some(row=>!isPublicAddress(row.address)))throw new Error('非公开地址已阻止。')}finally{if(timer)clearTimeout(timer)}})();this.dns.set(host,{at:Date.now(),promise});void promise.catch(()=>this.dns.delete(host));if(this.dns.size>128)this.dns.delete(this.dns.keys().next().value!);return promise;
 }
 private protect(entry:Entry,contents:Electron.WebContents,primary:boolean):void {
  const live=()=>this.active(entry)&&!contents.isDestroyed(),reset=()=>{entry.version++;entry.lastReply=undefined;entry.stable=0;entry.reply=undefined;entry.replyAt=undefined};
  contents.on('will-attach-webview',event=>event.preventDefault());contents.on('will-frame-navigate',event=>{try{if(!live())throw new Error();if(!event.isMainFrame&&event.url==='about:blank')return;if(event.isMainFrame)aiWebNavigationUrl(entry.provider,event.url);else if(!aiWebRequestAllowed(entry.provider,event.url,'GET','subFrame'))throw new Error()}catch{event.preventDefault()}});contents.on('will-redirect',event=>{try{if(!live())throw new Error();if(event.isMainFrame===false){if(!aiWebRequestAllowed(entry.provider,event.url,'GET','subFrame'))throw new Error()}else aiWebNavigationUrl(entry.provider,event.url)}catch{event.preventDefault()}});
  contents.on('login',(event,_details,_auth,callback)=>{event.preventDefault();callback()});
  contents.setWindowOpenHandler(details=>{try{if(!live())return {action:'deny'};aiWebNavigationUrl(entry.provider,details.url);return {action:'allow',overrideBrowserWindowOptions:{parent:entry.parent,width:900,height:760,autoHideMenuBar:true,webPreferences:this.preferences(contents.session)}}}catch{return {action:'deny'}}});
  contents.on('did-create-window',popup=>{if(!live()){if(!popup.isDestroyed())popup.destroy();return}popup.setMenu(null);entry.popups.add(popup);this.protect(entry,popup.webContents,false);popup.once('closed',()=>entry.popups.delete(popup))});
  if(!primary)return;contents.on('did-start-navigation',event=>{if(this.active(entry)&&event.isMainFrame){reset();entry.promptReady=false;this.state={...this.state,status:'loading',promptReady:false}}});contents.on('did-navigate-in-page',()=>{if(this.active(entry)){reset();this.state={...this.state,url:this.url(entry),status:entry.promptReady?'waiting':'ready'}}});
  contents.on('did-finish-load',()=>{if(!this.active(entry))return;this.state={...this.state,url:this.url(entry),status:'ready',notice:'官网已打开。请完成登录，应用只填入需求，由你点击官网发送。',promptReady:entry.promptReady};if(entry.attached)this.startFill(entry)});
  contents.on('did-fail-load',(_event,code,_description,_url,isMain)=>{if(this.active(entry)&&isMain&&code!==-3)this.state={...this.state,status:'error',notice:'官网暂时未能加载，请检查网络后重新打开。'}});
  contents.on('render-process-gone',()=>{if(this.active(entry)){this.detach(entry);this.state={...this.state,status:'error',notice:'官网页面已退出，请重新打开网页 AI。'}}});
 }
}
