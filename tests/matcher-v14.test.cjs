const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {EnrichmentQueue,parseSearch,parseProduct}=require('../dist/main/main/online');
const {candidateScore,searchClue,canonicalSourceKey,boothProductId,fileVersion,MATCH_RULE_VERSION}=require('../dist/main/main/matching');
const {projectAssets}=require('../dist/main/main/grouping');
const {inferCategory}=require('../dist/main/main/hints');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),url=id=>'https://booth.pm/ja/items/'+id;
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const product=(id,title='Moon Dress',cover)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:url(id),name:title,brand:{name:'Shop',url:'https://shop.booth.pm/'},...(cover?{image:cover}:{})})+'</script>';
const card=(id,title='Moon Dress')=>'<div class="item-card"><a class="item-card__title" href="/ja/items/'+id+'">'+title+'</a><a class="item-card__shop-name-anchor" href="https://shop.booth.pm/">Shop</a></div>';
const asset=(name,extra={})=>({id:'a',name,path:'E:\\VRChat\\fixture.zip',group:'Airi',kind:'archive',missing:false,size:10,mtimeMs:456,localCategory:'未分类',localAvatars:['Airi'],hintUrls:[],manual:{notes:'keep my notes',tags:['人工']},online:{status:'pending'},createdAt:'',updatedAt:'',...extra});
function setup(t,item,fetch){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-match-v14-')),updates=[],calls=[];
 const deps={dataDir,roots:()=>['E:\\VRChat'],all:()=>[item],get:id=>id===item.id?item:null,updateOnline:(_id,patch)=>{updates.push(patch);item.online={...item.online,...patch};},fetch:async(target,init)=>{calls.push(target);return fetch(target,init);},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}};
 const queues=[],create=()=>{const queue=new EnrichmentQueue(deps);queues.push(queue);return queue;},queue=create();t.after(async()=>{for(const q of queues){q.stop();await q.waitIdle();}fs.rmSync(dataDir,{recursive:true,force:true});});return {queue,create,item,updates,calls};
}
async function idle(queue){for(let i=0;i<600&&queue.progress.running;i++)await wait(5);assert(!queue.progress.running);await queue.waitIdle();}

