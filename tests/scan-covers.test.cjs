const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const repository=path.resolve(__dirname,'..'),sourceRoot=path.join(repository,'src');
const loaded=new Map();
function sourceModule(relative){
 const filename=path.resolve(sourceRoot,relative);assert(fs.existsSync(filename),`source module exists: ${relative}`);
 if(loaded.has(filename))return loaded.get(filename).exports;
 const item=new Module(filename,module);item.filename=filename;item.paths=Module._nodeModulePaths(path.dirname(filename));loaded.set(filename,item);
 const ordinary=item.require.bind(item);item.require=name=>name.startsWith('.')?sourceModule(path.relative(sourceRoot,path.resolve(path.dirname(filename),name+'.ts'))):ordinary(name);
 item._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:filename}).outputText,filename);return item.exports;
}
function pair(names){return sourceModule('main/scan-covers.ts').pairScanCovers(names)}

test('exact local package stems pair Unicode covers across supported package and image formats',()=>{
 for(const extension of ['zip','rar','7z','unitypackage'])for(const image of ['png','jpg','jpeg','webp','gif','bmp']){
  const archive=`鸭鸭_v1.2_Airi.${extension}`,cover=`鸭鸭_v1.2_Airi.${image}`,result=pair([archive,cover,'body_normal.png']);
  assert.equal(result.previews.get(archive),cover);assert.deepEqual([...result.companions],[cover]);assert.deepEqual(result.owners.get(cover),[archive]);
 }
 assert.equal(pair(['DRESS.ZIP','dress.JPG']).previews.get('DRESS.ZIP'),'dress.JPG');
 assert.equal(pair(['Ｄｒｅｓｓ.zip','Dress.png']).previews.get('Ｄｒｅｓｓ.zip'),'Dress.png');
});

test('complete package names and explicit cover suffixes pair without assigning generic cover names',()=>{
 const result=pair(['鸭鸭.rar','鸭鸭.rar.png','Dress.zip','Dress-cover.jpg','Other.7z','Other_封面.webp','cover.png','preview.jpg']);
 assert.equal(result.previews.get('鸭鸭.rar'),'鸭鸭.rar.png');assert.equal(result.previews.get('Dress.zip'),'Dress-cover.jpg');assert.equal(result.previews.get('Other.7z'),'Other_封面.webp');
 assert(!result.companions.has('cover.png'));assert(!result.companions.has('preview.jpg'));
});

test('exact stems beat explicit suffixes and image priority is stable regardless of enumeration order',()=>{
 const names=['Duck.zip','Duck.rar','Duck.jpg','Duck.png','Duck.jpeg','Duck.webp','Duck.gif','Duck.bmp','Duck-cover.png'];
 for(const ordered of [names,[...names].reverse()]){
  const result=pair(ordered);assert.equal(result.previews.get('Duck.zip'),'Duck.png');assert.equal(result.previews.get('Duck.rar'),'Duck.png');assert.equal(result.companions.size,7);
 }
 assert.equal(pair(['Duck.zip','Duck.jpg','Duck-cover.png']).previews.get('Duck.zip'),'Duck.jpg');
 const exact=pair(['Duck.zip','Duck_cover.zip','Duck_cover.png']);assert.equal(exact.previews.get('Duck_cover.zip'),'Duck_cover.png');assert(!exact.previews.has('Duck.zip'));
});

test('normalization collisions and package-name ambiguities cannot cross-bind products',()=>{
 for(const names of [['A.zip','Ａ.zip','A.png'],['Dress.zip','dress.rar','dress.png'],['A.zip','A.zip.zip','A.zip.png']]){
  const result=pair(names);assert.equal(result.previews.size,0);assert.equal(result.companions.size,0);
 }
});

test('version and avatar suffixes remain identities and unpaired image materials remain independent',()=>{
 const result=pair(['Dress_v1_Airi.zip','Dress_v2_Airi.png','Dress_v1_Maya.png','Dress.png','Dress_v1_Airi_normal.png','Dress_v1_Airi_mask.jpg','art.png','cover.png','Dress_v1_Airi.psd']);
 assert.equal(result.previews.size,0);assert.equal(result.companions.size,0);
 assert.equal(pair(['Body.unitypackage','Textures/Body.png','../Body.png','C:\\Body.png']).companions.size,0);
});

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1EAAAAASUVORK5CYII=','base64');
function fixture(t,name='Root',roots=true){
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-scan-covers-')),root=path.join(area,name),data=path.join(area,'Library');fs.mkdirSync(root);const {Store}=sourceModule('main/store.ts'),{Scanner}=sourceModule('main/scanner.ts');const store=new Store(data,roots?[root]:[]);
 t.after(()=>{try{store.close()}catch{}const relative=path.relative(__dirname,area);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(area,{recursive:true,force:true,maxRetries:5})});
 return {area,root,data,store,Scanner,write:(name,bytes=png)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file}};
}
function manifest(root){const crypto=require('node:crypto'),result={};for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);result[entry.name]=entry.isSymbolicLink()?'LINK':entry.isDirectory()?manifest(file):crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}return result}

