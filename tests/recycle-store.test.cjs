const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../dist/main/main/store'),{matchingCatalog}=require('../dist/main/main/matching-catalog');
function fixture(t){const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-recycle-store-')),root=path.join(area,'素材 日本語 💝'),data=path.join(area,'Library'),stores=[];fs.mkdirSync(root);let store;const open=()=>{store=new Store(data,[root]);stores.push(store);return store};open();const scan=name=>{const file=path.join(root,name);return {path:file,name,kind:'archive',group:'Airi',size:1,mtimeMs:1,localCategory:'服装',localAvatars:[],hintUrls:[]}};const add=name=>{fs.writeFileSync(path.join(root,name),'READ ONLY '+name);return store.upsertScan(scan(name))};t.after(()=>{for(const s of stores)try{s.close()}catch{}assert(path.resolve(area).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(area,{recursive:true,force:true,maxRetries:3})});return {area,root,data,open,add,scan,get store(){return store}}}
test('recycled records leave gallery and hidden lists while notes, covers and source history survive restart and restore',t=>{
 const f=fixture(t),a=f.add('眼镜 日本語💝.zip');f.store.updateManual([a.id],{notes:'KEEP NOTES',tags:['KEEP'],coverFile:'keep.png',sourceUrl:'https://booth.pm/ja/items/1111111'});f.store.updateOnline(a.id,{status:'matched',title:'KEEP TITLE'});fs.mkdirSync(path.join(f.data,'cache'),{recursive:true});fs.writeFileSync(path.join(f.data,'cache/keep.png'),'COVER');f.store.setHidden([a.id],true);const old=path.join(f.area,'before.json');f.store.exportData(old);
 // The service is tested separately; this store test models an OS move using a private fixture file.
 fs.renameSync(a.path,path.join(f.area,'recycled.zip'));f.store.markRecycled([a.id]);assert.equal(f.store.list().total,0);assert.equal(f.store.hiddenAssets().total,0);assert.equal(matchingCatalog(f.store).get(a.id),null);assert.equal(f.store.getRaw(a.id).manual.notes,'KEEP NOTES');assert.equal(f.store.getRaw(a.id).missing,true);assert(f.store.getRaw(a.id).recycledAt);
 f.store.upsertScan(f.scan(a.name));assert(f.store.getRaw(a.id).recycledAt,'A delayed scan or download registration must not restore a file that is still in the Recycle Bin');
 f.store.close();f.open();assert.equal(f.store.hiddenAssets().total,0);f.store.importData(old);assert.equal(f.store.list().total,0);assert.equal(f.store.hiddenAssets().total,0);assert.equal(f.store.getRaw(a.id).manual.notes,'KEEP NOTES');
 fs.renameSync(path.join(f.area,'recycled.zip'),a.path);f.store.upsertScan(f.scan(a.name));assert.equal(f.store.getRaw(a.id).recycledAt,undefined);assert.equal(f.store.hiddenAssets().total,1);f.store.setHidden([a.id],false);assert.equal(f.store.list().total,1);assert.equal(f.store.get(a.id).manual.notes,'KEEP NOTES');assert.equal(f.store.get(a.id).online.title,'KEEP TITLE');
});
test('selection resolves visible and hidden merged members before any side effect',t=>{
 const f=fixture(t),a=f.add('MoonDress_Airi.zip'),b=f.add('MoonDress_Airi.unitypackage');const ids=f.store.selectedRawIds([a.id,b.id]);assert.equal(ids.length,2);assert(ids.includes(a.id)&&ids.includes(b.id));assert.deepEqual(f.store.selectedRawIds([a.id],'file'),[a.id]);assert.throws(()=>f.store.selectedRawIds([a.id],'unknown'));f.store.setHidden([a.id],true);assert.equal(f.store.selectedRawIds([a.id]).length,2);assert.deepEqual(f.store.selectedRawIds([b.id],'file'),[b.id]);assert.throws(()=>f.store.selectedRawIds([a.id,'missing-id']));
});
test('context menu order and visibility persist through restart and backup restore; invalid writes remain atomic',t=>{
 const f=fixture(t),prefs={order:['delete','hide','reveal'],hidden:['copy-path','cover']};f.store.saveSettings({contextMenu:prefs});const saved=f.store.settings().contextMenu;assert.deepEqual(saved.order.slice(0,3),prefs.order);assert.deepEqual(saved.hidden,prefs.hidden);assert(saved.order.length>=20);const backup=path.join(f.area,'prefs.json');f.store.exportData(backup);f.store.close();f.open();assert.deepEqual(f.store.settings().contextMenu,saved);assert.throws(()=>f.store.saveSettings({contextMenu:{order:[],hidden:[123]}}));assert.deepEqual(f.store.settings().contextMenu,saved);f.store.saveSettings({contextMenu:{order:[],hidden:[]}});f.store.importData(backup);assert.deepEqual(f.store.settings().contextMenu,saved);
});

test('existence-verified availability refresh restores recycled download and contained-child records without rescanning their identity',t=>{
 const f=fixture(t),a=f.add('恢复的下载.zip'),b=f.add('恢复的子素材.zip');f.store.updateManual([a.id,b.id],{notes:'KEEP CHILD AND DOWNLOAD'});f.store.markRecycled([a.id,b.id]);assert.equal(f.store.list().total,0);assert(f.store.updateAvailability(a.id,false));assert(f.store.updateAvailability(b.id,false));assert.equal(f.store.list().total,2);for(const id of [a.id,b.id]){assert.equal(f.store.getRaw(id).recycledAt,undefined);assert.equal(f.store.getRaw(id).manual.notes,'KEEP CHILD AND DOWNLOAD')}
});

test('availability observations made before recycling cannot resurrect the newly recycled entry',t=>{
 const f=fixture(t),a=f.add('延迟的下载.zip'),observed=f.store.getRaw(a.id);f.store.markRecycled([a.id]);assert.equal(f.store.updateAvailability(a.id,false,observed),false);assert.equal(f.store.list().total,0);assert(f.store.getRaw(a.id).recycledAt);assert.equal(f.store.updateAvailability(a.id,false,f.store.getRaw(a.id)),true);assert.equal(f.store.list().total,1);
 const oldPath=f.store.getRaw(a.id);
 // A different registered path must not consume an earlier path's stat result.
 assert.equal(f.store.updateAvailability(a.id,true,{...oldPath,path:path.join(f.root,'不存在的旧路径.zip')}),false);assert.equal(f.store.getRaw(a.id).missing,false);
});

test('recycle protection retains Unity projects even after their source root is detached and markers are unavailable',t=>{
 const f=fixture(t),project=path.join(f.root,'停用工程');fs.mkdirSync(project);const a=f.store.upsertScan({...f.scan('停用工程'),path:project,kind:'unity-project',localCategory:'工程'});f.store.removeRoot(f.root);assert.equal(f.store.all().length,0);assert(f.store.recycleRecords().some(item=>item.id===a.id&&item.kind==='unity-project'));const copy=f.store.recycleRecords();copy[0].path='MUTATED';assert.equal(f.store.getRaw(a.id).path,project);
});
