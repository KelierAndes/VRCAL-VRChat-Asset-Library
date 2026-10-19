const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../dist/main/main/store'),{Scanner}=require('../dist/main/main/scanner'),{projectAssets}=require('../dist/main/main/grouping'),{ProjectionIndex}=require('../dist/main/main/projection');

function fixture(t){const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-wrappers-v19-')),root=path.join(base,'素材'),stores=[];fs.mkdirSync(root);t.after(()=>{for(const s of stores)try{s.close()}catch{}assert(path.resolve(base).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});return {base,root,open:()=>{const s=new Store(path.join(base,'私有资料库'),[root]);stores.push(s);return s}}}
function write(file,bytes='private synthetic material'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes)}
function input(source,patch={}){return {path:source,name:path.basename(source),group:'模型AIRI',kind:'folder',size:0,mtimeMs:0,localCategory:'服装',localAvatars:[],hintUrls:[],...patch}}
function record(source,patch={}){return {...input(source),id:crypto.createHash('sha256').update(source).digest('hex').slice(0,24),missing:false,manual:{},online:{status:'pending'},createdAt:'2026-10-19',updatedAt:'2026-10-19',...patch}}
function snapshot(root){const rows={};function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);rows[path.relative(root,full)]=e.isSymbolicLink()?'LINK':e.isDirectory()?'DIR':crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');if(e.isDirectory()&&!e.isSymbolicLink())visit(full)}}visit(root);return rows}

test('scan discovers one wrapper branch through Chinese Japanese emoji names, preserving files and raw outer identity',async t=>{
 const f=fixture(t),outer=path.join(f.root,'模型AIRI','A衣服 日本語 💝'),inner=path.join(outer,'A衣服 日本語 💝'),leaf=path.join(inner,'素材包');
 write(path.join(leaf,'A衣服_Airi.fbx'));write(path.join(outer,'README.txt'),'author license');write(path.join(outer,'LICENSE.md'));write(path.join(outer,'preview_商品.png'));const before=snapshot(f.root),s=f.open();await new Scanner(s).scan();
 const raw=s.all();assert.equal(raw.length,1);assert.deepEqual(raw[0].wrapper,{contentRoot:leaf,chain:[outer,inner,leaf]});assert.equal(raw[0].path,outer);assert.equal(s.list().total,1);assert.equal(s.list().items[0].name,'A衣服 日本語 💝');assert.deepEqual(snapshot(f.root),before);
});

test('numeric and generic download wrappers use substantive inner names and preserve a long physical path',async t=>{
 const f=fixture(t),outer=path.join(f.root,'1234567'),inner=path.join(outer,'downloads'),leaf=path.join(inner,'日本語 💝 '+ '長い衣装名'.repeat(16));write(path.join(leaf,'1234567_Airi.fbx'));const s=f.open();await new Scanner(s).scan();const raw=s.all()[0];assert.deepEqual(raw.wrapper.chain,[outer,inner,leaf]);assert.equal(s.list().items[0].name,path.basename(leaf));
});

test('multiple material branches, extra material files, conflicting product IDs and creators do not create wrapper evidence',async t=>{
 const f=fixture(t);for(const name of ['A衣服','B衣服'])write(path.join(f.root,'多商品',name,name+'.fbx'));
 write(path.join(f.root,'A衣服','A衣服','A衣服.fbx'));write(path.join(f.root,'A衣服','other.fbx'));
 write(path.join(f.root,'1111111','2222222 衣服','衣服.fbx'));
 write(path.join(f.root,'衣服 @AuthorA','衣服 @AuthorB','衣服.fbx'));
 const s=f.open();await new Scanner(s).scan();assert.equal(s.all().length,4);for(const row of s.all())assert.equal(row.wrapper,undefined,row.path);
});

test('root/avatar groups, Unity projects and directory links never become wrapper members',async t=>{
 const f=fixture(t),project=path.join(f.root,'下载','下载','Unity工程');for(const d of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,d),{recursive:true});
 write(path.join(f.root,'模型AIRI','A衣服','A衣服','衣服.fbx'));const target=path.join(f.base,'隔离目标');write(path.join(target,'Airi.fbx'));const linked=path.join(f.root,'链接商品');fs.mkdirSync(linked);fs.symlinkSync(target,path.join(linked,'链接商品'),process.platform==='win32'?'junction':'dir');const before=snapshot(target),s=f.open();await new Scanner(s).scan();
 assert(s.all().some(r=>r.kind==='unity-project'&&r.path===project&&!r.wrapper));assert(!s.all().some(r=>r.path===f.root||r.path===path.join(f.root,'模型AIRI')));assert.equal(s.all().find(r=>r.path===linked).wrapper,undefined);assert.deepEqual(snapshot(target),before);
});

