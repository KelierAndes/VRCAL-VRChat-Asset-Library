const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {EnrichmentQueue}=require('../dist/main/main/online');
const {Store}=require('../dist/main/main/store');
const source=id=>'https://booth.pm/ja/items/'+id;
const html=(id,title='MoonDress',extra={},body='')=>new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:source(id),name:title,...extra})+'</script>'+body,{headers:{'content-type':'text/html'}});
const asset=(name='MoonDress.zip')=>({id:'a',name,path:'Z:\\MetadataReviewFixture\\'+name,group:'Role',kind:'archive',missing:false,size:1,mtimeMs:0,localCategory:'服装',localAvatars:[],hintUrls:[],manual:{notes:'人工笔记',tags:['人工']},online:{status:'pending'},createdAt:'',updatedAt:''});
const known=()=>({status:'matched',url:source('1234567'),title:'MoonDress',author:'Shop',category:'服装',coverFile:'old.png',coverUrl:'https://cdn.public.org/old.png',avatars:['Airi'],tags:['旧标签'],description:'已知介绍'});
async function idle(queue){for(let i=0;i<600&&queue.progress.running;i++)await new Promise(resolve=>setTimeout(resolve,5));assert(!queue.progress.running);await queue.waitIdle();}
function fixture(t,item,fetch){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-metadata-refresh-'));
 const queue=new EnrichmentQueue({dataDir,roots:()=>['Z:\\MetadataReviewFixture'],all:()=>[item],get:()=>item,updateOnline:(_id,patch)=>item.online={...item.online,...patch},fetch,testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}});
 t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dataDir,{recursive:true,force:true});});return queue;
}

test('same-source legacy and confirmed refresh retain known fields and cover after incomplete metadata and image failure',async t=>{
 for(const confirmed of [false,true]){
  const item=asset();item.online={...known(),confirmedSource:confirmed};
  const queue=fixture(t,item,async url=>url.includes('cdn.')?new Response('',{status:503}):html('1234567','MoonDress',{image:'https://cdn.public.org/new.png'}));
  await queue.enqueue(['a'],true);await idle(queue);
  assert.equal(item.online.status,'matched');assert.equal(item.online.metadataSourceUrl,source('1234567'));
  assert.equal(item.online.coverFile,'old.png');assert.equal(item.online.author,'Shop');assert.equal(item.online.category,'服装');
  assert.deepEqual(item.online.tags,['旧标签']);assert.deepEqual(item.online.avatars,['Airi']);assert.equal(item.online.description,'已知介绍');
  assert.match(item.online.message,/封面读取失败/);assert.match(item.online.message,/沿用上次记录/);assert.equal(item.online.confirmedSource,confirmed);assert.equal(item.manual.notes,'人工笔记');
 }
});

test('same-source missing image retains its cover, but explicit empty description and complete empty article update metadata',async t=>{
 const item=asset();item.online=known();
 const queue=fixture(t,item,async()=>html('1234567','MoonDress',{description:''},'<article class="market-item-detail-article"></article>'));
 await queue.enqueue(['a'],true);await idle(queue);
 assert.equal(item.online.coverFile,'old.png');assert.equal(item.online.coverUrl,'https://cdn.public.org/old.png');
 assert.equal(item.online.description,'');assert.deepEqual(item.online.tags,[]);assert.deepEqual(item.online.avatars,[]);
 assert.equal(item.online.author,'Shop');assert.equal(item.online.metadataSourceUrl,source('1234567'));
});

test('an explicit empty JSON description alone does not claim missing compatibility or tag sections were refreshed',async t=>{
 const item=asset();item.online=known();const queue=fixture(t,item,async()=>html('1234567','MoonDress',{description:''}));
 await queue.enqueue(['a'],true);await idle(queue);assert.equal(item.online.description,'');
 assert.deepEqual(item.online.avatars,['Airi']);assert.deepEqual(item.online.tags,['旧标签']);assert.match(item.online.message,/沿用上次记录/);
});

