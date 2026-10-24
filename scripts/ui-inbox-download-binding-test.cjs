// Real main-process IPC with synthetic downloads and an isolated encrypted library.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{Store}=require('../dist/main/main/store');
const repo=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.resolve(repo,'../ui-inbox-binding-'));
const profile=path.join(run,'Library'),root=path.join(run,'Synthetic Materials');fs.mkdirSync(root);
const store=new Store(profile,[root]);store.saveSettings({onlineEnabled:false,xThemeIntroduced:true});store.close();
const launch=()=>_electron.launch({executablePath:require('electron'),args:[repo],env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:root,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:'1'}});
let app;const checks=[];
(async()=>{
 app=await launch();const initial=await app.firstWindow();await initial.locator('.inbox-nav').waitFor();console.log('Isolated application ready');
 await app.evaluate(({safeStorage},{repo,profile,root})=>{
  const load=name=>process.mainModule.require(process.mainModule.require('node:path').join(repo,'dist/main',name));
  const {LinkInboxStore}=load('main/link-inbox-store'),s=new LinkInboxStore({dataDir:profile,roots:()=>[root],cipher:{encrypt:t=>safeStorage.encryptString(t),decrypt:b=>safeStorage.decryptString(b)}});
  s.configure({enabled:true,background:false,hours:24},{version:load('shared/inbox-policy').INBOX_POLICY_VERSION,acceptedAt:Date.now(),scope:'foreground'});
  for(const name of ['A','B'])s.ingest({platform:'xianyu',accountKey:'synthetic-only',sourceKey:name,sourceUrl:'https://www.goofish.com/im',title:name,sourceAt:Date.now()-60000,text:'https://pan.baidu.com/s/1Synthetic'+name+'?pwd=abcd'});
 },{repo,profile,root});console.log('Synthetic encrypted records seeded');await app.close();console.log('Restarting isolated application');app=await launch();
 const page=await app.firstWindow();await page.locator('.inbox-nav').waitFor();console.log('Restart complete');
 const state=await page.evaluate(()=>window.library.inboxState()),a=state.items.find(i=>i.title==='A').id,b=state.items.find(i=>i.title==='B').id;
 await app.evaluate((_e,{repo,run})=>{
  const {BaiduDownloads}=process.mainModule.require(process.mainModule.require('node:path').join(repo,'dist/main/main/baidu-downloads'));
  global.syntheticSequence=0;
  BaiduDownloads.prototype.read=async function(){if(global.pendingSyntheticDownload)throw new Error('请等待当前读取或下载完成。')};
  BaiduDownloads.prototype.download=async function(){
   if(global.pendingSyntheticDownload)throw new Error('Synthetic download already active');
   return new Promise(resolve=>{global.pendingSyntheticDownload=()=>{const id='00000000-0000-4000-8000-'+String(++global.syntheticSequence).padStart(12,'0');this.tasks.push({id,name:'fixture.zip',folder:process.mainModule.require('node:path').join(run,id),state:'downloading',receivedBytes:0,totalBytes:10,downloadBps:0,startedAt:new Date().toISOString()});global.pendingSyntheticDownload=undefined;resolve()}});
  };
 },{repo,run});
 const waitForDownload=()=>app.evaluate(async()=>{for(let i=0;i<100&&!global.pendingSyntheticDownload;i++)await new Promise(r=>setTimeout(r,10));if(!global.pendingSyntheticDownload)throw new Error('Synthetic download did not start')});
 const beginDownload=()=>page.evaluate(()=>window.library.downloadBaiduFile('synthetic-file'));
 await page.evaluate(id=>window.library.readInboxLink(id),a);
 const first=beginDownload();await waitForDownload();
 await assert.rejects(page.evaluate(id=>window.library.readInboxLink(id),b),/请等待/);
 await assert.rejects(page.evaluate(()=>window.library.readBaiduShare('https://pan.baidu.com/s/1SyntheticManual','abcd')),/请等待/);
 await app.evaluate(()=>global.pendingSyntheticDownload());await first;
 let rows=(await page.evaluate(()=>window.library.inboxState())).items;
 assert.equal(rows.find(i=>i.id===a).taskIds.length,1,'A keeps its task when competing inbox/manual reads are rejected');assert.equal(rows.find(i=>i.id===b).taskIds.length,0);
 const second=beginDownload();await waitForDownload();await app.evaluate(()=>global.pendingSyntheticDownload());await second;
 rows=(await page.evaluate(()=>window.library.inboxState())).items;assert.equal(rows.find(i=>i.id===a).taskIds.length,2,'Later files from A retain the binding');checks.push('Rejected inbox and manual share reads preserve active and subsequent downloads for A');
 await page.evaluate(id=>window.library.readInboxLink(id),b);
 const third=beginDownload();await waitForDownload();await app.evaluate(()=>global.pendingSyntheticDownload());await third;
 rows=(await page.evaluate(()=>window.library.inboxState())).items;assert.equal(rows.find(i=>i.id===b).taskIds.length,1);assert.equal(rows.find(i=>i.id===a).taskIds.length,2);checks.push('A successful inbox read switches subsequent task attribution to B');
 await page.evaluate(()=>window.library.readBaiduShare('https://pan.baidu.com/s/1SyntheticManual','abcd'));
 const fourth=beginDownload();await waitForDownload();await app.evaluate(()=>global.pendingSyntheticDownload());await fourth;
 rows=(await page.evaluate(()=>window.library.inboxState())).items;assert.equal(rows.find(i=>i.id===b).taskIds.length,1);assert.equal(rows.find(i=>i.id===a).taskIds.length,2);checks.push('A successful manual share read detaches the inbox binding');
 await app.close();app=null;fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:true,synthetic:true,checks},null,2));console.log(JSON.stringify({ok:true,run,checks}));
})().catch(async error=>{console.error(error);if(app)await app.close();process.exitCode=1});