test('root, avatar and category scans adopt same-name covers while independent image materials survive',async t=>{
 for(const layout of ['root','avatar','category']){
  const f=fixture(t,layout==='category'?'衣服':'Root'),prefix=layout==='avatar'?'Airi/':'';
  const archive=f.write(prefix+'鸭鸭_Airi.rar',Buffer.from('synthetic archive')),cover=f.write(prefix+'鸭鸭_Airi.png');f.write(prefix+'鸭鸭_Airi.jpg');f.write(prefix+'独立画作.webp');f.write(prefix+'body_normal.png');const before=manifest(f.root);
  await new f.Scanner(f.store).scan();const item=f.store.all().find(item=>item.path===archive);assert(item?.previewFile,`${layout} package receives its sibling preview`);
  assert.deepEqual(fs.readFileSync(path.join(f.data,'cache',item.previewFile)),fs.readFileSync(cover));
  assert.equal(f.store.list().total,3,`${layout} keeps only package and two independent images`);assert(!f.store.all().some(item=>item.path===cover));assert(f.store.all().some(item=>item.name==='body_normal.png'));assert.deepEqual(manifest(f.root),before);
 }
});

test('explicit package selection never enumerates siblings; simultaneous selected package and cover survive rescans',async t=>{
 const f=fixture(t,'Root',false),archive=f.write('鸭鸭_Airi.7z',Buffer.from('synthetic archive')),cover=f.write('鸭鸭_Airi.7z.png');f.write('Sibling_Airi.unitypackage');const before=manifest(f.root),fsp=require('node:fs/promises'),ordinary=fsp.readdir,enumerated=[];
 fsp.readdir=async function(directory,...args){enumerated.push(path.resolve(directory));return ordinary.call(this,directory,...args)};
 try{
  await new f.Scanner(f.store).addPaths([archive]);assert.equal(f.store.list().total,1);assert.equal(f.store.all()[0].previewFile,undefined);assert(!enumerated.includes(f.root));
  const result=await new f.Scanner(f.store).addPaths([cover,archive]);assert.equal(result.ids.length,1);assert.equal(f.store.list().total,1);assert(f.store.get(result.ids[0]).previewFile);assert(!enumerated.includes(f.root));
  await new f.Scanner(f.store).scan();assert.equal(f.store.list().total,1);assert(f.store.list().items[0].previewFile);assert(!enumerated.includes(f.root));
 }finally{fsp.readdir=ordinary}
 assert.deepEqual(manifest(f.root),before);
});

test('a directly selected independent image retains its own card and does not inspect an adjacent archive',async t=>{
 const f=fixture(t,'Root',false),cover=f.write('Duck_Airi.png');f.write('Duck_Airi.zip',Buffer.from('synthetic archive'));
 const result=await new f.Scanner(f.store).addPaths([cover]);assert.equal(result.ids.length,1);assert.equal(f.store.list().items[0].path,cover);assert.equal(f.store.list().items[0].kind,'file');assert(f.store.list().items[0].previewFile);assert.equal(f.store.all().length,1);
});

test('a full refresh can pair separately registered direct files without reading their parent directory',async t=>{
 const f=fixture(t,'Root',false),archive=f.write('Duck_Airi.zip',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),fsp=require('node:fs/promises'),ordinary=fsp.readdir,enumerated=[];
 fsp.readdir=async function(directory,...args){enumerated.push(path.resolve(directory));return ordinary.call(this,directory,...args)};
 try{
  await new f.Scanner(f.store).addPaths([archive]);await new f.Scanner(f.store).addPaths([cover]);assert.equal(f.store.list().total,2);assert.equal(f.store.all().find(item=>item.path===archive).previewFile,undefined);
  await new f.Scanner(f.store).scan();assert.equal(f.store.list().total,1);assert.equal(f.store.list().items[0].path,archive);assert(f.store.list().items[0].previewFile);assert(!enumerated.includes(f.root));
 }finally{fsp.readdir=ordinary}
});

test('old unannotated companion rows remain live raw identities while annotated images stay independent',async t=>{
 const f=fixture(t),archive=f.write('Duck_Airi.zip',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),annotated=f.write('Duck_Airi.jpg');
 const input=file=>({path:file,name:path.basename(file),kind:'file',group:'Root',size:png.length,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]});
 const old=f.store.upsertScan(input(cover)),manual=f.store.upsertScan(input(annotated));f.store.updateManual([manual.id],{title:'我的原图',notes:'KEEP PRIVATE NOTE',tags:['art'],favorite:true});
 await new f.Scanner(f.store).scan();assert(f.store.all().find(item=>item.path===archive).previewFile);assert.equal(f.store.list().total,2);assert.equal(f.store.getRaw(old.id).missing,false);assert.equal(f.store.getRaw(old.id).path,cover);assert.equal(f.store.getRaw(manual.id).manual.notes,'KEEP PRIVATE NOTE');assert(f.store.get(manual.id));
});

