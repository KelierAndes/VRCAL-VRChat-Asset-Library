import {BrowserWindow,WebContentsView,ipcMain,session} from 'electron';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';
import {publicHttpsUrl,isPublicAddress} from './online';
import {normalizeTheme,THEME_BACKGROUNDS} from '../shared/contracts';
import type {AppTheme,AppLanguage} from '../shared/contracts';
import {normalizeLanguage,translate} from '../shared/i18n';
import {NATIVE_MESSAGES} from '../shared/messages-native';

export interface PreviewDependencies {
  parent:()=>BrowserWindow|null;
  getTheme?:()=>AppTheme;
  getLanguage?:()=>AppLanguage;
  validate:(id:string,url:string)=>{title:string;canConfirm:boolean};
  accept:(id:string,url:string)=>Promise<void>;
}
interface PreviewState {title:string;url:string;sourceUrl:string;status:string;loading:boolean;canConfirm:boolean;canGoBack:boolean;canGoForward:boolean;confirmed:boolean;theme:AppTheme;language:AppLanguage;messages:Record<string,string>}
interface PreviewEntry {window:BrowserWindow;view:WebContentsView;session:Electron.Session;channel:string;toolbarUrl:string;id:string;sourceUrl:string;title:string;status:string;statusValues?:Record<string,string|number>;loading:boolean;loaded:boolean;httpError:boolean;busy:boolean;confirmed:boolean;closed:boolean;dns:Map<string,Promise<void>>}
const HEIGHT=126;
function boothId(raw:string):string|undefined {try{const url=publicHttpsUrl(raw);return /(?:^|\.)booth\.pm$/i.test(url.hostname)?url.pathname.match(/\/items\/(\d{1,12})(?:\/|$)/)?.[1]:undefined;}catch{return undefined;}}
/** A locale/shop redirect may display the same BOOTH item; recommendations never qualify. */
export function samePreviewProduct(source:string,current:string):boolean {
  try{const a=publicHttpsUrl(source),b=publicHttpsUrl(current),id=boothId(a.href);return id?boothId(b.href)===id:a.href===b.href;}catch{return false;}
}

