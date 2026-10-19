const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
process.env.NODE_ENV='test';
const {EnrichmentQueue}=require('../dist/main/main/online');
const {TransferMeter}=require('../dist/main/main/transfer');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function asset(id='a',name='Moon Dress_1234567.zip'){return {id,name,path:`E:\\VRChat\\${name}`,group:'Airi',kind:'archive',missing:false,size:10,mtimeMs:0,localCategory:'服装',localAvatars:['Airi'],hintUrls:[],manual:{},online:{status:'pending'},createdAt:'',updatedAt:''};}
function product(cover=false){return `<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Moon Dress',url:'https://booth.pm/ja/items/1234567',brand:{name:'Shop'},description:'Airi 対応衣装',...(cover?{image:'https://booth.pximg.net/cover.png'}:{})})}</script><div class="market-item-detail-article"><div class="item-category"><a href="/en/browse/3D%20Clothing">3D Clothing</a></div></div>`;}
function html(body,headers={},status=200){return new Response(body,{status,headers:{'content-type':'text/html',...headers}});}
function streaming(body,delays,headers={}){
  const bytes=Buffer.from(body);let index=0,cancelled=false;
  const pieces=delays.map((_delay,i)=>bytes.subarray(Math.floor(i*bytes.length/delays.length),Math.floor((i+1)*bytes.length/delays.length)));
  return new Response(new ReadableStream({async pull(controller){const i=index++;if(i===pieces.length){controller.close();return;}await wait(delays[i]);if(!cancelled)controller.enqueue(pieces[i]);},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html',...headers}});
}
function setup(t,fetch,items=[asset()],testing={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-transfer-')),events=[];
  const deps={dataDir,roots:()=>['E:\\VRChat'],all:()=>items,get:id=>items.find(item=>item.id===id)||null,updateOnline:(id,patch)=>{const item=items.find(item=>item.id===id);item.online={...item.online,...patch};},fetch,onProgress:progress=>events.push(progress),testing:{intervalMs:0,lookup:async()=>['93.184.216.34'],...testing}};
  const queue=new EnrichmentQueue(deps);t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dataDir,{recursive:true,force:true});});return {queue,deps,items,events};
}
async function idle(queue){for(let i=0;i<500;i++){if(!queue.progress.running)return;await wait(10);}throw new Error('联网任务未结束');}

test('meter measures real body bytes over a monotonic one-second window, never inventing uploads',()=>{
  let now=0;const meter=new TransferMeter('https://booth.pm/ja/items/1234567','page','商品页面','connecting',()=>now);
  assert.equal(meter.snapshot().downloadBps,0);meter.setPhase('downloading');now=250;meter.received(100);
  assert.equal(meter.snapshot().receivedBytes,100);assert.equal(meter.snapshot().downloadBps,400);
  now=750;meter.received(200);assert.equal(meter.snapshot().downloadBps,400);
  now=1100;assert.equal(meter.snapshot().downloadBps,300);now=1800;assert.equal(meter.snapshot().downloadBps,0);
  assert.equal(meter.snapshot().elapsedMs,1800);assert.equal(meter.snapshot().uploadBytes,0);assert.equal(meter.snapshot().uploadBps,0);
  meter.setPhase('complete');assert.equal(meter.snapshot().downloadBps,0);meter.setPhase('waiting');assert.equal(meter.snapshot().downloadBps,0);
});

test('only honest uncompressed Content-Length becomes a progress total',()=>{
  for(const [headers,total] of [[{'content-length':'123'},123],[{'content-length':'123','content-encoding':'identity'},123],[{'content-length':'123','content-encoding':'gzip'},undefined],[{'content-length':'-1'},undefined],[{'content-length':'abc'},undefined],[{'content-length':'9007199254740992'},undefined]]){
    const meter=new TransferMeter('https://booth.pm/','page','page');meter.setTotal(new Headers(headers));assert.equal(meter.snapshot().totalBytes,total);
  }
});

test('sub-millisecond average uses measured duration and never fabricates a nonzero duration',()=>{
  let now=0;const meter=new TransferMeter('https://booth.pm/','page','页面','connecting',()=>now);meter.startRequest();meter.setPhase('downloading');meter.received(20);
  assert.deepEqual(meter.completedMetrics(),{durationMs:0,downloadBps:undefined});assert.equal(meter.snapshot().downloadBps,0);
  now=0.25;meter.received(80);assert.deepEqual(meter.completedMetrics(),{durationMs:0.25,downloadBps:400000});assert.equal(meter.snapshot().downloadBps,400000);
});

test('history request average excludes queue waiting and includes response-header delay',()=>{
  let now=0;const meter=new TransferMeter('https://booth.pm/','page','商品页','waiting',()=>now);
  now=3000;meter.setPhase('connecting');now=3005;meter.startRequest();
  now=3405;meter.setPhase('downloading');now=3410;meter.received(1000);
  const metrics=meter.completedMetrics();assert.equal(metrics.durationMs,405);assert.equal(metrics.downloadBps,Math.round(1000/(405/1000)));
  assert.equal(meter.snapshot().elapsedMs,3410,'overall state elapsed still shows the true wait plus request');
});

test('fast one-chunk downloads emit a positive sample and retain an honest average after completion',async t=>{
  const body=product(true);const {queue,events}=setup(t,async url=>url.endsWith('.png')?new Response(png,{headers:{'content-type':'image/png'}}):html(body));
  await queue.enqueue();await idle(queue);
  for(const kind of ['page','cover'])assert(events.some(event=>event.transfer?.kind===kind&&event.transfer.phase==='downloading'&&event.transfer.downloadBps>0&&event.transfer.receivedBytes>0),`${kind} emits nonzero speed even when done before a 250ms tick`);
  assert(queue.progress.recentTransfers.every(value=>value.downloadBps>0&&value.durationMs>0&&value.durationMs<250));
  for(const value of queue.progress.recentTransfers)assert.equal(value.downloadBps,Math.round(value.receivedBytes/(value.durationMs/1000)));
  assert.equal(queue.progress.transfer.downloadBps,0,'current speed after completion remains zero');
});

test('delayed streamed pages and covers emit speeds, real links and byte totals then return to zero',async t=>{
  const body=product(true),size=Buffer.byteLength(body);
  const {queue,events,items}=setup(t,async url=>url.endsWith('.png')?streaming(png,[30,370],{'content-type':'image/png','content-length':String(png.length)}):streaming(body,[10,380,380],{'content-length':String(size)}));
  await queue.enqueue();await idle(queue);assert.equal(items[0].online.status,'matched');
  const pageEvents=events.map(event=>event.transfer).filter(value=>value?.kind==='page');
  assert(pageEvents.some(value=>value.phase==='connecting'&&value.receivedBytes===0));
  assert(pageEvents.some(value=>value.phase==='downloading'&&value.receivedBytes>0&&value.receivedBytes<size&&value.downloadBps>0));
  assert(pageEvents.some(value=>value.totalBytes===size));assert(events.every(event=>!event.transfer||event.transfer.uploadBytes===0&&event.transfer.uploadBps===0));
  assert.equal(queue.progress.transfer.downloadBps,0);assert.equal(queue.progress.transfer.kind,'cover');assert.equal(queue.progress.transfer.url,'https://booth.pximg.net/cover.png');
  assert.equal(queue.progress.transfer.receivedBytes,png.length);assert.equal(queue.progress.transfer.phase,'complete');
  assert.equal(queue.progress.recentTransfers.length,2);assert.equal(queue.progress.recentTransfers[1].receivedBytes,size);assert(queue.progress.recentTransfers.every(value=>value.status==='complete'&&!value.fromCache));
});

test('search, redirected final URL, compressed responses and caches are distinguished',async t=>{
  const search='<div class="item-card"><a class="item-card__title" href="/ja/items/1234567">Moon Dress</a></div>';let calls=0;
  const {queue,events}=setup(t,async url=>{calls++;if(url.includes('/search/'))return html(search,{'content-length':'10','content-encoding':'gzip'});if(url==='https://booth.pm/ja/items/1234567')return html('',{location:'https://myshop.booth.pm/items/1234567'},302);return html(product(true),{'content-length':String(Buffer.byteLength(product(true)))});},[asset('a','Moon Dress.zip')]);
  // A deliberately malformed image URL response tests the cover error while the product stays useful.
  await queue.enqueue();await idle(queue);
  assert(events.some(event=>event.transfer?.kind==='search'&&event.transfer.phase==='downloading'&&event.transfer.totalBytes===undefined));
  assert(queue.progress.recentTransfers.some(value=>value.kind==='page'&&value.url==='https://myshop.booth.pm/items/1234567'));
  const requests=calls;await queue.enqueue(['a'],true);await idle(queue);
  assert.equal(calls,requests+1,'cached search and redirected page are reused; invalid cover is retried');
  assert(events.some(event=>event.transfer?.phase==='cache'&&event.transfer.downloadBps===0));
  assert(queue.progress.recentTransfers.some(value=>value.fromCache));assert(queue.progress.recentTransfers.length<=100);
});

test('cover cache reads show cache byte counts with zero speed and bounded recent history',async t=>{
  let calls=0;const {queue}=setup(t,async url=>{calls++;return url.endsWith('.png')?new Response(png,{headers:{'content-type':'image/png'}}):html(product(true));});
  await queue.enqueue();await idle(queue);const originalCalls=calls;
  for(let i=0;i<6;i++){await queue.enqueue(['a'],true);await idle(queue);}
  assert.equal(calls,originalCalls);assert.equal(queue.progress.transfer.phase,'cache');assert.equal(queue.progress.transfer.receivedBytes,png.length);
  assert.equal(queue.progress.transfer.downloadBps,0);assert.equal(queue.progress.recentTransfers.length,14);assert(queue.progress.recentTransfers.slice(0,12).every(value=>value.fromCache));
});

test('unsupported MIME and spoofed cover signatures are errors with honest received byte counts',async t=>{
  const bad=Buffer.from('<html>not an image</html>');
  const first=setup(t,async url=>url.endsWith('.png')?new Response(bad,{headers:{'content-type':'image/png'}}):html(product(true)));
  await first.queue.enqueue();await idle(first.queue);assert.equal(first.items[0].online.status,'matched');assert.equal(first.queue.progress.transfer.phase,'error');
  assert.equal(first.queue.progress.recentTransfers[0].receivedBytes,bad.length);assert.equal(first.queue.progress.recentTransfers[0].status,'error');
  const second=setup(t,async()=>new Response(bad,{headers:{'content-type':'application/octet-stream'}}));
  await second.queue.enqueue();await idle(second.queue);assert.equal(second.queue.progress.transfer.receivedBytes,0);assert.equal(second.queue.progress.transfer.downloadBps,0);assert.equal(second.queue.progress.recentTransfers[0].status,'error');
});

test('pause stops heartbeats immediately and restart resumes persisted work without fake throughput',async t=>{
  let started,first=true;const start=new Promise(resolve=>started=resolve);
  const {queue,deps,events,items}=setup(t,async()=>{if(first){first=false;started();return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/html'}});}return html(product());});
  await queue.enqueue();await start;await wait(20);queue.pause();await wait(20);
  const count=events.length;assert.equal(queue.progress.transfer.phase,'waiting');assert.equal(queue.progress.transfer.downloadBps,0);await wait(350);assert.equal(events.length,count,'paused queue has no transfer interval');
  const next=new EnrichmentQueue(deps);t.after(()=>next.stop());assert.equal(next.progress.paused,true);assert.equal(next.progress.pending,1);
  await next.resume();await idle(next);assert.equal(items[0].online.status,'matched');assert.equal(next.progress.transfer.phase,'complete');assert.equal(next.progress.transfer.uploadBps,0);
});

test('slow streams produce zero throughput heartbeats and timeouts stop all timers',async t=>{
  const {queue,events}=setup(t,async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/html'}}),[asset()],{timeoutMs:680});
  await queue.enqueue();await idle(queue);assert(events.filter(event=>event.transfer?.phase==='downloading'&&event.transfer.elapsedMs>250&&event.transfer.downloadBps===0).length>=2);
  assert.equal(queue.progress.transfer.phase,'error');assert.equal(queue.progress.transfer.downloadBps,0);const count=events.length;await wait(350);assert.equal(events.length,count);
});

test('waitIdle finishes the final persisted queue save before data-directory migration',async t=>{
  let started;const start=new Promise(resolve=>started=resolve);
  const {queue,deps}=setup(t,async()=>{started();return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/html'}});});
  await queue.enqueue();await start;await wait(10);queue.stop();await queue.waitIdle();
  assert.equal(queue.progress.running,false);assert.equal(queue.progress.pending,1);
  const statePath=path.join(deps.dataDir,'queue.json'),before=fs.readFileSync(statePath,'utf8');
  assert.equal(JSON.parse(before).tasks.length,1);assert.equal(JSON.parse(before).paused,false);
  await wait(50);assert.equal(fs.readFileSync(statePath,'utf8'),before,'worker makes no later data-dir write');
});
