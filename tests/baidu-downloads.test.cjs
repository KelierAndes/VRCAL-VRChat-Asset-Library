const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),{EventEmitter}=require('node:events');
const {BAIDU_SHARE_SNAPSHOT}=require('../dist/main/main/baidu-share-page');
class Contents extends EventEmitter{
 constructor(){super();this.id=123;this.url='';this.destroyed=false;this.data={title:'Synthetic share',path:'/s/1Example',files:[{index:0,name:'衣装_日本語😀.rar',directory:false,sizeText:'4 B'}],back:false}}
 setWindowOpenHandler(fn){this.popup=fn}getURL(){return this.url}isDestroyed(){return this.destroyed}close(){this.destroyed=true}
 async loadURL(url){this.url=url}async executeJavaScript(script){if(script===BAIDU_SHARE_SNAPSHOT)return this.data;if(script.includes('bottom_download_btn'))this.download?.();return 'waiting'}
}
class View {constructor(options){this.options=options;this.webContents=new Contents()}setBounds(){}}
const original=Module._load;let exports_;try{Module._load=function(id,parent,main){return id==='electron'?{WebContentsView:View}:original.call(this,id,parent,main)};exports_=require('../dist/main/main/baidu-downloads')}finally{Module._load=original}
const {BaiduDownloads,baiduDownloadName,baiduDownloadUrl}=exports_;
class Download extends EventEmitter{
 constructor(name='衣装_日本語😀.rar',urls=['https://d.pcs.baidu.com/file/fixture']){super();this.name=name;this.urls=urls;this.received=0;this.paused=false}
 getFilename(){return this.name}getURLChain(){return this.urls}getTotalBytes(){return 4}getReceivedBytes(){return this.received}setSavePath(file){this.file=file}isPaused(){return this.paused}canResume(){return true}
 pause(){this.paused=true}resume(){this.paused=false}cancel(){this.emit('done',{},'cancelled')}
 complete(){fs.writeFileSync(this.file,Buffer.from([1,2,3,4]));this.received=4;this.emit('updated',{},'progressing');this.emit('done',{},'completed')}
}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-baidu-download-')),dataDir=path.join(root,'Library'),source=path.join(root,'Source'),downloads=path.join(root,'Downloads');for(const dir of [dataDir,source,downloads])fs.mkdirSync(dir);let online=true,cookies=[{name:'BDUSS',value:'SYNTHETIC_TEST_COOKIE',domain:'.baidu.com'}];const deps={dataDir,roots:()=>[source],session:async()=>({cookies:{get:async()=>cookies}}),canNetwork:()=>online,changed(){}};const manager=new BaiduDownloads(deps);manager.setDirectory(downloads);t.after(async()=>{await manager.shutdown();const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true})});return {manager,deps,dataDir,source,downloads,setCookies:value=>cookies=value,setOnline:value=>online=value}}
const share='https://pan.baidu.com/s/1Example?pwd=abcd';
async function listed(f){await f.manager.read(share);return f.manager.state().files[0]}
function arm(f,item){const event={prevented:false,preventDefault(){this.prevented=true}};f.manager.view.webContents.download=()=>f.manager.accept(event,item,f.manager.view.webContents);return event}

