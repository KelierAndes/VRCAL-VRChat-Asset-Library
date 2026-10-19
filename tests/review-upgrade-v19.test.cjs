const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {Store}=require('../dist/main/main/store'),{EnrichmentQueue}=require('../dist/main/main/online');
const source=id=>'https://booth.pm/zh-cn/items/'+id;
const response=body=>new Response(body,{headers:{'content-type':'text/html'}});
const page=id=>response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:source(id),name:'Official item '+id,brand:{name:'Shop'}})+'</script>');
const empty=()=>response('<div class="no-results">No results</div>');
function setup(t,name,fetch,manual={},online={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-review-upgrade-')),root=path.join(base,'synthetic'),dataDir=path.join(base,'data'),file=path.join(root,name),calls=[];fs.mkdirSync(root);fs.writeFileSync(file,'private synthetic input');let store=new Store(dataDir,[root]);const id=store.upsertScan({path:file,name,group:'synthetic',kind:'archive',size:1,mtimeMs:0,localCategory:'未分类',localAvatars:[],hintUrls:[]}).id;
 store.updateManual([id],{notes:'keep notes',...manual});store.updateOnline(id,{status:'review',title:'Previous official title',candidates:[{url:source('7643173'),title:'Previous candidate'}],matchEvidence:{method:'filename-id',signals:[],ruleVersion:'1.6.0',recordedAt:''},...online});
 const deps={dataDir,roots:()=>[root],all:()=>store.all(),get:id=>store.getRaw(id),updateOnline:(id,patch)=>store.updateOnline(id,patch),fetch:async(...args)=>{calls.push(args[0]);return fetch(...args)},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}},q=new EnrichmentQueue(deps),others=[];
 t.after(async()=>{q.stop();await q.waitIdle();for(const other of others)other.close();store.close();fs.rmSync(base,{recursive:true,force:true})});return {id,q,calls,base,root,get:()=>store.getRaw(id),getStore:()=>store,reopen:()=>{store.close();store=new Store(dataDir,[root])},restore:()=>{const backup=path.join(base,'backup.json');store.exportData(backup);const other=new Store(path.join(base,'restored'),[root]);others.push(other);other.importData(backup);return other},deps};
}
const normalFetch=async target=>target.includes('/search/')?empty():page(new URL(target).pathname.match(/\d+$/)[0]);

test('normal enqueue re-evaluates an old automatic ID-only review and confirms the corresponding item',async t=>{
 const f=setup(t,'7643173.zip',normalFetch);await f.q.enqueue();await f.q.waitIdle();assert.equal(f.get().online.status,'matched');assert.equal(f.get().online.url,source('7643173'));assert.equal(f.get().manual.notes,'keep notes');assert(f.calls.includes(source('7643173')));
});
test('ambiguous old review is checked once per rule and its marker survives restart and verified restore',async t=>{
 const f=setup(t,'7643173_8801382.zip',normalFetch);await f.q.enqueue();await f.q.waitIdle();assert(f.calls.length>=2);assert.equal(f.get().online.status,'review');assert.equal(f.get().online.candidates.length,2);assert.equal(f.get().online.matchingCheckedVersion,'1.9.0');const count=f.calls.length;await f.q.enqueue();await f.q.waitIdle();assert.equal(f.calls.length,count);f.reopen();assert.equal(f.get().online.matchingCheckedVersion,'1.9.0');await f.q.enqueue();await f.q.waitIdle();assert.equal(f.calls.length,count);assert.equal(f.restore().getRaw(f.id).online.matchingCheckedVersion,'1.9.0');
});
test('upgrade does not re-evaluate manual sources, confirmed bindings, or manual matching skips',async t=>{
 for(const extra of [{manual:{sourceUrl:source('7643173')}},{online:{confirmedSource:true,url:source('7643173')}},{manual:{matchingMode:'manual'}},{online:{url:source('7643173'),matchEvidence:{method:'manual',signals:[],ruleVersion:'1.6.0',recordedAt:''}}}]){const f=setup(t,'7643173.zip',normalFetch,extra.manual,extra.online),before=f.get().online;await f.q.enqueue();await f.q.waitIdle();assert.equal(f.calls.length,0);assert.deepEqual(f.get().online,before);}
});
test('failed review upgrade keeps prior candidates and remains eligible for a later normal enqueue',async t=>{
 let offline=true;const f=setup(t,'7643173.zip',async target=>{if(offline)throw Error('offline');return normalFetch(target)}),before=f.get().online.candidates;await f.q.enqueue();await f.q.waitIdle();assert(f.calls.length>0);assert.equal(f.get().online.status,'review');assert.deepEqual(f.get().online.candidates,before);assert.equal(f.get().online.matchingCheckedVersion,undefined);f.reopen();offline=false;await f.q.enqueue();await f.q.waitIdle();assert.equal(f.get().online.status,'matched');
});
test('paused review upgrade preserves prior candidates and resumes its persisted correction',async t=>{
 let hold=true,started;const began=new Promise(resolve=>started=resolve),f=setup(t,'7643173.zip',async(target,{signal})=>{if(hold){started();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}return normalFetch(target)}),before=f.get().online.candidates;await f.q.enqueue();await Promise.race([began,new Promise((resolve,reject)=>setTimeout(()=>reject(Error('upgrade did not start')),300))]);f.q.pause();await f.q.waitIdle();assert.equal(f.get().online.status,'review');assert.deepEqual(f.get().online.candidates,before);assert.equal(f.get().online.matchingCheckedVersion,undefined);assert.equal(f.q.progress.pending,1);hold=false;await f.q.resume();await f.q.waitIdle();assert.equal(f.get().online.status,'matched');
});
test('review upgrade preserves canonical exclusions and never reads the rejected item',async t=>{
 const rejected='https://shop.booth.pm/en/items/7643173',f=setup(t,'7643173.zip',normalFetch,{}, {rejectedUrls:[rejected]});await f.q.enqueue();await f.q.waitIdle();assert.equal(f.get().online.status,'not-found');assert.deepEqual(f.get().online.rejectedUrls,[rejected]);assert.deepEqual(f.get().online.candidates,[]);assert(!f.calls.some(target=>target.includes('/items/7643173')));assert.equal(f.get().online.matchingCheckedVersion,'1.9.0');
});
test('successful empty re-evaluation keeps viable previous review candidates',async t=>{
 const f=setup(t,'Unrecognized Local Name.zip',async()=>empty()),before=f.get().online.candidates;await f.q.enqueue();await f.q.waitIdle();assert.equal(f.get().online.status,'review');assert.deepEqual(f.get().online.candidates,before);assert.equal(f.get().online.matchingCheckedVersion,'1.9.0');assert.equal(f.get().manual.notes,'keep notes');
});
