const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {Store}=require('../dist/main/main/store.js');
const {Scanner}=require('../dist/main/main/scanner.js');
const {assertSafeWrite,copyCover}=require('../dist/main/main/safety.js');
const {inferAvatars,inferCategory,isAvatarName,normalizeName}=require('../dist/main/main/hints.js');
const stores=new Set();
function makeStore(...args){const store=new Store(...args);stores.add(store);return store}

function fixture(t){const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-core-'));const root=path.join(base,'素材根目录'),data=path.join(base,'数据');fs.mkdirSync(root);t.after(()=>{for(const store of stores)if(store.dataDir.startsWith(base+path.sep)){try{store.close()}catch{}stores.delete(store)}if(!path.resolve(base).startsWith(path.resolve(__dirname)+path.sep))throw new Error('Invalid fixture cleanup path');fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});return {base,root,data}}
function write(file,value='fixture'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
function snapshot(root){const result={};function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const source=path.join(dir,entry.name),relative=path.relative(root,source);if(entry.isSymbolicLink()){result[relative]='LINK';continue}if(entry.isDirectory()){result[relative]='DIR';walk(source)}else result[relative]=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')}}walk(root);return result}
function zip(name,value){const bytes=Buffer.from(value),filename=Buffer.from(name),crc=zlib.crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);const localBytes=Buffer.concat([local,filename,bytes]),centralBytes=Buffer.concat([central,filename]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(localBytes.length,16);return Buffer.concat([localBytes,centralBytes,end])}
function tarEntry(name,content){const bytes=Buffer.from(content),header=Buffer.alloc(512);header.write(name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);let sum=0;for(const b of header)sum+=b;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512)])}

test('Unicode same-name folder and archive share one card, source files stay unchanged, only named previews are copied',async t=>{
 const {root,data}=fixture(t);const group=path.join(root,'模型AIRI');
 write(path.join(group,'服装_まよ💝','README.txt'),'商品 https://example.com/item/123');
 write(path.join(group,'服装_まよ💝','preview.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=','base64'));
 write(path.join(group,'服装_まよ💝','Texture','body.png'),'not a cover');
 write(path.join(group,'服装_まよ💝.zip'),zip('Assets/服装/素材.txt','こんにちは'));
 write(path.join(group,'似ている (2)','body.png'),'texture only');
 const before=snapshot(root);const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();
 assert.equal(store.stats().total,2);assert.equal(store.all().length,3);assert.equal(store.stats().projects,0);const folder=store.all().find(a=>a.name==='服装_まよ💝');assert.ok(folder.previewFile);assert.deepEqual(folder.hintUrls,['https://example.com/item/123']);assert.deepEqual(folder.localAvatars,['Mayo']);assert.equal(folder.size,0);
 assert.equal(store.all().find(a=>a.name==='似ている (2)').previewFile,undefined);
 const archive=store.all().find(a=>a.kind==='archive'),listing=await scanner.files(archive.id);const archivedFile=listing.entries.find(entry=>entry.name==='服装_まよ💝.zip/Assets/服装/素材.txt');assert.ok(archivedFile);assert.equal(archivedFile.size,Buffer.byteLength('こんにちは'));assert.equal(store.get(archive.id).members.length,2);
 assert.deepEqual(snapshot(root),before);assert.ok(fs.existsSync(path.join(data,'cache',folder.previewFile)));
});

test('nested Unity projects become one card each and software, caches, links are skipped',async t=>{
 const {root,data,base}=fixture(t);for(let i=0;i<13;i++){const project=path.join(root,'改模',i<6?'第一组':'第二组',`Unity工程 ${i} 💎`);for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,name),{recursive:true});write(path.join(project,'Library','deep','cache.zip'),'cache');write(path.join(project,'Assets','素材.unitypackage'),'project internal');}
 write(path.join(root,'unityhub','installer.zip'));write(path.join(root,'VRChat Creator Companion','cache.zip'));write(path.join(root,'Library','ignored.zip'));
 const outside=path.join(base,'外部文件');write(path.join(outside,'不应扫描.zip'));try{fs.symlinkSync(outside,path.join(root,'目录链接'),process.platform==='win32'?'junction':'dir')}catch{t.diagnostic('directory links could not be created on this host')}
 const store=makeStore(data,[root]);await new Scanner(store).scan();assert.equal(store.stats().projects,13);assert.equal(store.stats().total,13);assert.ok(store.all().every(a=>a.kind==='unity-project'&&a.localCategory==='工程'&&a.manual.projectStatus===undefined));
});