test('download filenames and origins reject traversal, devices, protocols and deceptive domains',()=>{
 assert.equal(baiduDownloadName('衣装_日本語😀.rar'),'衣装_日本語😀.rar');for(const name of ['../x','C:\\x','CON.txt','nul','a:stream','a.',' a','x/../z','x\0z',''])assert.throws(()=>baiduDownloadName(name));
 for(const url of ['https://pan.baidu.com/a','https://d.pcs.baidu.com/a','https://c.baidupcs.com/a','https://x.bcebos.com/a'])assert.equal(baiduDownloadUrl(url),true);
 for(const url of ['http://pan.baidu.com/a','https://baidu.com.evil.org/a','https://evilbaidu.com/a','https://user@pan.baidu.com/a','file:///a','baidunetdisk://a','https://127.0.0.1/a'])assert.equal(baiduDownloadUrl(url),false);
});
test('authentication is required before listing; page access never opens a window or exposes the session',async t=>{
 const f=fixture(t);f.setCookies([]);await assert.rejects(f.manager.read(share));assert.equal(f.manager.view,undefined);assert.equal(f.manager.state().loggedIn,false);
 f.setCookies([{name:'BDUSS',value:'SYNTHETIC_TEST_COOKIE',domain:'.baidu.com'}]);await listed(f);assert.equal(f.manager.state().loggedIn,true);assert.doesNotMatch(JSON.stringify(f.manager.state()),/COOKIE|BDUSS|pwd=|abcd|account|https:/);assert.deepEqual(f.manager.view.webContents.popup(),{action:'deny'});assert.equal(f.manager.view.options.webPreferences.nodeIntegration,false);assert.equal(f.manager.view.options.webPreferences.sandbox,true);
});
test('source directories, library data, and symlink destinations stay protected',async t=>{
 const f=fixture(t);assert.throws(()=>f.manager.setDirectory(f.source));assert.throws(()=>f.manager.setDirectory(f.dataDir));const link=path.join(f.downloads,'link');fs.symlinkSync(f.source,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>f.manager.setDirectory(link));
 await listed(f);const wc=f.manager.view.webContents,event={preventDefault(){this.prevented=true}};assert.equal(f.manager.accept(event,new Download(),wc),true);assert.equal(event.prevented,true);assert.equal(f.manager.state().tasks.length,0);assert.equal(f.manager.accept({},new Download(),new Contents()),false);
});
test('approved download supports pause/resume, no-overwrite completion, history and restart without share secrets',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();const event=arm(f,item);await f.manager.download(file.id);assert.equal(event.prevented,false);let task=f.manager.state().tasks[0];assert.equal(task.state,'downloading');assert.ok(item.file.endsWith('.rar.part'));assert.ok(!fs.existsSync(item.file.slice(0,-5)));
 f.manager.control(task.id,'pause');assert.equal(f.manager.state().tasks[0].state,'paused');f.manager.control(task.id,'resume');assert.equal(f.manager.state().tasks[0].state,'downloading');item.complete();assert.equal(f.manager.state().tasks[0].state,'completed');assert.deepEqual(fs.readFileSync(f.manager.reveal(task.id)),Buffer.from([1,2,3,4]));
 const raw=fs.readFileSync(path.join(f.dataDir,'baidu-downloads.json'),'utf8');assert.doesNotMatch(raw,/COOKIE|BDUSS|pwd=|abcd|account|https:/);const restored=new BaiduDownloads(f.deps);assert.equal(restored.state().tasks[0].state,'completed');assert.equal(restored.state().downloadDir,f.downloads);
});
test('unrelated downloads, stale file rows and unexpected redirects cannot write',async t=>{
 const f=fixture(t),file=await listed(f);f.manager.view.webContents.data.path='/changed';await assert.rejects(f.manager.download(file.id));assert.equal(f.manager.state().tasks.length,0);f.manager.view.webContents.data.path='/s/1Example';
 for(const item of [new Download('other.rar'),new Download(undefined,['https://evil.org/secret']),new Download(undefined,[])]){
  f.manager.view.webContents.download=()=>{const event={preventDefault(){this.prevented=true}};f.manager.accept(event,item,f.manager.view.webContents);assert.equal(event.prevented,true);assert.equal(item.file,undefined);f.manager.stop()};
  await assert.rejects(f.manager.download(f.manager.state().files[0].id));await listed(f);
 }
});
test('completion never overwrites an existing final file; interrupted tasks remain retryable on restart',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();arm(f,item);await f.manager.download(file.id);fs.writeFileSync(item.file.slice(0,-5),'EXISTING');item.complete();const task=f.manager.state().tasks[0];assert.equal(task.state,'interrupted');assert.equal(fs.readFileSync(item.file.slice(0,-5),'utf8'),'EXISTING');assert.throws(()=>f.manager.reveal(task.id));
 const file2=f.manager.state().files[0],item2=new Download();arm(f,item2);await f.manager.download(file2.id);const restored=new BaiduDownloads(f.deps);assert.equal(restored.state().tasks[0].state,'interrupted');await f.manager.shutdown();assert.equal(f.manager.active.size,0);
});
test('offline and session invalidation clear listings and cancel active writes',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();arm(f,item);await f.manager.download(file.id);f.setOnline(false);await f.manager.shutdown();assert.equal(f.manager.state().files.length,0);assert.equal(f.manager.state().tasks[0].state,'cancelled');assert.equal(f.manager.state().loggedIn,false);await assert.rejects(f.manager.read(share));
});

 test('journal writes never truncate a preexisting temporary file or its hard-linked source',t=>{
 const f=fixture(t),source=path.join(f.source,'original.txt'),temp=path.join(f.dataDir,'baidu-downloads.json.tmp');fs.writeFileSync(source,'ORIGINAL');fs.linkSync(source,temp);f.manager.setDirectory(f.downloads);assert.equal(fs.readFileSync(source,'utf8'),'ORIGINAL');assert.equal(fs.readFileSync(temp,'utf8'),'ORIGINAL');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir,'baidu-downloads.json'),'utf8')).schema,1);
});
