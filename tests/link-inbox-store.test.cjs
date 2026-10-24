const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {LinkInboxStore}=require('../dist/main/main/link-inbox-store');
const {INBOX_POLICY_VERSION}=require('../dist/main/shared/inbox-policy');
const now=Date.parse('2026-10-24T12:00:00+08:00');
const consent={version:INBOX_POLICY_VERSION,acceptedAt:now,scope:'background'};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-inbox-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const key=crypto.randomBytes(32);const cipher={encrypt:text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data])},decrypt:bytes=>{const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12),{authTagLength:16});c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString('utf8')}};return {dir,cipher,make:()=>new LinkInboxStore({dataDir:dir,roots:()=>[],cipher,now:()=>now})}}
const obs=(extra={})=>({platform:'xianyu',accountKey:'test-account',sourceKey:'message-1',sourceUrl:'https://www.goofish.com/im',title:'Test delivery',sourceAt:now-1000,text:'https://pan.baidu.com/s/1SyntheticABC?pwd=abcd',...extra});

test('zero, negative and future source times remain unknown without poisoning encrypted restart',t=>{
 const f=fixture(t),s=f.make();s.configure({enabled:true,background:false,hours:24},consent);s.ingest(obs());
 for(const [index,sourceAt] of [0,-1,now+1000].entries())s.ingest(obs({sourceAt,text:'https://pan.baidu.com/s/1UnknownTime'+index}));
 const restored=f.make(),state=restored.state();assert.equal(state.error,undefined);assert.equal(state.items.length,4);assert.equal(state.unread,1);
 assert.equal(state.items.filter(row=>row.sourceAt===undefined).length,3);restored.mark(state.items[0].id,'read');assert.equal(f.make().state().error,undefined);
});
test('recent inbox deduplicates across foreground/background; old excluded; unknown never badges',t=>{
 const {make}=fixture(t),store=make();store.configure({enabled:true,background:true,hours:24},consent);store.ingest(obs());store.ingest(obs({sourceKey:'message-2'}));assert.equal(store.state().items.length,1);assert.equal(store.state().unread,1);
 store.mark(store.state().items[0].id,'read');store.ingest(obs());assert.equal(store.state().unread,0);
 store.ingest(obs({text:'https://pan.baidu.com/s/1OldABC',sourceAt:now-25*3600000}));assert.equal(store.state().items.length,1);
 store.ingest(obs({text:'https://pan.baidu.com/s/1UnknownABC',sourceAt:undefined}));assert.equal(store.state().items.length,2);assert.equal(store.state().unread,0);
 store.configure({enabled:false,background:true,hours:24},consent);store.ingest(obs({text:'https://pan.baidu.com/s/1DisabledABC'}));assert.equal(store.state().items.length,2);
});
test('account partition, code conflicts, dismissal, completed records and encrypted reload persist',t=>{
 const f=fixture(t),s=f.make();s.configure({enabled:true,background:true,hours:24},consent);s.ingest(obs({sourceAt:now-10*3600000}));const id=s.state().items[0].id;
 s.ingest(obs({text:'https://pan.baidu.com/s/1SyntheticABC?pwd=efgh',sourceAt:now-10*3600000}));assert.equal(s.state().items[0].codeConflict,true);assert.throws(()=>s.downloadTarget(id));
 assert.equal(s.downloadTarget(id,'1234').code,'1234');assert.throws(()=>s.downloadTarget(id,'too long'));assert.equal(s.state().items[0].codeConflict,true);
 s.mark(id,'dismiss');s.ingest(obs());assert.equal(s.state().unread,0);assert.equal(s.state().items[0].dismissed,true);
 s.ingest(obs({accountKey:'other-account',text:'https://pan.baidu.com/s/1OtherABC',sourceAt:now-10*3600000}));const second=s.state().items.find(x=>x.id!==id);s.attachTask(second.id,'download-task-1');s.syncCompleted(['download-task-1']);s.configure({enabled:true,background:true,hours:6},consent);assert(s.state().items.some(x=>x.id===second.id&&x.completed));
 assert(!fs.readFileSync(path.join(f.dir,'link-inbox.bin')).includes(Buffer.from('pan.baidu.com')));const restored=f.make();assert.deepEqual(restored.state(),s.state());
});
test('corrupt or undecipherable journals stay unchanged and block overwriting',t=>{
 const f=fixture(t),file=path.join(f.dir,'link-inbox.bin');fs.writeFileSync(file,'existing unreadable data');const s=f.make();assert(s.state().error);assert.throws(()=>s.configure({enabled:true,background:true,hours:24},consent));assert.equal(fs.readFileSync(file,'utf8'),'existing unreadable data');
});
test('only delivery pages and validated targets accepted; bad configuration rejected',t=>{
 const {make}=fixture(t),s=make();s.configure({enabled:true,background:true,hours:24},consent);
 for(const sourceUrl of ['https://www.goofish.com/search?q=x','https://www.goofish.com.evil.test/im','file:///secret'])assert.throws(()=>s.ingest(obs({sourceUrl})));
 assert.throws(()=>s.configure({enabled:true,background:true,hours:72},consent));assert.equal(s.state().items.length,0);
});
test('consent is required and stale policy consent pauses collection on reload without losing links',t=>{
 const f=fixture(t),s=f.make();assert.throws(()=>s.configure({enabled:true,background:false,hours:24}),/确认/);
 s.configure({enabled:true,background:true,hours:24},consent);s.ingest(obs());const file=path.join(f.dir,'link-inbox.bin'),original=JSON.parse(f.cipher.decrypt(fs.readFileSync(file)));
 assert.equal(original.consent.version,INBOX_POLICY_VERSION);
 for(const oldConsent of [undefined,{...consent,version:'old-policy'},{...consent,scope:'foreground'}]){
  fs.writeFileSync(file,f.cipher.encrypt(JSON.stringify({...original,consent:oldConsent})));const loaded=f.make();assert.equal(loaded.state().settings.enabled,false);assert.equal(loaded.state().items.length,1);assert.equal(loaded.state().error,undefined);
 }
});
test('clear removes inbox records and consent, disables collection and preserves downloaded files',t=>{
 const f=fixture(t),s=f.make(),download=path.join(f.dir,'keep-download.txt');fs.writeFileSync(download,'KEEP');s.configure({enabled:true,background:true,hours:12},consent);s.ingest(obs());s.clearRecords();const restored=f.make();assert.deepEqual(restored.state().items,[]);assert.equal(restored.state().settings.enabled,false);assert.equal(restored.state().settings.background,false);assert.equal(restored.consent(),undefined);assert.equal(fs.readFileSync(download,'utf8'),'KEEP');
});