test('rescan preserves manual and online fields, backup restores covers and persistence',async t=>{
 const {root,data,base}=fixture(t);write(path.join(root,'模型AIRI','商品衣装','cover.png'),'cover data');const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();const item=store.all()[0];
 store.updateManual([item.id],{title:'我的版本',category:'服装',tags:['自定义'],avatars:['Airi'],favorite:true,notes:'私有说明',relatedIds:[item.id]});store.updateOnline(item.id,{title:'商品标题',author:'原作者',category:'饰品',avatars:['Airi','Mayo'],status:'matched'});
 await scanner.scan();let restored=store.get(item.id);assert.equal(restored.manual.title,'我的版本');assert.equal(restored.online.title,'商品标题');assert.equal(store.list({category:'服装',search:'原作者'}).total,1);assert.deepEqual(restored.manual.avatars,['Airi']);
 const backup=path.join(base,'备份.json');store.exportData(backup);assert.ok(JSON.parse(fs.readFileSync(backup,'utf8')).covers[item.previewFile]);store.close();
 const reopened=makeStore(data,[root]);assert.equal(reopened.get(item.id).manual.notes,'私有说明');reopened.close();const imported=makeStore(path.join(base,'新数据'),[root]);imported.importData(backup);restored=imported.get(item.id);assert.equal(restored.manual.title,'我的版本');assert.ok(fs.existsSync(path.join(imported.dataDir,'cache',restored.previewFile)));assert.equal(imported.stats().favorites,1);
 assert.throws(()=>imported.exportData(path.join(root,'不允许的备份.json')),/保护/);assert.equal(fs.existsSync(path.join(root,'不允许的备份.json')),false);
});

test('failed root and excluded subtree do not mark existing cards missing; successful removal does',async t=>{
 const {root,data,base}=fixture(t);const group=path.join(root,'模型AIRI'),folder=path.join(group,'衣装');write(path.join(folder,'readme.txt'));const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();const id=store.all()[0].id;
 fs.renameSync(root,path.join(base,'暂不可用'));await scanner.scan();assert.equal(store.get(id).missing,false);assert.ok(scanner.progress().errors.length);fs.renameSync(path.join(base,'暂不可用'),root);
 const original=fsp.readdir;fsp.readdir=async function(source,...args){if(source===group){const error=new Error('fixture denied');error.code='EACCES';throw error}return original.call(this,source,...args)};
 try{await scanner.scan();assert.equal(store.get(id).missing,false)}finally{fsp.readdir=original}
 fs.rmSync(folder,{recursive:true});await scanner.scan();assert.equal(store.get(id).missing,true);assert.equal(store.get(id).manual.favorite,undefined);
});

test('cancelled scan leaves unseen cards present and concurrent scans share one task',async t=>{
 const {root,data}=fixture(t);write(path.join(root,'模型AIRI','A衣装','readme.txt'));write(path.join(root,'模型AIRI','B衣装','readme.txt'));const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();fs.rmSync(path.join(root,'模型AIRI','B衣装'),{recursive:true});let cancelling;const canceller=new Scanner(store,p=>{if(p.found===1)cancelling.cancel()});cancelling=canceller;const first=canceller.scan();assert.strictEqual(canceller.scan(),first);await first;assert.equal(store.all().find(a=>a.name==='B衣装').missing,false);
});

