const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseProduct,EnrichmentQueue}=require('../dist/main/main/online');
const url='https://www.goofish.com/item?id=1234567890123';
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