test('inactive or linked companions do not become package covers or hide independent image records',async t=>{
 const f=fixture(t),archive=f.write('Duck_Airi.rar',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png');f.store.removeRoot(cover);assert.equal(f.store.isPathActive(cover),false);
 await new f.Scanner(f.store).scan();assert.equal(f.store.all().find(item=>item.path===archive).previewFile,undefined);
 const other=f.write('Other_Airi.zip',Buffer.from('synthetic archive')),outside=path.join(f.area,'Outside.png');fs.writeFileSync(outside,png);
 try{fs.symlinkSync(outside,path.join(f.root,'Other_Airi.png'))}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('file symlink unavailable on this host');return}throw error}
 await new f.Scanner(f.store).scan();assert.equal(f.store.all().find(item=>item.path===other).previewFile,undefined);
});

test('cancelling during cover copy does not suppress an old standalone image or commit an unfinished package',async t=>{
 const f=fixture(t),archive=f.write('Duck_Airi.rar',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),old=f.store.upsertScan({path:cover,name:path.basename(cover),kind:'file',group:'Root',size:png.length,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]});
 const fsp=require('node:fs/promises'),ordinary=fsp.readFile;let release,entered;const blocked=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
 fsp.readFile=async function(file,...args){if(path.resolve(file)===cover){entered();await gate}return ordinary.call(this,file,...args)};
 const scanner=new f.Scanner(f.store);let work;
 try{work=scanner.scan();await Promise.race([blocked,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('package cover was never read')),2000);timeout.unref()})]);scanner.cancel();release();await work;assert(f.store.get(old.id));assert.equal(f.store.getRaw(old.id).missing,false);assert(!f.store.all().some(item=>item.path===archive))}finally{release();fsp.readFile=ordinary;if(work)await work}
});

test('a failed package commit or failed cover copy never suppresses an existing independent image',async t=>{
 for(const failure of ['commit','copy']){
  const f=fixture(t),archive=f.write('Duck_Airi.rar',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),old=f.store.upsertScan({path:cover,name:path.basename(cover),kind:'file',group:'Root',size:png.length,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]}),fsp=require('node:fs/promises'),read=fsp.readFile,upsert=f.store.upsertScan.bind(f.store);
  if(failure==='commit')f.store.upsertScan=input=>{if(input.path===archive)throw new Error('synthetic failed package commit');return upsert(input)};
  else fsp.readFile=async function(file,...args){if(path.resolve(file)===cover)throw Object.assign(new Error('synthetic unreadable image'),{code:'EACCES'});return read.call(this,file,...args)};
  try{await new f.Scanner(f.store).scan();assert(f.store.get(old.id));assert.equal(f.store.getRaw(old.id).missing,false);assert.equal(f.store.getRaw(old.id).scanCover,undefined);if(failure==='copy')assert.equal(f.store.all().find(item=>item.path===archive).previewFile,undefined)}finally{fsp.readFile=read;f.store.upsertScan=upsert}
 }
});

test('an oversized preferred image falls back to another supported cover and remains an independent file',async t=>{
 const f=fixture(t),archive=f.write('Duck_Airi.unitypackage',Buffer.from('synthetic archive')),oversized=f.write('Duck_Airi.png'),cover=f.write('Duck_Airi.jpg');fs.truncateSync(oversized,26*1024*1024);
 await new f.Scanner(f.store).scan();const item=f.store.all().find(item=>item.path===archive);assert(item.previewFile.endsWith('.jpg'));assert.deepEqual(fs.readFileSync(path.join(f.data,'cache',item.previewFile)),fs.readFileSync(cover));assert(f.store.all().some(item=>item.path===oversized));assert.equal(f.store.list().total,2);
});

test('a previously suppressed image becomes independent again when its paired package disappears',async t=>{
 const f=fixture(t),archive=f.write('Duck_Airi.zip',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),old=f.store.upsertScan({path:cover,name:path.basename(cover),kind:'file',group:'Root',size:png.length,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]});
 await new f.Scanner(f.store).scan();assert.equal(f.store.get(old.id),null);fs.unlinkSync(archive);await new f.Scanner(f.store).scan();assert(f.store.get(old.id));assert.equal(f.store.getRaw(old.id).missing,false);assert.equal(f.store.getRaw(old.id).scanCover,undefined);
});

test('detaching an image or its owner during the scan cannot commit a late suppression marker',async t=>{
 for(const detached of ['image','owner']){
  const f=fixture(t),archive=f.write('Duck_Airi.rar',Buffer.from('synthetic archive')),cover=f.write('Duck_Airi.png'),old=f.store.upsertScan({path:cover,name:path.basename(cover),kind:'file',group:'Root',size:png.length,mtimeMs:1,localCategory:'未分类',localAvatars:[],hintUrls:[]}),upsert=f.store.upsertScan.bind(f.store);
  f.store.upsertScan=input=>{const item=upsert(input);if(input.path===archive)f.store.removeRoot(detached==='image'?cover:archive);return item};
  try{await new f.Scanner(f.store).scan();assert.equal(f.store.getRaw(old.id).scanCover,undefined,`${detached} source detached before suppression commit`);if(detached==='owner')assert(f.store.get(old.id))}finally{f.store.upsertScan=upsert}
 }
});
