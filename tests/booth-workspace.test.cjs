const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),Module=require('node:module'),{pathToFileURL}=require('node:url');

// A deterministic browser shell exercises the native policy without account credentials or live requests.
const handlers=new Map(),sessions=new Map();let encryptionAvailable=true;
class Contents extends EventEmitter {
 constructor(){super();this.url='';this.destroyed=false;this.mainFrame={};this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false,goBack(){},goForward(){}}}
 isDestroyed(){return this.destroyed}getURL(){return this.url}send(channel,value){this.lastSend={channel,value}}setWindowOpenHandler(handler){this.windowHandler=handler}
 async loadURL(url){this.url=url;this.emit('did-start-navigation',{isMainFrame:true});this.emit('did-navigate',{},url,200);this.emit('did-finish-load')}
 close(){this.destroyed=true}stop(){this.stopped=true}reload(){this.emit('did-finish-load')}
}
class Window extends EventEmitter {
 constructor(options){super();this.options=options;this.webContents=new Contents();this.contentView={addChildView:()=>{}};this.destroyed=false}
 setMenu(){}setTitle(title){this.title=title}getContentSize(){return [1200,900]}show(){this.shown=true}isDestroyed(){return this.destroyed}
 async loadFile(file){this.webContents.url=pathToFileURL(file).href}close(){this.destroy()}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed')}
}
class View {constructor(options){this.options=options;this.webContents=new Contents()}setBounds(value){this.bounds=value}setBackgroundColor(){}}
class Cookies extends EventEmitter {
 constructor(){super();this.items=[];this.flushes=0}async get(){return this.items.map(value=>({...value}))}
 async set(value){const u=new URL(value.url),cookie={...value,domain:value.domain||u.hostname,path:value.path||'/',session:!value.expirationDate,hostOnly:!value.domain};delete cookie.url;this.items=this.items.filter(item=>item.name!==cookie.name||item.domain!==cookie.domain||item.path!==cookie.path);this.items.push(cookie);this.emit('changed',{},cookie,'explicit',false)}
 async flushStore(){this.flushes++}
}
class Session extends EventEmitter {
 constructor(folder){super();this.folder=folder;this.cookies=new Cookies();this.webRequest={onBeforeRequest:handler=>{this.requestHandler=handler}}}
 setPermissionCheckHandler(value){this.checkPermission=value}setPermissionRequestHandler(value){this.requestPermission=value}setDevicePermissionHandler(value){this.devicePermission=value}
 async closeAllConnections(){}async clearStorageData(){this.cookies.items=[]}async clearCache(){this.cacheCleared=true}flushStorageData(){this.storageFlushed=true}
}
const mockElectron={BrowserWindow:Window,WebContentsView:View,ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)},session:{fromPath:folder=>{if(!sessions.has(folder))sessions.set(folder,new Session(folder));return sessions.get(folder)}},safeStorage:{isEncryptionAvailable:()=>encryptionAvailable,encryptString:value=>Buffer.from('encrypted:'+Buffer.from(value).toString('base64')),decryptString:bytes=>Buffer.from(bytes.toString().slice(10),'base64').toString()}};
const originalLoad=Module._load;Module._load=function(request,parent,isMain){return request==='electron'?mockElectron:originalLoad.call(this,request,parent,isMain)};
const {BoothWorkspace,BOOTH_ACCOUNT_URLS,boothBrowserUrl,boothAppliedProduct,boothSearchUrl,boothDownloadName,reserveBoothDownload}=require('../dist/main/main/booth-workspace');Module._load=originalLoad;
function fixture(t,extra={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-booth-tests-')),dataDir=path.join(root,'data'),source=path.join(root,'source'),downloadDir=path.join(root,'downloads');for(const folder of [dataDir,source,downloadDir])fs.mkdirSync(folder);
 let online=true,selected=downloadDir;const applies=[],imports=[];
 const deps={parent:()=>null,dataDir,roots:()=>[source],getDownloadDir:()=>selected,canNetwork:()=>online,validateAsset:id=>{if(id!=='asset-1')throw new Error('missing');return {title:'Veil Breeze'}},applyProduct:async(id,url)=>{applies.push({id,url})},onChanged(){},onDownloaded:async(file,url)=>{imports.push({file,url});return {assetId:'downloaded-1'}},...extra};
 const workspace=new BoothWorkspace(deps);workspace.publicHost=async()=>{};
 t.after(async()=>{await workspace.shutdown();fs.rmSync(root,{recursive:true,force:true});sessions.delete(path.join(dataDir,'booth-session'))});
 return {workspace,deps,root,dataDir,source,downloadDir,applies,imports,setOnline:value=>{online=value},setSelected:value=>{selected=value}};
}
const request=(workspace,url,method='GET',resourceType='mainFrame')=>new Promise(resolve=>workspace.remoteSession.requestHandler({url,method,resourceType},resolve));
function trustedEvent(workspace){const entry=workspace.entry;return {sender:entry.window.webContents,senderFrame:entry.window.webContents.mainFrame}}
async function command(workspace,input,event=trustedEvent(workspace)){return handlers.get(workspace.entry.channel)(event,input)}
class Download extends EventEmitter {
 constructor(options={}){super();this.options={gesture:true,origin:'https://booth.pm',url:'https://s.booth.pm/opaque/asset?token=TOP_SECRET_SIGNED_TOKEN',name:'Kaguya,Mizuki,Rurune_Veil_Breeze_v1.unitypackage',received:0,total:5,...options};this.path=undefined}
 hasUserGesture(){return this.options.gesture}getInitiatorOrigin(){return this.options.origin}getURL(){return this.options.url}getFilename(){return this.options.name}getTotalBytes(){return this.options.total}getReceivedBytes(){return this.options.received}setSavePath(file){this.path=file}cancel(){this.cancelled=true;this.emit('done',{},'cancelled')}
 progress(bytes){this.options.received=bytes;this.emit('updated',{},'progressing')}
 complete(){fs.writeFileSync(this.path,'abcde');this.options.received=5;this.emit('done',{},'completed')}
}
function start(workspace,download,contents=workspace.entry.view.webContents){let denied=false;workspace.remoteSession.emit('will-download',{preventDefault:()=>{denied=true}},download,contents);return denied}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('inbox account checks inspect only owned URLs and do not create sessions or read unverified purchase pages',async t=>{
 const f=fixture(t),signal=new AbortController().signal;
 assert.equal((await f.workspace.readInbox('background',signal)).state,'unsupported');assert.equal(f.workspace.remoteSession,undefined);
 await f.workspace.open({tab:'login'});await settled();assert.equal((await f.workspace.readInbox('foreground',signal)).state,'login');
 await f.workspace.entry.view.webContents.loadURL('https://accounts.booth.pm/library');
 f.workspace.entry.view.webContents.executeJavaScript=()=>{throw new Error('unverified account body must not be read')};
 assert.equal((await f.workspace.readInbox('foreground',signal)).state,'unsupported');f.setOnline(false);assert.equal((await f.workspace.readInbox('foreground',signal)).state,'paused');
});

test('clearing an unopened BOOTH login loads and empties its persisted session without browsing',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'booth-session'),remote=new Session(folder);
 await remote.cookies.set({url:'https://accounts.booth.pm/',name:'synthetic',value:'PRIVATE_TEST',path:'/'});sessions.set(folder,remote);
 f.setOnline(false);await f.workspace.clearSession();
 assert.deepEqual(await remote.cookies.get({}),[]);assert.equal(remote.cacheCleared,true);assert.equal(f.workspace.entry,undefined);
});

