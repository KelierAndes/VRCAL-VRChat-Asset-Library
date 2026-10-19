const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const grouping=require('../dist/main/main/grouping.js');
const {ProjectionIndex}=require('../dist/main/main/projection.js');

function asset(id,name,patch={}){
 return {id,path:path.join('Z:\\ProjectionFixture','角色目录',name),name,group:'角色目录',kind:/\.(?:zip|rar|7z)$/i.test(name)?'archive':'folder',size:10,mtimeMs:100,missing:false,localCategory:'服装',localAvatars:[],hintUrls:[],manual:{},online:{status:'pending'},createdAt:'2026-10-13',updatedAt:'2026-10-13',...patch};
}
function check(index,raw){
 const expected=grouping.projectAssets([...raw.values()]);assert.deepEqual(index.values(),expected);
 for(const card of expected)for(const member of card.members)assert.deepEqual(index.get(member.id),card);
 assert.equal(index.get('unknown-id'),undefined);
}
function fixture(records){
 const raw=new Map(records.map(record=>[record.id,record])),index=new ProjectionIndex(records);check(index,raw);
 return {raw,index,put(id,patch){const previous=raw.get(id),next=previous?{...previous,...patch}:{...patch,id};raw.set(id,next);index.update(previous,next);check(index,raw);return next}};
}

test('projection updates remain identical to full grouping across names, paths, IDs, authors and annotations',()=>{
 const otherDir=path.join('Z:\\ProjectionFixture','另一个角色');
 const {raw,index,put}=fixture([
  asset('a','A衣服'),asset('b','A衣服_Airi_v1.0.zip'),asset('c','新版商品.zip',{path:path.join(otherDir,'新版商品.zip')}),
  asset('d','新版商品_Maya_v2.0.zip',{path:path.join(otherDir,'新版商品_Maya_v2.0.zip')}),asset('isolated','Other Product'),
 ]);
 const isolated=index.get('isolated');
 put('a',{manual:{tags:['甲'],favorite:true,notes:'第一条'}});
 put('b',{manual:{tags:['乙'],avatars:['Manuka'],title:'人工标题',sourceUrl:'https://booth.pm/items/1234567'}});
 put('a',{online:{status:'matched',url:'https://shop.booth.pm/items/1234567',author:'Shop',title:'A衣服'}});
 put('c',{online:{status:'matched',url:'https://booth.pm/ja/items/1234567',author:'Shop',title:'A衣服'}});
 assert.notEqual(index.get('a'),index.get('d')); // Unverified companions cannot bridge role directories.
 put('b',{online:{status:'matched',url:'https://booth.pm/items/1234567',author:'Shop'}});
 put('d',{online:{status:'matched',url:'https://booth.pm/items/1234567',author:'Shop'}});
 assert.equal(index.get('a'),index.get('d'));
 put('d',{name:'另一个商品_Maya.zip',path:path.join(otherDir,'另一个商品_Maya.zip')});
 put('b',{path:path.join(otherDir,'A衣服_Airi_v1.0.zip')});
 put('c',{online:{status:'matched',url:'https://booth.pm/items/7654321',author:'Shop'}});
 put('a',{online:{status:'review',url:'https://booth.pm/items/1234567',confirmedSource:true}});
 put('b',{name:'7654321 新版商品.zip',online:{status:'matched',url:'https://booth.pm/items/7654321',author:'AnotherShop'}});
 put('c',{name:'１２３４５６７ 新版商品',online:{status:'matched',url:'https://booth.pm/items/7654321',author:'Shop'}});
 put('c',{kind:'unity-project',manual:{projectStatus:'已完成',relatedIds:['a']}});
 put('b',{kind:'file'});
 put('a',{manual:{},missing:true});
 put('new',{...asset('new','A衣服_v3.0.zip'),manual:{tags:['新增']}});
 assert.equal(index.get('isolated'),isolated);
 assert.equal(raw.get('b').manual.notes,undefined);
});

test('a conflicting-author bridge never weakens pairwise merge checks or misses connected groups',()=>{
 const common={status:'matched',url:'https://booth.pm/items/1234567'};
 const {index,put}=fixture([
  asset('a','01 Moon Dress',{online:{...common,author:'Alpha'}}),
  asset('bridge','02 Unknown Product',{online:{...common}}),
  asset('b','03 Star Dress',{online:{...common,author:'Beta'}}),
  asset('unrelated','Untouched'),
 ]);
 assert.equal(index.get('a'),index.get('bridge'));assert.notEqual(index.get('a'),index.get('b'));
 const unrelated=index.get('unrelated');
 put('bridge',{online:{...common,author:'Beta'}});
 assert.equal(index.get('b'),index.get('bridge'));assert.notEqual(index.get('a'),index.get('b'));
 put('bridge',{online:{...common},path:path.join('Z:\\ProjectionFixture','角色目录','00 Unknown Product')});
 assert.equal(index.get('a'),index.get('bridge'));assert.notEqual(index.get('a'),index.get('b'));
 put('a',{online:{...common,author:'Beta'}});
 assert.equal(index.get('a'),index.get('b'));
 assert.equal(index.get('unrelated'),unrelated);
});