test('the observed BOOTH no-result heading never turns its four-column recommendations into candidates',()=>{
 const page='<title>MA2BT Proの同人通販 - BOOTH</title><div class="market-items"><h1>MA2BT Proの検索結果</h1><h2>条件に一致する商品は見つかりませんでした。</h2><ul class="l-cards-4cols"><li>'+card('1234567','MA2BT Pro')+'</li></ul></div>';
 assert.deepEqual(parseSearch(page,'https://booth.pm/ja/search/MA2BT%20Pro'),[]);
});
test('the observed BOOTH five-column result grid is separated from recommended product cards',()=>{
 const page='<div class="market-items"><ul class="l-cards-5cols">'+card('1234567')+'</ul><div class="recommendations"><ul class="l-cards-4cols">'+card('7654321')+'</ul></div></div>';
 assert.deepEqual(parseSearch(page,'https://booth.pm/ja/search/Moon').map(c=>c.url),[url('1234567')]);
});
test('zero-related search cards cause no detail or thumbnail traffic and remain not-found',async t=>{
 const f=setup(t,asset('Moon Dress.zip'),async target=>html(target.includes('/search/')?card('7654321','Hololive Mug'):product('7654321','Hololive Mug')));
 await f.queue.enqueue();await idle(f.queue);assert.equal(f.item.online.status,'not-found');assert.deepEqual(f.item.online.candidates,[]);assert.equal(f.calls.length,1);
});
test('confirmed source refresh wins over a filename search and retains an explicit manual evidence record',async t=>{
 const source=url('7654321'),item=asset('Unrelated Chinese Name.zip',{online:{status:'matched',url:source,title:'Previously accepted',confirmedSource:true}}),f=setup(t,item,async target=>html(product('7654321','Confirmed Dress')));
 const manual=JSON.stringify(item.manual);await f.queue.enqueue(['a'],true);await idle(f.queue);assert.deepEqual(f.calls,[source,'https://booth.pm/en/search/Confirmed%20Dress']);assert.equal(item.online.status,'matched');assert.equal(item.online.url,source);assert.equal(item.online.confirmedSource,true);assert.equal(item.online.matchEvidence.method,'manual');assert(item.online.matchEvidence.signals.some(s=>s.includes('用户已确认')));assert.equal(JSON.stringify(item.manual),manual);
});
test('a manual URL without confirmation stays review and acceptance survives subsequent refresh and reopening',async t=>{
 const source=url('7654321'),item=asset('Unknown local package.zip',{manual:{sourceUrl:source,notes:'Keep'},online:{status:'pending'}}),f=setup(t,item,async()=>html(product('7654321','Moon Dress')));
 await f.queue.enqueue();await idle(f.queue);assert.equal(item.online.status,'review');assert.equal(item.online.confirmedSource,false);assert.equal(item.online.matchEvidence.method,'manual');
 await f.queue.acceptCandidate('a',source);await idle(f.queue);assert.equal(item.online.confirmedSource,true);const next=f.create();await next.enqueue(['a'],true);await idle(next);assert.equal(item.online.url,source);assert.equal(item.online.status,'matched');assert.equal(item.online.confirmedSource,true);assert.equal(item.manual.notes,'Keep');assert.equal(f.calls.length,2,'confirmed refresh uses page and category-search caches');
});
test('legacy matched URLs refresh their original identity without inventing a manual confirmation',async t=>{
 const source=url('7654321'),item=asset('Unrelated filename.zip',{online:{status:'matched',url:source,title:'Registered Title',coverFile:'old.png'}}),f=setup(t,item,async()=>html(product('7654321','Current registered title')));
 await f.queue.enqueue(['a'],true);await idle(f.queue);assert.deepEqual(f.calls,[source,'https://booth.pm/en/search/Current%20registered%20title']);assert.equal(item.online.status,'matched');assert.equal(item.online.url,source);assert.equal(item.online.confirmedSource,false);assert.equal(item.online.matchEvidence.method,'known-source');assert(item.online.matchEvidence.signals.some(signal=>signal.includes('刷新已登记')));assert(!item.online.matchEvidence.signals.some(signal=>signal.includes('用户已确认')));assert.equal(item.online.title,'Current registered title');
});
test('a downlisted legacy source preserves existing title, cover and manual fields and stays bound on retry',async t=>{
 const source=url('7654321'),item=asset('Unrelated filename.zip',{online:{status:'matched',url:source,title:'Registered Title',coverFile:'old.png'}}),manual=JSON.stringify(item.manual),f=setup(t,item,async()=>new Response('',{status:404,headers:{'content-type':'text/html'}}));
 await f.queue.enqueue(['a'],true);await idle(f.queue);assert.equal(item.online.status,'matched');assert.match(item.online.message,/保留上次资料/);assert.equal(item.online.title,'Registered Title');assert.equal(item.online.coverFile,'old.png');assert.equal(item.online.url,source);assert.equal(item.online.matchEvidence.method,'known-source');assert.equal(JSON.stringify(item.manual),manual);
 await f.queue.enqueue(['a'],true);await idle(f.queue);assert(f.calls.every(target=>target===source));assert.equal(item.online.title,'Registered Title');
});
test('rejected BOOTH items are filtered across locale and shop aliases before fetching',async t=>{
 const item=asset('Moon Dress.zip',{online:{status:'review',rejectedUrls:['https://shop.booth.pm/en/items/1234567']}}),f=setup(t,item,async()=>html(card('1234567')));
 await f.queue.enqueue(['a'],true);await idle(f.queue);assert.equal(item.online.status,'not-found');assert.deepEqual(item.online.candidates,[]);assert.equal(f.calls.length,1);assert.equal(canonicalSourceKey(url('1234567')),canonicalSourceKey(item.online.rejectedUrls[0]));assert.equal(boothProductId('https://booth.pm.evil.org/items/1234567'),undefined);
});
test('a rejection during a product request is re-read before automatic assignment or review publication',async t=>{
 let release,started;const began=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
 const item=asset('Moon Dress.zip'),f=setup(t,item,async target=>{if(target.includes('/search/'))return html(card('1234567'));started();await held;return html(product('1234567'));});
 await f.queue.enqueue();await began;item.online={...item.online,status:'review',rejectedUrls:['https://shop.booth.pm/items/1234567'],candidates:[]};release();await idle(f.queue);
 assert(!f.updates.some(p=>p.status==='matched'));assert(!item.online.candidates?.some(c=>boothProductId(c.url)==='1234567'));assert.equal(item.manual.notes,'keep my notes');
});
test('a rejection during thumbnail transfer cannot resurrect the removed candidate',async t=>{
 let release,started;const began=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
 const item=asset('1234567.zip'),f=setup(t,item,async target=>{if(target.includes('cdn.')){started();await held;return new Response(png,{headers:{'content-type':'image/png'}});}return html(product('1234567','Moon Dress','https://cdn.example.org/cover.png'));});
 await f.queue.enqueue();await began;item.online={...item.online,rejectedUrls:[url('1234567')],candidates:[]};release();await idle(f.queue);assert.deepEqual(item.online.candidates,[]);assert.equal(item.online.status,'review');
});
test('matching evidence identifies filename, README, child package and name-search routes without probability claims',async t=>{
 for(const [name,extra,method] of [['1234567 Moon Dress@Shop.zip',{},'filename-id'],['Moon Dress.zip',{hintUrls:[url('1234567')]},'readme-link'],['包装',{kind:'folder',localNameHints:['1234567 Moon Dress_Airi.zip']},'child-package'],['Moon Dress.zip',{},'name-search']]){
  const item=asset(name,extra),f=setup(t,item,async target=>html(target.includes('/search/')?card('1234567'):product('1234567')));await f.queue.enqueue();await idle(f.queue);assert.equal(item.online.status,'matched');assert.equal(item.online.matchEvidence.method,method);assert.equal(item.online.matchEvidence.ruleVersion,MATCH_RULE_VERSION);assert(item.online.matchEvidence.signals.length);assert(item.online.matchEvidence.recordedAt);assert(!item.online.matchEvidence.signals.some(s=>/概率|百分|%/.test(s)));assert.equal(item.online.confirmedSource,false);
 }
});
test('a confirmed BOOTH URL redirecting to another item requires a new confirmation',async t=>{
 const item=asset('Moon Dress.zip',{online:{status:'matched',confirmedSource:true,url:url('1234567')}}),f=setup(t,item,async target=>target===url('1234567')?new Response('',{status:302,headers:{location:url('7654321')}}):html(product('7654321')));
 await f.queue.enqueue(['a'],true);await idle(f.queue);assert.equal(item.online.status,'review');assert.equal(item.online.confirmedSource,false);assert.equal(item.online.candidates[0].url,url('7654321'));assert(item.online.candidates[0].reason.includes('另一商品编号'));
});
test('canonical grouping preserves conflicting Unicode IDs and unifies creator version suffixes without claiming equal contents',()=>{
 const entries=(names)=>names.map((name,i)=>asset(name,{id:String(i),path:'E:\\VRChat\\Airi\\'+name,mtimeMs:100+i}));
 assert.equal(projectAssets(entries(['１２３４５６７ MoonDress.zip','７６５４３２１ MoonDress.zip'])).length,2);
 const grouped=projectAssets(entries(['MoonDress@Shop_v1.0.zip','MoonDress@Shop_v2.0.zip']));assert.equal(grouped.length,1);assert.deepEqual(grouped[0].members.map(m=>m.version).sort(),['1.0','2.0']);assert.deepEqual(grouped[0].members.map(m=>m.mtimeMs).sort(),[100,101]);assert.equal(new Set(grouped[0].members.map(m=>m.id)).size,2);
 assert.equal(projectAssets(entries(['MoonDress Summer.zip','MoonDress Winter.zip'])).length,2);
});
test('namespaced VPM package versions are not authors and tool words cannot match SpringB as a ring',()=>{
 assert.deepEqual(searchClue('net.narazaka.vrchat.manual-baker@1.0.1@narazaka.zip'),{query:'net.narazaka.vrchat.manual-baker',author:'narazaka'});assert.equal(fileVersion('net.narazaka.vrchat.manual-baker@1.0.1@narazaka.zip'),'1.0.1');
 for(const name of ['VRM_PhyB_to_SpringB_v0.4.unitypackage','net.narazaka.vrchat.manual-baker@1.0.1@narazaka.zip','net.nekobako.editor-patcher-1.1.0.unitypackage'])assert.equal(inferCategory(name),'工具');
 assert.equal(inferCategory('SpringB'),'未分类');assert.equal(inferCategory('Tailor Dress'),'服装');assert.equal(inferCategory('Finger Ring'),'饰品');assert.equal(inferCategory('Y2K Hair Clips'),'饰品');assert.equal(candidateScore('MoonDress Summer.zip',{url:url('1234567'),title:'MoonDress Winter'})<.95,true);
});
test('the explicit product category wins over incidental shader keywords in tags',()=>{
 const body=product('1234567','Moon Dress')+'<article class="market-item-detail-article"><div class="item-category"><a href="/ja/browse/3D%20Clothing">衣装</a></div><a class="item-tag" href="/tags/shader">shader</a></article>';
 assert.equal(parseProduct(body,url('1234567')).category,'服装');
});
