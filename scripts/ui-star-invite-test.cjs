/* Genuine Electron renderer/preload/IPC, private synthetic library only.
 * shell.openExternal is intercepted at the OS boundary; no browser is opened. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {Store}=require('../dist/main/main/store');
const repo=path.resolve(__dirname,'..'),startedAt=Date.now(),runDir=fs.mkdtempSync(path.resolve(repo,'../ui-star-invite-'));
const source=path.join(runDir,'Private synthetic sources'),profile=path.join(runDir,'Private Library'),usageFile=path.join(profile,'app-usage.json');
const executablePath=process.env.VRC_TEST_APP_EXECUTABLE||require('electron'),packaged=!!process.env.VRC_TEST_APP_EXECUTABLE;
const projectUrl='https://github.com/NecoAya/VRCAL-VRChat-Asset-Library',milestones=[5,10,20,50];
const checks=[],renderErrors=[],screenshots=[],launches=[],layouts=[];
let app,page,runtime,phase='private fixture setup',expectedLaunch;
fs.mkdirSync(source);fs.mkdirSync(profile);fs.mkdirSync(path.join(source,'Nested demonstration'));
fs.writeFileSync(path.join(source,'Star invite demonstration.zip'),'READ ONLY synthetic Star invitation fixture');
fs.writeFileSync(path.join(source,'Nested demonstration','说明.txt'),'独立合成测试文件；不是用户素材，不可修改。');
function tree(directory){const result={};for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory()){result[entry.name+'/']='directory';for(const [name,hash]of Object.entries(tree(file)))result[entry.name+'/'+name]=hash}else result[entry.name]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}return result}
const beforeSources=tree(source),store=new Store(profile,[source]);
const file=path.join(source,'Star invite demonstration.zip');
store.upsertScan({path:file,name:'Star invite demonstration',kind:'archive',group:'Private synthetic QA',size:fs.statSync(file).size,mtimeMs:Date.UTC(2026,9,23),localCategory:'未分类',localAvatars:[],hintUrls:[]});
store.saveSettings({onlineEnabled:false,language:'zh-CN',theme:'x',xThemeIntroduced:true,uiZoom:1});store.close();
const copy={
 'zh-CN':{title:'喜欢这个项目吗？',message:'你已经打开应用 5 次，喜欢的话可以给本项目点个 Star 吗？',address:'项目地址',confirm:'确认，打开 GitHub',later:'下次再说',close:'关闭本次提示',error:'无法打开浏览器，请重试或复制项目地址手动打开。'},
 en:{title:'Enjoying this project?',message:"You've opened the app 5 times. If you like it, would you give this project a Star?",address:'Project URL',confirm:'Confirm and open GitHub',later:'Maybe later',close:'Dismiss this prompt',error:"Couldn't open the browser. Try again or copy the project URL and open it manually."},
 ja:{title:'このプロジェクトは気に入りましたか？',message:'アプリを 5 回起動しました。気に入っていただけたら、このプロジェクトに Star を付けていただけますか？',address:'プロジェクトの URL',confirm:'確認して GitHub を開く',later:'また今度',close:'今回の案内を閉じる',error:'ブラウザーを開けませんでした。もう一度試すか、プロジェクトの URL をコピーして手動で開いてください。'}
};
const invite=()=>page.locator('[data-star-invite]'),confirm=()=>invite().locator('.star-invite-actions button').last();
const usage=()=>JSON.parse(fs.readFileSync(usageFile,'utf8'));
function pass(label){checks.push(label);console.log('STAR INVITE PASS:',label)}
async function wait(predicate,message){for(let i=0;i<200;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,75))}throw new Error(message)}
async function external(){return app.evaluate(()=>globalThis.__starQA.external)}
async function stage(value){await app.evaluate((_electron,value)=>{globalThis.__starQA.stage=value},value)}
async function capture(name){
 const destination=path.join(runDir,name+'.png');
 const image=await app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(resolve=>setTimeout(resolve,100));return(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')});
 fs.writeFileSync(destination,Buffer.from(image,'base64'));screenshots.push(destination);
}
async function launch(count,seed=true){
 assert(!app,'Only this script\'s current test app may be managed');expectedLaunch=count;
 if(seed)fs.writeFileSync(usageFile,JSON.stringify({version:1,count:count-1,notified:milestones.filter(n=>n<count)}));
 const preferences=new Store(profile,[source]);preferences.saveSettings({onlineEnabled:false,language:'zh-CN',theme:'x',uiZoom:1});preferences.close();
 const env={...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:source,VRC_LIBRARY_LOCATION_FILE:path.join(runDir,'private-location.json'),VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_NO_EDITOR_LAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath,args:packaged?[]:[repo],env});
 runtime=await app.evaluate(({app,BrowserWindow,shell,net})=>{
  const qa=globalThis.__starQA={external:[],publicFetches:[],fileFetches:0,trash:[],openPaths:[],failures:0,hold:false,stage:'startup'};
  shell.openExternal=async url=>{qa.external.push({url,stage:qa.stage});if(qa.failures>0){qa.failures--;throw new Error('Synthetic OS browser failure')}if(qa.hold)await new Promise(resolve=>{qa.release=resolve})};
  shell.trashItem=async file=>{qa.trash.push(file);throw new Error('Recycling is forbidden in Star invitation QA')};
  shell.openPath=async file=>{qa.openPaths.push(file);throw new Error('Opening native files or Unity is forbidden in Star invitation QA')};
  const original=net.fetch.bind(net);net.fetch=async(raw,init)=>{const url=typeof raw==='string'?raw:raw?.url||String(raw);if(url.startsWith('file:')){qa.fileFetches++;return original(raw,init)}qa.publicFetches.push(url);throw new Error('Public network is disabled in this private UI acceptance')};
  const win=BrowserWindow.getAllWindows()[0];if(win){win.setSize(1480,940);win.webContents.setBackgroundThrottling(false)}
  return{version:app.getVersion(),packaged:app.isPackaged,appPath:app.getAppPath(),userData:app.getPath('userData')};
 });
 assert.equal(runtime.packaged,packaged);assert.equal(runtime.version,'1.2.8');assert.equal(path.resolve(runtime.userData).toLowerCase(),path.resolve(profile).toLowerCase());
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>renderErrors.push(error.stack||error.message));
 await page.locator('.asset-card').first().waitFor();await wait(async()=>usage().count===count,'A real startup did not record launch '+count);
 const state=await page.evaluate(()=>window.library.startupStarInvite());
 if(milestones.includes(count)){assert.deepEqual(state,{count,projectUrl});await invite().waitFor();assert.equal(await invite().getAttribute('data-milestone'),String(count))}
 else{assert.equal(state,null);await page.waitForTimeout(200);assert.equal(await invite().count(),0)}
 const snapshot=await page.evaluate(()=>window.library.snapshot());assert.deepEqual(snapshot.settings.roots,[source]);assert.equal(path.resolve(snapshot.settings.dataDir).toLowerCase(),path.resolve(profile).toLowerCase());
 assert.deepEqual(await external(),[],'Startup must not open an external browser');
}
async function diagnostics(){return app.evaluate(({ipcMain})=>({
 external:globalThis.__starQA.external,publicFetches:globalThis.__starQA.publicFetches,fileFetches:globalThis.__starQA.fileFetches,trash:globalThis.__starQA.trash,openPaths:globalThis.__starQA.openPaths,
 registeredIPC:ipcMain._invokeHandlers instanceof Map?[...ipcMain._invokeHandlers.keys()]:null
}))}
async function audit(){
 const current=await diagnostics();assert.deepEqual(current.publicFetches,[],'No public fetch, including sponsor JSON, is allowed');assert.deepEqual(current.trash,[]);assert.deepEqual(current.openPaths,[]);
 assert(current.external.every(call=>call.url===projectUrl&&['community-source-link','star-confirmation','star-failure-and-retry'].includes(call.stage)),'Only explicit tested actions may request the fixed project URL');
 assert(Array.isArray(current.registeredIPC)&&current.registeredIPC.length>10,'Electron invoke-handler registry must be available for the IPC removal check');
 assert(!current.registeredIPC.some(channel=>/sponsor/i.test(channel)),'Sponsor IPC handlers must be removed');
 assert.equal(await page.evaluate(()=>Object.keys(window.library).some(key=>/sponsor/i.test(key))),false,'Sponsor methods must be absent from the real preload API');
 assert.deepEqual(tree(source),beforeSources);return current;
}
async function close(){if(app){const current=await audit();launches.push({count:expectedLaunch,usage:usage(),...current});await app.close();app=undefined}}
async function setView(language,theme){await page.evaluate(value=>window.library.setViewPreferences(value),{language,theme});await page.waitForFunction(value=>document.documentElement.lang===value.language&&document.documentElement.dataset.theme===value.theme,{language,theme});await page.waitForTimeout(250)}
async function assertCopy(language){
 const expected=copy[language];assert.equal(await invite().getAttribute('aria-label'),expected.title);assert.equal(await invite().locator('strong').innerText(),expected.title);
 assert.equal(await invite().locator('.star-invite-message').innerText(),expected.message);assert.equal(await invite().locator('.star-invite-address>span').innerText(),expected.address);
 assert.equal(await invite().locator('.star-invite-address>p').innerText(),projectUrl);assert.equal(await confirm().innerText(),expected.confirm);
 assert.equal(await invite().locator('.star-invite-actions button').first().innerText(),expected.later);assert.equal(await invite().locator('.star-invite-close').getAttribute('aria-label'),expected.close);
 assert.equal(usage().count,5,'Changing language or theme must not count as another launch');
}
async function assertNarrow(language){
 await setView(language,'x-light');await confirm().scrollIntoViewIfNeeded();
 const geometry=await confirm().evaluate(button=>{const notice=button.closest('[data-star-invite]'),rect=button.getBoundingClientRect(),outer=notice.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return{viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1,notice:{x:outer.left,y:outer.top,right:outer.right,bottom:outer.bottom,scrollTop:notice.scrollTop,horizontalOverflow:notice.scrollWidth>notice.clientWidth+1},button:{x:rect.left,y:rect.top,right:rect.right,bottom:rect.bottom},clickable:hit===button||button.contains(hit)}});
 assert.equal(geometry.overflow,false);assert.equal(geometry.notice.horizontalOverflow,false);assert(geometry.notice.x>=0&&geometry.notice.y>=0&&geometry.notice.right<=geometry.viewport.width+1&&geometry.notice.bottom<=geometry.viewport.height+1);
 assert(geometry.clickable&&geometry.button.x>=geometry.notice.x&&geometry.button.right<=geometry.notice.right+1&&geometry.button.y>=geometry.notice.y&&geometry.button.bottom<=geometry.notice.bottom+1,'The confirmation button must be scrollable into view and receive a real click');layouts.push({language,...geometry});
}
function report(ok,error){return{ok,error,phase,checks,renderErrors,screenshots,layouts,runtime,packaged,executablePath,profile,source,runDir,launches,beforeSources,afterSources:tree(source),sourceUnchanged:JSON.stringify(tree(source))===JSON.stringify(beforeSources),genuineRendererPreloadIPC:true,shellOpenExternalStubbed:true,actualExternalBrowsersOpened:0,unityLaunched:false,recycledFiles:0,durationMs:Date.now()-startedAt}}

(async()=>{
 phase='fifth real startup and stable per-process count';await launch(5);
 const saved=usage(),states=await page.evaluate(()=>Promise.all(Array.from({length:8},()=>window.library.startupStarInvite())));states.forEach(value=>assert.deepEqual(value,{count:5,projectUrl}));assert.deepEqual(usage(),saved);
 await page.reload();await page.locator('.asset-card').first().waitFor();await invite().waitFor();assert.deepEqual(usage(),saved);assert.deepEqual(await external(),[]);
 const selected=await invite().locator('.star-invite-address>p').evaluate(element=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);const text=selection.toString();selection.removeAllRanges();return{text,userSelect:getComputedStyle(element).userSelect}});
 assert.equal(selected.text,projectUrl);assert.equal(selected.userSelect,'text');pass('fifth-real-launch-shows-one-invite-with-selectable-full-url-repeated-state-and-renderer-reload-do-not-increment');

 phase='modal stacking and no pointer fallthrough';await setView('zh-CN','x');
 await page.locator('.asset-card').first().click({button:'right'});await page.getByRole('menuitem',{name:'设置右键菜单',exact:true}).click();await page.getByRole('dialog',{name:'设置与备份',exact:true}).waitFor();
 const stacking=await invite().evaluate(notice=>{const button=notice.querySelector('.star-invite-actions button:last-child'),rect=button.getBoundingClientRect(),overlay=document.querySelector('.modal-overlay'),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return{noticeZ:Number(getComputedStyle(notice).zIndex),modalZ:Number(getComputedStyle(overlay).zIndex),x:rect.left+rect.width/2,y:rect.top+rect.height/2,blocked:!notice.contains(hit)&&overlay.contains(hit)}});
 assert.equal(stacking.noticeZ,80);assert(stacking.modalZ>=100&&stacking.blocked);await page.mouse.click(stacking.x,stacking.y);assert.deepEqual(await external(),[]);assert.equal(await invite().count(),1);
 if(await page.getByRole('dialog',{name:'设置与备份',exact:true}).count())await page.locator('.modal-header [aria-label="关闭弹窗"]').click();
 pass('settings-modal-is-above-z80-invitation-hit-testing-and-real-overlay-click-do-not-confirm-underneath');

 phase='three languages and four themes';
 for(const language of ['zh-CN','en','ja'])for(const theme of ['x','x-light','nasa','swiss']){
  await setView(language,theme);await assertCopy(language);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  if((language==='zh-CN'&&['x','x-light'].includes(theme))||(language==='ja'&&theme==='x'))await capture('star-invite-'+language+'-'+theme);
  pass('localized-invitation-and-controls-'+language+'-'+theme);
 }
 assert.deepEqual(await external(),[],'Reading or changing presentation must not implicitly open the project');
 phase='980px window at 200 percent';await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,800));await page.evaluate(()=>window.library.setZoom(2));
 for(const language of ['zh-CN','en','ja']){await assertNarrow(language);await capture('star-invite-980-200pct-'+language)}
 pass('three-language-980px-200-percent-layout-has-no-horizontal-overflow-and-confirmation-scrolls-into-hit-testable-view');
 await page.evaluate(()=>window.library.setZoom(1));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,940));await setView('zh-CN','x');
 phase='maybe later and next genuine startup';await invite().getByRole('button',{name:copy['zh-CN'].later,exact:true}).click();await invite().waitFor({state:'hidden'});assert.deepEqual(await external(),[]);assert.equal(await page.evaluate(()=>window.library.startupStarInvite()),null);await close();
 await launch(6,false);assert.deepEqual(usage(),{version:1,count:6,notified:[5]});pass('maybe-later-opens-no-browser-and-the-next-genuine-launch-increments-without-repeating-the-fifth-reminder');
 // Check lower sidebar entries on a non-milestone startup, when the notice does
 // not cover those real buttons. No forced click bypasses the pointer hit test.
 phase='contributors remain and sponsor capabilities are absent';await page.locator('.sidebar .nav-item').filter({hasText:'贡献者与社区'}).click();await page.locator('.contributors-page').waitFor();
 await wait(async()=>await page.locator('.contributor-avatar img').first().evaluate(image=>image.complete&&image.naturalWidth>0),'Bundled contributor portrait did not load');
 assert.equal(await page.locator('.contributors-page [class*="sponsor"],.contributors-page [data-sponsor-id]').count(),0);
 await page.locator('.community-qq-entry').click();await wait(async()=>await page.locator('.community-qq-qr').evaluate(image=>image.complete&&image.naturalWidth>0),'Bundled QQ QR code did not load');
 assert.equal(await page.locator('.community-qq-number strong').innerText(),'1002563035');await stage('community-source-link');await page.locator('.community-intro').getByRole('button',{name:/^源码仓库/}).click();await wait(async()=>(await external()).length===1,'Source code entry did not reach the intercepted OS boundary');
 assert.deepEqual(await external(),[{url:projectUrl,stage:'community-source-link'}]);await audit();await capture('contributors-retained-without-sponsors');await close();
 pass('contributor-portrait-qq-and-source-entry-remain-without-sponsor-dom-preload-methods-ipc-handlers-or-network');

 phase='tenth launch close button';await launch(10);await invite().getByRole('button',{name:copy['zh-CN'].close,exact:true}).click();await invite().waitFor({state:'hidden'});assert.deepEqual(await external(),[]);assert.equal(await page.evaluate(()=>window.library.startupStarInvite()),null);await close();pass('tenth-real-launch-appears-and-the-x-button-dismisses-without-browser-navigation');

 phase='twentieth launch explicit confirmation deduplicates in flight';await launch(20);await stage('star-confirmation');await app.evaluate(()=>{globalThis.__starQA.hold=true});
 const target=await confirm().boundingBox();await confirm().click();await wait(async()=>(await external()).length===1,'Confirmation did not reach the intercepted shell');assert.equal(await confirm().isDisabled(),true);
 await page.mouse.click(target.x+target.width/2,target.y+target.height/2);assert.equal((await external()).length,1,'A second real click while opening must not navigate twice');
 await app.evaluate(()=>{globalThis.__starQA.hold=false;globalThis.__starQA.release()});await invite().waitFor({state:'hidden'});assert.deepEqual(await external(),[{url:projectUrl,stage:'star-confirmation'}]);
 const stale=await page.evaluate(async()=>{try{await window.library.openStarProject(20);return false}catch{return true}});assert(stale);assert.equal((await external()).length,1);await close();pass('twentieth-real-launch-opens-only-the-fixed-project-url-on-explicit-confirmation-once-and-rejects-stale-reuse');

 phase='fiftieth launch browser failure and retry at 980px and 200 percent';await launch(50);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,800));await page.evaluate(()=>window.library.setZoom(2));await setView('ja','x-light');
 await stage('star-failure-and-retry');await app.evaluate(()=>{globalThis.__starQA.failures=1});await confirm().scrollIntoViewIfNeeded();await confirm().click();
 await invite().locator('[role="alert"]').waitFor();assert.equal(await invite().locator('[role="alert"]').innerText(),copy.ja.error);assert.equal(await confirm().isEnabled(),true);assert.equal((await external()).length,1);assert.equal(usage().count,50);await capture('star-invite-browser-failure-ja-980-200pct');
 await confirm().scrollIntoViewIfNeeded();await confirm().click();await invite().waitFor({state:'hidden'});assert.deepEqual(await external(),[{url:projectUrl,stage:'star-failure-and-retry'},{url:projectUrl,stage:'star-failure-and-retry'}]);await close();
 pass('fiftieth-real-launch-browser-failure-keeps-a-localized-retry-and-confirmation-actually-clicks-at-980px-200-percent');

 phase='non-milestone launches';for(const count of [1,4,9,11,19,21,49,51,100]){await launch(count);assert.equal(await page.evaluate(()=>window.library.startupStarInvite()),null);assert.equal(usage().count,count);await close();pass('real-non-milestone-launch-'+count+'-does-not-show-or-open-an-invitation')}
 assert.deepEqual(tree(source),beforeSources);assert.deepEqual(renderErrors,[]);pass('all-private-source-paths-and-sha256-remain-unchanged-no-public-fetch-unity-recycle-or-render-errors');
 phase='complete';fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify(report(true),null,2));console.log(JSON.stringify({ok:true,checks:checks.length,screenshots:screenshots.length,report:path.join(runDir,'report.json')}));
})().catch(async error=>{
 console.error(error);if(app){await capture('failure').catch(()=>{});try{fs.writeFileSync(path.join(runDir,'failure-dom.txt'),await page.locator('body').innerText())}catch{}try{launches.push({count:expectedLaunch,usage:usage(),failureDiagnostics:await diagnostics()})}catch{}await app.close().catch(()=>{});app=undefined}
 fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify(report(false,error.stack||String(error)),null,2));process.exitCode=1;
});
