// Real Electron IPC with synthetic pages. No real account, clipboard change or paid AI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{Store}=require('../dist/main/main/store');
if(process.env.VRC_TEST_APP_EXECUTABLE&&/-x64\.exe$/i.test(process.env.VRC_TEST_APP_EXECUTABLE))throw Error('For main-process IPC interception use the packaged inner executable in win-unpacked; validate the NSIS portable launcher separately with ui-preview-package-test.cjs.');
const repo=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.resolve(repo,'../ui-discovery-web-')),profile=path.join(run,'Library'),root=path.join(run,'Synthetic Materials');
fs.mkdirSync(root,{recursive:true});const store=new Store(profile,[root]);store.saveSettings({theme:'x',language:'zh-CN',onlineEnabled:true,xThemeIntroduced:true});store.close();let app;
const reply={summary:'哥特蕾丝礼裙',boothQueries:['gothic dress'],xianyuQuery:'VRChat 哥特 蕾丝 礼裙',terms:['gothic','dress']};
const capture=async name=>app.evaluate(async({BrowserWindow},file)=>{const picture=await BrowserWindow.getAllWindows()[0].webContents.capturePage();process.getBuiltinModule('node:fs').writeFileSync(file,picture.toPNG())},path.join(run,name));
async function waitSearch(page){for(let i=0;i<100;i++){const s=await page.evaluate(()=>window.library.discoveryState());if(s.finishedAt&&!s.running)return s;await new Promise(r=>setTimeout(r,100))}throw Error('search timeout')}
(async()=>{
 app=await _electron.launch({timeout:30000,executablePath:process.env.VRC_TEST_APP_EXECUTABLE||require('electron'),args:process.env.VRC_TEST_APP_EXECUTABLE?[]:[repo],env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:root,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:process.env.VRC_PACKAGE_VISIBLE?'':'1'}});
 const appInfo=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged}));const page=await app.firstWindow();page.setDefaultTimeout(10000);
 await app.evaluate(({net,shell,clipboard})=>{
  delete process.env.VRC_LIBRARY_NO_NETWORK;global.webAiTest={apiCalls:0,opened:[],copied:[]};
  shell.openExternal=async url=>{global.webAiTest.opened.push(url)};clipboard.writeText=text=>{global.webAiTest.copied.push(text)};
  net.fetch=async()=>{global.webAiTest.apiCalls++;throw Error('Unexpected API network request')};
  net.request=()=>{const {EventEmitter}=process.getBuiltinModule('node:events'),{Readable}=process.getBuiltinModule('node:stream'),request=new EventEmitter();let incoming;
   request.abort=()=>incoming?.destroy();request.end=()=>setTimeout(()=>{incoming=Readable.from([Buffer.from('<div class="market-items"><div class="item-card" data-product-id="1234567"><a class="item-card__title" href="/ja/items/1234567">Synthetic Gothic Dress</a></div></div>')]);incoming.statusCode=200;incoming.headers={'content-type':'text/html'};request.emit('response',incoming)},20);return request};
 });
 await page.locator('.discovery-nav').click();assert.equal(await page.locator('.discovery-examples').count(),0);assert.equal((await page.evaluate(()=>window.library.aiState())).keyConfigured,false);
 await page.getByLabel('你想找什么？').fill('黑白配色的哥特蕾丝礼裙 C:\\Users\\PrivateAlice\\secret.png');
 await page.locator('.discovery-web-helper > summary').click();await page.getByRole('button',{name:'复制提示词并打开官网',exact:true}).click();await page.getByText('提示词和需求已复制。请在打开的官网粘贴并发送，复制完整回答后回到这里。',{exact:true}).waitFor();
 const captured=await app.evaluate(()=>global.webAiTest);assert.deepEqual(captured.opened,['https://www.qianwen.com/']);assert(captured.copied[0].includes('boothQueries'));assert(captured.copied[0].includes('哥特'));assert(!captured.copied[0].includes('PrivateAlice'));
 await page.getByLabel('你想找什么？').fill('黑白配色的哥特蕾丝礼裙');
 await page.getByLabel('粘贴网页 AI 的完整回答').fill('```json\n'+JSON.stringify(reply)+'\n```');await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).click();const state=await waitSearch(page);
 assert.equal(state.method,'web-ai');assert.equal(state.products.length,1);await page.getByText('网页 AI 检索词（用户导入）',{exact:true}).waitFor();await page.getByRole('heading',{name:'找到 1 件商品',exact:true}).waitFor();assert.equal((await app.evaluate(()=>global.webAiTest.apiCalls)),0);assert.equal((await page.evaluate(()=>window.library.aiState())).callsToday,0);
 await page.getByLabel('粘贴网页 AI 的完整回答').fill('{"products":["https://evil.example"]}');await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).click();await page.getByRole('alert').filter({hasText:'回答格式不正确'}).waitFor();assert.equal((await page.evaluate(()=>window.library.discoveryState())).products.length,1);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({width:980,height:900});w.showInactive()});await page.evaluate(()=>window.library.setZoom(2));await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).scrollIntoViewIfNeeded();
 await page.getByLabel('粘贴网页 AI 的完整回答').fill(JSON.stringify(reply));await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).click();await waitSearch(page);await page.getByRole('heading',{name:'找到 1 件商品',exact:true}).waitFor();await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).scrollIntoViewIfNeeded();
 assert(await page.getByRole('button',{name:'使用回答搜索商品',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}),'web action stays in viewport at 980px / 200%');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await capture('web-ai-980-200.png');
 await page.evaluate(()=>window.library.setZoom(1));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1480,height:980}));await page.locator('.discovery-intro').scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await capture('web-ai-helper.png');
 await app.close();app=null;
 const checks=['No API key or provider calls are required for web-planned product search','Native IPC copies only built-in prompt and redacted request to a fixed official site','A fenced JSON reply leads to an actual parsed product card and web-ai provenance','Invalid product/link JSON preserves the previous results','Three sample prompt buttons are removed and built-in instructions remain accessible','980px / 200% zoom keeps the web helper main action usable'];
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:true,...appInfo,synthetic:true,noLiveNetwork:true,checks,run},null,2));console.log(JSON.stringify({ok:true,...appInfo,checks,run}));
})().catch(async e=>{console.error(e);if(app)await app.close();process.exitCode=1});