test('extensionless README/license are ancillary, while a nested directory link invalidates the wrapper proof',async t=>{
 const f=fixture(t),safe=path.join(f.root,'安全衣服'),safeInner=path.join(safe,'安全衣服');write(path.join(safeInner,'Airi.fbx'));write(path.join(safe,'README'));write(path.join(safe,'LICENSE'));
 const outer=path.join(f.root,'链接衣服'),inner=path.join(outer,'链接衣服'),target=path.join(f.base,'独立链接目标');write(path.join(inner,'Airi.fbx'));write(path.join(target,'Material.mat'));fs.mkdirSync(path.join(inner,'textures'));fs.symlinkSync(target,path.join(inner,'textures','PrivateLink'),process.platform==='win32'?'junction':'dir');const s=f.open();await new Scanner(s).scan();assert.deepEqual(s.all().find(r=>r.path===safe).wrapper,{contentRoot:safeInner,chain:[safe,safeInner]});assert.equal(s.all().find(r=>r.path===outer).wrapper,undefined);
});

test('old inner rows keep IDs, confirmed online data and individual annotations without becoming missing or duplicating physical files',async t=>{
 const f=fixture(t),outer=path.join(f.root,'A衣服'),inner=path.join(outer,'A衣服'),leaf=path.join(inner,'素材包'),unknown=path.join(leaf,'零散目录');write(path.join(leaf,'Airi.fbx'));write(path.join(unknown,'补充.txt'));
 const s=f.open(),old=s.upsertScan(input(inner,{localAvatars:['Airi'],localEvidence:[{avatar:'Airi',files:[path.join(leaf,'Airi.fbx')],basis:'filename'}],compatibilityComplete:true})),oldLeaf=s.upsertScan(input(leaf)),oldUnknown=s.upsertScan(input(unknown));s.updateManual([old.id],{title:'已确认衣装',notes:'内层原注释',tags:['手动']});s.updateManual([oldLeaf.id],{notes:'素材包原注释'});s.updateOnline(old.id,{status:'matched',url:'https://booth.pm/items/1234567',title:'商品标题',author:'原作者',confirmedSource:true});s.updateAvailability(old.id,true);s.updateAvailability(oldUnknown.id,true);
 const scanner=new Scanner(s);await scanner.scan();assert.equal(s.list().total,2);const card=s.get(old.id);assert.equal(card.path,outer);assert.equal(card.manual.title,'已确认衣装');assert.equal(card.online.confirmedSource,true);assert.equal(card.members.length,3);assert.deepEqual(card.members.map(m=>m.id).sort(),[old.id,oldLeaf.id,s.all().find(r=>r.path===outer).id].sort());assert.equal(s.getRaw(old.id).manual.notes,'内层原注释');assert.equal(s.getRaw(oldLeaf.id).manual.notes,'素材包原注释');for(const raw of s.all())assert.equal(raw.missing,false,raw.path);assert.equal(s.get(oldUnknown.id).id,oldUnknown.id);
 const files=await scanner.files(card.id);assert.equal(files.entries.filter(e=>e.name.endsWith('Airi.fbx')).length,1);assert.equal(files.entries.filter(e=>e.name.endsWith('补充.txt')).length,1);assert.equal(new Set(card.localEvidence.flatMap(e=>e.files)).size,card.localEvidence.flatMap(e=>e.files).length);
});

