const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),Module=require('node:module'),{pathToFileURL}=require('node:url');
const pageFile=path.join(__dirname,'../dist/main/main/baidu-page.js');
const page=fs.existsSync(pageFile)?require(pageFile):{};
const accountKey='baidu:'+ 'a'.repeat(64),url='https://pan.baidu.com/disk/main#/index?category=all&path=%2FVRChat%2F%E8%A1%A3%E8%A3%85';
// Contract fixture for the desktop table layout, NOT a captured/logged-in live-page fixture.
// Unknown or changed live markup must refuse capture; these explicit row attributes/labels are required.
const row=(name,extra='data-isdir="0" data-size="1024"',id='101')=>`<div class="wp-s-pan-table__body-row" data-fsid="${id}" ${extra}><span class="wp-s-pan-table__file-name-text" title="${name}">${name}</span><span class="wp-s-pan-table__file-size">1 KB</span><time datetime="2026-10-20T01:02:03Z">2026-10-20 09:02</time></div>`;
const html=(rows)=>`<div class="wp-s-pan-table"><div class="wp-s-pan-table__body">${rows}</div></div>`;
const parse=(source=html(row('衣装_日本語.unitypackage')),override={})=>page.parseBaiduVisiblePage({url,html:source,accountKey,capturedAt:'2026-10-21T00:00:00.000Z',...override});

