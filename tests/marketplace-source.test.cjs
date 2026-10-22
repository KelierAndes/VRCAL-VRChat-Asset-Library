const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseProduct,EnrichmentQueue}=require('../dist/main/main/online');
const url='https://www.goofish.com/item?id=1234567890123';

test('a loaded public page snapshot supplies a bound product without a second anonymous HTML request',()=>{
 const {captureMarketplaceProduct}=require('../dist/main/main/online');
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,name:'猫のメガネ💝',brand:{name:'Creator'},image:'https://img.alicdn.com/cover.jpg',description:'Public description'})+'</script><script>PRIVATE_LOGIN_TOKEN</script>';
 const captured=captureMarketplaceProduct(url,{url:url+'&tracking=ignored',html});const p=parseProduct(captured,url);assert.equal(p.title,'猫のメガネ💝');assert.equal(p.author,'Creator');assert.equal(p.coverUrl,'https://img.alicdn.com/cover.jpg');assert(!captured.includes('PRIVATE_LOGIN_TOKEN'));
 assert.throws(()=>captureMarketplaceProduct(url,{url:'https://www.goofish.com/item?id=222',html},'Manual name'),/页面已切换/);
 assert.throws(()=>captureMarketplaceProduct(url,{url,html:'<title>闲鱼</title>'}),/填写.*商品名称/);
 const manual=parseProduct(captureMarketplaceProduct(url,{url,html:'<title>闲鱼</title>'},'手动核对商品'),url);assert.equal(manual.title,'手动核对商品');assert.equal(manual.author,undefined);assert.equal(manual.coverUrl,undefined);
});

test('captured marketplace application persists the source, title and undo without refetching a login shell',async t=>{
 const {captureMarketplaceProduct}=require('../dist/main/main/online'),{Store}=require('../dist/main/main/store'),{matchingCatalog}=require('../dist/main/main/matching-catalog');
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-marketplace-captured-')),root=path.join(area,'Source'),dataDir=path.join(area,'Library');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'glasses.zip'),'KEEP');const store=new Store(dataDir,[root]);
 const item=store.upsertScan({path:path.join(root,'glasses.zip'),name:'glasses.zip',kind:'archive',group:'Test',size:1,mtimeMs:1,localCategory:'饰品',localAvatars:[],hintUrls:[]});store.updateOnline(item.id,{status:'matched',title:'Original title',url:'https://booth.pm/ja/items/1111111'});store.requestRematch([item.id]);const before=store.getRaw(item.id).online;
 const html=captureMarketplaceProduct(url,{url,html:'<title>闲鱼</title>'},'手动核对的眼镜'),undo=store.beginSourceChange([item.id],url,item.id,item.name);let fetches=0;
 const queue=new EnrichmentQueue({dataDir,roots:()=>[root],...matchingCatalog(store),fetch:async()=>{fetches++;throw Error('anonymous shell must not be fetched')}});t.after(async()=>{queue.stop();await queue.waitIdle();try{store.close()}catch{}fs.rmSync(area,{recursive:true,force:true,maxRetries:3})});
 await queue.acceptCandidate(item.id,url,true,html);await queue.waitIdle();assert.equal(fetches,0);assert.equal(store.get(item.id).online.status,'matched');assert.equal(store.get(item.id).online.title,'手动核对的眼镜');assert.equal(store.get(item.id).online.url,url);assert.equal(store.get(item.id).online.rematchRequested,false);assert(store.undoSource(undo.token));assert.deepEqual(store.getRaw(item.id).online,before);
});
test('marketplace login, generic shells and another item metadata cannot become matched products',()=>{
 for(const html of ['<title>闲鱼</title><div id="root"></div>','<title>淘宝登录</title>','<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:'https://www.goofish.com/item?id=222',name:'Another product'})+'</script>','<title>闲鱼</title><script type="application/ld+json">'+JSON.stringify({'@type':'Product',url})+'</script>','<meta property="og:type" content="product"><meta property="og:url" content="'+url+'"><title>闲鱼</title>'])assert.throws(()=>parseProduct(html,url));
 assert.throws(()=>parseProduct('<title>Search</title>','https://www.goofish.com/search?q=dress'));
 const parsed=parseProduct('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,name:'Actual dress',brand:{name:'Creator'},image:'https://www.goofish.com/public-cover.png'})+'</script>',url);assert.equal(parsed.title,'Actual dress');assert.equal(parsed.author,'Creator');
});

test('redirected explicit marketplace enrichment cannot adopt a login host or a different item',async t=>{
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-marketplace-redirect-'));t.after(()=>fs.rmSync(area,{recursive:true,force:true,maxRetries:5}));
 const prior=process.env.NODE_ENV;process.env.NODE_ENV='test';t.after(()=>{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior});
 for(const destination of ['https://login.taobao.com/member/login.jhtml','https://www.goofish.com/item?id=222']){
  const item={id:'one',path:path.join(area,'Source.zip'),name:'Source.zip',kind:'archive',group:'Synthetic',size:0,mtimeMs:0,localAvatars:[],hintUrls:[],manual:{sourceUrl:url,notes:'KEEP'},online:{status:'pending',title:'Original',author:'Creator',coverFile:'original.png'}};
  const queue=new EnrichmentQueue({dataDir:path.join(area,'Library'),roots:()=>[],all:()=>[item],get:()=>item,updateOnline:(_id,patch)=>item.online={...item.online,...patch},testing:{intervalMs:0},fetch:async()=>{throw Error('No network expected')}});
  queue.html=async()=>({url:destination,html:'<title>淘宝登录</title><script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:destination,name:'Another item'})+'</script>'});
  await queue.acceptCandidate(item.id,url,true);await queue.waitIdle();queue.stop();
  assert.notEqual(item.online.status,'matched');assert.equal(item.online.title,'Original');assert.equal(item.online.author,'Creator');assert.equal(item.online.coverFile,'original.png');assert.notEqual(item.online.confirmedSource,true);
 }
});
test('failed explicit marketplace enrichment preserves prior title, author, cover and annotations',async t=>{
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-marketplace-source-'));t.after(()=>fs.rmSync(area,{recursive:true,force:true,maxRetries:5}));
 const item={id:'one',path:path.join(area,'Source.zip'),name:'Source.zip',kind:'archive',group:'Synthetic',size:0,mtimeMs:0,localAvatars:[],hintUrls:[],manual:{sourceUrl:url,notes:'KEEP',tags:['manual']},online:{status:'pending',title:'Original title',author:'Original author',coverFile:'old-cover.png',tags:['old']}};
 const prior=process.env.NODE_ENV;process.env.NODE_ENV='test';const queue=new EnrichmentQueue({dataDir:path.join(area,'Library'),roots:()=>[],all:()=>[item],get:()=>item,updateOnline:(_id,patch)=>item.online={...item.online,...patch},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']},fetch:async()=>new Response('<title>闲鱼</title><div id="root"></div>',{headers:{'content-type':'text/html'}})});
 t.after(async()=>{queue.stop();await queue.waitIdle();if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior});
 await queue.acceptCandidate(item.id,url,true);for(let i=0;i<1000&&queue.progress.running;i++)await new Promise(r=>setTimeout(r,5));await queue.waitIdle();
 assert.notEqual(item.online.status,'matched');assert.equal(item.online.title,'Original title');assert.equal(item.online.author,'Original author');assert.equal(item.online.coverFile,'old-cover.png');assert.deepEqual(item.online.tags,['old']);assert.deepEqual(item.manual,{sourceUrl:url,notes:'KEEP',tags:['manual']});
});
