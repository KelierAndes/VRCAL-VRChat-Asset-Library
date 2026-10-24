const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
let THREE;before(async()=>{THREE=await import('three')});
const source=path.resolve(__dirname,'../src/renderer/model-scene.ts');
function helpers(){assert(fs.existsSync(source),'the independent model scene helper must exist');const loaded=new Module(source,module);loaded.filename=source;loaded.paths=Module._nodeModulePaths(path.dirname(source));const normalRequire=loaded.require.bind(loaded);loaded.require=name=>name==='three'?THREE:normalRequire(name);loaded._compile(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,source);return loaded.exports}
function mesh(name,width=1,height=1){const model=new THREE.Mesh(new THREE.BoxGeometry(width,height,1),new THREE.MeshStandardMaterial());model.name=name;return model}

test('combining two model layers preserves original sizes, coordinates and bone ownership',()=>{
 const {ModelSceneLayer,modelSceneBounds,applyModelTransform}=helpers(),body=mesh('body',1,2),dress=mesh('dress',.5,1);body.position.set(10,2,0);dress.position.set(10,2.5,0);const bone=new THREE.Bone();dress.add(bone);
 const a=new ModelSceneLayer('primary',dress),b=new ModelSceneLayer('reference',body),before={position:dress.position.toArray(),scale:dress.scale.toArray(),parent:bone.parent};
 const bounds=modelSceneBounds([a,b]);assert.equal(bounds.getSize(new THREE.Vector3()).y,2);assert.deepEqual(dress.scale.toArray(),[1,1,1]);
 applyModelTransform(a.root,{scale:2,x:3,y:4,z:5,yaw:90});assert.deepEqual(dress.position.toArray(),before.position);assert.deepEqual(dress.scale.toArray(),before.scale);assert.equal(bone.parent,before.parent);assert.deepEqual(b.root.position.toArray(),[0,0,0]);assert.deepEqual(b.root.scale.toArray(),[1,1,1]);
 assert.equal(a.root.scale.x,2);assert.equal(a.root.position.x,3);assert(Math.abs(a.root.rotation.y-Math.PI/2)<1e-10);a.dispose();b.dispose();
});

test('invalid manual transforms cannot partly change a layer or accept nonfinite input',()=>{
 const {applyModelTransform}=helpers(),root=new THREE.Group(),initial={scale:1,x:0,y:0,z:0,yaw:0};applyModelTransform(root,initial);
 for(const value of [{...initial,scale:0},{...initial,scale:10001},{...initial,x:100001},{...initial,yaw:361},{...initial,z:Infinity},{...initial,y:NaN},{...initial,scale:'2'}]){assert.throws(()=>applyModelTransform(root,value),/变换|缩放|范围/);assert.deepEqual(root.position.toArray(),[0,0,0]);assert.deepEqual(root.scale.toArray(),[1,1,1]);}
 applyModelTransform(root,{scale:.0001,x:-100000,y:100000,z:0,yaw:-360});assert.equal(root.scale.x,.0001);
});

test('triangle budget counts both layers and includes hidden model parts',()=>{
 const {ModelSceneLayer,summarizeModelScene}=helpers(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(1500001*3),1));
 const a=new ModelSceneLayer('primary',new THREE.Mesh(geometry,new THREE.MeshBasicMaterial())),b=new ModelSceneLayer('reference',new THREE.Mesh(geometry.clone(),new THREE.MeshBasicMaterial()));b.root.visible=false;
 assert.throws(()=>summarizeModelScene([a,b]),/300 万|三角面/);a.dispose();b.dispose();
 const single=new ModelSceneLayer('primary',mesh('one'));assert.equal(summarizeModelScene([single]).triangles,12);single.dispose();
});

test('instanced geometry cannot bypass the total rendered triangle budget',()=>{
 const {ModelSceneLayer,summarizeModelScene}=helpers(),instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),250001),layer=new ModelSceneLayer('primary',instanced);
 assert.throws(()=>summarizeModelScene([layer]),/三角面/);layer.dispose();
});

