// Actual application/main-process integration. Only the remote page's selected
// file list and DownloadItem transfer are simulated. No live account or network.
// Store, importCompletedDownload, IPC handlers, change events, projection and
// renderer refresh stay unmodified. Optional executable must be an extracted app.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{_electron}=require('playwright'),{Store}=require('../dist/main/main/store');
const repo=path.resolve(__dirname,'..'),executable=process.env.VRC_TEST_APP_EXECUTABLE;
if(executable&&(!path.isAbsolute(executable)||!fs.statSync(executable).isFile()))throw Error('VRC_TEST_APP_EXECUTABLE must name the extracted application executable');
const run=fs.mkdtempSync(path.resolve(repo,'../native-download-library-')),profile=path.join(run,'Library'),root=path.join(run,'Original sources 日本語'),downloads=path.join(run,'Selected downloads');
for(const directory of [root,downloads,path.join(root,'nested')])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(root,'read-only.txt'),'This pre-existing source must never be renamed, moved, scanned or modified.\n');fs.writeFileSync(path.join(root,'nested','keep.png'),Buffer.from('Synthetic original image bytes'));
const tree=directory=>{const rows=[];const walk=p=>{for(const entry of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(p,entry.name),s=fs.lstatSync(file);assert(!s.isSymbolicLink());if(entry.isDirectory()){rows.push({name:path.relative(directory,file).replace(/\\/g,'/'),directory:true});walk(file)}else rows.push({name:path.relative(directory,file).replace(/\\/g,'/'),bytes:s.size,mtimeMs:s.mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})}};walk(directory);return rows};
const baseline=tree(root),checks=[],errors=[];let app,page;
const source='https://pan.baidu.com/s/1SyntheticNativeShare',cookie='SYNTHETIC_NATIVE_COOKIE_NOT_A_REAL_CREDENTIAL',signed='SYNTHETIC_SIGNED_DOWNLOAD_NOT_A_REAL_TOKEN';
const names=['MAT_TEX_TestGown_ver1.01.zip','TestGown_Shinano_ver1.02.zip','PSD_mdp_TestGown_ver1.00.zip'];
const mark=label=>{checks.push(label);console.log('PASS:',label)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function launch(){
 app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:[repo],timeout:60000,env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:root,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:'1',VRC_LIBRARY_NO_EDITOR_LAUNCH:'1'}});
 page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.library);await page.locator('[data-nav="materials"]').waitFor();
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));if(!window)throw Error('Main application window missing');window.showInactive();window.webContents.setBackgroundThrottling(false)});
 const snapshot=await page.evaluate(()=>window.library.snapshot());assert.equal(snapshot.settings.dataDir,profile);assert.equal(snapshot.settings.onlineEnabled,false);assert.equal(snapshot.scan.running,false);
 await page.evaluate(()=>{globalThis.__downloadEvents=[];globalThis.__unsubscribeDownloadEvents=window.library.onEvent(event=>globalThis.__downloadEvents.push(event.type))});
 return {version:await app.evaluate(({app})=>app.getVersion()),packaged:await app.evaluate(({app})=>app.isPackaged)};
}
async function screenshot(name){await app.evaluate(async({BrowserWindow},file)=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));process.getBuiltinModule('node:fs').writeFileSync(file,(await window.webContents.capturePage()).toPNG())},path.join(run,name))}
async function instrument(){
 await app.evaluate(({app})=>{
  const path=process.getBuiltinModule('node:path'),load=process.mainModule.require.bind(process.mainModule),dir=path.join(app.getAppPath(),'dist','main','main'),{BaiduDownloads}=load(path.join(dir,'baidu-downloads.js')),{Scanner}=load(path.join(dir,'scanner.js'));
  globalThis.__nativeDownloadIntegration={scans:0,transfers:0,accepted:0,prevented:0,names:[]};
  Scanner.prototype.scan=function(){globalThis.__nativeDownloadIntegration.scans++;throw Error('Global scanning is forbidden in this incremental download integration test')};
  const original=BaiduDownloads.prototype.state;BaiduDownloads.prototype.state=function(...args){globalThis.__nativeDownloadManager=this;return original.apply(this,args)};globalThis.__restoreNativeDownloadState=()=>{BaiduDownloads.prototype.state=original};
 });
 await page.evaluate(()=>window.library.baiduDownloadsState());
 await app.evaluate(async({WebContentsView,session,dialog},args)=>{
  const assert=process.mainModule.require('node:assert/strict'),fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path'),{EventEmitter}=process.mainModule.require('node:events'),manager=globalThis.__nativeDownloadManager,diagnostics=globalThis.__nativeDownloadIntegration;
  if(!manager)throw Error('The actual main-process download manager was not captured');globalThis.__restoreNativeDownloadState();
  assert.equal(process.env.VRC_LIBRARY_NO_NETWORK,'1');assert.equal(manager.deps.canNetwork(),false);
  // This one manager accepts only fixture transfers. The production onDownloaded
  // callback keeps NO_NETWORK=1, so it can never enqueue real BOOTH lookups.
  manager.deps.canNetwork=()=>true;
  const remote=session.fromPartition('vrcal-native-transfer-'+process.getBuiltinModule('node:crypto').randomUUID());await remote.cookies.set({url:'https://pan.baidu.com/',name:'BDUSS',value:args.cookie,path:'/',secure:true,httpOnly:true});
  manager.remote=remote;manager.view=new WebContentsView({webPreferences:{session:remote,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}});
  manager.source=args.source;manager.pagePath='/s/1SyntheticNativeShare#/MAT';manager.title='Synthetic selected material and adaptation downloads';manager.phase='ready';manager.loggedIn=true;
  manager.files=args.names.map((name,index)=>({id:'synthetic-file-'+index,index,name,directory:false,sizeText:'22 B'}));
  manager.assertPage=async()=>{assert.equal(manager.source,args.source);assert.equal(manager.pagePath,'/s/1SyntheticNativeShare#/MAT');assert.equal(manager.files.length,3)};
  manager.evaluate=async script=>{
   const pending=manager.pending;if(!pending)throw Error('Only an armed ordinary-page download action may transfer a fixture');assert(script.includes('bottom_download_btn'));assert(script.includes(JSON.stringify(pending.file.name)));assert(!diagnostics.names.includes(pending.file.name));diagnostics.transfers++;diagnostics.names.push(pending.file.name);
   let savePath,received=0;const item=new EventEmitter();Object.assign(item,{getFilename:()=>pending.file.name,getURLChain:()=>['https://d.pcs.baidu.com/file/synthetic?sign='+args.signed],getTotalBytes:()=>22,getReceivedBytes:()=>received,isPaused:()=>false,canResume:()=>false,setSavePath:file=>{assert.equal(path.extname(file),'.part');assert(path.resolve(file).startsWith(path.resolve(args.downloads)+path.sep));savePath=file},cancel:()=>item.emit('done',{},'cancelled')});
   const accepted=manager.accept({preventDefault(){diagnostics.prevented++}},item,manager.view.webContents);assert.equal(accepted,true);assert(savePath);diagnostics.accepted++;
   setTimeout(()=>{try{const zip=Buffer.alloc(22);zip.writeUInt32LE(0x06054b50);fs.writeFileSync(savePath,zip,{flag:'wx'});received=22;item.emit('updated',{},'progressing');item.emit('done',{},'completed')}catch(error){diagnostics.error=error.message;item.emit('done',{},'interrupted')}},40);
   return true;
  };
  // Only the native folder picker response is supplied. Its real IPC handler and
  // safety checks select the already-created isolated destination.
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[args.downloads]});
 },{source,cookie,signed,names,downloads});
 assert.equal(await page.evaluate(()=>window.library.chooseBaiduDownloadDir()),true);
}
async function waitCompleted(){
 for(let attempt=0;attempt<160;attempt++){const state=await page.evaluate(()=>window.library.baiduDownloadsState());if(state.tasks.some(t=>t.importError))throw Error('Actual main-process import failed: '+JSON.stringify(state.tasks.map(({name,state,importError})=>({name,state,importError}))));if(state.tasks.length===3&&state.tasks.every(task=>task.state==='completed'&&task.assetId)&&!state.busy)return state;await wait(100)}
 throw Error('Actual download queue/import callbacks did not finish: '+JSON.stringify(await page.evaluate(()=>window.library.baiduDownloadsState())));
}
function checkPublicState(state){const text=JSON.stringify(state);for(const privateValue of [source,cookie,signed,'BDUSS','fileIdentity','"folder"','"account"'])assert(!text.includes(privateValue),'Public state leaked private transfer metadata');assert.deepEqual(state.tasks.map(task=>task.name).sort(),[...names].sort());assert.equal(new Set(state.tasks.map(task=>task.assetId)).size,3)}
(async()=>{
 const seed=new Store(profile,[root]);seed.saveSettings({onlineEnabled:false,theme:'x',language:'zh-CN',xThemeIntroduced:true});seed.close();
 const runtime=await launch();assert.equal(runtime.version,require('../package.json').version);assert.equal(runtime.packaged,!!executable);assert.equal(await page.locator('[data-asset-id]').count(),0);mark('Actual application starts with an empty gallery and isolated offline/no-autoscan profile');
 await instrument();assert.deepEqual(tree(root),baseline);
 await page.evaluate(()=>window.library.downloadBaiduFiles(['synthetic-file-0','synthetic-file-1','synthetic-file-2']));const state=await waitCompleted();checkPublicState(state);
 // Do not call scan(), list(), get(), navigate, or reload here: the visible
 // gallery must first update solely from the production library:event path.
 await page.locator('[data-asset-id]').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-asset-id]').length===1);await page.waitForFunction(()=>document.querySelector('[data-asset-id]')?.innerText.includes('3'));
 const gallery=await page.evaluate(()=>window.library.list({view:'materials'}));assert.equal(gallery.total,1);assert.equal(gallery.items.length,1);assert.equal(gallery.items[0].members.length,3);assert.deepEqual(gallery.items[0].members.map(m=>m.id).sort(),state.tasks.map(task=>task.assetId).sort());
 const events=await page.evaluate(()=>globalThis.__downloadEvents);assert(events.includes('change'));assert(!events.includes('scan'));assert.equal((await page.evaluate(()=>window.library.snapshot())).scan.running,false);
 const diagnostics=await app.evaluate(()=>globalThis.__nativeDownloadIntegration);assert.equal(diagnostics.scans,0);assert.equal(diagnostics.transfers,3);assert.equal(diagnostics.accepted,3);assert.equal(diagnostics.prevented,0);assert.equal(diagnostics.error,undefined);
 mark('Three selected transfers pass real accept/done/import callbacks and refresh one three-member gallery card through change events without scanning');
 const paths=gallery.items[0].members.map(member=>member.path);assert.equal(new Set(paths.map(p=>path.dirname(p))).size,1);for(const file of paths){assert(names.includes(path.basename(file)));const bytes=fs.readFileSync(file);assert.equal(bytes.length,22);assert.equal(bytes.readUInt32LE(0),0x06054b50)}assert.equal(fs.readdirSync(downloads,{withFileTypes:true}).filter(e=>e.isDirectory()).length,1);assert.deepEqual(tree(root),baseline);mark('Material, texture/source and avatar adaptation files occupy one new owned folder; original path/name/bytes/mtime manifest stays unchanged');
 const journal=fs.readFileSync(path.join(profile,'baidu-downloads.json'),'utf8'),folders=fs.readFileSync(path.join(profile,'download-folders.json'),'utf8');for(const value of [source,cookie,signed,'BDUSS']){assert(!journal.includes(value));assert(!folders.includes(value))}const taskIds=state.tasks.map(task=>task.id).sort(),assetIds=state.tasks.map(task=>task.assetId).sort();await screenshot('incremental-download-gallery.png');mark('Public IPC omits private folder/file identity/account fields; share URLs, synthetic cookies and signed URLs stay out of state and unencrypted journals');
 await app.close();app=null;
 await launch();const restored=await page.evaluate(()=>window.library.baiduDownloadsState());checkPublicState(restored);assert.equal(restored.busy,false);assert.deepEqual(restored.tasks.map(task=>task.id).sort(),taskIds);assert.deepEqual(restored.tasks.map(task=>task.assetId).sort(),assetIds);
 await page.locator('[data-asset-id]').first().waitFor();const again=await page.evaluate(()=>window.library.list({view:'materials'}));assert.equal(again.total,1);assert.equal(again.items[0].members.length,3);assert.deepEqual(again.items[0].members.map(m=>m.id).sort(),assetIds);assert.deepEqual(tree(root),baseline);assert.equal((await page.evaluate(()=>globalThis.__downloadEvents)).includes('scan'),false);await screenshot('incremental-download-restored.png');mark('A second unmodified application launch restores all three task/asset IDs and the one grouped gallery card without rescanning');
 assert.deepEqual(errors,[]);await app.close();app=null;const after=tree(root);assert.deepEqual(after,baseline);
 const report={ok:true,syntheticTransfers:true,noLiveAccount:true,noLiveNetwork:true,scope:'Actual main-process/IPC/store/renderer integration; official webpage and DownloadItem transfer simulated',...runtime,runtime,checks,instrumentation:{scanCalls:diagnostics.scans,simulatedTransfers:diagnostics.transfers,acceptedTransfers:diagnostics.accepted},gallery:{cards:again.total,members:again.items[0].members.length,restartPersisted:true},sourceSentinel:{before:baseline.filter(row=>!row.directory),after:after.filter(row=>!row.directory)},sourceManifest:baseline};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,run}));
})().catch(async error=>{console.error(error);if(app){try{await screenshot('failure.png');console.error(JSON.stringify(await page.evaluate(()=>window.library.baiduDownloadsState())))}catch{}await app.close().catch(()=>{})}fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:false,syntheticTransfers:true,noLiveAccount:true,error:error.message,checks,run},null,2));process.exitCode=1});