test('wrapper projection is pure, rejects conflicting identities, and incremental updates rebuild every affected group',()=>{
 const outer=path.resolve('Z:/synthetic/A衣服'),inner=path.join(outer,'A衣服'),leaf=path.join(inner,'素材包'),a=record(outer,{wrapper:{contentRoot:leaf,chain:[outer,inner,leaf]}}),b=record(inner,{online:{status:'matched',url:'https://booth.pm/items/1234567',title:'Inner confirmed'}}),c=record(leaf),unrelated=record(path.resolve('Z:/synthetic/B衣服'));
 const oldRead=fs.readdirSync,oldAsync=fsp.readdir;fs.readdirSync=()=>{throw Error('query must not read directories')};fsp.readdir=async()=>{throw Error('query must not read directories')};try{
 const index=new ProjectionIndex([a,b,c,unrelated]);assert.equal(index.values().length,2);assert.equal(index.get(b.id).id,a.id);assert.equal(index.get(c.id).online.title,'Inner confirmed');const kept=index.get(unrelated.id);const changed={...b,online:{status:'matched',url:'https://booth.pm/items/7654321',title:'Changed'}};index.update(b,changed);assert.deepEqual(index.values(),projectAssets([a,changed,c,unrelated]));assert.equal(index.get(unrelated.id),kept);
 const noEvidence={...a,wrapper:undefined};index.update(a,noEvidence);assert.equal(index.values().length,4);assert.deepEqual(index.values(),projectAssets([noEvidence,changed,c,unrelated]));
 assert.equal(projectAssets([{...a,online:{status:'matched',url:'https://booth.pm/items/1111111'}},b,c]).length,2);
 assert.equal(projectAssets([{...a,manual:{sourceUrl:'https://booth.pm/items/1111111'}},{...b,online:{status:'pending'},manual:{sourceUrl:'https://booth.pm/items/2222222'}},c]).length,2);
 }finally{fs.readdirSync=oldRead;fsp.readdir=oldAsync}
});

test('verified creator aliases allow wrapper projection while genuine author conflicts remain separate',()=>{
 const outer=path.resolve('C:/Synthetic/Lovely Hair @Li-ne'),inner=path.join(outer,'Lovely Hair @Li-ne'),a=record(outer,{wrapper:{contentRoot:inner,chain:[outer,inner]}}),b=record(inner,{online:{status:'matched',url:'https://booth.pm/items/1234567',author:'Li-ne_Shop',authorAliases:['li-ne'],title:'Lovely Hair'}});
 const projected=projectAssets([a,b]);assert.equal(projected.length,1);assert.equal(projected[0].online.author,'Li-ne_Shop');assert.equal(projected[0].members.length,2);
 const plainInner=path.join(outer,'Lovely Hair'),plain={...b,path:plainInner,name:'Lovely Hair'};assert.equal(projectAssets([{...a,wrapper:{contentRoot:plainInner,chain:[outer,plainInner]}},plain]).length,1,'the filename creator and verified display author may have different names');
 assert.equal(projectAssets([a,{...b,online:{...b.online,author:'Different Shop',authorAliases:['different']}}]).length,2,'an unrelated verified creator must remain separate');
 assert.equal(projectAssets([a,{...b,name:'Lovely Hair @Other',online:{...b.online,author:'Other',authorAliases:['different']}}]).length,2,'a different filename creator cannot borrow an unrelated alias');
 const index=new ProjectionIndex([a,{...b,online:{...b.online,authorAliases:[]}}]);assert.equal(index.values().length,2);index.update({...b,online:{...b.online,authorAliases:[]}},b);assert.equal(index.values().length,1);assert.equal(index.get(b.id).id,a.id);
});

test('wrapper metadata roundtrips through private backups and validates bounded consecutive absolute paths',async t=>{
 const f=fixture(t),outer=path.join(f.root,'A衣服'),inner=path.join(outer,'A衣服');write(path.join(inner,'衣服.fbx'));const s=f.open();await new Scanner(s).scan();const raw=s.all()[0],backup=path.join(f.base,'私有备份.json');s.exportData(backup);s.close();const reopen=f.open();assert.deepEqual(reopen.getRaw(raw.id).wrapper,raw.wrapper);
 const {validateWrapper}=require('../dist/main/main/wrappers');assert.deepEqual(validateWrapper(raw.wrapper,outer),raw.wrapper);for(const value of [{contentRoot:inner,chain:[inner,outer]},{contentRoot:inner,chain:[outer,path.join(inner,'跳层')]},{contentRoot:inner,chain:[outer,inner+'\n']},{contentRoot:'relative',chain:[outer,'relative']},{contentRoot:inner,chain:[outer,inner,...Array(32).fill(inner)]}])assert.equal(validateWrapper(value,outer),undefined);
 const payload=JSON.parse(fs.readFileSync(backup,'utf8'));payload.version=1;payload.assets[0].wrapper={contentRoot:f.base,chain:[outer,f.base]};fs.writeFileSync(backup,JSON.stringify(payload));reopen.importData(backup);assert.equal(reopen.getRaw(raw.id).wrapper,undefined);
});
