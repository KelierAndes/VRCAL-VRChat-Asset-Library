const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Sponsors,parseSponsors,SPONSORS_URL}=require('../dist/main/main/sponsors');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=','base64');
const doc=(sponsors=[{id:'alice',name:'支持者 アリス 🐾',links:[{label:'GitHub',url:'https://github.com/example'}]}])=>({schemaVersion:1,updatedAt:'2026-10-22T00:00:00Z',sponsors});
function fixture(t,fetch,extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrcal-sponsors-'));let enabled=true,clock=1000000;const s=new Sponsors({dataDir:dir,roots:()=>[],fetch,canNetwork:()=>enabled,now:()=>clock,...extra});t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true})});return {s,dir,disable(){enabled=false;s.networkChanged()},enable(){enabled=true},tick(ms=300001){clock+=ms}}}
const json=(value=doc(),headers={})=>new Response(JSON.stringify(value),{headers:{'content-type':'text/plain; charset=utf-8',etag:'"one"',...headers}});
test('feed validates Unicode, stable ordering and anonymous privacy; unknown schema and duplicate IDs fail',()=>{
 const d=parseSponsors(doc([{id:'b',name:'B',order:2},{id:'anon',anonymous:true,name:'Secret',note:'Secret note',avatar:'avatars/a.png',links:[{label:'Secret',url:'https://example.com'}],order:0},{id:'a',name:'日本語 中文 🐾',order:1}]));
 assert.deepEqual(d.sponsors.map(x=>x.id),['anon','a','b']);assert.equal(d.sponsors[0].name,undefined);assert.equal(d.sponsors[0].avatar,undefined);assert.equal(d.sponsors[0].note,undefined);assert.deepEqual(d.sponsors[0].links,[]);
 for(const value of [{...doc(),schemaVersion:2},doc([{id:'x',name:'A'},{id:'x',name:'B'}]),doc([{id:'a',name:'A',avatar:'../secret.png'}]),doc([{id:'a',name:'A',links:[{label:'x',url:'javascript:alert(1)'}]}]),doc([{id:'a',name:'A',links:[{label:'x',url:'https://user:pass@example.com'}]}])])assert.throws(()=>parseSponsors(value));
});
test('fetch uses fixed public URL, no credentials, persists across restart and does not refetch fresh cache',async t=>{
 const calls=[];const f=fixture(t,async(url,init)=>{calls.push({url,init});return json()});
 assert.equal(f.s.snapshot().sponsors.length,0);const state=await f.s.refresh();assert.equal(state.status,'fresh');assert.equal(state.sponsors[0].name,'支持者 アリス 🐾');
 assert.equal(calls[0].url,SPONSORS_URL);assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.redirect,'manual');assert(!calls[0].init.headers.Authorization);await f.s.refresh();assert.equal(calls.length,1);
 const reopened=new Sponsors({dataDir:f.dir,roots:()=>[],canNetwork:()=>false,fetch:()=>assert.fail('offline fetch')});t.after(()=>reopened.close());assert.equal(reopened.snapshot().sponsors[0].id,'alice');assert.equal((await reopened.refresh()).status,'offline');
 assert.equal(reopened.link('alice',0),'https://github.com/example');for(const args of [['https://evil.com',0],['alice',1],['alice','0'],['__proto__',0]])assert.throws(()=>reopened.link(...args));
});
test('304 reuses a validated cache and sends ETag; a valid empty list removes old entries',async t=>{
 let step=0;const f=fixture(t,async(_url,init)=>{if(step++===0)return json();if(step===2){assert.equal(init.headers['If-None-Match'],'"one"');return new Response(null,{status:304})}return json(doc([]))});
 await f.s.refresh();f.tick();assert.equal((await f.s.refresh()).sponsors.length,1);f.tick();assert.deepEqual((await f.s.refresh()).sponsors,[]);
});
test('malformed JSON, HTML, redirects, HTTP errors and oversized streams preserve last valid cache',async t=>{
 let response;const f=fixture(t,async()=>response||json());await f.s.refresh();
 const bad=[new Response('{bad'),new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),new Response(null,{status:302,headers:{location:'https://example.com'}}),new Response('limited',{status:429}),new Response('x'.repeat(300000)),json({...doc(),schemaVersion:3})];
 for(response of bad){f.tick();const state=await f.s.refresh();assert.equal(state.status,'error');assert.equal(state.sponsors[0].id,'alice')}
});
test('disabled networking makes no requests; disabling in flight blocks late writes',async t=>{
 let resolve,calls=0;const f=fixture(t,()=>{calls++;return new Promise(r=>resolve=r)});const task=f.s.refresh();f.disable();resolve(json());await task;assert.equal(f.s.snapshot().status,'offline');assert.equal(f.s.snapshot().sponsors.length,0);assert(!fs.existsSync(path.join(f.dir,'cache/community-sponsors.json')));await f.s.refresh(true);assert.equal(calls,1);
});
test('simultaneous refreshes share one request and forced refresh has a ten-second floor',async t=>{
 let resolve,calls=0;const f=fixture(t,()=>{calls++;return new Promise(r=>resolve=r)});const a=f.s.refresh(),b=f.s.refresh(true);resolve(json());await Promise.all([a,b]);assert.equal(calls,1);await f.s.refresh(true);assert.equal(calls,1);
});
test('a five-minute scheduled refresh is not skipped because the initial response completed later',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;if(calls===1)f.tick(250);return json()});await f.s.refresh();f.tick(299750);await f.s.refresh(true);assert.equal(calls,2);
});
test('avatars load in background from the fixed repository and remain available offline after restart',async t=>{
 let resolveAvatar;const f=fixture(t,async(url)=>url===SPONSORS_URL?json(doc([{id:'a',name:'A',avatar:'avatars/a.png'}])):new Promise(r=>resolveAvatar=r));
 const state=await f.s.refresh();assert.equal(state.sponsors[0].avatarFile,undefined);assert(resolveAvatar);resolveAvatar(new Response(png,{headers:{'content-type':'image/png'}}));
 for(let i=0;i<30&&!f.s.snapshot().sponsors[0].avatarFile;i++)await new Promise(r=>setTimeout(r,10));
 const file=f.s.snapshot().sponsors[0].avatarFile;assert(file);assert(fs.existsSync(path.join(f.dir,'cache',file)));
 const reopened=new Sponsors({dataDir:f.dir,roots:()=>[],canNetwork:()=>false,fetch:()=>assert.fail('offline avatar')});t.after(()=>reopened.close());assert.equal(reopened.snapshot().sponsors[0].avatarFile,file);
});
test('corrupt caches are ignored and protected source roots cannot be written',async t=>{
 const f=fixture(t,async()=>json());fs.mkdirSync(path.join(f.dir,'cache'));fs.writeFileSync(path.join(f.dir,'cache/community-sponsors.json'),'broken');
 const s=new Sponsors({dataDir:f.dir,roots:()=>[f.dir],canNetwork:()=>true,fetch:async()=>json()});t.after(()=>s.close());const state=await s.refresh();assert.equal(state.status,'error');assert.equal(fs.readFileSync(path.join(f.dir,'cache/community-sponsors.json'),'utf8'),'broken');
});
test('directory links in cache cannot read or overwrite files outside the selected library',async t=>{
 const f=fixture(t,async()=>json()),outside=fs.mkdtempSync(path.join(os.tmpdir(),'vrcal-sponsors-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.writeFileSync(path.join(outside,'community-sponsors.json'),'KEEP');fs.symlinkSync(outside,path.join(f.dir,'cache'),process.platform==='win32'?'junction':'dir');
 assert.equal(f.s.snapshot().sponsors.length,0);assert.equal((await f.s.refresh()).status,'error');assert.equal(fs.readFileSync(path.join(outside,'community-sponsors.json'),'utf8'),'KEEP');fs.unlinkSync(path.join(f.dir,'cache'));
});
test('cache and avatars follow selected-library migration without needing network access',async t=>{
 const {copyLibraryData}=require('../dist/main/main/storage');const f=fixture(t,async url=>url===SPONSORS_URL?json(doc([{id:'alice',name:'Alice',avatar:'avatars/alice.png'}])):new Response(png));await f.s.refresh();
 for(let i=0;i<30&&!f.s.snapshot().sponsors[0].avatarFile;i++)await new Promise(r=>setTimeout(r,10));assert(f.s.snapshot().sponsors[0].avatarFile);
 const target=fs.mkdtempSync(path.join(os.tmpdir(),'vrcal-sponsors-moved-'));t.after(()=>fs.rmSync(target,{recursive:true,force:true}));
 // copyLibraryData expects the application's source database as well as cache.
 const {Store}=require('../dist/main/main/store');const store=new Store(f.dir,[]);store.close();await copyLibraryData(f.dir,target,[],true);
 const moved=new Sponsors({dataDir:target,roots:()=>[],canNetwork:()=>false,fetch:()=>assert.fail('migration must not fetch')});t.after(()=>moved.close());assert.equal(moved.snapshot().sponsors[0].id,'alice');assert.equal(moved.snapshot().sponsors[0].avatarFile,f.s.snapshot().sponsors[0].avatarFile);
});
test('the actual maintained feed and the separate example both satisfy the desktop schema',()=>{
 for(const name of ['sponsors.json','sponsors.example.json'])assert.equal(parseSponsors(JSON.parse(fs.readFileSync(path.join(__dirname,'../community',name),'utf8'))).schemaVersion,1);
});
test('a stalled feed times out, and bad avatar bytes never become local images',async t=>{
 const f=fixture(t,async()=>new Promise(()=>{}),{timeoutMs:15});const env=process.env.NODE_ENV;process.env.NODE_ENV='test';try{assert.equal((await f.s.refresh()).status,'error')}finally{if(env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=env}
 const a=fixture(t,async url=>url===SPONSORS_URL?json(doc([{id:'a',name:'A',avatar:'avatars/a.png'}])):new Response('<svg onload="alert(1)"></svg>'));
 await a.s.refresh();await new Promise(r=>setTimeout(r,20));assert.equal(a.s.snapshot().sponsors[0].avatarFile,undefined);assert(!fs.readdirSync(path.join(a.dir,'cache')).some(f=>f.startsWith('community-avatar-')));
});
