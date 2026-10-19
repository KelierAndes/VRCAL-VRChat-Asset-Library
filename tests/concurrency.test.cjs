const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
process.env.NODE_ENV='test';
const {EnrichmentQueue}=require('../dist/main/main/online');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function asset(id,title='Moon Dress',item='1234567',url){return {id,name:title+(url?'':'_'+item)+'.zip',path:'E:\\VRChat\\'+id+'.zip',group:'Airi',kind:'archive',missing:false,size:10,mtimeMs:0,localCategory:'服装',localAvatars:['Airi'],hintUrls:url?[url]:[],manual:{},online:{status:'pending'},createdAt:'',updatedAt:''};}
const html=(body,status=200,headers={})=>new Response(body,{status,headers:{'content-type':'text/html',...headers}});
const product=(url,title='Moon Dress',cover)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,name:title,description:'Airi 対応衣装',...(cover?{image:cover}:{})})+'</script><div class="market-item-detail-article"><div class="item-category"><a href="/en/browse/3D%20Clothing">3D Clothing</a></div></div>';
function setup(t,items,fetch,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-concurrent-')),events=[],queues=[];
  const deps={dataDir,roots:()=>['E:\\VRChat'],all:()=>items,get:id=>items.find(a=>a.id===id)||null,updateOnline:(id,patch)=>{const item=items.find(a=>a.id===id);if(item)item.online={...item.online,...patch};},fetch,onProgress:progress=>events.push(progress),concurrency:()=>options.concurrency??3,testing:{intervalMs:0,lookup:async()=>['93.184.216.34'],...options}};
  const create=()=>{const queue=new EnrichmentQueue(deps);queues.push(queue);return queue;};const queue=create();
  t.after(async()=>{for(const q of queues){q.stop();await q.waitIdle();}fs.rmSync(dataDir,{recursive:true,force:true});});return {queue,deps,events,items,create};
}
async function until(predicate,label='条件未达到'){for(let i=0;i<600;i++){if(predicate())return;await wait(5);}throw new Error(label);}
async function idle(queue){await until(()=>!queue.progress.running,'队列未结束');await queue.waitIdle();}
async function delayFetch(ms,signal){await new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}

test('default pool overlaps three independent hosts and records distinct physical transfers',async t=>{
  const items=Array.from({length:5},(_,i)=>asset('a'+i,'Dress '+i,String(1234500+i),'https://shop'+i+'.example.org/product'));let active=0,max=0;
  const {queue,events}=setup(t,items,async(url,{signal})=>{active++;max=Math.max(max,active);try{await delayFetch(50,signal);return html(product(url));}finally{active--;}});
  await queue.enqueue();await idle(queue);assert.equal(max,3);assert.equal(queue.progress.completed,5);assert.equal(queue.progress.concurrency,3);assert.equal(queue.progress.pending,0);
  assert(events.some(p=>p.activeTasks===3&&p.activeTransfers.length===3));assert.equal(new Set(queue.progress.recentTransfers.map(v=>v.id)).size,5);assert.equal(queue.progress.totalDownloadBps,0);assert.equal(queue.progress.totalUploadBps,0);
});

test('all BOOTH shops and BOOTH-hosted images share the same start gate, separate CDN requests overlap',async t=>{
  const items=[asset('a'),asset('b','Star Dress','7654321')],calls=[];
  const {queue}=setup(t,items,async(url,{signal})=>{calls.push({url,at:Date.now()});if(url.includes('/cover')){await delayFetch(80,signal);return new Response(png,{headers:{'content-type':'image/png'}});}const isMoon=url.includes('1234567');return html(product(url,isMoon?'Moon Dress':'Star Dress',isMoon?'https://shop.booth.pm/cover.png':'https://cdn.example.org/cover.png'));},{intervalMs:30});
  await queue.enqueue();await idle(queue);
  const booth=calls.filter(c=>new URL(c.url).hostname.endsWith('booth.pm'));assert.equal(booth.length,3);for(let i=1;i<booth.length;i++)assert(booth[i].at-booth[i-1].at>=29);
  assert(items.every(a=>a.online.status==='matched'));assert(calls.some(c=>c.url.includes('cdn.example.org')));
});

test('production same-CDN image requests have a 200ms start gate and do not inherit HTML three seconds',async t=>{
  const items=[asset('a'),asset('b')];for(let i=0;i<items.length;i++)items[i].online={status:'review',url:'https://shop'+i+'.example.org/product'};
  const calls=[],{deps,queue:unused}=setup(t,items,async(url,{signal})=>{calls.push({url,at:Date.now()});if(url.includes('cdn.')){await delayFetch(300,signal);return new Response(png,{headers:{'content-type':'image/png'}});}return html(product(url,'Moon Dress','https://cdn.example.org/'+new URL(url).hostname+'.png'));});
  unused.stop();process.env.NODE_ENV='production';const queue=new EnrichmentQueue(deps);process.env.NODE_ENV='test';t.after(async()=>{queue.stop();await queue.waitIdle();});
  await Promise.all(items.map(a=>queue.acceptCandidate(a.id,a.online.url)));await idle(queue);
  const images=calls.filter(c=>c.url.includes('cdn.'));assert.equal(images.length,2);assert(images[1].at-images[0].at>=190);assert(images[1].at-images[0].at<1500);
});