test('clearing a BOOTH login during initialization prevents a pending account window from reopening',async t=>{
 const f=fixture(t);let finish;f.workspace.restoreCookies=()=>new Promise(resolve=>finish=resolve);
 const opened=f.workspace.open({tab:'library'}),cleared=f.workspace.clearSession();
 const reopened=f.workspace.open({tab:'login'}).then(()=>({accepted:true}),error=>({error}));finish();await Promise.all([opened,cleared]);
 const result=await reopened;assert.match(result.error?.message||'window reopened',/清除/);
 assert.equal(f.workspace.entry,undefined);assert.deepEqual(await f.workspace.remoteSession.cookies.get({}),[]);
});

test('migration snapshots an unopened BOOTH profile and restores both cookie lifetimes without navigation',async t=>{
 const {prepareBoothSessionMigration}=require('../dist/main/main/booth-workspace');assert.equal(typeof prepareBoothSessionMigration,'function');const f=fixture(t),folder=path.join(f.dataDir,'booth-session'),remote=new Session(folder),expiry=Math.floor(Date.now()/1000)+3600;
 fs.mkdirSync(path.join(folder,'Network'),{recursive:true});fs.writeFileSync(path.join(folder,'Network','Cookies'),'OLD PERSISTENT COOKIE DATABASE');sessions.set(folder,remote);await remote.cookies.set({url:'https://accounts.booth.pm/',name:'persistent',value:'PERSISTENT_PRIVATE',path:'/',expirationDate:expiry});
 fs.writeFileSync(path.join(f.dataDir,'booth-session-cookies.bin'),mockElectron.safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies:[{domain:'accounts.booth.pm',name:'session',value:'SESSION_PRIVATE',path:'/',session:true,hostOnly:true}]})));
 const {Store}=require('../dist/main/main/store'),{copyLibraryData}=require('../dist/main/main/storage'),store=new Store(f.dataDir,[]);store.close();const snapshot=await prepareBoothSessionMigration(f.dataDir,[f.source]);assert.equal(f.workspace.remoteSession,undefined);assert.equal(f.workspace.entry,undefined);assert.equal(snapshot.profile,'booth-session');const target=path.join(f.root,'migrated');await copyLibraryData(f.dataDir,target,[f.source],true,[snapshot]);assert(!fs.existsSync(path.join(target,'booth-session','Network','Cookies')));
 const restarted=new BoothWorkspace({...f.deps,dataDir:target});restarted.publicHost=async()=>{};await restarted.open({tab:'library'});const cookies=await restarted.remoteSession.cookies.get({});assert.deepEqual(cookies.map(cookie=>cookie.name),['session','persistent']);assert.equal(cookies[1].expirationDate,expiry);await restarted.shutdown();
});
test('unopened BOOTH migration fails safely when credentials cannot be encrypted or read completely',async t=>{
 const {prepareBoothSessionMigration}=require('../dist/main/main/booth-workspace');assert.equal(typeof prepareBoothSessionMigration,'function');const f=fixture(t),folder=path.join(f.dataDir,'booth-session'),remote=new Session(folder);fs.mkdirSync(folder);sessions.set(folder,remote);const file=path.join(f.dataDir,'booth-session-cookies.bin'),original=mockElectron.safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies:[]}));fs.writeFileSync(file,original);
 encryptionAvailable=false;try{await assert.rejects(()=>prepareBoothSessionMigration(f.dataDir,[f.source]),/迁移已停止/)}finally{encryptionAvailable=true}assert.deepEqual(fs.readFileSync(file),original);
 remote.cookies.get=async()=>{throw new Error('Synthetic locked cookie export')};await assert.rejects(()=>prepareBoothSessionMigration(f.dataDir,[f.source]),/迁移已停止/);assert.deepEqual(fs.readFileSync(file),original);
});
test('BOOTH migration refuses an incomplete snapshot instead of trimming eligible credentials',async t=>{
 const {prepareBoothSessionMigration}=require('../dist/main/main/booth-workspace');for(const mode of ['count','bytes']){const f=fixture(t),folder=path.join(f.dataDir,'booth-session'),remote=new Session(folder);fs.mkdirSync(folder);sessions.set(folder,remote);for(let index=0;index<(mode==='count'?101:90);index++)await remote.cookies.set({url:'https://accounts.booth.pm/',name:'cookie-'+index,value:mode==='bytes'?'x'.repeat(3000):'SYNTHETIC',expirationDate:Math.floor(Date.now()/1000)+3600,path:'/'});const file=path.join(f.dataDir,'booth-session-cookies.bin'),original=mockElectron.safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies:[]}));fs.writeFileSync(file,original);await assert.rejects(()=>prepareBoothSessionMigration(f.dataDir,[f.source]),/迁移已停止/);assert.deepEqual(fs.readFileSync(file),original);assert.equal(f.workspace.remoteSession,undefined)}
});

