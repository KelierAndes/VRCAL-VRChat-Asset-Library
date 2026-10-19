const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {assetLocation}=require('../dist/main/main/asset-location');
test('wrapper location requests are restricted to the stored chain and cannot name arbitrary descendants',()=>{
 const outer=path.resolve('test-material'),inner=path.join(outer,'inner'),asset={path:outer,wrapper:{contentRoot:inner,chain:[outer,inner]}};
 assert.equal(assetLocation(asset),outer);assert.equal(assetLocation(asset,inner),inner);
 for(const target of [path.join(inner,'not-in-scan'),path.dirname(outer),'https://goofish.com','../escape',null])assert.throws(()=>assetLocation(asset,target));
});
