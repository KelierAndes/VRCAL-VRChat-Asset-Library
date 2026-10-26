const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {Store}=require('../dist/main/main/store'),{ProjectImports}=require('../dist/main/main/project-import'),{noLinks,validateProject}=require('../dist/main/main/project-access');

// Execute the actual IPC callbacks without starting Electron or opening a user profile.
function handler(name,context){
 const file=path.join(__dirname,'../src/main/main.ts'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let callback;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='handle'&&node.arguments[0]?.text===name)callback=node.arguments[1];ts.forEachChild(node,visit)}visit(source);assert(callback,`Missing IPC handler: ${name}`);
 const helper=path.join(__dirname,'../dist/main/main/project-registration.js'),add=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='addProject');
 return vm.runInNewContext(ts.transpileModule((add?add.getText(source)+'\n':'')+'('+callback.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...context,...(fs.existsSync(helper)?require(helper):{})});
}
function fixture(t){
 const area=fs.mkdtempSync(path.join(__dirname,'.fixtures-project-registration-')),root=path.join(area,'Materials'),dataDir=path.join(area,'Library');fs.mkdirSync(root);
 const store=new Store(dataDir,[root]);t.after(()=>{store.close();const resolved=fs.realpathSync(area),relative=path.relative(__dirname,resolved);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5})});
 const createProject=relative=>{const project=path.join(area,relative);for(const part of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project,part),{recursive:true});fs.writeFileSync(path.join(project,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.22f1\n');fs.writeFileSync(path.join(project,'Packages/manifest.json'),'{"dependencies":{"com.vrchat.avatars":"3.9.0"}}');return project};
 const seed=project=>store.upsertScan({path:project,name:path.basename(project),kind:'unity-project',group:'Synthetic',size:0,mtimeMs:1,localCategory:'工程',localAvatars:[],hintUrls:[]});
 const imports=new ProjectImports({dataDir,roots:()=>store.settings().roots,getAsset:id=>store.get(id)});
 const contained=(parent,child)=>{const r=path.relative(path.resolve(parent),path.resolve(child));return !r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r)};
 const context={store,dataDir,path,fsp,noLinks,validateProject,contained,scanner:{progress:()=>({running:false})},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[context.selected]})},window:{},localizeDialogOptions:v=>v,uiLanguage:()=> 'zh-CN',assertNotRecycling:()=>{},changed:()=>{},closing:false,migrating:false};
 return {area,root,store,imports,createProject,seed,context,choose:project=>{context.selected=project;return handler('chooseProject',context)()}};
}

test('adding an external Unity project registers its exact scope before readiness and survives reopening',async t=>{
 const f=fixture(t),project=f.createProject('External/Avatar 日本語');const selected=await f.choose(project);
 assert.equal((await f.imports.readiness(selected.id)).unityVersion,'2022.3.22f1');
 assert.deepEqual(f.store.settings().roots,[f.root,project]);assert(!f.store.settings().roots.includes(path.dirname(project)));
 const reopened=new Store(f.store.dataDir,[]);try{assert.deepEqual(reopened.settings().roots,[f.root,project]);assert.equal(reopened.get(selected.id).path,project)}finally{reopened.close()}
});

test('reselecting an indexed missing project restores availability while preserving user metadata',async t=>{
 const f=fixture(t),project=f.createProject('Materials/Avatar'),record=f.seed(project);f.store.updateManual([record.id],{notes:'Keep this annotation',favorite:true});f.store.updateAvailability(record.id,true);
 const selected=await f.choose(project);assert.equal(selected.id,record.id);assert.equal(selected.missing,false);assert.equal(selected.manual.notes,'Keep this annotation');assert.equal(selected.manual.favorite,true);
 assert.equal((await f.imports.readiness(record.id)).projectId,record.id);assert.deepEqual(f.store.settings().roots,[f.root]);
});

