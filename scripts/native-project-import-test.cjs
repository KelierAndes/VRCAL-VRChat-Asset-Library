// Opt-in native handoff test. Batch mode cannot click Unity’s interactive import dialog.
// Runs only a new synthetic project; verifies the real Editor helper receives and claims the request.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {ProjectImports}=require('../dist/main/main/project-import');
const editor=process.env.VRC_NATIVE_TEST_UNITY;
if(!editor||!fs.existsSync(editor))throw Error('Set VRC_NATIVE_TEST_UNITY to the Unity 2022.3.22f1 executable to opt in.');
const run=fs.mkdtempSync(path.resolve(__dirname,'../../native-project-import-')),root=path.join(run,'Sources'),projectPath=path.join(root,'SyntheticProject'),dataDir=path.join(run,'Library'),guid='f30b5522103543d28ea5237ceaa186ac',content='VRCAL synthetic native import — 日本語 中文\n';
function write(p,data){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data)}
function tar(files){const blocks=[];for(const [name,text] of Object.entries(files)){const data=Buffer.from(text),h=Buffer.alloc(512);h.write(name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263);h.write([...h].reduce((n,v)=>n+v,0).toString(8).padStart(6,'0')+'\0 ',148);blocks.push(h,data,Buffer.alloc((512-data.length%512)%512))}return Buffer.concat([...blocks,Buffer.alloc(1024)])}
function record(id,p,kind){return {id,path:p,name:path.basename(p),kind,group:'Synthetic',size:0,mtimeMs:1,missing:false,manual:{},online:{status:'pending'},localAvatars:[],hintUrls:[]}}
(async()=>{
 for(const dir of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(projectPath,dir),{recursive:true});fs.mkdirSync(dataDir);
 write(path.join(projectPath,'Packages/manifest.json'),'{"dependencies":{}}');write(path.join(projectPath,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.22f1\n');
 const pkg=path.join(root,'Native_Test_v1.0.unitypackage');write(pkg,zlib.gzipSync(tar({[guid+'/asset']:content,[guid+'/asset.meta']:'fileFormatVersion: 2\nguid: '+guid+'\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n',[guid+'/pathname']:'Assets/VRCALNativeTest/日本語_sample.txt'})));
 const originalHash=crypto.createHash('sha256').update(fs.readFileSync(pkg)).digest('hex'),project=record('project',projectPath,'unity-project'),asset=record('source',pkg,'unitypackage'),map=new Map([[project.id,project],[asset.id,asset]]);
 const service=new ProjectImports({dataDir,roots:()=>[root],getAsset:id=>map.get(id),findEditor:async()=>undefined});
 const source=(await service.sources(asset.id))[0],job=await service.execute((await service.preview(asset.id,project.id,source.id)).token);
 write(path.join(projectPath,'Assets/Editor/VRCALNativeAcceptance.cs'),`using System; using System.IO; using UnityEditor; using UnityEngine;
 public static class VRCALNativeAcceptance { static double deadline; public static void Run() { deadline=EditorApplication.timeSinceStartup+100; EditorApplication.update+=Check; }
 static void Check() { string receipt=Path.Combine(Application.dataPath,"../Library/VRCALImportBridge/Results/${job.id}.json"); if(File.Exists(receipt)) { string text=File.ReadAllText(receipt); if(text.Contains("\\\"state\\\":\\\"importing\\\"")) {EditorApplication.Exit(0);return;} if(text.Contains("\\\"state\\\":\\\"failed\\\"")||text.Contains("\\\"state\\\":\\\"cancelled\\\"")) {Debug.LogError(text);EditorApplication.Exit(2);return;} } if(EditorApplication.timeSinceStartup>deadline) {Debug.LogError("Native import timed out waiting for Unity confirmation.");EditorApplication.Exit(3);} } }`);
 const child=spawn(editor,['-batchmode','-nographics','-projectPath',projectPath,'-executeMethod','VRCALNativeAcceptance.Run','-logFile',path.join(run,'Unity.log')],{stdio:'ignore',windowsHide:true});
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Synthetic Unity process timed out (180s).'))},180000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',code=>{clearTimeout(timer);resolve(code)})});
 const jobs=await service.jobs(),final=jobs.find(j=>j.id===job.id);assert.equal(code,0,'Unity integration failed; see '+path.join(run,'Unity.log'));assert.equal(final.state,'importing');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(pkg)).digest('hex'),originalHash);
 const report={ok:true,run,unityVersion:'2022.3.22f1',batchMode:true,interactiveConfirmationTested:false,nativeHandoffVerified:true,originalHash,job:final};write(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,report:path.join(run,'report.json')}));
})().catch(e=>{write(path.join(run,'report.json'),JSON.stringify({ok:false,error:e.stack,run},null,2));console.error(e);process.exitCode=1});