test('wrapping and transforming skinned models preserves skeleton bindings and original bone hierarchy',()=>{
 const {ModelSceneLayer,applyModelTransform}=helpers(),root=new THREE.Group(),bone=new THREE.Bone(),skin=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());root.add(bone,skin);const skeleton=new THREE.Skeleton([bone]);skin.bind(skeleton);const bind=skin.bindMatrix.clone(),boneInverse=skeleton.boneInverses[0].clone(),layer=new ModelSceneLayer('primary',root);
 applyModelTransform(layer.root,{scale:.01,x:2,y:3,z:4,yaw:180});assert.equal(skin.skeleton,skeleton);assert.equal(bone.parent,root);assert.equal(skin.parent,root);assert(skin.bindMatrix.equals(bind));assert(skeleton.boneInverses[0].equals(boneInverse));assert.equal(skin.bindMode,'attached');layer.dispose();
});

test('part visibility is scoped to its model layer and lists at most one hundred meshes',()=>{
 const {ModelSceneLayer}=helpers(),first=new THREE.Group(),second=mesh('Body');for(let n=0;n<105;n++)first.add(mesh('part-'+n));const a=new ModelSceneLayer('primary',first),b=new ModelSceneLayer('reference',second);
 assert.equal(a.parts().length,100);const part=a.parts()[0];a.setPartVisible(part.id,false);assert.equal(a.parts()[0].visible,false);assert.equal(b.parts()[0].visible,true);assert.throws(()=>b.setPartVisible(part.id,false),/部件/);a.dispose();b.dispose();
});

test('releasing one layer disposes its originals once while the other layer stays usable',()=>{
 const {ModelSceneLayer}=helpers(),one=mesh('same-name'),two=mesh('same-name'),textureA=new THREE.Texture(),textureB=new THREE.Texture();one.material.map=textureA;two.material.map=textureB;
 const a=new ModelSceneLayer('primary',one),b=new ModelSceneLayer('reference',two),counts={a:0,b:0,textureA:0,textureB:0};one.material.addEventListener('dispose',()=>counts.a++);two.material.addEventListener('dispose',()=>counts.b++);textureA.addEventListener('dispose',()=>counts.textureA++);textureB.addEventListener('dispose',()=>counts.textureB++);
 a.setSolid(true);a.dispose();a.dispose();assert.deepEqual(counts,{a:1,b:0,textureA:1,textureB:0});assert.equal(b.parts()[0].visible,true);b.dispose();assert.deepEqual(counts,{a:1,b:1,textureA:1,textureB:1});
});

test('mesh mixed with lines, points or sprites is rejected and every drawable resource is released',()=>{
 const {ModelSceneLayer,summarizeModelScene}=helpers();
 for(const kind of ['line','points','sprite']){
  const group=new THREE.Group(),valid=mesh('small-valid'),texture=new THREE.Texture();let drawable;
  if(kind==='line')drawable=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,1,1)]),new THREE.LineBasicMaterial());
  else if(kind==='points')drawable=new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),new THREE.PointsMaterial());
  else drawable=new THREE.Sprite(new THREE.SpriteMaterial());
  drawable.material.map=texture;group.add(valid,drawable);const layer=new ModelSceneLayer('primary',group),freed={mesh:0,geometry:0,material:0,texture:0};
  valid.geometry.addEventListener('dispose',()=>freed.mesh++);drawable.geometry.addEventListener('dispose',()=>freed.geometry++);drawable.material.addEventListener('dispose',()=>freed.material++);texture.addEventListener('dispose',()=>freed.texture++);
  assert.throws(()=>summarizeModelScene([layer]),/线|点|精灵|网格/,kind);layer.dispose();layer.dispose();assert.deepEqual(freed,{mesh:1,geometry:1,material:1,texture:1},kind);
 }
});