test('BOOTH search recognizes late product clues, numeric IDs and exact item URLs while rejecting identity traps',()=>{
 assert.equal(boothSearchUrl('Veil Breeze'),'https://booth.pm/zh-cn/search/Veil%20Breeze');assert.equal(boothSearchUrl('6454372'),'https://booth.pm/zh-cn/items/6454372');
 assert.equal(boothSearchUrl('https://zaicrifice.booth.pm/items/6454372?x=1#desc'),'https://booth.pm/zh-cn/items/6454372');
 for(const value of ['https://booth.pm.evil.net/items/6454372','https://booth.pm/items/6454372/download','https://booth.pm/items/6454372extra','https://127.0.0.1/items/6454372','http://booth.pm/items/6454372','file:///E:/VRChat'])assert.equal(boothAppliedProduct(value),undefined,value);
 for(const value of ['',' '.repeat(4),'x'.repeat(301),'https://booth.pm/users/sign_in'])assert.throws(()=>boothSearchUrl(value));
 assert.equal(BOOTH_ACCOUNT_URLS.favorites,'https://accounts.booth.pm/wish_lists');assert.equal(BOOTH_ACCOUNT_URLS.gifts,'https://accounts.booth.pm/library/gifts');
 assert.equal(boothBrowserUrl(BOOTH_ACCOUNT_URLS.login).href,BOOTH_ACCOUNT_URLS.login);
 assert.throws(()=>boothBrowserUrl('https://secret:password@accounts.booth.pm/users/sign_in'));
});

