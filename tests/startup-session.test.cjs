const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
let electron=process.env.VRC_TEST_ELECTRON_EXECUTABLE;try{electron ||=require('electron')}catch{}
test('Chromium session directory is already configured when Electron becomes ready',{skip:!electron||!fs.existsSync(electron)},t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-session-startup-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5}));
 const dataDir=path.join(folder,'chosen-library'),report=path.join(folder,'report.json'),entry=path.join(folder,'startup.cjs');
 const main=path.resolve(__dirname,'../dist/main/main/main.js');
 fs.writeFileSync(entry,`const {app}=require('electron'),fs=require('node:fs');app.once('ready',()=>{fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({session:app.getPath('sessionData'),user:app.getPath('userData')}));app.exit(0)});require(${JSON.stringify(main)});`);
 const env={...process.env,VRC_LIBRARY_DATA_DIR:dataDir,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const child=cp.spawnSync(electron,[entry,'--disable-gpu'],{env,encoding:'utf8',timeout:20000,windowsHide:true});
 assert.equal(child.status,0,child.stderr);const value=JSON.parse(fs.readFileSync(report,'utf8'));
 assert.equal(path.resolve(value.session),path.join(dataDir,'session'));assert.equal(path.resolve(value.user),dataDir);
});
const nonC=process.platform==='win32'&&['D:\\','E:\\'].find(drive=>fs.existsSync(drive));