test('missing files, versions, manual undo and representative changes retain member lookup and path ordering',()=>{
 const {index,raw,put}=fixture([
  asset('archive','A衣服_Airi_v1.0.zip',{mtimeMs:110,manual:{notes:'包笔记',tags:['包']}}),
  asset('folder','A衣服_v2.0',{mtimeMs:220,manual:{notes:'目录笔记'}}),
  asset('other','A衣服Extra.zip'),
 ]);
 const before=raw.get('folder');
 assert.equal(index.get('archive').id,'folder');
 assert.deepEqual(index.get('folder').members.map(member=>[member.id,member.version,member.mtimeMs]),[['folder','2.0',220],['archive','1.0',110]]);
 put('folder',{missing:true});assert.equal(index.get('folder').id,'archive');assert.equal(index.get('archive').missing,false);
 put('archive',{missing:true});assert.equal(index.get('folder').missing,true);
 put('archive',{missing:false,manual:{title:'选中标题',tags:['包','暂时'],coverFile:'fixture.png',favorite:true}});
 put('folder',{manual:{tags:['目录'],notes:'调整后的笔记'},missing:false});
 put('folder',before);
 assert.equal(index.get('folder').id,'folder');assert.equal(index.get('archive').members.find(member=>member.id==='folder').manual.notes,'目录笔记');
 // Group order follows the first raw path, even when the chosen folder path
 // sorts after another card's path.
 assert.equal(index.values()[0].id,'folder');
 assert.equal(index.values()[1].id,'other');
});

test('equal paths preserve stable raw insertion order when a card is rebuilt or a new item is inserted',()=>{
 const shared=path.join('Z:\\ProjectionFixture','相同路径');
 const {index,put}=fixture([asset('z','Generic First',{path:shared,kind:'file'}),asset('a','Generic Second',{path:shared,kind:'file'})]);
 put('z',{manual:{tags:['更新']}});assert.deepEqual(index.values().map(card=>card.id),['z','a']);
 put('new',{...asset('new','Generic Third'),path:shared,kind:'file'});assert.deepEqual(index.values().map(card=>card.id),['z','a','new']);
 put('a',{path:path.join('Z:\\ProjectionFixture','先前路径')});
});

test('10,000-item annotation update reprojects only its connected records and retains unrelated object references',()=>{
 const records=Array.from({length:10000},(_,i)=>asset(String(i),`Unique Product ${String(i).padStart(5,'0')}`));
 records.push(asset('version','Unique Product 05000_v2.0.zip'));
 const original=grouping.projectAssets,calls=[];
 grouping.projectAssets=items=>{calls.push(items.length);return original(items)};
 try{
  const index=new ProjectionIndex(records),before=new Map(records.map(record=>[record.id,index.get(record.id)]));
  assert.deepEqual(calls,[10001]);calls.length=0;
  const previous=records[5000],next={...previous,manual:{tags:['局部修改'],favorite:true}};
  index.update(previous,next);
  assert.deepEqual(calls,[2]);assert.equal(index.get('5000'),index.get('version'));
  for(const record of records)if(record.id!=='5000'&&record.id!=='version')assert.equal(index.get(record.id),before.get(record.id));
  const expected=original(records.map(record=>record.id==='5000'?next:record));assert.deepEqual(index.values(),expected);
 }finally{grouping.projectAssets=original}
});

test('deterministic mixed updates produce the same projection as a full rebuild at every step',()=>{
 let seed=713;const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max};
 const records=Array.from({length:45},(_,i)=>asset(String(i),`Product ${i%9}${i%3?'_Airi_v1.0.zip':''}`,{path:path.join('Z:\\ProjectionFixture',`角色${i%4}`,`File ${i}`)}));
 const {raw,put}=fixture(records);
 for(let i=0;i<140;i++){
  const id=String(random(45)),record=raw.get(id),choice=random(7);
  if(choice===0)put(id,{name:`Product ${random(9)}_${random(2)?'Airi':'Maya'}_v${random(4)+1}.0.zip`});
  else if(choice===1)put(id,{path:path.join('Z:\\ProjectionFixture',`角色${random(4)}`,`File ${random(60)}`)});
  else if(choice===2)put(id,{online:{status:random(3)?'matched':'review',url:`https://shop.booth.pm/items/${1234567+random(5)}`,author:['ShopA','ShopB',undefined][random(3)]}});
  else if(choice===3)put(id,{manual:{...record.manual,tags:[`标签${random(4)}`],notes:`笔记${i}`,favorite:!!random(2)}});
  else if(choice===4)put(id,{missing:!!random(2)});
  else if(choice===5)put(id,{kind:['folder','archive','file','unity-project'][random(4)]});
  else put(id,{online:{status:'pending'},manual:{},updatedAt:`2026-10-${String(random(10)+10).padStart(2,'0')}`});
 }
});