export class ProductPreview {
  private active?:PreviewEntry;private generation=0;
  constructor(private readonly deps:PreviewDependencies){}
  async open(id:string,rawUrl:string):Promise<void> {
    if(typeof id!=='string'||typeof rawUrl!=='string')throw new Error('候选商品无效。');
    const sourceUrl=publicHttpsUrl(rawUrl).href,metadata=this.deps.validate(id,sourceUrl),generation=++this.generation;
    this.dispose();
    const token=randomUUID(),channel='vrc-preview:'+token,partition='vrc-product-preview-'+token;
    const remoteSession=session.fromPartition(partition,{cache:false});
    const window=new BrowserWindow({width:1150,height:860,minWidth:760,minHeight:520,title:this.t('商品预览')+' · '+metadata.title,parent:this.deps.parent()??undefined,autoHideMenuBar:true,backgroundColor:THEME_BACKGROUNDS[this.theme()],show:false,
      webPreferences:{preload:path.join(__dirname,'preview-preload.js'),additionalArguments:['--vrc-preview-channel='+channel,'--vrc-theme='+this.theme(),'--vrc-language='+this.language()],partition:'vrc-preview-toolbar-'+token,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,devTools:false}});
    const view=new WebContentsView({webPreferences:{session:remoteSession,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,disableDialogs:true,devTools:false}});
    const toolbarPath=path.resolve(__dirname,'../../../assets/preview.html'),entry:PreviewEntry={window,view,session:remoteSession,channel,toolbarUrl:pathToFileURL(toolbarPath).href,id,sourceUrl,title:metadata.title.slice(0,1000),status:'正在打开公开商品页面…',loading:true,loaded:false,httpError:false,busy:false,confirmed:false,closed:false,dns:new Map()};
    this.active=entry;window.setMenu(null);window.contentView.addChildView(view);view.setBackgroundColor('#ffffff');
    const layout=()=>{if(entry.closed)return;const [width,height]=window.getContentSize();view.setBounds({x:0,y:HEIGHT,width,height:Math.max(0,height-HEIGHT)});};
    window.on('resize',layout);layout();
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
    remoteSession.setPermissionCheckHandler(()=>false);remoteSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));remoteSession.setDevicePermissionHandler(()=>false);
    remoteSession.on('will-download',(event)=>{event.preventDefault();this.status(entry,'预览窗口不下载文件；请回素材库查看本地内容。');});
    this.protectRequests(entry);this.protectNavigation(entry);
    ipcMain.handle(channel,async(event,command:unknown)=>{
      try{
      if(entry.closed||this.active!==entry||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.sender.getURL()!==entry.toolbarUrl)throw new Error('预览操作来源无效。');
      if(typeof command!=='string'||!['state','back','forward','reload','confirm','close'].includes(command))throw new Error('预览操作无效。');
      if(command==='state')return this.state(entry);
      if(command==='close'){window.close();return;}
      if(command==='confirm'){await this.confirm(entry);return this.state(entry);}
      if(entry.busy||view.webContents.isDestroyed())return;
      if(command==='back'&&view.webContents.navigationHistory.canGoBack())view.webContents.navigationHistory.goBack();
      if(command==='forward'&&view.webContents.navigationHistory.canGoForward())view.webContents.navigationHistory.goForward();
      if(command==='reload')view.webContents.reload();
      return this.state(entry);
      }catch(error){throw new Error(this.t(error instanceof Error?error.message:'操作失败'))}
    });
    window.once('closed',()=>{this.disposeEntry(entry);if(this.active===entry)this.active=undefined;});
    try{
      await window.loadFile(toolbarPath);if(entry.closed||generation!==this.generation)return;
      this.emit(entry);if(!process.env.VRC_LIBRARY_TEST_HIDDEN)window.show();
      void view.webContents.loadURL(sourceUrl).catch(error=>{if(!entry.closed&&!entry.loaded)this.status(entry,'页面加载失败：{detail}',{detail:error instanceof Error?error.message:this.t('网络不可用')});});
    }catch(error){this.disposeEntry(entry);if(this.active===entry)this.active=undefined;throw error;}
  }
  close():void {this.generation++;this.dispose();}
  refreshTheme():void {const entry=this.active;if(entry&&!entry.closed){entry.window.setBackgroundColor(THEME_BACKGROUNDS[this.theme()]);entry.window.setTitle?.(this.t('商品预览')+' · '+entry.title);this.emit(entry)}}
  private theme():AppTheme {return normalizeTheme(this.deps.getTheme?.())}
  private language():AppLanguage {return normalizeLanguage(this.deps.getLanguage?.())}
 private messages():Record<string,string> {return Object.fromEntries(Object.keys(NATIVE_MESSAGES).map(source=>[source,this.t(source)]))}
  private t(source:string,values:Record<string,string|number>={}):string {return translate(source,this.language(),values)}
  private dispose():void {const entry=this.active;this.active=undefined;if(entry)this.disposeEntry(entry);}
  private disposeEntry(entry:PreviewEntry):void {
    if(entry.closed)return;entry.closed=true;ipcMain.removeHandler(entry.channel);
    if(!entry.view.webContents.isDestroyed())entry.view.webContents.close();
    // Keep the deny guard alive while any service worker or connection is torn down.
    void entry.session.closeAllConnections().then(()=>entry.session.clearStorageData()).then(()=>{entry.session.webRequest.onBeforeRequest(null);entry.session.webRequest.onBeforeSendHeaders(null);entry.session.webRequest.onHeadersReceived(null);}).catch(()=>{});
    if(!entry.window.isDestroyed())entry.window.destroy();
  }
  private state(entry:PreviewEntry):PreviewState {
    const remote=entry.view.webContents,current=remote.isDestroyed()?'':remote.getURL();let authorized=false;
    try{authorized=this.deps.validate(entry.id,entry.sourceUrl).canConfirm;}catch{/* A candidate can be removed while its window is open. */}
    return {title:entry.title,url:current||entry.sourceUrl,sourceUrl:entry.sourceUrl,status:this.t(entry.status,entry.statusValues),loading:entry.loading,canConfirm:authorized&&entry.loaded&&!entry.loading&&!entry.busy&&!entry.confirmed&&samePreviewProduct(entry.sourceUrl,current),canGoBack:!remote.isDestroyed()&&remote.navigationHistory.canGoBack(),canGoForward:!remote.isDestroyed()&&remote.navigationHistory.canGoForward(),confirmed:entry.confirmed,theme:this.theme(),language:this.language(),messages:this.messages()};
  }
  private emit(entry:PreviewEntry):void {if(!entry.closed&&!entry.window.webContents.isDestroyed())entry.window.webContents.send(entry.channel+':state',this.state(entry));}
  private status(entry:PreviewEntry,status:string,values?:Record<string,string|number>):void {if(entry.closed)return;entry.status=status;entry.statusValues=values;this.emit(entry);}
  private async confirm(entry:PreviewEntry):Promise<void> {
    if(!this.state(entry).canConfirm)throw new Error('只能确认最初授权的候选商品。请返回该商品页面，或在素材库重新选择候选。');
    entry.busy=true;this.status(entry,'正在将这一商品应用到素材…');
    try{if(!this.deps.validate(entry.id,entry.sourceUrl).canConfirm)throw new Error('该候选已变化，请回素材库重新选择。');await this.deps.accept(entry.id,entry.sourceUrl);if(entry.closed)return;entry.confirmed=true;this.status(entry,'已确认这一商品，封面和标签将由素材库继续补全。');}
    catch(error){this.status(entry,error instanceof Error?error.message:'确认失败，请回素材库刷新候选。');throw error;}
    finally{entry.busy=false;this.emit(entry);}
  }
  private async publicHost(entry:PreviewEntry,raw:string):Promise<void> {
    const url=publicHttpsUrl(raw),hostname=url.hostname.toLowerCase();let pending=entry.dns.get(hostname);
    if(!pending){
      pending=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const records=await Promise.race([lookup(hostname,{all:true,verbatim:true}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('网址解析超时')),5000);})]);if(!records.length||records.some(record=>!isPublicAddress(record.address)))throw new Error('只允许公开网络地址');}finally{if(timer)clearTimeout(timer);}})();
      entry.dns.set(hostname,pending);void pending.finally(()=>{if(entry.dns.get(hostname)===pending)entry.dns.delete(hostname);}).catch(()=>{});
    }
    await pending;
  }
  private protectRequests(entry:PreviewEntry):void {
    entry.session.webRequest.onBeforeRequest((details,callback)=>{
      const denied=()=>{if(details.resourceType==='mainFrame'){entry.loaded=false;entry.loading=false;this.status(entry,'已阻止不安全或需要验证的导航。仅支持公开 HTTPS 商品页面。');}callback({cancel:true});};
      if(entry.closed||!['GET','HEAD'].includes(details.method)||details.uploadData?.length){denied();return;}
      if(details.resourceType!=='mainFrame'&&/^data:/i.test(details.url)&&['image','font','media'].includes(details.resourceType)){callback({cancel:false});return;}
      let target=details.url;
      if(details.resourceType!=='mainFrame'&&target.startsWith('blob:https://'))target=target.slice(5);
      if(details.resourceType!=='mainFrame'&&target==='about:blank'){callback({cancel:false});return;}
      void this.publicHost(entry,target).then(()=>callback({cancel:entry.closed})).catch(denied);
    });
    entry.session.webRequest.onBeforeSendHeaders((details,callback)=>{
      const headers={...details.requestHeaders};for(const key of Object.keys(headers))if(/^(?:authorization|proxy-authorization)$/i.test(key))delete headers[key];
      callback({requestHeaders:headers});
    });
    entry.session.webRequest.onHeadersReceived((details,callback)=>{
      const contentType=Object.entries(details.responseHeaders??{}).find(([key])=>key.toLowerCase()==='content-type')?.[1]?.[0]?.split(';')[0].toLowerCase();
      if(details.resourceType==='mainFrame'&&details.statusCode>=400){entry.httpError=true;entry.loaded=false;this.status(entry,[401,403].includes(details.statusCode)?'网站需要登录或验证，预览已停止。':details.statusCode===404?'商品页面不存在或已下架。':'商品页面暂时无法读取（{statusCode}）。',{statusCode:details.statusCode});}
      const incompatible=details.resourceType==='mainFrame'&&details.statusCode>=200&&details.statusCode<300&&contentType&&!['text/html','application/xhtml+xml'].includes(contentType);
      if(incompatible){entry.httpError=true;entry.loaded=false;entry.loading=false;this.status(entry,'此链接不是公开商品网页，预览不下载文件。');}
      callback({cancel:entry.closed||!!incompatible});
    });
  }
  private protectNavigation(entry:PreviewEntry):void {
    const remote=entry.view.webContents;
    remote.setWindowOpenHandler(()=>{this.status(entry,'已阻止打开额外窗口；可在当前预览中浏览商品。');return {action:'deny'};});
    remote.on('will-attach-webview',event=>event.preventDefault());
    remote.on('will-frame-navigate',event=>{try{if(!event.isMainFrame&&event.url==='about:blank')return;publicHttpsUrl(event.url);}catch{event.preventDefault();this.status(entry,'已阻止不安全或需要验证的链接。');}});
    remote.on('will-redirect',event=>{try{publicHttpsUrl(event.url);}catch{event.preventDefault();entry.loaded=false;entry.loading=false;this.status(entry,'网站跳转到登录、验证或不安全地址，预览已停止。');}});
    remote.on('login',(event,_details,_authInfo,callback)=>{event.preventDefault();callback();this.status(entry,'预览仅浏览公开商品，不登录网站。');});
    remote.on('did-start-navigation',event=>{if(!event.isMainFrame)return;entry.loaded=false;entry.loading=true;entry.httpError=false;this.status(entry,'正在加载商品页面…');});
    remote.on('did-navigate',(_event,_url,statusCode)=>{
      if(statusCode>=400){entry.httpError=true;entry.loaded=false;this.status(entry,[401,403].includes(statusCode)?'网站需要登录或验证，预览已停止。':statusCode===404?'商品页面不存在或已下架。':'商品页面暂时无法读取（{statusCode}）。',{statusCode});}else this.emit(entry);
    });remote.on('did-navigate-in-page',(_event,_url,isMain)=>{if(isMain)this.emit(entry);});
    remote.on('did-finish-load',()=>{entry.loading=false;entry.loaded=!entry.httpError;this.status(entry,entry.httpError?entry.status:samePreviewProduct(entry.sourceUrl,remote.getURL())?'公开商品预览 · 核对后可确认这一商品':'正在浏览其他页面；返回最初的商品后才能确认。',entry.httpError?entry.statusValues:undefined);});
    remote.on('did-fail-load',(_event,code,description,_url,isMain)=>{if(!isMain)return;entry.loading=false;entry.loaded=false;this.status(entry,code===-3?'页面加载已取消或被保护规则阻止。':'页面加载失败：{detail}。请检查网络或代理后重载。',{detail:description});});
    remote.on('render-process-gone',()=>{entry.loaded=false;entry.loading=false;this.status(entry,'预览进程已退出，请关闭窗口后重新打开。');});
    remote.on('before-input-event',(event,input)=>{if(input.key==='F5'||input.control&&input.key.toLowerCase()==='r'){event.preventDefault();remote.reload();}});
  }
}
