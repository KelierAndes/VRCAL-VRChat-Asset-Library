// Run with Electron. All BOOTH/Pixiv HTTPS requests are intercepted locally; no account is used.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const mode=process.argv[2]||'create',profile=path.resolve(process.argv[3]||path.join(__dirname,'../../booth-native-v16-qa'));
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'electron-session'));process.env.VRC_LIBRARY_TEST_HIDDEN='1';
app.on('window-all-closed',()=>{});
const checks=[];let workspace;
const waitFor=async(predicate,timeout=12000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30))}throw new Error('Local browser fixture timed out')};
app.whenReady().then(async()=>{
 const {BoothWorkspace}=require('../dist/main/main/booth-workspace'),downloadDir=path.join(profile,'downloads');fs.mkdirSync(downloadDir,{recursive:true});const imports=[],applies=[];
 workspace=new BoothWorkspace({parent:()=>null,dataDir:profile,roots:()=>[path.join(profile,'protected-originals')],getDownloadDir:()=>downloadDir,canNetwork:()=>true,validateAsset:id=>{assert.equal(id,'asset-1');return {title:'Veil Breeze 本地离线验收'}},applyProduct:async(id,url)=>{applies.push({id,url})},onChanged(){},onDownloaded:async(file,source)=>{imports.push({file,source});return {assetId:'fixture-download'}}});
 workspace.publicHost=async()=>{};await workspace.initialize();
 await workspace.remoteSession.protocol.handle('https',request=>{
  const parsed=new URL(request.url);
  if(parsed.pathname==='/download-fixture')return new Response(Buffer.from('fixture asset bytes'),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Veil_Breeze_fixture.zip"','Content-Length':'19'}});
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地 BOOTH 验收页</title><body><h1>Veil Breeze 本地离线商品</h1><a id="download" href="/download-fixture">下载离线验收包</a></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
 });
 const restored=await workspace.remoteSession.cookies.get({name:'vrc_fixture_session'});
 if(mode==='restore'){
  assert.equal(restored.length,1);assert.equal(restored[0].session,true);checks.push('session-cookie-restored-after-process-restart');
  assert.equal(workspace.snapshot().downloads[0].state,'completed');assert.equal(workspace.snapshot().downloads[0].assetId,'fixture-download');assert.ok(workspace.downloadPath(workspace.snapshot().downloads[0].id));checks.push('completed-download-import-persists-after-restart');
  await workspace.clearSession();assert.equal((await workspace.remoteSession.cookies.get({name:'vrc_fixture_session'})).length,0);assert.equal(fs.existsSync(path.join(profile,'booth-session-cookies.bin')),false);checks.push('clear-session-clears-native-cookies-and-encrypted-mirror');
 }else{
  const value=crypto.randomBytes(24).toString('hex');await workspace.remoteSession.cookies.set({url:'https://accounts.booth.pm/',name:'vrc_fixture_session',value,secure:true,httpOnly:true,path:'/',sameSite:'lax'});
  await workspace.open({tab:'search',query:'Veil Breeze',assetId:'asset-1'});await waitFor(()=>workspace.entry?.loaded);const entry=workspace.entry;
  assert.equal(entry.view.webContents.getLastWebPreferences().nodeIntegration,false);assert.equal(entry.view.webContents.getLastWebPreferences().sandbox,true);assert.equal(entry.view.webContents.session.getStoragePath(),path.join(profile,'booth-session'));checks.push('native-browser-isolated-and-session-stored-in-selected-profile');
  assert.equal(await entry.window.webContents.executeJavaScript('typeof window.boothWorkspace'), 'object');assert.equal(await entry.view.webContents.executeJavaScript('typeof window.boothWorkspace'),'undefined');checks.push('toolbar-preload-never-exposed-to-remote-page');
  await entry.view.webContents.loadURL('https://booth.pm/zh-cn/items/6454372');await waitFor(()=>workspace.browserState()?.canApply);await entry.window.webContents.executeJavaScript('window.boothWorkspace.apply()');assert.equal(applies[0].url,'https://booth.pm/zh-cn/items/6454372');checks.push('native-current-product-apply');
  await entry.view.webContents.executeJavaScript('document.getElementById("download").click()',true);await waitFor(()=>workspace.snapshot().downloads.some(value=>value.state==='completed'&&value.assetId));assert.equal(imports.length,1);assert.equal(imports[0].source,'https://booth.pm/zh-cn/items/6454372');assert.equal(fs.readFileSync(imports[0].file,'utf8'),'fixture asset bytes');checks.push('real-electron-user-gesture-download-and-import');
  const capture=await entry.window.webContents.capturePage();fs.writeFileSync(path.join(profile,'native-browser-fixture.png'),capture.toPNG());
  await workspace.shutdown();const cipher=fs.readFileSync(path.join(profile,'booth-session-cookies.bin'));assert.equal(cipher.includes(Buffer.from(value)),false);assert.equal(cipher.length>0,true);checks.push('actual-windows-safeStorage-encrypted-session-cookie');
 }
 await workspace.shutdown();fs.writeFileSync(path.join(profile,mode+'-report.json'),JSON.stringify({ok:true,mode,checks,noLiveNetwork:true,version:process.versions.electron},null,2));app.exit(0);
}).catch(async error=>{const browserState=workspace?.browserState();try{await workspace?.shutdown()}catch{}fs.writeFileSync(path.join(profile,mode+'-report.json'),JSON.stringify({ok:false,mode,checks,error:error.message,browserState},null,2));app.exit(1)});
