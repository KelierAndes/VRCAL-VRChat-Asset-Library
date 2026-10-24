const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
let loadHook,nextContentsId=0;const handlers=new Map(),sessions=new Map();
class Contents extends EventEmitter {
 constructor(){super();this.id=++nextContentsId;this.url='';this.mainFrame={};this.destroyed=false}
 check(){if(this.destroyed)throw new TypeError('Object has been destroyed')}
 getURL(){this.check();return this.url}isDestroyed(){return this.destroyed}send(_channel,state){this.check();this.sent=state}setWindowOpenHandler(handler){this.check();this.popup=handler}
 async loadURL(url){this.check();this.url=url;this.emit('did-start-loading');this.emit('did-finish-load')}
 stop(){this.check();this.stopped=true}close(){if(!this.destroyed){this.destroyed=true;this.emit('destroyed')}}getZoomFactor(){this.check();return 1}reload(){this.check();this.reloads=(this.reloads||0)+1}
}
class Window extends EventEmitter {
 constructor(options){super();this.options=options;this.contents=new Contents();this.destroyed=false;this.contentView={addChildView(){}}}
 get webContents(){if(this.destroyed)throw new TypeError('Object has been destroyed');return this.contents}
 setMenu(){}setTitle(title){if(this.destroyed)throw new TypeError('Object has been destroyed');this.title=title}setBackgroundColor(){}getContentSize(){if(this.destroyed)throw new TypeError('Object has been destroyed');return [1180,900]}show(){if(this.destroyed)throw new TypeError('Object has been destroyed');this.shown=true}isDestroyed(){return this.destroyed}
 async loadFile(file){this.webContents.url=pathToFileURL(file).href}async loadURL(url){return loadHook?loadHook(this,this.webContents,url):this.webContents.loadURL(url)}close(){this.destroy()}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.contents.close();this.emit('closed')}
}
class View{constructor(options){this.options=options;this.webContents=new Contents()}setBounds(bounds){this.bounds=bounds}setBackgroundColor(){}}
class Session extends EventEmitter{constructor(){super();this.cookies={get:async()=>[],flushStore:async()=>{}};this.webRequest={onBeforeRequest:handler=>this.request=handler,onErrorOccurred:handler=>this.requestError=handler}}setPermissionCheckHandler(){}setPermissionRequestHandler(){}setDevicePermissionHandler(){}async closeAllConnections(){}flushStorageData(){}}
const electron={BrowserWindow:Window,WebContentsView:View,ipcMain:{handle:(id,handler)=>handlers.set(id,handler),removeHandler:id=>handlers.delete(id)},session:{fromPath:folder=>{if(!sessions.has(folder))sessions.set(folder,new Session());return sessions.get(folder)}},safeStorage:{isEncryptionAvailable:()=>false},dialog:{},clipboard:{},nativeImage:{}};
const originalLoad=Module._load;Module._load=function(request,parent,isMain){return request==='electron'?electron:originalLoad.call(this,request,parent,isMain)};let XianyuWorkspace,xianyuRequestAllowed;try{({XianyuWorkspace,xianyuRequestAllowed}=require('../dist/main/main/xianyu'))}finally{Module._load=originalLoad}
function fixture(t){loadHook=undefined;const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-xianyu-lifecycle-'));let online=true;const workspace=new XianyuWorkspace({parent:()=>null,dataDir,roots:()=>[],canNetwork:()=>online,isEnabled:()=>true,validateAsset:()=>({title:'Synthetic local asset'}),searchBooth:async()=>{}});workspace.publicHost=async()=>{};t.after(async()=>{loadHook=undefined;await workspace.shutdown();sessions.delete(path.join(dataDir,'xianyu-session'));fs.rmSync(dataDir,{recursive:true,force:true})});return {workspace,setOnline:value=>online=value}}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function state(workspace){const entry=workspace.entry;return handlers.get(entry.channel)({sender:entry.window.webContents,senderFrame:entry.window.webContents.mainFrame},'state')}

test('closing an independent message window never reads BrowserWindow.webContents after destruction',async t=>{
 const f=fixture(t);await f.workspace.openMessages();const window=[...f.workspace.popups][0],contents=window.webContents;assert(f.workspace.owned.has(contents));assert.doesNotThrow(()=>window.destroy());assert.equal(f.workspace.popups.size,0);assert.equal(f.workspace.owned.has(contents),false);
});
test('closing nested official popups and workspace shutdown release captured contents without destroyed getters',async t=>{
 const f=fixture(t);await f.workspace.openMessages();const parent=[...f.workspace.popups][0],contents=parent.webContents,popup=new Window({});contents.emit('did-create-window',popup);const nested=popup.webContents;assert.equal(f.workspace.popups.size,2);assert.doesNotThrow(()=>popup.destroy());assert.equal(f.workspace.owned.has(nested),false);assert(f.workspace.owned.has(contents));await f.workspace.shutdown();assert.equal(parent.isDestroyed(),true);assert.equal(f.workspace.owned.size,0);
});
test('a message-window load failure reports a recoverable error and leaves no owned destroyed window',async t=>{
 const f=fixture(t);loadHook=async()=>{throw new Error('ERR_CONNECTION_RESET')};await assert.rejects(()=>f.workspace.openMessages(),/消息页暂时无法打开/);assert.equal(f.workspace.popups.size,0);assert.equal(f.workspace.owned.size,0);loadHook=undefined;await f.workspace.openMessages();assert.equal(f.workspace.popups.size,1);
});
test('closing while a message page loads does not show a late window or report a false connection failure',async t=>{
 const f=fixture(t);let rejectLoad;loadHook=async()=>new Promise((_resolve,reject)=>{rejectLoad=reject});const pending=f.workspace.openMessages();await settled();assert.equal(f.workspace.popups.size,1);assert.doesNotThrow(()=>f.workspace.close());rejectLoad(new Error('ERR_ABORTED'));await pending;assert.equal(f.workspace.popups.size,0);assert.equal(f.workspace.owned.size,0);
});
test('network failures and renderer exits cannot be replaced by a later successful-load status or source approval',async t=>{
 for(const failure of ['network','http','renderer']){const f=fixture(t);await f.workspace.open('one');const contents=f.workspace.entry.view.webContents;await contents.loadURL('https://www.goofish.com/item?id=123');assert.equal((await state(f.workspace)).canApply,true);
  if(failure==='renderer')contents.emit('render-process-gone');else{contents.emit('did-start-loading');if(failure==='http')contents.emit('did-navigate',{},contents.url,503);else contents.emit('did-fail-load',{},-101,'ERR_CONNECTION_RESET',contents.url,true);contents.emit('did-finish-load')}
  const failed=await state(f.workspace);assert.equal(failed.canApply,false,failure);assert(!failed.status.includes('官网浏览中'),failure);await contents.loadURL('https://www.goofish.com/item?id=123');assert.equal((await state(f.workspace)).canApply,true);
 }
});
test('offline connection cleanup failures are handled without an unhandled main-process rejection',async t=>{
 const f=fixture(t);await f.workspace.open('one');await f.workspace.entry.view.webContents.loadURL('https://www.goofish.com/item?id=123');f.workspace.remoteSession.closeAllConnections=async()=>{throw new Error('connection cleanup failed')};f.setOnline(false);f.workspace.networkChanged();await settled();const offline=await state(f.workspace);assert.equal(offline.online,false);assert.equal(offline.canApply,false);
});
test('only verified official chat endpoints permit secure websocket handshakes without broadening document navigation',()=>{
 for(const url of ['wss://wss-goofish.dingtalk.com:443/','wss://msgacs.m.taobao.com/accs/auth?token=SYNTHETIC_TOKEN'])assert.equal(xianyuRequestAllowed(url,'GET','webSocket'),true,url);
 for(const url of ['ws://wss-goofish.dingtalk.com/','wss://wss-goofish.dingtalk.com:444/','wss://private@wss-goofish.dingtalk.com/','wss://wss-goofish.dingtalk.com.evil.net/','wss://wss-goofish.dingtalk.com./','wss://other.dingtalk.com/','wss://www.goofish.com/','wss://127.0.0.1/','https://wss-goofish.dingtalk.com/'])assert.equal(xianyuRequestAllowed(url,'GET','webSocket'),false,url);
 for(const type of ['mainFrame','subFrame','image','xhr'])assert.equal(xianyuRequestAllowed('wss://wss-goofish.dingtalk.com/','GET',type),false,type);assert.equal(xianyuRequestAllowed('wss://wss-goofish.dingtalk.com/','POST','webSocket'),false);
});
test('websocket requests still pass public DNS and network permission checks in the real session policy',async t=>{
 const f=fixture(t);await f.workspace.openMessages();const hosts=[];f.workspace.publicHost=async host=>{hosts.push(host)};const input={url:'wss://wss-goofish.dingtalk.com:443/',method:'GET',resourceType:'webSocket'},request=()=>new Promise(resolve=>f.workspace.remoteSession.request(input,resolve));assert.deepEqual(await request(),{cancel:false});assert.deepEqual(hosts,['wss-goofish.dingtalk.com']);f.workspace.publicHost=async()=>{throw new Error('non-public DNS')};assert.deepEqual(await request(),{cancel:true});f.setOnline(false);assert.deepEqual(await request(),{cancel:true});
});
test('an owned message websocket failure has an honest reloadable status without reading chat or exposing a bridge',async t=>{
 const f=fixture(t);await f.workspace.openMessages();const window=[...f.workspace.popups][0],contents=window.webContents;assert.equal(window.options.webPreferences.preload,undefined);assert.equal(typeof f.workspace.remoteSession.requestError,'function');f.workspace.remoteSession.requestError({url:'wss://wss-goofish.dingtalk.com/',resourceType:'webSocket',webContentsId:contents.id,error:'net::ERR_CONNECTION_RESET'});assert.match(window.title,/连接.*Ctrl\+R/);contents.emit('did-finish-load');assert.match(window.title,/连接.*Ctrl\+R/);let prevented=false;contents.emit('before-input-event',{preventDefault(){prevented=true}},{type:'keyDown',key:'r',control:true});assert.equal(prevented,true);assert.equal(contents.reloads,1);assert.doesNotThrow(()=>window.destroy());f.workspace.remoteSession.requestError({url:'wss://wss-goofish.dingtalk.com/',resourceType:'webSocket',webContentsId:contents.id,error:'late'});
});
