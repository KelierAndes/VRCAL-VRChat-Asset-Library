const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),runDir=path.resolve(root,'..',`source-provenance-qa-${Date.now()}`),source=path.join(runDir,'素材'),profile=path.join(runDir,'资料库');
fs.mkdirSync(source,{recursive:true});
const cases=[
  {name:'QA不同BOOTH来源',url:'https://booth.pm/zh-cn/items/5053741',old:'https://booth.pm/ja/items/123456',retained:true,check:'different-booth-item-shows-retained-source-and-old-url'},
  {name:'QA同商品多语言',url:'https://booth.pm/zh-cn/items/5053742',old:'https://qa-shop.booth.pm/items/5053742?from=cover',retained:false,check:'same-booth-item-locales-shops-and-query-do-not-warn'},
  {name:'QA同网页规范化',url:'https://EXAMPLE.org/product?a=1&b=2',old:'https://example.org/product/?b=2&a=1#cover',retained:false,check:'same-normalized-public-url-does-not-warn'},
  {name:'QA不同网页来源',url:'https://example.org/products/two',old:'https://example.org/products/one',retained:true,check:'different-public-url-shows-retained-source'},
  {name:'QA旧库无来源记录',url:'https://booth.pm/ja/items/555555',retained:false,check:'legacy-without-provenance-does-not-invent-warning'}
];
const {Store}=require('../dist/main/main/store'),store=new Store(profile,[source]);
for(const row of cases){const file=path.join(source,row.name+'.zip');fs.writeFileSync(file,row.name);const asset=store.upsertScan({path:file,name:row.name,group:'QA',kind:'archive',size:1,mtimeMs:Date.now(),localCategory:'服装',localAvatars:[],hintUrls:[]});row.id=asset.id;store.updateOnline(asset.id,{status:'matched',url:row.url,metadataSourceUrl:row.old,matchEvidence:{method:'known-source',signals:['已登记来源用于刷新'],ruleVersion:'test-1.4',recordedAt:new Date().toISOString()}})}
store.close();
function sourceHashes(){return Object.fromEntries(fs.readdirSync(source).map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex')]))}
const before=sourceHashes(),checked=[],errors=[];let app;
(async()=>{app=await _electron.launch({executablePath:process.env.VRC_UI_EXECUTABLE||require('electron'),args:process.env.VRC_UI_EXECUTABLE?[]:[root],env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:source,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1'}});const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.library);await page.locator('.asset-card').first().waitFor();
for(const row of cases){const returned=await page.evaluate(id=>window.library.get(id),row.id);assert.equal(returned.online.metadataSourceUrl,row.old);await page.locator(`.asset-card[data-asset-id="${row.id}"]`).click();await page.locator('.detail-title h2').filter({hasText:row.name}).waitFor();await page.locator('.evidence-section').getByText('已登记来源',{exact:true}).waitFor();const notice=page.locator('.source-retained-notice');assert.equal(await notice.count(),row.retained?1:0);if(row.retained){assert((await notice.innerText()).includes('当前展示保留自上次来源，新来源尚未补全'));assert((await notice.innerText()).includes(row.old))}assert(!(await page.locator('body').innerText()).includes('metadataSourceUrl'));checked.push(row.check)}
assert.deepEqual(sourceHashes(),before);assert.deepEqual(errors,[]);checked.push('source-fixtures-unchanged-and-no-render-errors');const report={ok:true,checked,errors,runDir,source,profile};fs.writeFileSync(path.join(runDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await app.close();app=null;
})().catch(async error=>{console.error(error);if(app)try{await app.close()}catch{}process.exitCode=1});