test('search toolbar applies only the current loaded BOOTH product to its original asset and isolates web content IPC',async t=>{
 const f=fixture(t);await f.workspace.open({tab:'search',query:'Veil Breeze',assetId:'asset-1'});await settled();
 assert.equal((await command(f.workspace,'state')).canApply,false);const {entry}=f.workspace;
 assert.equal(entry.view.options.webPreferences.session.folder,path.join(f.dataDir,'booth-session'));
 assert.equal(entry.view.options.webPreferences.nodeIntegration,false);assert.equal(entry.view.options.webPreferences.sandbox,true);assert.equal(entry.view.options.webPreferences.preload,undefined);
 assert.notEqual(entry.window.options.webPreferences.partition,entry.view.options.webPreferences.partition);
 await assert.rejects(()=>command(f.workspace,'apply',{sender:entry.view.webContents,senderFrame:entry.view.webContents.mainFrame}),/来源/);
 await assert.rejects(()=>command(f.workspace,'apply'),/商品/);
 await entry.view.webContents.loadURL('https://zaicrifice.booth.pm/items/6454372?oauth_token=SECRET');assert.equal((await command(f.workspace,'state')).canApply,true);
 assert.equal(JSON.stringify(await command(f.workspace,'state')).includes('SECRET'),false);await command(f.workspace,'apply');assert.deepEqual(f.applies,[{id:'asset-1',url:'https://booth.pm/zh-cn/items/6454372'}]);assert.equal((await command(f.workspace,'state')).canApply,false);
 await entry.view.webContents.loadURL('https://booth.pm/items/6454373');assert.equal((await command(f.workspace,'state')).canApply,true);
 entry.view.webContents.emit('did-start-navigation',{isMainFrame:true});entry.view.webContents.emit('did-fail-load',{},-3,'ERR_ABORTED','https://s.booth.pm/download',true);assert.equal((await command(f.workspace,'state')).loading,false);assert.equal((await command(f.workspace,'state')).canApply,true);
 await entry.view.webContents.loadURL('https://booth.pm.evil.net/items/6454373');assert.equal((await command(f.workspace,'state')).canApply,false);
 await f.workspace.open({tab:'library'});assert.equal((await command(f.workspace,'state')).canApply,false);assert.equal(f.workspace.entry,entry);assert.equal(f.applies.length,1);
});

