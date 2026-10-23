const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('../dist/main/main/store');

function fixture(t){
 const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-settings-concurrency-'));
 const roots=[path.join(base,'素材 💝'),path.join(base,'日文素材')],data=path.join(base,'资料库'),backupDir=path.join(base,'备份');
 for(const root of roots)fs.mkdirSync(root);
 const stores=new Set(),open=(directory=data,sourceRoots=roots)=>{const store=new Store(directory,sourceRoots);stores.add(store);return store};
 t.after(()=>{for(const store of stores)try{store.close()}catch{}const absolute=path.resolve(base);assert(absolute.startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3})});
 return {base,roots,data,backupDir,open};
}
function addAsset(store,root){
 const source=path.join(root,'A衣服_まよ💝.unitypackage');fs.writeFileSync(source,'source untouched');
 const record=store.upsertScan({path:source,name:path.basename(source),group:'Airi',kind:'unitypackage',size:fs.statSync(source).size,mtimeMs:fs.statSync(source).mtimeMs,localCategory:'服装',localAvatars:['Mayo'],hintUrls:['https://booth.pm/ja/items/12345'],localEvidence:[{avatar:'Mayo',files:[path.basename(source)],basis:'filename'}],compatibilityComplete:true});
 store.updateManual([record.id],{title:'我的服装',notes:'保留我的介绍',favorite:true,tags:['私有'],avatars:['Mayo'],relatedIds:[record.id]});
 store.updateOnline(record.id,{status:'matched',title:'商品服装',author:'原作者',url:'https://booth.pm/ja/items/12345',avatars:['Airi','Mayo'],description:'线上介绍'});
 return {record:store.getRaw(record.id),source,hash:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')};
}
function assertSourceUnchanged(asset){assert.equal(crypto.createHash('sha256').update(fs.readFileSync(asset.source)).digest('hex'),asset.hash)}

test('unknown legacy preferences are omitted from reads, writes and exports',t=>{
 const f=fixture(t),store=f.open();store.saveSettings({language:'ja',theme:'x-light',downloadConcurrency:5});store.close();
 const db=new DatabaseSync(path.join(f.data,'library.sqlite'));t.after(()=>{try{db.close()}catch{}});
 const saved=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);saved.retiredFeatureEnabled=true;saved.retiredFeatureState={token:'PRIVATE SYNTHETIC VALUE'};
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(saved),'app');
 const reopened=f.open();assert.equal(reopened.settings().retiredFeatureEnabled,undefined);assert.equal(reopened.settings().retiredFeatureState,undefined);
 const result=reopened.saveSettings({uiZoom:1.25,retiredFeatureEnabled:true,retiredFeatureState:saved.retiredFeatureState});assert.equal(result.retiredFeatureEnabled,undefined);assert.equal(result.retiredFeatureState,undefined);
 assert.equal(result.language,'ja');assert.equal(result.theme,'x-light');assert.equal(result.downloadConcurrency,5);
 const persisted=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);assert.equal(persisted.retiredFeatureEnabled,undefined);assert.equal(persisted.retiredFeatureState,undefined);db.close();
 const backup=path.join(f.base,'normalized.json');reopened.exportData(backup);assert(!fs.readFileSync(backup,'utf8').includes('PRIVATE SYNTHETIC VALUE'));
});

test('restoring a legacy backup drops unknown settings while preserving supported preferences',t=>{
 const f=fixture(t),store=f.open(),asset=addAsset(store,f.roots[0]);store.saveSettings({language:'en',theme:'swiss',downloadConcurrency:4});
 const file=path.join(f.base,'legacy-unknown-settings.json');store.exportData(file);const backup=JSON.parse(fs.readFileSync(file,'utf8'));backup.version=1;backup.settings.retiredFeatureEnabled=true;backup.settings.retiredFeatureState={token:'PRIVATE SYNTHETIC VALUE'};fs.writeFileSync(file,JSON.stringify(backup));
 const restored=f.open(path.join(f.base,'restored'));restored.importData(file);assert.equal(restored.settings().retiredFeatureEnabled,undefined);assert.equal(restored.settings().retiredFeatureState,undefined);assert.equal(restored.settings().language,'en');assert.equal(restored.settings().theme,'swiss');assert.equal(restored.settings().downloadConcurrency,4);assert.deepEqual(restored.getRaw(asset.record.id).manual,asset.record.manual);assertSourceUnchanged(asset);
});

test('download concurrency defaults to 3 and survives settings updates and reopening',t=>{
 const f=fixture(t),store=f.open();assert.equal(store.settings().downloadConcurrency,3);
 store.saveSettings({downloadConcurrency:6,onlineEnabled:false,backupDir:f.backupDir,uiZoom:1.25});
 store.saveSettings({uiZoom:1.5});assert.equal(store.settings().downloadConcurrency,6);store.close();
 const reopened=f.open();assert.deepEqual(reopened.settings(),{contextMenu:require('../dist/main/shared/context-menu').normalizeContextMenuPreferences(),roots:f.roots,onlineEnabled:false,dataDir:f.data,backupDir:f.backupDir,uiZoom:1.5,downloadConcurrency:6,theme:'nasa',xThemeIntroduced:false,language:'zh-CN',xianyuEnabled:false,reviewHeaderPinned:false,reviewShowLocalImage:false});
 for(const accepted of [1,2,3,4,5,6])assert.equal(reopened.saveSettings({downloadConcurrency:accepted}).downloadConcurrency,accepted);
});

