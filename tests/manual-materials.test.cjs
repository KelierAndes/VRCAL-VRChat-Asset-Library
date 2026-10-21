const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../dist/main/main/store'),{Scanner}=require('../dist/main/main/scanner');
function fixture(t){const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-manual-add-')),root=path.join(area,'Existing'),data=path.join(area,'Library'),stores=[];fs.mkdirSync(root);t.after(()=>{for(const s of stores)try{s.close()}catch{}assert(path.relative(__dirname,area)&&!path.relative(__dirname,area).startsWith('..'));fs.rmSync(area,{recursive:true,force:true,maxRetries:5})});return {area,root,data,open:(d=data,roots=[root])=>{const s=new Store(d,roots);stores.push(s);return s}}}
function write(file,bytes='READ ONLY SOURCE'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file}
function manifest(root){const result={};for(const e of fs.readdirSync(root,{withFileTypes:true})){const f=path.join(root,e.name);result[e.name]=e.isSymbolicLink()?'LINK':e.isDirectory()?manifest(f):crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}return result}

test('manual folder recognition only reads the selected branch and repeat drops preserve confirmed data',async t=>{
 const f=fixture(t),store=f.open(),scanner=new Scanner(store);assert.equal(typeof scanner.addPaths,'function');
 const old=write(path.join(f.root,'Previous_Airi.fbx')),record=store.upsertScan({path:old,name:path.basename(old),kind:'file',group:'Original',size:1,mtimeMs:1,localCategory:'模型',localAvatars:[],hintUrls:[]});
 const folder=path.join(f.root,'New Dress 日本語 😀');write(path.join(folder,'Dress_Airi.unitypackage'));write(path.join(f.root,'DoNotRead','Hair_Airi.unitypackage'));const before=manifest(f.root),oldBefore=store.getRaw(record.id);
 const result=await scanner.addPaths([folder,folder]);assert.equal(result.added,1);assert.equal(result.updated,0);assert.equal(result.errors.length,0);assert.equal(result.ids.length,1);assert.deepEqual(store.getRaw(record.id),oldBefore);assert(!store.all().some(a=>a.path.includes('DoNotRead')));
 const id=result.ids[0];store.updateManual([id],{title:'Personal',notes:'KEEP',tags:['manual']});store.updateOnline(id,{status:'matched',url:'https://booth.pm/items/7643173',title:'Official',confirmedSource:true});
 const again=await scanner.addPaths([folder]);assert.equal(again.added,0);assert.equal(again.updated,1);assert.equal(again.ids[0],id);assert.equal(store.get(id).manual.notes,'KEEP');assert.equal(store.get(id).online.confirmedSource,true);assert.deepEqual(manifest(f.root),before);
});

test('outside folders and exact package paths persist without authorizing or scanning their siblings',async t=>{
 const f=fixture(t),store=f.open(),folder=path.join(f.area,'External','Outfit'),file=write(path.join(f.area,'External','Hair_Airi.unitypackage'));write(path.join(folder,'Dress_Airi.unitypackage'));write(path.join(f.area,'External','Sibling_Airi.unitypackage'));const before=manifest(path.join(f.area,'External'));
 const result=await new Scanner(store).addPaths([folder,file]);assert.equal(result.added,2);assert.deepEqual(new Set(store.settings().directSources),new Set([folder,file]));assert(!store.settings().roots.includes(path.dirname(file)));
 store.updateManual(result.ids,{notes:'RESTORE'});const backup=path.join(f.area,'backup.json');store.exportData(backup);store.close();const reopened=f.open();assert.equal(reopened.list().total,2);await new Scanner(reopened).scan();assert.equal(reopened.list().total,2);assert(!reopened.all().some(a=>a.path.endsWith('Sibling_Airi.unitypackage')));for(const id of result.ids)assert.equal(reopened.get(id).manual.notes,'RESTORE');
 const restored=f.open(path.join(f.area,'Restored'),[]);restored.importData(backup);assert.deepEqual(new Set(restored.settings().directSources),new Set([folder,file]));await new Scanner(restored).scan();assert.equal(restored.list().total,2);assert.deepEqual(manifest(path.join(f.area,'External')),before);
 reopened.removeRoot(folder);assert(!reopened.settings().directSources.includes(folder));assert.equal(reopened.get(result.ids.find(id=>reopened.getRaw(id).path===folder)),null);await new Scanner(reopened).addPaths([folder]);assert.equal(reopened.list().total,2);
});

test('manual add rejects library/backup overlap, drive roots, unsupported files and directory links without registering them',async t=>{
 const f=fixture(t),store=f.open(),backup=path.join(f.area,'Backups');fs.mkdirSync(backup);store.saveSettings({backupDir:backup});const bad=write(path.join(f.area,'run.exe')),link=path.join(f.area,'link'),outside=path.join(f.area,'Outside');fs.mkdirSync(outside);fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');const before=store.settings();
 const result=await new Scanner(store).addPaths([f.data,path.join(f.data,'cache'),backup,f.area,path.parse(f.area).root,bad,link]);assert.equal(result.added,0);assert.equal(result.errors.length,7);assert.deepEqual(store.settings(),before);
 await assert.rejects(()=>new Scanner(store).addPaths(['relative']),/路径|绝对/);await assert.rejects(()=>new Scanner(store).addPaths(Array(101).fill(outside)),/100/);
});

test('manual add shares the existing scan lock instead of losing drops inside a running full scan',async t=>{
 const f=fixture(t),store=f.open(),scanner=new Scanner(store);const folder=path.join(f.root,'Airi Outfit');write(path.join(folder,'Dress_Airi.unitypackage'));const active=scanner.scan();await assert.rejects(()=>scanner.addPaths([folder]),/扫描|读取/);await active;assert.equal(scanner.progress().running,false);
});

test('overlapping dropped selections remain one bundle; missing direct files retain their annotations',async t=>{
 const f=fixture(t),store=f.open(),folder=path.join(f.area,'Dress'),file=write(path.join(folder,'Dress_Airi.unitypackage')),scanner=new Scanner(store);
 const result=await scanner.addPaths([folder,file]);assert.equal(result.added,1);assert.deepEqual(store.settings().directSources,[folder]);assert.equal(store.list().total,1);
 const separate=write(path.join(f.area,'Separate_Airi.unitypackage')),second=await scanner.addPaths([separate]);store.updateManual(second.ids,{notes:'KEEP MISSING'});fs.unlinkSync(separate);await scanner.scan();assert.equal(store.get(second.ids[0]).missing,true);assert.equal(store.get(second.ids[0]).manual.notes,'KEEP MISSING');
});

test('removing a manually added nested path excludes it from its registered parent while retaining an explicit deeper source',async t=>{
 const f=fixture(t),store=f.open(),folder=path.join(f.root,'Airi Dress'),deep=path.join(folder,'Independent Hair');write(path.join(folder,'Dress_Airi.unitypackage'));write(path.join(deep,'Hair_Airi.unitypackage'));const scanner=new Scanner(store),first=await scanner.addPaths([folder]),second=await scanner.addPaths([deep]);
 store.updateManual(first.ids,{notes:'HIDDEN BUT KEPT'});store.removeRoot(folder);assert.equal(store.get(first.ids[0]),null);assert(store.get(second.ids[0]));assert(!store.isPathActive(path.join(folder,'Dress_Airi.unitypackage')));await scanner.scan();assert.equal(store.get(first.ids[0]),null);assert(store.get(second.ids[0]));assert.equal(store.getRaw(first.ids[0]).manual.notes,'HIDDEN BUT KEPT');
 await scanner.addPaths([folder]);assert.equal(store.get(first.ids[0]).manual.notes,'HIDDEN BUT KEPT');
});

test('a detached Unity project still protects its internal assets from standalone manual registration',async t=>{
 const f=fixture(t),project=path.join(f.area,'Project');for(const part of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,part),{recursive:true});const file=write(path.join(project,'Assets','Dress_Airi.fbx')),store=f.open(f.data,[project]);store.removeRoot(project);const result=await new Scanner(store).addPaths([file]);assert.equal(result.added,0);assert.equal(result.errors.length,1);assert.match(result.errors[0],/工程内部/);assert.deepEqual(store.settings().roots,[]);
});

test('dropping an existing scan root preserves its enumeration mode and refreshes only that root',async t=>{
 const f=fixture(t),other=path.join(f.area,'Other Root'),store=f.open(f.data,[f.root,other]);write(path.join(f.root,'First Dress','Dress_Airi.unitypackage'));const scanner=new Scanner(store);await scanner.scan();write(path.join(f.root,'Second Hair','Hair_Airi.unitypackage'));write(path.join(other,'Unscanned_Airi.unitypackage'));
 const result=await scanner.addPaths([f.root]);assert.equal(result.added,1);assert.equal(result.updated,1);assert.equal(store.list().total,2);assert(!store.all().some(a=>a.path===f.root||a.path.includes('Unscanned')));assert(!(store.settings().directSources??[]).includes(f.root));await scanner.scan();assert.equal(store.list().total,3);
});