test('X BOOTH chrome starts black with its trusted initial theme while preserving 166px geometry and remote session isolation',async t=>{
 const f=fixture(t,{getTheme:()=> 'x'});await f.workspace.open({tab:'favorites'});const {entry}=f.workspace,local=entry.window.options.webPreferences,remote=entry.view.options.webPreferences;
 assert.equal(entry.window.options.backgroundColor,'#000000');assert.equal(entry.window.options.show,false);assert.equal(entry.window.shown,true);assert(local.additionalArguments.includes('--vrc-theme=x'));assert.equal((await command(f.workspace,'state')).theme,'x');assert.equal(entry.view.bounds.y,166);assert.equal(entry.view.bounds.height,734);assert.equal(remote.preload,undefined);assert.equal(remote.additionalArguments,undefined);assert.equal(remote.session.folder,path.join(f.dataDir,'booth-session'));assert.equal(remote.nodeIntegration,false);assert.equal(remote.contextIsolation,true);assert.equal(remote.sandbox,true);assert.equal((await command(f.workspace,'state')).tab,'favorites');
});

test('official login POST and OAuth windows use protected HTTPS session while local targets, unrelated uploads and offline requests are denied',async t=>{
 const f=fixture(t);await f.workspace.open({tab:'login'});await settled();
 assert.equal((await request(f.workspace,'https://accounts.pixiv.net/login','POST')).cancel,false);
 assert.equal((await request(f.workspace,'https://accounts.booth.pm/users/sign_in','POST')).cancel,false);
 assert.equal((await request(f.workspace,'https://booth.pm.evil.net/upload','POST')).cancel,true);
 for(const value of ['file:///E:/VRChat','http://booth.pm','https://127.0.0.1/','https://localhost/login'])assert.equal((await request(f.workspace,value)).cancel,true);
 const remote=f.workspace.entry.view.webContents;const popup=remote.windowHandler({url:'https://accounts.pixiv.net/login'});assert.equal(popup.action,'allow');assert.equal(popup.overrideBrowserWindowOptions.webPreferences.session,f.workspace.remoteSession);assert.equal(popup.overrideBrowserWindowOptions.webPreferences.preload,undefined);
 assert.equal(remote.windowHandler({url:'file:///E:/VRChat'}).action,'deny');assert.equal(f.workspace.remoteSession.checkPermission(),false);
 f.setOnline(false);assert.equal((await request(f.workspace,'https://accounts.booth.pm/library')).cancel,true);assert.equal(remote.windowHandler({url:'https://accounts.pixiv.net/login'}).action,'deny');
});

