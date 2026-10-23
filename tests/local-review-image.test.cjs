const test=require('node:test'),assert=require('node:assert/strict');
const {localReviewImage}=require('../dist/main/shared/local-review-image');
const {projectAssets}=require('../dist/main/main/grouping');
function asset(patch={}){return {id:'outer',path:'E:\\Synthetic\\Dress',name:'Dress',group:'Airi',kind:'folder',size:1,mtimeMs:1,missing:false,localCategory:'服装',localAvatars:[],hintUrls:[],createdAt:'2026-10-23T00:00:00Z',updatedAt:'2026-10-23T00:00:00Z',manual:{},online:{status:'review',coverFile:'online.png',coverUrl:'https://example.org/image.png'},...patch}}
test('local comparison prefers manual cover, then scanned preview, without mutating the record',()=>{
 const record=asset({manual:{coverFile:'用户 封面.png'},previewFile:'本地-preview.jpg'}),before=structuredClone(record);
 assert.equal(localReviewImage(record),'用户 封面.png');assert.deepEqual(record,before);
 delete record.manual.coverFile;assert.equal(localReviewImage(record),'本地-preview.jpg');
});
test('remote covers and candidates alone never become local images',()=>{
 const record=asset();record.online.candidates=[{url:'https://example.org/product',title:'Product',coverFile:'remote-candidate.png'}];
 assert.equal(localReviewImage(record),undefined);record.online.status='matched';assert.equal(localReviewImage(record),undefined);
});
test('invalid cache references are rejected and cannot escape the local cover protocol',()=>{
 for(const value of ['', ' ', '.', '..', '../image.png', '..\\image.png', 'E:\\image.png', '/image.png', 'https://example.org/image.png', 'image\0.png']){
  assert.equal(localReviewImage(asset({manual:{coverFile:value}})),undefined,JSON.stringify(value));
  assert.equal(localReviewImage(asset({previewFile:value})),undefined,JSON.stringify(value));
  assert.equal(localReviewImage(asset({manual:{coverFile:value},previewFile:'safe.png'})),'safe.png');
 }
});
test('merged records retain member manual images ahead of a scanned preview',()=>{
 const record=asset({previewFile:'scan.png',members:[{id:'child',path:'E:\\Synthetic\\Dress.zip',name:'Dress.zip',kind:'archive',missing:false,manual:{coverFile:'member-local.png'}}]});
 assert.equal(localReviewImage(record),'member-local.png');record.manual.coverFile='outer-manual.png';assert.equal(localReviewImage(record),'outer-manual.png');
});
test('real aggregation projects an inner preview while preserving online cover separation',()=>{
 const records=[asset(),asset({id:'zip',path:'E:\\Synthetic\\Dress.zip',name:'Dress.zip',kind:'archive',previewFile:'inner-preview.jpg'})];
 const merged=projectAssets(records);assert.equal(merged.length,1);assert.equal(merged[0].members.length,2);assert.equal(localReviewImage(merged[0]),'inner-preview.jpg');
 assert.equal(merged[0].online.coverFile,'online.png');assert.equal(records[0].previewFile,undefined);
});
