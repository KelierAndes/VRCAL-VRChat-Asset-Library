const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.NODE_ENV = 'test';
const {EnrichmentQueue,parseProduct,parseSearch,candidateScore,publicHttpsUrl,isPublicAddress,detectedImageExtension} = require('../dist/main/main/online');
const fixture = name => fs.readFileSync(path.join(__dirname,'fixtures',name+'.html'),'utf8');
const cheri=fixture('cherimel-live'), rho=fixture('rho-live'), search=fixture('rho-search-live');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
function asset(id,name) {return {id,name,path:`E:\\VRChat\\私人文件夹\\${name}`,group:'Airi',kind:'archive',missing:false,size:123,mtimeMs:0,localCategory:'未分类',localAvatars:['Airi'],hintUrls:[],manual:{title:'我自己的名称',category:'饰品',tags:['人工'],notes:'保留'},online:{status:'pending'},createdAt:'',updatedAt:''};}
function setup(t,items,fetch,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-online-'));
  const deps={dataDir:dir,roots:()=>['E:\\VRChat'],all:()=>items,get:id=>items.find(a=>a.id===id)||null,updateOnline:(id,patch)=>{const a=items.find(a=>a.id===id);if(a)a.online={...a.online,...patch};},fetch,testing:{intervalMs:0,lookup:async()=>['93.184.216.34'],...options}};
  const queue=new EnrichmentQueue(deps);t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dir,{recursive:true,force:true});});return {queue,deps,dir};
}
async function idle(queue) {for(let i=0;i<400;i++){if(!queue.progress.running)return;await new Promise(r=>setTimeout(r,5));}throw new Error('Queue did not finish');}
// Synthetic complete product metadata for pacing assertions; captured files stay untouched.
function syntheticCategoryPage(body){const $=require('cheerio').load(body);$('.market-item-detail-article').append('<div class="item-category"><a href="/en/browse/3D%20Clothing">3D Clothing</a></div>');return $.html();}
function html(body,status=200,headers={}) {return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});}
function product(id,title,author='Shop') {return `<html><head><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:title,brand:{name:author},url:`https://booth.pm/ja/items/${id}`,description:'対応 Airi の衣装',image:'https://booth.pximg.net/cover.png'})}</script></head></html>`;}
test('compact BOOTH metadata fixtures retain product identity and compatibility without inventing own category evidence',()=>{
  const a=parseProduct(cheri,'https://booth.pm/ja/items/8492723');assert.equal(a.author,'LOVACE');assert.equal(a.category,'未分类');assert.equal(a.categoryEvidence,undefined);assert.equal(a.avatars.length,6);assert(!a.avatars.includes('Chocolate'));assert(a.avatars.includes('Airi'));assert.match(a.coverUrl,/8492723/);
  const b=parseProduct(rho,'https://booth.pm/ja/items/8399277');assert.equal(b.category,'未分类');assert.equal(b.categoryEvidence,undefined);assert.equal(b.author,'Binary');assert.equal(b.avatars.length,11);assert(b.avatars.includes('Ramune'));
  assert.equal(candidateScore('CheriMeL@LOVACE_8492723.zip',a),1);assert.equal(candidateScore('BCP-17 Rho [FULLSET].zip',b),1);assert.equal(candidateScore('8492723.zip',a),0);assert.equal(candidateScore('CheriMeL@OTHER.zip',a),0);
  assert.deepEqual(parseSearch(search,'https://booth.pm/ja/search/BCP-17%20Rho').map(p=>p.url),['https://booth.pm/ja/items/8399277']);
});
test('SSRF guards reject non-public protocols, IP literals, credentials, DNS results and spoofed images',()=>{
  for(const u of ['file:///E:/VRChat','http://booth.pm','https://127.0.0.1/','https://[::1]/','https://2130706433/','https://localhost/','https://a.local/','https://u:p@booth.pm/','https://booth.pm:444/','https://booth.pm/users/sign_in'])assert.throws(()=>publicHttpsUrl(u));
  for(const a of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(isPublicAddress(a),false);
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(detectedImageExtension(png),'.png');assert.equal(detectedImageExtension(Buffer.from('<svg>evil</svg>')),undefined);
});
test('number match and title search confirm, cache covers, and preserve all manual/local values',async t=>{
  const items=[asset('a','CheriMeL@LOVACE_8492723.zip'),asset('b','BCP-17 Rho [FULLSET].zip')],calls=[];
  const {queue}=setup(t,items,async url=>{calls.push(url);if(url.includes('/search/'))return html(search);if(url.includes('8492723')&&url.includes('booth.pm'))return html(cheri);if(url.includes('8399277')&&url.includes('booth.pm'))return html(rho);return new Response(png,{headers:{'content-type':'image/png'}});});
  const before=JSON.stringify(items.map(a=>[a.manual,a.localAvatars]));await queue.enqueue();await idle(queue);assert(items.every(a=>a.online.status==='matched'));assert.equal(JSON.stringify(items.map(a=>[a.manual,a.localAvatars])),before);assert.equal(items[0].online.avatars.length,6);assert(items[0].online.coverFile.endsWith('.png'));assert(!calls.some(u=>u.includes('私人')||u.includes('E%3A')));
  const n=calls.length;await queue.enqueue(['a','b'],true);await idle(queue);assert.equal(calls.length,n,'page and cover caches used on refresh');
});
test('a unique ID without a usable name confirms the corresponding official product',async t=>{
  const items=[asset('a','8492723.zip')],{queue}=setup(t,items,async()=>html(cheri));await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'matched');assert.equal(items[0].online.author,'LOVACE');assert.equal(items[0].online.matchEvidence.method,'filename-id');assert.equal(items[0].online.coverFile,undefined);
});
test('two equally named search products are ambiguous and require confirmation',async t=>{
  const result='<div class="item-card"><a class="item-card__title" href="/ja/items/1234567">Moon Dress</a></div><div class="item-card"><a class="item-card__title" href="/ja/items/7654321">Moon Dress</a></div>';
  const items=[asset('a','Moon Dress.zip')],{queue}=setup(t,items,async url=>html(url.includes('/search/')?result:product(url.includes('1234567')?'1234567':'7654321','Moon Dress',url.includes('1234567')?'First':'Second')));
  await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'review');assert.equal(items[0].online.candidates.length,2);
});
test('offline failures can retry; paused pending work survives restart',async t=>{
  const items=[asset('a','CheriMeL@LOVACE_8492723.zip')];let offline=true;
  const {queue,deps}=setup(t,items,async url=>{if(offline)throw new Error('网络不可用');return url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(cheri);});
  await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'failed');queue.pause();offline=false;await queue.enqueue(['a'],true);assert.equal(queue.progress.pending,1);
  const reopened=new EnrichmentQueue(deps);assert.equal(reopened.progress.paused,true);assert.equal(reopened.progress.pending,1);await reopened.resume();await idle(reopened);assert.equal(items[0].online.status,'matched');
});
test('429 Retry-After automatically waits and retries, while 403 stops this site round',async t=>{
  const items=[asset('a','CheriMeL@LOVACE_8492723.zip')];let requests=0;
  const {queue}=setup(t,items,async url=>{requests++;if(requests===1)return html('',429,{'retry-after':'0'});return url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(cheri);});
  await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'matched');assert.equal(requests,4,'page retry, official category search and cover are all counted');
  const blocked=[asset('b','CheriMeL_8492723.zip'),asset('c','Rho_8399277.zip')];let n=0;const other=setup(t,blocked,async()=>{n++;return html('',403);},{intervalMs:20});await other.queue.enqueue();await idle(other.queue);assert.equal(n,1);assert(blocked.every(a=>a.online.status==='blocked'));
  other.deps.fetch=async url=>url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(cheri);await other.queue.enqueue(['b'],true);await idle(other.queue);assert.equal(blocked[0].online.status,'matched','explicit retry starts a fresh site round');
});
test('redirect targets are checked before requesting; private DNS never reaches fetch',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip')];let n=0;const {queue}=setup(t,items,async()=>{n++;return html('',302,{location:'https://127.0.0.1/secret'});});await queue.enqueue();await idle(queue);assert.equal(n,1);assert.equal(items[0].online.status,'failed');
  const privateItems=[asset('b','CheriMeL_8492723.zip')];const other=setup(t,privateItems,async()=>{throw new Error('must not reach fetch');},{lookup:async()=>['192.168.1.1']});await other.queue.enqueue();await idle(other.queue);assert.match(privateItems[0].online.message,/公开网络/);
});
test('MIME spoofing retains confirmed product without accepting unsafe cover',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip')],{queue}=setup(t,items,async url=>url.includes('pximg')?new Response('<html>not an image</html>',{headers:{'content-type':'image/png'}}):html(cheri));await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'matched');assert.equal(items[0].online.coverFile,undefined);assert.match(items[0].online.message,/封面读取失败/);
});
test('strict timeout includes delayed fetch and streaming; concurrent workers have independent timeouts',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip'),asset('b','Rho_8399277.zip')];let active=0,max=0;
  const {queue}=setup(t,items,async(_url,{signal})=>{active++;max=Math.max(max,active);try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,40);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});return html(cheri);}finally{active--; }},{timeoutMs:10});await queue.enqueue();await idle(queue);assert(items.every(a=>a.online.status==='failed'));assert.equal(max,2);
  const timeout=setup(t,[asset('c','CheriMeL_8492723.zip')],async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/html'}}),{timeoutMs:15});await timeout.queue.enqueue();await idle(timeout.queue);assert.match(timeout.deps.get('c').online.message,/超时/);
});
test('production BOOTH pages preserve three-second pacing while a CDN can start independently',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip'),asset('b','Rho_8399277.zip')],times=[];
  const {deps}=setup(t,items,async url=>{times.push({url,at:Date.now()});return url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(syntheticCategoryPage(url.includes('8399277')?rho:cheri));});
  process.env.NODE_ENV='production';const queue=new EnrichmentQueue(deps);process.env.NODE_ENV='test';
  t.after(async()=>{queue.stop();await queue.waitIdle();});await queue.enqueue();for(let i=0;i<1000&&queue.progress.running;i++)await new Promise(r=>setTimeout(r,5));assert.equal(queue.progress.running,false);
  const pages=times.filter(v=>v.url.includes('booth.pm')),covers=times.filter(v=>v.url.includes('pximg'));assert.equal(pages.length,2);assert(pages[1].at-pages[0].at>=2990);assert(covers[0].at-pages[0].at<1000,'separate image host has no BOOTH HTML delay');
});
test('pausing and immediately resuming an in-flight request preserves its pending task',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip')];let start,first=true;
  const started=new Promise(resolve=>start=resolve);
  const {queue}=setup(t,items,async(url,{signal})=>{if(first){first=false;start();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}return url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(cheri);});
  await queue.enqueue();await started;queue.pause();await queue.resume();await idle(queue);assert.equal(items[0].online.status,'matched');
});
test('shutdown preserves pending work without changing the user pause preference',async t=>{
  const items=[asset('a','CheriMeL_8492723.zip')];let start,initial=true;const started=new Promise(resolve=>start=resolve);
  const {queue,deps,dir}=setup(t,items,async(url,{signal})=>{if(initial){initial=false;start();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return url.includes('pximg')?new Response(png,{headers:{'content-type':'image/png'}}):html(cheri);});
  await queue.enqueue();await started;queue.stop();assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'queue.json'))).paused,false);await new Promise(r=>setTimeout(r,15));const next=new EnrichmentQueue(deps);assert.equal(next.progress.pending,1);assert.equal(next.progress.paused,false);await next.resume();await idle(next);assert.equal(items[0].online.status,'matched');
});
test('manual external URL reads metadata only and requires acceptance before assigning cover',async t=>{
  const items=[asset('a','MyAsset.zip')],{queue}=setup(t,items,async url=>url.endsWith('.png')?new Response(png,{headers:{'content-type':'image/png'}}):html('<meta property="og:title" content="Lovely Garment"><meta name="author" content="Artist"><meta property="og:image" content="https://assets.example.org/art.png">'));
  await queue.linkSource('a','https://shop.example.org/product');await idle(queue);assert.equal(items[0].online.status,'review');assert.equal(items[0].online.coverFile,undefined);await queue.acceptCandidate('a','https://shop.example.org/product');await idle(queue);assert.equal(items[0].online.status,'matched');assert.equal(items[0].online.author,'Artist');
});
