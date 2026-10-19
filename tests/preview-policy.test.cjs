const test=require('node:test'),assert=require('node:assert/strict');
// These URL policy checks do not use native windows. Avoid loading Electron's
// executable locator, which downloads a runtime in a clean Node-only checkout.
const Module=require('node:module'),originalLoad=Module._load;
Module._load=function(request,...args){return request==='electron'?{}:originalLoad.call(this,request,...args)};
let samePreviewProduct;
try{({samePreviewProduct}=require('../dist/main/main/preview'))}finally{Module._load=originalLoad}

test('preview confirmation follows the originally authorized BOOTH item across locale/shop pages',()=>{
  const source='https://zaicrifice.booth.pm/items/6454372';
  for(const current of ['https://booth.pm/ja/items/6454372','https://zaicrifice.booth.pm/en/items/6454372','https://booth.pm/zh-cn/items/6454372#description'])assert.equal(samePreviewProduct(source,current),true);
  for(const current of ['https://booth.pm/ja/items/6454373','https://booth.pm/ja/items/64543721','https://notbooth.pm/items/6454372','https://booth.pm.evil.org/items/6454372','https://booth.pm/ja/search/6454372'])assert.equal(samePreviewProduct(source,current),false);
});
test('ordinary sources require the original public HTTPS URL and reject unsafe/authentication targets',()=>{
  const source='https://shop.example.org/product?id=1';
  assert.equal(samePreviewProduct(source,source+'#description'),true);
  for(const current of ['https://shop.example.org/product?id=2','https://shop.example.org/another','https://other.example.org/product?id=1','http://shop.example.org/product?id=1','https://user:secret@shop.example.org/product?id=1','file:///E:/VRChat','https://127.0.0.1/','https://shop.example.org/login'])assert.equal(samePreviewProduct(source,current),false);
});
