// Opt-in: creates and launches only synthetic Unity projects beneath ignored test-artifacts/.
// Test doubles exercise editor transactions; --real-runtime additionally uses explicitly supplied runtime DLLs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const repository = path.resolve(__dirname, '..');
const editor = process.env.VRC_NATIVE_TEST_UNITY;
assert.ok(editor && fs.existsSync(editor), 'Set VRC_NATIVE_TEST_UNITY to the Unity 2022.3 editor executable.');
const helper = path.join(repository, 'assets/unity/VRCALMASetup.cs');
assert.ok(fs.existsSync(helper), 'The independent MA Editor helper must exist.');
const data = path.join(path.dirname(editor), 'Data');
const mono = path.join(data, 'MonoBleedingEdge/bin/mono.exe');
const csc = path.join(data, 'MonoBleedingEdge/lib/mono/4.5/csc.exe');
const refDir = path.join(data, 'NetStandard/ref/2.1.0');
const moduleDir = path.join(data, 'Managed/UnityEngine');
const references = [...fs.readdirSync(refDir).filter(x => x.endsWith('.dll')).map(x => path.join(refDir, x)),
  ...fs.readdirSync(moduleDir).filter(x => x.endsWith('.dll')).map(x => path.join(moduleDir, x))];
fs.mkdirSync(path.join(repository, 'test-artifacts'), { recursive: true });
const run = fs.mkdtempSync(path.join(repository, 'test-artifacts/ma-'));
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function compile(out, files, extra = []) {
  const rsp = out + '.rsp';
  write(rsp, ['-nostdlib+', '-langversion:7.3', '-target:library', '-out:' + JSON.stringify(out),
    ...references.concat(extra).map(x => '-r:' + JSON.stringify(x)), ...files.map(x => JSON.stringify(x))].join('\n'));
  const result = spawnSync(mono, [csc, '-noconfig', '@' + rsp], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const doubles = `using System; using System.Collections.Generic; using UnityEngine;
namespace VRC.SDK3.Avatars.Components { public class VRCAvatarDescriptor : MonoBehaviour {} }
namespace VRC.SDK3.Avatars.ScriptableObjects { public class VRCExpressionsMenu : ScriptableObject { [Serializable] public class Control { public enum ControlType { Button=101, Toggle=102, SubMenu=103 } public string name; public ControlType type; public Parameter parameter; public float value; [Serializable] public class Parameter { public string name; } } } }
namespace nadena.dev.modular_avatar.core {
 public class ModularAvatarMenuInstaller : MonoBehaviour { public VRC.SDK3.Avatars.ScriptableObjects.VRCExpressionsMenu menuToAppend, installTargetMenu; }
 public enum SubmenuSource { MenuAsset, Children }
 public class ModularAvatarMenuItem : MonoBehaviour { public VRC.SDK3.Avatars.ScriptableObjects.VRCExpressionsMenu.Control Control; public SubmenuSource MenuSource; public bool isDefault, isSaved=true, isSynced=true, automaticValue; public string label=""; }
 [Serializable] public class AvatarObjectReference { public GameObject targetObject; public string referencePath; public void Set(GameObject target) { targetObject=target; } public GameObject Get(Component owner){if(targetObject!=null)return targetObject;var root=owner.GetComponentInParent<VRC.SDK3.Avatars.Components.VRCAvatarDescriptor>();return root==null?null:root.transform.Find(referencePath??"")?.gameObject;} }
 [Serializable] public struct ToggledObject { public AvatarObjectReference Object; public bool Active; }
 public class ModularAvatarObjectToggle : MonoBehaviour { public List<ToggledObject> Objects {get;set;}=new List<ToggledObject>(); }
 public class ModularAvatarMergeArmature : MonoBehaviour {public AvatarObjectReference mergeTarget=new AvatarObjectReference();public GameObject mergeTargetObject=>mergeTarget.Get(this);}
 public class ModularAvatarBoneProxy : MonoBehaviour {public string subPath;public Transform target {get{var root=GetComponentInParent<VRC.SDK3.Avatars.Components.VRCAvatarDescriptor>();return root==null?null:root.transform.Find(subPath??"");}}}
}
namespace nadena.dev.modular_avatar.core.editor {
 public static class SetupOutfit {public static int Calls;public static bool Fail,WrongTarget;public static void SetupOutfitUI(GameObject outfit){Calls++;var avatar=outfit.transform.parent;var armature=outfit.transform.Find("Armature");var merge=(nadena.dev.modular_avatar.core.ModularAvatarMergeArmature)UnityEditor.Undo.AddComponent(armature.gameObject,typeof(nadena.dev.modular_avatar.core.ModularAvatarMergeArmature));merge.mergeTarget.Set(WrongTarget?GameObject.Find("Unrelated binding target"):avatar.Find("Armature").gameObject);outfit.transform.SetSiblingIndex(0);if(Fail){avatar.Find("Keep").localPosition=new Vector3(99,22,33);throw new InvalidOperationException("Synthetic SetupOutfit failure");}}}
}`;
const fixture = `using System; using System.IO; using System.Linq; using System.Reflection; using System.Collections; using UnityEditor; using UnityEditor.SceneManagement; using UnityEngine; using VRCAL.LocalAssets;
public static class VRCALMAAcceptance {
 static int assertions; static string root=Path.GetFullPath(Path.Combine(Application.dataPath,".."));
 static void Check(bool value,string message) { assertions++; if(!value)throw new Exception(message); }
 static object Call(string name,params object[] args) { try {return typeof(VRCALMASetup).GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Public).Invoke(null,args);}catch(TargetInvocationException e){throw e.InnerException;} }
 static T Field<T>(object target,string name) {return (T)target.GetType().GetField(name,BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance).GetValue(target);}
 static string Id() {return Guid.NewGuid().ToString();}
 static string Request(string id,string mode="copy",string[] paths=null,bool assemble=false) { var r=new VRCALMASetup.Request {schema=1,id=id,sha256=new string('a',64),projectPath=root,sourceName="Synthetic fixture",mode=mode,prefabPaths=paths??new[]{"Assets/Fixture.prefab"},sourcePackageName="Synthetic.unitypackage",assemble=assemble}; string p=Path.Combine(root,"Library/VRCALImportBridge/MARequests",id+".json");Directory.CreateDirectory(Path.GetDirectoryName(p));File.WriteAllText(p,JsonUtility.ToJson(r));Call("RefreshRequests");return p; }
 static VRCALMASetup.Request Read(string p) {return JsonUtility.FromJson<VRCALMASetup.Request>(File.ReadAllText(p));}
 static string Receipt(string id) {return File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/MAResults",id+".json"));}
 static string Hash(string p) {using(var s=System.Security.Cryptography.SHA256.Create())return Convert.ToBase64String(s.ComputeHash(File.ReadAllBytes(p)));}
 public static void Run() {try { Execute(); File.WriteAllText(Path.Combine(root,"acceptance.json"),"{\\"ok\\":true,\\"assertions\\":"+assertions+"}");EditorApplication.Exit(0);}catch(Exception e){Debug.LogException(e);File.WriteAllText(Path.Combine(root,"acceptance.json"),"{\\"ok\\":false,\\"error\\":"+JsonUtility.ToJson(new ErrorText {message=e.ToString()})+"}");EditorApplication.Exit(2);} }
 [Serializable]class ErrorText {public string message;}
 static void Execute() {
 EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
 var src=new GameObject("Fixture original");src.SetActive(true);PrefabUtility.SaveAsPrefabAsset(src,"Assets/Fixture.prefab");UnityEngine.Object.DestroyImmediate(src);
 var prefab=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Fixture.prefab");string before=Hash(Path.Combine(root,"Assets/Fixture.prefab"));
 if(File.Exists(Path.Combine(root,"assembly-missing-api-mode"))){Type d=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("VRC.SDK3.Avatars.Components.VRCAvatarDescriptor",false)).First(t=>t!=null);var loadedAvatar=new GameObject("Avatar without MA Editor API");loadedAvatar.AddComponent(d);string id=Id();Request(id,assemble:true);Call("ProcessAssemblyRequests");Check(loadedAvatar.transform.childCount==0,"Missing MA Editor API never falls back to parenting");Check((Call("AssemblyDependencyStatus") as string).Contains("Setup Outfit"),"Missing public API is named in status");Check(Receipt(id).Contains("waiting-selection"),"Missing public MA API stays pending");Check(Receipt(id).Contains("\\"assembly\\":true"),"Waiting and missing-API receipts preserve assembly mode");Check(before==Hash(Path.Combine(root,"Assets/Fixture.prefab")),"Missing API leaves source unchanged");return;}
 string absent=Call("DependencyStatus") as string;
 if(File.Exists(Path.Combine(root,"absent-mode"))) {Check(!String.IsNullOrEmpty(absent),"Missing MA/SDK must have actionable status");if(File.Exists(Path.Combine(root,"sdk-only-mode")))Check(absent.Contains("Modular Avatar"),"Missing MA with installed SDK must name MA");string id=Id();Request(id);Check(Receipt(id).Contains("waiting-selection"),"Missing dependencies must preserve pending request");Check(!Directory.GetFiles(Path.Combine(root,"Library/VRCALImportBridge/MAResults"),"*.tmp").Any(),"Atomic writes leave no temporary files");return;}
 Check(String.IsNullOrEmpty(absent),"Runtime components must be detected: "+absent);
 Type descriptor=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("VRC.SDK3.Avatars.Components.VRCAvatarDescriptor",false)).First(t=>t!=null);
 // Full NDMF editor initialization is deliberately excluded. Register SDK roots as its integration normally does.
 Type ndmf=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("nadena.dev.ndmf.runtime.RuntimeUtil",false)).FirstOrDefault(t=>t!=null);
 if(ndmf!=null){var types=(System.Collections.Generic.HashSet<Type>)ndmf.GetField("AllRootTypes",BindingFlags.Static|BindingFlags.NonPublic).GetValue(null);types.Add(descriptor);}
 var avatar=new GameObject("Synthetic avatar");avatar.AddComponent(descriptor);var untouched=new GameObject("Existing avatar child");untouched.transform.SetParent(avatar.transform,false);
 string id1=Id();var request=Read(Request(id1));Call("Apply",request,avatar,prefab,"日本語 / 菜单",false,true);
 Check(avatar.transform.childCount==2,"Apply creates exactly one owned group");Check(Receipt(id1).Contains("applied"),"Apply returns independent MA receipt");
 var group=avatar.transform.Cast<Transform>().First(t=>t.gameObject!=untouched);Check(group.childCount==2,"Generated menu stays separate from controlled instance");
 Type itemType=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("nadena.dev.modular_avatar.core.ModularAvatarMenuItem",false)).First(t=>t!=null);
 Type toggleType=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("nadena.dev.modular_avatar.core.ModularAvatarObjectToggle",false)).First(t=>t!=null);
 var item=group.GetComponentInChildren(itemType,true);Check(item!=null,"Menu item exists");Check(!Field<bool>(item,"isDefault"),"Default state follows explicit selection");
 var toggle=group.GetComponentInChildren(toggleType,true);var list=(IList)toggleType.GetProperty("Objects").GetValue(toggle);Check(list.Count==1,"Toggle controls exactly the imported instance");Check(Field<bool>(list[0],"Active"),"Toggle selected means visible");
 object reference=Field<object>(list[0],"Object");GameObject controlled=Field<GameObject>(reference,"targetObject");Check(controlled!=null&&controlled.transform.parent==group&&controlled!=item.gameObject,"Reference targets only the new instance");Check(!controlled.activeSelf,"Explicit default off changes the instance");
 Check(before==Hash(Path.Combine(root,"Assets/Fixture.prefab")),"Original prefab byte hash unchanged");Check(prefab.activeSelf,"Original prefab visibility unchanged");
 Call("Apply",request,avatar,prefab,"duplicate",true,true);Check(avatar.transform.childCount==2,"Duplicate application never creates another instance");
 Undo.PerformUndo();Check(avatar.transform.childCount==1&&untouched!=null,"One Undo removes entire transaction and preserves existing avatar child");
 Call("Apply",request,avatar,prefab,"duplicate after undo",true,true);Check(avatar.transform.childCount==1,"Receipt prevents unintended reapply after Undo");
 string packageId=Id();Request(packageId,"unitypackage");Check(Receipt(packageId).Contains("waiting-import"),"Package request waits for import receipt");
 Directory.CreateDirectory(Path.Combine(root,"Library/VRCALImportBridge/Results"));File.WriteAllText(Path.Combine(root,"Library/VRCALImportBridge/Results",packageId+".json"),"{\\"schema\\":1,\\"id\\":\\""+packageId+"\\",\\"sha256\\":\\""+new string('b',64)+"\\",\\"state\\":\\"completed\\"}");Call("RefreshRequests");Check(Receipt(packageId).Contains("waiting-import"),"Mismatched import hash cannot unlock MA");
 File.WriteAllText(Path.Combine(root,"Library/VRCALImportBridge/Results",packageId+".json"),"{\\"schema\\":1,\\"id\\":\\""+packageId+"\\",\\"sha256\\":\\""+new string('a',64)+"\\",\\"state\\":\\"completed\\"}");Call("RefreshRequests");Check(Receipt(packageId).Contains("waiting-selection"),"Matching receipt unlocks explicit selection");
 string cancelled=Id();Request(cancelled,"unitypackage");File.WriteAllText(Path.Combine(root,"Library/VRCALImportBridge/Results",cancelled+".json"),"{\\"schema\\":1,\\"id\\":\\""+cancelled+"\\",\\"sha256\\":\\""+new string('a',64)+"\\",\\"state\\":\\"cancelled\\"}");Call("RefreshRequests");Check(Receipt(cancelled).Contains("skipped"),"Cancelled imports finish MA as skipped instead of waiting forever");
 // Failure after creating an owned group must roll back all scene edits. Blocking the receipt file forces that boundary.
 string failId=Id();var failReq=Read(Request(failId));string failReceipt=Path.Combine(root,"Library/VRCALImportBridge/MAResults",failId+".json");
 using(var locked=File.Open(failReceipt,FileMode.Open,FileAccess.Read,FileShare.None)){bool failed=false;try{Call("Apply",failReq,avatar,prefab,"Rollback",true,true);}catch{failed=true;}Check(failed,"Receipt commit failure must surface");Check(avatar.transform.childCount==1,"Failed apply rolls back generated scene objects");}
 Check(before==Hash(Path.Combine(root,"Assets/Fixture.prefab")),"Source prefab unchanged after failure");
 string recovery=Id();Request(recovery);string state=Path.Combine(root,"Library/VRCALImportBridge/MAState",recovery+".json");Directory.CreateDirectory(Path.GetDirectoryName(state));File.WriteAllText(state,"{\\"schema\\":1,\\"id\\":\\""+recovery+"\\",\\"sha256\\":\\""+new string('a',64)+"\\",\\"phase\\":\\"applying\\"}");Call("RefreshRequests");Check(Receipt(recovery).Contains("error"),"Interrupted transactions stop for inspection instead of reapplying");Check(avatar.transform.childCount==1,"Recovery never creates a duplicate");
 string manual=Id();var manualReq=Read(Request(manual,"unitypackage",new string[0]));Call("PackageStarted","Synthetic");Call("PackageItems",new object[]{new[]{"Assets/Fixture.prefab"}});Check(!File.Exists(Path.Combine(root,"Library/VRCALImportBridge/MAState",manual+".json")),"Unrelated manual import cannot acquire pending request");
 SessionState.SetString("VRCAL.Import.Active.v1","{\\"id\\":\\""+manual+"\\",\\"sha256\\":\\""+new string('a',64)+"\\",\\"sourcePath\\":\\"C:/Synthetic.unitypackage\\"}");Call("PackageStarted","OtherPackage");Call("PackageItems",new object[]{new[]{"Assets/Fixture.prefab"}});Check(!File.Exists(Path.Combine(root,"Library/VRCALImportBridge/MAState",manual+".json")),"Unrelated package name cannot capture imported paths");Call("PackageStarted","Synthetic");Call("PackageItems",new object[]{new[]{"Assets/Fixture.prefab","Assets/../escape.prefab","Packages/x.prefab","Assets/unsafe.cs"}});Check(File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/MAState",manual+".json")).Contains("Assets/Fixture.prefab"),"Expected bridge import captures valid Prefab paths");Check(!File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/MAState",manual+".json")).Contains("escape"),"Captured paths cannot escape Assets");SessionState.EraseString("VRCAL.Import.Active.v1");Call("PackageEnded","Synthetic");
 // Preset components and settings must be inherited without rewriting their menu or parameter assets.
 Type menuType=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("VRC.SDK3.Avatars.ScriptableObjects.VRCExpressionsMenu",false)).First(t=>t!=null);var existingMenu=ScriptableObject.CreateInstance(menuType);AssetDatabase.CreateAsset(existingMenu,"Assets/ExistingMenu.asset");string menuHash=Hash(Path.Combine(root,"Assets/ExistingMenu.asset"));
 var presetSource=new GameObject("Preset");var presetItem=presetSource.AddComponent(itemType);itemType.GetField("isDefault").SetValue(presetItem,true);itemType.GetField("label").SetValue(presetItem,"Preserved preset");Type installerType=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetType("nadena.dev.modular_avatar.core.ModularAvatarMenuInstaller",false)).First(t=>t!=null);var presetInstaller=presetSource.AddComponent(installerType);installerType.GetField("menuToAppend").SetValue(presetInstaller,existingMenu);PrefabUtility.SaveAsPrefabAsset(presetSource,"Assets/Preset.prefab");UnityEngine.Object.DestroyImmediate(presetSource);
 var preset=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Preset.prefab");string presetHash=Hash(Path.Combine(root,"Assets/Preset.prefab"));string presetId=Id();var presetReq=Read(Request(presetId,"copy",new[]{"Assets/Preset.prefab"}));Call("Apply",presetReq,avatar,preset,"Ignored name",false,true);
 var inherited=avatar.GetComponentsInChildren(itemType,true);Check(inherited.Length==1,"Existing preset creates no extra generated menu");Check(Field<bool>(inherited[0],"isDefault"),"Existing default preserved");Check(Field<string>(inherited[0],"label")=="Preserved preset","Existing menu name preserved");Check(presetHash==Hash(Path.Combine(root,"Assets/Preset.prefab")),"Preset source unchanged");Check(menuHash==Hash(Path.Combine(root,"Assets/ExistingMenu.asset")),"Existing menu asset byte hash unchanged");Check(Field<UnityEngine.Object>(avatar.GetComponentInChildren(installerType,true),"menuToAppend")==existingMenu,"Preset retains its original menu reference");Undo.PerformUndo();Check(avatar.transform.childCount==1,"Preset insertion Undo is atomic");
 }
}`;

const assemblyFixture = `using System;using System.IO;using System.Linq;using System.Reflection;using UnityEditor;using UnityEditor.SceneManagement;using UnityEngine;using VRCAL.LocalAssets;
public static class VRCALMAAssemblyAcceptance {
 static string root=Path.GetFullPath(Path.Combine(Application.dataPath,".."));static int assertions;static readonly string sha=new string('c',64);static Type api=typeof(nadena.dev.modular_avatar.core.editor.SetupOutfit);
 static object Call(string name,params object[] args){try{return typeof(VRCALMASetup).GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,args);}catch(TargetInvocationException e){throw e.InnerException;}}
 static void Check(bool value,string message){assertions++;if(!value)throw new Exception(message);}
 static string Hash(string p){using(var h=System.Security.Cryptography.SHA256.Create())return Convert.ToBase64String(h.ComputeHash(File.ReadAllBytes(p)));}
 static int Calls{get{return (int)api.GetField("Calls").GetValue(null);}}
 static string Result(string id){return File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/MAResults",id+".json"));}
 static VRCALMASetup.Request Request(params string[] paths){var r=new VRCALMASetup.Request{schema=1,id=Guid.NewGuid().ToString(),sha256=sha,projectPath=root,sourceName="Assembly fixture",mode="copy",sourcePackageName="",prefabPaths=paths,assemble=true};var file=Path.Combine(root,"Library/VRCALImportBridge/MARequests",r.id+".json");Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file,JsonUtility.ToJson(r));Call("RefreshRequests");return r;}
 static void Remove(VRCALMASetup.Request r){File.Delete(Path.Combine(root,"Library/VRCALImportBridge/MARequests",r.id+".json"));Call("RefreshRequests");}
 static GameObject Avatar(string name){var a=new GameObject(name);a.AddComponent<VRC.SDK3.Avatars.Components.VRCAvatarDescriptor>();var arm=new GameObject("Armature");arm.transform.SetParent(a.transform,false);new GameObject("Hips").transform.SetParent(arm.transform,false);new GameObject("Keep").transform.SetParent(a.transform,false);return a;}
 static GameObject Prefab(string path,bool rig){var p=new GameObject(Path.GetFileNameWithoutExtension(path));if(rig){var arm=new GameObject("Armature");arm.transform.SetParent(p.transform,false);new GameObject("Hips").transform.SetParent(arm.transform,false);}PrefabUtility.SaveAsPrefabAsset(p,path);UnityEngine.Object.DestroyImmediate(p);return AssetDatabase.LoadAssetAtPath<GameObject>(path);}
 public static void Run(){try{Execute();Finish("acceptance.json");}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(2);}}
 static void Finish(string file){File.WriteAllText(Path.Combine(root,file),"{\\"ok\\":true,\\"assertions\\":"+assertions+"}");EditorApplication.Exit(0);}
 static void Execute(){EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);var outfit=Prefab("Assets/Outfit.prefab",true);var other=Prefab("Assets/Other.prefab",true);string hash=Hash(Path.Combine(root,"Assets/Outfit.prefab"));
 var noAvatar=Request("Assets/Outfit.prefab");Call("ProcessAssemblyRequests");Check(Result(noAvatar.id).Contains("waiting-selection"),"No avatar remains waiting");Check(Calls==0,"No avatar never invokes MA");Remove(noAvatar);
 var a=Avatar("Avatar A");var b=Avatar("Avatar B");var multiple=Request("Assets/Outfit.prefab");Call("ProcessAssemblyRequests");Check(a.transform.childCount==2&&b.transform.childCount==2,"Multiple avatars cause no scene edits before choice");Check(Calls==0,"Multiple avatars do not invoke MA before choice");
 Call("ApplyAssembly",multiple,b,outfit);Check(Calls==1,"Assembly calls the public SetupOutfitUI entrypoint");Check(b.transform.childCount==3,"Selected avatar receives exactly the Prefab");var instance=b.transform.GetChild(2).gameObject;Check(instance.name=="Outfit"&&instance.transform.parent==b.transform,"Prefab is a direct child without a VRCAL wrapper");Check(instance.transform.GetSiblingIndex()==b.transform.childCount-1,"Prefab is last sibling");Check(instance.GetComponentInChildren<nadena.dev.modular_avatar.core.ModularAvatarMergeArmature>().mergeTargetObject==b.transform.Find("Armature").gameObject,"MA target resolves selected avatar armature");Check(b.GetComponentsInChildren<nadena.dev.modular_avatar.core.ModularAvatarMenuItem>(true).Length==0,"Assembly does not generate a game menu");Check(Result(multiple.id).Contains("\\"assembly\\":true")&&Result(multiple.id).Contains("Avatar B/Outfit"),"Receipt carries assembly flag and hierarchy path");Check(hash==Hash(Path.Combine(root,"Assets/Outfit.prefab")),"Assembly leaves source Prefab bytes unchanged");Undo.PerformUndo();Check(b.transform.childCount==2,"One Undo removes the full assembly");Call("ApplyAssembly",multiple,b,outfit);Check(b.transform.childCount==2&&Calls==1,"Terminal receipt prevents reapply after Undo");Remove(multiple);UnityEngine.Object.DestroyImmediate(b);
 var manyPrefabs=Request("Assets/Outfit.prefab","Assets/Other.prefab");Call("ProcessAssemblyRequests");Check(a.transform.childCount==2&&Calls==1,"Multiple Prefabs wait without scene mutations");Remove(manyPrefabs);
 var unique=Request("Assets/Outfit.prefab");Call("ProcessAssemblyRequests");Check(a.transform.childCount==3&&Calls==2,"Unique avatar plus unique imported Prefab assembles automatically");Call("RefreshRequests");Call("ProcessAssemblyRequests");Check(a.transform.childCount==3&&Calls==2,"Polling the same request never duplicates it");Undo.PerformUndo();Check(a.transform.childCount==2,"Automatic assembly is one Undo group");Remove(unique);
 var broken=Request("Assets/Outfit.prefab");api.GetField("Fail").SetValue(null,true);bool failed=false;try{Call("ApplyAssembly",broken,a,outfit);}catch{failed=true;}api.GetField("Fail").SetValue(null,false);Check(failed&&a.transform.childCount==2,"Public MA failure rolls back the inserted Prefab");Check(a.transform.Find("Keep").localPosition==Vector3.zero,"Rollback also restores existing avatar state changed by the MA API");Check(Result(broken.id).Contains("error"),"MA failure is readable in its own receipt");Check(Result(broken.id).Contains("\\"assembly\\":true"),"Failed assembly receipts preserve assembly mode");Remove(broken);
 var unrelated=new GameObject("Unrelated binding target");var badTarget=Request("Assets/Outfit.prefab");api.GetField("WrongTarget").SetValue(null,true);failed=false;try{Call("ApplyAssembly",badTarget,a,outfit);}catch{failed=true;}api.GetField("WrongTarget").SetValue(null,false);Check(failed&&a.transform.childCount==2,"A wrong MA merge target fails postconditions and rolls back");Remove(badTarget);UnityEngine.Object.DestroyImmediate(unrelated);
 var plain=Prefab("Assets/Plain.prefab",false);var unknown=Request("Assets/Plain.prefab");failed=false;try{Call("ApplyAssembly",unknown,a,plain);}catch{failed=true;}Check(failed&&a.transform.childCount==2,"Unrigged ordinary Prefab is never misreported as assembled");Remove(unknown);
 var proxySource=new GameObject("ProxyPreset");proxySource.AddComponent<nadena.dev.modular_avatar.core.ModularAvatarBoneProxy>().subPath="Armature/Hips";PrefabUtility.SaveAsPrefabAsset(proxySource,"Assets/Proxy.prefab");UnityEngine.Object.DestroyImmediate(proxySource);var proxy=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Proxy.prefab");var proxyReq=Request("Assets/Proxy.prefab");int oldCalls=Calls;Call("ApplyAssembly",proxyReq,a,proxy);Check(Calls==oldCalls,"Legal author BoneProxy preset is preserved without SetupOutfit rewriting");Check(a.transform.GetChild(a.transform.childCount-1).GetComponent<nadena.dev.modular_avatar.core.ModularAvatarBoneProxy>().target==a.transform.Find("Armature/Hips"),"Preserved BoneProxy resolves the selected avatar");Undo.PerformUndo();Remove(proxyReq);
 var mergeSource=new GameObject("MergePreset");var mergeArm=new GameObject("Armature");mergeArm.transform.SetParent(mergeSource.transform,false);mergeArm.AddComponent<nadena.dev.modular_avatar.core.ModularAvatarMergeArmature>().mergeTarget.referencePath="Armature";PrefabUtility.SaveAsPrefabAsset(mergeSource,"Assets/MergePreset.prefab");UnityEngine.Object.DestroyImmediate(mergeSource);var mergePrefab=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/MergePreset.prefab");string mergeHash=Hash(Path.Combine(root,"Assets/MergePreset.prefab"));var mergeReq=Request("Assets/MergePreset.prefab");oldCalls=Calls;Call("ApplyAssembly",mergeReq,a,mergePrefab);Check(Calls==oldCalls,"Legal author MergeArmature preset is preserved without SetupOutfit rewriting");Check(a.transform.GetChild(a.transform.childCount-1).GetComponentInChildren<nadena.dev.modular_avatar.core.ModularAvatarMergeArmature>().mergeTargetObject==a.transform.Find("Armature").gameObject,"Preserved MergeArmature targets selected avatar");Check(mergeHash==Hash(Path.Combine(root,"Assets/MergePreset.prefab")),"Author merge Prefab bytes unchanged");Undo.PerformUndo();Remove(mergeReq);
 var saved=Request("Assets/Outfit.prefab");Call("ProcessAssemblyRequests");Check(a.transform.childCount==3,"Saved restart fixture has exactly one assembly");EditorSceneManager.SaveScene(a.scene,"Assets/AssemblySaved.unity");File.WriteAllText(Path.Combine(root,"restart-id.txt"),saved.id);Check(hash==Hash(Path.Combine(root,"Assets/Outfit.prefab")),"Source unchanged after success, failures, and Undo");}
 public static void Restart(){try{EditorSceneManager.OpenScene("Assets/AssemblySaved.unity");var a=GameObject.Find("Avatar A");Check(a!=null&&a.transform.childCount==3,"User-saved fixture reloads one assembled instance");Call("RefreshRequests");Call("ProcessAssemblyRequests");Check(a.transform.childCount==3&&Calls==0,"Fresh editor process uses persisted receipts to prevent duplicate assembly");Check(Result(File.ReadAllText(Path.Combine(root,"restart-id.txt"))).Contains("applied"),"Applied receipt survives editor restart");Finish("acceptance-restart.json");}catch(Exception e){Debug.LogException(e);EditorApplication.Exit(2);}}
}`;

const packageAssemblyFixture=`using System;using System.IO;using System.Linq;using System.Reflection;using System.Collections.Generic;using UnityEditor;using UnityEditor.SceneManagement;using UnityEngine;using VRCAL.LocalAssets;
public static class VRCALMAPackageAcceptance{
 static string root=Path.GetFullPath(Path.Combine(Application.dataPath,".."));static string id,sha;static GameObject avatar;static int assertions;static List<string> events=new List<string>();
 [Serializable]class BridgeInput{public int schema=1;public string id,sha256,projectPath,sourcePath;}
 [Serializable]class ImportedResult{public int schema=1;public string id,sha256,state="completed",message="fixture";public string[] importedAssetPaths;public bool importedPathsComplete;}
 static object Call(string name,params object[] args){try{return typeof(VRCALMASetup).GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args);}catch(TargetInvocationException e){throw e.InnerException;}}
 static void Check(bool value,string message){assertions++;if(!value)throw new Exception(message);}
 static void Write(string file,string data){Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file,data);}
 static string MaResult(string request){return File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/MAResults",request+".json"));}
 static VRCALMASetup.Request Request(string request){var r=new VRCALMASetup.Request{schema=1,id=request,sha256=sha,projectPath=root,sourceName="Actual package callbacks",mode="unitypackage",sourcePackageName="AssemblyBatch.unitypackage",prefabPaths=new string[0],assemble=true};Write(Path.Combine(root,"Library/VRCALImportBridge/MARequests",request+".json"),JsonUtility.ToJson(r));return r;}
 public static void Run(){try{
 System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(typeof(VRCALImportBridge).TypeHandle);System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(typeof(VRCALMASetup).TypeHandle);
 EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);avatar=new GameObject("Package avatar");avatar.AddComponent<VRC.SDK3.Avatars.Components.VRCAvatarDescriptor>();new GameObject("Armature").transform.SetParent(avatar.transform,false);new GameObject("Keep").transform.SetParent(avatar.transform,false);
 var src=new GameObject("ImportedRig");var arm=new GameObject("Armature");arm.transform.SetParent(src.transform,false);new GameObject("Hips").transform.SetParent(arm.transform,false);PrefabUtility.SaveAsPrefabAsset(src,"Assets/ImportedRig.prefab");UnityEngine.Object.DestroyImmediate(src);string package=Path.Combine(root,"AssemblyBatch.unitypackage");AssetDatabase.ExportPackage("Assets/ImportedRig.prefab",package,ExportPackageOptions.Default);AssetDatabase.DeleteAsset("Assets/ImportedRig.prefab");
 using(var h=System.Security.Cryptography.SHA256.Create())sha=BitConverter.ToString(h.ComputeHash(File.ReadAllBytes(package))).Replace("-","").ToLowerInvariant();id=Guid.NewGuid().ToString();Request(id);string bridgeFile=Path.Combine(root,"Library/VRCALImportBridge/Requests",id+".json.claimed");string input=JsonUtility.ToJson(new BridgeInput{id=id,sha256=sha,projectPath=root,sourcePath=package});Write(bridgeFile,input);var active=typeof(VRCALImportBridge).GetMethod("ReadRequest",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{bridgeFile});typeof(VRCALImportBridge).GetField("active",BindingFlags.NonPublic|BindingFlags.Static).SetValue(null,active);SessionState.SetString("VRCAL.Import.Active.v1",input);
 AssetDatabase.importPackageStarted+=name=>events.Add("started");AssetDatabase.importPackageCompleted+=name=>{events.Add("completed");EditorApplication.delayCall+=Verify;};AssetDatabase.onImportPackageItemsCompleted+=paths=>events.Add("items");
 // Only the native confirmation UI is bypassed; both real helpers receive Unity's actual import callbacks.
 AssetDatabase.ImportPackage(package,false);
 }catch(Exception e){Fail(e);}}
 static void Verify(){try{
 events.Add("tick");Check(events.IndexOf("completed")>=0&&events.IndexOf("items")>events.IndexOf("completed"),"Actual Unity callback order is completed before selected items");string bridge=File.ReadAllText(Path.Combine(root,"Library/VRCALImportBridge/Results",id+".json"));var imported=JsonUtility.FromJson<ImportedResult>(bridge);Check(imported.importedPathsComplete&&imported.importedAssetPaths.Contains("Assets/ImportedRig.prefab"),"Real bridge completion receipt contains complete imported paths");Call("RefreshRequests");Call("ProcessAssemblyRequests");Check(MaResult(id).Contains("applied")&&avatar.transform.childCount==3,"Both helpers automatically assemble the actual completed package batch");Check(avatar.transform.GetChild(2).name=="ImportedRig","Actual imported Prefab is direct last child");Undo.PerformUndo();Check(avatar.transform.childCount==2,"Cross-helper automatic assembly supports one Undo");
 string partial=Guid.NewGuid().ToString();var partialRequest=Request(partial);Write(Path.Combine(root,"Library/VRCALImportBridge/Results",partial+".json"),JsonUtility.ToJson(new ImportedResult{id=partial,sha256=sha,importedAssetPaths=new[]{"Assets/ImportedRig.prefab"},importedPathsComplete=false}));Call("RefreshRequests");Call("ProcessAssemblyRequests");Check(avatar.transform.childCount==2&&MaResult(partial).Contains("waiting-selection"),"A truncated one-Prefab path list is never treated as a unique whole batch");var prefab=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/ImportedRig.prefab");Call("ApplyAssembly",partialRequest,avatar,prefab);Check(avatar.transform.childCount==3&&MaResult(partial).Contains("applied"),"Partial lists still allow explicit choice from their reported Prefabs");Undo.PerformUndo();
 string unknown=Guid.NewGuid().ToString();var unknownRequest=Request(unknown);Write(Path.Combine(root,"Library/VRCALImportBridge/Results",unknown+".json"),JsonUtility.ToJson(new ImportedResult{id=unknown,sha256=sha,importedAssetPaths=new string[0],importedPathsComplete=false}));Call("RefreshRequests");Call("ProcessAssemblyRequests");Check(avatar.transform.childCount==2,"Unknown empty path receipt never auto-assembles");Call("ApplyAssembly",unknownRequest,avatar,prefab);Check(avatar.transform.childCount==3,"JsonUtility empty unknown list still allows explicit manual Prefab choice");Undo.PerformUndo();
 string protectedId=Guid.NewGuid().ToString();var protectedRequest=Request(protectedId);Write(Path.Combine(root,"Library/VRCALImportBridge/Results",protectedId+".json"),JsonUtility.ToJson(new ImportedResult{id=protectedId,sha256=sha,importedAssetPaths=new[]{"Assets/ImportedRig.prefab"},importedPathsComplete=true}));var other=new GameObject("Unrelated");PrefabUtility.SaveAsPrefabAsset(other,"Assets/Unrelated.prefab");UnityEngine.Object.DestroyImmediate(other);bool rejected=false;try{Call("ApplyAssembly",protectedRequest,avatar,AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Unrelated.prefab"));}catch{rejected=true;}Check(rejected&&avatar.transform.childCount==2,"Known completed batch rejects an unrelated Prefab before scene edits");
 File.WriteAllText(Path.Combine(root,"acceptance.json"),"{\\"ok\\":true,\\"assertions\\":"+assertions+",\\"actualPackageCallbacks\\":true,\\"events\\":[\\""+String.Join("\\",\\"",events)+"\\"]}");EditorApplication.Exit(0);
 }catch(Exception e){Fail(e);}}
 static void Fail(Exception e){Debug.LogException(e);EditorApplication.Exit(2);}
}`;

async function launch(project, log, method='VRCALMAAcceptance.Run', receipt='acceptance.json') {
  const child = spawn(editor, ['-batchmode', '-nographics', '-noUpm', '--burst-disable-compilation', '-disable-assembly-updater', '-projectPath', project,
    '-executeMethod', method, '-logFile', log], { stdio: 'ignore', windowsHide: true });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Own synthetic Unity process timed out; see ' + log)); }, 240000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', c => { clearTimeout(timer); resolve(c); });
  });
  assert.equal(code, 0, 'Unity fixture failed: ' + log);
  const logText=fs.readFileSync(log,'utf8');
  return {...JSON.parse(fs.readFileSync(path.join(project, receipt), 'utf8')),diagnostics:{
    managedExceptionCount:(logText.match(/^(?:NullReferenceException|TypeLoadException|FileNotFoundException):/gm)||[]).length,
    scriptMessageErrorCount:(logText.match(/^Script error:/gm)||[]).length,
    assemblyResolutionErrorCount:(logText.match(/Unable to resolve reference /g)||[]).length}};
}
function realRuntime(project) {
  const source = process.env.VRC_NATIVE_TEST_MA_PROJECT;
  assert.ok(source && fs.existsSync(path.join(source, 'Packages/nadena.dev.modular-avatar/package.json')), 'Set VRC_NATIVE_TEST_MA_PROJECT to the read-only installed MA project for --real-runtime.');
  const scripts = 'Library/ScriptAssemblies/';
  const sdk = 'Packages/com.vrchat.base/Runtime/VRCSDK/';
  // Named third-party runtime assemblies only. Never copy Assembly-CSharp, editor plugin assemblies, or user scripts.
  const relative = [scripts+'nadena.dev.modular-avatar.core.dll', scripts+'nadena.dev.ndmf.runtime.dll', scripts+'lyuma.av3emulator.dll', scripts+'UniTask.dll',
    scripts+'Unity.Burst.dll', scripts+'Unity.Collections.dll', scripts+'Unity.Mathematics.dll', scripts+'UnityEngine.UI.dll',
    sdk+'Plugins/VRCSDKBase.dll', sdk+'Plugins/VRC.Dynamics.dll', sdk+'Plugins/VRCCore-Editor.dll',
    sdk+'Plugins/VRC.SDK3.Dynamics.PhysBone.dll', sdk+'Plugins/VRC.SDK3.Dynamics.Contact.dll',
    'Packages/com.vrchat.avatars/Runtime/VRCSDK/Plugins/VRCSDK3A.dll',
    sdk+'Dependencies/Managed/System.Collections.Immutable.dll', sdk+'Dependencies/Managed/System.Runtime.CompilerServices.Unsafe.dll', sdk+'Dependencies/Managed/Collections.Pooled.dll',
    'Library/PackageCache/com.unity.burst@1.8.12/Unity.Burst.Unsafe.dll',
    'Library/PackageCache/com.unity.collections@2.1.4/Unity.Collections.LowLevel.ILSupport/Unity.Collections.LowLevel.ILSupport.dll'];
  return relative.map(file => {
    const from = path.join(source,file), before = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex');
    const target=path.join(project,'Assets/Runtime',path.basename(file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(from,target);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex'),before);
    return { source: from, sha256:before };
  });
}
(async () => {
  compile(path.join(run, 'VRCALMASetup.Editor.dll'), [helper]);
  if (process.argv.includes('--compile-only')) { console.log(JSON.stringify({ ok: true, compiled: true, run })); return; }
  const reports = [];
  const modes=process.argv.includes('--package-assembly-only')?['package-assembly']:process.argv.includes('--assembly-only')?['assembly-missing-api','assembly-doubles','package-assembly']:process.argv.includes('--real-runtime')?['absent','sdk-only','doubles','assembly-missing-api','assembly-doubles','package-assembly','real-runtime']:['absent','sdk-only','doubles','assembly-missing-api','assembly-doubles','package-assembly'];
  for (const mode of modes) {
    const project = path.join(run, mode);
    for (const dir of ['Assets/Editor', 'Packages', 'ProjectSettings']) fs.mkdirSync(path.join(project, dir), { recursive: true });
    write(path.join(project, 'Packages/manifest.json'), '{"dependencies":{}}');
    write(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n');
    if (mode === 'absent') write(path.join(project, 'absent-mode'), '');
    else if(mode==='sdk-only'){write(path.join(project,'absent-mode'),'');write(path.join(project,'sdk-only-mode'),'');const source=path.join(project,'SDKDouble.cs.txt');write(source,doubles.slice(0,doubles.indexOf('namespace nadena.')));compile(path.join(project,'Assets/SDKDouble.dll'),[source]);}
    else if(['doubles','assembly-doubles','assembly-missing-api','package-assembly'].includes(mode)) { const source = path.join(project, 'TestDoubles.cs.txt'); write(source,mode==='assembly-missing-api'?doubles.slice(0,doubles.indexOf('namespace nadena.dev.modular_avatar.core.editor')):doubles); compile(path.join(project, 'Assets/TestDoubles.dll'), [source]);if(mode==='assembly-missing-api')write(path.join(project,'assembly-missing-api-mode'),''); }
    else write(path.join(run,'runtime-sources.json'),JSON.stringify(realRuntime(project),null,2));
    const runner = path.join(project, 'Fixture.cs.txt'); write(runner, mode==='assembly-doubles'?assemblyFixture:mode==='package-assembly'?packageAssemblyFixture:fixture);
    compile(path.join(project, 'Assets/Editor/VRCALMASetup.Editor.dll'), mode==='package-assembly'?[helper,path.join(repository,'assets/unity/VRCALImportBridge.cs'),runner]:[helper, runner],['assembly-doubles','package-assembly'].includes(mode)?[path.join(project,'Assets/TestDoubles.dll')]:[]);
    reports.push({ mode, ...await launch(project, path.join(run, mode + '.log'),mode==='assembly-doubles'?'VRCALMAAssemblyAcceptance.Run':mode==='package-assembly'?'VRCALMAPackageAcceptance.Run':'VRCALMAAcceptance.Run') });
    if(mode==='assembly-doubles')reports.push({mode:'assembly-doubles-restart',...await launch(project,path.join(run,'assembly-restart.log'),'VRCALMAAssemblyAcceptance.Restart','acceptance-restart.json')});
  }
  const runtimeManifest=path.join(run,'runtime-sources.json');
  if(fs.existsSync(runtimeManifest))for(const file of JSON.parse(fs.readFileSync(runtimeManifest,'utf8')))
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.source)).digest('hex'),file.sha256,'Read-only runtime source changed: '+file.source);
  write(path.join(run, 'report.json'), JSON.stringify({ ok: true, unity: editor, realMARuntime:process.argv.includes('--real-runtime'), assemblySetupOutfit:'Public API double only; real SetupOutfit implementation is not tested', reports, limitations: ['Assembly transactions invoke a signature-matching public SetupOutfitUI double and validate its merge result. Actual installed MA Editor SetupOutfit and full clothing fitting are not validated.', 'Real-runtime mode covers legacy menu behavior using original named MA/SDK runtime DLLs; NDMF avatar-root registration is initialized by the fixture without the full MA editor/build pipeline.', 'SDK dynamics bootstrap exceptions and particle callback diagnostics may occur in the runtime-only fixture; their counts are reported. This is not a clean full SDK editor acceptance.', 'No real MA avatar build or upload validation.', 'Batch editor invokes production apply; does not click the selection UI.','Package callbacks are exercised directly; interactive package import dialogs are not clicked.'] }, null, 2));
  console.log(JSON.stringify({ ok: true, report: path.join(run, 'report.json'), reports }));
})().catch(error => { write(path.join(run, 'failure.json'), JSON.stringify({ error: error.stack }, null, 2)); console.error(error); process.exitCode = 1; });