test('visible Baidu reader exports an actual parser',()=>assert.equal(typeof page.parseBaiduVisiblePage,'function'));
test('captures only explicit directory rows with Unicode and always partial scope',()=>{
 const result=parse(html(row('衣装_日本語.unitypackage')+row('髪型','data-isdir="1"','102')));
 assert.deepEqual(result,{accountKey,directoryPath:'/VRChat/衣装',items:[{id:'101',name:'衣装_日本語.unitypackage',path:'/VRChat/衣装/衣装_日本語.unitypackage',directory:false,size:1024,modifiedAt:'2026-10-20T01:02:03.000Z'},{id:'102',name:'髪型',path:'/VRChat/衣装/髪型',directory:true,modifiedAt:'2026-10-20T01:02:03.000Z'}],capturedAt:'2026-10-21T00:00:00.000Z',complete:false,source:'web-visible',warnings:['visible-partial','live-layout-unverified']});
});
test('deduplicates repeated virtual rows and refuses conflicting identities',()=>{
 assert.equal(parse(html(row('a.zip')+row('a.zip'))).items.length,1);
 assert.throws(()=>parse(html(row('a.zip')+row('b.zip'))),/conflict/);
 assert.throws(()=>parse(html(row('a.zip')+row('a.zip','data-isdir="0" data-size="2"'))),/conflict/);
});
test('refuses unknown markup, login/error pages and unknown directory instead of treating them as files',()=>{
 for(const source of ['<p>2026-10-21 推荐内容.zip</p>','<a href="/folder/123">最近使用</a>',html('<div class="wp-s-pan-table__body-row">2026-10-21</div>'),html(row('a.zip','')),'<input type="password">'+html(row('a.zip')),html('')])assert.throws(()=>parse(source),/unsupported|login/);
 for(const unknown of ['https://pan.baidu.com/disk/main','https://pan.baidu.com/disk/main#/recent?path=%2F','https://pan.baidu.com/disk/main#/index?category=video&path=%2F','https://passport.baidu.com/v2/?login','https://evil.test/disk/main#/index?path=%2F'])assert.throws(()=>parse(undefined,{url:unknown}),/directory|official/);
 assert.throws(()=>parse(undefined,{accountKey:'BDUSS=SECRET'}),/identity/);
});
test('rejects traversal, path mismatches and ambiguous fields without inventing directories',()=>{
 for(const name of ['..','.','..%2Fsecret','bad/name','bad\\name','&#0;','x&#10;y'])assert.throws(()=>parse(html(row(name))),/name|path/);
 for(const cloudPath of ['/VRChat/../x','/VRChat//x','/VRChat/./x','/VRChat/%2e%2e/x','/VRChat/衣装/'])assert.throws(()=>parse(undefined,{url:'https://pan.baidu.com/disk/main#/index?category=all&path='+encodeURIComponent(cloudPath)}),/path/);
 assert.throws(()=>parse(html(row('x.zip','data-isdir="0" data-path="/wrong/x.zip"'))),/path/);
 assert.throws(()=>parse(undefined,{url:url+'&path=%2Fother'}),/directory/);
});
test('keeps hostile names as inert text and never exports cookies, signed URLs or unrelated page text',()=>{
 const result=parse('<script>document.cookie="TOP_SECRET"</script><a href="https://pan.baidu.com/s/secret?bdstoken=TOP_SECRET">SECRET_TOKEN</a>'+html(row('&lt;img onerror=alert(1)&gt;.zip')));
 assert.equal(result.items[0].name,'<img onerror=alert(1)>.zip');
 assert.doesNotMatch(JSON.stringify(result),/TOP_SECRET|SECRET_TOKEN|bdstoken|document.cookie/);
 assert.equal(page.baiduDisplayUrl('https://pan.baidu.com/disk/main?bdstoken=SECRET#/index?path=%2Fx&token=SECRET'),'https://pan.baidu.com/disk/main');
});
test('only exact official HTTPS navigation and usable owned-login cookies establish identity',()=>{
 assert.equal(page.baiduBrowserUrl('https://passport.baidu.com/v2/?login').hostname,'passport.baidu.com');
 for(const bad of ['http://pan.baidu.com/disk/main','https://pan.baidu.com.evil.test/disk/main','https://pan.baidu.com:444/disk/main','https://me:secret@pan.baidu.com/disk/main','file:///E:/VRChat','https://127.0.0.1/','https://www.baidu.com/'])assert.throws(()=>page.baiduBrowserUrl(bad));
 const owned=[{name:'BDUSS',value:'PRIVATE_LOGIN_A',domain:'.baidu.com',path:'/'}];
 assert.match(page.baiduAccountKey(owned),/^baidu:[a-f0-9]{64}$/);
 assert.equal(page.baiduAccountKey(owned),page.baiduAccountKey([...owned,{name:'BAIDUID',value:'noise',domain:'.baidu.com'}]));
 assert.notEqual(page.baiduAccountKey(owned),page.baiduAccountKey([{...owned[0],value:'PRIVATE_LOGIN_B'}]));
 assert.equal(page.baiduAccountKey([{...owned[0],domain:'.evil.baidu.com'}]),undefined);
 assert.equal(page.baiduAccountKey([{...owned[0],name:'BAIDUID'}]),undefined);
 assert.equal(page.baiduAccountKey([...owned,{...owned[0],value:'CONFLICT'}]),undefined);
 assert.doesNotMatch(page.baiduAccountKey(owned),/PRIVATE_LOGIN/);
});
test('known cloud directory links are encoded safely and invalid paths refuse',()=>{
 assert.equal(page.baiduDirectoryUrl('/VRChat/衣装'),'https://pan.baidu.com/disk/main#/index?category=all&path=%2FVRChat%2F%E8%A1%A3%E8%A3%85');
 for(const value of ['/../private','C:\\data','/x//y','/x/%2e%2e/y'])assert.throws(()=>page.baiduDirectoryUrl(value),/path/);
});

