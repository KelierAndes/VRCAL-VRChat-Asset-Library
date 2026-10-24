const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const files=require('../dist/main/main/model-preview-files'),reader=require('../dist/main/main/model-preview-reader'),{purplePng}=require('./model-preview-fixtures.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'vrc-model-scene-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
async function model(root,slot,extension,content){const dir=path.join(root,slot);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'model.'+extension);await fs.writeFile(file,content);return {dir,file,source:(await files.indexModels(dir)).models[0]}}
const obj='o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3';
test('scene reader returns isolated primary/reference namespaces and preserves both source files',async t=>{
 const root=await fixture(t),primary=await model(root,'clothes','obj',obj+'\n# Clothes'),reference=await model(root,'avatar','obj',obj+'\n# Avatar'),hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await Promise.all([hash(primary.file),hash(reference.file)]);
 assert.equal(typeof files.prepareModelScene,'function');const scene=await files.prepareModelScene(primary.source,reference.source);assert.equal(scene.primary.name,'model.obj');assert.equal(scene.reference.name,'model.obj');assert.notDeepEqual(scene.primary.files[0].bytes,scene.reference.files[0].bytes);assert.deepEqual(await Promise.all([hash(primary.file),hash(reference.file)]),before);
 const fromWorker=await reader.readModelScene(primary.source,reference.source);assert.equal(fromWorker.primary.name,'model.obj');assert.equal(fromWorker.reference.name,'model.obj');assert.equal((await reader.readModelScene(primary.source,undefined)).reference,undefined);
});
test('scene raw budget rejects a second required buffer before allocating or opening that buffer',async t=>{
 const root=await fixture(t),json=JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'geometry.bin',byteLength:64*1024*1024}]}),primary=await model(root,'clothes','gltf',json),reference=await model(root,'avatar','gltf',json);
 for(const dir of [primary.dir,reference.dir]){const handle=await fs.open(path.join(dir,'geometry.bin'),'w');await handle.truncate(64*1024*1024);await handle.close()}
 const original=fs.open;let secondBufferOpened=false;fs.open=async function(file,...args){if(file===path.join(reference.dir,'geometry.bin'))secondBufferOpened=true;return original.call(this,file,...args)};
 try{assert.equal(typeof files.prepareModelScene,'function');await assert.rejects(()=>files.prepareModelScene(primary.source,reference.source),/预算|大小上限/);assert.equal(secondBufferOpened,false)}finally{fs.open=original}
});
test('scene file count is shared across both model dependency sets',async t=>{
 const root=await fixture(t),buffers=Array.from({length:49},(_,i)=>({uri:'part-'+i+'.bin',byteLength:1})),json=JSON.stringify({asset:{version:'2.0'},buffers}),primary=await model(root,'clothes','gltf',json),reference=await model(root,'avatar','gltf',json);
 for(const dir of [primary.dir,reference.dir])for(const {uri} of buffers)await fs.writeFile(path.join(dir,uri),'x');
 assert.equal(typeof files.prepareModelScene,'function');await assert.rejects(()=>files.prepareModelScene(primary.source,reference.source),/预算|大小上限|数量/);
});
function glb(image){const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:image.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:image.length}],images:[{bufferView:0,mimeType:'image/png'}]})),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),bin=Buffer.concat([image,Buffer.alloc((4-image.length%4)%4)]),header=Buffer.alloc(20),binHeader=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,padded,binHeader,bin])}
test('scene texture budget includes equal-named external and embedded images from both slots',async t=>{
 const root=await fixture(t),large=purplePng();large.writeUInt32BE(4096,16);large.writeUInt32BE(4096,20);
 for(const format of ['external','gltf','fbx','glb']){const embedded='data:image/png;base64,'+large.toString('base64'),ext=format==='external'?'gltf':format,content=format==='fbx'?'; FBX 7.4.0 project file\nRelativeFilename: "embedded.png"\nContent: "'+large.toString('base64')+'"':format==='glb'?glb(large):JSON.stringify({asset:{version:'2.0'},images:[{uri:format==='external'?'same.png':embedded}]}),primary=await model(root,format+'-clothes',ext,content),reference=await model(root,format+'-avatar',ext,content);
  if(format==='external')for(const dir of [primary.dir,reference.dir])await fs.writeFile(path.join(dir,'same.png'),large);
  assert.equal(typeof files.prepareModelScene,'function');await assert.rejects(()=>files.prepareModelScene(primary.source,reference.source),/贴图.*预算|内存/,format);
 }
});
test('scene worker cancellation rejects without returning partially prepared slots',async t=>{
 const root=await fixture(t),primary=await model(root,'clothes','obj',obj),reference=await model(root,'avatar','obj',obj),controller=new AbortController();controller.abort();assert.equal(typeof reader.readModelScene,'function');await assert.rejects(()=>reader.readModelScene(primary.source,reference.source,controller.signal),/取消/);
});

test('scene file budget includes embedded images across both slots',async t=>{
 const root=await fixture(t),png=purplePng().toString('base64');
 for(const format of ['gltf','fbx']){const content=format==='gltf'?JSON.stringify({asset:{version:'2.0'},images:Array.from({length:48},()=>({uri:'data:image/png;base64,'+png}))}):'; FBX 7.4.0 project file\n'+Array.from({length:48},()=>`Content: "${png}"`).join('\n'),primary=await model(root,format+'-many-clothes',format,content),reference=await model(root,format+'-many-avatar',format,content);
  await assert.rejects(()=>files.prepareModelScene(primary.source,reference.source),/预算|数量/,format);
 }
});

test('nested archive index sources share the slot source cap and report consumption to the window',async t=>{
 const root=await fixture(t),empty=require('node:zlib').gzipSync(Buffer.alloc(1024));for(let i=0;i<18;i++)await fs.writeFile(path.join(root,`part-${i}.unitypackage`),empty);
 const indexed=await files.indexModels(root);assert.equal(indexed.sourceCount,16);assert(indexed.warnings.some(message=>/16/.test(message)));
 const limited=await reader.readModelIndex(root,undefined,2);assert.equal(limited.sourceCount,2);assert(limited.warnings.length);
});
