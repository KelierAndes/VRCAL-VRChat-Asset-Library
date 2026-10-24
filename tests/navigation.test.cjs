const test=require('node:test'),assert=require('node:assert/strict');
const {NAV_GROUPS,navigationContext,libraryActions}=require('../dist/main/shared/navigation');
test('all destinations have one task group without hiding advanced pages',()=>{
 const ids=NAV_GROUPS.flatMap(g=>g.items.map(i=>i.id));
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ['materials','favorites','review','manual','hidden','projects','workbench','plugins','ai','discovery','booth','inbox','baidu','updates','contributors'])assert(ids.includes(id),id);
});
test('project, custom collection and favorite contexts do not inherit stale gallery views',()=>{
 assert.equal(navigationContext('library','projects','all').id,'projects');
 assert.equal(navigationContext('library','projects','favorites').id,'favorites');
 assert.equal(navigationContext('library','projects','custom').group,'organize');
 assert.equal(navigationContext('library','manual','review').id,'review');
 assert.equal(navigationContext('ai','materials','review').group,'create');
 assert.equal(navigationContext('baidu','projects','favorites').group,'discover');
});
test('actions target the displayed content and tools never offer library mutations',()=>{
 assert.deepEqual(libraryActions('library','projects','all'),{materials:false,projects:true,filters:true});
 assert.deepEqual(libraryActions('library','materials','review'),{materials:true,projects:false,filters:true});
 assert.deepEqual(libraryActions('library','projects','custom'),{materials:false,projects:true,filters:true});
 for(const page of ['workbench','ai','plugins','inbox','hidden','baidu','contributors'])assert.deepEqual(libraryActions(page,'materials','all'),{materials:false,projects:false,filters:false});
});