test('two consumers reuse one URL fetch and shared cover bytes are counted once',async t=>{
  const items=[asset('a'),asset('b')],counts=new Map();const page=product('https://booth.pm/ja/items/1234567','Moon Dress','https://cdn.example.org/cover.png');
  const {queue}=setup(t,items,async(url,{signal})=>{counts.set(url,(counts.get(url)||0)+1);await delayFetch(30,signal);return url.includes('cdn.')?new Response(png,{headers:{'content-type':'image/png'}}):html(page);});
  await queue.enqueue();await idle(queue);assert.equal([...counts.values()].reduce((a,b)=>a+b),2);assert(items.every(a=>a.online.status==='matched'));assert.equal(queue.progress.recentTransfers.length,2);assert.equal(queue.progress.downloadedBytes,Buffer.byteLength(page)+png.length);
});

test('replacing an owner does not cancel another consumer and invalid shared content marks physical history error',async t=>{
  const items=[asset('a'),asset('b')];let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);const calls=[];
  const {queue}=setup(t,items,async url=>{if(url.includes('booth.pm')){calls.push(url);started();await gate;return html('<title>Not a product</title>');}return html(product(url,'New source'));});
  await queue.enqueue();await began;await until(()=>queue.progress.activeTasks===2);await wait(5);await queue.linkSource('a','https://shop.example.org/new');release();await idle(queue);
  assert.equal(calls.filter(url=>url.includes('/items/')).length,1,'shared item fetch remains one physical request');assert.equal(calls.filter(url=>url.includes('/search/')).length,1,'unavailable item permits the remaining consumer to search by name');assert.equal(items[0].online.status,'review');assert.equal(items[0].online.candidates[0].title,'New source');assert.equal(items[1].online.status,'not-found');assert.equal(queue.progress.recentTransfers.find(v=>v.url.includes('/items/')).status,'error');
});

test('429 cooldown is shared across BOOTH shops, permits unrelated hosts and survives shutdown/restart',async t=>{
  const items=[asset('a'),asset('b','Star Dress','7654321'),asset('c','Other Dress','9876543','https://shop.example.org/product')],calls=[];let first=true;
  const {queue,create,deps}=setup(t,items,async url=>{calls.push({url,at:Date.now()});if(url.includes('booth.pm')&&first){first=false;return html('',429,{'retry-after':'1'});}return html(product(url,url.includes('7654321')?'Star Dress':'Moon Dress'));},{intervalMs:20});
  await queue.enqueue();await until(()=>items[2].online.status==='review');assert.equal(calls.filter(c=>c.url.includes('booth.pm')).length,1);
  queue.stop();await queue.waitIdle();const saved=JSON.parse(fs.readFileSync(path.join(deps.dataDir,'queue.json'),'utf8'));assert(saved.hosts['booth.pm'].cooldown>Date.now());assert.equal(saved.tasks.length,2);
  const next=create();await next.resume();await wait(80);assert.equal(calls.filter(c=>c.url.includes('booth.pm')).length,1,'no other BOOTH task bypasses saved cooldown');await idle(next);assert(items.slice(0,2).every(a=>a.online.status==='matched'));
  const boothCalls=calls.filter(c=>c.url.includes('booth.pm'));assert(boothCalls[1].at-boothCalls[0].at>=980);
});

test('401/403 blocks queued same-site work while another host remains usable',async t=>{
  const items=[asset('a'),asset('b','Star Dress','7654321'),asset('c','Other','9876543','https://shop.example.org/product')];let boothRequests=0;
  const {queue}=setup(t,items,async url=>{if(url.includes('booth.pm')){boothRequests++;return html('',403);}return html(product(url));},{intervalMs:25});
  await queue.enqueue();await idle(queue);assert.equal(boothRequests,1);assert(items.slice(0,2).every(a=>a.online.status==='blocked'));assert.equal(items[2].online.status,'review');
});

test('pause and immediate resume restores all concurrent tasks exactly once without lost jobs',async t=>{
  const items=Array.from({length:5},(_,i)=>asset('a'+i,'Dress'+i,String(1234500+i)));let hold=true,started=0;
  const {queue}=setup(t,items,async(url,{signal})=>{started++;if(hold)await delayFetch(1000,signal);const id=url.match(/(\d{7})/)[1];return html(product(url,'Dress'+(Number(id)-1234500)));});
  await queue.enqueue();await until(()=>started===3);hold=false;queue.pause();await queue.resume();await idle(queue);
  assert(items.every(a=>a.online.status==='matched'));assert.equal(queue.progress.completed,5);assert.equal(queue.progress.pending,0);assert.equal(started,8);
});

