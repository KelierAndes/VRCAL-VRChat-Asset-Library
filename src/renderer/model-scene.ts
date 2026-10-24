import * as THREE from 'three';

export type ModelLayer='primary'|'reference';
export interface ModelTransform {scale:number;x:number;y:number;z:number;yaw:number}
export interface ModelPart {id:string;name:string;visible:boolean}
export const MODEL_SCENE_MAX_TRIANGLES=3000000;
export const IDENTITY_MODEL_TRANSFORM:Readonly<ModelTransform>=Object.freeze({scale:1,x:0,y:0,z:0,yaw:0});

/** Validate the whole edit before touching an object, including programmatic callers. */
export function checkedModelTransform(value:ModelTransform):ModelTransform {
 if(!value||typeof value!=='object'||!['scale','x','y','z','yaw'].every(k=>typeof value[k as keyof ModelTransform]==='number'&&Number.isFinite(value[k as keyof ModelTransform])))throw new Error('模型变换必须是有限数值。');
 if(value.scale<.0001||value.scale>10000||Math.abs(value.x)>100000||Math.abs(value.y)>100000||Math.abs(value.z)>100000||Math.abs(value.yaw)>360)throw new Error('模型变换超出范围：缩放 0.0001–10000，位置 ±100000，旋转 ±360°。');
 return {scale:value.scale,x:value.x,y:value.y,z:value.z,yaw:value.yaw};
}
/** Only the new wrapper changes. Imported transforms and skeleton bindings stay intact. */
export function applyModelTransform(root:THREE.Group,value:ModelTransform):void {
 const next=checkedModelTransform(value);root.position.set(next.x,next.y,next.z);root.scale.setScalar(next.scale);root.rotation.set(0,THREE.MathUtils.degToRad(next.yaw),0);root.updateMatrixWorld(true);
}

/** A separately parsed model owns all of its GPU resources; layers never share loaders. */
export class ModelSceneLayer {
 readonly root=new THREE.Group();
 readonly materials=new Set<THREE.Material>();
 readonly originals=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();
 readonly solid=new THREE.MeshStandardMaterial({color:0xc8cfdb,roughness:.75,side:THREE.DoubleSide});
 readonly meshes:THREE.Mesh[]=[];
 readonly unsupported=new Set<string>();
 readonly triangles:number;
 private geometries=new Set<THREE.BufferGeometry>();
 private partMeshes=new Map<string,THREE.Mesh>();
 private disposed=false;
 constructor(readonly layer:ModelLayer,readonly model:THREE.Object3D){
  this.root.name='VRCAL preview '+layer;this.root.add(model);let triangles=0;
  model.traverse(node=>{
   const drawable=node as THREE.Mesh&{isLine?:boolean;isPoints?:boolean;isSprite?:boolean};
   if(!drawable.isMesh&&!drawable.isLine&&!drawable.isPoints&&!drawable.isSprite)return;
   // Own resources before validation rejects an unsupported drawable. Throwing
   // during construction would leave the caller without its cleanup handle.
   if(drawable.geometry)this.geometries.add(drawable.geometry);
   for(const material of Array.isArray(drawable.material)?drawable.material:[drawable.material])this.materials.add(material);
   if(!drawable.isMesh){this.unsupported.add(drawable.isLine?'线条':drawable.isPoints?'点云':'精灵');return}
   const mesh=drawable;this.meshes.push(mesh);const count=(mesh as THREE.InstancedMesh).isInstancedMesh?(mesh as THREE.InstancedMesh).count:1;triangles+=Math.floor((mesh.geometry.index?.count??mesh.geometry.attributes.position?.count??0)/3)*(Number.isSafeInteger(count)&&count>=0?count:Infinity);this.originals.set(mesh,mesh.material);if(this.partMeshes.size<100)this.partMeshes.set(mesh.uuid,mesh);
  });
  this.triangles=triangles;
 }
 parts():ModelPart[]{return [...this.partMeshes].map(([id,mesh],index)=>({id,name:(mesh.name||mesh.geometry.name||`网格 ${index+1}`).slice(0,160),visible:mesh.visible}))}
 setPartVisible(id:string,visible:boolean):void {const mesh=this.partMeshes.get(id);if(!mesh||typeof visible!=='boolean')throw new Error('请选择当前模型列表中的部件。');mesh.visible=visible}
 setSolid(value:boolean):void {for(const [mesh,material] of this.originals)mesh.material=value?this.solid:material}
 setWireframe(value:boolean):void {for(const material of [...this.materials,this.solid])if('wireframe' in material)(material as THREE.MeshStandardMaterial).wireframe=value}
 dispose():void {
  if(this.disposed)return;this.disposed=true;this.root.removeFromParent();
  const textures=new Set<THREE.Texture>(),skeletons=new Set<THREE.Skeleton>();
  for(const mesh of this.meshes){if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);if((mesh as THREE.InstancedMesh).isInstancedMesh)(mesh as THREE.InstancedMesh).dispose()}
  for(const material of this.materials){for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);material.dispose()}
  for(const texture of textures)texture.dispose();for(const geometry of this.geometries)geometry.dispose();for(const skeleton of skeletons)skeleton.dispose();this.solid.dispose();this.root.clear();this.originals.clear();this.materials.clear();this.geometries.clear();this.partMeshes.clear();this.unsupported.clear();this.meshes.length=0;
 }
}

export function summarizeModelScene(layers:ModelSceneLayer[]):{meshes:number;triangles:number;materials:number} {
 const unsupported=[...new Set(layers.flatMap(layer=>[...layer.unsupported]))];
 if(unsupported.length)throw new Error(`轻量预览仅支持网格模型；文件含有不支持的${unsupported.join('、')}，请改选其他模型。`);
 let meshes=0,triangles=0,materials=0;for(const layer of layers){meshes+=layer.meshes.length;triangles+=layer.triangles;materials+=layer.materials.size}
 if(!meshes)throw new Error('文件中没有可显示的网格模型。');
 if(!Number.isFinite(triangles)||triangles>MODEL_SCENE_MAX_TRIANGLES)throw new Error('组合模型总计超过 300 万三角面轻量预览上限，请使用优化后的模型。');
 return {meshes,triangles,materials};
}
/** Camera framing uses the union; it never normalizes either model's size or position. */
export function modelSceneBounds(layers:ModelSceneLayer[],visibleOnly=false):THREE.Box3 {
 const combined=new THREE.Box3();for(const layer of layers){if(visibleOnly&&!layer.root.visible)continue;layer.root.updateMatrixWorld(true);combined.union(new THREE.Box3().setFromObject(layer.root,true))}
 const size=combined.getSize(new THREE.Vector3());
 if(combined.isEmpty()||![...size.toArray(),...combined.min.toArray(),...combined.max.toArray()].every(Number.isFinite)||size.length()===0)throw new Error('模型范围无效，无法定位镜头。');
 return combined;
}