test('settings reject invalid concurrency without changing preferences or source rows',t=>{
 const f=fixture(t),store=f.open(),asset=addAsset(store,f.roots[0]);store.saveSettings({downloadConcurrency:4,onlineEnabled:false,backupDir:f.backupDir,uiZoom:1.25});
 const before=store.settings(),record=store.getRaw(asset.record.id);
 for(const invalid of [0,7,-1,3.5,'3',NaN,Infinity,null,undefined]){
  assert.throws(()=>store.saveSettings({downloadConcurrency:invalid,onlineEnabled:true,uiZoom:2}),/1 到 6.*整数/);
  assert.deepEqual(store.settings(),before);assert.deepEqual(store.getRaw(record.id),record);
 }
 assertSourceUnchanged(asset);store.close();const reopened=f.open();assert.deepEqual(reopened.settings(),before);assert.deepEqual(reopened.getRaw(record.id),record);
});

test('saved legacy and malformed concurrency settings normalize to 3',t=>{
 const f=fixture(t),store=f.open();store.saveSettings({backupDir:f.backupDir,uiZoom:1.5,onlineEnabled:false});store.close();
 const db=new DatabaseSync(path.join(f.data,'library.sqlite'));t.after(()=>{try{db.close()}catch{}});
 const original=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);
 for(const value of [undefined,0,7,1.5,'4',null]){
  const saved={...original};if(value===undefined)delete saved.downloadConcurrency;else saved.downloadConcurrency=value;
  db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(saved),'app');
  const reopened=f.open();assert.equal(reopened.settings().downloadConcurrency,3);assert.equal(reopened.settings().backupDir,f.backupDir);assert.equal(reopened.settings().uiZoom,1.5);assert.equal(reopened.settings().onlineEnabled,false);assert.deepEqual(reopened.settings().roots,f.roots);reopened.close();
 }
 db.close();
});

test('backup preserves concurrency, preferences and asset metadata on import and reopen',t=>{
 const f=fixture(t),store=f.open(),asset=addAsset(store,f.roots[0]);store.saveSettings({downloadConcurrency:5,backupDir:f.backupDir,uiZoom:1.75,onlineEnabled:false});
 const backup=path.join(f.base,'complete.json');store.exportData(backup);
 assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).settings.downloadConcurrency,5);
 const importedDir=path.join(f.base,'导入资料库'),imported=f.open(importedDir);imported.importData(backup);
 assert.deepEqual(imported.settings(),{contextMenu:require('../dist/main/shared/context-menu').normalizeContextMenuPreferences(),roots:f.roots,onlineEnabled:false,dataDir:importedDir,backupDir:f.backupDir,uiZoom:1.75,downloadConcurrency:5,theme:'nasa',xThemeIntroduced:false,language:'zh-CN',xianyuEnabled:false,reviewHeaderPinned:false,reviewShowLocalImage:false});
 let restored=imported.getRaw(asset.record.id);assert.deepEqual(restored.manual,asset.record.manual);assert.deepEqual(restored.online,asset.record.online);assert.deepEqual(restored.localEvidence,asset.record.localEvidence);assert.equal(restored.compatibilityComplete,true);assert.equal(restored.path,asset.source);assert.equal(restored.missing,false);
 imported.close();const reopened=f.open(importedDir);assert.equal(reopened.settings().downloadConcurrency,5);assert.deepEqual(reopened.getRaw(asset.record.id).manual,asset.record.manual);assertSourceUnchanged(asset);
});

test('legacy backup defaults concurrency to 3 while merging roots and preserving other preferences',t=>{
 const f=fixture(t),store=f.open(),asset=addAsset(store,f.roots[0]);store.saveSettings({downloadConcurrency:6,backupDir:f.backupDir,uiZoom:1.25,onlineEnabled:false});
 const backup=path.join(f.base,'legacy.json');store.exportData(backup);const value=JSON.parse(fs.readFileSync(backup,'utf8'));value.version=1;delete value.settings.downloadConcurrency;fs.writeFileSync(backup,JSON.stringify(value));
 const extra=path.join(f.base,'现有素材');fs.mkdirSync(extra);const target=f.open(path.join(f.base,'新资料库'),[extra]);const existing=addAsset(target,extra);target.saveSettings({downloadConcurrency:1,uiZoom:2});target.importData(backup);
 assert.equal(target.settings().downloadConcurrency,3);assert.deepEqual(target.settings().roots,[extra,...f.roots]);assert.equal(target.settings().backupDir,f.backupDir);assert.equal(target.settings().uiZoom,1.25);assert.equal(target.settings().onlineEnabled,false);
 assert.deepEqual(target.getRaw(asset.record.id).manual,asset.record.manual);assert.deepEqual(target.getRaw(existing.record.id),existing.record);assertSourceUnchanged(asset);assertSourceUnchanged(existing);
});

test('malformed imported concurrency uses the safe default without losing asset metadata',t=>{
 const f=fixture(t),store=f.open(),asset=addAsset(store,f.roots[0]);store.saveSettings({downloadConcurrency:4,backupDir:f.backupDir,uiZoom:1.5});
 const original=path.join(f.base,'export.json');store.exportData(original);const backup=JSON.parse(fs.readFileSync(original,'utf8'));backup.version=1;
 for(const [index,value] of [0,7,2.5,'5',null].entries()){
  backup.settings.downloadConcurrency=value;const file=path.join(f.base,`invalid-${index}.json`);fs.writeFileSync(file,JSON.stringify(backup));const target=f.open(path.join(f.base,`import-${index}`));target.importData(file);
  assert.equal(target.settings().downloadConcurrency,3);assert.equal(target.settings().uiZoom,1.5);assert.equal(target.settings().backupDir,f.backupDir);assert.deepEqual(target.getRaw(asset.record.id).manual,asset.record.manual);target.close();
 }
 assertSourceUnchanged(asset);
});