test('choosing a project inside a registered parent preserves that broader source and creates no duplicate',async t=>{
 const f=fixture(t),project=f.createProject('Materials/Avatar');const first=await f.choose(project),second=await f.choose(project);
 assert.equal(first.id,second.id);assert.equal(f.store.all().length,1);assert.deepEqual(f.store.settings().roots,[f.root]);assert.equal((await f.imports.readiness(first.id)).projectId,first.id);
});

test('explicitly re-adding one project under a detached source leaves its sibling detached',async t=>{
 const f=fixture(t),project=f.createProject('Materials/Avatar'),other=f.createProject('Materials/Other'),record=f.seed(project),sibling=f.seed(other);f.store.removeRoot(f.root);
 await assert.rejects(()=>f.imports.readiness(record.id));assert.deepEqual(f.store.settings().roots,[]);
 const selected=await f.choose(project);assert.equal(selected.id,record.id);assert.deepEqual(f.store.settings().roots,[project]);assert.deepEqual(f.store.settings().detachedRoots,[f.root]);assert.equal(f.store.get(sibling.id),null);assert.equal((await f.imports.readiness(record.id)).projectId,record.id);
});

test('an unregistered indexed project remains rejected until explicitly selected',async t=>{
 const f=fixture(t),project=f.createProject('External/Avatar'),record=f.seed(project);
 await assert.rejects(()=>f.imports.readiness(record.id),/已登记/);assert.deepEqual(f.store.settings().roots,[f.root]);
 const selected=await f.choose(project);assert.equal(selected.id,record.id);assert.equal((await f.imports.readiness(record.id)).projectId,record.id);
});

test('invalid, linked and library-overlapping projects do not change registered roots or records',async t=>{
 const f=fixture(t),valid=f.createProject('External/Avatar'),link=path.join(f.area,'LinkedAvatar');fs.symlinkSync(valid,link,process.platform==='win32'?'junction':'dir');const overlapping=f.createProject('Library/Avatar'),before=f.store.settings();
 for(const candidate of [f.root,link,overlapping])await assert.rejects(()=>f.choose(candidate));
 assert.deepEqual(f.store.settings(),before);assert.equal(f.store.all().length,0);
});

test('dropping an external project uses the same registration boundary without scanning sibling folders',async t=>{
 const f=fixture(t),project=f.createProject('Dropped/Avatar'),other=f.createProject('Dropped/Sibling');
 const selected=await handler('addProject',f.context)(project);
 assert.equal((await f.imports.readiness(selected.id)).unityVersion,'2022.3.22f1');assert.deepEqual(f.store.settings().roots,[f.root,project]);assert(!f.store.all().some(a=>a.path===other));
});

test('drop registration rejects invalid paths and scan or recycle races before changing metadata',async t=>{
 const f=fixture(t),project=f.createProject('Dropped/Avatar'),before=f.store.settings(),add=handler('addProject',f.context);
 for(const input of [null,[],{},'relative',project+'\0'])await assert.rejects(()=>add(input));
 f.context.scanner.progress=()=>({running:true});await assert.rejects(()=>add(project),/扫描/);
 f.context.scanner.progress=()=>({running:false});f.context.assertNotRecycling=()=>{throw new Error('Recycle in progress')};await assert.rejects(()=>handler('addProject',f.context)(project),/Recycle/);
 assert.deepEqual(f.store.settings(),before);assert.equal(f.store.all().length,0);
});

test('sandbox preload accepts one native project directory and never trusts a renderer path property',async()=>{
 const calls=[],native={path:'renderer-controlled'},nativePath=path.join(__dirname,'SyntheticProject');let exposed;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/main/preload.js'),'utf8'),{exports:{},process:{argv:[]},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,api)=>{exposed=api}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({id:'project'})},on:()=>{},removeListener:()=>{}},webUtils:{getPathForFile:file=>file===native?nativePath:''}}}});
 assert.equal((await exposed.addDroppedProject([native])).id,'project');assert.deepEqual(calls,[['library:addProject',nativePath]]);
 for(const files of [[],[native,native],[{path:nativePath}]])await assert.rejects(()=>exposed.addDroppedProject(files));assert.equal(calls.length,1);
});
