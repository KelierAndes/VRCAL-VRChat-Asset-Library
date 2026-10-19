const {_electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),area=fs.mkdtempSync(path.join(root,'..','preview-ui-')),profile=path.join(area,'profile'),materials=path.join(area,'只读素材');
fs.mkdirSync(profile);fs.mkdirSync(materials);const sentinel=path.join(materials,'素材.txt');fs.writeFileSync(sentinel,'preview must leave this file untouched');
const before=crypto.createHash('sha256').update(fs.readFileSync(sentinel)).digest('hex');
const fixtureFile=path.join(area,'fixture.cjs'),source='https://booth.pm/ja/items/1234567';
const fixture=String.raw`
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),dns=require('node:dns/promises');
const profile=${JSON.stringify(profile)};app.setPath('userData',profile);app.setPath('sessionData',profile);
dns.lookup=async hostname=>[{address:hostname==='private.example.org'?'127.0.0.1':'93.184.216.34',family:4}];
const {ProductPreview}=require(${JSON.stringify(path.join(root,'dist/main/main/preview.js'))});
const actualFrom=session.fromPartition.bind(session),hits=[];
session.fromPartition=function(partition,options){const ses=actualFrom(partition,options);if(partition.startsWith('vrc-product-preview-'))ses.protocol.handle('https',request=>{
  hits.push({url:request.url,method:request.method});const url=new URL(request.url);
  if(url.pathname==='/missing')return new Response('<h1>Missing</h1>',{status:404,headers:{'content-type':'text/html'}});
  if(url.pathname==='/download')return new Response('zip bytes',{headers:{'content-type':'application/zip','content-disposition':'attachment; filename=test.zip'}});
  if(url.pathname.endsWith('.png'))return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64'),{headers:{'content-type':'image/png'}});
  return new Response('<!doctype html><html><body><h1 id="product">Fixture '+url.pathname+'</h1><img id="cover" src="https://cdn.example.org/cover.png"><img src="https://private.example.org/private.png"><img src="file:///E:/VRChat/private.png"><a id="other" href="https://other.booth.pm/items/7654321">Other product</a><a id="same" href="https://shop.booth.pm/en/items/1234567">Same product</a><a id="private" href="https://private.example.org/page">Private</a><a id="login" href="https://booth.pm/users/sign_in">Login</a><a id="download" href="https://booth.pm/download">Download</a><a id="new" href="https://booth.pm/ja/items/1234567" target="_blank">New window</a><p id="intro">This public page explains a fixture material.</p></body></html>',{headers:{'content-type':'text/html'}});
});return ses;};
app.whenReady().then(async()=>{const parent=new BrowserWindow({show:false});const accepted=[];let canConfirm=true;
 const preview=new ProductPreview({parent:()=>parent,validate:(id,url)=>{if(id!=='asset-1'||![${JSON.stringify(source)},'https://shop.example.org/product'].includes(url))throw new Error('not authorized');return {title:'Moon Dress · fixture',canConfirm};},accept:async(id,url)=>{accepted.push({id,url});}});
 globalThis.previewTest={preview,accepted,hits,parent,remote:()=>preview.active?.view.webContents,toolbar:()=>preview.active?.window.webContents,setConfirm:value=>{canConfirm=value;}};
 await preview.open('asset-1',${JSON.stringify(source)});
});app.on('window-all-closed',()=>app.quit());
`;
fs.writeFileSync(fixtureFile,fixture);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[fixtureFile],env:{...process.env,VRC_LIBRARY_TEST_HIDDEN:'1'}});let checks=0;
 const check=(condition,message)=>{assert(condition,message);checks++;};
 try{
  let toolbar;for(let i=0;i<150;i++){toolbar=(await app.windows()).find(page=>page.url().endsWith('/assets/preview.html'));if(toolbar)break;await wait(20);}assert(toolbar,'local toolbar did not open');
  await toolbar.waitForFunction(()=>!!window.productPreview);await toolbar.waitForFunction(()=>!document.querySelector('#confirm').disabled);
  const state=()=>toolbar.evaluate(()=>window.productPreview.state());
  check((await state()).title==='Moon Dress · fixture','toolbar title');check((await state()).canConfirm,'original candidate enabled');
  check(await app.evaluate(()=>{const remote=globalThis.previewTest.remote(),prefs=remote.getLastWebPreferences();return prefs.sandbox&&prefs.contextIsolation&&!prefs.nodeIntegration&&!prefs.preload;}),'remote sandbox has no preload/node');
  check(await app.evaluate(()=>!globalThis.previewTest.remote().session.isPersistent()),'preview session is in memory');
  check(await app.evaluate(async()=>{const wc=globalThis.previewTest.remote();return await wc.executeJavaScript('typeof window.library+":"+typeof window.productPreview+":"+typeof require')==='undefined:undefined:undefined';}),'remote has no library or toolbar bridge');
  check(await app.evaluate(async({ipcMain})=>{const fixture=globalThis.previewTest,entry=fixture.preview.active,handler=ipcMain._invokeHandlers.get(entry.channel);try{await handler({sender:fixture.remote(),senderFrame:fixture.remote().mainFrame},'confirm');return false;}catch{return true;}}),'preview IPC rejects remote contents even with the correct channel');
  check(await app.evaluate(async({ipcMain})=>{const fixture=globalThis.previewTest,entry=fixture.preview.active,handler=ipcMain._invokeHandlers.get(entry.channel);try{await handler({sender:fixture.toolbar(),senderFrame:null},'confirm');return false;}catch{return true;}}),'preview IPC rejects a non-main frame');
  await wait(80);check(await app.evaluate(()=>globalThis.previewTest.hits.some(h=>h.url==='https://cdn.example.org/cover.png')),'public cover allowed');
  check(await app.evaluate(()=>!globalThis.previewTest.hits.some(h=>h.url.includes('private.example.org')||h.url.startsWith('file:'))),'private DNS and file subresources blocked');
  const navigate=async url=>{await app.evaluate(async(_e,url)=>{try{await globalThis.previewTest.remote().loadURL(url);}catch{}},url);await wait(40);};
  await navigate('https://other.booth.pm/items/7654321');check(!(await state()).canConfirm,'different BOOTH recommendation cannot be confirmed');
  check(await toolbar.evaluate(async()=>{try{await window.productPreview.confirm();return false;}catch{return true;}}),'confirmation IPC rejects another product');
  await toolbar.getByRole('button',{name:'← 后退'}).click();await toolbar.waitForFunction(()=>!document.querySelector('#confirm').disabled);check((await state()).canGoForward,'native back/forward history');
  await navigate('https://shop.booth.pm/en/items/1234567');check((await state()).canConfirm,'same BOOTH ID on locale/shop redirect remains confirmable');
  await app.evaluate(()=>globalThis.previewTest.setConfirm(false));check(!(await state()).canConfirm,'removed/changed candidate cannot be confirmed');await app.evaluate(()=>globalThis.previewTest.setConfirm(true));
  check(await app.evaluate(async()=>{return await globalThis.previewTest.remote().executeJavaScript('new Promise(resolve=>navigator.geolocation.getCurrentPosition(()=>resolve(false),error=>resolve(error.code===1)))');}),'geolocation permission denied');
  check(await app.evaluate(async()=>{const fixture=globalThis.previewTest;await fixture.remote().executeJavaScript('fetch("https://booth.pm/readonly",{method:"POST",body:"x"}).catch(()=>{})');return !fixture.hits.some(h=>h.method==='POST');}),'POST submissions blocked');
  const windowCount=(await app.windows()).length;await app.evaluate(()=>globalThis.previewTest.remote().executeJavaScript('document.querySelector("#new").click()'));await wait(50);check((await app.windows()).length===windowCount,'new windows blocked');
  for(const url of ['http://booth.pm/page','https://127.0.0.1/page','https://private.example.org/page','https://user:secret@booth.pm/page','file:///'+sentinel.replace(/\\/g,'/'),'https://booth.pm/users/sign_in']){
   const hitsBefore=await app.evaluate(()=>globalThis.previewTest.hits.length);await navigate(url);check(!(await state()).canConfirm,'unsafe navigation disabled confirmation '+url);check((await app.evaluate(()=>globalThis.previewTest.hits.length))===hitsBefore,'unsafe navigation never reached resource handler '+url);
  }
  await navigate('https://booth.pm/missing');check(!(await state()).canConfirm,'404 cannot be confirmed');check(/不存在|下架/.test((await state()).status),'404 shows meaningful status '+JSON.stringify(await state()));
  await navigate('https://booth.pm/download');check(!(await state()).canConfirm,'download is rejected');
  await navigate(source);await toolbar.getByRole('button',{name:'确认这一商品',exact:true}).click();await toolbar.waitForFunction(()=>document.querySelector('#confirm').textContent==='已确认');
  check(JSON.stringify(await app.evaluate(()=>globalThis.previewTest.accepted))===JSON.stringify([{id:'asset-1',url:source}]),'confirm uses original authorized candidate once');check(!(await state()).canConfirm,'second confirmation disabled');
  const closedChannel=await app.evaluate(()=>globalThis.previewTest.preview.active.channel);await toolbar.getByRole('button',{name:'关闭',exact:true}).click();await wait(40);check(await app.evaluate(()=>globalThis.previewTest.preview.active===undefined),'close removes remote contents and IPC');
  check(await app.evaluate(({ipcMain},channel)=>!ipcMain._invokeHandlers.has(channel),closedChannel),'closed preview token cannot invoke an old handler');
  await app.evaluate(async()=>globalThis.previewTest.preview.open('asset-1','https://shop.example.org/product'));let external;for(let i=0;i<80;i++){external=(await app.windows()).find(page=>page.url().endsWith('/assets/preview.html'));if(external)break;await wait(15);}await external.waitForFunction(()=>!!window.productPreview);await external.waitForFunction(()=>!document.querySelector('#confirm').disabled);
  await navigate('https://shop.example.org/different');check(!(await external.evaluate(()=>window.productPreview.state())).canConfirm,'other websites require the original normalized URL');
  check(crypto.createHash('sha256').update(fs.readFileSync(sentinel)).digest('hex')===before,'original material fixture remains untouched');
  await app.evaluate(()=>globalThis.previewTest.preview.close());console.log(JSON.stringify({ok:true,checks,profile,sourceUntouched:true,builtInChromium:true}));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
