const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../dist/main/main/store'),{Scanner}=require('../dist/main/main/scanner');

function fixture(t){
 const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-local-names-')),root=path.join(base,'素材'),data=path.join(base,'资料库'),stores=[];fs.mkdirSync(root);
 t.after(()=>{for(const store of stores)try{store.close()}catch{}assert(path.resolve(base).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});
 return {base,root,data,open:(directory=data)=>{const store=new Store(directory,[root]);stores.push(store);return store}};
}
function write(file,value='source fixture'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
function snapshot(root){
 const result={};function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),key=path.relative(root,file);if(entry.isSymbolicLink()){result[key]='LINK';continue}if(entry.isDirectory()){result[key]='DIR';walk(file)}else result[key]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}}walk(root);return result;
}

test('shallow folder and package basenames become local hints while deep dependency names, projects, caches, software and links do not',async t=>{
 const f=fixture(t),source=path.join(f.root,'模型AIRI','素材包装');
 write(path.join(source,'6010027 nadeoto_Airi.zip'));
 write(path.join(source,'第二层包装','7895092 GUILTY_愛莉.unitypackage'));
 write(path.join(source,'第二层包装','另一商品7317173_Airi.7z'));
 write(path.join(source,'第二层包装','第二层目录','秘密依赖1234567_Airi.rar'));
 write(path.join(source,'独立商品6400000_Airi.rar'));
 write(path.join(source,'Assets','1234567 dependency_Airi.zip'));
 write(path.join(source,'Packages','7654321 dependency_Airi.zip'));
 write(path.join(source,'第二层包装','ProjectSettings','1111111 dependency_Airi.zip'));
 for(const directory of ['Library','Temp','node_modules','UnityHub','VRChat Creator Companion'])write(path.join(source,directory,'9999999 cached_Airi.zip'));
 const project=path.join(source,'Unity工程7777777');for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,name),{recursive:true});write(path.join(project,'8888888 internal_Airi.zip'));
 write(path.join(source,'README.txt'),'正文里的隐藏商品9999999，不作为名字线索');
 const outside=path.join(f.base,'外部目录');write(path.join(outside,'6666666 external_Airi.zip'));fs.symlinkSync(outside,path.join(source,'链接5555555'),process.platform==='win32'?'junction':'dir');
 const before=snapshot(f.root),outsideBefore=snapshot(outside),store=f.open();await new Scanner(store).scan();
 const record=store.all().find(a=>a.path===source);assert(record);
 assert.deepEqual([...record.localNameHints].sort(),['6010027 nadeoto_Airi.zip','第二层包装','7895092 GUILTY_愛莉.unitypackage','另一商品7317173_Airi.7z','第二层目录','独立商品6400000_Airi.rar'].sort());
 assert(record.localNameHints.every(name=>!/[\\/]/.test(name)));assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(outside),outsideBefore);
});

test('separate shallow product packages retain all distinct clues up to the 20-name cap without inventing an online match',async t=>{
 const f=fixture(t),source=path.join(f.root,'模型AIRI','多素材收集');
 for(let i=0;i<25;i++)write(path.join(source,`${String(6000000+i)} Product_${i}_Airi.zip`));
 const before=snapshot(f.root),store=f.open();await new Scanner(store).scan();const record=store.all().find(a=>a.path===source);
 assert.equal(record.localNameHints.length,20);assert.equal(new Set(record.localNameHints).size,20);
 assert(record.localNameHints.includes('6000000 Product_0_Airi.zip'));assert(record.localNameHints.includes('6000001 Product_1_Airi.zip'));assert.equal(record.online.status,'pending');assert.deepEqual(record.online.candidates,undefined);assert.deepEqual(snapshot(f.root),before);
});

test('rescan, manual edits, reopening and backup restoration retain local clues and separate manual and online metadata',async t=>{
 const f=fixture(t),source=path.join(f.root,'模型AIRI','CB40-nadeoto');write(path.join(source,'6010027 nadeoto_Airi.zip'));write(path.join(source,'日本語 💝','7895092 GUILTY_愛莉.unitypackage'));
 const before=snapshot(f.root),store=f.open(),scanner=new Scanner(store);await scanner.scan();const original=store.all().find(a=>a.path===source);
 store.updateManual([original.id],{title:'我的包装',notes:'保留私有备注',tags:['手动'],favorite:true});store.updateOnline(original.id,{status:'review',title:'候选商品',author:'作者',candidates:[{url:'https://booth.pm/ja/items/6010027',title:'商品一'},{url:'https://booth.pm/ja/items/7895092',title:'商品二'}]});
 const expected=store.getRaw(original.id);await scanner.scan();assert.deepEqual(store.getRaw(original.id).localNameHints,expected.localNameHints);assert.deepEqual(store.getRaw(original.id).manual,expected.manual);assert.deepEqual(store.getRaw(original.id).online,expected.online);
 const backup=path.join(f.base,'备份.json');store.exportData(backup);const payload=JSON.parse(fs.readFileSync(backup,'utf8'));assert.deepEqual(payload.assets.find(a=>a.id===original.id).localNameHints,expected.localNameHints);store.close();
 const reopened=f.open();assert.deepEqual(reopened.getRaw(original.id).localNameHints,expected.localNameHints);assert.deepEqual(reopened.getRaw(original.id).manual,expected.manual);
 const imported=f.open(path.join(f.base,'恢复资料库'));imported.importData(backup);const restored=imported.getRaw(original.id);assert.deepEqual(restored.localNameHints,expected.localNameHints);assert.deepEqual(restored.manual,expected.manual);assert.deepEqual(restored.online,expected.online);assert.deepEqual(snapshot(f.root),before);
});

