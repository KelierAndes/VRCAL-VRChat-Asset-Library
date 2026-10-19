// All remote HTML is a private protocol fixture; no BOOTH account or live network.
const {app,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.resolve(__dirname,'../../native-i18n-live-v110-'));
app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));process.env.VRC_LIBRARY_TEST_HIDDEN='1';app.on('window-all-closed',()=>{});
const checks=[];let workspace,preview,currentTheme='nasa',currentLanguage='zh-CN';
const wait=async predicate=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30))}throw new Error('Native toolbar fixture timed out')};
const response=()=>new Response('<!doctype html><html><head><title>Private product fixture</title></head><body style="background:#ffffff;color:#000000"><h1>本地离线商品验收页</h1></body></html>',{headers:{'content-type':'text/html;charset=utf-8'}});
app.whenReady().then(async()=>{
 const codeRoot=process.env.VRC_NATIVE_ASAR||path.resolve(__dirname,'..');
 const {BoothWorkspace}=require(path.join(codeRoot,'dist/main/main/booth-workspace')),{ProductPreview}=require(path.join(codeRoot,'dist/main/main/preview'));
 workspace=new BoothWorkspace({parent:()=>null,getTheme:()=>currentTheme,getLanguage:()=>currentLanguage,dataDir:profile,roots:()=>[path.join(profile,'protected')],getDownloadDir:()=>undefined,canNetwork:()=>true,validateAsset:()=>({title:'本地素材验收'}),applyProduct:async()=>{},onChanged(){},onDownloaded:async()=>({})});
 workspace.publicHost=async()=>{};await workspace.initialize();await workspace.remoteSession.protocol.handle('https',response);
 await workspace.open({tab:'search',query:'Veil Breeze',assetId:'fixture-item'});await wait(()=>workspace.entry?.loaded);
 const original=session.fromPartition.bind(session);session.fromPartition=(partition,options)=>{const selected=original(partition,options);if(partition.startsWith('vrc-product-preview-'))selected.protocol.handle('https',response);return selected};
 preview=new ProductPreview({parent:()=>null,getTheme:()=>currentTheme,getLanguage:()=>currentLanguage,validate:()=>({title:'商品预览本地验收',canConfirm:true}),accept:async()=>{}});preview.publicHost=async()=>{};
 await preview.open('fixture-item','https://booth.pm/ja/items/8901000');await wait(()=>preview.active?.loaded);
 for(const locale of ['zh-CN','ja','en'])for(const skin of ['nasa','swiss','x','x-light']){
  currentLanguage=locale;
  currentTheme=skin;workspace.refreshTheme();preview.refreshTheme();
  for(const [kind,entry] of [['booth',workspace.entry],['preview',preview.active]]){
   await wait(()=>entry.window.webContents.executeJavaScript('document.documentElement.dataset.theme').then(value=>value===skin));
   const facts=await entry.window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,weight:getComputedStyle(document.querySelector('h1')).fontWeight,fontAvailable:(await document.fonts.load('400 14px Inter')).length>0,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
   assert.equal(facts.theme,skin);assert.equal(facts.weight,'700');assert.equal(facts.fontAvailable,true);assert.equal(await entry.window.webContents.executeJavaScript('document.documentElement.lang'),locale);assert.equal(facts.overflow,false);
   if(skin==='nasa')assert.equal(facts.background,'rgb(236, 229, 214)');else if(skin==='swiss')assert.equal(facts.background,'rgb(245, 241, 232)');else if(skin==='x')assert.equal(facts.background,'rgb(0, 0, 0)');else assert.equal(facts.background,'rgb(255, 255, 255)');
   assert.equal(await entry.view.webContents.executeJavaScript('typeof window.boothWorkspace+"/"+typeof window.productPreview'),'undefined/undefined');
   assert.equal(await entry.view.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');
   entry.window.setSize(980,900);entry.window.webContents.setZoomFactor(2);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(await entry.window.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth'),false);
   const shot=await entry.window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(profile,locale+'-'+skin+'-'+kind+'.png'),shot.toPNG());entry.window.webContents.setZoomFactor(1);checks.push(locale+' '+skin+' '+kind+' native theme, fonts, source isolation and page styling');console.log('NATIVE THEME PASS:',checks.at(-1));
  }
 }
 preview.close();await workspace.shutdown();fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:true,checks,noLiveNetwork:true,profile},null,2));console.log('REPORT:',path.join(profile,'report.json'));app.exit(0);
}).catch(async error=>{preview?.close();try{await workspace?.shutdown()}catch{}fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:false,checks,error:error.stack,profile},null,2));console.error(error);app.exit(1)});
