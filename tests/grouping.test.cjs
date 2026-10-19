const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {Store}=require('../dist/main/main/store.js');
const {Scanner}=require('../dist/main/main/scanner.js');
const {projectAssets,productName}=require('../dist/main/main/grouping.js');
const {inferAvatars}=require('../dist/main/main/hints.js');

function fixture(t){const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-group-')),root=path.join(base,'素材'),data=path.join(base,'资料库');fs.mkdirSync(root);const stores=[];t.after(()=>{for(const store of stores)try{store.close()}catch{}if(!path.resolve(base).startsWith(path.resolve(__dirname)+path.sep))throw new Error('Unsafe fixture path');fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});return {base,root,data,open:(directory=data)=>{const store=new Store(directory,[root]);stores.push(store);return store}}}
function write(file,value='fixture'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
function snapshot(root){const files={};function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory())walk(full);else files[path.relative(root,full)]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}}walk(root);return files}
function zip(name){const bytes=Buffer.from('unchanged data'),filename=Buffer.from(name),crc=zlib.crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);const a=Buffer.concat([local,filename,bytes]),b=Buffer.concat([central,filename]);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(b.length,12);end.writeUInt32LE(a.length,16);return Buffer.concat([a,b,end])}
function record(name,patch={}){return {id:name,path:path.join('Z:\\Fixture','角色目录',name),name,group:'角色目录',kind:name.endsWith('.zip')?'archive':'folder',size:0,mtimeMs:0,missing:false,localCategory:'服装',localAvatars:[],hintUrls:[],manual:{},online:{status:'pending'},createdAt:'2026-10-13',updatedAt:'2026-10-13',...patch}}

test('same-name wrapper and versions aggregate and filenames provide local avatar evidence without modifying originals',async t=>{
 const {root,open}=fixture(t),directory=path.join(root,'模型AIRI','A衣服');
 write(path.join(directory,'A衣服','A衣服_愛莉_v1.1.zip'),zip('Assets/A衣服/服装.prefab'));
 write(path.join(directory,'A衣服','A衣服_しなの.zip'),zip('Assets/A衣服/服装.prefab'));
 write(path.join(directory,'README.txt'),'本商品支持 Airi Manuka Milltina Maya，此说明不是本地版本证据');
 write(path.join(directory,'preview_Manuka.png'),'marketing preview is not an installed avatar variant');
 write(path.join(directory,'Library','A衣服_Maya.zip'),zip('Assets/Maya.prefab'));
 write(path.join(root,'模型AIRI','A衣服_Mayo_v1.2 (2).zip'),zip('Assets/Mayo/服装.prefab'));
 write(path.join(root,'模型AIRI','不一样的B衣服.zip'),zip('Assets/服装.prefab'));
 const before=snapshot(root),store=open(),scanner=new Scanner(store);await scanner.scan();
 assert.equal(store.all().length,3);assert.equal(store.list().total,2);const group=store.list().items.find(item=>item.name==='A衣服');assert.equal(group.members.length,2);assert.deepEqual([...group.localAvatars].sort(),['Airi','Mayo','Shinano']);assert.ok(group.localEvidence.some(e=>e.avatar==='Shinano'&&e.files.some(file=>file.endsWith('A衣服_しなの.zip'))));assert.equal(group.localAvatars.includes('Manuka'),false);assert.equal(group.localAvatars.includes('Maya'),false);assert.deepEqual(snapshot(root),before);assert.equal(store.get(group.members[1].id).id,group.id);
});

test('unnamed fullset ZIP inspects its directory listing; parent avatar directory and readme are not local evidence',async t=>{
 const {root,open}=fixture(t);write(path.join(root,'模型AIRI','Full Clothing.zip'),zip('Assets/服装_ミルティナ/服装.prefab'));write(path.join(root,'模型AIRI','Plain Clothing.zip'),zip('README_Airi_Manuka.txt'));
 const store=open();await new Scanner(store).scan();const clothing=store.list().items.find(item=>item.name==='Full Clothing.zip'),plain=store.list().items.find(item=>item.name==='Plain Clothing.zip');assert.deepEqual(clothing.localAvatars,['Milltina']);assert.equal(clothing.localEvidence[0].basis,'archive-entry');assert.ok(clothing.localEvidence[0].files[0].includes('!/'));assert.deepEqual(plain.localAvatars,[]);assert.equal(plain.compatibilityComplete,false);
});

test('product identity strips versions, copy suffixes, fullset and variants, but does not merge different item IDs or authors',()=>{
 assert.equal(productName('A衣服_Airi_v1.2 (2).zip'),'a衣服');assert.equal(productName('BasicCharm_FULLSET_1.11.zip'),'basiccharm');assert.equal(projectAssets([record('A衣服'),record('A衣服_v1.2.zip')]).length,1);
 assert.equal(productName('BasicCharm_FULLSET_1.11_20260124 (2).zip'),'basiccharm');
 assert.equal(projectAssets([record('1111111 A衣服'),record('2222222 A衣服.zip')]).length,2);
 const commonAvatarLink=['https://booth.pm/items/6082686'];
 assert.equal(projectAssets([record('1234567 Same Dress',{hintUrls:commonAvatarLink}),record('7654321 Same Dress',{hintUrls:commonAvatarLink})]).length,2);
 assert.equal(projectAssets([record('1234567 Same Dress',{hintUrls:commonAvatarLink,online:{status:'matched',url:'https://booth.pm/items/9999999'}}),record('7654321 Same Dress',{hintUrls:commonAvatarLink,online:{status:'matched',url:'https://booth.pm/items/9999999'}})]).length,2);
 assert.equal(projectAssets([record('A衣服 @AuthorA'),record('A衣服 @AuthorB.zip')]).length,2);
 assert.equal(projectAssets([record('8492723 CheriMel @LOVACE'),record('8492723 CheriMel @LOVACE.zip')]).length,1);
 assert.equal(projectAssets([record('A衣服'),record('B衣服.zip')]).length,2);
 assert.equal(projectAssets([record('新建文件夹'),record('新建文件夹 (2).zip')]).length,2);
 assert.equal(projectAssets([record('A衣服',{kind:'unity-project'}),record('A衣服.zip')]).length,2);
 assert.deepEqual(inferAvatars('Ring_Airiness rindoor'),[]);assert.deepEqual(inferAvatars('DressAiri_Milfy_Lasyusha_Ramune_Rurune'),['Airi','Ramune','Milfy','Rurune','Lasyusha']);
});