test('a missing remembered library can be relinked without opening an empty store or changing the existing database',{skip:!electron||!fs.existsSync(electron)||!nonC},t=>{
 const folder=fs.mkdtempSync(path.join(nonC,'VRCAL-location-recovery-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5}));
 const account=path.join(folder,'account'),library=path.join(folder,'chosen','VRChatAssetLibrary'),missing=path.join(folder,'old-missing'),report=path.join(folder,'report.json'),entry=path.join(folder,'startup.cjs'),main=path.resolve(__dirname,'../dist/main/main/main.js'),pointer=path.join(folder,'program','location.json');
 fs.mkdirSync(account);fs.mkdirSync(path.dirname(pointer));const {Store}=require('../dist/main/main/store'),store=new Store(library,[]);store.close();fs.writeFileSync(pointer,JSON.stringify({dataDir:missing}));
 const before=fs.readFileSync(path.join(library,'library.sqlite'));
 fs.writeFileSync(entry,`const {app,dialog}=require('electron'),fs=require('node:fs');let detail='';dialog.showMessageBox=async options=>{detail=options.detail;return {response:1}};dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(library)}]});dialog.showErrorBox=(_title,message)=>fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({fatal:message}));app.relaunch=()=>fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({selected:JSON.parse(fs.readFileSync(${JSON.stringify(pointer)},'utf8')).dataDir,detail,ghostDatabase:fs.existsSync(${JSON.stringify(path.join(missing,'library.sqlite'))}),ghostSession:fs.existsSync(${JSON.stringify(path.join(missing,'session'))})}));require(${JSON.stringify(main)});`);
 const env={...process.env,LOCALAPPDATA:account,VRC_LIBRARY_LOCATION_FILE:pointer,VRC_LIBRARY_ROOT:path.join(folder,'materials'),VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VRC_LIBRARY_DATA_DIR;
 const child=cp.spawnSync(electron,[entry,'--disable-gpu'],{env,encoding:'utf8',timeout:20000,windowsHide:true});assert.equal(child.status,0,child.stderr);const result=JSON.parse(fs.readFileSync(report,'utf8'));assert.equal(result.selected,library,JSON.stringify(result));assert(result.detail.includes(missing));assert.equal(result.ghostDatabase,false);assert.equal(result.ghostSession,false);assert.deepEqual(fs.readFileSync(path.join(library,'library.sqlite')),before);
 const started=cp.spawnSync(electron,[main,'--disable-gpu'],{env:{...env,VRC_LIBRARY_SMOKE:'1',VRC_LIBRARY_SMOKE_EXIT:'1'},encoding:'utf8',timeout:25000,windowsHide:true});assert.equal(started.status,0,started.stderr);const ready=JSON.parse(fs.readFileSync(path.join(library,'smoke-ready.json'),'utf8'));assert.equal(ready.sqlite,true);assert.equal(ready.stats.total,0);assert.equal(JSON.parse(fs.readFileSync(pointer,'utf8')).dataDir,library);assert(!fs.existsSync(path.join(missing,'library.sqlite')));
});
test('upgrading session initialization retains the existing safeStorage key',{skip:process.platform!=='win32'||!electron||!fs.existsSync(electron)},t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-session-key-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5}));
 const dataDir=path.join(folder,'library'),old=path.join(folder,'old.cjs'),upgraded=path.join(folder,'upgraded.cjs'),report=path.join(folder,'report.json');fs.mkdirSync(dataDir);fs.mkdirSync(path.join(dataDir,'session'));
 fs.writeFileSync(old,`const {app,safeStorage}=require('electron'),fs=require('node:fs');app.setPath('userData',${JSON.stringify(dataDir)});app.whenReady().then(()=>{app.setPath('sessionData',${JSON.stringify(path.join(dataDir,'session'))});fs.writeFileSync(${JSON.stringify(path.join(dataDir,'encrypted.bin'))},safeStorage.encryptString('session-only-fixture'));app.quit()});`);
 fs.writeFileSync(upgraded,`const {app,safeStorage}=require('electron'),fs=require('node:fs');app.once('ready',()=>{let ok=false;try{ok=safeStorage.decryptString(fs.readFileSync(${JSON.stringify(path.join(dataDir,'encrypted.bin'))}))==='session-only-fixture'}catch{}fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({ok}));app.exit(0)});require(${JSON.stringify(path.resolve(__dirname,'../dist/main/main/main.js'))});`);
 const env={...process.env,LOCALAPPDATA:path.join(folder,'account'),VRC_LIBRARY_DATA_DIR:dataDir,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 for(const script of [old,upgraded]){const child=cp.spawnSync(electron,[script,'--disable-gpu'],{env,encoding:'utf8',timeout:20000,windowsHide:true});assert.equal(child.status,0,child.stderr)}
 assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).ok,true,'the prior BOOTH cookie mirror must still decrypt after sessionData moves');
});
test('a first selection with no legacy database creates a valid library before requesting relaunch',{skip:!electron||!fs.existsSync(electron)||!nonC},t=>{
 const folder=fs.mkdtempSync(path.join(nonC,'VRCAL-first-selection-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:5}));
 const account=path.join(folder,'account'),chosen=path.join(folder,'chosen'),report=path.join(folder,'report.json'),entry=path.join(folder,'startup.cjs'),main=path.resolve(__dirname,'../dist/main/main/main.js'),pointer=path.join(folder,'program','location.json');fs.mkdirSync(account);fs.mkdirSync(chosen);
 fs.writeFileSync(entry,`const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(chosen)}]});app.relaunch=()=>{const selected=JSON.parse(fs.readFileSync(${JSON.stringify(pointer)},'utf8')).dataDir;fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({selected,exists:fs.existsSync(path.join(selected,'library.sqlite'))}))};require(${JSON.stringify(main)});`);
 const env={...process.env,LOCALAPPDATA:account,VRC_LIBRARY_LOCATION_FILE:pointer,VRC_LIBRARY_ROOT:path.join(folder,'materials'),VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.VRC_LIBRARY_DATA_DIR;
 const child=cp.spawnSync(electron,[entry,'--disable-gpu'],{env,encoding:'utf8',timeout:20000,windowsHide:true});assert.equal(child.status,0,child.stderr);
 const value=JSON.parse(fs.readFileSync(report,'utf8'));assert.equal(value.selected,path.join(chosen,'VRChatAssetLibrary'));assert.equal(value.exists,true,'the next process must not reject the newly selected library as missing');
});
