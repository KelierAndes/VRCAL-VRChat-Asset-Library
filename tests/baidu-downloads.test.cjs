const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module'),{EventEmitter}=require('node:events');
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

async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10))}assert.fail('Expected download state did not arrive')}
async function multiListed(f,names){await f.manager.read(share);f.manager.view.webContents.data.files=names.map((name,index)=>({index,name,directory:false,sizeText:'4 B'}));await f.manager.read(share);return f.manager.state().files}
test('selected downloads validate atomically, deduplicate and advance FIFO only after finalized-file registration',async t=>{
 const f=fixture(t),files=await multiListed(f,['MAT_TEX_Crimson_lupus_ver1.01.zip','Crimson_lupus_rurune_ver1.02.zip','PSD_mdp_Crimson_lupus_ver1.00.zip']);
 assert.equal(typeof f.manager.downloadMany,'function');const starts=[],items=[],imports=[],taskStarts=[];let releaseImport;f.deps.onTaskStarted=id=>{taskStarts.push(id);assert.ok(f.manager.state().tasks.some(task=>task.id===id))};
 f.deps.onDownloaded=async file=>{assert.equal(fs.statSync(file).size,4);assert.ok(!file.endsWith('.part'));imports.push(file);if(imports.length===1)await new Promise(resolve=>releaseImport=resolve);return {assetId:'asset-'+imports.length}};
 f.manager.view.webContents.download=()=>{const item=new Download(files[starts.length].name);starts.push(item.name);items.push(item);f.manager.accept({preventDefault(){assert.fail('Valid selected download rejected')}},item,f.manager.view.webContents)};
 await assert.rejects(f.manager.downloadMany([files[0].id,'not-current']));assert.deepEqual(starts,[]);
 await assert.rejects(f.manager.downloadMany([]));await assert.rejects(f.manager.downloadMany(Array(101).fill(files[0].id)));await assert.rejects(f.manager.downloadMany('not-an-array'));
 await f.manager.downloadMany([files[0].id,files[0].id,files[1].id,files[2].id]);assert.deepEqual(starts,[files[0].name]);assert.equal(f.manager.state().queued,2);
 assert.throws(()=>f.manager.setDirectory(f.downloads));await assert.rejects(f.manager.read(share));items[0].complete();await waitFor(()=>imports.length===1);assert.equal(starts.length,1);assert.equal(f.manager.state().busy,true);releaseImport();
 await waitFor(()=>starts.length===2);items[1].complete();await waitFor(()=>starts.length===3);items[2].complete();await waitFor(()=>!f.manager.state().busy);
 assert.deepEqual(starts,files.map(file=>file.name));assert.equal(imports.length,3);assert.equal(new Set(imports.map(file=>path.dirname(file))).size,1);assert.equal(f.manager.state().queued,0);assert.ok(f.manager.state().tasks.every(task=>task.assetId));assert.deepEqual(taskStarts,f.manager.state().tasks.toReversed().map(task=>task.id));
});
test('registration failure preserves completed bytes, stops queue, supports safe one-shot retry and awaits shutdown',async t=>{
 const f=fixture(t),files=await multiListed(f,['Outfit_v1.zip','Unrelated_v1.zip']),item=new Download(files[0].name);let calls=0;f.deps.onDownloaded=async()=>{calls++;throw Error('PRIVATE PATH OR SOURCE URL')};arm(f,item);
 await f.manager.downloadMany(files.map(file=>file.id));item.complete();await waitFor(()=>!f.manager.state().busy);let task=f.manager.state().tasks[0];assert.equal(task.state,'completed');assert.match(task.importError,/入库/);assert.doesNotMatch(task.importError,/PRIVATE/);assert.equal(f.manager.state().queued,0);assert.equal(calls,1);assert.ok(fs.existsSync(f.manager.reveal(task.id)));
 let finish;f.deps.onDownloaded=async()=>{calls++;await new Promise(resolve=>finish=resolve);return {assetId:'asset-recovered'}};const retry=f.manager.retryImport(task.id);await waitFor(()=>calls===2);await assert.rejects(f.manager.retryImport(task.id));let closed=false;const shutdown=f.manager.shutdown().then(()=>closed=true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false);finish();await Promise.all([retry,shutdown]);task=f.manager.state().tasks[0];assert.equal(task.assetId,'asset-recovered');assert.equal(task.importError,undefined);await f.manager.retryImport(task.id);assert.equal(calls,2);
 const restored=new BaiduDownloads(f.deps);assert.equal(restored.state().tasks[0].assetId,'asset-recovered');assert.doesNotMatch(fs.readFileSync(path.join(f.dataDir,'baidu-downloads.json'),'utf8'),/PRIVATE|pwd=|COOKIE|https:/);
});
test('batch interruption, cancellation, offline and account changes prevent further files',async t=>{
 for(const reason of ['interrupt','cancel','offline','account']){
  const f=fixture(t),files=await multiListed(f,['First.zip','Second.zip']);const items=[];
  f.manager.view.webContents.download=()=>{const item=new Download(files[items.length].name);items.push(item);f.manager.accept({preventDefault(){}},item,f.manager.view.webContents)};
  await f.manager.downloadMany(files.map(file=>file.id));
  if(reason==='interrupt')items[0].emit('done',{},'interrupted');
  if(reason==='cancel')f.manager.control(f.manager.state().tasks[0].id,'cancel');
  if(reason==='offline'){f.setOnline(false);items[0].complete()}
  if(reason==='account'){f.setCookies([{name:'BDUSS',value:'OTHER_SYNTHETIC_COOKIE',domain:'.baidu.com'}]);items[0].complete()}
  await waitFor(()=>!f.manager.state().busy);assert.equal(items.length,1,reason);assert.equal(f.manager.state().queued,0,reason);
 }
});
test('cancelling the remainder keeps the active download and source sentinel untouched',async t=>{
 const f=fixture(t),sentinel=path.join(f.source,'original.zip');fs.writeFileSync(sentinel,'ORIGINAL');const snapshot=()=>fs.readdirSync(f.source).sort().map(name=>{const file=path.join(f.source,name),stat=fs.statSync(file);return {name,size:stat.size,mtime:stat.mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}}),before=snapshot(),files=await multiListed(f,['First.zip','Second.zip']),item=new Download(files[0].name);let calls=0;f.deps.onDownloaded=async()=>{calls++;return {assetId:'one'}};arm(f,item);
 await f.manager.downloadMany(files.map(file=>file.id));f.manager.cancelBatch();assert.equal(f.manager.state().queued,0);assert.equal(f.manager.state().tasks[0].state,'downloading');item.complete();await waitFor(()=>!f.manager.state().busy);assert.equal(calls,1);assert.deepEqual(snapshot(),before);
});
test('same-product folders survive restart but distinct products and shares remain separate',async t=>{
 const f=fixture(t);let files=await multiListed(f,['MAT_TEX_Crimson_lupus_ver1.01.zip','Different_product.zip']);let item=new Download(files[0].name);arm(f,item);await f.manager.download(files[0].id);item.complete();await waitFor(()=>!f.manager.state().busy);const first=f.manager.reveal(f.manager.state().tasks[0].id),restored=new BaiduDownloads(f.deps);
 await restored.read(share);restored.view.webContents.data.files=[{index:0,name:'Crimson_lupus_rurune_ver1.02.zip',directory:false,sizeText:'4 B'}];await restored.read(share);item=new Download('Crimson_lupus_rurune_ver1.02.zip');const fake={manager:restored};arm(fake,item);await restored.download(restored.state().files[0].id);item.complete();await waitFor(()=>!restored.state().busy);assert.equal(path.dirname(restored.reveal(restored.state().tasks[0].id)),path.dirname(first));
 item=new Download(files[1].name);arm(f,item);await f.manager.download(files[1].id);item.complete();await waitFor(()=>!f.manager.state().busy);assert.notEqual(path.dirname(f.manager.reveal(f.manager.state().tasks[0].id)),path.dirname(first));await restored.shutdown();
});
test('an interrupted transfer clears the remainder even when the website offers resume',async t=>{
 const f=fixture(t),files=await multiListed(f,['One.zip','Two.zip']),item=new Download(files[0].name);arm(f,item);await f.manager.downloadMany(files.map(file=>file.id));item.emit('updated',{},'interrupted');assert.equal(f.manager.state().tasks[0].state,'paused');assert.equal(f.manager.state().queued,0);f.manager.control(f.manager.state().tasks[0].id,'resume');item.complete();await waitFor(()=>!f.manager.state().busy);assert.equal(f.manager.state().tasks.length,1);
});
test('a substituted partial-file link is blocked before the native downloader receives its path',async t=>{
 const f=fixture(t),files=await multiListed(f,['One.zip','Two.zip']),item=new Download(files[0].name),source=path.join(f.source,'original.txt');fs.writeFileSync(source,'ORIGINAL');
 f.manager.view.webContents.download=()=>{const pending=f.manager.pending,partial=path.join(pending.folder,pending.file.name+'.part');fs.symlinkSync(path.join(f.source,'not-created'),partial,process.platform==='win32'?'junction':'dir');const event={preventDefault(){this.prevented=true}};f.manager.accept(event,item,f.manager.view.webContents);assert.equal(event.prevented,true);assert.equal(item.file,undefined)};
 await assert.rejects(f.manager.downloadMany(files.map(file=>file.id)));assert.equal(f.manager.state().tasks.length,0);assert.equal(f.manager.state().queued,0);assert.equal(fs.readFileSync(source,'utf8'),'ORIGINAL');
});
test('failed finalization never registers a partial file and retry rejects a replaced completed file',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let imports=0;f.deps.onDownloaded=async()=>{imports++;return {assetId:'one'}};arm(f,item);await f.manager.download(file.id);fs.writeFileSync(item.file.slice(0,-5),'EXISTING');item.complete();await waitFor(()=>!f.manager.state().busy);assert.equal(imports,0);await assert.rejects(f.manager.retryImport(f.manager.state().tasks[0].id));
 const second=new Download();arm(f,second);await f.manager.download(file.id);f.deps.onDownloaded=async()=>{throw Error('fixture failure')};second.complete();await waitFor(()=>!f.manager.state().busy);const task=f.manager.state().tasks[0],target=f.manager.reveal(task.id);fs.unlinkSync(target);fs.symlinkSync(f.source,target,process.platform==='win32'?'junction':'dir');await assert.rejects(f.manager.retryImport(task.id));assert.equal(imports,0);
});
test('local task-start observer failures cannot cancel an approved download or safe save',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let observed=0;f.deps.onTaskStarted=()=>{observed++;throw Error('Synthetic observer failure')};arm(f,item);await f.manager.download(file.id);item.complete();await waitFor(()=>!f.manager.state().busy);assert.equal(observed,1);assert.equal(f.manager.state().tasks[0].state,'completed');assert.equal(fs.statSync(f.manager.reveal(f.manager.state().tasks[0].id)).size,4);
});
test('stale listings stop the remaining selection; legacy UUID download folders remain revealable after restart',async t=>{
 const f=fixture(t),files=await multiListed(f,['One.zip','Two.zip']),item=new Download(files[0].name);arm(f,item);await f.manager.downloadMany(files.map(file=>file.id));f.manager.view.webContents.data.path='/changed-by-page';item.complete();await waitFor(()=>!f.manager.state().busy);assert.equal(f.manager.state().tasks.length,1);assert.equal(f.manager.state().queued,0);
 const id=crypto.randomUUID(),folder=path.join(f.downloads,id);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'Legacy.zip'),'OLD');fs.writeFileSync(path.join(f.dataDir,'baidu-downloads.json'),JSON.stringify({schema:1,directory:f.downloads,tasks:[{id,folder,name:'Legacy.zip',state:'completed',receivedBytes:3,totalBytes:3,startedAt:new Date().toISOString()}]}));
 const restored=new BaiduDownloads(f.deps);assert.equal(fs.readFileSync(restored.reveal(id),'utf8'),'OLD');assert.equal(restored.state().queued,0);await restored.shutdown();
});
test('same-size completed-file replacement before automatic registration is rejected',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let calls=0;f.deps.onDownloaded=async()=>{calls++;return {assetId:'wrong-replacement'}};arm(f,item);await f.manager.download(file.id);item.complete();const task=f.manager.state().tasks[0],target=f.manager.reveal(task.id);fs.renameSync(target,target+'.original');fs.writeFileSync(target,'USER');await waitFor(()=>!f.manager.state().busy);assert.equal(calls,0);assert.match(f.manager.state().tasks[0].importError,/入库/);assert.equal(f.manager.state().tasks[0].assetId,undefined);
});
test('failed-import identity survives restart and blocks same-size replacement on explicit retry',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let calls=0;f.deps.onDownloaded=async()=>{calls++;throw Error('fixture failure')};arm(f,item);await f.manager.download(file.id);item.complete();await waitFor(()=>!f.manager.state().busy);const task=f.manager.state().tasks[0],target=f.manager.reveal(task.id);assert.equal(calls,1);assert.equal(task.fileIdentity,undefined);
 const journal=JSON.parse(fs.readFileSync(path.join(f.dataDir,'baidu-downloads.json'),'utf8'));assert.ok(journal.tasks[0].fileIdentity);fs.renameSync(target,target+'.original');fs.writeFileSync(target,'USER');const restored=new BaiduDownloads(f.deps);await assert.rejects(restored.retryImport(task.id));assert.equal(calls,1);assert.equal(restored.state().tasks[0].fileIdentity,undefined);await restored.shutdown();
});
test('unchanged stamped download can retry after restart; same-inode edits cannot',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let calls=0;f.deps.onDownloaded=async()=>{calls++;throw Error('fixture failure')};arm(f,item);await f.manager.download(file.id);item.complete();await waitFor(()=>!f.manager.state().busy);const task=f.manager.state().tasks[0],target=f.manager.reveal(task.id),restored=new BaiduDownloads(f.deps);assert.equal(calls,1);
 f.deps.onDownloaded=async()=>{calls++;return {assetId:'recovered-after-restart'}};await restored.retryImport(task.id);assert.equal(calls,2);assert.equal(restored.state().tasks[0].assetId,'recovered-after-restart');await restored.shutdown();
 const before=fs.lstatSync(target,{bigint:true});fs.writeFileSync(target,'EDIT');const modified=new Date(Number(before.mtimeNs/1000000n)+1000);fs.utimesSync(target,modified,modified);assert.equal(fs.lstatSync(target,{bigint:true}).ino,before.ino);await assert.rejects(f.manager.retryImport(task.id));assert.equal(calls,2);
});
test('legacy unstamped history remains readonly and is never silently adopted for import',async t=>{
 const f=fixture(t),id=crypto.randomUUID(),folder=path.join(f.downloads,id);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'Legacy.zip'),'OLD');fs.writeFileSync(path.join(f.dataDir,'baidu-downloads.json'),JSON.stringify({schema:1,directory:f.downloads,tasks:[{id,folder,name:'Legacy.zip',state:'completed',receivedBytes:3,totalBytes:3,startedAt:new Date().toISOString()}]}));let calls=0;f.deps.onDownloaded=async()=>{calls++;return {assetId:'unexpected'}};const restored=new BaiduDownloads(f.deps);assert.equal(fs.readFileSync(restored.reveal(id),'utf8'),'OLD');assert.equal(calls,0);await assert.rejects(restored.retryImport(id),/校验/);assert.equal(calls,0);await restored.shutdown();
});
test('ordinary managed-directory replacement with copied marker cannot receive a native download',async t=>{
 const f=fixture(t),file=await listed(f),item=new Download();let replaced=false,event;f.manager.view.webContents.download=()=>{const pending=f.manager.pending,folder=pending.folder,old=folder+'.original';fs.renameSync(folder,old);fs.mkdirSync(folder);fs.copyFileSync(path.join(old,'.vrcal-download-group.json'),path.join(folder,'.vrcal-download-group.json'));replaced=true;event={preventDefault(){this.prevented=true}};f.manager.accept(event,item,f.manager.view.webContents)};
 await assert.rejects(f.manager.download(file.id));assert.equal(replaced,true);assert.equal(event.prevented,true);assert.equal(item.file,undefined);assert.equal(f.manager.state().tasks.length,0);
});

 test('journal writes never truncate a preexisting temporary file or its hard-linked source',t=>{
 const f=fixture(t),source=path.join(f.source,'original.txt'),temp=path.join(f.dataDir,'baidu-downloads.json.tmp');fs.writeFileSync(source,'ORIGINAL');fs.linkSync(source,temp);f.manager.setDirectory(f.downloads);assert.equal(fs.readFileSync(source,'utf8'),'ORIGINAL');assert.equal(fs.readFileSync(temp,'utf8'),'ORIGINAL');assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir,'baidu-downloads.json'),'utf8')).schema,1);
});