test('group display preserves different member annotations and raw IDs through rescan and backup restoration',async t=>{
 const {root,base,open}=fixture(t);write(path.join(root,'A衣服','A衣服_Airi.zip'),zip('Assets/Airi.prefab'));write(path.join(root,'A衣服.zip'),zip('Assets/Manuka.prefab'));const store=open(),scanner=new Scanner(store);await scanner.scan();const [a,b]=store.all();store.updateManual([a.id],{title:'个人标题A',notes:'原笔记A',tags:['甲'],favorite:true});store.updateManual([b.id],{title:'个人标题B',notes:'原笔记B',tags:['乙'],avatars:['Mayo']});
 assert.equal(store.list().total,1);const group=store.list().items[0];assert.equal(group.members.length,2);assert.deepEqual([...group.manual.tags].sort(),['乙','甲']);assert.equal(group.manual.favorite,true);assert.ok(group.localAvatars.includes('Mayo'));assert.deepEqual(group.members.map(member=>member.manual.notes).sort(),['原笔记A','原笔记B']);assert.equal(store.getRaw(a.id).manual.notes,'原笔记A');assert.equal(store.getRaw(b.id).manual.notes,'原笔记B');await scanner.scan();assert.equal(store.list().total,1);assert.equal(store.getRaw(b.id).manual.notes,'原笔记B');const backup=path.join(base,'用户选的备份.json');store.exportData(backup);const restored=open(path.join(base,'还原资料库'));restored.importData(backup);assert.equal(restored.list().total,1);assert.equal(restored.all().length,2);assert.ok(restored.list().items[0].localEvidence.some(entry=>entry.basis==='archive-entry'&&entry.avatar==='Manuka'));assert.equal(restored.getRaw(a.id).manual.notes,'原笔记A');
});

test('verified BOOTH identity aggregates role groups without losing filters; local names alone do not cross role directories',async t=>{
 const {root,open}=fixture(t);write(path.join(root,'模型AIRI','A衣服','readme.txt'));write(path.join(root,'模型MAYA','商品新版.zip'),zip('Assets/Maya.prefab'));const store=open();await new Scanner(store).scan();assert.equal(store.list().total,2);const [a,b]=store.all();for(const entry of [a,b])store.updateOnline(entry.id,{status:'matched',url:'https://author.booth.pm/items/1234567',title:'A衣服',author:'作者'});assert.equal(store.list().total,1);assert.equal(store.list({group:'模型AIRI'}).total,1);assert.equal(store.list({group:'模型MAYA'}).total,1);assert.equal(store.list({avatar:'Maya'}).total,1);assert.equal(store.stats().total,1);
 const conflict=projectAssets([record('A衣服',{online:{status:'matched',url:'https://booth.pm/ja/items/1111111',author:'A'}}),record('A衣服.zip',{online:{status:'matched',url:'https://booth.pm/ja/items/2222222',author:'A'}})]);assert.equal(conflict.length,2);
});

test('backup folder and interface zoom persist independently of original files and reject source destinations',t=>{
 const {base,root,data,open}=fixture(t),store=open(),backupDir=path.join(base,'我的备份目录');store.saveSettings({backupDir,uiZoom:1.25});assert.equal(store.settings().backupDir,backupDir);assert.equal(store.settings().uiZoom,1.25);assert.throws(()=>store.saveSettings({backupDir:path.join(root,'禁写')}),/保护/);assert.throws(()=>store.saveSettings({uiZoom:4}),/缩放/);store.close();const reopened=open();assert.equal(reopened.settings().backupDir,backupDir);assert.equal(reopened.settings().uiZoom,1.25);assert.equal(fs.existsSync(backupDir),false);
 const output=path.join(base,'备份.json');reopened.exportData(output);const imported=open(path.join(base,'还原数据'));imported.importData(output);assert.equal(imported.settings().uiZoom,1.25);assert.equal(imported.settings().backupDir,backupDir);assert.equal(imported.dataDir,path.join(base,'还原数据'));
});

test('local avatar dropdown and filtering exclude BOOTH-only variants while search retains product compatibility',async t=>{
 const {root,open}=fixture(t);write(path.join(root,'A衣服_Airi.zip'),zip('Assets/Airi/服装.prefab'));const store=open();await new Scanner(store).scan();const item=store.all()[0];store.updateOnline(item.id,{status:'matched',avatars:['Airi','Manuka']});assert.deepEqual(store.stats().avatars,['Airi']);assert.equal(store.list({avatar:'Manuka'}).total,0);assert.equal(store.list({avatar:'Airi'}).total,1);assert.equal(store.list({search:'Manuka'}).total,1);store.updateManual([item.id],{avatars:['Mayo']});assert.deepEqual(store.stats().avatars,['Airi','Mayo']);assert.equal(store.list({avatar:'Mayo'}).total,1);assert.equal(store.list({avatar:'Manuka'}).total,0);
});
