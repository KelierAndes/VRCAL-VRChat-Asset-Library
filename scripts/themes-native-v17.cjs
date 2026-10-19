// All remote HTML is a private protocol fixture; no BOOTH account or live network.
const {app,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.resolve(__dirname,'../../themes-native-v17-'));
app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));process.env.VRC_LIBRARY_TEST_HIDDEN='1';app.on('window-all-closed',()=>{});
const checks=[];let workspace,preview,currentTheme='nasa';
const wait=async predicate=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30))}throw new Error('Native toolbar fixture timed out')};
const response=()=>new Response('<!doctype html><html><head><title>Private product fixture</title></head><body style="background:#ffffff;color:#000000"><h1>本地离线商品验收页</h1></body></html>',{headers:{'content-type':'text/html;charset=utf-8'}});
app.whenReady().then(async()=>{
 const {BoothWorkspace}=require('../dist/main/main/booth-workspace'),{ProductPreview}=require('../dist/main/main/preview');
 workspace=new BoothWorkspace({parent:()=>null,getTheme:()=>currentTheme,dataDir:profile,roots:()=>[path.join(profile,'protected')],getDownloadDir:()=>undefined,canNetwork:()=>true,validateAsset:()=>({title:'本地素材验收'}),applyProduct:async()=>{},onChanged(){},onDownloaded:async()=>({})});
 workspace.publicHost=async()=>{};await workspace.initialize();await workspace.remoteSession.protocol.handle('https',response);
 await workspace.open({tab:'search',query:'Veil Breeze',assetId:'fixture-item'});await wait(()=>workspace.entry?.loaded);
 const original=session.fromPartition.bind(session);session.fromPartition=(partition,options)=>{const selected=original(partition,options);if(partition.startsWith('vrc-product-preview-'))selected.protocol.handle('https',response);return selected};
 preview=new ProductPreview({parent:()=>null,getTheme:()=>currentTheme,validate:()=>({title:'商品预览本地验收',canConfirm:true}),accept:async()=>{}});preview.publicHost=async()=>{};
 await preview.open('fixture-item','https://booth.pm/ja/items/8901000');await wait(()=>preview.active?.loaded);
 for(const skin of ['nasa','swiss']){
  currentTheme=skin;workspace.refreshTheme();preview.refreshTheme();
  for(const [kind,entry] of [['booth',workspace.entry],['preview',preview.active]]){
   await wait(()=>entry.window.webContents.executeJavaScript('document.documentElement.dataset.theme').then(value=>value===skin));
   const facts=await entry.window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,weight:getComputedStyle(document.querySelector('h1')).fontWeight,fontAvailable:(await document.fonts.load('400 14px Inter')).length>0,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
   assert.equal(facts.theme,skin);assert.equal(facts.weight,'700');assert.equal(facts.fontAvailable,true);assert.equal(facts.overflow,false);
   if(skin==='nasa')assert.equal(facts.background,'rgb(236, 229, 214)');else assert.equal(facts.background,'rgb(245, 241, 232)');
   assert.equal(await entry.view.webContents.executeJavaScript('typeof window.boothWorkspace+"/"+typeof window.productPreview'),'undefined/undefined');
   assert.equal(await entry.view.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');
   const shot=await entry.window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(profile,skin+'-'+kind+'.png'),shot.toPNG());checks.push(skin+' '+kind+' native theme, fonts, source isolation and page styling');console.log('NATIVE THEME PASS:',checks.at(-1));
  }
 }
 preview.close();await workspace.shutdown();fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:true,checks,noLiveNetwork:true,profile},null,2));console.log('REPORT:',path.join(profile,'report.json'));app.exit(0);
}).catch(async error=>{preview?.close();try{await workspace?.shutdown()}catch{}fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:false,checks,error:error.stack,profile},null,2));console.error(error);app.exit(1)});