test('Windows encrypted cookie mirror restores official session and persistent cookies with their original expiry',async t=>{
 const f=fixture(t);await f.workspace.open({tab:'login'});await settled();const session=f.workspace.remoteSession;
 await session.cookies.set({url:'https://accounts.booth.pm/',name:'session_cookie',value:'PRIVATE_LOGIN_SECRET',secure:true,httpOnly:true,path:'/'});
 await session.cookies.set({url:'https://elsewhere.net/',name:'other',value:'OTHER_SECRET',secure:true,path:'/'});
 const expiry=Math.floor(Date.now()/1000)+3600;await session.cookies.set({url:'https://accounts.pixiv.net/',name:'persistent',value:'NATIVE_COOKIE',expirationDate:expiry,path:'/'});
 await session.cookies.set({url:'https://accounts.booth.pm/',name:'expired',value:'EXPIRED',expirationDate:Math.floor(Date.now()/1000)-10,path:'/'});
 await f.workspace.shutdown();const encrypted=fs.readFileSync(path.join(f.dataDir,'booth-session-cookies.bin'));assert.equal(encrypted.toString().includes('PRIVATE_LOGIN_SECRET'),false);const mirror=JSON.parse(mockElectron.safeStorage.decryptString(encrypted));assert.deepEqual(mirror.cookies.map(cookie=>cookie.name),['session_cookie','persistent']);assert.equal(mirror.cookies[1].expirationDate,expiry);
 assert.equal(JSON.stringify(f.workspace.snapshot()).includes('PRIVATE_LOGIN_SECRET'),false);sessions.delete(path.join(f.dataDir,'booth-session'));
 const restarted=new BoothWorkspace(f.deps);restarted.publicHost=async()=>{};await restarted.open({tab:'library'});await settled();const restored=await restarted.remoteSession.cookies.get({});assert.equal(restored.length,2);assert.equal(restored[0].value,'PRIVATE_LOGIN_SECRET');assert.equal(restored[0].session,true);assert.equal(restored[1].value,'NATIVE_COOKIE');assert.equal(restored[1].session,false);assert.equal(restored[1].expirationDate,expiry);
 await restarted.clearSession();assert.equal(fs.existsSync(path.join(f.dataDir,'booth-session-cookies.bin')),false);assert.equal((await restarted.remoteSession.cookies.get({})).length,0);assert.equal(restarted.entry,undefined);await restarted.shutdown();
});

test('missing OS encryption never writes a plaintext credential fallback',async t=>{
 const f=fixture(t);encryptionAvailable=false;try{await f.workspace.open({tab:'login'});await f.workspace.remoteSession.cookies.set({url:'https://accounts.booth.pm/',name:'cookie',value:'SECRET_WITHOUT_ENCRYPTION'});await f.workspace.shutdown();assert.equal(fs.existsSync(path.join(f.dataDir,'booth-session-cookies.bin')),false);assert.equal(f.workspace.snapshot().sessionSaved,false)}finally{encryptionAvailable=true}
});

test('BOOTH cookie restore rejects expired, malformed and unrelated entries while existing cookies win',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'booth-session'),remote=new Session(folder),expiry=Math.floor(Date.now()/1000)+3600; sessions.set(folder,remote);
 await remote.cookies.set({url:'https://accounts.booth.pm/',name:'existing',value:'CURRENT',path:'/'});
 const valid={domain:'accounts.booth.pm',path:'/',name:'restored',value:'RESTORED',session:false,expirationDate:expiry,hostOnly:true,secure:true,httpOnly:true,sameSite:'lax'};
 const cookies=[{...valid,name:'existing',value:'STALE'}, {...valid}, {...valid,name:'expired',expirationDate:expiry-7200}, {...valid,name:'bad-expiry',expirationDate:'tomorrow'}, {...valid,name:'bad-session',session:'false'}, {...valid,name:'unrelated',domain:'booth.pm.evil.net'}, {...valid,name:'bad-domain',domain:'other/booth.pm'}, {...valid,name:'bad-path',path:{}}, {...valid,name:'bad-flags',secure:'yes'}, {...valid,name:'bad-samesite',sameSite:'anything'}, {...valid,name:'bad-value',value:3}, {...valid,name:'session-with-expiry',session:true}];
 fs.writeFileSync(path.join(f.dataDir,'booth-session-cookies.bin'),mockElectron.safeStorage.encryptString(JSON.stringify({at:Date.now(),cookies})));
 await f.workspace.open({tab:'library'});const restored=await remote.cookies.get({});assert.deepEqual(restored.map(cookie=>[cookie.name,cookie.value]),[['existing','CURRENT'],['restored','RESTORED']]);assert.equal(restored[1].expirationDate,expiry);
});

