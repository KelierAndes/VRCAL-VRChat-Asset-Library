const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
process.env.NODE_ENV='test';
const {EnrichmentQueue,extractBoothIds}=require('../dist/main/main/online');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=','base64');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clone=value=>JSON.parse(JSON.stringify(value));
const itemUrl=id=>`https://booth.pm/ja/items/${id}`;
function asset(id,name,patch={}){return {id,name,path:'',group:'Airi',kind:'archive',size:12,mtimeMs:0,missing:false,localCategory:'服装',localAvatars:['Airi'],hintUrls:[],manual:{title:'我自己的名称',notes:'私有笔记',tags:['人工'],favorite:true},online:{status:'pending'},createdAt:'',updatedAt:'',...patch};}
function html(body,status=200){return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8'}})}
function product(id,title,author='Shop',cover){return `<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:title,url:itemUrl(id),brand:{name:author,url:'https://shop.booth.pm/'},description:'Airi対応衣装',...(cover?{image:cover}:{})})}</script>`;}
function search(results){return results.map(result=>`<div class="item-card"><a class="item-card__title" href="/ja/items/${result.id}">${result.title}</a><a class="item-card__shop-name-anchor" href="https://shop.booth.pm/">${result.author||'Shop'}</a></div>`).join('');}
function setup(t,items,fetch){
 const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-matching-queue-')),dataDir=path.join(base,'资料库'),root=path.join(base,'私有素材'),queues=[],calls=[],updates=[];fs.mkdirSync(root);
 for(const item of items){item.path=path.join(root,item.id+'.zip');fs.writeFileSync(item.path,'source stays unchanged');}
 const sourceHashes=new Map(items.map(item=>[item.path,crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex')]));
 const deps={dataDir,roots:()=>[root],all:()=>items,get:id=>items.find(item=>item.id===id)||null,updateOnline:(id,patch)=>{const item=items.find(item=>item.id===id);if(item){updates.push({id,patch:clone(patch)});item.online={...item.online,...patch};}},concurrency:()=>3,fetch:async(url,init)=>{calls.push(url);return fetch(url,init);},testing:{intervalMs:0,lookup:async()=>['93.184.216.34'],timeoutMs:2000}};
 const create=()=>{const queue=new EnrichmentQueue(deps);queues.push(queue);return queue},queue=create();
 t.after(async()=>{for(const q of queues){q.stop();await q.waitIdle();}for(const [file,hash] of sourceHashes)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);assert(path.resolve(base).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});
 return {queue,create,deps,items,calls,updates,dataDir};
}
async function until(predicate,message='Queue condition did not finish'){for(let i=0;i<800;i++){if(predicate())return;await sleep(5)}throw new Error(message)}
async function idle(queue){await until(()=>!queue.progress.running);await queue.waitIdle();}
function withoutCandidateCovers(online){const result=clone(online);for(const candidate of result.candidates??[])delete candidate.coverFile;return result;}

test('filename item ID is requested before five README base-model URLs and confirms the actual product',async t=>{
 const item=asset('a','6097412 Succubus Tattoo.zip',{hintUrls:['6405390','6106863','6082686','4035411','5058077'].map(itemUrl)});
 const {queue,calls}=setup(t,[item],async url=>html(product(new URL(url).pathname.match(/\d+/)?.[0]||'6097412',url.includes('6097412')?'Succubus Tattoo':'Original Base Avatar')));
 const manual=clone(item.manual);await queue.enqueue();await idle(queue);assert.equal(new URL(calls[0]).pathname,'/zh-cn/items/6097412');assert.equal(item.online.status,'matched');assert.equal(item.online.url,'https://booth.pm/zh-cn/items/6097412');assert.deepEqual(item.manual,manual);
});

test('the same item linked through several locales and shops is loaded only once',async t=>{
 const item=asset('a','Moon Dress.zip',{hintUrls:['https://booth.pm/ja/items/1234567','https://booth.pm/en/items/1234567','https://booth.pm/zh-cn/items/1234567','https://shop.booth.pm/items/1234567']});
 const {queue,calls}=setup(t,[item],async()=>html(product('1234567','Moon Dress')));await queue.enqueue();await idle(queue);assert.equal(item.online.status,'matched');assert.equal(calls.filter(url=>new URL(url).pathname.includes('/items/1234567')).length,1);
});

test('an unavailable filename ID falls back to product-name search and can still confirm',async t=>{
 const item=asset('a','9999999 Moon Dress.zip');const {queue,calls}=setup(t,[item],async url=>url.includes('9999999')?html('',404):url.includes('/search/')?html(search([{id:'1234567',title:'Moon Dress'}])):html(product('1234567','Moon Dress')));
 await queue.enqueue();await idle(queue);assert(calls.some(url=>url.includes('/items/9999999')));assert(calls.some(url=>url.includes('/search/')));assert.equal(item.online.status,'matched');assert.equal(item.online.url,itemUrl('1234567'));
});

test('README links crediting a base avatar do not prevent a later product-name search',async t=>{
 const item=asset('a','Moon Dress.zip',{hintUrls:[itemUrl('6082686')]});const {queue,calls}=setup(t,[item],async url=>url.includes('/items/6082686')?html(product('6082686','Original Model Airi')):url.includes('/search/')?html(search([{id:'1234567',title:'Moon Dress'}])):html(product('1234567','Moon Dress')));
 await queue.enqueue();await idle(queue);assert(calls.some(url=>url.includes('/items/6082686')));assert(calls.some(url=>url.includes('/search/')));assert.equal(item.online.status,'matched');assert.equal(item.online.title,'Moon Dress');
});

test('search scoring considers later results before fetching, while equally named products remain ambiguous',async t=>{
 const item=asset('a','Moon Dress.zip'),results=Array.from({length:27},(_,i)=>({id:String(7000000+i),title:`Unrelated Product ${i}`}));results.push({id:'1234567',title:'Moon Dress'});
 const first=setup(t,[item],async url=>{if(url.includes('/search/'))return html(search(results));const id=new URL(url).pathname.match(/\d+/)[0];return html(product(id,results.find(result=>result.id===id)?.title||'Unknown'));});
 await first.queue.enqueue();await idle(first.queue);assert.equal(item.online.status,'matched');assert.equal(item.online.url,itemUrl('1234567'));assert.equal(first.calls.find(url=>url.includes('/items/')),itemUrl('1234567'));assert(first.calls.filter(url=>url.includes('/items/')).length<=8,'only the scored shortlist should be loaded');
 const ambiguous=asset('b','Cloud Dress.zip'),options=[{id:'2345678',title:'Cloud Dress',author:'First'},{id:'3456789',title:'Cloud Dress',author:'Second'}];const second=setup(t,[ambiguous],async url=>url.includes('/search/')?html(search(options)):html(product(new URL(url).pathname.match(/\d+/)[0],'Cloud Dress',url.includes('2345678')?'First':'Second')));
 await second.queue.enqueue();await idle(second.queue);assert.equal(ambiguous.online.status,'review');assert.equal(ambiguous.online.candidates.length,2);assert.equal(ambiguous.online.coverFile,undefined);
});

test('pure calendar dates are not used as product IDs and full-width IDs are normalized before fetching',async t=>{
 assert.deepEqual(extractBoothIds('Moon Dress_20260124.zip'),[]);assert.deepEqual(extractBoothIds('Star Dress_202510.zip'),[]);assert.deepEqual(extractBoothIds('７６５４３２１ Cloud Dress.zip'),['7654321']);assert.deepEqual(extractBoothIds('7848881Somie.zip'),['7848881']);assert.deepEqual(extractBoothIds('7137809香烟魔法特效武器.zip'),['7137809']);
 const items=[asset('date','Moon Dress_20260124.zip'),asset('month','Star Dress_202510.zip'),asset('fullwidth','７６５４３２１ Cloud Dress.zip')],{queue,calls}=setup(t,items,async url=>url.includes('/search/')?html(search([{id:url.includes('Star')?'4567890':'1234567',title:url.includes('Star')?'Star Dress':'Moon Dress'}])):url.includes('7654321')?html(product('7654321','Cloud Dress')):url.includes('4567890')?html(product('4567890','Star Dress')):html(product('1234567','Moon Dress')));
 await queue.enqueue();await idle(queue);assert(!calls.some(url=>url.includes('/items/20260124')||url.includes('/items/202510')));assert(calls.some(url=>url.includes('/items/7654321')));assert(items.every(item=>item.online.status==='matched'));
});

test('one shallow wrapper package provides a match clue, while several independent package IDs stay review',async t=>{
 const unique=asset('one','CB40-nadeoto',{kind:'folder',localNameHints:['6010027 nadeoto_Airi.zip']}),multiple=asset('multi','多素材收集',{kind:'folder',localNameHints:['6010027 nadeoto_Airi.zip','7895092 GUILTY Makeup_Airi.zip']});
 const {queue,calls}=setup(t,[unique,multiple],async url=>{if(url.includes('/search/'))return html('');const id=new URL(url).pathname.match(/\d+/)[0];return html(product(id,id==='6010027'?'nadeoto':'GUILTY Makeup'));});
 await queue.enqueue();await idle(queue);assert.equal(unique.online.status,'matched');assert.equal(unique.online.url,'https://booth.pm/zh-cn/items/6010027');assert.equal(multiple.online.status,'review');assert.deepEqual(new Set(multiple.online.candidates.map(candidate=>new URL(candidate.url).pathname.match(/\d+/)[0])),new Set(['6010027','7895092']));assert(calls.some(url=>url.includes('/items/7895092')));
});

test('global retry targets unresolved materials and explicit IDs can force a matched material retry',async t=>{
 const eligible=['pending','review','not-found','failed','blocked'].map((status,i)=>asset('eligible'+i,'1234567 Moon Dress.zip',{online:{status}})),matched=asset('matched','1234567 Moon Dress.zip',{online:{status:'matched',title:'Keep until explicit retry',url:itemUrl('1234567'),classificationCheckedVersion:'1.9.0',matchEvidence:{method:'filename-id',signals:[],ruleVersion:'1.9.0',recordedAt:''}}}),project=asset('project','1234567 Moon Dress.zip',{kind:'unity-project'}),missing=asset('missing','1234567 Moon Dress.zip',{missing:true}),items=[...eligible,matched,project,missing];
 const {queue,updates}=setup(t,items,async()=>html(product('1234567','Moon Dress')));const matchedBefore=clone(matched.online);await queue.enqueue(undefined,true);await idle(queue);
 assert.deepEqual(new Set(updates.map(update=>update.id)),new Set(eligible.map(item=>item.id)));assert(eligible.every(item=>item.online.status==='matched'));assert.deepEqual(matched.online,matchedBefore);assert.equal(project.online.status,'pending');assert.equal(missing.online.status,'pending');
 updates.length=0;await queue.enqueue(['matched'],true);await idle(queue);assert(updates.some(update=>update.id==='matched'));assert.equal(matched.online.title,'Moon Dress');
});

test('candidate preview downloads change only private candidate covers and cache reads do not add network bytes',async t=>{
 const item=asset('a','Moon Dress.zip',{online:{status:'review',title:'Current primary metadata',author:'Primary author',url:itemUrl('1234567'),coverFile:'primary.png',coverUrl:'https://cdn.example.org/primary.png',message:'Keep review message',candidates:[{url:itemUrl('2345678'),title:'Candidate one',author:'One',authorAliases:['AliasOne'],coverUrl:'https://cdn.example.org/one.png'},{url:itemUrl('3456789'),title:'Candidate two',author:'Two',coverUrl:'https://cdn.example.org/two.png'}]}});
 const {queue,calls,dataDir}=setup(t,[item],async()=>new Response(png,{headers:{'content-type':'image/png'}}));fs.mkdirSync(path.join(dataDir,'cache'),{recursive:true});fs.writeFileSync(path.join(dataDir,'cache','primary.png'),png);const before=withoutCandidateCovers(item.online),manual=clone(item.manual);
 await queue.enqueueCandidateCovers(['a']);await idle(queue);assert.deepEqual(withoutCandidateCovers(item.online),before);assert.deepEqual(item.manual,manual);assert(item.online.candidates.every(candidate=>candidate.coverFile));for(const candidate of item.online.candidates)assert.deepEqual(fs.readFileSync(path.join(dataDir,'cache',candidate.coverFile)),png);assert.equal(calls.length,2);assert.equal(queue.progress.downloadedBytes,png.length*2);
 const count=calls.length,downloaded=queue.progress.downloadedBytes;await queue.enqueueCandidateCovers(['a']);await idle(queue);assert.equal(calls.length,count);assert.equal(queue.progress.downloadedBytes,downloaded);assert.deepEqual(withoutCandidateCovers(item.online),before);
});

test('candidate cover tasks survive pause and reopening without replacing manual labels or primary status',async t=>{
 const item=asset('a','Moon Dress.zip',{online:{status:'review',title:'Primary',coverFile:'primary.png',candidates:[{url:itemUrl('1234567'),title:'Moon Dress',coverUrl:'https://cdn.example.org/candidate.png'}]}});let first=true,started;const began=new Promise(resolve=>started=resolve);
 const {queue,create,dataDir}=setup(t,[item],async(_url,{signal})=>{if(first){first=false;started();await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}return new Response(png,{headers:{'content-type':'image/png'}});});
 const before=withoutCandidateCovers(item.online),manual=clone(item.manual);await queue.enqueueCandidateCovers(['a']);await began;queue.pause();await queue.waitIdle();const persisted=JSON.parse(fs.readFileSync(path.join(dataDir,'queue.json'),'utf8'));assert.equal(persisted.paused,true);assert.equal(new Set(persisted.tasks.map(task=>task.id)).size,1);
 const reopened=create();assert.equal(reopened.progress.paused,true);assert.equal(reopened.progress.pending,1);await reopened.resume();await idle(reopened);assert(item.online.candidates[0].coverFile);assert.deepEqual(withoutCandidateCovers(item.online),before);assert.deepEqual(item.manual,manual);assert.equal(reopened.progress.downloadedBytes,png.length);
});
