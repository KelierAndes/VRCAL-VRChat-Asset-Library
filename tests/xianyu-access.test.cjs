const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('../dist/main/main/store');
function fixture(t){const root=fs.mkdtempSync(path.join(__dirname,'.fixtures-xianyu-access-')),source=path.join(root,'素材'),data=path.join(root,'library');fs.mkdirSync(source);const stores=[];t.after(()=>{for(const s of stores)try{s.close()}catch{}assert(path.resolve(root).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:3})});return {root,source,data,open:(location=data)=>{const s=new Store(location,[source]);stores.push(s);return s}}}

test('Xianyu is disabled by default and an explicit boolean preference survives reopening',t=>{
 const f=fixture(t),store=f.open();assert.equal(store.settings().xianyuEnabled,false);
 store.saveSettings({xianyuEnabled:true});store.saveSettings({theme:'x'});store.close();
 const restored=f.open();assert.equal(restored.settings().xianyuEnabled,true);restored.saveSettings({xianyuEnabled:false});restored.close();assert.equal(f.open().settings().xianyuEnabled,false);
});
test('legacy and malformed enabled values remain off, invalid writes are atomic',t=>{
 const f=fixture(t),store=f.open();store.saveSettings({onlineEnabled:false});store.close();
 const db=new DatabaseSync(path.join(f.data,'library.sqlite'));try{
 const saved=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);
 for(const value of [undefined,'true',1,{},null]){const next={...saved};if(value===undefined)delete next.xianyuEnabled;else next.xianyuEnabled=value;db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(next),'app');const s=f.open();assert.equal(s.settings().xianyuEnabled,false);s.close()}
 const s=f.open(),before=s.settings();for(const invalid of [undefined,'true',1,null,{}]){assert.throws(()=>s.saveSettings({xianyuEnabled:invalid,onlineEnabled:true}),/闲鱼.*设置无效/);assert.deepEqual(s.settings(),before)}s.close();
 }finally{db.close()}
});
test('restoring a backup cannot silently enable an optional search tool',t=>{
 const f=fixture(t),source=f.open();source.saveSettings({xianyuEnabled:true});const file=path.join(f.root,'backup.json');source.exportData(file);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).settings.xianyuEnabled,true);
 const target=f.open(path.join(f.root,'target'));target.importData(file);assert.equal(target.settings().xianyuEnabled,false);
 target.saveSettings({xianyuEnabled:true});target.importData(file);assert.equal(target.settings().xianyuEnabled,true);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function toggle(override={}){const {XianyuAccess}=require('../dist/main/main/xianyu-access');let enabled=false,confirms=0,closes=0,changes=0;const writes=[];const deps={enabled:()=>enabled,save:value=>{enabled=value;writes.push(value)},confirm:async()=>{confirms++;return true},close:()=>{closes++},changed:()=>{changes++},available:()=>true,...override};return {access:new XianyuAccess(deps),state:()=>({enabled,confirms,closes,changes,writes}),deps}}
test('cancelling the use notice leaves the feature disabled without a settings write',async()=>{
 const f=toggle({confirm:async()=>false});assert.equal(await f.access.setEnabled(true),false);assert.deepEqual(f.state().writes,[]);assert.equal(f.state().enabled,false);
});
test('enabling requires acceptance; disabling closes the tool; re-enabling shows the notice again',async()=>{
 const f=toggle();assert.equal(await f.access.setEnabled(true),true);assert.equal(await f.access.setEnabled(true),true);assert.equal(f.state().confirms,1);
 assert.equal(await f.access.setEnabled(false),false);assert.equal(f.state().closes,1);assert.equal(await f.access.setEnabled(true),true);assert.equal(f.state().confirms,2);assert.deepEqual(f.state().writes,[true,false,true]);
});
test('duplicate enable requests share one notice, and disabling cancels a pending acceptance',async()=>{
 const reply=deferred();let confirms=0;const f=toggle({confirm:()=>{confirms++;return reply.promise}});
 const first=f.access.setEnabled(true),second=f.access.setEnabled(true);assert.equal(confirms,1);await f.access.setEnabled(false);reply.resolve(true);
 assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.deepEqual(f.state().writes,[false]);assert.equal(f.state().enabled,false);
});
test('a failed dialog can be retried, unavailable application and invalid values do not enable the feature',async()=>{
 let fails=true;const f=toggle({confirm:async()=>{if(fails)throw Error('dialog failed');return true}});await assert.rejects(()=>f.access.setEnabled(true),/dialog failed/);assert.equal(f.state().enabled,false);fails=false;assert.equal(await f.access.setEnabled(true),true);
 const unavailable=toggle({available:()=>false});assert.equal(await unavailable.access.setEnabled(true),false);
 for(const value of ['true',1,null,undefined,{}])await assert.rejects(()=>unavailable.access.setEnabled(value),/设置无效/);
 assert.deepEqual(unavailable.state().writes,[]);
});