test('stop awaits every request and final save, then a new queue restores every active and pending task',async t=>{
  const items=Array.from({length:5},(_,i)=>asset('a'+i,'Dress'+i,String(1234500+i)));let hold=true,started=0;
  const {queue,create,deps}=setup(t,items,async(url,{signal})=>{started++;if(hold)await delayFetch(1000,signal);const id=url.match(/(\d{7})/)[1];return html(product(url,'Dress'+(Number(id)-1234500)));});
  await queue.enqueue();await until(()=>started===3);queue.stop();await queue.waitIdle();const statePath=path.join(deps.dataDir,'queue.json'),before=fs.readFileSync(statePath,'utf8');
  const saved=JSON.parse(before);assert.equal(saved.tasks.length,5);assert.equal(new Set(saved.tasks.map(t=>t.id)).size,5);assert.equal(saved.activeTasks.length,0);assert.equal(saved.paused,false);await wait(60);assert.equal(fs.readFileSync(statePath,'utf8'),before);
  hold=false;const next=create();await next.resume();await idle(next);assert.equal(next.progress.completed,5);assert(items.every(a=>a.online.status==='matched'));
});

test('changing concurrency adds workers immediately and reducing it lets active work finish safely',async t=>{
  const items=Array.from({length:6},(_,i)=>asset('a'+i,'Dress'+i,String(1234500+i),'https://shop'+i+'.example.org/product'));let active=0,max=0,started=0,afterDrop=[];
  const {queue}=setup(t,items,async(url,{signal})=>{active++;started++;max=Math.max(max,active);if(started>3)afterDrop.push(active);try{await delayFetch(60,signal);return html(product(url));}finally{active--; }},{concurrency:1});
  await queue.enqueue();await until(()=>started===1);queue.setConcurrency(3);await until(()=>started===3);queue.setConcurrency(1);await idle(queue);
  assert.equal(max,3);assert.deepEqual(afterDrop,[1,1,1]);assert.equal(queue.progress.concurrency,1);assert.equal(queue.progress.completed,6);
});

test('a timeout is isolated to its worker and does not abort a successful independent host',async t=>{
  const items=[asset('a','Slow','1234500','https://slow.example.org/product'),asset('b','Fast','1234501','https://fast.example.org/product')];
  const {queue}=setup(t,items,async(url,{signal})=>{if(url.includes('slow.'))await delayFetch(1000,signal);return html(product(url));},{timeoutMs:20});
  await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'failed');assert.match(items[0].online.message,/超时/);assert.equal(items[1].online.status,'review');
});

test('real-byte chart freezes after an idle zero tail; cache traffic and reload do not erase its peaks',async t=>{
  const items=[asset('a')],body=product('https://booth.pm/ja/items/1234567');let calls=0;
  const {queue,create}=setup(t,items,async()=>{calls++;return html(body);});await queue.enqueue();await idle(queue);const bytes=queue.progress.downloadedBytes,peak=queue.progress.peakDownloadBps;
  assert.equal(bytes,Buffer.byteLength(body));assert(peak>0);assert(queue.progress.speedHistory.some(s=>s.downloadBps>0));await wait(2400);
  const frozen=JSON.stringify(queue.progress.speedHistory);await wait(450);assert.equal(JSON.stringify(queue.progress.speedHistory),frozen);assert.equal(queue.progress.totalDownloadBps,0);
  const next=create();assert.equal(next.progress.transfer,undefined,'restored history is not fresh proxy connectivity evidence');assert.equal(JSON.stringify(next.progress.speedHistory),frozen);assert.equal(next.progress.peakDownloadBps,peak);await next.enqueue(['a'],true);await idle(next);assert.equal(calls,1);assert.equal(next.progress.downloadedBytes,bytes);
});

test('history older than a minute reloads relative to its saved window and recent records remain bounded at 100',async t=>{
  const {queue,create,deps}=setup(t,[asset('a')],async()=>html(product('https://booth.pm/ja/items/1234567')));queue.stop();await queue.waitIdle();
  const last=Date.now()-120000,history=Array.from({length:150},(_,i)=>({id:'t'+i,url:'https://booth.pm/ja/items/1234567',kind:'page',label:'商品页',receivedBytes:10,fromCache:false,finishedAt:new Date(last-i).toISOString(),status:'complete',durationMs:2,downloadBps:5000}));
  fs.writeFileSync(path.join(deps.dataDir,'queue.json'),JSON.stringify({tasks:[],paused:true,completed:1,recentDownloads:history,speedHistory:[{at:last-61000,downloadBps:1,uploadBps:0},{at:last-1000,downloadBps:20,uploadBps:0},{at:last,downloadBps:0,uploadBps:0}],downloadedBytes:500,peakDownloadBps:5000}));
  const next=create();assert.equal(next.progress.recentTransfers.length,100);assert.deepEqual(next.progress.speedHistory.map(s=>s.downloadBps),[20,0]);assert.equal(next.progress.downloadedBytes,500);assert.equal(next.progress.peakDownloadBps,5000);assert.equal(next.progress.transfer,undefined);assert.equal(next.progress.totalDownloadBps,0);
});
