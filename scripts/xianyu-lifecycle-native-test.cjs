// Electron-only: synthetic official pages, intercepted HTTPS and injected DNS denial.
// No account, private chat, real DNS lookup or real WebSocket connection is used.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-xianyu-lifecycle-native-'));app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'electron-session'));delete process.env.VRC_LIBRARY_TEST_HIDDEN;
app.on('window-all-closed',()=>{});const uncaught=[],rejections=[],checks=[],started=Date.now();let workspace,finished=false,releaseResponse;
process.on('uncaughtException',error=>uncaught.push(error.message));process.on('unhandledRejection',error=>rejections.push(error instanceof Error?error.message:String(error)));
const waitFor=async(predicate)=>{while(Date.now()-started<22000){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Isolated Xianyu lifecycle fixture timed out')};
async function finish(error){
 if(finished)return;finished=true;clearTimeout(deadline);releaseResponse?.();
 const writeReport=(failure,shutdownComplete)=>{const report={ok:!failure,checks,error:failure?.message,shutdownComplete,uncaught,rejections,noLiveNetwork:true,noRealAccount:true,noRealWebSocket:true,profile,electron:process.versions.electron,durationMs:Date.now()-started};fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return failure?1:0};
 const exit=code=>{process.exitCode=code;app.quit()},timeout=setTimeout(()=>exit(writeReport(error||new Error('Isolated workspace shutdown timed out'),false)),2000);
 try{await workspace?.shutdown()}catch(failure){error??=failure}clearTimeout(timeout);exit(writeReport(error,true));
}
const deadline=setTimeout(()=>void finish(new Error('Native fixture exceeded its 25 second deadline')),25000);
app.whenReady().then(async()=>{
 const {XianyuWorkspace,xianyuRequestAllowed}=require('../dist/main/main/xianyu');workspace=new XianyuWorkspace({parent:()=>null,dataDir:profile,roots:()=>[],isEnabled:()=>true,canNetwork:()=>true,validateAsset:()=>({title:'Synthetic asset'}),searchBooth:async()=>{}});workspace.publicHost=async()=>{};await workspace.initialize();
 let hold=false,held=false;await workspace.remoteSession.protocol.handle('https',async request=>{
  const url=new URL(request.url);if(url.hostname!=='www.goofish.com')return new Response('Unexpected isolated fixture resource',{status:404});
  if(hold){held=true;await new Promise(resolve=>{releaseResponse=resolve})}
  return new Response('<!doctype html><html><meta charset="utf-8"><title>Isolated synthetic Xianyu page</title><body><h1>Local lifecycle fixture</h1><p>No login, chat data or WebSocket is present.</p></body></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
 });
 const opened=workspace.openMessages();await waitFor(()=>workspace.popups.size===1);const parent=[...workspace.popups][0];parent.show();parent.focus();await opened;const parentContents=parent.webContents;await waitFor(()=>parentContents.getURL()==='https://www.goofish.com/im');
 assert.deepEqual(await parentContents.executeJavaScript('({node:typeof require,bridge:typeof window.xianyuWorkspace})'),{node:'undefined',bridge:'undefined'});checks.push('native-message-window-loads-local-official-fixture-without-a-desktop-bridge');
 await parentContents.executeJavaScript('void window.open("https://www.goofish.com/im?fixture=child")',true);await waitFor(()=>workspace.popups.size===2);const child=[...workspace.popups].find(window=>window!==parent);child.close();await waitFor(()=>child.isDestroyed()&&workspace.popups.size===1);parent.close();await waitFor(()=>parent.isDestroyed()&&workspace.popups.size===0&&workspace.owned.size===0);assert.deepEqual(uncaught,[]);checks.push('actual-parent-and-native-child-window-close-without-destroyed-webcontents-getters');
 workspace.publicHost=async()=>{throw new Error('Synthetic public-DNS policy rejection')};await assert.rejects(()=>workspace.openMessages(),/消息页暂时无法打开/);assert.equal(workspace.popups.size,0);assert.equal(workspace.owned.size,0);checks.push('actual-policy-rejected-page-load-reports-a-recoverable-error-and-releases-the-window');
 workspace.publicHost=async()=>{};hold=true;const pending=workspace.openMessages();await waitFor(()=>held&&workspace.popups.size===1);workspace.close();releaseResponse();await pending;assert.equal(workspace.popups.size,0);assert.equal(workspace.owned.size,0);checks.push('closing-a-real-window-during-an-intercepted-load-does-not-reveal-or-reject-late');
 assert.equal(xianyuRequestAllowed('wss://wss-goofish.dingtalk.com:443/','GET','webSocket'),true);assert.equal(xianyuRequestAllowed('wss://msgacs.m.taobao.com/accs/auth?token=SYNTHETIC','GET','webSocket'),true);assert.equal(xianyuRequestAllowed('wss://other.dingtalk.com/','GET','webSocket'),false);checks.push('verified-websocket-policy-is-checked-without-opening-a-real-socket');
 await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(uncaught,[]);assert.deepEqual(rejections,[]);await finish();
}).catch(error=>void finish(error));