test('changed binding preserves offline display through failure and restart, then partial success cannot inherit the former source',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-metadata-restart-')),root=path.join(base,'素材'),dataDir=path.join(base,'资料库'),file=path.join(root,'MoonLibrary.zip');
 fs.mkdirSync(root);fs.writeFileSync(file,'fixture stays unchanged');let store=new Store(dataDir,[root]);const queues=[];let fail=true;
 t.after(async()=>{for(const queue of queues){queue.stop();await queue.waitIdle();}try{store.close()}catch{}fs.rmSync(base,{recursive:true,force:true});});
 const item=store.upsertScan({path:file,name:'MoonLibrary.zip',group:'Role',kind:'archive',size:1,mtimeMs:0,localCategory:'服装',localAvatars:[],hintUrls:[]});
 store.updateOnline(item.id,known());store.updateManual([item.id],{notes:'人工笔记',tags:['人工'],sourceUrl:source('7654321')},false);
 const create=()=>{const queue=new EnrichmentQueue({dataDir,roots:()=>[root],all:()=>store.all(),get:id=>store.getRaw(id),updateOnline:(id,patch)=>store.updateOnline(id,patch),fetch:async()=>fail?new Response('',{status:503}):html('7654321','MoonLibrary'),testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}});queues.push(queue);return queue;};
 const first=create();await first.linkSource(item.id,source('7654321'));await idle(first);
 let current=store.getRaw(item.id);assert.equal(current.online.status,'failed');assert.equal(current.online.url,source('7654321'));assert.equal(current.online.metadataSourceUrl,source('1234567'));assert.equal(current.online.coverFile,'old.png');assert.equal(current.online.description,'已知介绍');
 first.stop();await first.waitIdle();store.close();store=new Store(dataDir,[root]);current=store.getRaw(item.id);assert.equal(current.online.metadataSourceUrl,source('1234567'));
 const backup=path.join(base,'备份.json');store.exportData(backup);assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).assets[0].online.metadataSourceUrl,source('1234567'));
 fail=false;const second=create();await second.enqueue([item.id],true);await idle(second);current=store.getRaw(item.id);
 assert.equal(current.online.status,'matched');assert.equal(current.online.url,source('7654321'));assert.equal(current.online.metadataSourceUrl,source('7654321'));
 assert.equal(current.online.coverFile,undefined);assert.equal(current.online.coverUrl,undefined);assert.equal(current.online.author,undefined);assert.equal(current.online.category,undefined);
 assert.equal(current.online.description,'');assert.deepEqual(current.online.tags,[]);assert.deepEqual(current.online.avatars,[]);assert.equal(current.manual.notes,'人工笔记');assert.deepEqual(current.manual.tags,['人工']);
 assert.equal(fs.readFileSync(file,'utf8'),'fixture stays unchanged');
});

test('multiple explicit filename IDs remain review even when only one candidate has an exact title',async t=>{
 for(const name of ['1234567 7654321 MoonDress.zip','１２３４５６７ ７６５４３２１ MoonDress.zip']){
  const item=asset(name),queue=fixture(t,item,async url=>url.includes('/search/')?new Response('<div class="market-items"><h2>条件に一致する商品は見つかりませんでした。</h2></div>',{headers:{'content-type':'text/html'}}):new URL(url).pathname.endsWith('/items/1234567')?html('1234567','MoonDress',{brand:{name:'Shop'}}):html('7654321','StarDress',{brand:{name:'Shop'}}));
  await queue.enqueue(['a'],true);await idle(queue);assert.equal(item.online.status,'review');assert.equal(item.online.confirmedSource,undefined);assert.match(item.online.message,/多个商品编号/);
  assert.deepEqual(item.online.candidates.map(candidate=>candidate.url),['https://booth.pm/zh-cn/items/1234567','https://booth.pm/zh-cn/items/7654321']);assert(item.online.candidates.every(candidate=>candidate.reason.includes('多个商品编号')));
 }
});
