const test=require('node:test'),assert=require('node:assert/strict');
const {matchingCatalog}=require('../dist/main/main/matching-catalog');
const raw=(id,online={status:'pending'},manual={})=>({id,name:id,path:'E:\\Synthetic\\'+id,kind:'folder',group:'Airi',manual,online});
function fixture(){
 const items=[raw('outer'),raw('inner',{status:'review',rejectedUrls:['https://booth.pm/items/1234567']},{notes:'keep'})],updates=[];
 const view=()=>({...items[0],members:items.map(a=>({id:a.id,path:a.path,name:a.name,manual:a.manual})),online:items[1].online,manual:items.find(a=>a.manual.sourceUrl)?.manual||{}});
 const store={all:()=>items,getRaw:id=>items.find(a=>a.id===id)||null,get:id=>items.some(a=>a.id===id)?view():null,updateOnline:(id,patch)=>{updates.push(id);const item=items.find(a=>a.id===id);item.online={...item.online,...patch}}};
 return {items,updates,catalog:matchingCatalog(store)};
}
test('wrapper matching catalog emits one projected identity and keeps excluded candidates from every member',()=>{
 const f=fixture();assert.deepEqual(f.catalog.all().map(a=>a.id),['outer']);assert.equal(f.catalog.get('inner').id,'outer');
 f.items[0].online.rejectedUrls=['https://booth.pm/items/7654321'];
 assert.deepEqual(new Set(f.catalog.get('outer').online.rejectedUrls),new Set(['https://booth.pm/items/1234567','https://booth.pm/items/7654321']));
 f.items[0].manual.matchingMode='manual';assert.equal(f.catalog.get('inner').manual.matchingMode,'manual');
});
test('a single wrapper result updates all retained record IDs without changing manual fields',()=>{
 const f=fixture();f.catalog.updateOnline('inner',{status:'matched',url:'https://booth.pm/zh-cn/items/7643173',title:'Lovely Long Hair'});
 assert.deepEqual(f.updates,['outer','inner']);assert.equal(f.items[1].manual.notes,'keep');assert.equal(f.items[0].online.url,f.items[1].online.url);
});
test('stale source results cannot fan out over a different manual binding',()=>{
 const f=fixture();f.items[1].manual.sourceUrl='https://booth.pm/items/7643173';
 f.catalog.updateOnline('outer',{status:'matched',url:'https://booth.pm/items/8801382'});assert.deepEqual(f.updates,[]);
 f.catalog.updateOnline('outer',{status:'matched',url:'https://li-ne.booth.pm/en/items/7643173'});assert.deepEqual(f.updates,['outer','inner']);
});