// Native APIs are replaced only at the Electron boundary: no browser is opened and no account is accessed.
const handlers=new Map(),sessions=new Map(),windows=[];let encryptionAvailable=true;
class Contents extends EventEmitter{
 constructor(){super();this.url='';this.destroyed=false;this.mainFrame={};this.navigationHistory={canGoBack:()=>false,goBack(){}};this.snapshot={url,html:html(row('a.zip'))}}
 isDestroyed(){return this.destroyed}getURL(){return this.url}getZoomFactor(){return 1}send(channel,value){this.lastSend={channel,value}}setWindowOpenHandler(handler){this.windowHandler=handler}
 async loadURL(value){this.url=value;this.emit('did-start-navigation',{isMainFrame:true});this.emit('did-navigate',{},value,200);this.emit('did-finish-load')}
 async executeJavaScript(){if(this.onCapture)await this.onCapture();return this.snapshot}close(){this.destroyed=true}stop(){this.stopped=true}reload(){}
}
class Window extends EventEmitter{
 constructor(options){super();this.options=options;this.webContents=new Contents();this.contentView={addChildView:()=>{}};this.destroyed=false;windows.push(this)}
 setMenu(){}setTitle(){}setBackgroundColor(){}getContentSize(){return [1200,900]}show(){}focus(){}isDestroyed(){return this.destroyed}
 async loadFile(file){this.webContents.url=pathToFileURL(file).href}close(){this.destroy()}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed')}
}
class View{constructor(options){this.options=options;this.webContents=new Contents()}setBounds(){}setBackgroundColor(){}}
class Cookies extends EventEmitter{constructor(){super();this.items=[]}async get(){return this.items.map(value=>({...value}))}async flushStore(){}async set(value){const url=new URL(value.url),cookie={...value,domain:value.domain||url.hostname,path:value.path||'/',session:!value.expirationDate,hostOnly:!value.domain};delete cookie.url;this.items=this.items.filter(item=>item.name!==cookie.name||item.domain!==cookie.domain||item.path!==cookie.path);this.items.push(cookie);this.emit('changed',{},cookie,'explicit',false)} }
class Session extends EventEmitter{
 constructor(folder){super();this.folder=folder;this.cookies=new Cookies();this.webRequest={onBeforeRequest:handler=>{this.requestHandler=handler}}}
 setPermissionCheckHandler(fn){this.checkPermission=fn}setPermissionRequestHandler(fn){this.requestPermission=fn}setDevicePermissionHandler(fn){this.devicePermission=fn}
 async closeAllConnections(){}async clearStorageData(){this.cookies.items=[]}async clearCache(){}flushStorageData(){}
}
const electron={BrowserWindow:Window,WebContentsView:View,ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key),on(){},removeListener(){}},session:{fromPath:folder=>{if(!sessions.has(folder))sessions.set(folder,new Session(folder));return sessions.get(folder)}},safeStorage:{isEncryptionAvailable:()=>encryptionAvailable,encryptString:value=>Buffer.from('encrypted:'+Buffer.from(value).toString('base64')),decryptString:bytes=>{if(!bytes.toString().startsWith('encrypted:'))throw new Error('invalid cipher');return Buffer.from(bytes.toString().slice(10),'base64').toString()}}};
function workspaceModule(){const old=Module._load;try{Module._load=function(request,parent,isMain){return request==='electron'?electron:old.call(this,request,parent,isMain)};return require('../dist/main/main/baidu-workspace')}finally{Module._load=old}}
function fixture(t,extra={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-baidu-')),dataDir=path.join(root,'data');fs.mkdirSync(dataDir);let online=true;const delivered=[],{BaiduWorkspace}=workspaceModule();const workspace=new BaiduWorkspace({parent:()=>null,dataDir,roots:()=>[],canNetwork:()=>online,onChanged(){},onCapture:value=>{delivered.push(value)},...extra});workspace.publicHost=async()=>{};t.after(async()=>{await workspace.shutdown();fs.rmSync(root,{recursive:true,force:true});sessions.delete(path.join(dataDir,'baidu-session'))});return {workspace,dataDir,delivered,setOnline:value=>{online=value}}}
async function loaded(f){await f.workspace.open();const e=f.workspace.entry;e.view.webContents.url=url;e.view.webContents.emit('did-finish-load');return e}
function login(f,value='PRIVATE_LOGIN_A'){f.workspace.remoteSession.cookies.items=[{name:'BDUSS',value,domain:'.baidu.com',path:'/'}]}
const command=(f,action,event)=>{const e=f.workspace.entry;return handlers.get(e.channel)(event||{sender:e.window.webContents,senderFrame:e.window.webContents.mainFrame},action)};
test('owned session and local toolbar isolate native IPC while capture establishes partial connection',async t=>{
 const f=fixture(t),e=await loaded(f);login(f);
 assert.equal(e.view.options.webPreferences.preload,undefined);assert.equal(e.view.options.webPreferences.sandbox,true);assert.equal(e.view.options.webPreferences.contextIsolation,true);assert.equal(e.view.options.webPreferences.nodeIntegration,false);
 assert.equal(e.view.options.webPreferences.session.folder,path.join(f.dataDir,'baidu-session'));assert.match(e.toolbarUrl,/^file:\/\/\/C:|^file:\/\//);
 assert.equal(f.workspace.state().connected,false);await assert.rejects(()=>command(f,'capture',{sender:e.view.webContents,senderFrame:e.view.webContents.mainFrame}),/source|来源/);
 await command(f,'capture');assert.equal(f.workspace.state().connected,true);assert.equal(f.delivered.length,1);assert.equal(f.delivered[0].complete,false);
 assert.equal(f.workspace.takeCapture().items[0].name,'a.zip');assert.equal(f.workspace.takeCapture(),undefined);
 assert.doesNotMatch(JSON.stringify(f.workspace.state())+JSON.stringify(e.window.webContents.lastSend),/PRIVATE_LOGIN|BDUSS|token=/);
 assert.deepEqual(e.view.webContents.windowHandler({url:'https://pan.baidu.com/disk/main'}),{action:'deny'});
 let denied=false;f.workspace.remoteSession.emit('will-download',{preventDefault(){denied=true}});assert.equal(denied,true);
});
test('capture refuses missing identity and account changes during DOM collection',async t=>{
 const f=fixture(t),e=await loaded(f);await assert.rejects(()=>f.workspace.capture(),/login|登录|identity/);login(f);e.view.webContents.onCapture=()=>login(f,'PRIVATE_LOGIN_B');
 await assert.rejects(()=>f.workspace.capture(),/changed|变化|切换/);assert.equal(f.workspace.state().connected,false);assert.equal(f.delivered.length,0);assert.equal(f.workspace.takeCapture(),undefined);
});
test('network off and cleared session invalidate capture without importing another profile',async t=>{
 const f=fixture(t);await loaded(f);login(f);await f.workspace.capture();f.setOnline(false);f.workspace.networkChanged();assert.equal(f.workspace.state().connected,false);await assert.rejects(()=>f.workspace.capture(),/offline|联网/);
 f.setOnline(true);await f.workspace.clearSession();assert.equal(f.workspace.state().open,false);assert.equal(f.workspace.state().connected,false);assert.equal(f.workspace.takeCapture(),undefined);assert.deepEqual(f.workspace.remoteSession.cookies.items,[]);
});
test('toolbar URL and capture URL never reveal query or fragment credentials',async t=>{
 const f=fixture(t),e=await loaded(f);e.view.webContents.url='https://passport.baidu.com/v2/?token=SECRET#SECRET';assert.equal(f.workspace.state().url,'https://passport.baidu.com/v2/');assert.doesNotMatch(JSON.stringify(await command(f,'state')),/SECRET/);
});
test('known directory open reuses the existing owned window and changes only its official route',async t=>{
 const f=fixture(t);await f.workspace.open('/VRChat/衣装');const e=f.workspace.entry;assert.equal(e.view.webContents.url,'https://pan.baidu.com/disk/main#/index?category=all&path=%2FVRChat%2F%E8%A1%A3%E8%A3%85');
 await f.workspace.open('/');assert.equal(f.workspace.entry,e);assert.equal(e.view.webContents.url,'https://pan.baidu.com/disk/main#/index?category=all&path=%2F');await assert.rejects(()=>f.workspace.open('/../wrong'),/path/);
});
test('same-document folder navigation restores ready state without waiting for another full-page load',async t=>{
 const f=fixture(t),e=await loaded(f);login(f);
 e.view.webContents.emit('did-start-navigation',{isMainFrame:true});
 const next=page.baiduDirectoryUrl('/素材/子目录');e.view.webContents.url=next;
 e.view.webContents.emit('did-navigate-in-page',{},next,true);
 assert.equal(f.workspace.state().loading,false);
 e.view.webContents.snapshot={url:next,html:html(row('child.zip'))};
 assert.equal((await f.workspace.capture()).directoryPath,'/素材/子目录');
});
test('HTTP errors cannot become capture-ready when finish-load subsequently fires',async t=>{
 const f=fixture(t),e=await loaded(f);login(f);e.view.webContents.emit('did-navigate',{},url,503);e.view.webContents.emit('did-finish-load');await assert.rejects(()=>f.workspace.capture());assert.equal(f.workspace.state().connected,false);
});
test('clear-session clears an owned persisted profile even before the window was opened',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'baidu-session'),remote=new Session(folder);remote.cookies.items=[{name:'BDUSS',value:'PRIVATE_PERSISTED',domain:'.baidu.com',path:'/'}];sessions.set(folder,remote);await f.workspace.clearSession();assert.deepEqual(remote.cookies.items,[]);assert.equal(f.workspace.state().open,false);
});
test('network policy allows public HTTPS CDN assets but denies unsafe top pages and all requests offline',async t=>{
 const f=fixture(t);await loaded(f);const request=(url,resourceType='mainFrame')=>new Promise(resolve=>f.workspace.remoteSession.requestHandler({url,resourceType,method:'GET'},resolve));
 assert.deepEqual(await request('https://pan.baidu.com/disk/main'),{cancel:false});assert.deepEqual(await request('https://passport.baidu.com/v2/'),{cancel:false});assert.deepEqual(await request('https://cdn.bdstatic.com/ui.png','image'),{cancel:false});assert.deepEqual(await request('https://public-cdn.example.net/chunk.js','script'),{cancel:false});
 assert.deepEqual(await request('https://evil.net/'),{cancel:true});assert.deepEqual(await request('file:///C:/private.txt','script'),{cancel:true});assert.deepEqual(await request('https://127.0.0.1/x','image'),{cancel:true});f.setOnline(false);f.workspace.networkChanged();assert.deepEqual(await request('https://pan.baidu.com/disk/main'),{cancel:true});
});
test('shutdown releases owned session listeners and reopening installs each policy exactly once',async t=>{
 const f=fixture(t);await loaded(f);const remote=f.workspace.remoteSession;assert.equal(remote.listenerCount('will-download'),1);assert.equal(remote.cookies.listenerCount('changed'),1);await f.workspace.shutdown();
 assert.equal(remote.listenerCount('will-download'),0);assert.equal(remote.cookies.listenerCount('changed'),0);assert.equal(remote.requestHandler,null);
 await loaded(f);assert.equal(remote.listenerCount('will-download'),1);assert.equal(remote.cookies.listenerCount('changed'),1);login(f);assert.equal((await f.workspace.capture()).items.length,1);
});
test('login-cookie changes revoke previous proof and only the new account can produce another capture',async t=>{
 let changes=0;const f=fixture(t,{onChanged(){changes++}});await loaded(f);login(f);const first=await f.workspace.capture(),before=changes;login(f,'PRIVATE_OTHER_ACCOUNT');f.workspace.remoteSession.cookies.emit('changed',{},f.workspace.remoteSession.cookies.items[0],'explicit',false);
 assert.equal(f.workspace.state().connected,false);assert.equal(f.workspace.takeCapture(),undefined);assert.ok(changes>before);const second=await f.workspace.capture();assert.notEqual(first.accountKey,second.accountKey);assert.equal(second.accountKey,f.workspace.state().accountKey);
});
test('owned migration snapshots restore persistent and session cookies without another browser or raw credential files',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'baidu-session');fs.mkdirSync(folder);const remote=new Session(folder);sessions.set(folder,remote);const expiry=Math.floor(Date.now()/1000)+3600;
 await remote.cookies.set({url:'https://pan.baidu.com',domain:'.baidu.com',name:'BDUSS',value:'PRIVATE_PERSISTENT',expirationDate:expiry});await remote.cookies.set({url:'https://passport.baidu.com',name:'SESSION_LOGIN',value:'PRIVATE_SESSION'});await remote.cookies.set({url:'https://evil.test',name:'FOREIGN',value:'PRIVATE_FOREIGN'});
 const {prepareBaiduSessionMigration,BaiduWorkspace}=workspaceModule();assert.equal(typeof prepareBaiduSessionMigration,'function');const proof=await prepareBaiduSessionMigration(f.dataDir,[]);assert.equal(proof.profile,'baidu-session');assert.match(proof.sha256,/^[a-f0-9]{64}$/);
 const file=path.join(f.dataDir,'baidu-session-cookies.bin'),bytes=fs.readFileSync(file);assert.doesNotMatch(bytes.toString(),/PRIVATE_PERSISTENT|PRIVATE_SESSION|PRIVATE_FOREIGN/);
 const target=path.join(f.dataDir,'moved');fs.mkdirSync(target);fs.copyFileSync(file,path.join(target,'baidu-session-cookies.bin'));const migrated=new BaiduWorkspace({parent:()=>null,dataDir:target,roots:()=>[],canNetwork:()=>true,onChanged(){}});migrated.publicHost=async()=>{};await migrated.open();
 assert.deepEqual(migrated.remoteSession.cookies.items.map(cookie=>cookie.name),['BDUSS','SESSION_LOGIN']);assert.equal(migrated.remoteSession.cookies.items[0].expirationDate,expiry);assert.equal(migrated.remoteSession.cookies.items[1].session,true);assert.doesNotMatch(JSON.stringify(migrated.state()),/PRIVATE_/);await migrated.shutdown();
});
test('migration stops when OS encryption or a complete owned-cookie export is unavailable',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'baidu-session');fs.mkdirSync(folder);const {prepareBaiduSessionMigration}=workspaceModule();encryptionAvailable=false;try{await assert.rejects(()=>prepareBaiduSessionMigration(f.dataDir,[]),/迁移已停止/)}finally{encryptionAvailable=true}
 assert.equal(fs.existsSync(path.join(f.dataDir,'baidu-session-cookies.bin')),false);const remote=new Session(folder);remote.cookies.get=async()=>{throw new Error('locked synthetic profile')};sessions.set(folder,remote);await assert.rejects(()=>prepareBaiduSessionMigration(f.dataDir,[]),/迁移已停止/);
});
test('later account change invalidates an old migration mirror and clear-session removes its credentials',async t=>{
 const f=fixture(t);await loaded(f);login(f);const {prepareBaiduSessionMigration}=workspaceModule();await prepareBaiduSessionMigration(f.dataDir,[]);const mirror=path.join(f.dataDir,'baidu-session-cookies.bin');assert.equal(fs.existsSync(mirror),true);
 login(f,'PRIVATE_CHANGED');f.workspace.remoteSession.cookies.emit('changed',{},f.workspace.remoteSession.cookies.items[0],'explicit',false);assert.equal(fs.existsSync(mirror),false);await prepareBaiduSessionMigration(f.dataDir,[]);await f.workspace.clearSession();assert.equal(fs.existsSync(mirror),false);
});
test('an old migration mirror cannot restore a logged-out native profile or resurrect it during another migration',async t=>{
 const f=fixture(t),folder=path.join(f.dataDir,'baidu-session');fs.mkdirSync(path.join(folder,'Network'),{recursive:true});fs.writeFileSync(path.join(folder,'Network','Cookies'),'SYNTHETIC_NATIVE_COOKIE_DB');
 const old={at:Date.now(),cookies:[{name:'BDUSS',value:'PRIVATE_OLD_LOGIN',domain:'.baidu.com',path:'/',session:true,hostOnly:false}]};fs.writeFileSync(path.join(f.dataDir,'baidu-session-cookies.bin'),electron.safeStorage.encryptString(JSON.stringify(old)));await loaded(f);
 assert.deepEqual(f.workspace.remoteSession.cookies.items,[]);await assert.rejects(()=>f.workspace.capture(),/login|登录|identity/);const {prepareBaiduSessionMigration}=workspaceModule();await prepareBaiduSessionMigration(f.dataDir,[]);const exported=JSON.parse(electron.safeStorage.decryptString(fs.readFileSync(path.join(f.dataDir,'baidu-session-cookies.bin'))));assert.deepEqual(exported.cookies,[]);
});