test('BOOTH encrypted cookie mirrors retain their age, count and byte limits',async t=>{
 for(const mode of ['old','future','oversize']){const f=fixture(t),file=path.join(f.dataDir,'booth-session-cookies.bin'),payload={at:mode==='old'?Date.now()-31*86400000:mode==='future'?Date.now()+120000:Date.now(),cookies:[{domain:'booth.pm',path:'/',name:'ignored',value:'SECRET',session:true}]};fs.writeFileSync(file,mode==='oversize'?Buffer.alloc(256*1024+1):mockElectron.safeStorage.encryptString(JSON.stringify(payload)));await f.workspace.open({tab:'library'});assert.equal((await f.workspace.remoteSession.cookies.get({})).length,0,mode)}
 const f=fixture(t);await f.workspace.open({tab:'login'});for(let index=0;index<110;index++)await f.workspace.remoteSession.cookies.set({url:'https://accounts.booth.pm/',name:'cookie-'+index,value:'x'.repeat(3000),path:'/'});await f.workspace.shutdown();const encrypted=fs.readFileSync(path.join(f.dataDir,'booth-session-cookies.bin')),payload=JSON.parse(mockElectron.safeStorage.decryptString(encrypted));assert(encrypted.length<=256*1024);assert(payload.cookies.length>0&&payload.cookies.length<=100);
});

test('download paths are exclusive and cannot overwrite originals, traverse filenames or follow directory junctions',t=>{
 const f=fixture(t);const original=path.join(f.source,'Veil_Breeze.zip');fs.writeFileSync(original,'original');
 assert.throws(()=>reserveBoothDownload(f.source,'Veil_Breeze.zip',f.dataDir,[f.source]),/保护/);assert.equal(fs.readFileSync(original,'utf8'),'original');
 const first=reserveBoothDownload(f.downloadDir,'同名😀.zip',f.dataDir,[f.source]),second=reserveBoothDownload(f.downloadDir,'同名😀.zip',f.dataDir,[f.source]);assert.notEqual(first,second);assert.equal(path.basename(first),'同名😀.zip');
 assert.equal(boothDownloadName('..\\evil/CON.zip'), '.._evil_CON.zip');assert.equal(boothDownloadName('CON.zip'),'_CON.zip');assert.equal(boothDownloadName(' '),'download');
 const junction=path.join(f.root,'linked');fs.symlinkSync(f.source,junction,process.platform==='win32'?'junction':'dir');assert.throws(()=>reserveBoothDownload(junction,'x.zip',f.dataDir,[f.source]),/链接|保护/);
});

test('only explicit BOOTH-owned gestures download; signed addresses stay private and completed imports persist across restart',async t=>{
 const f=fixture(t);await f.workspace.open({tab:'search',query:'6454372',assetId:'asset-1'});await settled();
 for(const options of [{gesture:false},{origin:'https://evil.net'},{url:'file:///E:/VRChat'}]){const item=new Download(options);assert.equal(start(f.workspace,item),true);assert.equal(item.path,undefined)}
 assert.equal(start(f.workspace,new Download(),new Contents()),true);f.setSelected(undefined);assert.equal(start(f.workspace,new Download()),true);f.setSelected(f.downloadDir);
 const download=new Download();assert.equal(start(f.workspace,download),false);assert.ok(download.path.startsWith(f.downloadDir));download.progress(3);assert.equal(f.workspace.snapshot().downloads[0].receivedBytes,3);assert.ok(f.workspace.snapshot().downloads[0].downloadBps>0);
 assert.equal(JSON.stringify(f.workspace.snapshot()).includes('TOP_SECRET_SIGNED_TOKEN'),false);download.complete();await settled();await f.workspace.shutdown();
 assert.equal(f.imports.length,1);assert.equal(f.imports[0].url,'https://booth.pm/zh-cn/items/6454372');const record=f.workspace.snapshot().downloads[0];assert.equal(record.state,'completed');assert.equal(record.assetId,'downloaded-1');assert.equal(record.downloadBps,0);assert.equal(f.workspace.downloadPath(record.id),download.path);
 assert.equal(fs.readFileSync(path.join(f.dataDir,'booth-downloads.json'),'utf8').includes('TOP_SECRET_SIGNED_TOKEN'),false);const restarted=new BoothWorkspace(f.deps);assert.equal(restarted.snapshot().downloads[0].assetId,'downloaded-1');assert.equal(restarted.snapshot().downloads[0].state,'completed');await restarted.shutdown();
});

