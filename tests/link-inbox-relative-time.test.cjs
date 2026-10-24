const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const build=process.env.VRCAL_INBOX_TEST_BUILD||path.join(__dirname,'../dist/main');
const {LinkInboxStore}=require(path.join(build,'main/link-inbox-store'));
const {INBOX_POLICY_VERSION}=require(path.join(build,'shared/inbox-policy'));
const initialNow=Date.parse('2026-10-24T12:00:00+08:00');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-inbox-relative-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=initialNow;const key=crypto.randomBytes(32);
 const cipher={encrypt:text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data])},decrypt:bytes=>{const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12),{authTagLength:16});c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8')}};
 const make=()=>new LinkInboxStore({dataDir:dir,roots:()=>[],cipher,now:()=>now});const store=make();store.configure({enabled:true,background:true,hours:6},{version:INBOX_POLICY_VERSION,acceptedAt:now,scope:'background'});
 return {dir,cipher,make,store,advance:milliseconds=>{now+=milliseconds},now:()=>now,file:path.join(dir,'link-inbox.bin')};
}
const observation=(extra={})=>({platform:'xianyu',accountKey:'test-account',sourceKey:'conversation-1',sourceUrl:'https://www.goofish.com/im',title:'Synthetic delivery',sourceAt:initialNow-180000,sourceTimeApproximate:true,text:'https://pan.baidu.com/s/1SyntheticRelative?pwd=abcd',...extra});

test('encrypted restart retains approximate source time without claiming that it is exact',t=>{
 const f=fixture(t);f.store.ingest(observation());const original=f.store.state().items[0];assert.equal(original.sourceAt,initialNow-180000);assert.equal(original.sourceTimeApproximate,true);
 const restored=f.make().state();assert.equal(restored.error,undefined);assert.deepEqual(restored.items,[original]);assert.equal(restored.unread,1);
 assert(!fs.readFileSync(f.file).includes(Buffer.from('pan.baidu.com')));
});
test('polling the same account and link never refreshes its approximate age or read state',t=>{
 const f=fixture(t);f.store.ingest(observation());const first=f.store.state().items[0];f.store.mark(first.id,'read');
 f.advance(60000);f.store.ingest(observation({sourceKey:'conversation-reordered',sourceAt:f.now()-180000}));
 assert.equal(f.store.state().items[0].sourceAt,first.sourceAt);assert.equal(f.store.state().items[0].read,true);assert.equal(f.store.state().unread,0);
 f.advance(7*3600000);f.store.ingest(observation({sourceAt:f.now()-180000}));assert.deepEqual(f.store.state().items,[]);
 const journal=JSON.parse(f.cipher.decrypt(fs.readFileSync(f.file)));assert.equal(journal.items.length,1);assert.equal(journal.items[0].sourceAt,first.sourceAt);assert.equal(journal.items[0].sourceTimeApproximate,true);assert.deepEqual(f.make().state().items,[]);
});
test('a more conservative approximate time can age an existing link out without creating old records',t=>{
 const f=fixture(t);f.store.ingest(observation());f.store.ingest(observation({sourceAt:initialNow-7*3600000}));assert.deepEqual(f.store.state().items,[]);
 const journal=JSON.parse(f.cipher.decrypt(fs.readFileSync(f.file)));assert.equal(journal.items[0].sourceAt,initialNow-7*3600000);
 f.store.ingest(observation({text:'https://pan.baidu.com/s/1OldSeparateLink',sourceAt:initialNow-2*86400000}));assert.equal(JSON.parse(f.cipher.decrypt(fs.readFileSync(f.file))).items.length,1);
});
test('a verified exact timestamp upgrades an approximate timestamp and cannot later be degraded by approximation',t=>{
 const f=fixture(t);f.store.ingest(observation());f.store.ingest(observation({sourceAt:initialNow-60000,sourceTimeApproximate:undefined}));
 let item=f.store.state().items[0];assert.equal(item.sourceAt,initialNow-60000);assert.notEqual(item.sourceTimeApproximate,true);
 f.store.ingest(observation({sourceAt:initialNow-3600000}));item=f.make().state().items[0];assert.equal(item.sourceAt,initialNow-60000);assert.notEqual(item.sourceTimeApproximate,true);
 f.store.ingest(observation({sourceAt:initialNow-30000,sourceTimeApproximate:false}));assert.equal(f.store.state().items[0].sourceAt,initialNow-30000);
});
test('older exact evidence can correct an approximation, while account partitions remain independent',t=>{
 const f=fixture(t);f.store.ingest(observation());f.store.ingest(observation({sourceAt:initialNow-8*3600000,sourceTimeApproximate:undefined}));assert.deepEqual(f.store.state().items,[]);
 const journal=JSON.parse(f.cipher.decrypt(fs.readFileSync(f.file)));assert.equal(journal.items[0].sourceAt,initialNow-8*3600000);assert.notEqual(journal.items[0].sourceTimeApproximate,true);
 f.store.ingest(observation({accountKey:'different-account',sourceAt:initialNow-60000}));assert.equal(f.store.state().items.length,1);assert.equal(f.store.state().unread,1);
});
test('unknown legacy times may be resolved without forcing an approximate flag onto exact evidence',t=>{
 const f=fixture(t);f.store.ingest(observation({sourceAt:undefined,sourceTimeApproximate:undefined}));assert.equal(f.store.state().unread,0);
 f.store.ingest(observation());assert.equal(f.store.state().items[0].sourceTimeApproximate,true);assert.equal(f.store.state().unread,1);
 f.store.ingest(observation({sourceTimeApproximate:undefined}));assert.notEqual(f.store.state().items[0].sourceTimeApproximate,true);assert.equal(f.make().state().error,undefined);
});
test('malformed approximation flags, missing time and cross-platform approximation are rejected',t=>{
 const f=fixture(t);
 for(const sourceTimeApproximate of ['true',1,{},null])assert.throws(()=>f.store.ingest(observation({sourceTimeApproximate})),/格式/);
 for(const sourceAt of [undefined,0,-1,Infinity,initialNow+1])assert.throws(()=>f.store.ingest(observation({sourceAt})),/格式/);
 assert.throws(()=>f.store.ingest(observation({platform:'booth',sourceUrl:'https://accounts.booth.pm/library'})),/格式/);assert.deepEqual(f.store.state().items,[]);
});
test('invalid persisted approximation metadata preserves the journal and blocks rewriting it',t=>{
 const f=fixture(t);f.store.ingest(observation());const original=JSON.parse(f.cipher.decrypt(fs.readFileSync(f.file)));
 for(const patch of [{sourceTimeApproximate:'true'},{sourceTimeApproximate:null},{sourceAt:undefined,sourceTimeApproximate:true}]){
  const data=structuredClone(original);Object.assign(data.items[0],patch);const bytes=f.cipher.encrypt(JSON.stringify(data));fs.writeFileSync(f.file,bytes);const restored=f.make();assert(restored.state().error);assert.throws(()=>restored.mark(data.items[0].id,'read'));assert.deepEqual(fs.readFileSync(f.file),bytes);
 }
});
