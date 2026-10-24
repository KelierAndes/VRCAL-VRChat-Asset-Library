import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import {DDSLoader} from 'three/addons/loaders/DDSLoader.js';
import {modelFormat,resolveModelResource,modelMaterialResourceBase,ModelPreviewResources,type ModelBundle} from '../shared/model-preview';

export interface ModelStats {meshes:number;triangles:number;animations:number;materials:number;dimensions:string}
const mime=(name:string)=>/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':/\.bmp$/i.test(name)?'image/bmp':'application/octet-stream';
export class ModelViewer {
 private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(38,1,.01,1000);private renderer:THREE.WebGLRenderer;private controls:OrbitControls;private resize:ResizeObserver;
 private model?:THREE.Object3D;private materials=new Set<THREE.Material>();private originals=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();private solid=new THREE.MeshStandardMaterial({color:0xc8cfdb,roughness:.75,side:THREE.DoubleSide});
 private resources=new ModelPreviewResources();private closed=false;private dirty=true;private raf=0;private last=0;private ratio=.75;private grid=new THREE.GridHelper(10,20,0x637082,0x343c49);private light=new THREE.DirectionalLight(0xffffff,2.5);private fill=new THREE.HemisphereLight(0xffffff,0x607080,2.3);private animation?:THREE.AnimationMixer;private clips:THREE.AnimationClip[]=[];private playing=false;private visibility=()=>{this.last=0;this.dirty=true};
 constructor(private host:HTMLElement,private warning:(message:string)=>void){
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setClearColor(0x1c222b);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;this.renderer.domElement.setAttribute('aria-label','模型三维画面');this.host.appendChild(this.renderer.domElement);
  this.light.position.set(3,5,4);this.scene.add(this.fill,this.light,this.grid);this.camera.position.set(3,2,4);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.addEventListener('change',()=>{this.dirty=true});
  this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);this.resize=new ResizeObserver(()=>this.updateSize());this.resize.observe(host);document.addEventListener('visibilitychange',this.visibility);window.addEventListener('blur',this.visibility);window.addEventListener('focus',this.visibility);this.tick();
 }
 private contextLost=(event:Event)=>{event.preventDefault();this.warning('显卡预览上下文已中断，请关闭预览后重开；资料库仍可使用。')};
 private updateSize(){const width=Math.max(1,this.host.clientWidth),height=Math.max(1,this.host.clientHeight);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(Math.min(devicePixelRatio,2)*this.ratio);this.renderer.setSize(width,height,false);this.dirty=true}
 setRatio(value:number){this.ratio=[.25,.5,.75,1].includes(value)?value:.75;this.updateSize()}
 setExposure(value:number){this.renderer.toneMappingExposure=value;this.dirty=true}
 setWireframe(value:boolean){for(const m of [...this.materials,this.solid])if('wireframe' in m)(m as THREE.MeshStandardMaterial).wireframe=value;this.dirty=true}
 setSolid(value:boolean){for(const [mesh,material] of this.originals)mesh.material=value?this.solid:material;this.dirty=true}
 setPlaying(value:boolean){this.playing=value&&!!this.clips.length;if(this.animation&&this.clips[0]){if(this.playing)this.animation.clipAction(this.clips[0]).play();else{this.animation.stopAllAction();this.animation.setTime(0)}}this.dirty=true}
 reset(){if(!this.model)return;const box=new THREE.Box3().setFromObject(this.model,true),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),radius=Math.max(size.length()*.5,.001),distance=radius/Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))*1.15;
  this.camera.near=Math.max(distance/10000,.00001);this.camera.far=distance*100;this.camera.position.copy(center).add(new THREE.Vector3(.55,.25,1).normalize().multiplyScalar(distance));this.camera.updateProjectionMatrix();this.controls.target.copy(center);this.controls.minDistance=radius*.02;this.controls.maxDistance=distance*12;this.controls.update();this.grid.position.set(center.x,box.min.y-radius*.005,center.z);this.grid.scale.setScalar(radius*.6);this.dirty=true;
 }
 async load(bundle:ModelBundle):Promise<ModelStats>{
  const warnings=new Set<string>(),names=bundle.files.map(f=>f.name),urls=new Map<string,string>();
  for(const file of bundle.files){const bytes=new Uint8Array(file.bytes),url=this.resources.trackURL(URL.createObjectURL(new Blob([bytes],{type:mime(file.name)})));urls.set(file.name,url)}
  const manager=new THREE.LoadingManager();manager.addHandler(/\.tga$/i,new TGALoader(manager));manager.addHandler(/\.dds$/i,new DDSLoader(manager));
  manager.setURLModifier(raw=>{
   if(raw.startsWith('blob:'))return this.resources.trackURL(raw);
   if(/^data:(?:image\/(?:png|jpe?g|webp|bmp)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(raw))return raw;
   const resolved=resolveModelResource(raw,bundle.name,names);if(resolved&&urls.has(resolved))return urls.get(resolved)!;
   warnings.add('部分贴图缺失或引用了外部路径，已显示可用材质。');return 'data:application/octet-stream;base64,';
  });
  manager.onError=()=>{warnings.add('部分贴图无法读取，画面可能与 Unity 不同。');this.dirty=true};manager.onLoad=()=>{this.dirty=true;if(warnings.size)this.warning([...warnings].join(' '))};
  const bytes=bundle.files.find(f=>f.name===bundle.name)?.bytes;if(!bytes)throw new Error('模型数据缺失。');const data=new Uint8Array(bytes).buffer,format=modelFormat(bundle.name);let model:THREE.Object3D;
  if(format==='fbx'){model=this.resources.captureObjectURLs(()=>new FBXLoader(manager).parse(data,''));this.clips=model.animations||[]}
  else if(format==='glb'||format==='gltf'){
   const loader=new GLTFLoader(manager);loader.register(parser=>{const textureLoader=parser.textureLoader;if(textureLoader instanceof THREE.ImageBitmapLoader){const load=textureLoader.load.bind(textureLoader);textureLoader.load=(url,onLoad,onProgress,onError)=>load(url,bitmap=>{this.resources.trackBitmap(bitmap);onLoad?.(bitmap)},onProgress,onError);}return {name:'VRCAL_resource_lifetime'};});
   const result=await loader.parseAsync(format==='gltf'?new TextDecoder().decode(data):data,'');model=result.scene;this.clips=result.animations;
  }
  else if(format==='obj'){const loader=new OBJLoader(manager);const text=new TextDecoder().decode(data),mtl=text.match(/^mtllib\s+(.+)$/m)?.[1]?.trim(),name=mtl?resolveModelResource(mtl,bundle.name,names):undefined,file=bundle.files.find(f=>f.name===name);if(file){const material=new MTLLoader(manager).parse(new TextDecoder().decode(file.bytes),modelMaterialResourceBase(file.name));material.preload();loader.setMaterials(material)}model=loader.parse(text)}
  else throw new Error('当前文件格式不支持轻量预览。');
  if(this.closed){this.release(model);throw new Error('预览已关闭。')}
  this.model=model;let meshes=0,triangles=0;
  model.traverse(node=>{if(!(node as THREE.Mesh).isMesh)return;const mesh=node as THREE.Mesh;meshes++;triangles+=Math.floor((mesh.geometry.index?.count??mesh.geometry.attributes.position?.count??0)/3);this.originals.set(mesh,mesh.material);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])this.materials.add(material)});
  if(!meshes)throw new Error('文件中没有可显示的网格模型。');if(triangles>3000000)throw new Error('模型超过 300 万三角面轻量预览上限，请使用优化后的模型。');
  const box=new THREE.Box3().setFromObject(model,true),size=box.getSize(new THREE.Vector3());if(box.isEmpty()||![...size.toArray(),...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)||size.length()===0)throw new Error('模型范围无效，无法定位镜头。');
  this.scene.add(model);this.animation=new THREE.AnimationMixer(model);this.reset();this.updateSize();this.dirty=true;
  if(warnings.size)this.warning([...warnings].join(' '));
  return {meshes,triangles,animations:this.clips.length,materials:this.materials.size,dimensions:size.toArray().map(n=>n.toFixed(3)).join(' × ')};
 }
 private tick=()=>{if(this.closed)return;this.raf=requestAnimationFrame(this.tick);const now=performance.now();if(document.hidden||!document.hasFocus()){this.last=now;return}if(now-this.last<1000/30)return;const delta=Math.min((now-this.last)/1000,.1);this.last=now;if(this.playing&&this.animation){this.animation.update(delta);this.dirty=true}if(this.dirty){this.renderer.render(this.scene,this.camera);this.renderer.domElement.dataset.previewFrame=String(Number(this.renderer.domElement.dataset.previewFrame||0)+1);this.dirty=false}};
 private release(object:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),skeletons=new Set<THREE.Skeleton>();object.traverse(node=>{if(!(node as THREE.Mesh).isMesh)return;const mesh=node as THREE.Mesh;if((mesh as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((mesh as THREE.SkinnedMesh).skeleton);geometries.add(mesh.geometry);for(const m of Array.isArray(this.originals.get(mesh)||mesh.material)?(this.originals.get(mesh)||mesh.material) as THREE.Material[]:[(this.originals.get(mesh)||mesh.material) as THREE.Material])materials.add(m)});for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose()}for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const s of skeletons)s.dispose()}
 dispose(){if(this.closed)return;this.closed=true;this.resources.dispose();cancelAnimationFrame(this.raf);this.resize.disconnect();document.removeEventListener('visibilitychange',this.visibility);window.removeEventListener('blur',this.visibility);window.removeEventListener('focus',this.visibility);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.controls.dispose();if(this.model){this.animation?.stopAllAction();this.animation?.uncacheRoot(this.model);this.release(this.model)}this.solid.dispose();this.grid.geometry.dispose();for(const m of Array.isArray(this.grid.material)?this.grid.material:[this.grid.material])m.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove()}
}
