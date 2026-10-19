const test=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {ProxyMonitor,proxyRoute}=require('../dist/main/main/proxy');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function response(status=200){return new Response(null,{status});}
function monitor(options={}){const events=[],requests=[],lookups=[];const deps={resolveProxy:async url=>{lookups.push(url);return options.route??'DIRECT';},fetch:async(url,init)=>{requests.push({url,init});return options.fetch?options.fetch(url,init):response(options.httpStatus??200);},onChange:status=>events.push(status),testing:{cooldownMs:0,...options.testing},...options.deps};return {proxy:new ProxyMonitor(deps),events,requests,lookups};}
function completed(fromCache=false,status='complete',bytes=100){return {running:false,paused:false,pending:0,completed:1,current:'',transfer:{url:'https://booth.pm/ja/items/1234567',kind:'page',label:'商品页面',phase:status,receivedBytes:bytes,downloadBps:0,uploadBps:0,uploadBytes:0,elapsedMs:10},recentTransfers:[{url:'https://booth.pm/ja/items/1234567',kind:'page',label:'商品页面',status,receivedBytes:bytes,fromCache,finishedAt:'2026-10-13T09:00:00.000Z'}]};}

test('PAC routes detect direct, HTTP/SOCKS proxies and fallbacks without exposing credentials',()=>{
  assert.deepEqual(proxyRoute('DIRECT'),{mode:'direct',route:'DIRECT',endpoint:undefined});
  assert.deepEqual(proxyRoute('PROXY user:very-secret@127.0.0.1:7890; DIRECT'),{mode:'proxy',route:'PROXY 127.0.0.1:7890 ; DIRECT',endpoint:'127.0.0.1:7890'});
  assert.deepEqual(proxyRoute('SOCKS5 [::1]:1080; PROXY other:8080; DIRECT'),{mode:'proxy',route:'SOCKS5 [::1]:1080 ; PROXY other:8080 ; DIRECT',endpoint:'[::1]:1080'});
  assert.equal(proxyRoute('HTTPS http://user:secret@proxy.example.com:80').endpoint,'proxy.example.com:80');
  assert.equal(proxyRoute('DIRECT; PROXY localhost:8888').mode,'direct');
  for(const raw of ['bad credential=password','PROXY user:secret@','PROXY localhost:0','PROXY host:70000','PROXY host:9999/private?token=secret']){const route=proxyRoute(raw);assert.equal(route.mode,'unknown');assert(!JSON.stringify(route).includes('secret'));}
});

test('inspection reads existing BOOTH proxy selection and does not claim configured proxy is available',async()=>{
  const {proxy,lookups,requests}=monitor({route:'PROXY 127.0.0.1:7890; DIRECT'});const status=await proxy.inspect();
  assert.equal(status.mode,'proxy');assert.equal(status.status,'unchecked');assert.equal(status.endpoint,'127.0.0.1:7890');assert.deepEqual(lookups,['https://booth.pm/']);assert.equal(requests.length,0);
});

test('manual probe uses one small HEAD on current session and treats site restrictions as connected',async()=>{
  for(const code of [200,301,403,429,404]){
    const {proxy,requests}=monitor({route:'SOCKS5 localhost:1080',httpStatus:code});const status=await proxy.check();
    assert.equal(status.mode,'proxy');assert.equal(status.status,'available');assert(status.checkedAt);assert.equal(requests.length,1);assert.equal(requests[0].url,'https://booth.pm/');
    assert.equal(requests[0].init.method,'HEAD');assert.equal(requests[0].init.credentials,'omit');assert.equal(requests[0].init.redirect,'manual');
    if([403,429].includes(code))assert.match(status.message,/访问受限/);
  }
});

