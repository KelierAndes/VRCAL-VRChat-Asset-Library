// Opt-in, bounded real MA Editor API test. Original installed packages and named DLLs are read-only inputs.
// No user Assembly-CSharp DLLs, arbitrary Editor plugins, user models, or original project launches.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync,spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),original=process.env.VRC_NATIVE_TEST_MA_PROJECT,editor=process.env.VRC_NATIVE_TEST_UNITY;
assert.ok(original&&fs.existsSync(path.join(original,'Library/ScriptAssemblies/nadena.dev.modular-avatar.core.editor.dll')),'Set VRC_NATIVE_TEST_MA_PROJECT to the read-only installed MA project.');
assert.ok(editor&&fs.existsSync(editor),'Set VRC_NATIVE_TEST_UNITY to the Unity 2022.3 editor executable.');
const data=path.join(path.dirname(editor),'Data'),mono=path.join(data,'MonoBleedingEdge/bin/mono.exe'),csc=path.join(data,'MonoBleedingEdge/lib/mono/4.5/csc.exe'),monop=path.join(data,'MonoBleedingEdge/lib/mono/4.5/monop.exe');
fs.mkdirSync(path.join(repo,'test-artifacts'),{recursive:true});
const run=fs.mkdtempSync(path.join(repo,'test-artifacts/ma-real-editor-')),project=path.join(run,'Project');
function write(p,t){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,t)}
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[])}
const candidates=new Map();
function candidate(file){if(!fs.existsSync(file))return;const name=path.basename(file,'.dll');if(!candidates.has(name))candidates.set(name,file)}
for(const f of fs.readdirSync(path.join(original,'Library/ScriptAssemblies')))if(/^(?:nadena\.dev\.(?:ndmf|modular-avatar)|VRC\.SDK|Unity\.|UnityEngine\.UI|lyuma\.av3emulator|UniTask)(?:[\w.-]*)\.dll$/.test(f)&&!/^Unity\.(?:Rider|VisualStudio|VSCode)/.test(f))candidate(path.join(original,'Library/ScriptAssemblies',f));
for(const base of ['Packages/com.vrchat.base/Runtime/VRCSDK/Plugins','Packages/com.vrchat.base/Runtime/VRCSDK/Dependencies','Packages/com.vrchat.avatars/Runtime/VRCSDK/Plugins','Packages/nadena.dev.ndmf/Dependencies~','Library/PackageCache/com.unity.ext.nunit@1.0.6','Library/PackageCache/com.unity.nuget.newtonsoft-json@3.2.1/Runtime','Library/PackageCache/com.unity.burst@1.8.12','Library/PackageCache/com.unity.collections@2.1.4'])for(const file of walk(path.join(original,base)))if(file.endsWith('.dll')&&!path.basename(file).startsWith('.__old_')&&!file.split(path.sep).includes('AOT'))candidate(file);
const queue=['nadena.dev.modular-avatar.core.editor','nadena.dev.ndmf','nadena.dev.ndmf.vrchat','nadena.dev.modular-avatar.core'],copied=new Map(),missing=new Set();
for(let i=0;i<queue.length;i++){
 const name=queue[i];if(copied.has(name))continue;
 if(/^(?:mscorlib|netstandard|System(?:\.|$)|Microsoft\.Win32\.|UnityEngine\..*Module$|UnityEditor\..*Module$)/.test(name)&&!candidates.has(name))continue;
 const source=candidates.get(name);if(!source){missing.add(name);continue}assert(copied.size<48,'Bounded attempt exceeded 48 named dependency DLLs.');
 const refs=spawnSync(mono,[monop,'-r:'+source,'--refs'],{encoding:'utf8',windowsHide:true});assert.equal(refs.status,0,refs.stderr);
 const dependencies=refs.stdout.replaceAll('\ufeff','').split(/\r?\n/).filter(x=>x.includes(', Version=')).map(x=>x.split(',')[0].trim());
 copied.set(name,{source,sha256:hash(source),dependencies});queue.push(...dependencies);
}
write(path.join(run,'dependency-manifest.json'),JSON.stringify({copied:[...copied.values()],missing:[...missing]},null,2));assert.equal(missing.size,0,'Unresolved bounded dependencies: '+[...missing].join(', '));
for(const [name,file]of copied){const target=path.join(project,'Assets/OfficialDLLs',name+'.dll');write(target,fs.readFileSync(file.source));}
// Preserve GUID-addressed localization and inspector resources, never source scripts or user project assets.
for(const pkg of ['nadena.dev.modular-avatar','nadena.dev.ndmf']){
 const base=path.join(original,'Packages',pkg,'Editor');
 for(const source of walk(base)){
  let rel=path.relative(base,source);const extension=path.extname(source).toLowerCase();
  if(!['.json','.uss','.uxml','.png','.svg','.txt','.shader','.compute','.asset','.meta'].includes(extension)||/\.(?:cs|asmdef|asmref)\.meta$/i.test(source))continue;
  if(extension==='.meta'&&!fs.statSync(source.slice(0,-5)).isDirectory()&&!['.json','.uss','.uxml','.png','.svg','.txt','.shader','.compute','.asset'].includes(path.extname(source.slice(0,-5)).toLowerCase()))continue;
  write(path.join(project,'Assets/OfficialResources',pkg,rel),fs.readFileSync(source));
 }
}
for(const part of ['Packages','ProjectSettings'])fs.mkdirSync(path.join(project,part),{recursive:true});write(path.join(project,'Packages/manifest.json'),'{"dependencies":{}}');write(path.join(project,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.22f1\n');
const fixture=`using System;using System.IO;using System.Linq;using System.Collections.Generic;using System.Reflection;using UnityEditor;using UnityEditor.SceneManagement;using UnityEngine;using VRCAL.LocalAssets;
public static class VRCALRealMAEditorAcceptance{
 static int assertions;static string root=Path.GetFullPath(Path.Combine(Application.dataPath,".."));static void Check(bool v,string m){assertions++;if(!v)throw new Exception(m);}static Type TypeOf(string n){return AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType(n,false)).FirstOrDefault(t=>t!=null);}static object Call(string n,params object[] p){try{return typeof(VRCALMASetup).GetMethod(n,BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,p);}catch(TargetInvocationException e){throw e.InnerException;}}
 static Transform Bone(Transform parent,string name,Vector3 pos){var t=new GameObject(name).transform;t.SetParent(parent,false);t.localPosition=pos;return t;}
 static GameObject Human(){var root=new GameObject("Real humanoid avatar");var arm=Bone(root.transform,"Armature",Vector3.zero);var h=Bone(arm,"Hips",new Vector3(0,1,0));var s=Bone(h,"Spine",new Vector3(0,.2f,0));var c=Bone(s,"Chest",new Vector3(0,.2f,0));var neck=Bone(c,"Neck",new Vector3(0,.2f,0));Bone(neck,"Head",new Vector3(0,.15f,0));foreach(int side in new[]{-1,1}){string p=side<0?"Left":"Right";var shoulder=Bone(c,p+"Shoulder",new Vector3(.1f*side,.12f,0));var ua=Bone(shoulder,p+"UpperArm",new Vector3(.18f*side,0,0));var la=Bone(ua,p+"LowerArm",new Vector3(.25f*side,0,0));Bone(la,p+"Hand",new Vector3(.2f*side,0,0));var ul=Bone(h,p+"UpperLeg",new Vector3(.1f*side,-.1f,0));var ll=Bone(ul,p+"LowerLeg",new Vector3(0,-.4f,0));var foot=Bone(ll,p+"Foot",new Vector3(0,-.4f,.05f));Bone(foot,p+"Toes",new Vector3(0,0,.15f));}
 var transforms=root.GetComponentsInChildren<Transform>();var names=new HashSet<string>(transforms.Select(t=>t.name));var description=new HumanDescription{human=HumanTrait.BoneName.Where(n=>names.Contains(n)).Select(n=>new HumanBone{boneName=n,humanName=n,limit=new HumanLimit{useDefaultValues=true}}).ToArray(),skeleton=transforms.Select(t=>new SkeletonBone{name=t.name,position=t.localPosition,rotation=t.localRotation,scale=t.localScale}).ToArray(),upperArmTwist=.5f,lowerArmTwist=.5f,upperLegTwist=.5f,lowerLegTwist=.5f,armStretch=.05f,legStretch=.05f,feetSpacing=0};var human=AvatarBuilder.BuildHumanAvatar(root,description);Check(human!=null&&human.isValid&&human.isHuman,"AvatarBuilder produced a real valid Humanoid Avatar");AssetDatabase.CreateAsset(human,"Assets/SyntheticHumanoid.asset");var animator=root.AddComponent<Animator>();animator.avatar=human;animator.Rebind();Check(animator.GetBoneTransform(HumanBodyBones.Hips)==h,"Real Animator resolves Humanoid Hips");root.AddComponent(TypeOf("VRC.SDK3.Avatars.Components.VRCAvatarDescriptor"));return root;}
 public static void Run(){try{EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);Type setup=TypeOf("nadena.dev.modular_avatar.core.editor.SetupOutfit");Check(setup!=null,"Actual MA Editor SetupOutfit type loaded");Check(setup.Assembly.GetName().Name=="nadena.dev.modular-avatar.core.editor","Public API comes from the original named MA Editor assembly");Check(String.IsNullOrEmpty(Call("AssemblyDependencyStatus")as string),"Installed actual public MA API and runtime components are compatible");var avatar=Human();var keep=Bone(avatar.transform,"Keep",Vector3.zero);var source=new GameObject("RealOutfit");var outfitArm=UnityEngine.Object.Instantiate(avatar.transform.Find("Armature").gameObject,source.transform,false);outfitArm.name="Armature";PrefabUtility.SaveAsPrefabAsset(source,"Assets/RealOutfit.prefab");UnityEngine.Object.DestroyImmediate(source);string p=Path.Combine(root,"Assets/RealOutfit.prefab"),before=Convert.ToBase64String(File.ReadAllBytes(p));var prefab=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RealOutfit.prefab");Type merge=TypeOf("nadena.dev.modular_avatar.core.ModularAvatarMergeArmature");Check(prefab.GetComponentsInChildren(merge,true).Length==0,"Synthetic source contains no existing MA merge configuration");var req=new VRCALMASetup.Request{schema=1,id=Guid.NewGuid().ToString(),sha256=new string('d',64),projectPath=root,sourceName="Real official MA Editor acceptance",mode="copy",prefabPaths=new[]{"Assets/RealOutfit.prefab"},sourcePackageName="",assemble=true};string request=Path.Combine(root,"Library/VRCALImportBridge/MARequests",req.id+".json");Directory.CreateDirectory(Path.GetDirectoryName(request));File.WriteAllText(request,JsonUtility.ToJson(req));Call("RefreshRequests");Call("ApplyAssembly",req,avatar,prefab);var instance=avatar.transform.GetChild(avatar.transform.childCount-1).gameObject;Check(instance.name=="RealOutfit"&&instance.transform.parent==avatar.transform,"Real SetupOutfit result is the direct last child");var binding=instance.GetComponentInChildren(merge,true);Check(binding!=null,"Real SetupOutfit created MA MergeArmature");Check((GameObject)merge.GetProperty("mergeTargetObject").GetValue(binding)==avatar.transform.Find("Armature").gameObject,"Real MA merge target resolves the selected Humanoid armature");Check(instance.GetComponent(TypeOf("nadena.dev.modular_avatar.core.ModularAvatarMeshSettings"))!=null,"Real API created its MeshSettings configuration");Check(Convert.ToBase64String(File.ReadAllBytes(p))==before,"Real API leaves source Prefab bytes unchanged");Undo.PerformUndo();Check(avatar.transform.childCount==2&&keep!=null,"One Undo removes actual SetupOutfit assembly and retains original avatar children");File.WriteAllText(Path.Combine(root,"acceptance.json"),"{\\"ok\\":true,\\"assertions\\":"+assertions+",\\"actualSetupOutfit\\":true}");EditorApplication.Exit(0);}catch(Exception e){Debug.LogException(e);File.WriteAllText(Path.Combine(root,"failure.txt"),e.ToString());EditorApplication.Exit(2);}}
}`;
write(path.join(run,'Fixture.cs.txt'),fixture);
const refs=[...fs.readdirSync(path.join(data,'NetStandard/ref/2.1.0')).filter(x=>x.endsWith('.dll')).map(x=>path.join(data,'NetStandard/ref/2.1.0',x)),...fs.readdirSync(path.join(data,'Managed/UnityEngine')).filter(x=>x.endsWith('.dll')).map(x=>path.join(data,'Managed/UnityEngine',x))];const dll=path.join(project,'Assets/Editor/VRCALMASetup.Editor.dll'),rsp=path.join(run,'compile.rsp');write(rsp,['-nostdlib+','-langversion:7.3','-target:library','-out:'+JSON.stringify(dll),...refs.map(x=>'-r:'+JSON.stringify(x)),JSON.stringify(path.join(repo,'assets/unity/VRCALMASetup.cs')),JSON.stringify(path.join(run,'Fixture.cs.txt'))].join('\n'));fs.mkdirSync(path.dirname(dll),{recursive:true});const compiled=spawnSync(mono,[csc,'-noconfig','@'+rsp],{encoding:'utf8',windowsHide:true});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
(async()=>{
 const log=path.join(run,'Unity.log');
 const child=spawn(editor,['-batchmode','-nographics','-noUpm','--burst-disable-compilation','-disable-assembly-updater','-projectPath',project,'-executeMethod','VRCALRealMAEditorAcceptance.Run','-logFile',log],{stdio:'ignore',windowsHide:true});
 const code=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill();reject(Error('Bounded own fixture timed out after 180s.'))},180000);
  child.on('exit',c=>{clearTimeout(timeout);resolve(c)});child.on('error',e=>{clearTimeout(timeout);reject(e)});
 });
 for(const entry of copied.values())assert.equal(hash(entry.source),entry.sha256,'Original DLL changed');
 const text=fs.readFileSync(log,'utf8');
 const result={ok:code===0,exitCode:code,run,project,officialDlls:copied.size,originalDllHashesUnchanged:true,
  actualSetupOutfit:code===0,publicApiAssembly:copied.get('nadena.dev.modular-avatar.core.editor'),
  acceptance:fs.existsSync(path.join(project,'acceptance.json'))?JSON.parse(fs.readFileSync(path.join(project,'acceptance.json'),'utf8')):undefined,
  diagnostics:{unresolvedAssemblyCount:(text.match(/Unable to resolve reference /g)||[]).length,
   nullReferenceCount:(text.match(/^NullReferenceException:/gm)||[]).length,
   argumentNullCount:(text.match(/^ArgumentNullException:/gm)||[]).length,
   typeInitializationCount:(text.match(/^TypeInitializationException:/gm)||[]).length,
   scriptMessageErrorCount:(text.match(/^Script error:/gm)||[]).length},
  limitations:['Synthetic Humanoid skeleton and matching outfit armature; no real clothing mesh, fitting, clipping, avatar build, or upload acceptance.',
   'Named official compiled MA/NDMF/SDK/Unity dependencies only; original project and user assets were not opened or copied.',
   'Isolated SDK initialization diagnostics remain in the log and are reported separately from the real public SetupOutfit transaction assertions.']};
 write(path.join(run,'report.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({ok:result.ok,report:path.join(run,'report.json'),actualSetupOutfit:result.actualSetupOutfit,acceptance:result.acceptance,diagnostics:result.diagnostics}));
 if(code!==0)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
