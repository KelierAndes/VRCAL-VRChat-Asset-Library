const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {projectAssets}=require('../dist/main/main/grouping'),{ProjectionIndex}=require('../dist/main/main/projection');
const directory=label=>path.resolve('Z:/DownloadFixture',label+'--vrcal-'+crypto.randomUUID());
function record(parent,name,patch={}){return {id:crypto.randomUUID(),path:path.join(parent,name),name,group:'百度网盘下载',kind:'archive',size:10,mtimeMs:1,missing:false,localCategory:'未分类',localAvatars:[],hintUrls:[],manual:{},online:{status:'pending'},createdAt:'2026-10-25T00:00:00Z',updatedAt:'2026-10-25T00:00:00Z',...patch}}
const trusted=url=>({status:'pending',url,confirmedSource:true,matchEvidence:{method:'booth-download',signals:['explicit download'],ruleVersion:'1.9.0',recordedAt:'2026-10-25T00:00:00Z'}});

test('trusted pending BOOTH downloads group immediately across task folders before page enrichment',()=>{
 const a=record(directory('BOOTH 456'),'different base.zip',{group:'BOOTH 下载',online:trusted('https://booth.pm/ja/items/456')}),b=record(directory('BOOTH 456'),'MAT_TEX unrelated name.zip',{group:'BOOTH 下载',online:trusted('https://shop.booth.pm/items/456')});
 const projected=projectAssets([a,b]);assert.equal(projected.length,1);assert.equal(projected[0].members.length,2);assert.equal(projected[0].online.status,'pending');
 const index=new ProjectionIndex([a]);index.update(undefined,b);assert.equal(index.values().length,1);assert.equal(index.get(b.id).members.length,2);
});

test('pending URLs without explicit BOOTH download evidence or with manual and rejection conflicts never establish cross-folder identity',()=>{
 const good=record(directory('456'),'base.zip',{group:'BOOTH 下载',online:trusted('https://booth.pm/ja/items/456')});
 for(const change of [
  r=>{r.online.confirmedSource=false},r=>{r.online.matchEvidence.method='name-search'},r=>{r.online.status='review'},r=>{r.manual.matchingMode='manual'},
  r=>{r.online.rejectedUrls=['https://shop.booth.pm/en/items/456']},r=>{r.manual.sourceUrl='https://booth.pm/items/789'},
  r=>{r.online.url='https://booth.pm.evil.invalid/items/456'},r=>{r.online.url='https://booth.pm/items/456/download'},
 ]){const other=record(directory('456'),'materials.zip',{group:'BOOTH 下载',online:trusted('https://booth.pm/items/456')});change(other);assert.equal(projectAssets([good,other]).length,2,JSON.stringify(other));}
});

test('new managed Baidu material adaptation and PSD packages form one incremental card without changing rows',()=>{
 const parent=directory('Crimson_lupus'),rows=['MAT_TEX_Crimson_lupus_ver1.01.zip','Crimson_lupus_rurune_ver1.02.zip','PSD_mdp_Crimson_lupus_ver1.00.zip'].map(name=>record(parent,name));rows[0].manual={notes:'materials notes',tags:['保留']};const before=structuredClone(rows),index=new ProjectionIndex([]);
 for(const row of rows)index.update(undefined,row);const cards=index.values();assert.equal(cards.length,1);assert.equal(cards[0].members.length,3);assert.equal(cards[0].size,30);assert.equal(cards[0].manual.notes,'materials notes');assert.deepEqual(rows,before);for(const row of rows)assert.equal(index.get(row.id).id,cards[0].id);
});

test('managed family grouping stays within one provider and owned parent and preserves explicit identities authors and skip states',()=>{
 const parent=directory('Crimson_lupus'),base=record(parent,'Crimson_lupus_Airi_ver1.02.zip');
 for(const patch of [
  {path:path.join(directory('Crimson_lupus'),'MAT_TEX_Crimson_lupus_ver1.01.zip')},
  {group:'本地'},{group:'BOOTH 下载'},{kind:'file'},
  {manual:{matchingMode:'manual'}},{manual:{hidden:true}},
  {name:'MAT_TEX_Another_Dress_ver1.01.zip'},
 ]){const b=record(parent,'MAT_TEX_Crimson_lupus_ver1.01.zip',patch);assert.equal(projectAssets([base,b]).length,2,JSON.stringify(patch));}
 const a=record(parent,'Crimson_lupus_Airi.zip',{online:{status:'matched',url:'https://booth.pm/items/456',author:'AuthorA'}}),b=record(parent,'MAT_TEX_Crimson_lupus.zip',{online:{status:'matched',url:'https://booth.pm/items/789',author:'AuthorA'}});assert.equal(projectAssets([a,b]).length,2);
 b.online={status:'matched',url:'https://booth.pm/items/456',author:'AuthorB'};assert.equal(projectAssets([a,b]).length,2);
 a.manual.sourceUrl='https://www.goofish.com/item?id=111';b.manual.sourceUrl='https://www.goofish.com/item?id=222';a.online={status:'pending'};b.online={status:'pending'};assert.equal(projectAssets([a,b]).length,2);
});

test('ordinary folders generic package names and unrecognized role prefixes do not gain new family merges',()=>{
 for(const parent of [path.resolve('Z:/DownloadFixture/ordinary'),directory('mixed')]){
  for(const [a,b] of [['MAT_TEX.zip','Texture.zip'],['MAT_Crimson_lupus.zip','Crimson_lupus_Airi.zip'],['Unknown_Crimson_lupus.zip','Crimson_lupus_Airi.zip']])assert.equal(projectAssets([record(parent,a),record(parent,b)]).length,2);
 }
 const normal=path.resolve('Z:/DownloadFixture/ordinary');assert.equal(projectAssets([record(normal,'MAT_TEX_Crimson_lupus.zip'),record(normal,'Crimson_lupus_Airi.zip')]).length,2);
});