test('probes respect thirty-second production cooldown and coalesce concurrent clicks',async()=>{
  const {proxy,requests}=monitor({fetch:async()=>{await wait(20);return response();},testing:{cooldownMs:30000,now:()=>100}});
  await Promise.all([proxy.check(),proxy.check(),proxy.check()]);assert.equal(requests.length,1);await proxy.check();assert.equal(requests.length,1);
  process.env.NODE_ENV='production';const production=monitor({testing:{cooldownMs:0}});process.env.NODE_ENV='test';await production.proxy.check();await production.proxy.check();assert.equal(production.requests.length,1);
});

test('timeout and fetch failure remain uncertain rather than falsely declaring the proxy broken',async()=>{
  const timed=monitor({fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('password=never-echo')), {once:true})),testing:{timeoutMs:20}});
  const status=await timed.proxy.check();assert.equal(status.status,'error');assert.match(status.message,/暂不能判断/);assert(!JSON.stringify(status).includes('never-echo'));
  const failed=monitor({fetch:async()=>{throw new Error('username:secret@proxy');}});assert.equal((await failed.proxy.check()).status,'error');assert(!JSON.stringify(failed.proxy.status).includes('secret'));
});

test('disabled networking aborts active probe and does not perform automatic background polling',async()=>{
  let started;const start=new Promise(resolve=>started=resolve);
  const {proxy,requests,events}=monitor({fetch:async(_url,{signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
  const checking=proxy.check();await start;proxy.setEnabled(false);await checking;assert.equal(proxy.status.status,'disabled');const count=events.length;await wait(40);assert.equal(events.length,count);
  await proxy.check();await proxy.inspect();assert.equal(requests.length,1);proxy.setEnabled(true);assert.equal(proxy.status.status,'unchecked');await wait(40);assert.equal(requests.length,1);
});

test('live downloaded bytes can confirm availability while caches and zero-byte redirects cannot',async()=>{
  const {proxy,events}=monitor({route:'PROXY localhost:7890'});await proxy.inspect();proxy.observeTransfer(completed(true));assert.equal(proxy.status.status,'unchecked');proxy.observeTransfer(completed(false,'complete',0));assert.equal(proxy.status.status,'unchecked');
  const live=completed();proxy.observeTransfer(live);assert.equal(proxy.status.status,'available');const count=events.length;proxy.observeTransfer(live);assert.equal(events.length,count);
  const failed=completed(false,'error',0);failed.recentTransfers[0].finishedAt='2026-10-13T09:00:01.000Z';proxy.observeTransfer(failed);assert.equal(proxy.status.status,'error');assert.match(proxy.status.message,/不能据此判断代理失联/);
  proxy.setEnabled(false);proxy.observeTransfer(live);assert.equal(proxy.status.status,'disabled');
});

test('malformed or unreadable proxy config never leaks secret source strings',async()=>{
  const {proxy}=monitor({deps:{resolveProxy:async()=>{throw new Error('PROXY alice:secret@server:7890');}}});const status=await proxy.inspect();assert.equal(status.mode,'unknown');assert.equal(status.status,'error');assert(!JSON.stringify(status).includes('secret'));
});

test('successful live download during a failed independent HEAD probe preserves available evidence',async()=>{
  let started,rejectHead;const start=new Promise(resolve=>started=resolve);
  const {proxy}=monitor({fetch:async()=>{started();return new Promise((_resolve,reject)=>rejectHead=reject);}});
  const check=proxy.check();await start;assert.equal(proxy.status.status,'checking');proxy.observeTransfer(completed());
  rejectHead(new Error('HEAD route timed out'));const result=await check;
  assert.equal(result.status,'available');assert.match(result.message,/实际商品下载成功，独立连接检测未成功/);assert.equal(proxy.status.status,'available');
});

test('cache use during a failed independent probe supplies no live connectivity evidence',async()=>{
  let started,rejectHead;const start=new Promise(resolve=>started=resolve);
  const {proxy}=monitor({fetch:async()=>{started();return new Promise((_resolve,reject)=>rejectHead=reject);}});
  const check=proxy.check();await start;proxy.observeTransfer(completed(true));rejectHead(new Error('HEAD failed'));assert.equal((await check).status,'error');
});
