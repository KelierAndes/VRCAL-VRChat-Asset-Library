const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../dist/main/main/store');

function fixture(t){
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-hidden-stats-')),root=path.join(area,'素材 日本語 💝'),data=path.join(area,'Library'),stores=[];fs.mkdirSync(root);
 const open=(directory=data)=>{const store=new Store(directory,[root]);stores.push(store);return store};
 const add=(store,relative,kind='archive')=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});if(kind==='folder'||kind==='unity-project')fs.mkdirSync(file);else fs.writeFileSync(file,'ORIGINAL '+relative);return store.upsertScan({path:file,name:path.basename(file),kind,group:'Airi',size:1,mtimeMs:1,localCategory:kind==='unity-project'?'工程':'服装',localAvatars:[],hintUrls:[]})};
 t.after(()=>{for(const store of stores)try{store.close()}catch{}assert(path.resolve(area).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(area,{recursive:true,force:true,maxRetries:3})});
 return {area,root,data,open,add};
}

test('hidden statistics count grouped cards and refresh after hide, restore and metadata undo',t=>{
 const f=fixture(t),store=f.open(),a=f.add(store,'MoonDress_Airi.zip'),b=f.add(store,'MoonDress_Airi.unitypackage'),other=f.add(store,'StarRibbon_Airi.zip');
 const originals=[a,b,other].map(asset=>[asset.path,fs.readFileSync(asset.path)]);
 assert.equal(store.stats().hidden,0);assert.equal(store.stats().total,2);
 store.setHidden([a.id],true);assert.equal(store.stats().hidden,1);assert.equal(store.stats().total,1);assert.equal(store.hiddenAssets().items[0].members.length,2);
 const snapshot=store.stats(),categories={...snapshot.categories};snapshot.hidden=99;snapshot.categories['服装']=99;assert.equal(store.stats().hidden,1);assert.deepEqual(store.stats().categories,categories);
 store.setHidden([other.id],true);assert.equal(store.stats().hidden,2);assert.equal(store.hiddenAssets({limit:1}).items.length,1);assert.equal(store.hiddenAssets({limit:1}).total,2);
 store.setHidden([a.id],false);assert.equal(store.stats().hidden,1);assert.equal(store.stats().total,1);
 assert(store.undoMetadata());assert.equal(store.stats().hidden,2);assert.equal(store.stats().total,0);
 for(const [file,bytes] of originals)assert.deepEqual(fs.readFileSync(file),bytes);
});

test('hidden statistics exclude recycled, detached, scan-container and organizational records',t=>{
 const f=fixture(t),store=f.open(),active=f.add(store,'HiddenDress.zip'),detached=f.add(store,'旧来源/HiddenRibbon.zip'),recycled=f.add(store,'HiddenGlasses.zip'),container=f.add(store,'分类书架','folder'),organizational=f.add(store,'新建文件夹','folder'),support=f.add(store,'VT_Material&PSD/VT_Material.unitypackage','unitypackage'),project=f.add(store,'角色工程','unity-project');
 store.saveSettings({roots:[f.root,path.dirname(detached.path)]});
 store.updateManual([active.id,detached.id,recycled.id,container.id,organizational.id,support.id,project.id],{hidden:true});store.markScanContainer(container.path);
 assert.equal(store.stats().hidden,4);assert.equal(store.stats().hidden,store.hiddenAssets().total);
 store.markRecycled([recycled.id]);assert.equal(store.stats().hidden,3);
 store.removeRoot(path.dirname(detached.path));assert.equal(store.stats().hidden,2);assert.deepEqual(new Set(store.hiddenAssets().items.map(asset=>asset.id)),new Set([active.id,project.id]));
 store.saveSettings({roots:[f.root,path.dirname(detached.path)]});assert.equal(store.stats().hidden,3);
 assert(store.updateAvailability(recycled.id,false));assert.equal(store.stats().hidden,4);assert.equal(store.stats().hidden,store.hiddenAssets().total);
});

test('hidden card counts survive rescan, restart and verified restore into a previously cached library',t=>{
 const f=fixture(t),store=f.open(),a=f.add(store,'MoonDress_Airi.zip'),b=f.add(store,'MoonDress_Airi.unitypackage');store.setHidden([a.id],true);assert.equal(store.stats().hidden,1);
 for(const asset of [a,b])store.upsertScan(asset);assert.equal(store.stats().hidden,1);
 const backup=path.join(f.area,'hidden-backup.json');store.exportData(backup);store.close();
 const reopened=f.open();assert.equal(reopened.stats().hidden,1);reopened.setHidden([a.id],false);assert.equal(reopened.stats().hidden,0);reopened.importData(backup);assert.equal(reopened.stats().hidden,1);assert.equal(reopened.stats().total,0);
 const restored=f.open(path.join(f.area,'Restored'));assert.equal(restored.stats().hidden,0);restored.importData(backup);assert.equal(restored.stats().hidden,1);assert.equal(restored.hiddenAssets().items[0].members.length,2);
 restored.setHidden([a.id],false);assert.equal(restored.stats().hidden,0);assert.equal(restored.stats().total,1);
});