test('closing website leaves user download running; shutdown interrupts it and waits for a completed import before Store may close',async t=>{
 let release,importStarted=false;const f=fixture(t,{onDownloaded:async()=>{importStarted=true;await new Promise(resolve=>{release=resolve});return {assetId:'waited-asset'}}});await f.workspace.open({tab:'library'});await settled();
 const first=new Download();assert.equal(start(f.workspace,first),false);f.workspace.close();assert.equal(first.cancelled,undefined);assert.equal(f.workspace.snapshot().downloads[0].state,'downloading');
 await f.workspace.open({tab:'library'});await settled();const second=new Download();assert.equal(start(f.workspace,second),false);second.complete();await settled();assert.equal(importStarted,true);
 let finished=false;const stopping=f.workspace.shutdown().then(()=>{finished=true});await settled();assert.equal(finished,false);assert.equal(first.cancelled,true);release();await stopping;assert.equal(finished,true);
 assert.equal(f.workspace.snapshot().downloads.find(value=>value.id===f.workspace.downloads[1].id).state,'interrupted');assert.equal(f.workspace.snapshot().downloads[0].assetId,'waited-asset');
});

test('completed-file import failure can be retried explicitly without another download or false product association',async t=>{
 let count=0;const f=fixture(t,{onDownloaded:async(file,source)=>{assert.equal(source,undefined);if(!count++)throw new Error('failed');return {assetId:'recovered'}}});await f.workspace.open({tab:'library'});await settled();
 const download=new Download();start(f.workspace,download);download.complete();await settled();const id=f.workspace.snapshot().downloads[0].id;assert.equal(f.workspace.snapshot().downloads[0].state,'completed');assert.equal(f.workspace.snapshot().downloads[0].assetId,undefined);assert.match(f.workspace.snapshot().downloads[0].error,/导入/);
 await f.workspace.retryImport(id);assert.equal(f.workspace.snapshot().downloads[0].assetId,'recovered');assert.equal(f.workspace.snapshot().downloads[0].error,undefined);assert.equal(count,2);
});

test('restoring a library releases the old session hooks so replacement workspace can still download and account can reopen after clearing',async t=>{
 const f=fixture(t);await f.workspace.open({tab:'library'});const session=f.workspace.remoteSession;assert.equal(session.listenerCount('will-download'),1);await f.workspace.shutdown();assert.equal(session.listenerCount('will-download'),0);
 const replacement=new BoothWorkspace(f.deps);replacement.publicHost=async()=>{};await replacement.open({tab:'library'});assert.equal(replacement.remoteSession,session);assert.equal(session.listenerCount('will-download'),1);const item=new Download();assert.equal(start(replacement,item),false);item.complete();await settled();assert.equal(replacement.snapshot().downloads[0].assetId,'downloaded-1');
 await replacement.clearSession();assert.equal(session.listenerCount('will-download'),0);await replacement.open({tab:'library'});assert.equal(session.listenerCount('will-download'),1);await replacement.shutdown();
});
