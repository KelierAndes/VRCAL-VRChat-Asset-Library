const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {indexModels,prepareModel}=require('../dist/main/main/model-preview-files');
const {safeModelPath,resolveModelResource}=require('../dist/main/shared/model-preview');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function tar(items){const blocks=[];for(const [name,data] of items){const b=Buffer.from(data),h=Buffer.alloc(512);h.write(name);h.write('0000644\0',100);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);blocks.push(h,b,Buffer.alloc((512-b.length%512)%512))}return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]))}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'vrc-model-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
test('resource paths never escape scope; absolute FBX references only use unique indexed basenames',()=>{
 for(const p of ['../private.fbx','/x.fbx','C:/x.fbx','x/../y.png','x\\..\\y.png','a:stream','a\0b'])assert.equal(safeModelPath(p),undefined,p);
 assert.equal(safeModelPath('服装/日本語 🧵.fbx'),'服装/日本語 🧵.fbx');
 const names=['衣服/model.fbx','衣服/Tex/a.png','衣服/tex.png'];
 assert.equal(resolveModelResource('Tex/a.png','衣服/model.fbx',names),'衣服/Tex/a.png');
 assert.equal(resolveModelResource('C:\\author\\tex.png','衣服/model.fbx',names),'衣服/tex.png');
 assert.equal(resolveModelResource('https://tracker.invalid/a.png','衣服/model.fbx',names),undefined);
 assert.equal(resolveModelResource('../../secret.png','衣服/model.fbx',['secret.png']),undefined);
 assert.equal(resolveModelResource('a.png','衣服/model.fbx',['x/a.png','y/a.png']),undefined);
});
test('directory preview reads only render assets and preserves source hashes',async t=>{
 const root=await fixture(t),folder=path.join(root,'衣服_日本語😀');await fs.mkdir(path.join(folder,'Tex'),{recursive:true});
 await fs.writeFile(path.join(folder,'model.gltf'),JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'mesh.bin',byteLength:4}],images:[{uri:'Tex/a.png'}]}));
 await fs.writeFile(path.join(folder,'mesh.bin'),Buffer.from([1,2,3,4]));await fs.writeFile(path.join(folder,'Tex/a.png'),png);await fs.writeFile(path.join(folder,'private.cs'),'private script');
 const before=createHash('sha256').update(await fs.readFile(path.join(folder,'model.gltf'))).digest('hex');
 const indexed=await indexModels(folder);assert.equal(indexed.models.length,1);const bundle=await prepareModel(indexed.models[0]);assert.deepEqual(bundle.files.map(f=>f.name).sort(),['Tex/a.png','mesh.bin','model.gltf']);
 assert.equal(createHash('sha256').update(await fs.readFile(path.join(folder,'model.gltf'))).digest('hex'),before);
});
test('Unitypackage resolves GUID assets and reads only the selected model and render dependencies',async t=>{
 const root=await fixture(t),file=path.join(root,'素材.unitypackage');await fs.writeFile(file,tar([['aa/asset','o Test\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'],['aa/pathname','Assets/衣服/a.obj'],['bb/asset','do not execute'],['bb/pathname','Assets/Bad.cs']]));
 const indexed=await indexModels(file);assert.equal(indexed.models.length,1);assert.equal(indexed.models[0].name,'Assets/衣服/a.obj');const bundle=await prepareModel(indexed.models[0]);assert.equal(bundle.files.length,1);assert.match(Buffer.from(bundle.files[0].bytes).toString(),/o Test/);
});
test('Unitypackage traversal, duplicate paths and oversize entries are rejected',async t=>{
 const root=await fixture(t),file=path.join(root,'bad.unitypackage');
 await fs.writeFile(file,tar([['aa/asset','a'],['aa/pathname','../secret.fbx']]));await assert.rejects(indexModels(file),/路径/);
 await fs.writeFile(file,tar([['aa/asset','a'],['aa/pathname','Assets/a.obj'],['bb/asset','b'],['bb/pathname','Assets/a.obj']]));await assert.rejects(indexModels(file),/重复/);
});
test('symbolic link sources and descendants are never read',async t=>{
 const root=await fixture(t),source=path.join(root,'actual');await fs.mkdir(source);await fs.writeFile(path.join(source,'a.obj'),'v 0 0 0');
 const link=path.join(root,'link');try{await fs.symlink(source,link,'junction')}catch(e){if(e.code==='EPERM'){t.skip('symlink privileges unavailable');return}throw e}
 await assert.rejects(indexModels(link),/链接/);const indexed=await indexModels(root);assert.equal(indexed.models.length,1);
});
test('changed sources and external glTF resources fail without falling back to arbitrary files',async t=>{
 const root=await fixture(t),file=path.join(root,'a.gltf');await fs.writeFile(file,JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://example.invalid/private.bin'}]}));
 const indexed=await indexModels(file);await assert.rejects(prepareModel(indexed.models[0]),/外部|缺少/);
 await fs.appendFile(file,' ');await assert.rejects(prepareModel(indexed.models[0]),/变化/);
});
module.exports={tar};
test('single FBX authorization never scans or returns parent-directory pictures',async t=>{
 const root=await fixture(t),file=path.join(root,'single.fbx');await fs.writeFile(file,'; FBX 7.4.0 project file\nRelativeFilename: "private.png"\n');await fs.writeFile(path.join(root,'private.png'),png);
 const index=await indexModels(file),bundle=await prepareModel(index.models[0]);assert.deepEqual(bundle.files.map(f=>f.name),['single.fbx']);
});
test('folder FBX includes only referenced pictures and checks embedded image dimensions',async t=>{
 const root=await fixture(t),file=path.join(root,'model.fbx');await fs.writeFile(file,'; FBX 7.4.0 project file\nRelativeFilename: "used.png"\n');await fs.writeFile(path.join(root,'used.png'),png);await fs.writeFile(path.join(root,'unrelated.png'),png);
 let bundle=await prepareModel((await indexModels(root)).models[0]);assert.deepEqual(bundle.files.map(f=>f.name).sort(),['model.fbx','used.png']);
 const huge=Buffer.from(png);huge.writeUInt32BE(16384,16);await fs.writeFile(file,'; FBX 7.4.0 project file\nRelativeFilename: "embedded.png"\nContent: ,\n"'+huge.toString('base64')+'"\n');await assert.rejects(prepareModel((await indexModels(root)).models[0]),/贴图|尺寸/);
});
test('ASCII FBX empty embedded content still resolves its external image',async t=>{
 const root=await fixture(t),file=path.join(root,'external.fbx');await fs.writeFile(file,'; FBX 7.4.0 project file\nRelativeFilename: "used.png"\nContent: ""\n');await fs.writeFile(path.join(root,'used.png'),png);
 const bundle=await prepareModel((await indexModels(root)).models[0]);assert.deepEqual(bundle.files.map(f=>f.name).sort(),['external.fbx','used.png']);
});
test('glTF external and embedded textures enforce dimensions and a cumulative decoded budget',async t=>{
 const root=await fixture(t),file=path.join(root,'a.gltf'),huge=Buffer.from(png);huge.writeUInt32BE(16384,16);
 await fs.writeFile(file,JSON.stringify({asset:{version:'2.0'},images:[{uri:'huge.png'}]}));await fs.writeFile(path.join(root,'huge.png'),huge);await assert.rejects(prepareModel((await indexModels(root)).models[0]),/尺寸|贴图/);
 await fs.writeFile(file,JSON.stringify({asset:{version:'2.0'},images:[{uri:'data:image/png;base64,'+huge.toString('base64')}]}));await assert.rejects(prepareModel((await indexModels(file)).models[0]),/尺寸|贴图/);
 const large=Buffer.from(png);large.writeUInt32BE(4096,16);large.writeUInt32BE(4096,20);await fs.writeFile(path.join(root,'one.png'),large);await fs.writeFile(path.join(root,'two.png'),large);
 await fs.writeFile(file,JSON.stringify({asset:{version:'2.0'},images:[{uri:'one.png'},{uri:'two.png'}]}));await assert.rejects(prepareModel((await indexModels(root)).models[0]),/预算|内存/);
});
test('nested OBJ materials preserve their own relative texture base',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'materials'));await fs.mkdir(path.join(root,'textures'));await fs.writeFile(path.join(root,'a.obj'),'mtllib materials/a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');await fs.writeFile(path.join(root,'materials/a.mtl'),'newmtl Cloth\nmap_Kd ../textures/a.png');await fs.writeFile(path.join(root,'textures/a.png'),png);
 const bundle=await prepareModel((await indexModels(root)).models[0]);assert(bundle.files.some(f=>f.name==='textures/a.png'));
 const {modelMaterialResourceBase}=require('../dist/main/shared/model-preview');assert.equal(resolveModelResource(modelMaterialResourceBase('materials/a.mtl')+'../textures/a.png',bundle.name,bundle.files.map(f=>f.name)),'textures/a.png');
});
test('resource ownership closes late images and revokes embedded URLs on cancellation',async()=>{
 const {ModelPreviewResources}=require('../dist/main/shared/model-preview');const resources=new ModelPreviewResources(),url=URL.createObjectURL(new Blob(['embedded']));resources.trackURL(url);assert.equal(await (await fetch(url)).text(),'embedded');let closed=0;const bitmap={close:()=>closed++};resources.trackBitmap(bitmap);resources.trackBitmap(bitmap);resources.dispose();resources.dispose();assert.equal(closed,1);await assert.rejects(fetch(url));resources.trackBitmap({close:()=>closed++});assert.equal(closed,2);const late=URL.createObjectURL(new Blob(['late']));resources.trackURL(late);await assert.rejects(fetch(late));
});
function zip(items){let offset=0;const locals=[],central=[];for(const [name,input] of items){const data=Buffer.from(input),n=Buffer.from(name);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}crc=(crc^0xffffffff)>>>0;const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);locals.push(h,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+data.length}const center=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,center,end])}
test('ZIP OBJ reads only material dependencies and rejects traversal entries',async t=>{
 const root=await fixture(t),file=path.join(root,'a.zip');await fs.writeFile(file,zip([['model.obj','mtllib materials/a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'],['materials/a.mtl','newmtl A\nmap_Kd ../textures/a.png'],['textures/a.png',png],['private.png',png],['secret.txt','unrelated']]));
 const bundle=await prepareModel((await indexModels(file)).models[0]);assert.deepEqual(bundle.files.map(f=>f.name).sort(),['materials/a.mtl','model.obj','textures/a.png']);
 await fs.writeFile(file,zip([['../escape.obj','v 0 0 0']]));await assert.rejects(indexModels(file));
});
function binaryFbx(image){const prop=(type,data)=>{const value=Buffer.from(data),out=Buffer.alloc(5);out[0]=type.charCodeAt(0);out.writeUInt32LE(value.length,1);return Buffer.concat([out,value])};const node=(name,properties,children,offset)=>{const n=Buffer.from(name),p=Buffer.concat(properties),head=Buffer.alloc(13);let cursor=offset+13+n.length+p.length;const contents=[];for(const child of children){const bytes=child(cursor);contents.push(bytes);cursor+=bytes.length}cursor+=13;head.writeUInt32LE(cursor);head.writeUInt32LE(properties.length,4);head.writeUInt32LE(p.length,8);head[12]=n.length;return Buffer.concat([head,n,p,...contents,Buffer.alloc(13)])};const head=Buffer.alloc(27);head.write('Kaydara FBX Binary  \0\x1a\0','binary');head.writeUInt32LE(7400,23);return Buffer.concat([head,node('Video',[],[offset=>node('RelativeFilename',[prop('S','embedded.png')],[],offset),offset=>node('Content',[prop('R',image)],[],offset)],27),Buffer.alloc(13)])}
test('binary FBX embedded pictures pass preflight only within the same texture limits',async t=>{
 const root=await fixture(t),file=path.join(root,'embedded.fbx');await fs.writeFile(file,binaryFbx(png));const ok=await prepareModel((await indexModels(file)).models[0]);assert.equal(ok.files.length,1);
 const huge=Buffer.from(png);huge.writeUInt32BE(8192,20);await fs.writeFile(file,binaryFbx(huge));await assert.rejects(prepareModel((await indexModels(file)).models[0]),/尺寸/);
});
test('GLB bufferView images are inspected before browser decoding',async t=>{
 const root=await fixture(t),file=path.join(root,'embedded.glb');const build=image=>{const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:image.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:image.length}],images:[{bufferView:0,mimeType:'image/png'}]}));const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),bin=Buffer.concat([image,Buffer.alloc((4-image.length%4)%4)]),h=Buffer.alloc(20),bh=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+padded.length+bin.length,8);h.writeUInt32LE(padded.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,padded,bh,bin])};
 await fs.writeFile(file,build(png));assert.equal((await prepareModel((await indexModels(file)).models[0])).files.length,1);const huge=Buffer.from(png);huge.writeUInt32BE(8192,16);await fs.writeFile(file,build(huge));await assert.rejects(prepareModel((await indexModels(file)).models[0]),/尺寸/);
});
test('texture limits accept the boundary and reject zero, oversized and unsupported layouts',()=>{
 const {modelTextureDimensions,ModelTextureBudget}=require('../dist/main/shared/model-preview'),boundary=Buffer.from(png);boundary.writeUInt32BE(4096,16);boundary.writeUInt32BE(4096,20);assert.deepEqual(modelTextureDimensions(boundary,'a.png'),{width:4096,height:4096});const budget=new ModelTextureBudget();budget.add('same',boundary,'a.png');budget.add('same',boundary,'a.png');assert.throws(()=>budget.add('different',boundary,'b.png'),/预算/);boundary.writeUInt32BE(0,16);assert.throws(()=>modelTextureDimensions(boundary,'a.png'),/尺寸/);assert.throws(()=>modelTextureDimensions(Buffer.alloc(30),'bad.png'),/格式/);
});
test('synchronous loader URL capture restores URL API even after parser failure',async()=>{
 const {ModelPreviewResources}=require('../dist/main/shared/model-preview'),resources=new ModelPreviewResources(),original=URL.createObjectURL;let embedded;assert.throws(()=>resources.captureObjectURLs(()=>{embedded=URL.createObjectURL(new Blob(['fbx embedded']));throw Error('invalid geometry')}));assert.equal(URL.createObjectURL,original);resources.dispose();await assert.rejects(fetch(embedded));
});
test('texture URI extensions cannot bypass decoded dimension checks',async t=>{
 const root=await fixture(t),huge=Buffer.from(png);huge.writeUInt32BE(16384,16);await fs.writeFile(path.join(root,'texture.bin'),huge);await fs.writeFile(path.join(root,'model.gltf'),JSON.stringify({asset:{version:'2.0'},images:[{uri:'texture.bin'}]}));await assert.rejects(prepareModel((await indexModels(root)).models[0]),/尺寸/);
 await fs.unlink(path.join(root,'model.gltf'));await fs.writeFile(path.join(root,'model.obj'),'mtllib a.mtl\nv 0 0 0');await fs.writeFile(path.join(root,'a.mtl'),'newmtl A\nmap_Kd texture.bin');await assert.rejects(prepareModel((await indexModels(root)).models[0]),/尺寸/);
});
test('common texture headers preserve width and height before any decoding',()=>{
 const {modelTextureDimensions}=require('../dist/main/shared/model-preview');
 const bmp=Buffer.alloc(54);bmp.write('BM');bmp.writeUInt32LE(40,14);bmp.writeInt32LE(256,18);bmp.writeInt32LE(-128,22);
 const tga=Buffer.alloc(18);tga[2]=2;tga.writeUInt16LE(256,12);tga.writeUInt16LE(128,14);tga[16]=24;
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.write('WEBP',8);webp.write('VP8X',12);webp[24]=255;webp[27]=127;
 const dds=Buffer.alloc(128);dds.write('DDS ');dds.writeUInt32LE(124,4);dds.writeUInt32LE(128,12);dds.writeUInt32LE(256,16);
 const jpeg=Buffer.from([255,216,255,192,0,17,8,0,128,1,0,3,1,17,0,2,17,0,3,17,0,255,217]);
 for(const [name,bytes] of [['a.bmp',bmp],['a.tga',tga],['a.webp',webp],['a.dds',dds],['a.jpg',jpeg]])assert.deepEqual(modelTextureDimensions(bytes,name),{width:256,height:128},name);
 dds.writeUInt32LE(512,112);assert.throws(()=>modelTextureDimensions(dds,'cube.dds'),/立方体/);
});
