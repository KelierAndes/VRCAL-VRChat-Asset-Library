const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{Store}=require('../dist/main/main/store'),{copyLibraryData}=require('../dist/main/main/storage');
const {REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS}=require('../dist/main/shared/contracts');

function fixture(t){
 const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-review-header-')),root=path.join(base,'素材 日本語 💝'),data=path.join(base,'Library'),stores=[];fs.mkdirSync(root);
 const open=(directory=data)=>{const store=new Store(directory,[root]);stores.push(store);return store};
 const source=path.join(root,'Dress_Airi.unitypackage');fs.writeFileSync(source,'ORIGINAL SOURCE BYTES');
 const store=open(),asset=store.upsertScan({path:source,name:path.basename(source),group:'Airi',kind:'unitypackage',size:21,mtimeMs:1,localCategory:'服装',localAvatars:['Airi'],localEvidence:[],compatibilityComplete:false,hintUrls:[]});store.updateManual([asset.id],{notes:'KEEP 人工メモ',favorite:true});
 t.after(()=>{for(const handle of stores)try{handle.close()}catch{}assert(path.resolve(base).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});
 return {base,root,data,source,store,asset,open};
}
function rawSettings(f,update){const db=new DatabaseSync(path.join(f.data,'library.sqlite'));try{const value=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);if(update){update(value);db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value),'app')}return value}finally{db.close()}}
function viewHandler(store){
 const file=path.resolve(__dirname,'../src/main/main.ts'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let callback;
 function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='handle'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='setViewPreferences')callback=node.arguments[1];ts.forEachChild(node,visit)}visit(source);assert(callback,'Existing setViewPreferences handler must be registered');
 const output=ts.transpileModule('const invoke='+callback.getText(source)+';invoke',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 let changes=0,themes=0;const invoke=vm.runInNewContext(output,{store,REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS,changed:()=>changes++,refreshTheme:()=>themes++});
 return {invoke,changes:()=>changes,themes:()=>themes};
}

test('review header defaults unlocked, persists both choices and leaves source records unchanged',t=>{
 const f=fixture(t),before=f.store.getRaw(f.asset.id);assert.equal(f.store.settings().reviewHeaderPinned,false);
 assert.equal(f.store.saveSettings({reviewHeaderPinned:true}).reviewHeaderPinned,true);f.store.saveSettings({theme:'x-light',language:'ja',density:'compact'});f.store.close();
 const reopened=f.open();assert.equal(reopened.settings().reviewHeaderPinned,true);assert.equal(reopened.settings().theme,'x-light');assert.equal(reopened.settings().language,'ja');assert.deepEqual(reopened.getRaw(f.asset.id),before);
 reopened.saveSettings({reviewHeaderPinned:false});reopened.close();assert.equal(f.open().settings().reviewHeaderPinned,false);assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('missing and malformed stored header preferences normalize without rewriting legacy settings',t=>{
 const f=fixture(t);f.store.saveSettings({theme:'swiss',reviewSort:'added'});f.store.close();
 for(const value of [undefined,'true',1,0,null,{},[]]){
  rawSettings(f,saved=>{if(value===undefined)delete saved.reviewHeaderPinned;else saved.reviewHeaderPinned=value});const before=rawSettings(f),store=f.open();
  assert.equal(store.settings().reviewHeaderPinned,false);assert.equal(store.settings().theme,'swiss');assert.equal(store.settings().reviewSort,'added');assert.deepEqual(rawSettings(f),before);store.close();
 }
 rawSettings(f,saved=>{saved.reviewHeaderPinned=true});assert.equal(f.open().settings().reviewHeaderPinned,true);
});

test('non-boolean header writes fail atomically before unrelated preferences or metadata change',t=>{
 const f=fixture(t);f.store.saveSettings({reviewHeaderPinned:true,theme:'swiss'});const before=f.store.settings(),asset=f.store.getRaw(f.asset.id);
 for(const value of [undefined,'true','false',1,0,null,{},[],new Boolean(true)]){
  assert.throws(()=>f.store.saveSettings({reviewHeaderPinned:value,theme:'x-light',uiZoom:1.5}),/显示偏好无效/);assert.deepEqual(f.store.settings(),before);assert.deepEqual(f.store.getRaw(f.asset.id),asset);
 }
});

test('verified backups and library migration preserve pinned and unpinned preferences',async t=>{
 const f=fixture(t);
 for(const pinned of [true,false]){
  f.store.saveSettings({reviewHeaderPinned:pinned});const backup=path.join(f.base,'backup-'+pinned+'.json');f.store.exportData(backup);assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).settings.reviewHeaderPinned,pinned);
  const restored=f.open(path.join(f.base,'restored-'+pinned));restored.saveSettings({reviewHeaderPinned:!pinned});restored.importData(backup);assert.equal(restored.settings().reviewHeaderPinned,pinned);assert.equal(restored.getRaw(f.asset.id).manual.notes,'KEEP 人工メモ');
 }
 f.store.saveSettings({reviewHeaderPinned:true});f.store.close();const target=path.join(f.base,'Migrated');await copyLibraryData(f.data,target,[f.root],true);assert.equal(f.open(target).settings().reviewHeaderPinned,true);assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('legacy or malformed backup fields retain the destination choice and new libraries remain unlocked',t=>{
 const f=fixture(t),original=path.join(f.base,'original.json');f.store.exportData(original);
 for(const [index,value] of [undefined,'true',1,null,{},[]].entries()){
  const backup=JSON.parse(fs.readFileSync(original,'utf8'));backup.version=1;delete backup.metadataSha256;if(value===undefined)delete backup.settings.reviewHeaderPinned;else backup.settings.reviewHeaderPinned=value;
  const file=path.join(f.base,'legacy-'+index+'.json');fs.writeFileSync(file,JSON.stringify(backup));const pinned=f.open(path.join(f.base,'pinned-'+index)),fresh=f.open(path.join(f.base,'fresh-'+index));pinned.saveSettings({reviewHeaderPinned:true});pinned.importData(file);fresh.importData(file);
  assert.equal(pinned.settings().reviewHeaderPinned,true);assert.equal(fresh.settings().reviewHeaderPinned,false);assert.equal(fresh.getRaw(f.asset.id).manual.notes,'KEEP 人工メモ');
 }
});

test('the registered view-preference handler accepts booleans and rejects unknown types and fields before saving',t=>{
 const f=fixture(t),api=viewHandler(f.store);assert.equal(api.invoke({reviewHeaderPinned:true}).reviewHeaderPinned,true);assert.equal(api.changes(),1);assert.equal(api.themes(),0);
 for(const input of [undefined,null,[],1,'true',...[undefined,'true','false',1,0,null,{},[]].map(reviewHeaderPinned=>({reviewHeaderPinned,theme:'x-light'})),{reviewHeaderPinned:false,unknownPreference:true}]){
  const before=f.store.settings();assert.throws(()=>api.invoke(input),/显示设置无效/);assert.deepEqual(f.store.settings(),before);assert.equal(api.changes(),1);assert.equal(api.themes(),0);
 }
 assert.equal(api.invoke({reviewHeaderPinned:false,language:'en'}).reviewHeaderPinned,false);assert.equal(api.changes(),2);assert.equal(api.themes(),1);
});
