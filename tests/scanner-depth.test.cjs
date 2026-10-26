const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Store}=require('../dist/main/main/store'),{Scanner}=require('../dist/main/main/scanner');

function fixture(t){const area=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-depth-')),root=path.join(area,'Source'),data=path.join(area,'Library');fs.mkdirSync(root);const store=new Store(data,[root]);t.after(()=>{store.close();const relative=path.relative(fs.realpathSync(os.tmpdir()),fs.realpathSync(area));assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(area).startsWith('vrc-depth-'));fs.rmSync(area,{recursive:true,force:true,maxRetries:3})});return {area,root,store,scanner:new Scanner(store)}}
function write(file,bytes='synthetic source'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file}
function deep(root,n=40){return path.join(root,...Array.from({length:n},(_,i)=>'d'+i))}
function zip(name){const text=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(text.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(text.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+text.length,12);end.writeUInt32LE(local.length+text.length,16);return Buffer.concat([local,text,central,text,end])}
function snapshot(root){const out={};for(const e of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,e.name);out[e.name]=e.isSymbolicLink()?'LINK':e.isDirectory()?snapshot(file):crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}return out}

test('scan reaches category shelves and archive records through forty ordinary parent folders',async t=>{
 const f=fixture(t),shelf=path.join(deep(f.root),'衣服'),packages=['Dress_Airi.zip','Hair_Airi.rar','Prop_Airi.7z'].map(name=>write(path.join(shelf,name),zip('Airi.prefab'))),product=path.join(shelf,'Distinct outfit');write(path.join(product,'Assets','Outfit_Airi.fbx'));const before=snapshot(f.root);
 await f.scanner.scan();const rows=f.store.all();for(const source of packages)assert(rows.some(r=>r.path===source&&r.kind==='archive'),'missing archive: '+source);assert(rows.some(r=>r.path===product));assert.equal(rows.length,4);assert.deepEqual(f.scanner.progress().errors,[]);assert.deepEqual(snapshot(f.root),before);
});

test('organizational folder recursion has no silent thirty-two-level cutoff',async t=>{
 const f=fixture(t),source=write(path.join(f.root,...Array(38).fill('new folder'),'Dress_Airi.zip'),zip('Airi.prefab'));await f.scanner.scan();assert(f.store.all().some(r=>r.path===source));assert.deepEqual(f.scanner.progress().errors,[]);
});

test('deep Unity projects and their sibling archives are discovered without indexing project internals',async t=>{
 const f=fixture(t),parent=deep(f.root),project=path.join(parent,'Avatar project'),archive=write(path.join(parent,'Dress_Airi.zip'),zip('Airi.prefab'));for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,name),{recursive:true});write(path.join(project,'Library','DoNotIndex.zip'),zip('Secret.prefab'));const before=snapshot(f.root);
 await f.scanner.scan();assert(f.store.all().some(r=>r.path===project&&r.kind==='unity-project'));assert(f.store.all().some(r=>r.path===archive));assert.equal(f.store.all().length,2);assert.deepEqual(snapshot(f.root),before);
});

test('deep archive evidence inside a product is read without splitting or altering the product',async t=>{
 const f=fixture(t),product=path.join(f.root,'Bundled outfit');write(path.join(product,'Surface.fbx'));write(path.join(deep(product),'Variant.zip'),zip('Airi.prefab'));const before=snapshot(f.root);
 await f.scanner.scan();const rows=f.store.all();assert.equal(rows.length,1);assert.equal(rows[0].path,product);assert(rows[0].localAvatars.includes('Airi'));assert.deepEqual(snapshot(f.root),before);
});

test('folder file listing reaches a deeply nested archive while still excluding directory links',async t=>{
 const f=fixture(t),product=path.join(f.root,'Bundled outfit');write(path.join(product,'Surface.fbx'));const archive=write(path.join(deep(product),'Variant_Airi.zip'),zip('Airi.prefab')),outside=path.join(f.area,'Outside');write(path.join(outside,'Private.fbx'));fs.symlinkSync(outside,path.join(product,'linked'),process.platform==='win32'?'junction':'dir');const before=snapshot(f.root);
 await f.scanner.scan();const row=f.store.all().find(r=>r.path===product),listing=await f.scanner.files(row.id);assert(listing.entries.some(e=>e.name===path.relative(product,archive)));assert.equal(listing.truncated,false);assert(!listing.entries.some(e=>e.name.includes('Private.fbx')));assert.deepEqual(snapshot(f.root),before);
});

test('the dedicated avatar-work tree finds projects below forty organizational levels',async t=>{
 const f=fixture(t),project=path.join(deep(path.join(f.root,'改模')),'Avatar project');for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,name),{recursive:true});const before=snapshot(f.root);
 await f.scanner.scan();assert(f.store.all().some(r=>r.path===project&&r.kind==='unity-project'));assert.equal(f.store.all().length,1);assert.deepEqual(snapshot(f.root),before);
});

test('large folder listings retain the entry limit and explicitly report omitted files',async t=>{
 const f=fixture(t),product=path.join(f.root,'Large product');for(let i=0;i<2005;i++)write(path.join(product,'file-'+String(i).padStart(4,'0')+'.fbx'));const before=snapshot(f.root);
 await f.scanner.scan();const row=f.store.all().find(r=>r.path===product),listing=await f.scanner.files(row.id);assert.equal(listing.entries.length,2000);assert.equal(listing.truncated,true);assert.match(listing.message,/2000.*上限/);assert.deepEqual(snapshot(f.root),before);
});