test('scan and backup input sanitize local name hints to bounded basenames and support old backups',t=>{
 const f=fixture(t),source=path.join(f.root,'素材.zip');write(source);const store=f.open();
 const dirty=[' 6010027 素材.zip ','6010027 素材.zip','folder/package.zip','folder\\package.zip','E:\\私人文件夹\\package.zip','bad\0name','bad\nname','.', '..',42,null,...Array.from({length:25},(_,i)=>`商品_${i}.zip`)];
 const input={path:source,name:'素材.zip',group:'素材',kind:'archive',size:fs.statSync(source).size,mtimeMs:fs.statSync(source).mtimeMs,localCategory:'未分类',localAvatars:[],hintUrls:[],localNameHints:dirty};
 const record=store.upsertScan(input);assert.equal(record.localNameHints.length,20);assert.equal(record.localNameHints[0],'6010027 素材.zip');assert(record.localNameHints.every(name=>typeof name==='string'&&!/[\\/:\x00-\x1f]/.test(name)&&name!=='.'&&name!=='..'));
 store.updateManual([record.id],{notes:'手改保留'});const backup=path.join(f.base,'备份.json');store.exportData(backup);const payload=JSON.parse(fs.readFileSync(backup,'utf8'));payload.version=1;payload.assets[0].localNameHints=dirty;fs.writeFileSync(backup,JSON.stringify(payload));const target=f.open(path.join(f.base,'清洗导入'));target.importData(backup);assert.deepEqual(target.getRaw(record.id).localNameHints,record.localNameHints);assert.equal(target.getRaw(record.id).manual.notes,'手改保留');
 delete payload.assets[0].localNameHints;fs.writeFileSync(backup,JSON.stringify(payload));const legacy=f.open(path.join(f.base,'旧版导入'));legacy.importData(backup);assert.deepEqual(legacy.getRaw(record.id).localNameHints,[]);assert.equal(legacy.getRaw(record.id).manual.notes,'手改保留');
});

test('candidate author aliases and private cached covers persist and are included in safe backup restoration',async t=>{
 const f=fixture(t),source=path.join(f.root,'包装','6010027 nadeoto_Airi.zip');write(source);const before=snapshot(f.root),store=f.open();await new Scanner(store).scan();const record=store.all()[0];
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=','base64'),file='candidate-preview.png';fs.mkdirSync(path.join(f.data,'cache'),{recursive:true});fs.writeFileSync(path.join(f.data,'cache',file),bytes);
 store.updateManual([record.id],{notes:'保留我的备注',favorite:true});store.updateOnline(record.id,{status:'review',candidates:[{url:'https://booth.pm/ja/items/6010027',title:'商品候选',author:'作者',authorAliases:[' 作者别名 ','作者别名',12,...Array.from({length:25},(_,i)=>`Alias${i}`)],coverUrl:'https://booth.pximg.net/cover.png',coverFile:file}]});
 const candidate=store.getRaw(record.id).online.candidates[0];assert.equal(candidate.authorAliases.length,20);assert.equal(candidate.authorAliases[0],'作者别名');assert.equal(candidate.coverFile,file);
 const backup=path.join(f.base,'候选封面备份.json');store.exportData(backup);const payload=JSON.parse(fs.readFileSync(backup,'utf8'));assert.deepEqual(Buffer.from(payload.covers[file],'base64'),bytes);
 const imported=f.open(path.join(f.base,'候选恢复'));imported.importData(backup);const restored=imported.getRaw(record.id),restoredCandidate=restored.online.candidates[0];assert.equal(restoredCandidate.coverFile,crypto.createHash('sha256').update(bytes).digest('hex')+'.png');assert.deepEqual(fs.readFileSync(path.join(imported.dataDir,'cache',restoredCandidate.coverFile)),bytes);assert.deepEqual(restoredCandidate.authorAliases,candidate.authorAliases);assert.deepEqual(restored.localNameHints,store.getRaw(record.id).localNameHints);assert.equal(restored.manual.notes,'保留我的备注');
 imported.close();const reopened=f.open(path.join(f.base,'候选恢复'));assert.deepEqual(reopened.getRaw(record.id).online.candidates[0],restoredCandidate);assert.deepEqual(snapshot(f.root),before);
});

test('unsafe candidate cover paths and cache links are rejected before changing source records',t=>{
 const f=fixture(t),source=path.join(f.root,'素材.zip');write(source);const store=f.open(),record=store.upsertScan({path:source,name:'素材.zip',group:'素材',kind:'archive',size:1,mtimeMs:0,localCategory:'未分类',localAvatars:[],hintUrls:[],localNameHints:['6010027 商品.zip']});store.updateManual([record.id],{notes:'人工备注'});const saved=store.getRaw(record.id),before=snapshot(f.root);
 for(const file of ['../outside.png','..\\outside.png','E:\\素材\\cover.png','stream:cover.png','bad\0cover.png','bad\ncover.png','.', '..']){assert.throws(()=>store.updateOnline(record.id,{status:'review',candidates:[{url:'https://booth.pm/ja/items/6010027',title:'候选',coverFile:file}]}),/候选封面/);assert.deepEqual(store.getRaw(record.id),saved);}
 const outside=path.join(f.base,'其他目录');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.data,'cache'),process.platform==='win32'?'junction':'dir');assert.throws(()=>store.updateOnline(record.id,{status:'review',candidates:[{url:'https://booth.pm/ja/items/6010027',title:'候选',coverFile:'valid.png'}]}),/目录链接/);assert.deepEqual(store.getRaw(record.id),saved);assert.deepEqual(snapshot(f.root),before);
});