test('write guard rejects source, escapes and destination junctions',async t=>{
 const {root,data,base}=fixture(t);fs.mkdirSync(data);assert.throws(()=>assertSafeWrite(path.join(root,'output.json'),data,[root],true),/保护/);assert.throws(()=>assertSafeWrite(path.join(data,'..','escape'),data,[root]),/资料库/);assert.throws(()=>new Store(path.join(root,'数据'),[root]),/保护/);
 const outside=path.join(base,'真实目标');fs.mkdirSync(outside);try{fs.symlinkSync(outside,path.join(data,'链接'),process.platform==='win32'?'junction':'dir');assert.throws(()=>assertSafeWrite(path.join(data,'链接','write.json'),data,[root]),/目录链接/)}catch(error){if(error.code!=='EPERM')throw error;t.diagnostic('link creation unavailable')}
 write(path.join(root,'texture.png'),'image');const copied=await copyCover(path.join(root,'texture.png'),data,[root]);assert.ok(fs.existsSync(path.join(data,'cache',copied)));assert.equal(fs.readFileSync(path.join(root,'texture.png'),'utf8'),'image');
 assert.equal(normalizeName('BCP-17 Rho [FULLSET].zip'),'bcp 17 rho');assert.deepEqual(inferAvatars('Airi_Milltina まよ 瑞希'),['Airi','Mayo','Milltina','Mizuki']);
 assert.equal(inferCategory('Airi'),'模型');assert.equal(inferCategory('Airi Ver1.01'),'模型');assert.equal(inferCategory('Chiffon_v1.00_20240102.unitypackage'),'模型');assert.equal(inferCategory('Airi(1)'),'模型');assert.equal(inferCategory('Airi dress v1.01'),'服装');assert.equal(inferCategory('Airi_ALL_Ethereal_Glow'),'未分类');
});

test('Unitypackage listing reads Unicode pathname records without extraction',async t=>{
 const {root,data}=fixture(t);write(path.join(root,'服装.unitypackage'),zlib.gzipSync(Buffer.concat([tarEntry('abc/asset','asset bytes'),tarEntry('abc/pathname','Assets/日本語💝/服装.prefab'),Buffer.alloc(1024)])));const before=snapshot(root);const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();const listing=await scanner.files(store.all()[0].id);assert.deepEqual(listing.entries,[{name:'Assets/日本語💝/服装.prefab',size:11,directory:false}]);assert.deepEqual(snapshot(root),before);
});

test('overlapping source roots do not duplicate scans or mark the aggregation card missing',async t=>{
 const {root,data}=fixture(t);const child=path.join(root,'收集素材');write(path.join(child,'服装.unitypackage'),'fixture');const store=makeStore(data,[root]);const scanner=new Scanner(store);await scanner.scan();assert.equal(store.stats().total,1);const original=store.all()[0];assert.equal(original.kind,'folder');store.saveSettings({roots:[root,child]});await scanner.scan();assert.equal(store.stats().total,1);assert.equal(scanner.progress().found,1);assert.equal(store.get(original.id).missing,false);
});

test('generic containers find nested Unity projects, while exact bilingual avatar roots group materials',async t=>{
 const {root,data}=fixture(t);const container=path.join(root,'成品');const project=path.join(container,'分组','完成品 Unity');for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,name),{recursive:true});write(path.join(project,'Assets','internal.zip'),'internal project package');write(path.join(container,'分组','完成品 Unity.zip'),zip('readme.txt','package'));write(path.join(container,'工程备份.7z'),'archive');
 const avatar=path.join(root,'森羅 Shinra');write(path.join(avatar,'冬服','Assets','Textures','texture.png'),'texture');write(path.join(avatar,'冬服.zip'),zip('服装.txt','clothes'));
 write(path.join(root,'Airi dress','Assets','服装素材','inside.zip'),'ordinary package');write(path.join(root,'Airi dress','Assets','服装素材','README.txt'),'not a Unity project');
 const before=snapshot(root),store=makeStore(data,[root]),scanner=new Scanner(store);await scanner.scan();assert.equal(store.stats().projects,1);assert.equal(store.stats().total,5);assert.equal(store.all().length,6);assert.equal(store.all().some(a=>a.path===container),false);assert.equal(store.all().some(a=>a.name==='internal.zip'),false);assert.equal(store.all().filter(a=>a.group==='森羅 Shinra').length,2);assert.deepEqual(inferAvatars('森羅 Shinra'),['Shinra']);assert.equal(isAvatarName('森羅 Shinra'),true);assert.equal(isAvatarName('Airi dress'),false);assert.equal(store.all().find(a=>a.name==='Airi dress').kind,'folder');assert.equal(store.all().some(a=>a.name==='inside.zip'),false);assert.deepEqual(snapshot(root),before);
});
