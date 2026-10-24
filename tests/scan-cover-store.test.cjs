const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.VRCAL_SCAN_TEST_BUILD||path.join(__dirname,'../dist/main'),{Store}=require(path.join(base,'main/store')),{matchingCatalog}=require(path.join(base,'main/matching-catalog'));
function fixture(t){const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-cover-store-')),root=path.join(area,'素材'),data=path.join(area,'Library'),stores=[];fs.mkdirSync(root);t.after(()=>{for(const s of stores)try{s.close()}catch{}assert(path.relative(__dirname,area)&&!path.relative(__dirname,area).startsWith('..'));fs.rmSync(area,{recursive:true,force:true,maxRetries:5})});const open=(d=data,roots=[root])=>{const s=new Store(d,roots);stores.push(s);return s};return{area,root,data,open}}
function add(store,file,kind='file'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,kind==='file'?'synthetic image bytes':'synthetic archive bytes');return store.upsertScan({path:file,name:path.basename(file),kind,group:'合成',size:1,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]})}
test('old automatic cover row exits gallery and queue while its ID and backup record survive restart and restore',t=>{
 const f=fixture(t),s=f.open(),pack=add(s,path.join(f.root,'鸭鸭.rar'),'archive'),image=add(s,path.join(f.root,'鸭鸭.png'));assert.equal(typeof s.markScanCover,'function');
 const before=fs.readFileSync(image.path),marked=s.markScanCover(image.path);assert.deepEqual(marked,{standalone:false,id:image.id});assert.equal(s.list().total,1);assert.equal(s.get(image.id),null);assert.equal(s.getRaw(image.id).missing,false);assert.equal(s.hiddenAssets().total,0);assert.deepEqual(matchingCatalog(s).all().map(a=>a.id),[pack.id]);assert.equal(s.get(pack.id).members.length,1);
 const backup=path.join(f.area,'backup.json');s.exportData(backup);assert.equal(JSON.parse(fs.readFileSync(backup)).assets.find(a=>a.id===image.id).scanCover,true);s.close();
 const again=f.open();assert.equal(again.get(image.id),null);assert.equal(again.getRaw(image.id).id,image.id);const restored=f.open(path.join(f.area,'Restored'),[]);restored.importData(backup);assert.equal(restored.list().total,1);assert.equal(restored.get(image.id),null);assert.deepEqual(fs.readFileSync(image.path),before);
});
test('new companion does not create a row; rescanning an unpaired old image restores the original ID',t=>{
 const f=fixture(t),s=f.open(),file=path.join(f.root,'海报.png');fs.writeFileSync(file,'image');assert.equal(typeof s.markScanCover,'function');assert.deepEqual(s.markScanCover(file),{standalone:false});assert.equal(s.all().length,0);
 const image=add(s,file);s.markScanCover(file);const restored=s.upsertScan({path:file,name:'海报.png',kind:'file',group:'合成',size:5,mtimeMs:2,localCategory:'未分类',localAvatars:[],hintUrls:[]});assert.equal(restored.id,image.id);assert.equal(s.get(image.id).name,'海报.png');
});
test('a revoked source cannot receive a late cover marker',t=>{
 const f=fixture(t),s=f.open(),image=add(s,path.join(f.root,'已撤回.png'));s.removeRoot(f.root);const before=s.getRaw(image.id);assert.equal(typeof s.markScanCover,'function');assert.deepEqual(s.markScanCover(image.path),{standalone:true,id:image.id});assert.deepEqual(s.getRaw(image.id),before);
});
test('manual annotations, explicit source decisions and collection or related references preserve old image access',t=>{
 const f=fixture(t),s=f.open();assert.equal(typeof s.markScanCover,'function');
 for(const [i,patch] of [{notes:'保留备注'},{favorite:true},{title:'原图标题'},{hidden:true},{sourceUrl:'https://booth.pm/items/7643173'}].entries()){
  const row=add(s,path.join(f.root,'image-'+i+'.png'));s.updateManual([row.id],patch);assert.deepEqual(s.markScanCover(row.path),{standalone:true,id:row.id});assert.deepEqual(s.getRaw(row.id).manual,patch);
 }
 const chosen=add(s,path.join(f.root,'chosen.png'));s.updateOnline(chosen.id,{status:'matched',confirmedSource:true,url:'https://booth.pm/items/7643173'});assert.equal(s.markScanCover(chosen.path).standalone,true);
 const member=add(s,path.join(f.root,'collection.png')),collection=s.saveCollection({name:'原图集合',kind:'manual'});s.updateCollectionMembers(collection.id,[member.id],'add');assert.equal(s.markScanCover(member.path).standalone,true);assert.equal(s.list({collectionId:collection.id}).items[0].id,member.id);
 const linked=add(s,path.join(f.root,'related.png')),owner=add(s,path.join(f.root,'owner.zip'),'archive');s.updateManual([owner.id],{relatedIds:[linked.id]});assert.equal(s.markScanCover(linked.path).standalone,true);
});
test('later manual, collection and related changes dynamically restore access without erasing the scan marker',t=>{
 const f=fixture(t),s=f.open(),image=add(s,path.join(f.root,'旧图.png'));assert.equal(typeof s.markScanCover,'function');s.markScanCover(image.path);assert.equal(s.list().total,0);
 s.updateManual([image.id],{notes:'之后恢复的原图信息'});assert.equal(s.get(image.id).manual.notes,'之后恢复的原图信息');s.undoMetadata();assert.equal(s.get(image.id),null);
 const collection=s.saveCollection({name:'后来集合',kind:'manual'});s.updateCollectionMembers(collection.id,[image.id],'add');assert.equal(s.list({collectionId:collection.id}).items[0].id,image.id);s.deleteCollection(collection.id);assert.equal(s.get(image.id),null);s.undoMetadata();assert(s.get(image.id));s.deleteCollection(collection.id);
 const owner=add(s,path.join(f.root,'关联素材.zip'),'archive');s.updateManual([owner.id],{relatedIds:[image.id]});assert(s.get(image.id));s.undoMetadata();assert.equal(s.get(image.id),null);
});
test('library and backup subdirectories cannot be registered as sources in either direction',t=>{
 const f=fixture(t),s=f.open(),before=s.settings();for(const root of [f.data,path.join(f.data,'cache'),path.join(f.data,'xianyu-session')]){assert.throws(()=>s.saveSettings({roots:[root]}),/保护|重叠|资料库/);assert.deepEqual(s.settings(),before)}
 const unused=path.join(f.area,'NeverCreated');assert.throws(()=>{const wrong=new Store(unused,[path.join(unused,'cache')]);wrong.close()},/保护|重叠|资料库/);assert.equal(fs.existsSync(unused),false);
 const backup=path.join(f.area,'Backups');s.saveSettings({backupDir:backup});assert.throws(()=>s.saveSettings({roots:[path.join(backup,'cache')]}),/保护|重叠|备份/);assert.throws(()=>s.saveSettings({backupDir:f.area}),/保护|重叠|备份/);assert.deepEqual(s.settings().roots,[f.root]);
});
test('restoring a library-internal source is rejected before changing records or creating cache files',t=>{
 const f=fixture(t),s=f.open(),image=add(s,path.join(f.root,'保留.png'));s.updateManual([image.id],{notes:'原记录'});const file=path.join(f.area,'unsafe.json');s.exportData(file);const bad=JSON.parse(fs.readFileSync(file));bad.version=1;delete bad.metadataSha256;bad.settings.roots=[path.join(f.data,'cache')];bad.assets=[];fs.writeFileSync(file,JSON.stringify(bad));const before=crypto.createHash('sha256').update(fs.readFileSync(image.path)).digest('hex');assert.throws(()=>s.importData(file),/保护|重叠|资料库/);assert.equal(s.get(image.id).manual.notes,'原记录');assert.equal(fs.existsSync(path.join(f.data,'cache')),false);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(image.path)).digest('hex'),before);
});
